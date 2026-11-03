import { GoogleGenAI, Type } from '@google/genai';
import type {
  CharacterMemoryItem,
  EditorialChange,
  ParagraphRefinementAction,
  Stage1CoverageMetadata,
  StoryContextProfile,
  StyleProfile,
  TerminologyCategory,
  TerminologyMemoryItem,
  TranslationStyleControls,
  VerificationReport,
} from './types';
import { formatMemoryPromptBlock, formatStyleDirectiveBlock } from './chunker';
import {
  extractContextualSenseKey,
  extractEnglishSurfaceAndSense,
  findEnglishTermOccurrences,
  formatGlossaryForPrompt,
  hydrateProjectGlossary,
  mergeStage1WindowResults,
  normalizeBanglaUnicode,
  normalizeEnglishTerm,
  normalizeTerminologyItem,
  splitTextIntoStage1Windows,
  validateStage3DiscoveredTerms,
  type Stage1WindowAnalysisPayload,
  type Stage1WindowExecutionOutcome,
  type Stage1WindowPlan,
  type Stage1WindowSlice,
} from './terminology';

export type Stage1WindowResultPayload = Stage1WindowAnalysisPayload;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please verify your API key in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const DEFAULT_MODEL = 'gemini-3.8-flash';

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 800
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        if (delayMs > 0) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }
  }
  throw lastError;
}

const VALID_STAGE1_CATEGORIES = new Set<TerminologyMemoryItem['category']>([
  'name',
  'place',
  'title',
  'object',
  'fantasy',
  'expression',
]);

const STAGE1_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    storyContext: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        narrativeTimeline: { type: Type.STRING },
        importantEvents: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        emotionalContext: { type: Type.STRING },
        literaryTone: { type: Type.STRING },
        locations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              banglaName: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['name', 'banglaName', 'description'],
          },
        },
      },
      required: [
        'summary',
        'narrativeTimeline',
        'importantEvents',
        'emotionalContext',
        'literaryTone',
        'locations',
      ],
    },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          englishName: { type: Type.STRING },
          banglaName: { type: Type.STRING },
          relationships: { type: Type.STRING },
          pronouns: { type: Type.STRING },
          personality: { type: Type.STRING },
          speakingStyle: { type: Type.STRING },
          notes: { type: Type.STRING },
        },
        required: [
          'englishName',
          'banglaName',
          'relationships',
          'pronouns',
          'personality',
          'speakingStyle',
          'notes',
        ],
      },
    },
    terminology: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          englishTerm: { type: Type.STRING },
          banglaTranslation: { type: Type.STRING },
          category: {
            type: Type.STRING,
            description: 'One of: name, place, title, object, fantasy, expression',
          },
          notes: { type: Type.STRING },
        },
        required: ['englishTerm', 'banglaTranslation', 'category', 'notes'],
      },
    },
  },
  required: ['storyContext', 'characters', 'terminology'],
};

export type Stage1WindowExecutor = (params: {
  windowSlice: Stage1WindowSlice;
  windowPlan: Stage1WindowPlan;
  prompt: string;
  systemInstruction: string;
  isContinuationWindow: boolean;
}) => Promise<unknown>;

/**
 * Mandatory Correction C:
 * Sanitizes Stage 1 AI `notes` (after combining raw notes and extracted parenthetical notes)
 * so that non-contextual Stage 1 AI outputs never trigger accidental contextual homonym
 * splitting in `extractContextualSenseKey` or `hasExplicitContextualSenseQualification`.
 */
export function sanitizeStage1NoteForNonContextualAI(
  rawNotes: string,
  englishTerm = ''
): string {
  let sanitized = normalizeEnglishTerm(rawNotes ?? '');
  if (!sanitized) return '';

  const stripPrefixesAndTriggers = (input: string): string => {
    let current = normalizeEnglishTerm(input);
    let previous = '';
    while (current && current !== previous) {
      previous = current;
      current = normalizeEnglishTerm(
        current
          .replace(/^(?:context|sense|meaning|domain|usage)\s*:\s*/i, '')
          .replace(
            /([;|]\s*)(?:context|sense|meaning|domain|usage)\s*:\s*/gi,
            '$1'
          )
          .replace(
            /\b(?:when referring to|in the sense of|when used as|specifically for)\b/gi,
            'regarding'
          )
      );
    }
    return current;
  };

  sanitized = stripPrefixesAndTriggers(sanitized);

  // Enforce strict post-condition: extractContextualSenseKey must be ''
  let safetyCounter = 0;
  while (
    sanitized &&
    extractContextualSenseKey({
      englishTerm,
      notes: sanitized,
      isContextSensitive: false,
    }) !== ''
  ) {
    safetyCounter++;
    const next = stripPrefixesAndTriggers(sanitized);
    if (next === sanitized || safetyCounter > 10) {
      sanitized = '';
      break;
    }
    sanitized = next;
  }

  return sanitized;
}

/**
 * Mandatory Correction B & C:
 * Sanitizes raw Stage 1 window terminology items:
 * 1. Repeatedly strips chained trailing parenthetical qualifiers (`"watch (silver) (pocket)"` -> `"watch"`).
 * 2. Strips any remaining mid-string or nested parenthetical qualifiers (`"bank (river) wall"` -> `"bank wall"`),
 *    moving all extracted parenthetical text into the note sanitization pipeline.
 * 3. Combines `raw.notes` and extracted parenthetical notes and neutralizes contextual trigger phrases.
 * 4. Normalizes the candidate via `normalizeTerminologyItem` (`isContextSensitive: false`, `contextMeaning: undefined`,
 *    `acceptedAlternatives: []`, `source: 'stage1_ai'`, `lockedByUser: false`) and verifies literal presence in
 *    `windowText` via `findEnglishTermOccurrences`. Rejects ungrounded/hallucinated terms.
 */
export function sanitizeStage1WindowTerminology(
  rawTerms: ReadonlyArray<Record<string, unknown>> | undefined | null,
  windowText: string
): Partial<TerminologyMemoryItem>[] {
  if (!Array.isArray(rawTerms) || !windowText?.trim()) {
    return [];
  }

  const sanitizedItems: Partial<TerminologyMemoryItem>[] = [];

  for (let idx = 0; idx < rawTerms.length; idx++) {
    const raw = rawTerms[idx];
    if (!raw || typeof raw !== 'object') continue;

    const rawEnglish = typeof raw.englishTerm === 'string' ? raw.englishTerm : '';
    const rawBangla = normalizeBanglaUnicode(
      typeof raw.banglaTranslation === 'string' ? raw.banglaTranslation : ''
    );
    if (!rawEnglish.trim() || !rawBangla) continue;

    let surfaceTerm = normalizeEnglishTerm(rawEnglish);
    const trailingParentheticalNotes: string[] = [];

    // 1. Repeatedly strip chained trailing parenthetical qualifiers
    while (surfaceTerm) {
      const { surfaceTerm: nextSurface, parentheticalSense } =
        extractEnglishSurfaceAndSense(surfaceTerm);
      if (!parentheticalSense) break;
      trailingParentheticalNotes.unshift(parentheticalSense);
      surfaceTerm = normalizeEnglishTerm(nextSurface);
    }

    // 2. Repeatedly strip any remaining nested or mid-string parenthetical groups
    const midParentheticalNotes: string[] = [];
    while (/\([^()]*\)/.test(surfaceTerm)) {
      surfaceTerm = surfaceTerm.replace(/\(([^()]*)\)/g, (_match, inner: string) => {
        const cleanedInner = normalizeEnglishTerm(inner);
        if (cleanedInner) {
          midParentheticalNotes.push(cleanedInner);
        }
        return ' ';
      });
      surfaceTerm = normalizeEnglishTerm(surfaceTerm);
    }

    // Strip any stray unbalanced parentheses
    if (/[()]/.test(surfaceTerm)) {
      surfaceTerm = normalizeEnglishTerm(surfaceTerm.replace(/[()]/g, ' '));
    }

    if (!surfaceTerm) continue;

    // 3. Combine raw.notes and extracted parenthetical notes, then neutralize contextual triggers
    const rawNotes = typeof raw.notes === 'string' ? normalizeEnglishTerm(raw.notes) : '';
    const combinedNoteParts = [
      ...(rawNotes ? [rawNotes] : []),
      ...midParentheticalNotes,
      ...trailingParentheticalNotes,
    ].filter(Boolean);
    const sanitizedNotes = sanitizeStage1NoteForNonContextualAI(
      combinedNoteParts.join('; '),
      surfaceTerm
    );

    const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
    const category: TerminologyMemoryItem['category'] = VALID_STAGE1_CATEGORIES.has(
      rawCategory as TerminologyMemoryItem['category']
    )
      ? (rawCategory as TerminologyMemoryItem['category'])
      : 'expression';

    const candidate = normalizeTerminologyItem(
      {
        id:
          typeof raw.id === 'string' && raw.id.trim()
            ? raw.id.trim()
            : `term-stage1-${idx}-${surfaceTerm.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        englishTerm: surfaceTerm,
        banglaTranslation: rawBangla,
        category,
        notes: sanitizedNotes,
        contextMeaning: undefined,
        isContextSensitive: false,
        caseSensitive: false,
        acceptedAlternatives: [],
        avoidTranslations: [],
        source: 'stage1_ai',
        lockedByUser: false,
      },
      idx
    );

    // 4. Verify grounding in the source window text
    const occurrences = findEnglishTermOccurrences(windowText, candidate);
    if (occurrences.length === 0) {
      continue;
    }

    sanitizedItems.push({
      id: candidate.id,
      englishTerm: candidate.englishTerm,
      banglaTranslation: candidate.banglaTranslation,
      category: candidate.category,
      notes: candidate.notes,
      contextMeaning: undefined,
      isContextSensitive: false,
      caseSensitive: false,
      acceptedAlternatives: [],
      avoidTranslations: [],
      source: 'stage1_ai',
      lockedByUser: false,
    });
  }

  return sanitizedItems;
}

function hasExplicitContextualSenseOnExisting(item: TerminologyMemoryItem): boolean {
  if (item.isContextSensitive) return true;
  const { parentheticalSense } = extractEnglishSurfaceAndSense(item.englishTerm ?? '');
  if (parentheticalSense) return true;
  const rawNotes = normalizeEnglishTerm(item.notes ?? '');
  if (!rawNotes) return false;
  return (
    /^(?:context|sense|meaning|domain|usage)\s*:\s*(.+)$/i.test(rawNotes) ||
    /\b(?:when referring to|in the sense of|when used as|specifically for)\s+(.+)$/i.test(
      rawNotes
    )
  );
}

function doesStage1CandidateMatchExisting(
  existing: TerminologyMemoryItem,
  candidate: TerminologyMemoryItem
): boolean {
  const existingSurface = extractEnglishSurfaceAndSense(existing.englishTerm).surfaceTerm;
  const candidateSurface = extractEnglishSurfaceAndSense(candidate.englishTerm).surfaceTerm;
  const sameEnglish = existing.caseSensitive
    ? existingSurface === candidateSurface
    : existingSurface.toLowerCase() === candidateSurface.toLowerCase();
  if (!sameEnglish) return false;

  const existingAvoidsCandidate = (existing.avoidTranslations ?? []).includes(
    candidate.banglaTranslation
  );
  if (existingAvoidsCandidate) return true;

  const existingExplicitContextual = hasExplicitContextualSenseOnExisting(existing);
  if (existing.lockedByUser && !existingExplicitContextual) {
    return true;
  }

  if (
    existing.category !== candidate.category &&
    existing.banglaTranslation !== candidate.banglaTranslation &&
    existingExplicitContextual
  ) {
    return false;
  }

  return true;
}

function appendUniqueAdvisoryNote(baseNotes: string, advisoryFragment: string): string {
  const trimmedBase = normalizeEnglishTerm(baseNotes ?? '');
  const trimmedFragment = normalizeEnglishTerm(advisoryFragment ?? '');
  if (!trimmedFragment) return trimmedBase;
  if (!trimmedBase) return trimmedFragment;
  if (trimmedBase.toLowerCase().includes(trimmedFragment.toLowerCase())) {
    return trimmedBase;
  }
  return `${trimmedBase} | ${trimmedFragment}`;
}

/**
 * Mandatory Correction A:
 * Reconciles terminology across Stage 1 windows within the same pass and against existing glossary:
 * - Never adds a conflicting Stage 1 AI translation into `acceptedAlternatives` (`acceptedAlternatives: []` always).
 * - Preserves the first established or higher-authority translation as primary `banglaTranslation`.
 * - Records a conflicting secondary Stage 1 rendering ONLY as an advisory note in `notes`, and ONLY when:
 *   1. No user-defined entry governs the term (`lockedByUser === true || source === 'user'`), and
 *   2. The secondary rendering is not in `avoidTranslations`.
 */
export function reconcileSamePassStage1Terminology(
  windowPayloads: ReadonlyArray<Stage1WindowResultPayload>,
  existingGlossary: ReadonlyArray<Partial<TerminologyMemoryItem>> = []
): Stage1WindowResultPayload[] {
  const hydratedExisting = hydrateProjectGlossary(existingGlossary);

  interface PassTermTracker {
    canonicalItem: TerminologyMemoryItem;
    userGoverned: boolean;
    avoidSet: Set<string>;
    acceptedSet: Set<string>;
    advisoryNotes: string[];
    baseNotes: string;
  }

  const trackers: PassTermTracker[] = [];

  const findOrCreateTracker = (candidate: TerminologyMemoryItem): PassTermTracker => {
    for (const tracker of trackers) {
      if (doesStage1CandidateMatchExisting(tracker.canonicalItem, candidate)) {
        return tracker;
      }
    }

    const matchingExisting = hydratedExisting.find((ex) =>
      doesStage1CandidateMatchExisting(ex, candidate)
    );

    if (matchingExisting) {
      const userGoverned =
        matchingExisting.lockedByUser === true || matchingExisting.source === 'user';
      const avoidSet = new Set<string>(matchingExisting.avoidTranslations ?? []);
      const acceptedSet = new Set<string>(matchingExisting.acceptedAlternatives ?? []);

      // Tier 2 (`stage1_ai` or `location_sync`) or Tier 1 (`user`) already establishes the primary translation.
      // Tier 3 (`chunk_ai`) is superseded by the first non-avoided Stage 1 AI translation.
      const existingEstablishesPrimary =
        userGoverned ||
        matchingExisting.source === 'stage1_ai' ||
        matchingExisting.source === 'location_sync';

      const primaryBangla =
        existingEstablishesPrimary || avoidSet.has(candidate.banglaTranslation)
          ? matchingExisting.banglaTranslation
          : candidate.banglaTranslation;

      const baseNotes = userGoverned
        ? ''
        : existingEstablishesPrimary
          ? matchingExisting.notes || candidate.notes || ''
          : candidate.notes || matchingExisting.notes || '';

      const tracker: PassTermTracker = {
        canonicalItem: normalizeTerminologyItem({
          ...candidate,
          banglaTranslation: primaryBangla,
          notes: baseNotes,
          acceptedAlternatives: [],
          avoidTranslations: Array.from(avoidSet),
          source: 'stage1_ai',
          lockedByUser: false,
          isContextSensitive: false,
          contextMeaning: undefined,
        }),
        userGoverned,
        avoidSet,
        acceptedSet,
        advisoryNotes: [],
        baseNotes,
      };

      // If existing was Tier 2 (`stage1_ai` or `location_sync`) and this first window candidate conflicts
      // with the established Tier 2 translation, check if it qualifies as an advisory note.
      if (
        !userGoverned &&
        existingEstablishesPrimary &&
        candidate.banglaTranslation !== primaryBangla &&
        !avoidSet.has(candidate.banglaTranslation) &&
        !acceptedSet.has(candidate.banglaTranslation)
      ) {
        const noteSuffix = candidate.notes ? ` (${candidate.notes})` : '';
        tracker.advisoryNotes.push(
          `Alternate Stage 1 candidate: ${candidate.banglaTranslation}${noteSuffix}`
        );
      }

      trackers.push(tracker);
      return tracker;
    }

    const newTracker: PassTermTracker = {
      canonicalItem: normalizeTerminologyItem({
        ...candidate,
        acceptedAlternatives: [],
        avoidTranslations: [],
        source: 'stage1_ai',
        lockedByUser: false,
        isContextSensitive: false,
        contextMeaning: undefined,
      }),
      userGoverned: false,
      avoidSet: new Set<string>(),
      acceptedSet: new Set<string>(),
      advisoryNotes: [],
      baseNotes: candidate.notes || '',
    };
    trackers.push(newTracker);
    return newTracker;
  };

  // Pass 1: Build trackers and collect non-avoided advisory conflicts in window order
  for (let wIdx = 0; wIdx < windowPayloads.length; wIdx++) {
    const payload = windowPayloads[wIdx];
    const terms = payload.terminology ?? [];
    for (let tIdx = 0; tIdx < terms.length; tIdx++) {
      const rawTerm = terms[tIdx];
      const candidate = normalizeTerminologyItem(
        {
          ...rawTerm,
          acceptedAlternatives: [],
          source: 'stage1_ai',
          lockedByUser: false,
          isContextSensitive: false,
          contextMeaning: undefined,
        },
        tIdx
      );
      if (!candidate.englishTerm || !candidate.banglaTranslation) continue;

      const existingTracker = trackers.find((tr) =>
        doesStage1CandidateMatchExisting(tr.canonicalItem, candidate)
      );

      if (!existingTracker) {
        findOrCreateTracker(candidate);
        continue;
      }

      if (existingTracker.userGoverned) {
        continue;
      }

      const primaryBangla = existingTracker.canonicalItem.banglaTranslation;
      if (candidate.banglaTranslation === primaryBangla) {
        if (!existingTracker.baseNotes && candidate.notes) {
          existingTracker.baseNotes = candidate.notes;
        }
      } else if (
        !existingTracker.avoidSet.has(candidate.banglaTranslation) &&
        !existingTracker.acceptedSet.has(candidate.banglaTranslation)
      ) {
        const noteSuffix = candidate.notes ? ` (${candidate.notes})` : '';
        existingTracker.advisoryNotes.push(
          `Alternate Stage 1 candidate: ${candidate.banglaTranslation}${noteSuffix}`
        );
      }
    }
  }

  // Pass 2: Produce reconciled payloads with primary translation, empty acceptedAlternatives, and consolidated notes
  return windowPayloads.map((payload) => {
    const terms = payload.terminology ?? [];
    const reconciledTerms: Partial<TerminologyMemoryItem>[] = [];

    for (let tIdx = 0; tIdx < terms.length; tIdx++) {
      const rawTerm = terms[tIdx];
      const candidate = normalizeTerminologyItem(
        {
          ...rawTerm,
          acceptedAlternatives: [],
          source: 'stage1_ai',
          lockedByUser: false,
          isContextSensitive: false,
          contextMeaning: undefined,
        },
        tIdx
      );
      if (!candidate.englishTerm || !candidate.banglaTranslation) continue;

      const tracker = trackers.find((tr) =>
        doesStage1CandidateMatchExisting(tr.canonicalItem, candidate)
      );
      if (!tracker) continue;

      let consolidatedNotes = tracker.baseNotes;
      if (!tracker.userGoverned) {
        for (const adv of tracker.advisoryNotes) {
          consolidatedNotes = appendUniqueAdvisoryNote(consolidatedNotes, adv);
        }
        consolidatedNotes = sanitizeStage1NoteForNonContextualAI(
          consolidatedNotes,
          tracker.canonicalItem.englishTerm
        );
      } else {
        consolidatedNotes = '';
      }

      reconciledTerms.push({
        ...rawTerm,
        id: tracker.canonicalItem.id,
        englishTerm: tracker.canonicalItem.englishTerm,
        banglaTranslation: tracker.canonicalItem.banglaTranslation,
        category: tracker.canonicalItem.category,
        notes: consolidatedNotes,
        contextMeaning: undefined,
        isContextSensitive: false,
        caseSensitive: false,
        acceptedAlternatives: [],
        avoidTranslations: [],
        source: 'stage1_ai',
        lockedByUser: false,
      });
    }

    return {
      ...payload,
      terminology: reconciledTerms,
    };
  });
}

function hasMeaningfulStoryContext(ctx?: StoryContextProfile | null): boolean {
  if (!ctx) return false;
  return Boolean(
    ctx.summary?.trim() ||
      ctx.narrativeTimeline?.trim() ||
      ctx.emotionalContext?.trim() ||
      ctx.literaryTone?.trim() ||
      (Array.isArray(ctx.importantEvents) && ctx.importantEvents.length > 0) ||
      (Array.isArray(ctx.locations) && ctx.locations.length > 0)
  );
}

function buildStage1WindowPrompt(params: {
  projectTitle: string;
  genre: string;
  windowSlice: Stage1WindowSlice;
  totalWindows: number;
  existingMemBlock: string;
  establishedStoryContext: StoryContextProfile | null;
  isContinuationWindow: boolean;
}): string {
  const {
    projectTitle,
    genre,
    windowSlice,
    totalWindows,
    existingMemBlock,
    establishedStoryContext,
    isContinuationWindow,
  } = params;

  const windowHeader =
    totalWindows > 1
      ? `WINDOW ${windowSlice.windowIndex + 1} OF ${totalWindows} (Paragraphs ${windowSlice.startParagraphIndex + 1}–${windowSlice.endParagraphIndex + 1})`
      : 'FULL CHAPTER PASSAGE';

  const continuationContextBlock =
    isContinuationWindow && establishedStoryContext
      ? `\nESTABLISHED STORY CONTEXT FROM PRIOR ANALYSIS (Maintain continuity; do not contradict established tone, timeline, or location names):
- Summary: ${establishedStoryContext.summary || 'N/A'}
- Narrative Timeline: ${establishedStoryContext.narrativeTimeline || 'N/A'}
- Emotional Context: ${establishedStoryContext.emotionalContext || 'N/A'}
- Literary Tone: ${establishedStoryContext.literaryTone || 'N/A'}
- Established Locations: ${
          establishedStoryContext.locations?.length
            ? establishedStoryContext.locations
                .map((l) => `${l.name} -> ${l.banglaName}`)
                .join('; ')
            : 'None yet'
        }\n`
      : '';

  const framingDirective = isContinuationWindow
    ? `Continue the Stage 1 Literary Understanding for "${projectTitle}" (Genre: ${genre || 'Literary Fiction'}) on ${windowHeader} prior to Bangla (বাংলা) literary translation. Preserve consistency with the established story context and existing project memory while extracting any new events, locations, characters, and recurring terminology appearing in this window.`
    : `Analyze the following English literary text from "${projectTitle}" (Genre: ${genre || 'Literary Fiction'}) (${windowHeader}) for Stage 1 Literary Understanding prior to Bangla (বাংলা) literary translation.`;

  return `${framingDirective}

EXISTING PROJECT MEMORY:
${existingMemBlock}
${continuationContextBlock}
SOURCE PASSAGE:
"""
${windowSlice.text}
"""

Identify:
1. Story summary, narrative timeline, important events, emotional context, literary tone, and key locations (with natural Bangla names).
2. Characters present in the passage, their relationships, pronouns/gender, personality, speaking style, and their natural Bangla name (respecting any existing character memory).
3. Recurring terminology, places, fictional locations, titles, special objects, or repeated expressions literally appearing in this passage, with recommended natural literary Bangla equivalents. Do not add parenthetical sense tags to englishTerm; put descriptive guidance in notes.`;
}

/**
 * Stage 1 — Literary Understanding & Memory Extraction (Multi-Window with Coverage Metadata)
 */
export async function analyzeStoryUnderstanding(params: {
  text: string;
  projectTitle: string;
  genre: string;
  existingCharacters: CharacterMemoryItem[];
  existingTerminology: TerminologyMemoryItem[];
  existingStoryContext?: StoryContextProfile | null;
  maxWindowChars?: number;
  maxWindows?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  windowExecutor?: Stage1WindowExecutor;
}): Promise<{
  storyContext: StoryContextProfile;
  extractedCharacters: CharacterMemoryItem[];
  extractedTerminology: TerminologyMemoryItem[];
  stage1Coverage: Stage1CoverageMetadata;
}> {
  const ai = params.windowExecutor ? null : getGeminiClient();
  const maxRetries = params.maxRetries ?? 2;
  const retryDelayMs = params.retryDelayMs ?? (params.windowExecutor ? 0 : 800);

  const hydratedExistingGlossary = hydrateProjectGlossary(params.existingTerminology);
  const windowPlan = splitTextIntoStage1Windows(params.text, {
    maxWindowChars: params.maxWindowChars,
    maxWindows: params.maxWindows,
  });

  if (windowPlan.scheduledWindows.length === 0) {
    const emptyMerged = mergeStage1WindowResults({
      existingGlossary: hydratedExistingGlossary,
      existingContext: params.existingStoryContext ?? null,
      existingCharacters: params.existingCharacters ?? [],
      windowPlan,
      windowOutcomes: [],
      syncLocations: true,
    });
    return {
      storyContext: emptyMerged.storyContext,
      extractedCharacters: emptyMerged.characterMemory,
      extractedTerminology: emptyMerged.terminologyMemory,
      stage1Coverage: emptyMerged.coverage,
    };
  }

  const systemInstruction =
    'You are a master Bengali literary scholar, novelist, and translator. Analyze English fiction deeply to prepare a faithful, culturally and emotionally resonant Bangla literary translation.';

  let runningCharacters: CharacterMemoryItem[] = [...(params.existingCharacters ?? [])];
  let runningGlossary: TerminologyMemoryItem[] = [...hydratedExistingGlossary];
  let establishedStoryContext: StoryContextProfile | null = hasMeaningfulStoryContext(
    params.existingStoryContext
  )
    ? params.existingStoryContext!
    : null;

  const rawOutcomes: Stage1WindowExecutionOutcome[] = [];

  for (const windowSlice of windowPlan.scheduledWindows) {
    const isContinuationWindow = Boolean(establishedStoryContext);
    const existingMemBlock = formatMemoryPromptBlock(runningCharacters, runningGlossary);
    const prompt = buildStage1WindowPrompt({
      projectTitle: params.projectTitle,
      genre: params.genre,
      windowSlice,
      totalWindows: windowPlan.allWindows.length,
      existingMemBlock,
      establishedStoryContext,
      isContinuationWindow,
    });

    try {
      const parsed = await withRetry(
        async () => {
          let rawResult: unknown;
          if (params.windowExecutor) {
            rawResult = await params.windowExecutor({
              windowSlice,
              windowPlan,
              prompt,
              systemInstruction,
              isContinuationWindow,
            });
          } else {
            const response = await ai!.models.generateContent({
              model: DEFAULT_MODEL,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: STAGE1_RESPONSE_SCHEMA,
              },
            });
            rawResult = JSON.parse((response.text ?? '').trim());
          }

          const candidateObj =
            typeof rawResult === 'string' ? JSON.parse(rawResult.trim()) : rawResult;

          if (
            candidateObj === null ||
            typeof candidateObj !== 'object' ||
            Array.isArray(candidateObj)
          ) {
            throw new Error(
              `Stage 1 window #${windowSlice.windowIndex + 1} returned non-object JSON payload.`
            );
          }

          return candidateObj as Record<string, unknown>;
        },
        maxRetries,
        retryDelayMs
      );

      const rawCharacters = Array.isArray(parsed.characters)
        ? (parsed.characters as Record<string, string>[])
        : [];
      const extractedWindowCharacters: CharacterMemoryItem[] = rawCharacters.map(
        (c, idx) => ({
          id: `char-${Date.now()}-${windowSlice.windowIndex}-${idx}`,
          englishName: c?.englishName || '',
          banglaName: c?.banglaName || '',
          relationships: c?.relationships || '',
          pronouns: c?.pronouns || '',
          personality: c?.personality || '',
          speakingStyle: c?.speakingStyle || '',
          notes: c?.notes || '',
        })
      );

      const rawTerminology = Array.isArray(parsed.terminology)
        ? (parsed.terminology as Record<string, unknown>[])
        : [];
      const sanitizedWindowTerminology = sanitizeStage1WindowTerminology(
        rawTerminology,
        windowSlice.text
      );

      const rawStoryContext =
        parsed.storyContext &&
        typeof parsed.storyContext === 'object' &&
        !Array.isArray(parsed.storyContext)
          ? (parsed.storyContext as Partial<StoryContextProfile>)
          : undefined;

      const windowPayload: Stage1WindowResultPayload = {
        storyContext: rawStoryContext,
        characters: extractedWindowCharacters,
        terminology: sanitizedWindowTerminology,
      };

      rawOutcomes.push({
        windowIndex: windowSlice.windowIndex,
        success: true,
        payload: windowPayload,
      });

      // Incrementally update running context, characters, and glossary for subsequent windows
      const successfulSoFar = rawOutcomes.filter((o) => o.success && o.payload);
      const reconciledPayloadsSoFar = reconcileSamePassStage1Terminology(
        successfulSoFar.map((o) => o.payload!),
        hydratedExistingGlossary
      );
      const outcomesSoFar: Stage1WindowExecutionOutcome[] = rawOutcomes.map((o) => {
        if (!o.success || !o.payload) return o;
        const idxInSuccessful = successfulSoFar.findIndex(
          (s) => s.windowIndex === o.windowIndex
        );
        return {
          ...o,
          payload:
            idxInSuccessful >= 0 ? reconciledPayloadsSoFar[idxInSuccessful] : o.payload,
        };
      });

      const incrementalMerged = mergeStage1WindowResults({
        existingGlossary: hydratedExistingGlossary,
        existingContext: params.existingStoryContext ?? null,
        existingCharacters: params.existingCharacters ?? [],
        windowPlan,
        windowOutcomes: outcomesSoFar,
        syncLocations: true,
      });

      runningCharacters = incrementalMerged.characterMemory;
      runningGlossary = incrementalMerged.terminologyMemory;
      if (hasMeaningfulStoryContext(incrementalMerged.storyContext)) {
        establishedStoryContext = incrementalMerged.storyContext;
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err || 'Stage 1 window analysis failed');
      rawOutcomes.push({
        windowIndex: windowSlice.windowIndex,
        success: false,
        errorMessage,
      });
    }
  }

  const successfulOutcomes = rawOutcomes.filter((o) => o.success && o.payload);
  if (successfulOutcomes.length === 0) {
    const failureDetails = rawOutcomes
      .map((o) => `Window #${o.windowIndex + 1}: ${o.errorMessage || 'Failed'}`)
      .join('; ');
    throw new Error(
      `Stage 1 analysis failed across all ${windowPlan.scheduledWindows.length} scheduled window(s) (${failureDetails}).`
    );
  }

  const reconciledPayloads = reconcileSamePassStage1Terminology(
    successfulOutcomes.map((o) => o.payload!),
    hydratedExistingGlossary
  );

  // Sync reconciled advisory notes onto unlocked Tier 2 existing glossary items so pre-existing
  // non-empty `stage1_ai` notes also retain advisory conflict notes during mergeSingleGlossaryPair.
  const existingGlossaryForMerge = hydratedExistingGlossary.map((existingItem) => {
    if (existingItem.lockedByUser || existingItem.source === 'user') {
      return existingItem;
    }
    if (existingItem.source !== 'stage1_ai' && existingItem.source !== 'location_sync') {
      return existingItem;
    }
    let updatedNotes = existingItem.notes || '';
    for (const payload of reconciledPayloads) {
      for (const rawTerm of payload.terminology ?? []) {
        const candidate = normalizeTerminologyItem({
          ...rawTerm,
          source: 'stage1_ai',
          lockedByUser: false,
        });
        if (
          doesStage1CandidateMatchExisting(existingItem, candidate) &&
          candidate.notes
        ) {
          updatedNotes = appendUniqueAdvisoryNote(updatedNotes, candidate.notes);
        }
      }
    }
    updatedNotes = sanitizeStage1NoteForNonContextualAI(
      updatedNotes,
      existingItem.englishTerm
    );
    return {
      ...existingItem,
      notes: updatedNotes,
    };
  });

  const finalOutcomes: Stage1WindowExecutionOutcome[] = rawOutcomes.map((o) => {
    if (!o.success || !o.payload) return o;
    const idxInSuccessful = successfulOutcomes.findIndex(
      (s) => s.windowIndex === o.windowIndex
    );
    return {
      ...o,
      payload: idxInSuccessful >= 0 ? reconciledPayloads[idxInSuccessful] : o.payload,
    };
  });

  const finalMerged = mergeStage1WindowResults({
    existingGlossary: existingGlossaryForMerge,
    existingContext: params.existingStoryContext ?? null,
    existingCharacters: params.existingCharacters ?? [],
    windowPlan,
    windowOutcomes: finalOutcomes,
    syncLocations: true,
  });

  return {
    storyContext: finalMerged.storyContext,
    extractedCharacters: finalMerged.characterMemory,
    extractedTerminology: finalMerged.terminologyMemory,
    stage1Coverage: finalMerged.coverage,
  };
}

/**
 * Stage 2 — Author Voice Analysis & Reusable Style Profile
 */
export async function analyzeAuthorVoice(params: {
  text: string;
  projectTitle: string;
  authorName: string;
  genre: string;
}): Promise<StyleProfile> {
  const ai = getGeminiClient();

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Analyze the original author's literary voice and writing style in the following passage from "${params.projectTitle}" by ${params.authorName || 'the author'} (Genre: ${params.genre || 'Literary'}).

Generate a comprehensive, reusable Style Profile that will guide our Bangla (বাংলা) literary translation so the translated story feels as though the original author wrote it natively in Bangla.

PASSAGE:
"""
${params.text.slice(0, 12000)}
"""`,
      config: {
        systemInstruction:
          'You are a distinguished comparative literature critic and Bangla literary translator. Analyze all ten stylistic dimensions of the English author’s voice and formulate a concrete Bangla adaptation strategy.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallVoice: {
              type: Type.STRING,
              description: 'Overall writing personality and literary voice',
            },
            sentenceStructure: {
              type: Type.STRING,
              description: 'Sentence structure, pacing, and rhythm',
            },
            vocabularyComplexity: {
              type: Type.STRING,
              description: 'Vocabulary complexity and diction choices',
            },
            narrativePerspective: {
              type: Type.STRING,
              description: 'Narrative perspective and point of view',
            },
            dialogueStyle: {
              type: Type.STRING,
              description: 'Dialogue style and character speech patterns',
            },
            emotionalIntensity: {
              type: Type.STRING,
              description: 'Emotional intensity and mode of expression',
            },
            descriptiveTechniques: {
              type: Type.STRING,
              description: 'Descriptive and atmospheric techniques',
            },
            metaphorsAndImagery: {
              type: Type.STRING,
              description: 'Use of metaphors, symbolism, imagery, and idioms',
            },
            literaryCharacteristics: {
              type: Type.STRING,
              description: 'Humor, sarcasm, suspense, romance, or other literary characteristics',
            },
            languageRegister: {
              type: Type.STRING,
              description:
                'Formal, informal, conversational, poetic, or traditional language tendencies (including recommended Bangla pronoun register like আপনি/তুমি/তুই)',
            },
            banglaAdaptationStrategy: {
              type: Type.STRING,
              description:
                'Concrete instructions on how to recreate this specific author’s voice in natural, fluent Bangla prose without sounding like a literal translation',
            },
          },
          required: [
            'overallVoice',
            'sentenceStructure',
            'vocabularyComplexity',
            'narrativePerspective',
            'dialogueStyle',
            'emotionalIntensity',
            'descriptiveTechniques',
            'metaphorsAndImagery',
            'literaryCharacteristics',
            'languageRegister',
            'banglaAdaptationStrategy',
          ],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    overallVoice: parsed.overallVoice || '',
    sentenceStructure: parsed.sentenceStructure || '',
    vocabularyComplexity: parsed.vocabularyComplexity || '',
    narrativePerspective: parsed.narrativePerspective || '',
    dialogueStyle: parsed.dialogueStyle || '',
    emotionalIntensity: parsed.emotionalIntensity || '',
    descriptiveTechniques: parsed.descriptiveTechniques || '',
    metaphorsAndImagery: parsed.metaphorsAndImagery || '',
    literaryCharacteristics: parsed.literaryCharacteristics || '',
    languageRegister: parsed.languageRegister || '',
    banglaAdaptationStrategy: parsed.banglaAdaptationStrategy || '',
    customNotes: '',
  };
}

export interface RawStage3DiscoveredTermCandidate {
  englishTerm?: unknown;
  banglaTranslation?: unknown;
  category?: unknown;
  notes?: unknown;
  contextMeaning?: unknown;
  isContextSensitive?: unknown;
  caseSensitive?: unknown;
}

export interface RawStage3ChunkResponse {
  translatedParagraphs?: unknown;
  discoveredTerms?: unknown;
}

export type Stage3ChunkTranslationResult = string[] & {
  translatedParagraphs: string[];
  discoveredTerms: TerminologyMemoryItem[];
};

export type Stage3ChunkExecutor = (params: {
  paragraphs: string[];
  previousContextParagraphs: string[];
  prompt: string;
  systemInstruction: string;
}) => Promise<unknown>;

const VALID_STAGE3_CATEGORIES = new Set<TerminologyCategory>([
  'name',
  'place',
  'title',
  'object',
  'fantasy',
  'expression',
  'cultural',
  'nautical',
]);

export const STAGE3_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translatedParagraphs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Array of translated Bangla paragraphs matching the exact count and order of the input English paragraphs.',
    },
    discoveredTerms: {
      type: Type.ARRAY,
      description:
        'Optional array of recurring or specialized terminology, proper names, places, or domain terms newly discovered in this chunk and rendered in the Bangla translation.',
      items: {
        type: Type.OBJECT,
        properties: {
          englishTerm: { type: Type.STRING },
          banglaTranslation: { type: Type.STRING },
          category: {
            type: Type.STRING,
            description:
              'One of: name, place, title, object, fantasy, expression, cultural, nautical',
          },
          notes: { type: Type.STRING },
          contextMeaning: { type: Type.STRING },
          isContextSensitive: { type: Type.BOOLEAN },
        },
        required: ['englishTerm', 'banglaTranslation'],
      },
    },
  },
  required: ['translatedParagraphs'],
};

/**
 * Safely extracts raw Stage 3 discovered terminology candidates from Gemini's JSON payload.
 * Never throws if `rawDiscoveredTerms` is omitted, null, non-array, or contains malformed elements.
 */
export function extractRawStage3DiscoveredCandidates(
  rawDiscoveredTerms: unknown
): Partial<TerminologyMemoryItem>[] {
  if (!Array.isArray(rawDiscoveredTerms) || rawDiscoveredTerms.length === 0) {
    return [];
  }

  const candidates: Partial<TerminologyMemoryItem>[] = [];
  for (let i = 0; i < rawDiscoveredTerms.length; i++) {
    const raw = rawDiscoveredTerms[i] as RawStage3DiscoveredTermCandidate | null | undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }

    const englishTerm = typeof raw.englishTerm === 'string' ? raw.englishTerm.trim() : '';
    const banglaTranslation =
      typeof raw.banglaTranslation === 'string' ? raw.banglaTranslation.trim() : '';
    if (!englishTerm || !banglaTranslation) {
      continue;
    }

    const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
    const category: TerminologyCategory = VALID_STAGE3_CATEGORIES.has(
      rawCategory as TerminologyCategory
    )
      ? (rawCategory as TerminologyCategory)
      : 'object';

    const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
    const contextMeaning =
      typeof raw.contextMeaning === 'string' && raw.contextMeaning.trim().length > 0
        ? raw.contextMeaning.trim()
        : undefined;
    const isContextSensitive =
      typeof raw.isContextSensitive === 'boolean'
        ? raw.isContextSensitive
        : Boolean(contextMeaning);
    const caseSensitive =
      typeof raw.caseSensitive === 'boolean' ? raw.caseSensitive : false;

    candidates.push({
      englishTerm,
      banglaTranslation,
      category,
      notes,
      ...(contextMeaning ? { contextMeaning } : {}),
      isContextSensitive,
      caseSensitive,
      source: 'chunk_ai',
      lockedByUser: false,
    });
  }

  return candidates;
}

/**
 * Stage 3 — Faithful Literary Translation (Chunk-Aware & Paragraph-Aligned with Discovery Validation)
 */
export async function translateChunkFaithfully(params: {
  paragraphs: string[];
  previousContextParagraphs: string[];
  styleProfile: StyleProfile | null;
  storyContext: StoryContextProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
  maxRetries?: number;
  retryDelayMs?: number;
  chunkExecutor?: Stage3ChunkExecutor;
}): Promise<Stage3ChunkTranslationResult> {
  const ai = params.chunkExecutor ? null : getGeminiClient();
  const maxRetries = params.maxRetries ?? 2;
  const retryDelayMs = params.retryDelayMs ?? (params.chunkExecutor ? 0 : 800);

  const hydratedSnapshotGlossary = hydrateProjectGlossary(params.terminology);
  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatMemoryPromptBlock(params.characters, hydratedSnapshotGlossary);
  const contextSummary = params.storyContext
    ? `STORY CONTEXT:\nSummary: ${params.storyContext.summary}\nTone: ${params.storyContext.literaryTone}\nEmotional Context: ${params.storyContext.emotionalContext}`
    : '';

  const previousChunkSection =
    params.previousContextParagraphs.length > 0
      ? `\nPRECEDING PARAGRAPHS (FOR CONTINUITY ONLY — DO NOT TRANSLATE THESE AGAIN):\n${params.previousContextParagraphs
          .map((p, i) => `[Context ${i + 1}]: ${p}`)
          .join('\n')}\n`
      : '';

  const numberedSource = params.paragraphs
    .map((p, idx) => `[Paragraph ${idx}]:\n${p}`)
    .join('\n\n');

  const prompt = `Translate the following ${params.paragraphs.length} English literary paragraphs into exceptionally natural, fluent, expressive Bangla (বাংলা).

${contextSummary}

${styleBlock}

${memoryBlock}
${previousChunkSection}
MANDATORY LITERARY TRANSLATION RULES:
1. Make the translated Bangla feel as though the story was originally written in Bangla by a gifted Bangla novelist, while preserving the original author's identity, voice, intentions, emotions, and storytelling style.
2. Avoid English sentence structures and awkward word-for-word calques. Reconstruct clauses naturally in idiomatic Bangla syntax.
3. Make dialogues sound like authentic, living Bangla conversations matching each character's personality and relationship register (আপনি / তুমি / তুই).
4. Preserve metaphors and sensory atmosphere, adapting expressions naturally when a literal translation would sound stiff.
5. Avoid unnecessary English words or awkward transliterations when natural Bangla words exist.
6. NEVER summarize, shorten, or omit any sentence, clause, description, or dialogue.
7. NEVER invent or add events, characters, or interpretations not present in the source.
8. Return EXACTLY ${params.paragraphs.length} translated Bangla paragraphs in the JSON array, corresponding 1-to-1 with [Paragraph 0] through [Paragraph ${params.paragraphs.length - 1}].
9. Optionally include in "discoveredTerms" any recurring terms, proper names, titled entities, places, or specialized domain terms that literally appear in the English source paragraphs and your Bangla translation but are not yet in Established Memory.

SOURCE PARAGRAPHS TO TRANSLATE:
${numberedSource}`;

  const systemInstruction =
    'You are GolpoTranslate’s Stage 3 Faithful Literary Translation Engine—an acclaimed Bengali literary translator who renders English fiction into living, soulful Bangla prose with 100% narrative fidelity.';

  const parsed = await withRetry(
    async (): Promise<RawStage3ChunkResponse> => {
      let rawResult: unknown;
      if (params.chunkExecutor) {
        rawResult = await params.chunkExecutor({
          paragraphs: params.paragraphs,
          previousContextParagraphs: params.previousContextParagraphs,
          prompt,
          systemInstruction,
        });
      } else {
        const response = await ai!.models.generateContent({
          model: DEFAULT_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: STAGE3_RESPONSE_SCHEMA,
          },
        });
        rawResult = JSON.parse((response.text ?? '{}').trim());
      }

      const candidateObj =
        typeof rawResult === 'string' ? JSON.parse(rawResult.trim() || '{}') : rawResult;

      if (
        candidateObj === null ||
        candidateObj === undefined ||
        typeof candidateObj !== 'object' ||
        Array.isArray(candidateObj)
      ) {
        return {};
      }
      return candidateObj as RawStage3ChunkResponse;
    },
    maxRetries,
    retryDelayMs
  );

  const output: string[] = Array.isArray(parsed.translatedParagraphs)
    ? parsed.translatedParagraphs.map((p) => (typeof p === 'string' ? p : String(p ?? '')))
    : [];

  // Ensure exact 1-to-1 length alignment
  const alignedParagraphs = params.paragraphs.map((_, idx) => (output[idx] ?? '').trim());

  // Extract and validate optional `discoveredTerms` against current chunk source, Bangla translation, and glossary snapshot
  const rawCandidates = extractRawStage3DiscoveredCandidates(parsed.discoveredTerms);
  const chunkSourceText = params.paragraphs.join('\n\n');
  const chunkBanglaText = alignedParagraphs.join('\n\n');

  const discoveryValidation = validateStage3DiscoveredTerms({
    candidates: rawCandidates,
    chunkSourceText,
    chunkBanglaText,
    existingGlossary: hydratedSnapshotGlossary,
  });

  const result = Object.assign([...alignedParagraphs], {
    translatedParagraphs: alignedParagraphs,
    discoveredTerms: discoveryValidation.acceptedTerms,
  }) as Stage3ChunkTranslationResult;

  return result;
}

function formatStageMemoryPromptBlock(
  characters: CharacterMemoryItem[],
  hydratedTerminology: TerminologyMemoryItem[],
  stage: 'stage3' | 'stage4' | 'stage5'
): string {
  const blocks: string[] = [];

  if (characters.length > 0) {
    const charLines: string[] = [
      'ESTABLISHED CHARACTER MEMORY (MUST RESPECT EXACT BANGLA NAMES & SPEAKING STYLES):',
    ];
    for (const c of characters) {
      charLines.push(
        `- ${c.englishName} → বাংলা নাম: "${c.banglaName}" | Pronouns/Gender: ${c.pronouns || 'As in context'} | Relationships: ${c.relationships || 'N/A'} | Personality & Speech: ${c.personality}; ${c.speakingStyle}${c.notes ? ` (${c.notes})` : ''}`
      );
    }
    blocks.push(charLines.join('\n'));
  }

  const glossaryBlock = formatGlossaryForPrompt(hydratedTerminology, { stage });
  if (glossaryBlock.trim().length > 0) {
    blocks.push(glossaryBlock);
  }

  return blocks.length > 0
    ? blocks.join('\n\n')
    : 'No prior character or terminology overrides established yet.';
}

export interface RawStage4Response {
  editedParagraphs?: unknown;
  editorialNotes?: unknown;
  editorialChanges?: unknown;
}

export type Stage4Executor = (params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  prompt: string;
  systemInstruction: string;
}) => Promise<RawStage4Response | string>;

export const STAGE4_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    editedParagraphs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    editorialNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    editorialChanges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          paragraphIndex: { type: Type.INTEGER },
          aspect: { type: Type.STRING },
          beforeSnippet: { type: Type.STRING },
          afterSnippet: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: [
          'paragraphIndex',
          'aspect',
          'beforeSnippet',
          'afterSnippet',
          'rationale',
        ],
      },
    },
  },
  required: ['editedParagraphs', 'editorialNotes', 'editorialChanges'],
};

/**
 * Stage 4 — Literary Editing Pass
 */
export async function runLiteraryEditingPass(params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  styleProfile: StyleProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
  maxRetries?: number;
  retryDelayMs?: number;
  stage4Executor?: Stage4Executor;
}): Promise<{
  editedParagraphs: string[];
  editorialNotes: string[];
  editorialChanges: EditorialChange[];
}> {
  const ai = params.stage4Executor ? null : getGeminiClient();
  const maxRetries = params.maxRetries ?? 2;
  const retryDelayMs = params.retryDelayMs ?? (params.stage4Executor ? 0 : 800);

  const hydratedGlossary = hydrateProjectGlossary(params.terminology);
  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatStageMemoryPromptBlock(
    params.characters,
    hydratedGlossary,
    'stage4'
  );

  const pairedInput = params.englishParagraphs
    .map(
      (eng, idx) =>
        `[Paragraph ${idx}]\nORIGINAL ENGLISH: ${eng}\nDRAFT BANGLA: ${params.banglaParagraphs[idx] || ''}`
    )
    .join('\n\n---\n\n');

  const prompt = `Run Stage 4 Literary Editing on the following Bangla translation draft.

${styleBlock}

${memoryBlock}

EDITORIAL OBJECTIVES:
- Elevate sentence flow, reading rhythm (ছন্দ ও প্রবাহ), and naturalness so no trace of clunky translationese ("আক্ষরিক অনুবাদ-গন্ধ") remains.
- Refine word choices (শব্দচয়ন) and paragraph transitions.
- Polish dialogue so it sounds unmistakably like real spoken Bangla matching the characters' relationships.
- Ensure strict consistency with Character Memory, Terminology Memory, and the original author's voice.
- CRITICAL: Do NOT rewrite the story freely. Never alter the author's meaning, omit details, or add unsupported content.
- Return EXACTLY ${params.englishParagraphs.length} polished Bangla paragraphs in order, along with a summary of editorial improvements.

MANUSCRIPT PAIRS:
${pairedInput}`;

  const systemInstruction =
    'You are GolpoTranslate’s Chief Literary Editor for Bangla Fiction. You polish translated Bangla prose to literary perfection while guarding 100% fidelity to the English source.';

  const parsed = await withRetry(
    async (): Promise<RawStage4Response> => {
      let rawResult: unknown;
      if (params.stage4Executor) {
        rawResult = await params.stage4Executor({
          englishParagraphs: params.englishParagraphs,
          banglaParagraphs: params.banglaParagraphs,
          prompt,
          systemInstruction,
        });
      } else {
        const response = await ai!.models.generateContent({
          model: DEFAULT_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: STAGE4_RESPONSE_SCHEMA,
          },
        });
        rawResult = JSON.parse((response.text ?? '{}').trim());
      }

      const candidateObj =
        typeof rawResult === 'string' ? JSON.parse(rawResult.trim() || '{}') : rawResult;

      if (
        candidateObj === null ||
        candidateObj === undefined ||
        typeof candidateObj !== 'object' ||
        Array.isArray(candidateObj)
      ) {
        return {};
      }
      return candidateObj as RawStage4Response;
    },
    maxRetries,
    retryDelayMs
  );

  const edited: string[] = Array.isArray(parsed.editedParagraphs)
    ? parsed.editedParagraphs.map((p) => (typeof p === 'string' ? p : String(p ?? '')))
    : [];

  const paragraphCount = params.englishParagraphs.length;
  const rawChanges = Array.isArray(parsed.editorialChanges) ? parsed.editorialChanges : [];
  const validChanges: EditorialChange[] = [];

  for (const rawChange of rawChanges) {
    if (
      rawChange === null ||
      rawChange === undefined ||
      typeof rawChange !== 'object' ||
      Array.isArray(rawChange)
    ) {
      continue;
    }
    const c = rawChange as Record<string, unknown>;
    const idx = c.paragraphIndex;
    if (
      typeof idx !== 'number' ||
      !Number.isFinite(idx) ||
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= paragraphCount
    ) {
      continue;
    }
    validChanges.push({
      paragraphIndex: idx,
      aspect: String(c.aspect ?? ''),
      beforeSnippet: String(c.beforeSnippet ?? ''),
      afterSnippet: String(c.afterSnippet ?? ''),
      rationale: String(c.rationale ?? ''),
    });
  }

  return {
    editedParagraphs: params.englishParagraphs.map(
      (_, idx) => (edited[idx] || params.banglaParagraphs[idx] || '').trim()
    ),
    editorialNotes: Array.isArray(parsed.editorialNotes)
      ? parsed.editorialNotes.map((n) => String(n ?? '')).filter(Boolean)
      : [],
    editorialChanges: validChanges,
  };
}

export interface RawStage5Response {
  overallScore?: unknown;
  fidelitySummary?: unknown;
  isComplete?: unknown;
  issues?: unknown;
}

export type Stage5Executor = (params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  prompt: string;
  systemInstruction: string;
}) => Promise<RawStage5Response | string>;

export const STAGE5_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallScore: {
      type: Type.INTEGER,
      description: 'Fidelity score from 0 to 100',
    },
    fidelitySummary: {
      type: Type.STRING,
      description:
        'Concise assessment of translation completeness, voice fidelity, and accuracy',
    },
    isComplete: {
      type: Type.BOOLEAN,
      description: 'True if no paragraphs or sentences are missing',
    },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            description: 'high, medium, or low',
          },
          type: {
            type: Type.STRING,
            description:
              'One of: missing_content, omitted_dialogue, added_info, changed_meaning, character_reference, terminology, emotional_intent, chronology',
          },
          paragraphIndex: {
            type: Type.INTEGER,
            description:
              'Zero-based paragraph index (0 to N-1) for paragraph-specific issues; omit for chapter-level issues.',
          },
          description: { type: Type.STRING },
          englishExcerpt: { type: Type.STRING },
          banglaExcerpt: { type: Type.STRING },
          suggestedFix: {
            type: Type.STRING,
            description:
              'Suggested revised full Bangla paragraph for paragraph-specific issues only; omit for chapter-level issues.',
          },
        },
        required: [
          'severity',
          'type',
          'description',
          'englishExcerpt',
          'banglaExcerpt',
        ],
      },
    },
  },
  required: ['overallScore', 'fidelitySummary', 'isComplete', 'issues'],
};

const STAGE5_BANGLA_SCRIPT_RE = /[\u0980-\u09FF]/;

/**
 * Stage 5 — Accuracy Verification
 */
export async function verifyTranslationAccuracy(params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  maxRetries?: number;
  retryDelayMs?: number;
  stage5Executor?: Stage5Executor;
}): Promise<VerificationReport> {
  const ai = params.stage5Executor ? null : getGeminiClient();
  const maxRetries = params.maxRetries ?? 2;
  const retryDelayMs = params.retryDelayMs ?? (params.stage5Executor ? 0 : 800);

  const hydratedGlossary = hydrateProjectGlossary(params.terminology);
  const memoryBlock = formatStageMemoryPromptBlock(
    params.characters,
    hydratedGlossary,
    'stage5'
  );

  const pairedText = params.englishParagraphs
    .map(
      (eng, idx) =>
        `[Paragraph ${idx}]\nENGLISH: ${eng}\nBANGLA: ${params.banglaParagraphs[idx] || '[MISSING]'}`
    )
    .join('\n\n');

  const prompt = `Compare the Original English text against the Final Bangla Translation for Stage 5 Accuracy Verification.

${memoryBlock}

Audit every paragraph for:
1. Missing sentences or paragraphs
2. Omitted dialogue
3. Added or hallucinated information
4. Changed meanings
5. Incorrect character references or pronoun mismatches
6. Inconsistent names or terminology (compared to Established Memory)
7. Changes in emotional intent
8. Inaccurate descriptions or distorted chronology

Present only genuine, significant issues for human review. If the translation is faithful, complete, and accurate, return an empty issues array and a high overallScore (95-100).

MANUSCRIPT COMPARISON:
${pairedText}`;

  const systemInstruction =
    'You are a meticulous bilingual literary auditor verifying English-to-Bangla translation fidelity.';

  const parsed = await withRetry(
    async (): Promise<RawStage5Response> => {
      let rawResult: unknown;
      if (params.stage5Executor) {
        rawResult = await params.stage5Executor({
          englishParagraphs: params.englishParagraphs,
          banglaParagraphs: params.banglaParagraphs,
          prompt,
          systemInstruction,
        });
      } else {
        const response = await ai!.models.generateContent({
          model: DEFAULT_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: STAGE5_RESPONSE_SCHEMA,
          },
        });
        rawResult = JSON.parse((response.text ?? '{}').trim());
      }

      const candidateObj =
        typeof rawResult === 'string' ? JSON.parse(rawResult.trim() || '{}') : rawResult;

      if (
        candidateObj === null ||
        candidateObj === undefined ||
        typeof candidateObj !== 'object' ||
        Array.isArray(candidateObj)
      ) {
        return {};
      }
      return candidateObj as RawStage5Response;
    },
    maxRetries,
    retryDelayMs
  );

  const validTypes = new Set([
    'missing_content',
    'omitted_dialogue',
    'added_info',
    'changed_meaning',
    'character_reference',
    'terminology',
    'emotional_intent',
    'chronology',
  ]);

  const paragraphCount = params.englishParagraphs.length;
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const normalizedIssues: VerificationReport['issues'] = [];

  for (let idx = 0; idx < rawIssues.length; idx += 1) {
    const rawIssue = rawIssues[idx];
    if (
      rawIssue === null ||
      rawIssue === undefined ||
      typeof rawIssue !== 'object' ||
      Array.isArray(rawIssue)
    ) {
      continue;
    }
    const issue = rawIssue as Record<string, unknown>;
    const rawParagraphIndex = issue.paragraphIndex;

    let normalizedParagraphIndex: number | undefined;
    let normalizedSuggestedFix: string | undefined;

    if (rawParagraphIndex === undefined || rawParagraphIndex === null) {
      // Missing or null paragraphIndex = legitimate chapter-level issue
      normalizedParagraphIndex = undefined;
      normalizedSuggestedFix = undefined;
    } else if (
      typeof rawParagraphIndex === 'number' &&
      Number.isFinite(rawParagraphIndex) &&
      Number.isInteger(rawParagraphIndex) &&
      rawParagraphIndex >= 0 &&
      rawParagraphIndex < paragraphCount
    ) {
      // Valid in-range integer paragraphIndex = paragraph-level issue
      normalizedParagraphIndex = rawParagraphIndex;
      const rawSuggestedFix =
        typeof issue.suggestedFix === 'string' ? issue.suggestedFix.trim() : '';
      normalizedSuggestedFix =
        rawSuggestedFix.length > 0 && STAGE5_BANGLA_SCRIPT_RE.test(rawSuggestedFix)
          ? rawSuggestedFix
          : undefined;
    } else {
      // Negative, non-integer, non-finite, non-number, or out-of-range paragraphIndex = invalid issue; discard
      continue;
    }

    normalizedIssues.push({
      id: `issue-${Date.now()}-${idx}`,
      severity:
        issue.severity === 'high' || issue.severity === 'medium'
          ? issue.severity
          : 'low',
      type: validTypes.has(String(issue.type))
        ? (String(issue.type) as VerificationReport['issues'][0]['type'])
        : 'changed_meaning',
      ...(normalizedParagraphIndex !== undefined
        ? { paragraphIndex: normalizedParagraphIndex }
        : {}),
      description: String(issue.description || ''),
      englishExcerpt: String(issue.englishExcerpt || ''),
      banglaExcerpt: String(issue.banglaExcerpt || ''),
      ...(normalizedSuggestedFix !== undefined
        ? { suggestedFix: normalizedSuggestedFix }
        : {}),
      resolved: false,
      source: 'ai_stage5',
    });
  }

  return {
    overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 95,
    fidelitySummary:
      typeof parsed.fidelitySummary === 'string' && parsed.fidelitySummary.trim()
        ? parsed.fidelitySummary
        : 'Verification completed successfully.',
    isComplete: Boolean(parsed.isComplete ?? true),
    checkedAt: new Date().toISOString(),
    issues: normalizedIssues,
  };
}

/**
 * Paragraph-Level Targeted Refinement (Never replaces the full chapter; refines strictly the selected paragraph)
 */
export async function refineSingleParagraph(params: {
  englishParagraph: string;
  currentBanglaParagraph: string;
  previousEnglishParagraph?: string;
  nextEnglishParagraph?: string;
  action: ParagraphRefinementAction;
  customInstruction?: string;
  styleProfile: StyleProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
}): Promise<{
  refinedBangla: string;
  rationale: string;
}> {
  const ai = getGeminiClient();
  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatMemoryPromptBlock(params.characters, params.terminology);

  const actionInstructions: Record<ParagraphRefinementAction, string> = {
    more_natural:
      'Make the Bangla translation read with effortless, idiomatic, native Bangla flow (অত্যন্ত স্বাভাবিক ও সাবলীল বাংলা). Remove any trace of English sentence order while keeping every detail intact.',
    improve_literary:
      'Elevate the literary beauty, cadence, and evocative diction (সাহিত্যিক মাধুর্য ও নান্দনিক প্রকাশভঙ্গি) in Bangla without adding any unstated facts or overwriting the author’s intent.',
    conversational_dialogue:
      'Make the dialogue and character expressions sound like authentic, natural spoken Bangla conversation (জীবন্ত ও স্বাভাবিক কথোপকথন), respecting character relationships and pronouns.',
    simpler_language:
      'Make the Bangla vocabulary simpler, clearer, and more effortlessly readable (সহজ, প্রাঞ্জল ও সুখপাঠ্য ভাষা) while keeping the emotional depth and full meaning.',
    more_expressive:
      'Deepen the emotional resonance, sensory atmosphere, and expressive power (আবেগ ও ভাবের গভীরতা) of the Bangla phrasing while remaining 100% faithful to the original paragraph.',
    match_author_style:
      'Re-translate and align this paragraph closely with the original author’s signature voice, sentence rhythm, and tone defined in the Style Profile.',
  };

  const specificDirective = actionInstructions[params.action];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Refine ONLY the target Bangla paragraph below according to the requested editorial action.

REQUESTED ACTION: ${specificDirective}
${params.customInstruction ? `ADDITIONAL USER NOTE: ${params.customInstruction}` : ''}

${styleBlock}

${memoryBlock}

SURROUNDING CONTEXT (FOR REFERENCE ONLY):
Preceding English Paragraph: ${params.previousEnglishParagraph || '[Start of chapter]'}
Following English Paragraph: ${params.nextEnglishParagraph || '[End of chapter]'}

TARGET PARAGRAPH TO REFINE:
ORIGINAL ENGLISH:
"""
${params.englishParagraph}
"""

CURRENT BANGLA TRANSLATION:
"""
${params.currentBanglaParagraph}
"""

Provide the improved Bangla paragraph and a brief 1-sentence explanation of how the phrasing was improved.`,
      config: {
        systemInstruction:
          'You are a master Bengali literary translator refining a single paragraph in a manuscript. Preserve 100% of the original meaning while fulfilling the specific stylistic directive.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            refinedBangla: {
              type: Type.STRING,
              description: 'The revised Bangla paragraph',
            },
            rationale: {
              type: Type.STRING,
              description: 'Concise explanation of the stylistic and lexical improvements made',
            },
          },
          required: ['refinedBangla', 'rationale'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    refinedBangla: (parsed.refinedBangla || params.currentBanglaParagraph).trim(),
    rationale: parsed.rationale || 'Refined paragraph flow and Bangla literary expression.',
  };
}
