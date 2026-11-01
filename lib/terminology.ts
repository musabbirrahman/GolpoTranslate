import type {
  ParagraphPair,
  TerminologyCategory,
  TerminologyFindingClassification,
  TerminologyFindingReason,
  TerminologyLintFinding,
  TerminologyMemoryItem,
  TerminologySource,
  VerificationIssue,
} from './types';

const VALID_CATEGORIES: ReadonlySet<TerminologyCategory> = new Set<TerminologyCategory>([
  'name',
  'place',
  'title',
  'object',
  'nautical',
  'cultural',
  'fantasy',
  'expression',
]);

const VALID_SOURCES: ReadonlySet<TerminologySource> = new Set<TerminologySource>([
  'stage1_ai',
  'chunk_ai',
  'user',
  'location_sync',
]);

/**
 * Categories representing proper names, named locations/rooms, or structural titles
 * where literal target presence is expected rather than open-ended literary paraphrase.
 */
const STRICT_IDENTITY_CATEGORIES: ReadonlySet<TerminologyCategory> = new Set<TerminologyCategory>([
  'name',
  'place',
  'title',
]);

/**
 * Closed whitelist of grammatical Bangla nominal suffixes (classifiers, plurals, and case endings).
 * Separated by phonological stem compatibility to prevent overly broad prefix matching.
 */
const UNIVERSAL_BANGLA_NOMINAL_SUFFIXES: ReadonlySet<string> = new Set<string>(
  [
    // Definite classifiers & inflected classifiers
    'টি',
    'টা',
    'টির',
    'টার',
    'টিকে',
    'টাকে',
    'টিতে',
    'টাতে',
    'টায়',
    'টিও',
    'টিই',
    'টাও',
    'টাই',
    'টিরও',
    'টারও',
    'টিতেও',
    'টাতেও',
    'খানা',
    'খানি',
    'খানার',
    'খানির',
    'খানাকে',
    'খানিকে',
    'খানাতে',
    'খানিতে',
    'খানায়',
    'খানাও',
    'খানিও',
    // Plural markers & inflected plurals
    'গুলো',
    'গুলি',
    'গুলোর',
    'গুলির',
    'গুলোকে',
    'গুলিকে',
    'গুলোতে',
    'গুলিতে',
    'গুলোয়',
    'গুলোও',
    'গুলোই',
    'গুলিও',
    'গুলিই',
    'গুলোরও',
    'গুলোতেও',
    'সমূহ',
    'সমূহের',
    'দের',
    'দেরকে',
    'দেরও',
    // General case markers valid across vowel/consonant stems
    'কে',
    'কেও',
    'কেই',
    'তে',
    'তেও',
    'তেই',
    'রে',
  ].map((s) => s.normalize('NFC'))
);

/**
 * Suffixes beginning with dependent vowel sign ে (\u09C7) that only attach to consonant-ending stems
 * (e.g., দীপকক্ষ -> দীপকক্ষে, দীপকক্ষের; স্কুল -> স্কুলে, স্কুলের; দর্পণ -> দর্পণে, দর্পণের).
 */
const CONSONANT_STEM_ONLY_SUFFIXES: ReadonlySet<string> = new Set<string>(
  [
    'ে',
    'ের',
    'েতে',
    'েও',
    'েই',
    'েরও',
    'েরই',
    'েতেও',
    'েতেই',
  ].map((s) => s.normalize('NFC'))
);

/**
 * Suffixes that only attach directly to vowel-ending stems
 * (e.g., নৌকা -> নৌকার, নৌকায়; আয়না -> আয়নার, আয়নায়; পাঠশালা -> পাঠশালার, পাঠশালায়).
 */
const VOWEL_STEM_ONLY_SUFFIXES: ReadonlySet<string> = new Set<string>(
  [
    'র',
    'য়',
    'য়ে',
    'য়ের',
    'রও',
    'রই',
    'য়ও',
    'য়ই',
    'য়েও',
    'য়েরও',
  ].map((s) => s.normalize('NFC'))
);

/**
 * Curated literary synonym/drift clusters in Bangla keyed by canonical lowercase English head terms
 * and reciprocal Bangla forms. Used to distinguish definite lexical drift (e.g. আয়না vs দর্পণ,
 * দীপকক্ষ vs লণ্ঠন কক্ষ, নৌকা vs জাহাজ/জলযান) from legitimate literary paraphrasing or pronoun ellipsis.
 */
const KNOWN_EQUIVALENT_CLUSTERS: ReadonlyArray<{
  englishKeys: string[];
  banglaVariants: string[];
}> = [
  {
    englishKeys: ['lantern room', 'lantern-room', 'light room'],
    banglaVariants: ['দীপকক্ষ', 'লণ্ঠন কক্ষ', 'লণ্ঠন-কক্ষ', 'লণ্ঠনকক্ষ', 'বাতিঘর কক্ষ', 'আলোককক্ষ', 'বাতিঘরের কক্ষ'],
  },
  {
    englishKeys: ['boat', 'boats', 'skiff', 'vessel', 'craft'],
    banglaVariants: ['নৌকা', 'নৌকো', 'তরী', 'ডিঙি', 'জাহাজ', 'জলযান', 'তরণী', 'ভেলা'],
  },
  {
    englishKeys: ['mirror', 'mirrors', 'looking-glass', 'looking glass'],
    banglaVariants: ['আয়না', 'দর্পণ', 'মুকুর', 'আরশি'],
  },
  {
    englishKeys: ['chapter', 'chapters'],
    banglaVariants: ['অধ্যায়', 'পরিচ্ছেদ', 'পর্ব'],
  },
  {
    englishKeys: ['school', 'schools', 'schoolhouse'],
    banglaVariants: ['পাঠশালা', 'স্কুল', 'বিদ্যালয়', 'বিদ্যাপীঠ', 'মক্তব'],
  },
  {
    englishKeys: ['lighthouse', 'lighthouses', 'beacon tower'],
    banglaVariants: ['বাতিঘর', 'আলোকস্তম্ভ', 'দীপস্তম্ভ', 'বাতি-ঘর'],
  },
  {
    englishKeys: ['keeper', 'keepers', 'watchman', 'custodian'],
    banglaVariants: ['প্রহরী', 'রক্ষক', 'তত্ত্বাবধায়ক', 'দেখভালকারী', 'বাতিওয়ালা', 'বাতিওয়ালা'],
  },
  {
    englishKeys: ['lantern', 'lanterns', 'lamp', 'lamps'],
    banglaVariants: ['লণ্ঠন', 'দীপ', 'প্রদীপ', 'বাতি', 'হারিকেন'],
  },
  {
    englishKeys: ['harbor', 'harbour', 'port', 'quay', 'jetty'],
    banglaVariants: ['বন্দর', 'পোতাশ্রয়', 'ঘাট', 'জেটি'],
  },
  {
    englishKeys: ['window', 'windows', 'casement'],
    banglaVariants: ['জানালা', 'জানলা', 'গবাক্ষ', 'খিড়কি'],
  },
  {
    englishKeys: ['sea', 'ocean', 'waters'],
    banglaVariants: ['সমুদ্র', 'সাগর', 'দরিয়া', 'মহাসাগর', 'সিন্ধু'],
  },
  {
    englishKeys: ['letter', 'letters', 'epistle'],
    banglaVariants: ['চিঠি', 'পত্র', 'লিপি'],
  },
  {
    englishKeys: ['book', 'books', 'volume', 'tome'],
    banglaVariants: ['বই', 'গ্রন্থ', 'পুস্তক', 'কিতাব'],
  },
  {
    englishKeys: ['room', 'rooms', 'chamber', 'chambers'],
    banglaVariants: ['কক্ষ', 'ঘর', 'প্রকোষ্ঠ', 'কামরা'],
  },
  {
    englishKeys: ['watercraft'],
    banglaVariants: ['জলযান', 'নৌযান', 'নৌকা', 'জাহাজ', 'তরী'],
  },
];

/**
 * English nouns ending in -s or -ies that are invariant between singular and plural.
 */
const INVARIANT_S_WORDS: ReadonlySet<string> = new Set<string>([
  'series',
  'species',
  'means',
  'headquarters',
  'crossroads',
  'barracks',
  'corps',
  'debris',
  'chassis',
  'rendezvous',
  'apparatus',
  'news',
  'shambles',
  'gallows',
]);

/**
 * Singular English nouns ending in a single -s that form their regular plural with -es
 * (e.g., lens <-> lenses, bus <-> buses, atlas <-> atlases).
 */
const SINGULAR_S_TAKING_ES: ReadonlySet<string> = new Set<string>([
  'lens',
  'bus',
  'gas',
  'atlas',
  'iris',
  'canvas',
  'chorus',
  'focus',
  'bias',
  'alias',
  'trellis',
  'dais',
  'isthmus',
  'pelvis',
  'lotus',
  'caucus',
  'crocus',
  'sinus',
  'prospectus',
  'bolus',
  'callus',
  'stylus',
]);

/**
 * Proper names and singular words ending in -s that must not have their final -s stripped into a bogus stem.
 */
const SINGULAR_PROPER_OR_FIXED_S_WORDS: ReadonlySet<string> = new Set<string>([
  'charles',
  'james',
  'holmes',
  'dickens',
  'brooks',
  'lucas',
  'thomas',
  'jules',
  'giles',
  'miles',
  'wales',
  'thames',
  'athens',
  'naples',
  'paris',
  'marseilles',
  'flanders',
  'wells',
  'adams',
  'collins',
  'evans',
  'harris',
  'hughes',
  'jenkins',
  'jones',
  'lewis',
  'morris',
  'phillips',
  'roberts',
  'rogers',
  'ross',
  'stevens',
  'williams',
  'burns',
  'bates',
  'keats',
  'yeats',
  'marcus',
  'julius',
  'augustus',
  'silas',
  'tobias',
  'matthias',
  'jonas',
  'elias',
  'amos',
  'moses',
  'achilles',
  'socrates',
  'hercules',
  'chaos',
  'cosmos',
  'ethos',
  'pathos',
  'aegis',
  'genesis',
  'nemesis',
  'metropolis',
  'acropolis',
]);

export interface EnglishTermMatchSpan {
  start: number;
  end: number;
  matchedText: string;
}

export interface GlossaryEnglishMatchResult {
  item: TerminologyMemoryItem;
  occurrences: EnglishTermMatchSpan[];
}

export interface BanglaTermMatchSpan {
  start: number;
  end: number;
  matchedText: string;
  baseTerm: string;
  suffix: string;
}

export interface ChunkGlossaryFilterOptions {
  previousContextParagraphs?: string[];
  includeLockedGlobalTerms?: boolean;
  includeCharacterAndPlaceNames?: boolean;
  maxGlobalTerms?: number;
}

export interface FilteredChunkGlossary {
  matchedTerms: TerminologyMemoryItem[];
  supplementalGlobalTerms: TerminologyMemoryItem[];
  activeTerms: TerminologyMemoryItem[];
}

export interface MergeGlossaryOptions {
  defaultSource?: TerminologySource;
}

export interface ParagraphLintOptions {
  /**
   * Optional set of term IDs that have been literally established (using preferred or accepted Bangla)
   * in other paragraphs of the same chapter. Used during chapter-level linting.
   */
  establishedTermIdsInChapter?: ReadonlySet<string>;
}

export interface ParagraphTerminologyLintResult {
  paragraphIndex: number;
  findings: TerminologyLintFinding[];
  matchedTermIds: string[];
  satisfiedTermIds: string[];
  acceptedVariantTermIds: string[];
  paraphrasedOrOmittedTermIds: string[];
}

export interface ChapterLintOptions {
  includeContextualReview?: boolean;
}

export interface ChapterTerminologyLintResult {
  findings: TerminologyLintFinding[];
  issues: VerificationIssue[];
  paragraphResults: ParagraphTerminologyLintResult[];
  summary: {
    totalParagraphsChecked: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
    definiteViolationCount: number;
    contextualReviewCount: number;
    satisfiedOccurrencesCount: number;
    acceptedVariantOccurrencesCount: number;
    paraphrasedCount: number;
  };
}

/**
 * Normalizes Bangla Unicode strings consistently:
 * 1. Applies NFC normalization (canonicalizing decomposed/precomposed sequences consistently).
 * 2. Removes zero-width joiners/non-joiners/BOM for deterministic comparison.
 * 3. Collapses repeated whitespace and trims.
 */
export function normalizeBanglaUnicode(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes an English term or phrase by normalizing apostrophes/quotes,
 * collapsing internal whitespace, and trimming.
 */
export function normalizeEnglishTerm(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidTerminologyCategory(value: unknown): value is TerminologyCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value as TerminologyCategory);
}

export function isValidTerminologySource(value: unknown): value is TerminologySource {
  return typeof value === 'string' && VALID_SOURCES.has(value as TerminologySource);
}

function deduplicateBanglaList(
  items: unknown,
  excludeNormalized: ReadonlySet<string> = new Set()
): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>(excludeNormalized);
  const result: string[] = [];

  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizeBanglaUnicode(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * Normalizes a partial or legacy TerminologyMemoryItem into a complete, backward-compatible
 * TerminologyMemoryItem with safe defaults.
 */
export function normalizeTerminologyItem(
  raw: Partial<TerminologyMemoryItem>,
  fallbackIndex = 0
): TerminologyMemoryItem {
  const englishTerm = normalizeEnglishTerm(raw.englishTerm ?? '');
  const banglaTranslation = normalizeBanglaUnicode(raw.banglaTranslation ?? '');
  const category: TerminologyCategory = isValidTerminologyCategory(raw.category)
    ? raw.category
    : 'object';

  const primarySet = new Set<string>(banglaTranslation ? [banglaTranslation] : []);
  const acceptedAlternatives = deduplicateBanglaList(raw.acceptedAlternatives, primarySet);

  const preferredAndAcceptedSet = new Set<string>([
    ...primarySet,
    ...acceptedAlternatives,
  ]);
  const avoidTranslations = deduplicateBanglaList(
    raw.avoidTranslations,
    preferredAndAcceptedSet
  );

  const lockedByUser =
    typeof raw.lockedByUser === 'boolean'
      ? raw.lockedByUser
      : raw.source === 'user';

  const source: TerminologySource = isValidTerminologySource(raw.source)
    ? raw.source
    : lockedByUser
      ? 'user'
      : 'stage1_ai';

  const contextMeaningRaw =
    typeof raw.contextMeaning === 'string' ? raw.contextMeaning.trim() : '';
  const banglaStemRaw =
    typeof raw.banglaStem === 'string' ? normalizeBanglaUnicode(raw.banglaStem) : '';

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `term-${fallbackIndex}-${englishTerm.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'item'}`,
    englishTerm,
    banglaTranslation,
    acceptedAlternatives,
    avoidTranslations,
    category,
    ...(contextMeaningRaw ? { contextMeaning: contextMeaningRaw } : {}),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    caseSensitive: Boolean(raw.caseSensitive),
    isContextSensitive: Boolean(raw.isContextSensitive),
    ...(banglaStemRaw ? { banglaStem: banglaStemRaw } : {}),
    allowInflections:
      typeof raw.allowInflections === 'boolean' ? raw.allowInflections : true,
    source,
    lockedByUser,
  };
}

/**
 * Determines whether two glossary items represent the same lookup key,
 * accounting for case-sensitivity and distinct contextual homonyms.
 */
function isSameGlossaryEntryKey(
  a: TerminologyMemoryItem,
  b: TerminologyMemoryItem
): boolean {
  const eitherCaseSensitive = Boolean(a.caseSensitive || b.caseSensitive);
  const sameEnglish = eitherCaseSensitive
    ? a.englishTerm === b.englishTerm
    : a.englishTerm.toLowerCase() === b.englishTerm.toLowerCase();

  if (!sameEnglish) return false;

  const aContext = (a.contextMeaning ?? '').trim().toLowerCase();
  const bContext = (b.contextMeaning ?? '').trim().toLowerCase();

  // If both entries provide distinct non-empty contextMeaning descriptions,
  // allow them to coexist as separate contextual homonyms.
  if (aContext && bContext && aContext !== bContext) {
    return false;
  }

  // If either entry is explicitly marked context-sensitive (or provides a distinct contextMeaning)
  // and they have different primary translations alongside different contextMeaning states, preserve both.
  if (
    (a.isContextSensitive || b.isContextSensitive || Boolean(aContext) !== Boolean(bContext)) &&
    a.banglaTranslation !== b.banglaTranslation &&
    aContext !== bContext
  ) {
    return false;
  }

  return true;
}

/**
 * Recognizes whether an incoming glossary item/update represents a deliberate user action
 * (including manual creation, manual locking, or an explicit user unlock with `lockedByUser: false`),
 * as opposed to an automated AI extraction/discovery (`stage1_ai`, `chunk_ai`, `location_sync`).
 */
export function isDeliberateUserUpdate(
  current: TerminologyMemoryItem,
  rawIncoming: Partial<TerminologyMemoryItem>,
  effectiveSource?: TerminologySource
): boolean {
  const resolvedSource: TerminologySource | undefined = isValidTerminologySource(
    rawIncoming.source
  )
    ? rawIncoming.source
    : effectiveSource;

  if (resolvedSource === 'user') {
    return true;
  }

  const hasExplicitAiSource =
    resolvedSource === 'stage1_ai' ||
    resolvedSource === 'chunk_ai' ||
    resolvedSource === 'location_sync';

  if (hasExplicitAiSource) {
    return false;
  }

  if (rawIncoming.lockedByUser === true) {
    return true;
  }

  // An explicit boolean `lockedByUser: false` without an AI source (e.g., unlocking a locked entry)
  if (typeof rawIncoming.lockedByUser === 'boolean' && rawIncoming.lockedByUser === false) {
    return true;
  }

  return false;
}

/**
 * Safely merges a duplicate or incoming glossary entry into an existing entry with the same key:
 * - Protects `lockedByUser: true` entries from ever being overwritten or having their `avoidTranslations`
 *   erased by AI duplicates.
 * - Never automatically promotes a conflicting primary `banglaTranslation` into `acceptedAlternatives`.
 * - Respects deliberate user updates, including explicit unlocks (`lockedByUser: true -> false`).
 */
export function mergeSingleGlossaryPair(
  current: TerminologyMemoryItem,
  rawIncoming: Partial<TerminologyMemoryItem>,
  candidate: TerminologyMemoryItem,
  effectiveSource?: TerminologySource
): TerminologyMemoryItem {
  const userIncoming = isDeliberateUserUpdate(current, rawIncoming, effectiveSource);

  // Case 1: Existing entry is user-locked and incoming entry is an AI duplicate/extraction.
  // Protect the user's primary translation, lock state, and avoid list strictly.
  if (current.lockedByUser && !userIncoming) {
    const primaryBangla = current.banglaTranslation;
    const baseAccepted = deduplicateBanglaList(
      current.acceptedAlternatives ?? [],
      new Set([primaryBangla])
    );
    const mergedAvoid = deduplicateBanglaList(
      [...(current.avoidTranslations ?? []), ...(candidate.avoidTranslations ?? [])],
      new Set([primaryBangla, ...baseAccepted])
    );
    const mergedAccepted = deduplicateBanglaList(
      [...baseAccepted, ...(candidate.acceptedAlternatives ?? [])],
      new Set([primaryBangla, ...mergedAvoid])
    );

    return normalizeTerminologyItem({
      ...current,
      banglaTranslation: primaryBangla,
      acceptedAlternatives: mergedAccepted,
      avoidTranslations: mergedAvoid,
      contextMeaning: current.contextMeaning || candidate.contextMeaning,
      notes: current.notes || candidate.notes,
      isContextSensitive: Boolean(current.isContextSensitive || candidate.isContextSensitive),
      lockedByUser: true,
      source: current.source === 'user' ? 'user' : 'user',
    });
  }

  // Case 2: Incoming entry is a deliberate user update (or user-locked entry overriding an earlier AI entry,
  // or an explicit user unlock with updated translation).
  if (userIncoming) {
    const primaryBangla = candidate.banglaTranslation;
    const nextLocked =
      typeof rawIncoming.lockedByUser === 'boolean'
        ? rawIncoming.lockedByUser
        : Boolean(candidate.lockedByUser);

    const rawAvoidList =
      rawIncoming.avoidTranslations !== undefined
        ? candidate.avoidTranslations ?? []
        : [...(candidate.avoidTranslations ?? []), ...(current.avoidTranslations ?? [])];

    const mergedAvoid = deduplicateBanglaList(
      rawAvoidList,
      new Set([primaryBangla])
    );

    const rawAcceptedList =
      rawIncoming.acceptedAlternatives !== undefined
        ? candidate.acceptedAlternatives ?? []
        : [...(candidate.acceptedAlternatives ?? []), ...(current.acceptedAlternatives ?? [])];

    const mergedAccepted = deduplicateBanglaList(
      rawAcceptedList,
      new Set([primaryBangla, ...mergedAvoid])
    );

    return normalizeTerminologyItem({
      ...current,
      ...candidate,
      id: current.id,
      banglaTranslation: primaryBangla,
      acceptedAlternatives: mergedAccepted,
      avoidTranslations: mergedAvoid,
      contextMeaning: candidate.contextMeaning ?? current.contextMeaning,
      notes: candidate.notes || current.notes,
      isContextSensitive:
        typeof rawIncoming.isContextSensitive === 'boolean'
          ? rawIncoming.isContextSensitive
          : Boolean(current.isContextSensitive || candidate.isContextSensitive),
      lockedByUser: nextLocked,
      source: 'user',
    });
  }

  // Case 3: Unlocked AI-to-AI merge / duplicate normalization.
  // Preserve established primary translation, never promote a conflicting AI primary translation
  // into acceptedAlternatives, and never allow incoming AI alternatives to erase avoidTranslations.
  const primaryBangla = current.banglaTranslation;
  const currentAccepted = deduplicateBanglaList(
    current.acceptedAlternatives ?? [],
    new Set([primaryBangla])
  );
  const mergedAvoid = deduplicateBanglaList(
    [...(current.avoidTranslations ?? []), ...(candidate.avoidTranslations ?? [])],
    new Set([primaryBangla, ...currentAccepted])
  );
  const mergedAccepted = deduplicateBanglaList(
    [...currentAccepted, ...(candidate.acceptedAlternatives ?? [])],
    new Set([primaryBangla, ...mergedAvoid])
  );

  return normalizeTerminologyItem({
    ...current,
    banglaTranslation: primaryBangla,
    acceptedAlternatives: mergedAccepted,
    avoidTranslations: mergedAvoid,
    contextMeaning: current.contextMeaning || candidate.contextMeaning,
    notes: current.notes || candidate.notes,
    isContextSensitive: Boolean(current.isContextSensitive || candidate.isContextSensitive),
    source:
      current.source === 'chunk_ai' && candidate.source === 'stage1_ai'
        ? 'stage1_ai'
        : current.source,
    lockedByUser: false,
  });
}

/**
 * Normalizes an entire glossary array:
 * 1. Filters out malformed entries lacking an English term or primary Bangla translation.
 * 2. Deduplicates genuinely identical glossary keys via `mergeSingleGlossaryPair`
 *    (preserving avoid lists, user unlocks, and distinct contextual homonyms).
 * 3. Ensures every surviving entry has a unique `id` without unnecessarily altering existing unique IDs.
 */
export function normalizeGlossaryList(
  items: ReadonlyArray<Partial<TerminologyMemoryItem>>
): TerminologyMemoryItem[] {
  if (!Array.isArray(items)) return [];
  const deduplicated: TerminologyMemoryItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const rawItem = items[i];
    const item = normalizeTerminologyItem(rawItem, i);
    if (!item.englishTerm || !item.banglaTranslation) continue;

    const existingIdx = deduplicated.findIndex((existing) =>
      isSameGlossaryEntryKey(existing, item)
    );

    if (existingIdx === -1) {
      deduplicated.push(item);
      continue;
    }

    const current = deduplicated[existingIdx];
    deduplicated[existingIdx] = mergeSingleGlossaryPair(current, rawItem, item);
  }

  // Ensure unique IDs across all normalized entries without changing already-unique IDs
  const usedIds = new Set<string>();
  return deduplicated.map((entry) => {
    if (!usedIds.has(entry.id)) {
      usedIds.add(entry.id);
      return entry;
    }
    let counter = 2;
    let candidateId = `${entry.id}-${counter}`;
    while (usedIds.has(candidateId)) {
      counter++;
      candidateId = `${entry.id}-${counter}`;
    }
    usedIds.add(candidateId);
    return {
      ...entry,
      id: candidateId,
    };
  });
}

/**
 * Validates a candidate TerminologyMemoryItem before saving.
 */
export function validateTerminologyItem(
  item: Partial<TerminologyMemoryItem>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const englishTerm = normalizeEnglishTerm(item.englishTerm ?? '');
  const banglaTranslation = normalizeBanglaUnicode(item.banglaTranslation ?? '');

  if (!englishTerm) {
    errors.push('English term is required.');
  }
  if (!banglaTranslation) {
    errors.push('Preferred Bangla translation is required.');
  }

  if (item.category !== undefined && !isValidTerminologyCategory(item.category)) {
    errors.push(`Invalid terminology category: ${String(item.category)}`);
  }

  if (Array.isArray(item.avoidTranslations) && banglaTranslation) {
    const rawAvoids = item.avoidTranslations.map((a) => normalizeBanglaUnicode(a));
    if (rawAvoids.includes(banglaTranslation)) {
      errors.push('Preferred Bangla translation cannot also be listed in avoidTranslations.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper for creating a glossary item manually in the UI.
 * Automatically assigns `source: 'user'` and `lockedByUser: true` (unless explicitly overridden).
 */
export function createUserTerminologyItem(
  input: Omit<Partial<TerminologyMemoryItem>, 'source'> & {
    englishTerm: string;
    banglaTranslation: string;
  }
): TerminologyMemoryItem {
  return normalizeTerminologyItem({
    ...input,
    source: 'user',
    lockedByUser: input.lockedByUser !== undefined ? input.lockedByUser : true,
  });
}

/**
 * Helper for updating an existing glossary item from a manual user edit.
 * Automatically sets `source: 'user'` and `lockedByUser: true` unless the user explicitly
 * passes `lockedByUser: false` in `updates`.
 */
export function updateUserTerminologyItem(
  existing: TerminologyMemoryItem,
  updates: Partial<TerminologyMemoryItem>
): TerminologyMemoryItem {
  const nextLocked =
    typeof updates.lockedByUser === 'boolean' ? updates.lockedByUser : true;

  return normalizeTerminologyItem({
    ...existing,
    ...updates,
    source: 'user',
    lockedByUser: nextLocked,
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeWithFlexibleApostrophes(str: string): string {
  return escapeRegExp(str).replace(/['’]/g, "['\\u2018\\u2019\\u02BC]");
}

/**
 * Generates conservative English noun inflection forms (singular, regular plural,
 * and singular/plural possessives) for a single word.
 * Correctly handles singular words naturally ending in -s or -ies (e.g. lens/lenses, Charles, James, series, species),
 * preserves final -s on glossary entries explicitly categorized as `name`,
 * and never strips or adds verbal/adjectival suffixes (-ed, -ing, -er, -ly).
 */
export function generateConservativeEnglishWordForms(
  word: string,
  options: { category?: TerminologyCategory; isProperName?: boolean } = {}
): string[] {
  const cleaned = normalizeEnglishTerm(word).replace(/(?:'s|')$/i, '');
  if (!cleaned) return [];

  const forms = new Set<string>([cleaned]);
  const isNameCategory = Boolean(options.category === 'name' || options.isProperName);

  // Only apply noun plural/singular expansion to alphabetic words of at least 3 letters
  if (/^[A-Za-z]{3,}$/.test(cleaned)) {
    const lower = cleaned.toLowerCase();
    const isAllCaps = cleaned === cleaned.toUpperCase() && cleaned.length > 1;
    const matchCase = (targetLower: string): string => {
      if (isAllCaps) return targetLower.toUpperCase();
      if (cleaned[0] === cleaned[0].toUpperCase()) {
        return targetLower[0].toUpperCase() + targetLower.slice(1);
      }
      return targetLower;
    };

    let singular = lower;
    let plural = lower;

    if (isNameCategory && lower.endsWith('s')) {
      singular = lower;
      plural = lower;
    } else if (INVARIANT_S_WORDS.has(lower)) {
      singular = lower;
      plural = lower;
    } else if (SINGULAR_PROPER_OR_FIXED_S_WORDS.has(lower)) {
      singular = lower;
      plural = lower;
    } else if (SINGULAR_S_TAKING_ES.has(lower)) {
      singular = lower;
      plural = `${lower}es`;
    } else if (
      lower.endsWith('es') &&
      SINGULAR_S_TAKING_ES.has(lower.slice(0, -2))
    ) {
      singular = lower.slice(0, -2);
      plural = lower;
    } else if (lower.length >= 5 && /[bcdfghjklmnpqrstvwxz]ies$/.test(lower)) {
      singular = `${lower.slice(0, -3)}y`;
      plural = lower;
    } else if (lower.length >= 4 && /[bcdfghjklmnpqrstvwxz]y$/.test(lower)) {
      singular = lower;
      plural = `${lower.slice(0, -1)}ies`;
    } else if (lower.length >= 5 && /(?:sses|shes|ches|xes|zes)$/.test(lower)) {
      singular = lower.slice(0, -2);
      plural = lower;
    } else if (/(?:ss|sh|ch|x|z)$/.test(lower)) {
      singular = lower;
      plural = `${lower}es`;
    } else if (
      lower.length >= 4 &&
      lower.endsWith('s') &&
      !/(?:ss|us|is|os|as|ews|ias)$/.test(lower)
    ) {
      singular = lower.slice(0, -1);
      plural = lower;
    } else {
      singular = lower;
      plural = `${lower}s`;
    }

    const sForm = matchCase(singular);
    const pForm = matchCase(plural);

    forms.add(sForm);
    forms.add(pForm);
    forms.add(`${sForm}'s`);
    forms.add(`${sForm}’s`);
    if (sForm.endsWith('s') || sForm.endsWith('S')) {
      forms.add(`${sForm}'`);
      forms.add(`${sForm}’`);
    }
    if (pForm.endsWith('s') || pForm.endsWith('S')) {
      forms.add(`${pForm}'`);
      forms.add(`${pForm}’`);
    } else {
      forms.add(`${pForm}'s`);
      forms.add(`${pForm}’s`);
    }
  } else {
    forms.add(`${cleaned}'s`);
    forms.add(`${cleaned}’s`);
  }

  return Array.from(forms);
}

/**
 * Finds all character spans in `englishText` where `item.englishTerm` occurs
 * at conservative word boundaries (preventing substring matches like "boat" in "steamboat" or "boast",
 * and preventing hyphenated compound leaks like "motor-boat" when matching "boat").
 * Supports both straight and curly apostrophes in all tokens of multi-word phrases.
 */
export function findEnglishTermOccurrences(
  englishText: string,
  item: TerminologyMemoryItem
): EnglishTermMatchSpan[] {
  const term = normalizeEnglishTerm(item.englishTerm);
  if (!englishText || !term) return [];

  const tokens = term.split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const headWord = tokens[tokens.length - 1];
  const headForms = generateConservativeEnglishWordForms(headWord, {
    category: item.category,
  })
    .sort((a, b) => b.length - a.length)
    .map(escapeWithFlexibleApostrophes);

  const prefixPattern =
    tokens.length > 1
      ? `${tokens
          .slice(0, -1)
          .map(escapeWithFlexibleApostrophes)
          .join('[\\s\\-]+')}[\\s\\-]+`
      : '';

  const fullPattern = `${prefixPattern}(?:${headForms.join('|')})`;
  const flags = item.caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(fullPattern, flags);

  const spans: EnglishTermMatchSpan[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(englishText)) !== null) {
    const start = match.index;
    const matchedText = match[0];
    const end = start + matchedText.length;

    const charBefore = start > 0 ? englishText[start - 1] : '';
    const charAfter = end < englishText.length ? englishText[end] : '';
    const twoBefore = start > 1 ? englishText.slice(start - 2, start) : charBefore;
    const twoAfter =
      end + 1 < englishText.length ? englishText.slice(end, end + 2) : charAfter;

    // Strict left boundary: cannot be preceded by a word character or a hyphen attached to a word character
    const invalidLeft =
      /[A-Za-z0-9_]/.test(charBefore) || /[A-Za-z0-9_]-/.test(twoBefore);

    // Strict right boundary: cannot be followed by a word character or a hyphen attached to a word character
    const invalidRight =
      /[A-Za-z0-9_]/.test(charAfter) || /-[A-Za-z0-9_]/.test(twoAfter);

    if (!invalidLeft && !invalidRight) {
      spans.push({ start, end, matchedText });
    }
  }

  return spans;
}

function spansOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Evaluates a glossary against `englishText` using phrase-first priority.
 * Multi-word phrases (e.g., "lantern room") claim their matched spans first so constituent words
 * (e.g., "lantern") inside that phrase are not double-counted, while independent occurrences
 * of shorter terms elsewhere in the same text ARE preserved.
 */
export function matchGlossaryInEnglishText(
  englishText: string,
  glossary: ReadonlyArray<TerminologyMemoryItem>
): GlossaryEnglishMatchResult[] {
  if (!englishText || !glossary || glossary.length === 0) return [];

  const normalizedGlossary = normalizeGlossaryList(glossary);

  // Sort by token count descending, then English term character length descending
  const sorted = [...normalizedGlossary].sort((a, b) => {
    const aTokens = a.englishTerm.split(/[\s-]+/).length;
    const bTokens = b.englishTerm.split(/[\s-]+/).length;
    if (bTokens !== aTokens) return bTokens - aTokens;
    return b.englishTerm.length - a.englishTerm.length;
  });

  // Track claimed spans together with the case-insensitive English key that claimed them,
  // so homonym entries with the same English term (even with differing caseSensitive settings)
  // can both inspect the span, while shorter sub-terms are masked inside longer phrase spans.
  const claimedSpans: Array<{
    start: number;
    end: number;
    englishKeyLower: string;
    tokenCount: number;
  }> = [];

  const resultsById = new Map<string, GlossaryEnglishMatchResult>();

  for (const item of sorted) {
    const rawSpans = findEnglishTermOccurrences(englishText, item);
    if (rawSpans.length === 0) continue;

    const englishKeyLower = item.englishTerm.toLowerCase();
    const tokenCount = item.englishTerm.split(/[\s-]+/).length;

    const survivingSpans = rawSpans.filter((span) => {
      for (const claimed of claimedSpans) {
        if (spansOverlap(span, claimed)) {
          // Allow homonym glossary items with the same case-insensitive English term to see the span
          if (
            claimed.englishKeyLower === englishKeyLower &&
            claimed.tokenCount === tokenCount
          ) {
            return true;
          }
          return false;
        }
      }
      return true;
    });

    if (survivingSpans.length > 0) {
      resultsById.set(item.id, {
        item,
        occurrences: survivingSpans,
      });

      for (const span of survivingSpans) {
        claimedSpans.push({
          start: span.start,
          end: span.end,
          englishKeyLower,
          tokenCount,
        });
      }
    }
  }

  // Return in a deterministic order (phrase-priority order)
  return sorted
    .map((item) => resultsById.get(item.id))
    .filter((r): r is GlossaryEnglishMatchResult => r !== undefined);
}

/**
 * Checks whether a character is part of a Bangla or Latin word token.
 * Punctuation marks (including Bangla danda । and ॥) and whitespace return false.
 */
function isWordChar(ch: string): boolean {
  if (!ch) return false;
  if (ch === '\u0964' || ch === '\u0965' || ch === '\u09F7') return false;
  const code = ch.charCodeAt(0);
  if (code >= 0x0980 && code <= 0x09ff) return true;
  return /[\p{L}\p{M}\p{N}_]/u.test(ch);
}

/**
 * Returns true if the normalized Bangla stem ends with an independent vowel or dependent vowel sign (কার).
 * Returns false if it ends with a consonant, hasanta, anusvara, visarga, or chandrabindu.
 */
export function endsWithBanglaVowel(stem: string): boolean {
  const normalized = normalizeBanglaUnicode(stem);
  if (!normalized) return false;
  const lastCode = normalized.charCodeAt(normalized.length - 1);

  // Independent vowels: অ (0x0985) through ঔ (0x0994)
  if (lastCode >= 0x0985 && lastCode <= 0x0994) {
    return true;
  }

  // Dependent vowel signs (কার): া (0x09BE) through ৌ (0x09CC)
  if (lastCode >= 0x09be && lastCode <= 0x09cc) {
    return true;
  }

  return false;
}

/**
 * Determines whether `suffix` is a valid, grammatically bounded nominal inflection
 * for `stem` in Bangla. Rejects arbitrary derivational or compound tails (e.g. ঘর -> ঘরোয়া, নৌকা -> নৌকাডুবি).
 */
export function isAllowedBanglaNominalSuffix(stem: string, suffix: string): boolean {
  if (!suffix) return true;

  const normStem = normalizeBanglaUnicode(stem);
  const normSuffix = normalizeBanglaUnicode(suffix);
  if (!normStem) return false;

  if (UNIVERSAL_BANGLA_NOMINAL_SUFFIXES.has(normSuffix)) {
    return true;
  }

  const vowelEnding = endsWithBanglaVowel(normStem);

  if (!vowelEnding && CONSONANT_STEM_ONLY_SUFFIXES.has(normSuffix)) {
    return true;
  }

  if (vowelEnding && VOWEL_STEM_ONLY_SUFFIXES.has(normSuffix)) {
    return true;
  }

  // Direct emphatic enclitics (-ই, -ও) are allowed on stems with at least 3 code units
  if (normStem.length >= 3 && (normSuffix === 'ই' || normSuffix === 'ও')) {
    return true;
  }

  return false;
}

/**
 * Finds all occurrences of a Bangla term (and its bounded nominal inflections) in `banglaText`.
 * Supports multi-word Bangla terms (matching spaces, hyphens, or direct compound joins for 2-word terms)
 * with inflection evaluated on the final head word.
 */
export function findBanglaTermOccurrences(
  banglaText: string,
  banglaTerm: string,
  options: { banglaStem?: string; allowInflections?: boolean } = {}
): BanglaTermMatchSpan[] {
  const normText = normalizeBanglaUnicode(banglaText);
  const normTerm = normalizeBanglaUnicode(banglaTerm);
  if (!normText || !normTerm) return [];

  const allowInflections =
    options.allowInflections !== undefined ? options.allowInflections : true;

  const candidateBases = new Set<string>([normTerm]);
  if (options.banglaStem) {
    const normStem = normalizeBanglaUnicode(options.banglaStem);
    if (normStem) candidateBases.add(normStem);
  }

  const spans: BanglaTermMatchSpan[] = [];

  for (const base of candidateBases) {
    const words = base.split(/[\s-]+/).filter(Boolean);
    if (words.length === 0) continue;

    // Build regex for the base phrase (allowing space, hyphen, or compound join on 2+ char words)
    const joiner =
      words.length > 1 && words.every((w) => w.length >= 2) ? '[\\s\\-]*' : '[\\s\\-]+';
    const basePattern = words.map(escapeRegExp).join(joiner);
    const headWord = words[words.length - 1];

    const regex = new RegExp(basePattern, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(normText)) !== null) {
      const start = match.index;
      const baseMatched = match[0];
      const baseEnd = start + baseMatched.length;

      // Verify strict left Bangla word boundary
      const charBefore = start > 0 ? normText[start - 1] : '';
      if (isWordChar(charBefore)) {
        continue;
      }

      // Scan right to the end of the current word token to inspect any attached suffix
      let tokenEnd = baseEnd;
      while (tokenEnd < normText.length && isWordChar(normText[tokenEnd])) {
        tokenEnd++;
      }

      const suffix = normText.slice(baseEnd, tokenEnd);

      if (suffix.length === 0) {
        spans.push({
          start,
          end: tokenEnd,
          matchedText: normText.slice(start, tokenEnd),
          baseTerm: base,
          suffix: '',
        });
      } else if (allowInflections && isAllowedBanglaNominalSuffix(headWord, suffix)) {
        spans.push({
          start,
          end: tokenEnd,
          matchedText: normText.slice(start, tokenEnd),
          baseTerm: base,
          suffix,
        });
      }
    }
  }

  // Deduplicate identical [start, end] spans
  const uniqueSpans: BanglaTermMatchSpan[] = [];
  const seenKey = new Set<string>();
  for (const s of spans) {
    const key = `${s.start}:${s.end}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      uniqueSpans.push(s);
    }
  }

  return uniqueSpans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Boolean convenience wrapper around `findBanglaTermOccurrences`.
 */
export function matchesBanglaTerm(
  banglaText: string,
  banglaTerm: string,
  options: { banglaStem?: string; allowInflections?: boolean } = {}
): boolean {
  return findBanglaTermOccurrences(banglaText, banglaTerm, options).length > 0;
}

/**
 * Filters a project glossary down to the terms relevant to a specific translation chunk,
 * preventing prompt bloat on long novels while keeping matched terms and essential global terms.
 */
export function filterGlossaryForChunk(
  chunkParagraphs: ReadonlyArray<string>,
  glossary: ReadonlyArray<TerminologyMemoryItem>,
  options: ChunkGlossaryFilterOptions = {}
): FilteredChunkGlossary {
  const normalizedGlossary = normalizeGlossaryList(glossary);
  if (normalizedGlossary.length === 0) {
    return {
      matchedTerms: [],
      supplementalGlobalTerms: [],
      activeTerms: [],
    };
  }

  const combinedEnglish = [
    ...(options.previousContextParagraphs ?? []),
    ...chunkParagraphs,
  ].join('\n\n');

  const matches = matchGlossaryInEnglishText(combinedEnglish, normalizedGlossary);
  const matchedIds = new Set<string>();
  const matchedTerms: TerminologyMemoryItem[] = [];

  for (const m of matches) {
    matchedIds.add(m.item.id);
    matchedTerms.push(m.item);
  }

  const includeLocked =
    options.includeLockedGlobalTerms !== undefined ? options.includeLockedGlobalTerms : true;
  const includeNamesAndPlaces =
    options.includeCharacterAndPlaceNames !== undefined
      ? options.includeCharacterAndPlaceNames
      : true;
  const maxGlobalTerms =
    options.maxGlobalTerms !== undefined ? Math.max(0, options.maxGlobalTerms) : 25;

  const supplementalCandidates = normalizedGlossary.filter((item) => {
    if (matchedIds.has(item.id)) return false;
    if (includeLocked && item.lockedByUser) return true;
    if (includeNamesAndPlaces && (item.category === 'name' || item.category === 'place')) {
      return true;
    }
    return false;
  });

  // Prioritize locked entries first among supplemental global terms
  supplementalCandidates.sort((a, b) => {
    if (Boolean(b.lockedByUser) !== Boolean(a.lockedByUser)) {
      return b.lockedByUser ? 1 : -1;
    }
    return 0;
  });

  const supplementalGlobalTerms = supplementalCandidates.slice(0, maxGlobalTerms);

  return {
    matchedTerms,
    supplementalGlobalTerms,
    activeTerms: [...matchedTerms, ...supplementalGlobalTerms],
  };
}

/**
 * Merges incoming glossary items (from Stage 1, Stage 3 chunk discoveries, or user updates)
 * into an existing glossary list while strictly protecting `lockedByUser: true` entries
 * from ever being overwritten by AI merges, and honoring deliberate user edits/unlocks.
 */
export function mergeGlossaryItems(
  existing: ReadonlyArray<TerminologyMemoryItem>,
  incoming: ReadonlyArray<Partial<TerminologyMemoryItem>>,
  options: MergeGlossaryOptions = {}
): TerminologyMemoryItem[] {
  const defaultSource: TerminologySource = options.defaultSource ?? 'stage1_ai';
  const result = normalizeGlossaryList(existing);

  for (let i = 0; i < incoming.length; i++) {
    const rawCandidate = incoming[i];
    const candidateSource: TerminologySource = isValidTerminologySource(rawCandidate.source)
      ? rawCandidate.source
      : defaultSource;

    const candidateLocked =
      typeof rawCandidate.lockedByUser === 'boolean'
        ? rawCandidate.lockedByUser
        : candidateSource === 'user';

    const candidate = normalizeTerminologyItem(
      {
        ...rawCandidate,
        source: candidateSource,
        lockedByUser: candidateLocked,
      },
      result.length + i
    );

    if (!candidate.englishTerm || !candidate.banglaTranslation) {
      continue;
    }

    const matchIdx = result.findIndex((item) => isSameGlossaryEntryKey(item, candidate));

    if (matchIdx === -1) {
      result.push(candidate);
      continue;
    }

    const current = result[matchIdx];
    result[matchIdx] = mergeSingleGlossaryPair(
      current,
      rawCandidate,
      candidate,
      candidateSource
    );
  }

  return normalizeGlossaryList(result);
}

/**
 * Expands an approved Bangla form into its canonical spaced, hyphenated, and joined
 * 2-word compound equivalents so compound reservation for one entry can never steal
 * an approved translation belonging to another glossary entry.
 */
function expandApprovedBanglaCompoundForms(rawForm: string): string[] {
  const norm = normalizeBanglaUnicode(rawForm);
  if (!norm) return [];

  const forms = new Set<string>([norm]);
  const parts = norm.split(/[\s-]+/).filter(Boolean);

  if (parts.length === 2) {
    const [mod, head] = parts;
    forms.add(normalizeBanglaUnicode(`${mod} ${head}`));
    forms.add(normalizeBanglaUnicode(`${mod}-${head}`));
    forms.add(normalizeBanglaUnicode(`${mod}${head}`));
  } else if (parts.length === 1) {
    const allClusterRoots = new Set<string>();
    for (const cluster of KNOWN_EQUIVALENT_CLUSTERS) {
      for (const variant of cluster.banglaVariants) {
        const vNorm = normalizeBanglaUnicode(variant);
        if (vNorm && !vNorm.includes(' ') && !vNorm.includes('-')) {
          allClusterRoots.add(vNorm);
        }
      }
    }

    for (const mod of allClusterRoots) {
      if (norm.startsWith(mod) && norm.length > mod.length) {
        const remainder = norm.slice(mod.length);
        if (allClusterRoots.has(remainder)) {
          forms.add(normalizeBanglaUnicode(`${mod} ${remainder}`));
          forms.add(normalizeBanglaUnicode(`${mod}-${remainder}`));
          forms.add(normalizeBanglaUnicode(`${mod}${remainder}`));
        }
      }
    }
  }

  return Array.from(forms);
}

/**
 * Looks up known competing Bangla equivalents for a glossary item so the linter can
 * distinguish between genuine terminology drift (e.g. আয়না -> দর্পণ, দীপকক্ষ -> লণ্ঠন কক্ষ)
 * and legitimate literary paraphrasing / pronoun ellipsis, without arbitrary suffix false positives.
 * Returns up to `maxCount` non-overlapping unconsumed spans in `banglaText`.
 */
function findUnapprovedKnownVariantsInBangla(
  banglaText: string,
  item: TerminologyMemoryItem,
  consumedSpans: ReadonlyArray<{ start: number; end: number }>,
  excludedBanglaForms: ReadonlySet<string> = new Set(),
  maxCount = 1
): BanglaTermMatchSpan[] {
  if (maxCount <= 0) return [];

  const normEnglish = item.englishTerm.toLowerCase();
  const englishForms = new Set<string>(
    generateConservativeEnglishWordForms(normEnglish, {
      category: item.category,
    }).map((f) => f.toLowerCase())
  );
  englishForms.add(normEnglish);

  const allowedSet = new Set<string>(excludedBanglaForms);
  for (const form of expandApprovedBanglaCompoundForms(item.banglaTranslation)) {
    allowedSet.add(form);
  }
  for (const alt of item.acceptedAlternatives ?? []) {
    for (const form of expandApprovedBanglaCompoundForms(alt)) {
      allowedSet.add(form);
    }
  }

  const candidateVariants = new Set<string>();

  // 1. Direct cluster lookup based on the English glossary term
  for (const cluster of KNOWN_EQUIVALENT_CLUSTERS) {
    const englishHit = cluster.englishKeys.some((k) => englishForms.has(k.toLowerCase()));

    if (englishHit) {
      for (const variant of cluster.banglaVariants) {
        const expanded = expandApprovedBanglaCompoundForms(variant);
        const isAllowed = expanded.some((f) => allowedSet.has(f));
        if (!isAllowed) {
          for (const f of expanded) {
            candidateVariants.add(f);
          }
        }
      }
    }
  }

  // 2. Verified modifier + head compound lookup for 2-word English terms (e.g., "lantern room").
  //    Requires BOTH the English modifier word and the English head word to match known clusters,
  //    preventing unrelated Bangla words (like অভিযান or রান্নাঘর) from ever matching.
  const englishTokens = normEnglish.split(/[\s-]+/).filter(Boolean);
  if (englishTokens.length === 2) {
    const [modToken, headToken] = englishTokens;
    const modForms = new Set(
      generateConservativeEnglishWordForms(modToken).map((f) => f.toLowerCase())
    );
    const headForms = new Set(
      generateConservativeEnglishWordForms(headToken).map((f) => f.toLowerCase())
    );

    const modBanglaRoots: string[] = [];
    const headBanglaRoots: string[] = [];

    for (const cluster of KNOWN_EQUIVALENT_CLUSTERS) {
      if (cluster.englishKeys.some((k) => modForms.has(k.toLowerCase()))) {
        modBanglaRoots.push(...cluster.banglaVariants);
      }
      if (cluster.englishKeys.some((k) => headForms.has(k.toLowerCase()))) {
        headBanglaRoots.push(...cluster.banglaVariants);
      }
    }

    for (const modBn of modBanglaRoots) {
      for (const headBn of headBanglaRoots) {
        const spaced = normalizeBanglaUnicode(`${modBn} ${headBn}`);
        const hyphenated = normalizeBanglaUnicode(`${modBn}-${headBn}`);
        const joined = normalizeBanglaUnicode(`${modBn}${headBn}`);
        const isExcluded =
          allowedSet.has(spaced) ||
          allowedSet.has(hyphenated) ||
          allowedSet.has(joined);
        if (!isExcluded) {
          candidateVariants.add(spaced);
          candidateVariants.add(hyphenated);
          candidateVariants.add(joined);
        }
      }
    }
  }

  const collected: BanglaTermMatchSpan[] = [];
  const localConsumed: Array<{ start: number; end: number }> = [...consumedSpans];

  for (const variant of candidateVariants) {
    if (collected.length >= maxCount) break;
    const matches = findBanglaTermOccurrences(banglaText, variant, {
      allowInflections: true,
    }).filter((span) => !localConsumed.some((c) => spansOverlap(span, c)));

    for (const match of matches) {
      if (collected.length >= maxCount) break;
      if (!localConsumed.some((c) => spansOverlap(match, c))) {
        collected.push(match);
        localConsumed.push({ start: match.start, end: match.end });
      }
    }
  }

  return collected;
}

function buildExcerpt(text: string, maxLen = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

interface EvaluatedGlossaryMatch {
  item: TerminologyMemoryItem;
  occurrences: EnglishTermMatchSpan[];
  preferredSpans: BanglaTermMatchSpan[];
  acceptedSpans: BanglaTermMatchSpan[];
  preclaimedAvoidSpans: BanglaTermMatchSpan[];
  preclaimedUnapprovedVariantSpans: BanglaTermMatchSpan[];
}

interface HomonymMatchGroup {
  englishKeyLower: string;
  occurrences: EnglishTermMatchSpan[];
  entries: EvaluatedGlossaryMatch[];
}

/**
 * Deterministically lints a single ParagraphPair against the active glossary.
 * Uses a multi-stage span-attribution strategy:
 * - Pass 1A claims preferred and accepted Bangla translations across all matched glossary items
 *   (multi-word entries first so approved compounds are secured before compound variant reservation).
 * - Pass 1B reserves up to `remainingNeeded` avoided or unapproved compound spans for unsatisfied
 *   multi-word English phrases, excluding all spaced/hyphenated/joined equivalents of any matched item's
 *   approved translations and never stealing already-claimed spans.
 * - Pass 1C claims preferred and accepted Bangla translations for single-word entries from remaining
 *   unconsumed spans so constituent words cannot falsely match inside reserved compounds.
 * - Pass 2 resolves contextual homonyms per English occurrence and checks remaining unclaimed spans
 *   for avoid-list violations and terminology drift.
 * Never mutates or rewrites paragraph text.
 */
export function lintParagraphTerminology(
  paragraph: ParagraphPair,
  glossary: ReadonlyArray<TerminologyMemoryItem>,
  options: ParagraphLintOptions = {}
): ParagraphTerminologyLintResult {
  const englishText = paragraph.englishText ?? '';
  const banglaText = normalizeBanglaUnicode(paragraph.banglaText ?? '');

  // Skip untranslated paragraphs (missing translations are handled structurally by Step 1)
  if (!englishText.trim() || !banglaText || paragraph.missingTranslation) {
    return {
      paragraphIndex: paragraph.index,
      findings: [],
      matchedTermIds: [],
      satisfiedTermIds: [],
      acceptedVariantTermIds: [],
      paraphrasedOrOmittedTermIds: [],
    };
  }

  const normalizedGlossary = normalizeGlossaryList(glossary);
  const englishMatches = matchGlossaryInEnglishText(englishText, normalizedGlossary);

  const findings: TerminologyLintFinding[] = [];
  const matchedTermIds: string[] = [];
  const satisfiedTermIds: string[] = [];
  const acceptedVariantTermIds: string[] = [];
  const paraphrasedOrOmittedTermIds: string[] = [];

  // Track Bangla spans claimed by approved translations or longer multi-word glossary items
  const consumedBanglaSpans: Array<{ start: number; end: number }> = [];

  // Group matched glossary items that share the same normalized English identity and overlapping occurrence spans
  // (including mixed-case contextual homonyms where caseSensitive settings produce overlapping match sets).
  const groups: HomonymMatchGroup[] = [];

  // Collect all preferred/accepted Bangla forms (expanded across spaced, hyphenated, and joined equivalents)
  // of matched items so compound reservation never steals another matched item's approved translation.
  const otherApprovedBanglaForms = new Set<string>();
  for (const { item } of englishMatches) {
    for (const form of expandApprovedBanglaCompoundForms(item.banglaTranslation)) {
      otherApprovedBanglaForms.add(form);
    }
    for (const alt of item.acceptedAlternatives ?? []) {
      for (const form of expandApprovedBanglaCompoundForms(alt)) {
        otherApprovedBanglaForms.add(form);
      }
    }
  }

  for (const { item, occurrences } of englishMatches) {
    matchedTermIds.push(item.id);
    const englishKeyLower = item.englishTerm.toLowerCase();

    const existingGroup = groups.find(
      (g) =>
        g.englishKeyLower === englishKeyLower &&
        g.occurrences.some((gOcc) => occurrences.some((occ) => spansOverlap(gOcc, occ)))
    );

    const evalEntry: EvaluatedGlossaryMatch = {
      item,
      occurrences: [...occurrences],
      preferredSpans: [],
      acceptedSpans: [],
      preclaimedAvoidSpans: [],
      preclaimedUnapprovedVariantSpans: [],
    };

    if (existingGroup) {
      existingGroup.entries.push(evalEntry);
      for (const occ of occurrences) {
        if (!existingGroup.occurrences.some((gOcc) => spansOverlap(gOcc, occ))) {
          existingGroup.occurrences.push(occ);
        }
      }
      existingGroup.occurrences.sort((a, b) => a.start - b.start || a.end - b.end);
    } else {
      groups.push({
        englishKeyLower,
        occurrences: [...occurrences],
        entries: [evalEntry],
      });
    }
  }

  // Partition case-sensitive occurrence spans within mixed-case homonym groups so a case-insensitive
  // sibling entry (`vessel`, caseSensitive: false) cannot claim occurrence quota belonging to a
  // distinct case-sensitive sibling (`Vessel`, caseSensitive: true).
  const isSentenceInitialSpan = (text: string, start: number): boolean => {
    const prefix = text.slice(0, start);
    if (/^[\s"'“‘(\[\u2014\u2013-]*$/.test(prefix)) {
      return true;
    }
    return /[.!?\u0964\u0965][\s"'”’)\]]+$/.test(prefix);
  };

  for (const group of groups) {
    if (group.entries.length > 1) {
      const caseSensitiveEntries = group.entries.filter((e) => e.item.caseSensitive);
      const caseInsensitiveEntries = group.entries.filter((e) => !e.item.caseSensitive);
      if (caseSensitiveEntries.length > 0 && caseInsensitiveEntries.length > 0) {
        const caseSensitiveSpans: EnglishTermMatchSpan[] = [];
        for (const csEntry of caseSensitiveEntries) {
          for (const occ of csEntry.occurrences) {
            if (!caseSensitiveSpans.some((s) => spansOverlap(s, occ))) {
              caseSensitiveSpans.push(occ);
            }
          }
        }

        const hasDistinctCaseInsensitiveSpans = caseInsensitiveEntries.some((ciEntry) =>
          ciEntry.occurrences.some(
            (occ) => !caseSensitiveSpans.some((cs) => spansOverlap(occ, cs))
          )
        );

        for (const ciEntry of caseInsensitiveEntries) {
          ciEntry.occurrences = ciEntry.occurrences.filter((occ) => {
            const overlapsCs = caseSensitiveSpans.some((cs) => spansOverlap(occ, cs));
            if (!overlapsCs) return true;
            // If the paragraph also has distinct lowercase occurrences, or if the capitalized
            // occurrence is mid-sentence (not explainable by sentence-initial capitalization),
            // reserve the capitalized span exclusively for the case-sensitive entry.
            if (hasDistinctCaseInsensitiveSpans || !isSentenceInitialSpan(englishText, occ.start)) {
              return false;
            }
            return true;
          });
        }
      }
    }
  }

  const claimApprovedSpansForEntry = (entry: EvaluatedGlossaryMatch) => {
    const { item } = entry;
    const maxSpansNeeded = entry.occurrences.length;
    if (maxSpansNeeded <= 0) return;

    const expectedBangla = item.banglaTranslation;
    const acceptedAlternatives = item.acceptedAlternatives ?? [];

    const preferredCandidates = expandApprovedBanglaCompoundForms(expectedBangla);
    const preferredSpans: BanglaTermMatchSpan[] = [];

    for (const candidateForm of preferredCandidates) {
      if (preferredSpans.length >= maxSpansNeeded) break;
      const available = findBanglaTermOccurrences(banglaText, candidateForm, {
        banglaStem: candidateForm === normalizeBanglaUnicode(expectedBangla) ? item.banglaStem : undefined,
        allowInflections: item.allowInflections,
      }).filter((s) => !consumedBanglaSpans.some((c) => spansOverlap(s, c)));

      const toClaim = available.slice(0, maxSpansNeeded - preferredSpans.length);
      for (const s of toClaim) {
        preferredSpans.push(s);
        consumedBanglaSpans.push({ start: s.start, end: s.end });
      }
    }
    entry.preferredSpans = preferredSpans;

    let remainingNeeded = Math.max(0, maxSpansNeeded - preferredSpans.length);
    const acceptedSpans: BanglaTermMatchSpan[] = [];
    for (const alt of acceptedAlternatives) {
      if (remainingNeeded <= 0) break;
      const altCandidates = expandApprovedBanglaCompoundForms(alt);
      for (const candidateForm of altCandidates) {
        if (remainingNeeded <= 0) break;
        const spans = findBanglaTermOccurrences(banglaText, candidateForm, {
          allowInflections: item.allowInflections,
        }).filter((s) => !consumedBanglaSpans.some((c) => spansOverlap(s, c)));
        const toClaim = spans.slice(0, remainingNeeded);
        for (const s of toClaim) {
          acceptedSpans.push(s);
          consumedBanglaSpans.push({ start: s.start, end: s.end });
        }
        remainingNeeded -= toClaim.length;
      }
    }
    entry.acceptedSpans = acceptedSpans;
  };

  const isMultiWordEntry = (entry: EvaluatedGlossaryMatch): boolean =>
    entry.item.englishTerm.split(/[\s-]+/).filter(Boolean).length > 1 ||
    normalizeBanglaUnicode(entry.item.banglaTranslation).split(/[\s-]+/).filter(Boolean).length > 1;

  // PASS 1A: All multi-word entries claim their preferred and accepted translations first.
  // This guarantees that approved compounds (e.g., `lamp room` -> `লণ্ঠন কক্ষ` / `লণ্ঠন-কক্ষ` / `লণ্ঠনকক্ষ`)
  // are claimed before any other entry attempts compound variant reservation in Pass 1B.
  for (const group of groups) {
    for (const entry of group.entries) {
      if (isMultiWordEntry(entry)) {
        claimApprovedSpansForEntry(entry);
      }
    }
  }

  // PASS 1B: Unsatisfied multi-word English phrase entries reserve up to `remainingNeeded` avoided or
  // unapproved compound variants from remaining unconsumed spans, excluding any form in `otherApprovedBanglaForms`.
  for (const group of groups) {
    for (const entry of group.entries) {
      const { item } = entry;
      const isMultiWordEnglishPhrase =
        item.englishTerm.split(/[\s-]+/).filter(Boolean).length > 1;
      if (!isMultiWordEnglishPhrase) continue;

      const maxSpansNeeded = entry.occurrences.length;
      const approvedClaimedCount = entry.preferredSpans.length + entry.acceptedSpans.length;
      let remainingNeeded = Math.max(0, maxSpansNeeded - approvedClaimedCount);
      if (remainingNeeded <= 0) continue;

      for (const avoidTerm of item.avoidTranslations ?? []) {
        if (remainingNeeded <= 0) break;
        const expandedAvoid = expandApprovedBanglaCompoundForms(avoidTerm);
        const isApprovedForAnother = expandedAvoid.some((f) => otherApprovedBanglaForms.has(f));
        if (isApprovedForAnother) continue;

        for (const candidateAvoid of expandedAvoid) {
          if (remainingNeeded <= 0) break;
          const avoidSpans = findBanglaTermOccurrences(banglaText, candidateAvoid, {
            allowInflections: item.allowInflections,
          }).filter((s) => !consumedBanglaSpans.some((c) => spansOverlap(s, c)));

          const toReserve = avoidSpans.slice(0, remainingNeeded);
          for (const s of toReserve) {
            entry.preclaimedAvoidSpans.push(s);
            consumedBanglaSpans.push({ start: s.start, end: s.end });
          }
          remainingNeeded -= toReserve.length;
        }
      }

      if (remainingNeeded > 0) {
        const compoundVariantSpans = findUnapprovedKnownVariantsInBangla(
          banglaText,
          item,
          consumedBanglaSpans,
          otherApprovedBanglaForms,
          remainingNeeded
        );
        for (const s of compoundVariantSpans) {
          entry.preclaimedUnapprovedVariantSpans.push(s);
          consumedBanglaSpans.push({ start: s.start, end: s.end });
        }
      }
    }
  }

  // PASS 1C: Single-word entries claim their preferred and accepted translations from remaining unconsumed spans.
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!isMultiWordEntry(entry)) {
        claimApprovedSpansForEntry(entry);
      }
    }
  }

  // PASS 2: Evaluate each occurrence group for satisfaction, avoid-list violations, and drift.
  for (const group of groups) {
    const englishOccurrencesCount = group.occurrences.length;

    let groupApprovedCount = 0;

    for (const entry of group.entries) {
      const approvedCount = entry.preferredSpans.length + entry.acceptedSpans.length;
      groupApprovedCount += approvedCount;

      if (entry.preferredSpans.length > 0) {
        satisfiedTermIds.push(entry.item.id);
      } else if (entry.acceptedSpans.length > 0) {
        acceptedVariantTermIds.push(entry.item.id);
      }
    }

    // If all English occurrences for this term/homonym-group are accounted for by preferred/accepted translations
    // (with each entry bounded by its partitioned `entry.occurrences.length`), emit no findings for this group.
    if (groupApprovedCount >= englishOccurrencesCount) {
      continue;
    }

    // Track how many English occurrences in this group remain unsatisfied so homonym groups
    // never emit duplicate contextual warnings for the same unsatisfied occurrence.
    let remainingUnsatisfiedCount = englishOccurrencesCount - groupApprovedCount;
    let contextualReviewEmittedForGroup = false;

    // Prioritize completely unsatisfied senses before partially satisfied senses
    const orderedEntries = [...group.entries].sort((a, b) => {
      const aCount = a.preferredSpans.length + a.acceptedSpans.length;
      const bCount = b.preferredSpans.length + b.acceptedSpans.length;
      return aCount - bCount;
    });

    for (const entry of orderedEntries) {
      if (remainingUnsatisfiedCount <= 0) {
        break;
      }

      const { item, occurrences, preferredSpans, acceptedSpans } = entry;
      if (occurrences.length === 0) {
        continue;
      }

      const matchedEnglishText = occurrences[0]?.matchedText ?? item.englishTerm;
      const expectedBangla = item.banglaTranslation;
      const acceptedAlternatives = item.acceptedAlternatives ?? [];
      const avoidTranslations = item.avoidTranslations ?? [];
      const totalApprovedSpans = [...preferredSpans, ...acceptedSpans];

      // If this specific homonym sense already matched all of its own occurrences, skip it.
      if (totalApprovedSpans.length >= occurrences.length) {
        continue;
      }

      // 1. Check explicit avoidTranslations against preclaimed spans or remaining UNCONSUMED Bangla spans
      let matchedAvoidSpan: BanglaTermMatchSpan | null = entry.preclaimedAvoidSpans[0] ?? null;
      if (!matchedAvoidSpan) {
        for (const avoidTerm of avoidTranslations) {
          const avoidSpans = findBanglaTermOccurrences(banglaText, avoidTerm, {
            allowInflections: item.allowInflections,
          }).filter((s) => !consumedBanglaSpans.some((c) => spansOverlap(s, c)));

          if (avoidSpans.length > 0) {
            matchedAvoidSpan = avoidSpans[0];
            consumedBanglaSpans.push({
              start: matchedAvoidSpan.start,
              end: matchedAvoidSpan.end,
            });
            break;
          }
        }
      }

      if (matchedAvoidSpan) {
        findings.push(
          createFinding({
            paragraph,
            item,
            matchedEnglishText,
            detectedBanglaVariant: matchedAvoidSpan.matchedText,
            severity: 'high',
            classification: 'definite_violation',
            reason: 'avoid_term_used',
            description: `Paragraph ${paragraph.index + 1} translates "${matchedEnglishText}" using avoided form "${matchedAvoidSpan.matchedText}" instead of preferred "${expectedBangla}".`,
          })
        );
        remainingUnsatisfiedCount -= Math.max(1, entry.preclaimedAvoidSpans.length);
        continue;
      }

      const isContextualEntry = Boolean(
        item.isContextSensitive || item.contextMeaning || group.entries.length > 1
      );

      // 2. If the English term appeared multiple times and was partially satisfied (totalApprovedSpans.length > 0),
      //    check whether an unapproved variant was used for the remaining occurrence(s).
      if (totalApprovedSpans.length > 0) {
        const newlyFoundVariants =
          entry.preclaimedUnapprovedVariantSpans.length > 0
            ? []
            : findUnapprovedKnownVariantsInBangla(
                banglaText,
                item,
                consumedBanglaSpans,
                otherApprovedBanglaForms,
                1
              );
        const intraDriftSpan =
          entry.preclaimedUnapprovedVariantSpans[0] ?? newlyFoundVariants[0] ?? null;

        if (intraDriftSpan) {
          if (entry.preclaimedUnapprovedVariantSpans.length === 0) {
            consumedBanglaSpans.push({
              start: intraDriftSpan.start,
              end: intraDriftSpan.end,
            });
          }
          const isContextReview = Boolean(isContextualEntry && !item.lockedByUser);
          findings.push(
            createFinding({
              paragraph,
              item,
              matchedEnglishText,
              detectedBanglaVariant: intraDriftSpan.matchedText,
              severity: item.lockedByUser
                ? 'high'
                : isContextReview
                  ? 'low'
                  : 'medium',
              classification: isContextReview ? 'contextual_review' : 'definite_violation',
              reason: isContextReview
                ? 'contextual_review_needed'
                : 'unapproved_variant_used',
              description: `Paragraph ${paragraph.index + 1} uses both "${totalApprovedSpans[0].matchedText}" and unapproved variant "${intraDriftSpan.matchedText}" for repeated term "${item.englishTerm}".`,
            })
          );
          remainingUnsatisfiedCount -= Math.max(
            1,
            entry.preclaimedUnapprovedVariantSpans.length
          );
          continue;
        }

        if (!isContextualEntry) {
          continue;
        }
      }

      // 3. Neither preferred nor accepted alternative matched all occurrences in `banglaText`.
      //    Check whether a known competing Bangla variant is present in unconsumed spans.
      const fallbackVariants =
        entry.preclaimedUnapprovedVariantSpans.length > 0
          ? []
          : findUnapprovedKnownVariantsInBangla(
              banglaText,
              item,
              consumedBanglaSpans,
              otherApprovedBanglaForms,
              1
            );
      const unapprovedVariantSpan =
        entry.preclaimedUnapprovedVariantSpans[0] ?? fallbackVariants[0] ?? null;
      if (unapprovedVariantSpan && entry.preclaimedUnapprovedVariantSpans.length === 0) {
        consumedBanglaSpans.push({
          start: unapprovedVariantSpan.start,
          end: unapprovedVariantSpan.end,
        });
      }

      const detectedVariantText = unapprovedVariantSpan?.matchedText;
      const establishedElsewhere = Boolean(
        options.establishedTermIdsInChapter?.has(item.id)
      );

      // Case 3A: Context-sensitive / homonym entry -> Low-severity human review notice
      // Ensure at most one contextual review notice is emitted per homonym group so the same
      // occurrence never produces duplicate warnings.
      if (isContextualEntry) {
        if (contextualReviewEmittedForGroup) {
          continue;
        }
        contextualReviewEmittedForGroup = true;
        remainingUnsatisfiedCount--;

        const siblingTranslations = group.entries
          .filter((e) => e.item.id !== item.id)
          .map((e) => e.item.banglaTranslation);
        const combinedAlternatives = deduplicateBanglaList(
          [...acceptedAlternatives, ...siblingTranslations],
          new Set([expectedBangla])
        );

        findings.push(
          createFinding({
            paragraph,
            item: {
              ...item,
              acceptedAlternatives: combinedAlternatives,
              isContextSensitive: true,
            },
            matchedEnglishText,
            detectedBanglaVariant: detectedVariantText,
            severity: 'low',
            classification: 'contextual_review',
            reason: 'contextual_review_needed',
            description: detectedVariantText
              ? `Context-sensitive term "${item.englishTerm}" was rendered as "${detectedVariantText}" in Paragraph ${paragraph.index + 1}. Verify whether "${expectedBangla}"${combinedAlternatives.length > 0 ? ` (or ${combinedAlternatives.join(' / ')})` : ''} fits the intended meaning${item.contextMeaning ? ` (${item.contextMeaning})` : ''}.`
              : `Context-sensitive term "${item.englishTerm}" in Paragraph ${paragraph.index + 1} did not use "${expectedBangla}"${combinedAlternatives.length > 0 ? ` or ${combinedAlternatives.join(' / ')}` : ''}. Confirm whether the contextual rendering is intentional${item.contextMeaning ? ` (${item.contextMeaning})` : ''}.`,
          })
        );
        continue;
      }

      // Case 3B: User-locked entry (and not context-sensitive) -> High-severity violation
      if (item.lockedByUser) {
        findings.push(
          createFinding({
            paragraph,
            item,
            matchedEnglishText,
            detectedBanglaVariant: detectedVariantText,
            severity: 'high',
            classification: 'definite_violation',
            reason: detectedVariantText ? 'unapproved_variant_used' : 'locked_term_missing',
            description: detectedVariantText
              ? `User-locked term "${item.englishTerm}" was translated as "${detectedVariantText}" in Paragraph ${paragraph.index + 1}. Locked translation is "${expectedBangla}".`
              : `User-locked term "${item.englishTerm}" in Paragraph ${paragraph.index + 1} is missing its locked Bangla translation "${expectedBangla}".`,
          })
        );
        remainingUnsatisfiedCount--;
        continue;
      }

      // Case 3C: Unlocked AI entry where an unapproved competing Bangla variant was detected
      if (detectedVariantText) {
        const reason: TerminologyFindingReason = establishedElsewhere
          ? 'cross_paragraph_drift'
          : 'unapproved_variant_used';
        findings.push(
          createFinding({
            paragraph,
            item,
            matchedEnglishText,
            detectedBanglaVariant: detectedVariantText,
            severity: 'medium',
            classification: 'definite_violation',
            reason,
            description: establishedElsewhere
              ? `Terminology drift in Paragraph ${paragraph.index + 1}: "${item.englishTerm}" was translated as "${detectedVariantText}", drifting from established chapter term "${expectedBangla}".`
              : `Paragraph ${paragraph.index + 1} translates "${item.englishTerm}" as "${detectedVariantText}" instead of glossary term "${expectedBangla}".`,
          })
        );
        remainingUnsatisfiedCount--;
        continue;
      }

      // Case 3D: Unlocked AI entry for strict identity categories (name, place, title)
      if (STRICT_IDENTITY_CATEGORIES.has(item.category)) {
        const reason: TerminologyFindingReason = establishedElsewhere
          ? 'cross_paragraph_drift'
          : 'missing_expected_term';
        findings.push(
          createFinding({
            paragraph,
            item,
            matchedEnglishText,
            severity: 'medium',
            classification: 'definite_violation',
            reason,
            description: establishedElsewhere
              ? `Terminology drift in Paragraph ${paragraph.index + 1}: "${item.englishTerm}" omits the chapter-established Bangla rendering "${expectedBangla}".`
              : `Paragraph ${paragraph.index + 1} contains ${item.category} "${item.englishTerm}" without expected Bangla rendering "${expectedBangla}".`,
          })
        );
        remainingUnsatisfiedCount--;
        continue;
      }

      // Case 3E: Unlocked descriptive/common entry (object, nautical, cultural, fantasy, expression)
      // with no avoid-term and no competing lexical variant -> Allow legitimate literary paraphrasing / ellipsis!
      paraphrasedOrOmittedTermIds.push(item.id);
    }
  }

  return {
    paragraphIndex: paragraph.index,
    findings,
    matchedTermIds,
    satisfiedTermIds,
    acceptedVariantTermIds,
    paraphrasedOrOmittedTermIds,
  };
}

function createFinding(params: {
  paragraph: ParagraphPair;
  item: TerminologyMemoryItem;
  matchedEnglishText: string;
  detectedBanglaVariant?: string;
  severity: 'high' | 'medium' | 'low';
  classification: TerminologyFindingClassification;
  reason: TerminologyFindingReason;
  description: string;
}): TerminologyLintFinding {
  const {
    paragraph,
    item,
    matchedEnglishText,
    detectedBanglaVariant,
    severity,
    classification,
    reason,
    description,
  } = params;

  const accepted = item.acceptedAlternatives ?? [];
  const acceptedHint =
    accepted.length > 0 ? ` (or accepted alternative: ${accepted.join(', ')})` : '';
  const suggestedFix = detectedBanglaVariant
    ? `Replace "${detectedBanglaVariant}" with "${item.banglaTranslation}"${acceptedHint} while adjusting surrounding Bangla case endings if needed.`
    : `Use "${item.banglaTranslation}"${acceptedHint} for "${matchedEnglishText}" if literal reference is intended.`;

  return {
    id: `term-lint-p${paragraph.index}-${item.id}`,
    termId: item.id,
    englishTerm: item.englishTerm,
    expectedBangla: item.banglaTranslation,
    acceptedAlternatives: accepted,
    avoidTranslations: item.avoidTranslations ?? [],
    paragraphIndex: paragraph.index,
    displayParagraphNumber: paragraph.index + 1,
    severity,
    classification,
    reason,
    matchedEnglishText,
    ...(detectedBanglaVariant ? { detectedBanglaVariant } : {}),
    englishExcerpt: buildExcerpt(paragraph.englishText),
    banglaExcerpt: buildExcerpt(paragraph.banglaText),
    description,
    suggestedFix,
    lockedByUser: Boolean(item.lockedByUser),
    isContextSensitive: Boolean(item.isContextSensitive),
    category: item.category,
    ...(item.contextMeaning ? { contextMeaning: item.contextMeaning } : {}),
  };
}

/**
 * Converts a structured TerminologyLintFinding into a standard VerificationIssue
 * compatible with GolpoTranslate's Stage 5 verification report and completion gate.
 */
export function terminologyFindingToVerificationIssue(
  finding: TerminologyLintFinding
): VerificationIssue {
  return {
    id: finding.id,
    severity: finding.severity,
    type: 'terminology',
    paragraphIndex: finding.displayParagraphNumber,
    description: finding.description,
    englishExcerpt: finding.englishExcerpt,
    banglaExcerpt: finding.banglaExcerpt,
    suggestedFix: finding.suggestedFix,
    resolved: false,
  };
}

/**
 * Batch helper converting an array of TerminologyLintFindings into VerificationIssues.
 */
export function terminologyFindingsToVerificationIssues(
  findings: ReadonlyArray<TerminologyLintFinding>
): VerificationIssue[] {
  return findings.map(terminologyFindingToVerificationIssue);
}

/**
 * Deterministically lints an entire chapter's ParagraphPair[] against the glossary.
 * Performs a two-pass analysis:
 * - Pass 1 identifies which glossary terms are literally established (via preferred or accepted forms)
 *   across the chapter's paragraphs.
 * - Pass 2 evaluates each paragraph with full cross-paragraph establishment context and aggregates
 *   structured findings and VerificationIssue objects.
 */
export function lintChapterTerminology(
  paragraphs: ReadonlyArray<ParagraphPair>,
  glossary: ReadonlyArray<TerminologyMemoryItem>,
  options: ChapterLintOptions = {}
): ChapterTerminologyLintResult {
  const includeContextualReview =
    options.includeContextualReview !== undefined ? options.includeContextualReview : true;

  const normalizedGlossary = normalizeGlossaryList(glossary);

  // Pass 1: Discover which terms are literally established in at least one paragraph of the chapter
  const establishedTermIdsInChapter = new Set<string>();
  for (const p of paragraphs) {
    const preResult = lintParagraphTerminology(p, normalizedGlossary);
    for (const id of preResult.satisfiedTermIds) {
      establishedTermIdsInChapter.add(id);
    }
    for (const id of preResult.acceptedVariantTermIds) {
      establishedTermIdsInChapter.add(id);
    }
  }

  // Pass 2: Lint each paragraph with chapter establishment context
  const paragraphResults: ParagraphTerminologyLintResult[] = [];
  const allFindings: TerminologyLintFinding[] = [];

  let totalParagraphsChecked = 0;
  let satisfiedOccurrencesCount = 0;
  let acceptedVariantOccurrencesCount = 0;
  let paraphrasedCount = 0;

  for (const p of paragraphs) {
    if (p.englishText?.trim() && p.banglaText?.trim() && !p.missingTranslation) {
      totalParagraphsChecked++;
    }

    const res = lintParagraphTerminology(p, normalizedGlossary, {
      establishedTermIdsInChapter,
    });

    const filteredFindings = includeContextualReview
      ? res.findings
      : res.findings.filter((f) => f.classification !== 'contextual_review');

    paragraphResults.push({
      ...res,
      findings: filteredFindings,
    });

    allFindings.push(...filteredFindings);
    satisfiedOccurrencesCount += res.satisfiedTermIds.length;
    acceptedVariantOccurrencesCount += res.acceptedVariantTermIds.length;
    paraphrasedCount += res.paraphrasedOrOmittedTermIds.length;
  }

  const highSeverityCount = allFindings.filter((f) => f.severity === 'high').length;
  const mediumSeverityCount = allFindings.filter((f) => f.severity === 'medium').length;
  const lowSeverityCount = allFindings.filter((f) => f.severity === 'low').length;
  const definiteViolationCount = allFindings.filter(
    (f) => f.classification === 'definite_violation'
  ).length;
  const contextualReviewCount = allFindings.filter(
    (f) => f.classification === 'contextual_review'
  ).length;

  return {
    findings: allFindings,
    issues: terminologyFindingsToVerificationIssues(allFindings),
    paragraphResults,
    summary: {
      totalParagraphsChecked,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
      definiteViolationCount,
      contextualReviewCount,
      satisfiedOccurrencesCount,
      acceptedVariantOccurrencesCount,
      paraphrasedCount,
    },
  };
}
