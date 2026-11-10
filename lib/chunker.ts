import type {
  CharacterMemoryItem,
  Chapter,
  ParagraphPair,
  ParagraphRefinementAction,
  StyleProfile,
  TerminologyMemoryItem,
  TranslationProject,
  TranslationStyleControls,
  VerificationIssue,
} from './types';

export interface ParsedParagraph {
  index: number;
  text: string;
  sceneBreakAfter?: boolean;
  sceneBreakMarker?: string;
}

export interface TextChunk {
  chunkIndex: number;
  paragraphs: string[];
  paragraphMeta?: ParsedParagraph[];
  startParagraphIndex: number;
  endParagraphIndex: number;
  wordCount: number;
  previousContextParagraphs: string[];
}

export interface ContinuousBanglaEditGuard {
  allowed: boolean;
  missingCount: number;
  untranslatedCount: number;
  missingIndices: number[];
  reason?: string;
}

export interface PipelineCompletionState {
  isComplete: boolean;
  hasMissingTranslations: boolean;
  missingIndices: number[];
  hasUnresolvedHighIssues: boolean;
  chapterStatus: 'completed' | 'needs_review';
  bannerTone: 'success' | 'warning';
  bannerMessage: string;
}

// WeakMap keyed strictly by the string[] array instance created during parsing/chunking.
// Avoids unbounded global string caches and prevents collisions when two manuscripts
// have identical paragraph wording but different scene-break structures or chunk sizes.
const paragraphMetaByArray = new WeakMap<string[], ParsedParagraph[]>();

/**
 * Checks whether a trimmed single line is an explicit ornamental scene separator
 * (e.g., "***", "* * *", "---", "— — —", "___", "###", "~ ~ ~", or "*").
 */
export function isOrnamentalSceneBreak(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(?:\*(?:\s*\*){2,}|-{3,}(?:\s*-+)*|—{2,}(?:\s*—+)*|_{3,}|#{3,}|~(?:\s*~){2,}|\*)$/.test(
    trimmed
  );
}

/**
 * Parses raw manuscript text into prose paragraphs while structurally capturing both:
 * 1. Explicit ornamental scene separators ("***", "* * *", "---", etc., including consecutive markers)
 * 2. Intentional multi-blank-line scene breaks (>= 2 consecutive blank lines between paragraphs)
 *
 * Scene breaks never become translatable paragraphs. Leading separators before the first
 * paragraph and trailing separators after the final paragraph are stripped without creating
 * dangling scene breaks.
 */
export function parseParagraphsWithSceneBreaks(text: string): ParsedParagraph[] {
  if (!text || !text.trim()) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const result: ParsedParagraph[] = [];
  let currentLines: string[] = [];
  let consecutiveBlankLines = 0;
  let pendingBlankSceneBreak = false;
  let pendingOrnamentalMarkers: string[] = [];

  const flushParagraph = () => {
    if (currentLines.length === 0) return;
    const joined = currentLines.join('\n').trim();
    currentLines = [];
    if (!joined) return;
    result.push({
      index: result.length,
      text: joined,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushParagraph();
      if (result.length > 0) {
        consecutiveBlankLines++;
        if (consecutiveBlankLines >= 2) {
          pendingBlankSceneBreak = true;
        }
      }
      continue;
    }

    if (isOrnamentalSceneBreak(trimmed)) {
      flushParagraph();
      if (result.length > 0) {
        pendingOrnamentalMarkers.push(trimmed);
      }
      consecutiveBlankLines = 0;
      continue;
    }

    // Starting a new prose paragraph line: attach any accumulated scene break
    // between the previous paragraph and this new paragraph.
    if (currentLines.length === 0 && result.length > 0) {
      if (pendingOrnamentalMarkers.length > 0) {
        const prev = result[result.length - 1];
        prev.sceneBreakAfter = true;
        prev.sceneBreakMarker = pendingOrnamentalMarkers.join('\n\n');
      } else if (pendingBlankSceneBreak) {
        const prev = result[result.length - 1];
        prev.sceneBreakAfter = true;
        prev.sceneBreakMarker = '';
      }
      pendingOrnamentalMarkers = [];
      pendingBlankSceneBreak = false;
    }

    consecutiveBlankLines = 0;
    currentLines.push(trimmed);
  }

  flushParagraph();
  return result;
}

/**
 * Splits raw English manuscript text into clean non-empty prose paragraphs,
 * preserving paragraph order, stripping standalone ornamental scene separators
 * into structural metadata on the returned array instance, and never splitting
 * sentences or dialogue mid-paragraph.
 */
export function splitIntoParagraphs(text: string): string[] {
  const parsed = parseParagraphsWithSceneBreaks(text);
  const paragraphs = parsed.map((p) => p.text);
  paragraphMetaByArray.set(paragraphs, parsed);
  return paragraphs;
}

/**
 * Joins ParagraphPair items into a continuous manuscript string while preserving
 * both ornamental scene breaks ("***", "* * *", "---") and blank-line scene breaks ("\n\n\n").
 *
 * When `omitEmpty: true` is used, empty paragraphs do not discard scene breaks attached to them:
 * any scene break attached to an omitted paragraph (or to the paragraph preceding an omitted
 * paragraph) is preserved between the surrounding non-empty translated paragraphs, without
 * creating leading or trailing separators.
 */
export function joinParagraphsWithSceneBreaks(
  pairs: Array<
    Pick<
      ParagraphPair,
      'banglaText' | 'englishText' | 'sceneBreakAfter' | 'sceneBreakMarker'
    >
  >,
  options?: {
    field?: 'banglaText' | 'englishText';
    placeholderForMissing?: string;
    omitEmpty?: boolean;
  }
): string {
  const field = options?.field ?? 'banglaText';
  const placeholder = options?.placeholderForMissing;
  const omitEmpty = options?.omitEmpty ?? false;

  const segments: string[] = [];
  let hasEmittedParagraph = false;
  let pendingSceneBreak = false;
  let pendingMarkers: string[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const rawVal = (pair[field] ?? '').trim();
    const textVal = rawVal || (placeholder ?? '');

    if (textVal || !omitEmpty) {
      if (hasEmittedParagraph) {
        if (pendingSceneBreak) {
          if (pendingMarkers.length > 0) {
            segments.push(`\n\n${pendingMarkers.join('\n\n')}\n\n`);
          } else {
            segments.push('\n\n\n');
          }
        } else {
          segments.push('\n\n');
        }
      }

      segments.push(textVal);
      hasEmittedParagraph = true;
      pendingSceneBreak = false;
      pendingMarkers = [];
    }

    if (hasEmittedParagraph && pair.sceneBreakAfter) {
      pendingSceneBreak = true;
      if (pair.sceneBreakMarker && pair.sceneBreakMarker.length > 0) {
        pendingMarkers.push(pair.sceneBreakMarker);
      }
    }
  }

  return segments.join('').trim();
}

/**
 * Counts words in a string accurately.
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Chunks a manuscript into manageable blocks at paragraph boundaries.
 * Never cuts a paragraph, sentence, or dialogue in half, and preserves
 * structural scene-break metadata directly on each returned TextChunk.
 */
export function chunkTextByParagraphs(
  text: string,
  maxWordsPerChunk = 500,
  contextWindow = 2
): TextChunk[] {
  const parsedParagraphs = parseParagraphsWithSceneBreaks(text);
  if (parsedParagraphs.length === 0) return [];

  const allParagraphs = parsedParagraphs.map((p) => p.text);
  paragraphMetaByArray.set(allParagraphs, parsedParagraphs);

  const effectiveMaxWords = Math.max(100, maxWordsPerChunk);
  const chunks: TextChunk[] = [];

  let currentParagraphs: string[] = [];
  let currentMeta: ParsedParagraph[] = [];
  let currentWordCount = 0;
  let chunkStartIdx = 0;

  for (let i = 0; i < parsedParagraphs.length; i++) {
    const meta = parsedParagraphs[i];
    const para = meta.text;
    const paraWords = countWords(para);

    if (
      currentParagraphs.length > 0 &&
      currentWordCount + paraWords > effectiveMaxWords
    ) {
      const prevStart = Math.max(0, chunkStartIdx - contextWindow);
      const previousContextParagraphs = allParagraphs.slice(prevStart, chunkStartIdx);

      chunks.push({
        chunkIndex: chunks.length,
        paragraphs: currentParagraphs,
        paragraphMeta: currentMeta,
        startParagraphIndex: chunkStartIdx,
        endParagraphIndex: i - 1,
        wordCount: currentWordCount,
        previousContextParagraphs,
      });

      currentParagraphs = [para];
      currentMeta = [meta];
      currentWordCount = paraWords;
      chunkStartIdx = i;
    } else {
      currentParagraphs.push(para);
      currentMeta.push(meta);
      currentWordCount += paraWords;
    }
  }

  if (currentParagraphs.length > 0) {
    const prevStart = Math.max(0, chunkStartIdx - contextWindow);
    const previousContextParagraphs = allParagraphs.slice(prevStart, chunkStartIdx);

    chunks.push({
      chunkIndex: chunks.length,
      paragraphs: currentParagraphs,
      paragraphMeta: currentMeta,
      startParagraphIndex: chunkStartIdx,
      endParagraphIndex: parsedParagraphs.length - 1,
      wordCount: currentWordCount,
      previousContextParagraphs,
    });
  }

  return chunks;
}

/**
 * Resolves scene-break metadata for an input array of English paragraphs.
 * Priority:
 * 1. Explicit `paragraphMeta` embedded in `chunks` (passed directly from `chunkTextByParagraphs`).
 * 2. Instance-scoped `WeakMap` lookup on `englishParagraphs` (from `splitIntoParagraphs`).
 * 3. Direct parsing of `englishParagraphs` for standalone array inputs.
 */
function resolveSourceMetadata(
  englishParagraphs: string[],
  chunks?: Array<
    Pick<TextChunk, 'startParagraphIndex' | 'endParagraphIndex' | 'paragraphMeta'>
  >
): ParsedParagraph[] {
  if (chunks && chunks.length > 0 && chunks.every((c) => Array.isArray(c.paragraphMeta))) {
    const fromChunks: ParsedParagraph[] = [];
    for (const chunk of chunks) {
      for (const meta of chunk.paragraphMeta!) {
        fromChunks.push({ ...meta, index: fromChunks.length });
      }
    }
    if (fromChunks.length === englishParagraphs.length) {
      return fromChunks;
    }
  }

  const fromWeakMap = paragraphMetaByArray.get(englishParagraphs);
  if (fromWeakMap && fromWeakMap.length === englishParagraphs.length) {
    return fromWeakMap.map((m, idx) => ({ ...m, index: idx }));
  }

  // Fallback for manually constructed string[] arrays
  const resolved: ParsedParagraph[] = [];
  for (let i = 0; i < englishParagraphs.length; i++) {
    const raw = englishParagraphs[i] ?? '';
    const trimmed = raw.trim();
    if (isOrnamentalSceneBreak(trimmed)) {
      if (resolved.length > 0) {
        const prev = resolved[resolved.length - 1];
        prev.sceneBreakAfter = true;
        prev.sceneBreakMarker = prev.sceneBreakMarker
          ? `${prev.sceneBreakMarker}\n\n${trimmed}`
          : trimmed;
      }
      continue;
    }
    resolved.push({
      index: resolved.length,
      text: trimmed,
    });
  }
  return resolved;
}

/**
 * Validates that explicit chunk boundaries cover the expected paragraph range without gaps or overlaps.
 */
function validateChunkBounds(
  chunks: Array<Pick<TextChunk, 'startParagraphIndex' | 'endParagraphIndex'>>,
  totalExpected: number,
  translatedChunkCount: number
): void {
  if (chunks.length !== translatedChunkCount) {
    throw new Error(
      `Explicit chunk boundary metadata count (${chunks.length}) does not match translated chunk count (${translatedChunkCount}).`
    );
  }

  let expectedStart = 0;
  for (let c = 0; c < chunks.length; c++) {
    const b = chunks[c];
    if (
      !b ||
      typeof b.startParagraphIndex !== 'number' ||
      typeof b.endParagraphIndex !== 'number' ||
      b.startParagraphIndex !== expectedStart ||
      b.endParagraphIndex < b.startParagraphIndex ||
      b.endParagraphIndex >= totalExpected
    ) {
      throw new Error(
        `Invalid or non-contiguous chunk boundary metadata at chunk ${c}: expected start ${expectedStart} within 0..${totalExpected - 1}.`
      );
    }
    expectedStart = b.endParagraphIndex + 1;
  }

  if (expectedStart !== totalExpected) {
    throw new Error(
      `Chunk boundary metadata ends at paragraph ${expectedStart - 1}, but manuscript has ${totalExpected} paragraphs.`
    );
  }
}

/**
 * Index-safe assembly of translated chunks into a complete ParagraphPair list and full Bangla manuscript.
 */
export function assembleTranslatedChunks(
  englishParagraphs: string[],
  translatedChunkParagraphs: string[][],
  chunks?: Array<
    Pick<TextChunk, 'startParagraphIndex' | 'endParagraphIndex' | 'paragraphMeta'>
  >,
  existingPairs?: ParagraphPair[]
): {
  pairs: ParagraphPair[];
  fullBanglaText: string;
  missingIndices: number[];
} {
  const sourceMeta = resolveSourceMetadata(englishParagraphs, chunks);
  const totalExpected = sourceMeta.length;

  if (totalExpected === 0) {
    return { pairs: [], fullBanglaText: '', missingIndices: [] };
  }

  let resolvedChunks: Array<
    Pick<TextChunk, 'startParagraphIndex' | 'endParagraphIndex'>
  >;

  if (chunks !== undefined) {
    validateChunkBounds(chunks, totalExpected, translatedChunkParagraphs.length);
    resolvedChunks = chunks;
  } else if (translatedChunkParagraphs.length <= 1) {
    resolvedChunks = [
      {
        startParagraphIndex: 0,
        endParagraphIndex: totalExpected - 1,
      },
    ];
  } else {
    throw new Error(
      'Missing explicit chunk boundary metadata (chunks): cannot safely assemble multiple translated chunks without risking downstream paragraph index shifts.'
    );
  }

  const banglaSlots: Array<string | undefined> = new Array(totalExpected).fill(
    undefined
  );

  let prevChunkLastBangla = '';

  for (let c = 0; c < translatedChunkParagraphs.length; c++) {
    const bounds = resolvedChunks[c];
    const rawChunk = [...(translatedChunkParagraphs[c] || [])];

    const expectedCount =
      bounds.endParagraphIndex - bounds.startParagraphIndex + 1;

    if (
      c > 0 &&
      rawChunk.length > expectedCount &&
      prevChunkLastBangla.length > 0 &&
      (rawChunk[0] ?? '').trim() === prevChunkLastBangla
    ) {
      rawChunk.shift();
    }

    for (let p = 0; p < expectedCount; p++) {
      const targetIdx = bounds.startParagraphIndex + p;
      if (targetIdx >= totalExpected) break;
      const candidate = rawChunk[p];
      banglaSlots[targetIdx] =
        typeof candidate === 'string' ? candidate.trim() : '';
    }

    for (let p = Math.min(rawChunk.length, expectedCount) - 1; p >= 0; p--) {
      const val = (rawChunk[p] ?? '').trim();
      if (val.length > 0) {
        prevChunkLastBangla = val;
        break;
      }
    }
  }

  const missingIndices: number[] = [];

  const pairs: ParagraphPair[] = sourceMeta.map((meta, idx) => {
    const banglaText = banglaSlots[idx] ?? '';
    const isMissing = banglaText.length === 0;
    if (isMissing) {
      missingIndices.push(idx);
    }

    const existing = existingPairs?.[idx];
    const hadPriorBangla = (existing?.banglaText ?? '').trim();

    const pair: ParagraphPair = {
      index: idx,
      englishText: meta.text,
      banglaText,
    };

    if (existing) {
      if (hadPriorBangla.length > 0 && hadPriorBangla !== banglaText) {
        pair.previousBanglaText = hadPriorBangla;
      } else if (existing.previousBanglaText) {
        pair.previousBanglaText = existing.previousBanglaText;
      }

      if (banglaText === hadPriorBangla && existing.lastRefinementAction) {
        pair.lastRefinementAction = existing.lastRefinementAction;
      }
      if (banglaText === hadPriorBangla && existing.refinementRationale) {
        pair.refinementRationale = existing.refinementRationale;
      }
    }

    if (meta.sceneBreakAfter) {
      pair.sceneBreakAfter = true;
      pair.sceneBreakMarker = meta.sceneBreakMarker ?? '';
    }

    if (isMissing) {
      pair.missingTranslation = true;
    }

    return pair;
  });

  const fullBanglaText = joinParagraphsWithSceneBreaks(pairs, {
    field: 'banglaText',
    omitEmpty: true,
  });

  return { pairs, fullBanglaText, missingIndices };
}

/**
 * Merges a single translated chunk's output into the chapter's ParagraphPair array during Stage 3.
 *
 * Guarantees:
 * 1. Updates ONLY paragraphs inside `[activeChunk.startParagraphIndex .. activeChunk.endParagraphIndex]`.
 * 2. Never modifies or overwrites translations, refinement metadata, or missingTranslation flags
 *    for paragraphs outside the active chunk (`pIdx < startParagraphIndex` or `pIdx > endParagraphIndex`).
 * 3. When re-translating a paragraph inside the active chunk that already had a non-empty translation,
 *    preserves the old translation in `previousBanglaText` and clears stale `lastRefinementAction` /
 *    `refinementRationale` when the new translation differs.
 * 4. Rebuilds `fullBanglaText` across all paragraphs (`0 .. N - 1`), so existing translations in later
 *    chunks are never temporarily dropped during partial progress.
 */
export function mergeStage3ChunkProgress(
  englishParagraphs: string[],
  existingPairs: ParagraphPair[],
  activeChunk: Pick<
    TextChunk,
    'chunkIndex' | 'startParagraphIndex' | 'endParagraphIndex' | 'paragraphMeta'
  >,
  chunkTranslatedParagraphs: string[],
  prevChunkLastBangla = ''
): {
  pairs: ParagraphPair[];
  fullBanglaText: string;
  lastNonEmptyBangla: string;
  chunkMissingIndices: number[];
} {
  const sourceMeta = resolveSourceMetadata(englishParagraphs);
  const expectedCount =
    activeChunk.endParagraphIndex - activeChunk.startParagraphIndex + 1;
  const rawChunk = [...(chunkTranslatedParagraphs || [])];

  if (
    activeChunk.chunkIndex > 0 &&
    rawChunk.length > expectedCount &&
    prevChunkLastBangla.trim().length > 0 &&
    (rawChunk[0] ?? '').trim() === prevChunkLastBangla.trim()
  ) {
    rawChunk.shift();
  }

  let lastNonEmptyBangla = prevChunkLastBangla;
  for (let p = Math.min(rawChunk.length, expectedCount) - 1; p >= 0; p--) {
    const val = (rawChunk[p] ?? '').trim();
    if (val.length > 0) {
      lastNonEmptyBangla = val;
      break;
    }
  }

  const chunkMissingIndices: number[] = [];

  const pairs: ParagraphPair[] = englishParagraphs.map((eng, pIdx) => {
    const existing = existingPairs[pIdx];
    const fallbackMeta = sourceMeta[pIdx];

    // Outside active chunk bounds: preserve existing pair completely untouched
    if (
      pIdx < activeChunk.startParagraphIndex ||
      pIdx > activeChunk.endParagraphIndex
    ) {
      if (existing) {
        return { ...existing, index: pIdx, englishText: eng };
      }
      const untouched: ParagraphPair = {
        index: pIdx,
        englishText: eng,
        banglaText: '',
      };
      if (fallbackMeta?.sceneBreakAfter) {
        untouched.sceneBreakAfter = true;
        untouched.sceneBreakMarker = fallbackMeta.sceneBreakMarker ?? '';
      }
      return untouched;
    }

    // Inside active chunk bounds: update only this slot
    const offset = pIdx - activeChunk.startParagraphIndex;
    const chunkMeta = activeChunk.paragraphMeta?.[offset] ?? fallbackMeta;
    const candidate = rawChunk[offset];
    const newBangla = typeof candidate === 'string' ? candidate.trim() : '';
    const isMissing = newBangla.length === 0;

    if (isMissing) {
      chunkMissingIndices.push(pIdx);
    }

    const hadPriorBangla = (existing?.banglaText ?? '').trim();

    const updated: ParagraphPair = {
      index: pIdx,
      englishText: chunkMeta?.text ?? eng,
      banglaText: newBangla,
    };

    if (existing) {
      if (hadPriorBangla.length > 0 && hadPriorBangla !== newBangla) {
        updated.previousBanglaText = hadPriorBangla;
      } else if (existing.previousBanglaText) {
        updated.previousBanglaText = existing.previousBanglaText;
      }

      // Keep refinement metadata only if translation text is unchanged;
      // clear refinement badge/rationale when replaced by a new Stage 3 translation.
      if (newBangla.length > 0 && newBangla === hadPriorBangla) {
        if (existing.lastRefinementAction) {
          updated.lastRefinementAction = existing.lastRefinementAction;
        }
        if (existing.refinementRationale) {
          updated.refinementRationale = existing.refinementRationale;
        }
      }
    }

    const hasBreak = chunkMeta?.sceneBreakAfter ?? existing?.sceneBreakAfter;
    const breakMarker =
      chunkMeta?.sceneBreakMarker !== undefined
        ? chunkMeta.sceneBreakMarker
        : existing?.sceneBreakMarker;

    if (hasBreak) {
      updated.sceneBreakAfter = true;
      updated.sceneBreakMarker = breakMarker ?? '';
    }

    if (isMissing) {
      updated.missingTranslation = true;
    }

    return updated;
  });

  const fullBanglaText = joinParagraphsWithSceneBreaks(pairs, {
    field: 'banglaText',
    omitEmpty: true,
  });

  return { pairs, fullBanglaText, lastNonEmptyBangla, chunkMissingIndices };
}

/**
 * Aligns raw English text and raw Bangla text into ParagraphPair items using a
 * 3-pass non-greedy identity matching algorithm with duplicate-paragraph ambiguity protection.
 *
 * Matching Policy:
 * - Pass 1 (Exact-Index Reservation): Reserves `existingPairs[idx]` for `engParsed[idx]`
 *   before any cross-index search occurs, provided their English text matches AND either:
 *   (a) total paragraph count is unchanged (`engParsed.length === existingPairs.length`),
 *   (b) the paragraph text is unique in both old and new (`newIndices.length === 1 && oldIndices.length === 1`), or
 *   (c) all occurrences of a repeated text sit at the exact same indices in both old and new.
 * - Pass 2 (Cross-Index Shifted Match): Matches remaining paragraphs across different indices
 *   ONLY when the paragraph text appears uniquely in both `engParsed` and `existingPairs`
 *   (`newIndices.length === 1 && oldIndices.length === 1`) and its old index was not already reserved.
 *   Duplicate paragraphs shifted by insertions/deletions are treated as ambiguous and left unmatched
 *   rather than guessing which instance corresponds to which translation.
 * - Pass 3 (In-Place Wording Edit): When total paragraph count is unchanged (`!hasInsertionOrDeletion`),
 *   an unmatched slot at `idx` whose new text is unique (`newIndices.length === 1`) and whose old slot
 *   at `idx` is also unused and unique (`oldIndices.length === 1`) preserves `existingPairs[idx]` in place.
 *   When insertion/deletion and wording edits occur together (`hasInsertionOrDeletion === true`),
 *   Pass 3 is skipped so edited paragraphs are never mismatched to shifted slots.
 */
export function alignParagraphs(
  englishText: string,
  banglaText: string,
  existingPairs?: ParagraphPair[]
): ParagraphPair[] {
  const engParsed = parseParagraphsWithSceneBreaks(englishText);
  const bnParsed = parseParagraphsWithSceneBreaks(banglaText);
  const hasExplicitBanglaInput = banglaText.trim().length > 0;
  const hasExisting = Boolean(existingPairs && existingPairs.length > 0);
  const hasInsertionOrDeletion =
    hasExisting && existingPairs!.length !== engParsed.length;

  const newIndicesByText = new Map<string, number[]>();
  for (let i = 0; i < engParsed.length; i++) {
    const key = engParsed[i].text.trim();
    const list = newIndicesByText.get(key) || [];
    list.push(i);
    newIndicesByText.set(key, list);
  }

  const oldIndicesByText = new Map<string, number[]>();
  if (existingPairs) {
    for (let i = 0; i < existingPairs.length; i++) {
      const key = existingPairs[i].englishText.trim();
      const list = oldIndicesByText.get(key) || [];
      list.push(i);
      oldIndicesByText.set(key, list);
    }
  }

  const matchedByNewIndex = new Map<number, ParagraphPair>();
  const usedExistingIndices = new Set<number>();

  if (existingPairs && existingPairs.length > 0) {
    // Pass 1: Reserve unambiguous exact-index matches first so an earlier edited/inserted
    // paragraph can never steal a later unchanged paragraph's translation.
    for (let idx = 0; idx < engParsed.length; idx++) {
      const existingAtIdx = existingPairs[idx];
      if (!existingAtIdx) continue;

      const normText = engParsed[idx].text.trim();
      if (existingAtIdx.englishText.trim() !== normText) continue;

      const newList = newIndicesByText.get(normText) || [];
      const oldList = oldIndicesByText.get(normText) || [];

      const isUnique = newList.length === 1 && oldList.length === 1;
      const samePositions =
        newList.length === oldList.length &&
        newList.every((val, k) => val === oldList[k]);

      if (!hasInsertionOrDeletion || isUnique || samePositions) {
        matchedByNewIndex.set(idx, existingAtIdx);
        usedExistingIndices.add(idx);
      }
    }

    // Pass 2: Match shifted paragraphs across indices ONLY when their English text
    // is unique in both old and new manuscripts (ambiguous duplicates are never guessed).
    for (let idx = 0; idx < engParsed.length; idx++) {
      if (matchedByNewIndex.has(idx)) continue;

      const normText = engParsed[idx].text.trim();
      const newList = newIndicesByText.get(normText) || [];
      const oldList = oldIndicesByText.get(normText) || [];

      if (newList.length === 1 && oldList.length === 1) {
        const oldIdx = oldList[0];
        if (!usedExistingIndices.has(oldIdx)) {
          matchedByNewIndex.set(idx, existingPairs[oldIdx]);
          usedExistingIndices.add(oldIdx);
        }
      }
    }

    // Pass 3: In-place wording edit when total paragraph count did NOT change
    // and neither the old text nor the new text is a duplicate in the chapter.
    if (!hasInsertionOrDeletion) {
      for (let idx = 0; idx < engParsed.length; idx++) {
        if (matchedByNewIndex.has(idx)) continue;
        if (usedExistingIndices.has(idx)) continue;

        const existingAtIdx = existingPairs[idx];
        if (!existingAtIdx) continue;

        const newNorm = engParsed[idx].text.trim();
        const oldNorm = existingAtIdx.englishText.trim();
        const newList = newIndicesByText.get(newNorm) || [];
        const oldList = oldIndicesByText.get(oldNorm) || [];

        if (newList.length === 1 && oldList.length === 1) {
          matchedByNewIndex.set(idx, existingAtIdx);
          usedExistingIndices.add(idx);
        }
      }
    }
  }

  return engParsed.map((engMeta, index) => {
    const matchedExisting = matchedByNewIndex.get(index);

    let resolvedBangla = '';
    if (hasExplicitBanglaInput) {
      if (bnParsed.length === engParsed.length) {
        resolvedBangla = bnParsed[index]?.text ?? '';
      } else if (matchedExisting) {
        resolvedBangla = matchedExisting.banglaText ?? '';
      } else {
        resolvedBangla = '';
      }
    } else {
      resolvedBangla = matchedExisting?.banglaText ?? '';
    }

    const trimmedBangla = resolvedBangla.trim();

    const pair: ParagraphPair = {
      index,
      englishText: engMeta.text,
      banglaText: trimmedBangla,
      previousBanglaText: matchedExisting?.previousBanglaText,
      lastRefinementAction: matchedExisting?.lastRefinementAction,
      refinementRationale: matchedExisting?.refinementRationale,
    };

    // Newly parsed English manuscript is the sole source of truth for scene breaks
    if (engMeta.sceneBreakAfter) {
      pair.sceneBreakAfter = true;
      pair.sceneBreakMarker = engMeta.sceneBreakMarker ?? '';
    }

    // Preserve missingTranslation if previously flagged missing, or if an already-translated chapter
    // had a paragraph become unmatched due to an ambiguous edit/insertion.
    const chapterHadTranslations =
      Boolean(existingPairs) &&
      existingPairs!.some(
        (p) => p.banglaText.trim().length > 0 || Boolean(p.missingTranslation)
      );

    if (trimmedBangla.length === 0) {
      if (matchedExisting?.missingTranslation || chapterHadTranslations) {
        pair.missingTranslation = true;
      }
    }

    return pair;
  });
}

/**
 * Determines whether the Continuous Bangla Editor can safely allow full-chapter editing.
 * Full-chapter Bangla editing is enabled ONLY when every English paragraph slot has a non-empty
 * Bangla translation and no paragraph is flagged with `missingTranslation`.
 */
export function canEditContinuousBangla(
  pairs: ParagraphPair[]
): ContinuousBanglaEditGuard {
  if (!pairs || pairs.length === 0) {
    return {
      allowed: false,
      missingCount: 0,
      untranslatedCount: 0,
      missingIndices: [],
      reason:
        'Full-chapter Bangla editing is unavailable because this chapter has no paragraphs yet.',
    };
  }

  const missingIndices = pairs
    .filter(
      (p) => Boolean(p.missingTranslation) || p.banglaText.trim().length === 0
    )
    .map((p) => p.index);
  const missingCount = pairs.filter((p) => Boolean(p.missingTranslation)).length;
  const untranslatedCount = pairs.filter(
    (p) => p.banglaText.trim().length === 0
  ).length;

  if (missingCount > 0 || untranslatedCount > 0) {
    const formattedList = missingIndices.map((idx) => `#${idx + 1}`).join(', ');
    return {
      allowed: false,
      missingCount,
      untranslatedCount,
      missingIndices,
      reason:
        missingCount > 0
          ? `Full-chapter Bangla editing is temporarily unavailable because paragraph alignment would be ambiguous while Paragraph ${formattedList} ${
              missingIndices.length === 1 ? 'is' : 'are'
            } missing a translation. Please fill or repair the missing paragraph(s) in Paragraph Studio first.`
          : `Full-chapter Bangla editing is temporarily unavailable because ${untranslatedCount} paragraph(s) (Paragraph ${formattedList}) are not yet translated. Please run Stage 3 Translation or fill individual paragraphs in Paragraph Studio first.`,
    };
  }

  return {
    allowed: true,
    missingCount: 0,
    untranslatedCount: 0,
    missingIndices: [],
  };
}

/**
 * Safely applies an edit from the Continuous Bangla Editor while guaranteeing that
 * `chapter.translatedText` and `chapter.paragraphs` never disagree.
 *
 * - If any paragraph in `existingPairs` is missing/untranslated (`!canEditContinuousBangla`),
 *   the edit is rejected and the canonical state derived from `existingPairs` is returned unchanged.
 * - If the edited Bangla text has a different paragraph count than the English source
 *   (`bnParsed.length !== engParsed.length`), the edit is rejected so paragraphs are never
 *   silently shifted or dropped, and `translatedText` stays synchronized with `existingPairs`.
 */
export function applyContinuousBanglaEdit(
  englishText: string,
  newBanglaText: string,
  existingPairs: ParagraphPair[]
): {
  pairs: ParagraphPair[];
  paragraphs: ParagraphPair[];
  translatedText: string;
  applied: boolean;
  reason?: string;
} {
  const guard = canEditContinuousBangla(existingPairs);
  const canonicalBangla = joinParagraphsWithSceneBreaks(existingPairs, {
    field: 'banglaText',
    omitEmpty: true,
  });

  if (!guard.allowed) {
    return {
      pairs: existingPairs,
      paragraphs: existingPairs,
      translatedText: canonicalBangla,
      applied: false,
      reason: guard.reason,
    };
  }

  const engParsed = parseParagraphsWithSceneBreaks(englishText);
  const bnParsed = parseParagraphsWithSceneBreaks(newBanglaText);

  if (bnParsed.length !== engParsed.length) {
    return {
      pairs: existingPairs,
      paragraphs: existingPairs,
      translatedText: canonicalBangla,
      applied: false,
      reason: `Cannot apply full-chapter Bangla edit because paragraph count (${bnParsed.length}) does not match the English source paragraph count (${engParsed.length}). Please use Paragraph Studio to edit individual paragraphs safely.`,
    };
  }

  const aligned = alignParagraphs(englishText, newBanglaText, existingPairs).map(
    (pair, idx) => {
      const prior = existingPairs[idx];
      if (prior && pair.banglaText !== prior.banglaText.trim()) {
        return {
          ...pair,
          previousBanglaText: prior.banglaText,
          lastRefinementAction: 'manual_edit' as const,
        };
      }
      return pair;
    }
  );
  const synchronizedBangla = joinParagraphsWithSceneBreaks(aligned, {
    field: 'banglaText',
    omitEmpty: true,
  });

  return {
    pairs: aligned,
    paragraphs: aligned,
    translatedText: synchronizedBangla,
    applied: true,
  };
}

/**
 * Computes consistent completion status and banner messaging for the 5-stage pipeline,
 * ensuring a chapter is never marked completed or given an unqualified green success message
 * while missing translations, an incomplete Stage 5 audit, or unresolved high-severity verification issues remain.
 */
export function getPipelineCompletionState(
  paragraphs: ParagraphPair[],
  verificationIssuesOrHasHigh?: VerificationIssue[] | boolean,
  options?: {
    isVerificationAuditComplete?: boolean;
  }
): PipelineCompletionState {
  const missingIndices = (paragraphs || [])
    .filter(
      (p) => Boolean(p.missingTranslation) || p.banglaText.trim().length === 0
    )
    .map((p) => p.index);

  const hasMissingTranslations = missingIndices.length > 0;
  const hasUnresolvedHighIssues =
    typeof verificationIssuesOrHasHigh === 'boolean'
      ? verificationIssuesOrHasHigh
      : (verificationIssuesOrHasHigh || []).some(
          (i) => i.severity === 'high' && !i.resolved
        );
  const isAuditComplete = options?.isVerificationAuditComplete ?? true;

  const isComplete =
    paragraphs.length > 0 &&
    !hasMissingTranslations &&
    !hasUnresolvedHighIssues &&
    isAuditComplete;

  if (hasMissingTranslations) {
    return {
      isComplete: false,
      hasMissingTranslations: true,
      missingIndices,
      hasUnresolvedHighIssues,
      chapterStatus: 'needs_review',
      bannerTone: 'warning',
      bannerMessage: `Pipeline finished with incomplete translations: ${missingIndices.length} ${
        missingIndices.length === 1 ? 'paragraph is' : 'paragraphs are'
      } missing a Bangla translation (Paragraph ${missingIndices
        .map((idx) => `#${idx + 1}`)
        .join(', ')}). Editorial review required before completion.`,
    };
  }

  if (hasUnresolvedHighIssues) {
    return {
      isComplete: false,
      hasMissingTranslations: false,
      missingIndices: [],
      hasUnresolvedHighIssues: true,
      chapterStatus: 'needs_review',
      bannerTone: 'warning',
      bannerMessage:
        'Pipeline finished: Accuracy Verification flagged high-priority issues that require editorial review.',
    };
  }

  if (!isAuditComplete) {
    return {
      isComplete: false,
      hasMissingTranslations: false,
      missingIndices: [],
      hasUnresolvedHighIssues: false,
      chapterStatus: 'needs_review',
      bannerTone: 'warning',
      bannerMessage:
        'Accuracy Verification audit is incomplete or outdated. Re-run Stage 5 to verify all paragraphs.',
    };
  }

  return {
    isComplete: true,
    hasMissingTranslations: false,
    missingIndices: [],
    hasUnresolvedHighIssues: false,
    chapterStatus: 'completed',
    bannerTone: 'success',
    bannerMessage:
      'All 5 stages of the Adaptive Literary Translation Pipeline completed.',
  };
}

/**
 * Updates a single ParagraphPair with a new Bangla translation (from manual edit, paragraph refinement,
 * or revert) while maintaining accurate `missingTranslation` state and preserving scene-break metadata.
 */
export function updateParagraphTranslation(
  pair: ParagraphPair,
  newBanglaText: string,
  options?: {
    previousBanglaText?: string;
    lastRefinementAction?: ParagraphRefinementAction | 'stage_4_editorial' | 'manual_edit';
    refinementRationale?: string;
    markEmptyAsMissing?: boolean;
  }
): ParagraphPair {
  const trimmed = (newBanglaText ?? '').trim();
  const hadPriorTranslationOrAttempt =
    Boolean(pair.missingTranslation) ||
    pair.banglaText.trim().length > 0 ||
    Boolean(options?.markEmptyAsMissing);

  const updated: ParagraphPair = {
    ...pair,
    banglaText: newBanglaText,
    previousBanglaText:
      options && 'previousBanglaText' in options
        ? options.previousBanglaText
        : pair.previousBanglaText,
    lastRefinementAction:
      options && 'lastRefinementAction' in options
        ? options.lastRefinementAction
        : pair.lastRefinementAction,
    refinementRationale:
      options && 'refinementRationale' in options
        ? options.refinementRationale
        : pair.refinementRationale,
  };

  if (trimmed.length > 0) {
    delete updated.missingTranslation;
  } else if (hadPriorTranslationOrAttempt) {
    updated.missingTranslation = true;
  } else {
    delete updated.missingTranslation;
  }

  return updated;
}

/**
 * Reverts a single ParagraphPair to its stored `previousBanglaText` (including when `previousBanglaText`
 * is an empty string `""`).
 *
 * Guarantees:
 * - Uses an explicit `undefined`/`null` check rather than truthiness so empty previous translations can be reverted to.
 * - Preserves the current `banglaText` in `previousBanglaText` so undo behavior never loses the current translation.
 * - Clears stale `lastRefinementAction` and `refinementRationale` badges upon revert.
 * - Marks `missingTranslation: true` if reverting to an empty string, and clears `missingTranslation` if reverting to non-empty text.
 */
export function revertParagraphTranslation(pair: ParagraphPair): ParagraphPair {
  if (
    !pair ||
    pair.previousBanglaText === undefined ||
    pair.previousBanglaText === null
  ) {
    return pair;
  }

  return updateParagraphTranslation(pair, pair.previousBanglaText, {
    previousBanglaText: pair.banglaText,
    lastRefinementAction: undefined,
    refinementRationale: undefined,
    markEmptyAsMissing: true,
  });
}

/**
 * Marks a single verification issue as resolved and computes the resulting chapter completion state
 * via `getPipelineCompletionState()`, ensuring dismissing one issue never marks a chapter `completed`
 * while missing translations, an incomplete Stage 5 audit, or other unresolved high-severity issues remain.
 */
export function resolveVerificationIssue(
  paragraphs: ParagraphPair[],
  issues: VerificationIssue[],
  issueId: string,
  options?: {
    isVerificationAuditComplete?: boolean;
  }
): {
  updatedIssues: VerificationIssue[];
  completion: PipelineCompletionState;
  chapterStatus: 'completed' | 'needs_review';
} {
  const updatedIssues = (issues || []).map((issue) =>
    issue.id === issueId ? { ...issue, resolved: true } : issue
  );
  const completion = getPipelineCompletionState(
    paragraphs,
    updatedIssues,
    options
  );
  return {
    updatedIssues,
    completion,
    chapterStatus: completion.chapterStatus,
  };
}

/**
 * Applies Stage 4 editorial output across a chapter's ParagraphPair list while clearing
 * `missingTranslation` when non-empty Bangla text is produced and keeping `missingTranslation: true`
 * if a paragraph remains empty.
 */
export function applyStage4EditsToParagraphs(
  pairs: ParagraphPair[],
  editedParagraphs: string[]
): ParagraphPair[] {
  return pairs.map((pair, idx) => {
    const candidate = (editedParagraphs[idx] ?? '').trim();
    const resolvedBangla = candidate || pair.banglaText;
    const isStillEmpty = resolvedBangla.trim().length === 0;

    const updated: ParagraphPair = {
      ...pair,
      previousBanglaText: pair.banglaText,
      banglaText: resolvedBangla,
    };

    if (!isStillEmpty) {
      updated.lastRefinementAction = 'stage_4_editorial';
      delete updated.missingTranslation;
    } else {
      updated.missingTranslation = true;
    }

    return updated;
  });
}

/**
 * Automatically detects chapter headings in a manuscript ("Chapter 1", "CHAPTER I", "Chapter One", etc.)
 * and extracts the heading into chapter `title` metadata while stripping it from `content`
 * for both single-chapter and multi-chapter manuscripts.
 */
export function splitManuscriptIntoChapters(
  rawText: string,
  defaultTitle = 'Chapter 1'
): Array<{ title: string; content: string }> {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const chapterRegex =
    /^[ \t]*(?:CHAPTER|Chapter|অধ্যায়)\s+(?:[0-9]+|[IVXLCDM]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty)(?:[:.\s—–-].*)?$/gm;
  const matches = [...normalized.matchAll(chapterRegex)];

  if (matches.length === 0) {
    return [{ title: defaultTitle, content: normalized }];
  }

  const result: Array<{ title: string; content: string }> = [];

  const firstMatchIdx = matches[0].index ?? 0;
  if (firstMatchIdx > 0) {
    const preamble = normalized.slice(0, firstMatchIdx).trim();
    if (preamble.length > 0) {
      result.push({
        title: defaultTitle,
        content: preamble,
      });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const startIdx = currentMatch.index ?? 0;
    const headingLine = currentMatch[0].trim();
    const contentStart = startIdx + currentMatch[0].length;
    const endIdx =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? normalized.length)
        : normalized.length;

    const body = normalized.slice(contentStart, endIdx).trim();
    if (body.length > 0) {
      result.push({
        title: headingLine,
        content: body,
      });
    } else if (matches.length === 1) {
      result.push({
        title: headingLine,
        content: '',
      });
    }
  }

  return result.length > 0
    ? result
    : [{ title: defaultTitle, content: normalized }];
}

/**
 * Formats Character Memory and Terminology Memory into an authoritative instruction block
 * for Gemini translation and editing calls.
 */
export function formatMemoryPromptBlock(
  characters: CharacterMemoryItem[],
  terminology: TerminologyMemoryItem[]
): string {
  const lines: string[] = [];

  if (characters.length > 0) {
    lines.push('ESTABLISHED CHARACTER MEMORY (MUST RESPECT EXACT BANGLA NAMES & SPEAKING STYLES):');
    for (const c of characters) {
      lines.push(
        `- ${c.englishName} → বাংলা নাম: "${c.banglaName}" | Pronouns/Gender: ${c.pronouns || 'As in context'} | Relationships: ${c.relationships || 'N/A'} | Personality & Speech: ${c.personality}; ${c.speakingStyle}${c.notes ? ` (${c.notes})` : ''}`
      );
    }
  }

  if (terminology.length > 0) {
    lines.push('\nESTABLISHED TERMINOLOGY & GLOSSARY MEMORY (USE THESE EXACT BANGLA TRANSLATIONS):');
    for (const t of terminology) {
      lines.push(
        `- "${t.englishTerm}" (${t.category}) → "${t.banglaTranslation}"${t.notes ? ` — Note: ${t.notes}` : ''}`
      );
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No prior character or terminology overrides established yet.';
}

/**
 * Formats Style Profile and Style Controls into an adaptive literary directive.
 */
export function formatStyleDirectiveBlock(
  styleProfile: StyleProfile | null,
  controls: TranslationStyleControls
): string {
  const directives: string[] = [];

  if (styleProfile && controls.preserveAuthorStyle) {
    directives.push(`AUTHOR VOICE & STYLE PROFILE (ADAPT BANGLA TO MIRROR THIS VOICE):
- Overall Literary Voice: ${styleProfile.overallVoice}
- Sentence Structure & Rhythm: ${styleProfile.sentenceStructure}
- Vocabulary Complexity: ${styleProfile.vocabularyComplexity}
- Narrative Perspective (POV): ${styleProfile.narrativePerspective}
- Dialogue Style & Speech Patterns: ${styleProfile.dialogueStyle}
- Emotional Intensity: ${styleProfile.emotionalIntensity}
- Descriptive & Atmospheric Techniques: ${styleProfile.descriptiveTechniques}
- Metaphors, Symbolism & Imagery: ${styleProfile.metaphorsAndImagery}
- Literary Characteristics: ${styleProfile.literaryCharacteristics}
- Language Register: ${styleProfile.languageRegister}
- Bangla Adaptation Strategy: ${styleProfile.banglaAdaptationStrategy}
${styleProfile.customNotes ? `- Translator Custom Direction: ${styleProfile.customNotes}` : ''}`);
  }

  directives.push(`TRANSLATION STYLE CONTROLS:
- Preserve Original Author's Style: ${controls.preserveAuthorStyle ? 'ON (Strict adherence to authorial voice)' : 'OFF (Standard literary Bangla)'}
- Bangla Naturalness: ${controls.naturalness === 'highly_natural' ? 'Highly Natural (Idiomatic, native-born Bangla flow; zero English syntax residue)' : 'Balanced (Natural Bangla while staying close to source phrasing structure)'}
- Literary Expression: ${controls.literaryExpression === 'rich' ? 'Rich & Evocative (Deep literary resonance and expressive Bangla diction)' : 'Subtle & Restrained (Understated, clean literary prose)'}
- Language Complexity: ${controls.languageComplexity.toUpperCase()}
- Dialogue Treatment: ${controls.dialogueStyle === 'more_conversational' ? 'More Conversational (Authentic spoken Bangla cadence and natural colloquial phrasing in dialogue)' : 'Faithful (Closely mirrors original dialogue register)'}
- Translation Approach: ${controls.translationApproach === 'expressive_adaptation' ? 'More Expressive Adaptation (Adapt idioms and cadence creatively so it reads as originally composed in Bangla, without altering plot or meaning)' : 'Faithful Literary Translation (Creative yet closely anchored to every nuance of the original text)'}`);

  return directives.join('\n\n');
}

/**
 * Exports a single chapter's Bangla translation as clean TXT while preserving scene breaks.
 */
export function formatChapterExport(projectTitle: string, chapter: Chapter): string {
  const header = `${projectTitle}\n${chapter.title}\n${'—'.repeat(40)}\n\n`;
  const body =
    chapter.paragraphs.length > 0
      ? joinParagraphsWithSceneBreaks(chapter.paragraphs, {
          field: 'banglaText',
          placeholderForMissing: '[অনুবাদ বাকি]',
        })
      : chapter.translatedText;
  return `${header}${body.trim()}\n`;
}

/**
 * Exports the entire translated story across all chapters as a unified Bangla TXT manuscript,
 * preserving scene breaks within every chapter.
 */
export function formatFullStoryExport(project: TranslationProject): string {
  const header = `${project.title}\nমূল লেখক: ${project.authorName || 'অজ্ঞাত'}\nGolpoTranslate সাহিত্য অনুবাদ স্টুডিও\n${'═'.repeat(48)}\n\n`;
  const chaptersText = project.chapters
    .map((ch) => {
      const body =
        ch.paragraphs.length > 0
          ? joinParagraphsWithSceneBreaks(ch.paragraphs, {
              field: 'banglaText',
              omitEmpty: true,
            })
          : ch.translatedText.trim();
      return `${ch.title}\n${'─'.repeat(30)}\n\n${body || '[এই অধ্যায়টি এখনও অনূদিত হয়নি]'}`;
    })
    .join('\n\n\n');

  return `${header}${chaptersText}\n`;
}

function isPlaceholderAuthorName(authorName?: string | null): boolean {
  const trimmed = (authorName ?? '').trim();
  if (!trimmed) return true;
  return /^(unknown(\s+author)?|anonymous|n\/a|none|placeholder|অজ্ঞাত(\s+লেখক)?)$/i.test(
    trimmed
  );
}

function isPlaceholderChapterTitle(
  chapterTitle: string | undefined | null,
  chapterNumber: number,
  projectTitle: string,
  totalChapters: number
): boolean {
  const trimmed = (chapterTitle ?? '').trim();
  if (!trimmed) return true;
  if (/^chapter\s*\d*$/i.test(trimmed)) return true;
  if (/^untitled(\s+chapter)?$/i.test(trimmed)) return true;
  if (
    totalChapters === 1 &&
    trimmed.toLowerCase() === (projectTitle ?? '').trim().toLowerCase()
  ) {
    return true;
  }
  if (
    new RegExp(`^chapter\\s*${chapterNumber}\\s*:\\s*untitled$`, 'i').test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Exports a bilingual manuscript with Original English and Translated Bangla separated clearly,
 * preserving scene breaks and Markdown italics in both English and Bangla sections while omitting
 * placeholder metadata.
 */
export function formatBilingualExport(project: TranslationProject): string {
  const lines: string[] = [`PROJECT: ${project.title}`];

  if (!isPlaceholderAuthorName(project.authorName)) {
    lines.push(`ORIGINAL AUTHOR: ${project.authorName.trim()}`);
  }

  lines.push(`GENRE: ${project.genre || 'Literary Fiction'}`);
  lines.push(`SOURCE: ${project.sourceLanguage || 'English'}`);
  lines.push(`TARGET: ${project.targetLanguage || 'Bangla (বাংলা)'}`);
  lines.push('====================================================================');
  lines.push('');

  for (const ch of project.chapters) {
    if (
      !isPlaceholderChapterTitle(
        ch.title,
        ch.number,
        project.title,
        project.chapters.length
      )
    ) {
      lines.push(`CHAPTER ${ch.number}: ${ch.title}`);
      lines.push('--------------------------------------------------------------------');
      lines.push('');
    }
    lines.push('--- [ORIGINAL ENGLISH] ---');
    const englishBody =
      ch.paragraphs.length > 0
        ? joinParagraphsWithSceneBreaks(ch.paragraphs, {
            field: 'englishText',
            omitEmpty: true,
          })
        : ch.originalText.trim();
    lines.push(englishBody);
    lines.push('');
    lines.push('--- [TRANSLATED BANGLA (বাংলা অনুবাদ)] ---');
    const banglaBody =
      ch.paragraphs.length > 0
        ? joinParagraphsWithSceneBreaks(ch.paragraphs, {
            field: 'banglaText',
            omitEmpty: true,
          })
        : ch.translatedText.trim();
    lines.push(banglaBody || '[Translation Pending]');
    lines.push('');
    lines.push('====================================================================');
    lines.push('');
  }

  return lines.join('\n');
}
