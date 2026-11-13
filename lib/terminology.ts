import type {
  CharacterMemoryItem,
  ChapterStatus,
  EditorialChange,
  ParagraphPair,
  Stage1CoverageMetadata,
  StoryContextProfile,
  StyleProfile,
  TerminologyCategory,
  TerminologyFindingClassification,
  TerminologyFindingReason,
  TerminologyLintFinding,
  TerminologyMemoryItem,
  TerminologySource,
  TranslationProject,
  VerificationIssue,
  VerificationIssueType,
  VerificationReport,
} from './types';
import {
  chunkTextByParagraphs,
  joinParagraphsWithSceneBreaks,
  type TextChunk,
} from './chunker';

declare module './types' {
  interface TerminologyMemoryItem {
    aliases?: string[];
  }
  interface TerminologyLintFinding {
    code?: string;
  }
}

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
  {
    englishKeys: ['baker', 'bakers'],
    banglaVariants: ['রুটিওয়ালা', 'রুটিওয়ালা', 'বেকার', 'পাচক', 'রুটি প্রস্তুতকারক'],
  },
  {
    englishKeys: ['bakery', 'bakeries', 'bakehouse'],
    banglaVariants: ['বেকারি', 'রুটিঘর', 'রুটির দোকান', 'রুটিখানা'],
  },
  {
    englishKeys: ['trawler', 'trawlers'],
    banglaVariants: ['ট্রলার', 'মাছ ধরার জাহাজ', 'জাহাজ', 'নৌকা', 'যান্ত্রিক নৌকা'],
  },
  {
    englishKeys: ['loupe', 'loupes', 'magnifying glass'],
    banglaVariants: ['আতশ কাচ', 'ম্যাগনিফাইং গ্লাস', 'বিবর্ধক কাচ'],
  },
  {
    englishKeys: ['quoin', 'quoins', 'brass quoin', 'brass quoins'],
    banglaVariants: ['কোইন', 'পিতলের কোইন', 'কীলক', 'পিতলের কীলক', 'কয়েন', 'পিতলের কয়েন', 'মুদ্রা'],
  },
  {
    englishKeys: ['rag paper', 'rag sheet', 'rag sheets', 'cream rag paper', 'damp rag paper', 'damp rag sheet'],
    banglaVariants: [
      'র্যাগ কাগজ',
      'র্যাগ কাগজের শিট',
      'র্যাগ শিট',
      'তুলোট কাগজ',
      'রাগ কাগজ',
      'রাগ শিট',
      'রাগ কাগজের শিট',
    ],
  },
  {
    englishKeys: ['roof-gutter', 'roof-gutters', 'roof gutter', 'roof gutters', 'blocked gutter', 'rain gutter'],
    banglaVariants: [
      'ছাদের জলনিকাশি নালা',
      'জলনিকাশি নালা',
      'বৃষ্টির জল নামার নালা',
      'ছাদের নালা',
      'কার্নিশ',
      'ছাদের কার্নিশ',
      'নর্দমা',
    ],
  },
  {
    englishKeys: ['tea-chest', 'tea-chests', 'tea chest', 'tea chests', 'chest', 'chests'],
    banglaVariants: ['চায়ের বাক্স', 'চায়ের পেটি', 'কাঠের বাক্স', 'বাক্স', 'সিন্দুক'],
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
  if (items === null || items === undefined) return [];

  const rawEntries: string[] = [];
  if (typeof items === 'string') {
    if (!items.trim()) return [];
    rawEntries.push(...items.split(','));
  } else if (Array.isArray(items)) {
    for (const raw of items) {
      if (typeof raw !== 'string') continue;
      if (raw.includes(',')) {
        rawEntries.push(...raw.split(','));
      } else {
        rawEntries.push(raw);
      }
    }
  } else {
    return [];
  }

  const seen = new Set<string>(excludeNormalized);
  const result: string[] = [];

  for (const raw of rawEntries) {
    const normalized = normalizeBanglaUnicode(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * Parses comma-separated string input (or an array of strings) for `acceptedAlternatives`
 * or `avoidTranslations`:
 * - Splits comma-separated input on `,`.
 * - Trims leading and trailing whitespace and normalizes Unicode via `normalizeBanglaUnicode`
 *   (preserving meaningful Bangla/English spelling and casing without rewriting or translating).
 * - Removes empty entries.
 * - Deduplicates entries consistently in order of first appearance (and excludes any entries in `excludeNormalized`).
 * - Produces `[]` for empty, whitespace-only, `null`, or `undefined` input.
 * - Pure and side-effect free: never mutates a supplied array.
 */
export function parseCommaSeparatedGlossaryList(
  input: string | ReadonlyArray<string> | null | undefined,
  excludeNormalized: ReadonlySet<string> = new Set()
): string[] {
  return deduplicateBanglaList(input, excludeNormalized);
}

/**
 * Splits a raw English glossary term into its surface matching phrase and an optional
 * trailing parenthetical sense qualifier (e.g. "school (fish)" -> { surfaceTerm: "school", parentheticalSense: "fish" }).
 */
export function extractEnglishSurfaceAndSense(rawEnglishTerm: string): {
  surfaceTerm: string;
  parentheticalSense?: string;
} {
  const normalized = normalizeEnglishTerm(rawEnglishTerm);
  if (!normalized) {
    return { surfaceTerm: '' };
  }
  const match = /^(.+?)\s*\(([^()]+)\)$/.exec(normalized);
  if (
    match &&
    match[1].trim().length > 0 &&
    /[A-Za-z0-9]/.test(match[1]) &&
    match[2].trim().length > 0
  ) {
    return {
      surfaceTerm: match[1].trim(),
      parentheticalSense: match[2].trim(),
    };
  }
  return { surfaceTerm: normalized };
}

/**
 * Returns the bare English surface phrase used to match occurrences in prose
 * (stripping any trailing parenthetical sense qualifier such as "(fish)" or "(river)").
 */
export function getEnglishSurfaceTerm(englishTerm: string): string {
  return extractEnglishSurfaceAndSense(englishTerm).surfaceTerm;
}

export interface SeparatedGlossaryRendering {
  canonicalBangla: string;
  explanatoryMeaning?: string;
  isLiteralBracketedMotif: boolean;
  isAmbiguousLegacyParenthetical: boolean;
}

/**
 * Conservatively separates a canonical Bangla rendering from an embedded trailing
 * explanatory parenthetical meaning (e.g., `"হ্যারো-টাইড (সর্বনাশা জোয়ার)"` ->
 * `{ canonicalBangla: "হ্যারো-টাইড", explanatoryMeaning: "সর্বনাশা জোয়ার" }`):
 * - Preserves literal bracketed/parenthetical motifs (such as `*(Fine.)*` -> `*(ঠিক আছে।)*`
 *   or `(Not fine. Paid.)` -> `(ঠিক নেই। শোধ।)`) when the entire English term or Bangla
 *   translation is a bracketed motif.
 * - For non-bracketed terms, if `banglaTranslation` contains a single clean trailing parenthetical
 *   `BaseTerm (ExplanatoryGloss)` where both `BaseTerm` and `ExplanatoryGloss` are non-empty and
 *   contain no nested/unbalanced parentheses, separates `canonicalBangla` and `explanatoryMeaning`.
 * - If `banglaTranslation` contains ambiguous, unbalanced, or multi-group parentheses that cannot
 *   be safely split, preserves `banglaTranslation` unchanged and flags `isAmbiguousLegacyParenthetical: true`.
 */
export function separateCanonicalAndExplanatoryBangla(params: {
  englishTerm: string;
  banglaTranslation: string;
  explanatoryMeaning?: string;
  isLiteralBracketedMotif?: boolean;
}): SeparatedGlossaryRendering {
  const normEnglish = normalizeEnglishTerm(params.englishTerm ?? '');
  const normBangla = normalizeBanglaUnicode(params.banglaTranslation ?? '');
  const explicitExplanatory = normalizeBanglaUnicode(params.explanatoryMeaning ?? '');

  const isEnglishBracketedMotif = /^\*?\([^()]+\)\*?$/.test(normEnglish);
  const isBanglaWholeBracketedMotif = /^\*?\([^()]+\)\*?$/.test(normBangla);
  const isBracketed = Boolean(
    params.isLiteralBracketedMotif ||
      isEnglishBracketedMotif ||
      isBanglaWholeBracketedMotif
  );

  if (isBracketed) {
    return {
      canonicalBangla: normBangla,
      ...(explicitExplanatory ? { explanatoryMeaning: explicitExplanatory } : {}),
      isLiteralBracketedMotif: true,
      isAmbiguousLegacyParenthetical: false,
    };
  }

  if (!/[()]/.test(normBangla)) {
    return {
      canonicalBangla: normBangla,
      ...(explicitExplanatory ? { explanatoryMeaning: explicitExplanatory } : {}),
      isLiteralBracketedMotif: false,
      isAmbiguousLegacyParenthetical: false,
    };
  }

  const trailingMatch = /^([^()]+?)\s*\(([^()]+)\)$/.exec(normBangla);
  if (trailingMatch) {
    const baseCandidate = normalizeBanglaUnicode(trailingMatch[1]);
    const innerGloss = normalizeBanglaUnicode(trailingMatch[2]);
    if (baseCandidate && innerGloss) {
      const mergedExplanatory = explicitExplanatory
        ? explicitExplanatory.toLowerCase().includes(innerGloss.toLowerCase())
          ? explicitExplanatory
          : `${innerGloss}; ${explicitExplanatory}`
        : innerGloss;
      return {
        canonicalBangla: baseCandidate,
        explanatoryMeaning: mergedExplanatory,
        isLiteralBracketedMotif: false,
        isAmbiguousLegacyParenthetical: false,
      };
    }
  }

  return {
    canonicalBangla: normBangla,
    ...(explicitExplanatory ? { explanatoryMeaning: explicitExplanatory } : {}),
    isLiteralBracketedMotif: false,
    isAmbiguousLegacyParenthetical: true,
  };
}

/**
 * Extracts a canonical lowercase contextual sense key for homonym disambiguation.
 * Considers:
 * 1. Explicit `contextMeaning`
 * 2. Parenthetical sense qualifier in `englishTerm` (e.g. "bank (river)")
 * 3. Explicit sense declarations in `notes` (e.g. "Context: ...", "Sense: ...", "when referring to ...",
 *    or distinct notes on entries explicitly flagged `isContextSensitive: true`).
 */
export function extractContextualSenseKey(
  item: Pick<
    Partial<TerminologyMemoryItem>,
    'englishTerm' | 'contextMeaning' | 'notes' | 'isContextSensitive'
  >
): string {
  const contextMeaning = normalizeEnglishTerm(item.contextMeaning ?? '').toLowerCase();
  if (contextMeaning) {
    return contextMeaning;
  }

  const { parentheticalSense } = extractEnglishSurfaceAndSense(item.englishTerm ?? '');
  if (parentheticalSense) {
    return parentheticalSense.toLowerCase();
  }

  const rawNotes = normalizeEnglishTerm(item.notes ?? '');
  if (!rawNotes) {
    return '';
  }

  const explicitPrefixMatch =
    /^(?:context|sense|meaning|domain|usage)\s*:\s*(.+)$/i.exec(rawNotes) ??
    /\b(?:when referring to|in the sense of|when used as|specifically for)\s+(.+)$/i.exec(rawNotes);
  if (explicitPrefixMatch && explicitPrefixMatch[1].trim()) {
    return explicitPrefixMatch[1].trim().toLowerCase();
  }

  if (item.isContextSensitive) {
    return rawNotes.toLowerCase();
  }

  return '';
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
  const { parentheticalSense } = extractEnglishSurfaceAndSense(englishTerm);
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

  const explicitContextMeaning =
    typeof raw.contextMeaning === 'string' ? raw.contextMeaning.trim() : '';
  const contextMeaningRaw = explicitContextMeaning || parentheticalSense || '';
  const explanatoryMeaningRaw =
    typeof raw.explanatoryMeaning === 'string'
      ? normalizeBanglaUnicode(raw.explanatoryMeaning)
      : '';
  const banglaStemRaw =
    typeof raw.banglaStem === 'string' ? normalizeBanglaUnicode(raw.banglaStem) : '';
  const aliases = Array.isArray(raw.aliases)
    ? Array.from(
        new Set(
          raw.aliases
            .map((a) => (typeof a === 'string' ? normalizeEnglishTerm(a) : ''))
            .filter((a) => a.length > 0 && a.toLowerCase() !== englishTerm.toLowerCase())
        )
      )
    : [];

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `term-${fallbackIndex}-${englishTerm.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'item'}`,
    englishTerm,
    banglaTranslation,
    ...(explanatoryMeaningRaw ? { explanatoryMeaning: explanatoryMeaningRaw } : {}),
    acceptedAlternatives,
    avoidTranslations,
    ...(aliases.length > 0 ? { aliases } : {}),
    category,
    ...(contextMeaningRaw ? { contextMeaning: contextMeaningRaw } : {}),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    caseSensitive: Boolean(raw.caseSensitive),
    isContextSensitive:
      typeof raw.isContextSensitive === 'boolean'
        ? raw.isContextSensitive
        : Boolean(parentheticalSense),
    ...(banglaStemRaw ? { banglaStem: banglaStemRaw } : {}),
    allowInflections:
      typeof raw.allowInflections === 'boolean' ? raw.allowInflections : true,
    source,
    lockedByUser,
  };
}

/**
 * Returns true only when an entry carries an explicit contextual homonym qualification:
 * 1. Explicitly flagged `isContextSensitive: true`
 * 2. Parenthetical sense qualifier in `englishTerm` (e.g. "bank (river)")
 * 3. Explicit sense declaration prefix in `notes` (e.g. "Context: ...", "Sense: ...", "when referring to ...")
 *
 * Bare descriptive `contextMeaning` on a non-contextual (`isContextSensitive: false`) entry
 * does NOT qualify as an automatic homonym splitter.
 */
function hasExplicitContextualSenseQualification(
  item: Pick<
    Partial<TerminologyMemoryItem>,
    'englishTerm' | 'notes' | 'isContextSensitive'
  >
): boolean {
  if (item.isContextSensitive) {
    return true;
  }

  const { parentheticalSense } = extractEnglishSurfaceAndSense(item.englishTerm ?? '');
  if (parentheticalSense) {
    return true;
  }

  const rawNotes = normalizeEnglishTerm(item.notes ?? '');
  if (!rawNotes) {
    return false;
  }

  return (
    /^(?:context|sense|meaning|domain|usage)\s*:\s*(.+)$/i.test(rawNotes) ||
    /\b(?:when referring to|in the sense of|when used as|specifically for)\s+(.+)$/i.test(rawNotes)
  );
}

/**
 * Determines whether two glossary items represent the same lookup key,
 * accounting for case-sensitivity, cross-category homonyms, and same-category contextual homonyms,
 * while strictly preserving Phase 2A user-lock and avoid-list safeguards.
 */
function isSameGlossaryEntryKey(
  a: TerminologyMemoryItem,
  b: TerminologyMemoryItem
): boolean {
  const aSurface = getEnglishSurfaceTerm(a.englishTerm);
  const bSurface = getEnglishSurfaceTerm(b.englishTerm);
  const eitherCaseSensitive = Boolean(a.caseSensitive || b.caseSensitive);
  const sameEnglish = eitherCaseSensitive
    ? aSurface === bSurface
    : aSurface.toLowerCase() === bSurface.toLowerCase();

  if (!sameEnglish) return false;

  const aSense = extractContextualSenseKey(a);
  const bSense = extractContextualSenseKey(b);
  const aExplicitContextual = hasExplicitContextualSenseQualification(a);
  const bExplicitContextual = hasExplicitContextualSenseQualification(b);

  const bothExplicitContextualHomonyms =
    aExplicitContextual &&
    bExplicitContextual &&
    Boolean(aSense) &&
    Boolean(bSense) &&
    aSense !== bSense;

  // 1. Safeguard: If one entry explicitly lists the other's primary translation in `avoidTranslations`,
  //    they must never split into coexisting entries unless BOTH entries are genuine, explicitly
  //    qualified contextual homonyms with distinct senses.
  const aAvoidsB = (a.avoidTranslations ?? []).includes(b.banglaTranslation);
  const bAvoidsA = (b.avoidTranslations ?? []).includes(a.banglaTranslation);
  if ((aAvoidsB || bAvoidsA) && !bothExplicitContextualHomonyms) {
    return true;
  }

  // 2. Safeguard: A non-contextual user-locked entry (`lockedByUser: true` without explicit contextual
  //    homonym qualification) must never be bypassed by an incoming unlocked AI entry (`source !== 'user'`)
  //    supplying a different `contextMeaning`, `notes`, or `isContextSensitive` flag.
  const aLockedNonContextualVsAi =
    a.lockedByUser && !aExplicitContextual && !b.lockedByUser && b.source !== 'user';
  const bLockedNonContextualVsAi =
    b.lockedByUser && !bExplicitContextual && !a.lockedByUser && a.source !== 'user';
  if (aLockedNonContextualVsAi || bLockedNonContextualVsAi) {
    return true;
  }

  // 3. Legitimate same-category contextual homonyms coexist ONLY when both entries are explicitly
  //    qualified contextual senses (or explicitly marked context-sensitive) with distinct non-empty senses.
  if (bothExplicitContextualHomonyms) {
    return false;
  }

  // 4. Cross-category homonyms with distinct primary translations where at least one entry
  //    carries explicit contextual qualification.
  if (
    a.category !== b.category &&
    a.banglaTranslation !== b.banglaTranslation &&
    (aExplicitContextual || bExplicitContextual)
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
 * - Protects `lockedByUser: true` entries from ever being overwritten, having their `avoidTranslations`
 *   erased, or having their `isContextSensitive` classification flipped by AI duplicates.
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
  // Protect the user's primary translation, lock state, sensitivity classification, and avoid list strictly.
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
      explanatoryMeaning: current.explanatoryMeaning || candidate.explanatoryMeaning,
      acceptedAlternatives: mergedAccepted,
      avoidTranslations: mergedAvoid,
      contextMeaning: current.isContextSensitive
        ? current.contextMeaning || candidate.contextMeaning
        : current.contextMeaning,
      notes: current.notes || candidate.notes,
      isContextSensitive: Boolean(current.isContextSensitive),
      lockedByUser: true,
      source: 'user',
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

    const resolvedUserContextSensitive =
      typeof rawIncoming.isContextSensitive === 'boolean'
        ? rawIncoming.isContextSensitive
        : Boolean(candidate.isContextSensitive);

    return normalizeTerminologyItem({
      ...current,
      ...candidate,
      id: current.id,
      banglaTranslation: primaryBangla,
      explanatoryMeaning: candidate.explanatoryMeaning ?? current.explanatoryMeaning,
      acceptedAlternatives: mergedAccepted,
      avoidTranslations: mergedAvoid,
      contextMeaning: resolvedUserContextSensitive
        ? candidate.contextMeaning ?? current.contextMeaning
        : candidate.contextMeaning,
      notes: candidate.notes || current.notes,
      isContextSensitive: resolvedUserContextSensitive,
      lockedByUser: nextLocked,
      source: 'user',
    });
  }

  // Case 3: Unlocked AI-to-AI merge / duplicate normalization.
  // Enforce the 3-tier priority hierarchy:
  //   Tier 1: user-locked (`lockedByUser: true` / `source: 'user'`) [handled above]
  //   Tier 2: Stage 1 AI (`source: 'stage1_ai'` / `'location_sync'`)
  //   Tier 3: Stage 3 chunk discovery (`source: 'chunk_ai'`)
  // If `current` is a provisional Tier 3 (`chunk_ai`) entry and `candidate` is an authoritative
  // Tier 2 (`stage1_ai` or `location_sync`) entry, Tier 2 supersedes the provisional primary translation
  // without promoting the superseded provisional translation into `acceptedAlternatives`.
  const resolvedCandidateSource: TerminologySource = isValidTerminologySource(rawIncoming.source)
    ? rawIncoming.source
    : effectiveSource ?? candidate.source ?? 'stage1_ai';

  const stage1SupersedesChunkAi =
    current.source === 'chunk_ai' &&
    (resolvedCandidateSource === 'stage1_ai' || resolvedCandidateSource === 'location_sync');

  const primaryBangla = stage1SupersedesChunkAi
    ? candidate.banglaTranslation
    : current.banglaTranslation;

  const baseAcceptedSource = stage1SupersedesChunkAi
    ? [...(candidate.acceptedAlternatives ?? []), ...(current.acceptedAlternatives ?? [])]
    : current.acceptedAlternatives ?? [];

  const currentAccepted = deduplicateBanglaList(
    baseAcceptedSource,
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

  const nextIsContextSensitive = stage1SupersedesChunkAi
    ? Boolean(candidate.isContextSensitive)
    : Boolean(current.isContextSensitive);

  return normalizeTerminologyItem({
    ...current,
    banglaTranslation: primaryBangla,
    explanatoryMeaning: stage1SupersedesChunkAi
      ? candidate.explanatoryMeaning || current.explanatoryMeaning
      : current.explanatoryMeaning || candidate.explanatoryMeaning,
    acceptedAlternatives: mergedAccepted,
    avoidTranslations: mergedAvoid,
    contextMeaning: nextIsContextSensitive
      ? stage1SupersedesChunkAi
        ? candidate.contextMeaning || current.contextMeaning
        : current.contextMeaning || candidate.contextMeaning
      : stage1SupersedesChunkAi
        ? candidate.contextMeaning
        : current.contextMeaning,
    notes: stage1SupersedesChunkAi
      ? candidate.notes || current.notes
      : current.notes || candidate.notes,
    isContextSensitive: nextIsContextSensitive,
    source: stage1SupersedesChunkAi ? resolvedCandidateSource : current.source,
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

export type CreateUserGlossaryItemInput = Omit<
  Partial<TerminologyMemoryItem>,
  'source' | 'acceptedAlternatives' | 'avoidTranslations'
> & {
  englishTerm: string;
  banglaTranslation: string;
  acceptedAlternatives?: ReadonlyArray<string> | string | null;
  avoidTranslations?: ReadonlyArray<string> | string | null;
};

export type UserGlossaryEditInput = Omit<
  Partial<TerminologyMemoryItem>,
  'acceptedAlternatives' | 'avoidTranslations'
> & {
  acceptedAlternatives?: ReadonlyArray<string> | string | null;
  avoidTranslations?: ReadonlyArray<string> | string | null;
};

/**
 * Pure helper for creating a user-owned glossary term:
 * - Always stamps `source: 'user'` and `lockedByUser: true` so it is never treated
 *   as an unlocked Stage 1 AI suggestion.
 * - Parses comma-separated or array inputs for `acceptedAlternatives` and `avoidTranslations`.
 * - Preserves all other valid `TerminologyMemoryItem` fields without mutating the input object or arrays.
 */
export function createUserGlossaryItem(
  input: CreateUserGlossaryItemInput,
  fallbackIndex = 0
): TerminologyMemoryItem {
  const acceptedAlternatives = parseCommaSeparatedGlossaryList(
    input.acceptedAlternatives
  );
  const avoidTranslations = parseCommaSeparatedGlossaryList(
    input.avoidTranslations
  );

  return normalizeTerminologyItem(
    {
      ...input,
      acceptedAlternatives,
      avoidTranslations,
      source: 'user',
      lockedByUser: true,
    },
    fallbackIndex
  );
}

/**
 * Pure helper for applying a user edit to an existing glossary term:
 * - Promotes `source` to `'user'`.
 * - Preserves `existing`'s current `lockedByUser` boolean value by default
 *   (neither silently unlocking a locked term nor silently locking an unlocked term
 *   merely because another field was edited).
 * - Changes `lockedByUser` only when the caller explicitly supplies a boolean `lockedByUser` choice in `updates`.
 * - Supports comma-separated string or array input for `acceptedAlternatives` and `avoidTranslations`.
 * - Never mutates `existing` or `updates`.
 */
export function applyUserGlossaryEdit(
  existing: TerminologyMemoryItem,
  updates: UserGlossaryEditInput
): TerminologyMemoryItem {
  const currentLocked =
    typeof existing.lockedByUser === 'boolean'
      ? existing.lockedByUser
      : existing.source === 'user';

  const nextLocked =
    typeof updates.lockedByUser === 'boolean'
      ? updates.lockedByUser
      : currentLocked;

  const acceptedAlternatives =
    updates.acceptedAlternatives !== undefined
      ? parseCommaSeparatedGlossaryList(updates.acceptedAlternatives)
      : parseCommaSeparatedGlossaryList(existing.acceptedAlternatives);

  const avoidTranslations =
    updates.avoidTranslations !== undefined
      ? parseCommaSeparatedGlossaryList(updates.avoidTranslations)
      : parseCommaSeparatedGlossaryList(existing.avoidTranslations);

  return normalizeTerminologyItem({
    ...existing,
    ...updates,
    acceptedAlternatives,
    avoidTranslations,
    source: 'user',
    lockedByUser: nextLocked,
  });
}

/**
 * Alias for `applyUserGlossaryEdit` following existing naming conventions.
 */
export const updateUserGlossaryItem = applyUserGlossaryEdit;

/**
 * Helper for creating a glossary item manually in the UI.
 * Automatically assigns `source: 'user'` and `lockedByUser: true` (unless explicitly overridden).
 */
export function createUserTerminologyItem(
  input: CreateUserGlossaryItemInput
): TerminologyMemoryItem {
  const acceptedAlternatives = parseCommaSeparatedGlossaryList(
    input.acceptedAlternatives
  );
  const avoidTranslations = parseCommaSeparatedGlossaryList(
    input.avoidTranslations
  );

  return normalizeTerminologyItem({
    ...input,
    acceptedAlternatives,
    avoidTranslations,
    source: 'user',
    lockedByUser:
      typeof input.lockedByUser === 'boolean' ? input.lockedByUser : true,
  });
}

/**
 * Helper for updating an existing glossary item from a manual user edit.
 * Automatically sets `source: 'user'` and `lockedByUser: true` unless the user explicitly
 * passes `lockedByUser: false` in `updates`.
 */
export function updateUserTerminologyItem(
  existing: TerminologyMemoryItem,
  updates: UserGlossaryEditInput
): TerminologyMemoryItem {
  const nextLocked =
    typeof updates.lockedByUser === 'boolean' ? updates.lockedByUser : true;

  const acceptedAlternatives =
    updates.acceptedAlternatives !== undefined
      ? parseCommaSeparatedGlossaryList(updates.acceptedAlternatives)
      : parseCommaSeparatedGlossaryList(existing.acceptedAlternatives);

  const avoidTranslations =
    updates.avoidTranslations !== undefined
      ? parseCommaSeparatedGlossaryList(updates.avoidTranslations)
      : parseCommaSeparatedGlossaryList(existing.avoidTranslations);

  return normalizeTerminologyItem({
    ...existing,
    ...updates,
    acceptedAlternatives,
    avoidTranslations,
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
function extractRegisteredEnglishAliases(item: TerminologyMemoryItem): string[] {
  const aliases = new Set<string>();
  const primaryLower = getEnglishSurfaceTerm(item.englishTerm).toLowerCase();

  if (Array.isArray(item.aliases)) {
    for (const rawAlias of item.aliases) {
      const cleaned = getEnglishSurfaceTerm(rawAlias ?? '');
      if (cleaned && cleaned.toLowerCase() !== primaryLower) {
        aliases.add(cleaned);
      }
    }
  }

  if (item.notes) {
    const noteMatch = /\balias(?:es)?\s*:\s*([^\n;|]+)/i.exec(item.notes);
    if (noteMatch && noteMatch[1]) {
      for (const part of noteMatch[1].split(',')) {
        const cleaned = getEnglishSurfaceTerm(part.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''));
        if (cleaned && cleaned.toLowerCase() !== primaryLower) {
          aliases.add(cleaned);
        }
      }
    }
  }

  return Array.from(aliases);
}

function findSingleEnglishSurfaceTermOccurrences(
  englishText: string,
  surfaceTermInput: string,
  item: Pick<TerminologyMemoryItem, 'category' | 'caseSensitive'>
): EnglishTermMatchSpan[] {
  const term = getEnglishSurfaceTerm(surfaceTermInput);
  if (!englishText || !term) return [];

  // Unwrap optional outer Markdown italics (*...*) so bracketed or italicized recurring expressions
  // like "*(Fine.)*" or "(Fine.)" match both "*(Fine.)*" and "(Fine.)" in prose without false-matching
  // unbracketed words.
  const outerAsteriskMatch = /^\*+(.+?)\*+$/.exec(term);
  const coreTerm = outerAsteriskMatch ? outerAsteriskMatch[1].trim() : term;
  if (!coreTerm) return [];

  const isParenthesizedMotif = /^\(.+\)$/.test(coreTerm);
  const allowOptionalOuterAsterisks = Boolean(outerAsteriskMatch || isParenthesizedMotif);

  const tokens = coreTerm.split(/[\s-]+/).filter(Boolean);
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

  const corePattern = `${prefixPattern}(?:${headForms.join('|')})`;
  const fullPattern = allowOptionalOuterAsterisks
    ? `(?:\\*+)?${corePattern}(?:\\*+)?`
    : corePattern;
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

export function findEnglishTermOccurrences(
  englishText: string,
  item: TerminologyMemoryItem
): EnglishTermMatchSpan[] {
  const primarySpans = findSingleEnglishSurfaceTermOccurrences(
    englishText,
    item.englishTerm,
    item
  );
  const aliases = extractRegisteredEnglishAliases(item);
  if (aliases.length === 0) {
    return primarySpans;
  }

  const combined: EnglishTermMatchSpan[] = [...primarySpans];
  for (const alias of aliases) {
    const aliasSpans = findSingleEnglishSurfaceTermOccurrences(englishText, alias, item);
    for (const s of aliasSpans) {
      if (!combined.some((existing) => spansOverlap(existing, s))) {
        combined.push(s);
      }
    }
  }

  return combined.sort((a, b) => a.start - b.start || a.end - b.end);
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

  // Sort by surface token count descending, then surface English term character length descending
  const sorted = [...normalizedGlossary].sort((a, b) => {
    const aSurface = getEnglishSurfaceTerm(a.englishTerm);
    const bSurface = getEnglishSurfaceTerm(b.englishTerm);
    const aTokens = aSurface.split(/[\s-]+/).length;
    const bTokens = bSurface.split(/[\s-]+/).length;
    if (bTokens !== aTokens) return bTokens - aTokens;
    return bSurface.length - aSurface.length;
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

    const surfaceTerm = getEnglishSurfaceTerm(item.englishTerm);
    const englishKeyLower = surfaceTerm.toLowerCase();
    const tokenCount = surfaceTerm.split(/[\s-]+/).length;

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
  const anusvaraEnding = normStem.endsWith('\u0982'); // ং (e.g. স্প্রিং -> স্প্রিংয়ের, স্প্রিংয়ে)

  if (!vowelEnding && CONSONANT_STEM_ONLY_SUFFIXES.has(normSuffix)) {
    return true;
  }

  if ((vowelEnding || anusvaraEnding) && VOWEL_STEM_ONLY_SUFFIXES.has(normSuffix)) {
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

  // If the Bangla term is wrapped in formatting/punctuation (such as "*(ঠিক আছে।)*" or "(ঠিক আছে।)"),
  // also add the unwrapped core Bangla phrase so matches succeed whether or not outer punctuation/italics
  // are attached to the token.
  const unwrappedBangla = normTerm
    .replace(/^[\s*()\[\]"'‘’“”।.!?]+|[\s*()\[\]"'‘’“”।.!?]+$/g, '')
    .trim();
  if (unwrappedBangla && /[\u0980-\u09FF]/.test(unwrappedBangla)) {
    candidateBases.add(unwrappedBangla);
  }

  const spans: BanglaTermMatchSpan[] = [];

  for (const base of candidateBases) {
    const words = base.split(/[\s-]+/).filter(Boolean);
    if (words.length === 0) continue;

    // Build regex for the base phrase (allowing space, hyphen, or compound join on 2+ char words,
    // and allowing internal sentence punctuation like । or , in multi-clause expressions to vary flexibly)
    const joiner =
      words.length > 1 && words.every((w) => w.length >= 2) ? '[\\s\\-]*' : '[\\s\\-]+';
    const basePattern = words
      .map((w, idx) => {
        if (idx < words.length - 1 && /[।.,!?]+$/.test(w)) {
          const stemPart = w.replace(/[।.,!?]+$/, '');
          if (stemPart) {
            return `${escapeRegExp(stemPart)}[।.,!?]*`;
          }
        }
        return escapeRegExp(w);
      })
      .join(joiner);
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

const NON_COMPOUND_MODIFIER_WORDS: ReadonlySet<string> = new Set<string>([
  'the',
  'this',
  'that',
  'these',
  'those',
  'his',
  'her',
  'our',
  'your',
  'their',
  'its',
  'my',
  'some',
  'any',
  'every',
  'each',
  'all',
  'both',
  'other',
  'another',
  'same',
  'such',
  'old',
  'new',
  'young',
  'good',
  'bad',
  'great',
  'little',
  'small',
  'large',
  'big',
  'long',
  'short',
  'high',
  'low',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'last',
  'next',
  'mr',
  'mrs',
  'miss',
  'ms',
  'dr',
  'sir',
  'lord',
  'lady',
  'st',
  'saint',
  'not',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]);

const NON_SIBLING_HEAD_FOLLOWERS: ReadonlySet<string> = new Set<string>([
  // Prepositions & particles
  'on',
  'in',
  'at',
  'to',
  'for',
  'from',
  'with',
  'by',
  'of',
  'off',
  'out',
  'up',
  'down',
  'into',
  'onto',
  'upon',
  'over',
  'under',
  'above',
  'below',
  'between',
  'among',
  'through',
  'across',
  'along',
  'around',
  'behind',
  'beside',
  'besides',
  'beyond',
  'near',
  'inside',
  'outside',
  'within',
  'without',
  'against',
  'toward',
  'towards',
  'before',
  'after',
  'since',
  'until',
  'till',
  'during',
  'despite',
  'except',
  'like',
  'unlike',
  'about',
  'amid',
  'amidst',
  'beneath',
  'underneath',
  'alongside',
  // Conjunctions, relatives, determiners, pronouns
  'and',
  'or',
  'nor',
  'but',
  'yet',
  'so',
  'as',
  'if',
  'than',
  'that',
  'which',
  'who',
  'whom',
  'whose',
  'where',
  'when',
  'while',
  'whilst',
  'whether',
  'though',
  'although',
  'because',
  'unless',
  'once',
  'this',
  'these',
  'those',
  'the',
  'a',
  'an',
  'some',
  'any',
  'no',
  'none',
  'all',
  'both',
  'each',
  'every',
  'either',
  'neither',
  'another',
  'other',
  'such',
  'what',
  'whatever',
  'himself',
  'herself',
  'itself',
  'themselves',
  'myself',
  'yourself',
  'ourselves',
  'he',
  'she',
  'it',
  'they',
  'we',
  'you',
  'him',
  'her',
  'them',
  'us',
  'his',
  'its',
  'their',
  'our',
  'your',
  'my',
  // Auxiliaries, modals, copulas
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing',
  'done',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'ought',
  'need',
  'used',
  // Adverbs & quantifiers
  'not',
  'never',
  'always',
  'often',
  'still',
  'already',
  'just',
  'only',
  'even',
  'also',
  'too',
  'very',
  'quite',
  'rather',
  'almost',
  'nearly',
  'hardly',
  'scarcely',
  'barely',
  'merely',
  'simply',
  'again',
  'back',
  'away',
  'here',
  'there',
  'now',
  'then',
  'today',
  'tonight',
  'tomorrow',
  'yesterday',
  'soon',
  'later',
  'twice',
  'more',
  'most',
  'less',
  'least',
  'much',
  'many',
  'few',
  'little',
  'enough',
  'together',
  'apart',
  'alone',
  'instead',
  'however',
  'therefore',
  'thus',
  'hence',
  'otherwise',
  // Common irregular/narrative verbs that could follow a subject noun
  'came',
  'went',
  'stood',
  'lay',
  'sat',
  'kept',
  'left',
  'took',
  'gave',
  'made',
  'said',
  'told',
  'asked',
  'looked',
  'seemed',
  'appeared',
  'remained',
  'stayed',
  'began',
  'started',
  'stopped',
  'continued',
  'turned',
  'moved',
  'passed',
  'reached',
  'brought',
  'bought',
  'sold',
  'paid',
  'cost',
  'meant',
  'felt',
  'heard',
  'saw',
  'knew',
  'thought',
  'found',
  'held',
  'put',
  'set',
  'let',
  'cut',
  'shut',
  'hit',
  'ran',
  'fell',
  'grew',
  'blew',
  'drew',
  'threw',
  'flew',
  'sank',
  'rang',
  'sang',
  'drank',
  'shrank',
  'sprang',
  'swam',
  'won',
  'lost',
  'built',
  'sent',
  'spent',
  'lent',
  'bent',
  'burnt',
  'learnt',
  'dealt',
  'knelt',
  'slept',
  'swept',
  'wept',
  'crept',
  'leapt',
]);

function isValidSiblingHeadNounCandidate(word: string): boolean {
  const cleaned = word.replace(/(?:'s|’s|'|\u2019)$/i, '');
  if (!/^[A-Za-z]{3,}$/.test(cleaned)) return false;
  const lower = cleaned.toLowerCase();
  if (NON_SIBLING_HEAD_FOLLOWERS.has(lower)) return false;

  // Exclude regular past-tense/participle verb forms (-ed) and -ly adverbs
  if (
    lower.length >= 5 &&
    lower.endsWith('ed') &&
    !/^(?:bed|sled|shed|deed|seed|weed|reed|steed|creed|breed|speed|need|feed|biped|quadruped|watershed|woodshed|cowshed|toolshed|bloodshed)$/.test(
      lower
    )
  ) {
    return false;
  }
  if (
    lower.length >= 5 &&
    lower.endsWith('ly') &&
    !/^(?:family|assembly|supply|monopoly|anomaly|ally|rally|tally|valley|folly|gully|belly|jelly|holly|lily|fly|reply)$/.test(
      lower
    )
  ) {
    return false;
  }

  return true;
}

export interface SiblingCompoundCollision {
  glossaryItem: TerminologyMemoryItem;
  englishTerm: string;
  banglaTranslation: string;
  sharedModifier: string;
  glossaryHeadWord: string;
  siblingHeadWord: string;
  matchedSiblingPhrase: string;
  coreSiblingPhrase: string;
  paragraphIndices: number[];
}

/**
 * PPH-4.4 Layer 2: Detects sibling compound noun phrases in `englishInput` that share a leading
 * content modifier $M_1$ with a multi-word glossary compound $G = [M_1 \dots H_G]$ but have a
 * different head noun $H_S \neq H_G$ (e.g., "Sylhet timber lease" / "timber brokerage" when the
 * glossary contains "timber trust -> টিম্বার ট্রাস্ট").
 */
export function detectSiblingCompoundCollisions(
  englishInput: string | ReadonlyArray<string>,
  glossary: ReadonlyArray<TerminologyMemoryItem>
): SiblingCompoundCollision[] {
  const paragraphs =
    typeof englishInput === 'string' ? [englishInput] : Array.from(englishInput ?? []);
  if (paragraphs.length === 0 || !Array.isArray(glossary) || glossary.length === 0) {
    return [];
  }

  const normalizedGlossary = normalizeGlossaryList(glossary);
  const collisionsByKey = new Map<string, SiblingCompoundCollision>();

  for (const item of normalizedGlossary) {
    if (item.category === 'expression') continue;
    const surfaceTerm = getEnglishSurfaceTerm(item.englishTerm);
    if (!surfaceTerm) continue;

    const rawTokens = surfaceTerm.split(/[\s-]+/).filter(Boolean);
    const tokens =
      rawTokens.length > 2 && /^(?:the|a|an)$/i.test(rawTokens[0])
        ? rawTokens.slice(1)
        : rawTokens;
    if (tokens.length < 2) continue;
    if (!tokens.every((t) => /^[A-Za-z][A-Za-z']*$/.test(t))) continue;

    const glossaryHeadWord = tokens[tokens.length - 1].replace(/(?:'s|’s|'|\u2019)$/i, '');
    const headFormsLower = new Set<string>(
      generateConservativeEnglishWordForms(glossaryHeadWord, {
        category: item.category,
      }).map((f) => f.toLowerCase().replace(/(?:'s|’s|'|\u2019)$/i, ''))
    );
    headFormsLower.add(glossaryHeadWord.toLowerCase());

    const internalModifierTokensLower = new Set<string>(
      tokens.slice(0, -1).map((t) => t.toLowerCase().replace(/(?:'s|’s|'|\u2019)$/i, ''))
    );

    // Also include headwords of any registered aliases so aliases are never flagged as sibling collisions
    for (const alias of extractRegisteredEnglishAliases(item)) {
      const aliasTokens = alias.split(/[\s-]+/).filter(Boolean);
      if (aliasTokens.length > 0) {
        const aliasHead = aliasTokens[aliasTokens.length - 1].replace(
          /(?:'s|’s|'|\u2019)$/i,
          ''
        );
        for (const af of generateConservativeEnglishWordForms(aliasHead, {
          category: item.category,
        })) {
          headFormsLower.add(af.toLowerCase().replace(/(?:'s|’s|'|\u2019)$/i, ''));
        }
        headFormsLower.add(aliasHead.toLowerCase());
      }
    }

    // Candidate modifiers: the leading modifier token(s) of the compound
    const candidateModifiers = Array.from(
      new Set([tokens[0], tokens[tokens.length - 2]])
    ).filter((mod) => {
      const cleaned = mod.replace(/(?:'s|’s|'|\u2019)$/i, '').toLowerCase();
      return cleaned.length >= 3 && !NON_COMPOUND_MODIFIER_WORDS.has(cleaned);
    });

    if (candidateModifiers.length === 0) continue;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const paraText = paragraphs[pIdx] ?? '';
      if (!paraText.trim()) continue;

      const itemOccurrences = findEnglishTermOccurrences(paraText, item);

      for (const modToken of candidateModifiers) {
        const modForms = generateConservativeEnglishWordForms(modToken)
          .filter((f) => !f.includes("'") && !f.includes('’'))
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp);
        if (modForms.length === 0) continue;

        const pairRegex = new RegExp(
          `\\b(${modForms.join('|')})[\\s\\-]+([A-Za-z][A-Za-z']*)\\b`,
          'gi'
        );
        let match: RegExpExecArray | null;

        while ((match = pairRegex.exec(paraText)) !== null) {
          const matchStart = match.index;
          const matchedPairText = match[0];
          const matchEnd = matchStart + matchedPairText.length;

          // Skip if this span overlaps an actual occurrence of the glossary term (or its registered alias)
          if (itemOccurrences.some((occ) => spansOverlap(occ, { start: matchStart, end: matchEnd }))) {
            continue;
          }

          const rawCandidateHead = match[2];
          const cleanedCandidateHead = rawCandidateHead.replace(/(?:'s|’s|'|\u2019)$/i, '');
          const candidateHeadLower = cleanedCandidateHead.toLowerCase();

          // Must not be the glossary term's own headword or internal modifier token
          if (
            headFormsLower.has(candidateHeadLower) ||
            internalModifierTokensLower.has(candidateHeadLower)
          ) {
            continue;
          }

          if (!isValidSiblingHeadNounCandidate(cleanedCandidateHead)) {
            continue;
          }

          const coreSiblingPhrase = `${match[1]} ${cleanedCandidateHead}`;
          let matchedSiblingPhrase = coreSiblingPhrase;

          // Check if immediately preceded by a mid-sentence capitalized proper modifier (e.g., "Sylhet timber lease")
          const prefixSlice = paraText.slice(Math.max(0, matchStart - 40), matchStart);
          const properPrefixMatch = /(?:^|[A-Za-z0-9,;:—–-]\s+)([A-Z][a-z]{2,})\s+$/.exec(
            prefixSlice
          );
          if (properPrefixMatch && properPrefixMatch[1]) {
            const precedingWord = properPrefixMatch[1];
            const precedingLower = precedingWord.toLowerCase();
            if (
              !NON_COMPOUND_MODIFIER_WORDS.has(precedingLower) &&
              !NON_SIBLING_HEAD_FOLLOWERS.has(precedingLower)
            ) {
              matchedSiblingPhrase = `${precedingWord} ${coreSiblingPhrase}`;
            }
          }

          const collisionKey = `${item.id}::${matchedSiblingPhrase.toLowerCase()}`;
          const existing = collisionsByKey.get(collisionKey);
          if (existing) {
            if (!existing.paragraphIndices.includes(pIdx)) {
              existing.paragraphIndices.push(pIdx);
            }
          } else {
            collisionsByKey.set(collisionKey, {
              glossaryItem: item,
              englishTerm: surfaceTerm,
              banglaTranslation: item.banglaTranslation,
              sharedModifier: modToken.toLowerCase(),
              glossaryHeadWord,
              siblingHeadWord: cleanedCandidateHead,
              matchedSiblingPhrase,
              coreSiblingPhrase,
              paragraphIndices: [pIdx],
            });
          }
        }
      }
    }
  }

  return Array.from(collisionsByKey.values());
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
    // PPH-4.4: Exclude unmatched multi-word compounds that collide with a sibling compound in the chunk/window
    if (detectSiblingCompoundCollisions(combinedEnglish, [item]).length > 0) {
      return false;
    }
    if (includeLocked && item.lockedByUser) return true;
    if (
      includeNamesAndPlaces &&
      (item.category === 'name' ||
        item.category === 'place' ||
        item.category === 'expression')
    ) {
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

  const normalizedBanglaText = normalizeBanglaUnicode(banglaText);
  if (!normalizedBanglaText) return [];

  const normEnglish = getEnglishSurfaceTerm(item.englishTerm).toLowerCase();
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
    const englishKeyLower = getEnglishSurfaceTerm(item.englishTerm).toLowerCase();

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

    // For recurring expressions (`category === 'expression'`), if an English occurrence is immediately
    // preceded by a negation modifier (e.g., "Not fine" varying a locked "Fine" -> "ঠিক আছে" motif),
    // allow the corresponding negated Bangla echo sharing the same core root (e.g., "ঠিক নেই" / "ঠিক নয়")
    // so context-sensitive variations preserve the motif relationship without forcing affirmative wording.
    if (remainingNeeded > 0 && item.category === 'expression') {
      const englishSurface = getEnglishSurfaceTerm(item.englishTerm);
      const isAlreadyNegatedInTerm = /^\*?\(?\s*(?:not|never|no\b)/i.test(englishSurface);
      const negatedOccurrencesCount = isAlreadyNegatedInTerm
        ? 0
        : entry.occurrences.filter((occ) => {
            const prefixWindow = englishText.slice(Math.max(0, occ.start - 24), occ.start);
            return /\b(?:not|never|no\s+longer|hardly|scarcely)\s+$/i.test(prefixWindow);
          }).length;

      if (negatedOccurrencesCount > 0) {
        const negatedEchoCandidates = new Set<string>();
        for (const baseSource of [expectedBangla, ...acceptedAlternatives]) {
          const core = normalizeBanglaUnicode(baseSource)
            .replace(/^[\s*()\[\]"'‘’“”।.!?]+|[\s*()\[\]"'‘’“”।.!?]+$/g, '')
            .trim();
          if (!core) continue;
          const strippedAffirmative = core
            .replace(/\s+(?:আছে|রয়েছে|হয়েছে|হলো|বটে)$/u, '')
            .trim();
          const root = strippedAffirmative || core;
          if (root && /[\u0980-\u09FF]/.test(root)) {
            for (const negWord of ['নেই', 'নয়', 'না', 'নি']) {
              negatedEchoCandidates.add(`${root} ${negWord}`);
            }
          }
        }

        let negQuota = Math.min(remainingNeeded, negatedOccurrencesCount);
        for (const negForm of negatedEchoCandidates) {
          if (negQuota <= 0) break;
          const spans = findBanglaTermOccurrences(banglaText, negForm, {
            allowInflections: false,
          }).filter((s) => !consumedBanglaSpans.some((c) => spansOverlap(s, c)));
          const toClaim = spans.slice(0, negQuota);
          for (const s of toClaim) {
            acceptedSpans.push(s);
            consumedBanglaSpans.push({ start: s.start, end: s.end });
          }
          negQuota -= toClaim.length;
          remainingNeeded -= toClaim.length;
        }
      }
    }

    entry.acceptedSpans = acceptedSpans;
  };

  const isMultiWordEntry = (entry: EvaluatedGlossaryMatch): boolean =>
    getEnglishSurfaceTerm(entry.item.englishTerm).split(/[\s-]+/).filter(Boolean).length > 1 ||
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
        getEnglishSurfaceTerm(item.englishTerm).split(/[\s-]+/).filter(Boolean).length > 1;
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

  const CONTEXT_STOP_WORDS = new Set<string>([
    'the',
    'and',
    'for',
    'with',
    'when',
    'used',
    'sense',
    'context',
    'meaning',
    'term',
    'word',
    'from',
    'into',
    'that',
    'this',
  ]);

  const extractDistinctiveSenseTokens = (item: TerminologyMemoryItem): string[] => {
    const surfaceLower = getEnglishSurfaceTerm(item.englishTerm).toLowerCase();
    const senseKey = extractContextualSenseKey(item);
    if (!senseKey) return [];
    return senseKey
      .split(/[^a-z0-9]+/i)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 3 && w !== surfaceLower && !CONTEXT_STOP_WORDS.has(w));
  };

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

    // Detect when a same-case contextual homonym group has multiple English occurrences and
    // one sense's repeated translation claimed multiple occurrences while another sense in the
    // group has zero supporting Bangla evidence—unless every English occurrence in the paragraph
    // is locally disambiguated by the claiming sense's qualifier token.
    const sameCaseActiveHomonyms = group.entries.filter(
      (e) =>
        e.occurrences.length > 1 &&
        e.occurrences.length === englishOccurrencesCount &&
        !e.item.caseSensitive
    );
    const overclaimingEntries = sameCaseActiveHomonyms.filter(
      (e) => e.preferredSpans.length + e.acceptedSpans.length > 1
    );
    const zeroClaimEntries = sameCaseActiveHomonyms.filter(
      (e) => e.preferredSpans.length + e.acceptedSpans.length === 0
    );

    let hasMultiSenseHomonymOverclaim = false;
    if (
      sameCaseActiveHomonyms.length > 1 &&
      englishOccurrencesCount > 1 &&
      overclaimingEntries.length > 0 &&
      zeroClaimEntries.length > 0
    ) {
      const claimingEntry = overclaimingEntries[0];
      const claimingTokens = extractDistinctiveSenseTokens(claimingEntry.item);
      const unrepresentedTokens = zeroClaimEntries.flatMap((e) =>
        extractDistinctiveSenseTokens(e.item)
      );

      const occurrenceEvidence = group.occurrences.map((occ, occIdx) => {
        const minStart = occIdx > 0 ? group.occurrences[occIdx - 1].end : 0;
        const maxEnd =
          occIdx + 1 < group.occurrences.length
            ? group.occurrences[occIdx + 1].start
            : englishText.length;
        const windowStart = Math.max(minStart, occ.start - 25);
        const windowEnd = Math.min(maxEnd, occ.end + 25);
        const windowText = englishText.slice(windowStart, windowEnd).toLowerCase();
        const hasClaimingToken = claimingTokens.some((tok) => windowText.includes(tok));
        const hasUnrepresentedToken = unrepresentedTokens.some((tok) =>
          windowText.includes(tok)
        );
        return { hasClaimingToken, hasUnrepresentedToken };
      });

      const someOccurrenceHasUnrepresentedToken = occurrenceEvidence.some(
        (e) => e.hasUnrepresentedToken
      );
      const someOccurrenceHasClaimingToken = occurrenceEvidence.some(
        (e) => e.hasClaimingToken
      );
      const everyOccurrenceHasClaimingToken = occurrenceEvidence.every(
        (e) => e.hasClaimingToken
      );

      if (
        someOccurrenceHasUnrepresentedToken ||
        (someOccurrenceHasClaimingToken && !everyOccurrenceHasClaimingToken)
      ) {
        hasMultiSenseHomonymOverclaim = true;
      }
    }

    // Collect all approved Bangla forms across sibling entries in this homonym group so
    // one homonym sense never flags a sibling sense's approved translation as `avoid_term_used`.
    const siblingApprovedBanglaForms = new Set<string>();
    if (group.entries.length > 1) {
      for (const groupEntry of group.entries) {
        for (const form of expandApprovedBanglaCompoundForms(
          groupEntry.item.banglaTranslation
        )) {
          siblingApprovedBanglaForms.add(form);
        }
        for (const alt of groupEntry.item.acceptedAlternatives ?? []) {
          for (const form of expandApprovedBanglaCompoundForms(alt)) {
            siblingApprovedBanglaForms.add(form);
          }
        }
      }
    }

    // If all English occurrences for this term/homonym-group are accounted for by preferred/accepted translations
    // (with each entry bounded by its partitioned `entry.occurrences.length`) and no same-case multi-sense
    // homonym over-claim occurred, emit no findings for this group.
    if (groupApprovedCount >= englishOccurrencesCount && !hasMultiSenseHomonymOverclaim) {
      continue;
    }

    // Track how many English occurrences in this group remain unsatisfied so homonym groups
    // never emit duplicate contextual warnings for the same unsatisfied occurrence.
    let remainingUnsatisfiedCount = Math.max(
      englishOccurrencesCount - groupApprovedCount,
      hasMultiSenseHomonymOverclaim ? 1 : 0
    );
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

      // 1. Check explicit avoidTranslations against preclaimed spans or remaining UNCONSUMED Bangla spans,
      //    excluding any form that is an approved translation of a sibling homonym sense in the same group.
      let matchedAvoidSpan: BanglaTermMatchSpan | null = entry.preclaimedAvoidSpans[0] ?? null;
      if (!matchedAvoidSpan) {
        for (const avoidTerm of avoidTranslations) {
          const expandedAvoid = expandApprovedBanglaCompoundForms(avoidTerm);
          if (
            group.entries.length > 1 &&
            expandedAvoid.some((f) => siblingApprovedBanglaForms.has(f))
          ) {
            continue;
          }

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
        item.isContextSensitive ||
          group.entries.length > 1 ||
          (!item.lockedByUser && Boolean(item.contextMeaning))
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

  // PASS 3 (PPH-4.4 Layer 3): Target-side ungrounded glossary injection guard (`compound_headword_bleed`).
  // Detects when a multi-word glossary item's Bangla target appears in `banglaText` more times than its
  // English source (or registered alias) appears in `englishText` AND `englishText` contains a sibling
  // compound sharing its leading modifier with a different headword.
  const bleedFindings = findUngroundedGlossaryInjections(
    paragraph,
    normalizedGlossary,
    consumedBanglaSpans
  );
  for (const bf of bleedFindings) {
    findings.push(bf);
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

/**
 * PPH-4.4 Layer 3: Target-side ungrounded glossary injection guard.
 * Checks every multi-word glossary item: if its Bangla target occurs in the Bangla paragraph
 * in excess of its English source/alias occurrences (including when the English source does not
 * occur at all), AND the English paragraph contains a sibling compound phrase sharing a leading
 * content modifier with a different headword, emits a `TerminologyLintFinding` with
 * `code: 'compound_headword_bleed'`.
 */
export function findUngroundedGlossaryInjections(
  paragraphOrEnglish: ParagraphPair | string,
  glossaryOrBangla: ReadonlyArray<TerminologyMemoryItem> | string,
  maybeGlossaryOrConsumed?:
    | ReadonlyArray<TerminologyMemoryItem>
    | ReadonlyArray<{ start: number; end: number }>,
  maybeConsumedSpans?: ReadonlyArray<{ start: number; end: number }>
): TerminologyLintFinding[] {
  let paragraph: ParagraphPair;
  let glossary: ReadonlyArray<TerminologyMemoryItem>;
  let preConsumedBanglaSpans: ReadonlyArray<{ start: number; end: number }> | undefined;

  if (typeof paragraphOrEnglish === 'string') {
    paragraph = {
      index: 0,
      englishText: paragraphOrEnglish,
      banglaText: typeof glossaryOrBangla === 'string' ? glossaryOrBangla : '',
    };
    glossary = Array.isArray(maybeGlossaryOrConsumed)
      ? (maybeGlossaryOrConsumed as ReadonlyArray<TerminologyMemoryItem>)
      : [];
    preConsumedBanglaSpans = maybeConsumedSpans;
  } else {
    paragraph = paragraphOrEnglish;
    glossary = Array.isArray(glossaryOrBangla) ? glossaryOrBangla : [];
    preConsumedBanglaSpans = Array.isArray(maybeGlossaryOrConsumed)
      ? (maybeGlossaryOrConsumed as ReadonlyArray<{ start: number; end: number }>)
      : undefined;
  }

  const englishText = paragraph.englishText ?? '';
  const banglaText = normalizeBanglaUnicode(paragraph.banglaText ?? '');
  if (!englishText.trim() || !banglaText || paragraph.missingTranslation) {
    return [];
  }

  const normalizedGlossary = normalizeGlossaryList(glossary);
  const bleedFindings: TerminologyLintFinding[] = [];
  const localConsumed: Array<{ start: number; end: number }> = preConsumedBanglaSpans
    ? [...preConsumedBanglaSpans]
    : [];

  for (const item of normalizedGlossary) {
    if (item.category === 'expression') continue;
    const surfaceTerm = getEnglishSurfaceTerm(item.englishTerm);
    const tokens = surfaceTerm.split(/[\s-]+/).filter(Boolean);
    if (tokens.length < 2) continue;

    const siblingCollisions = detectSiblingCompoundCollisions(englishText, [item]);
    if (siblingCollisions.length === 0) continue;

    // Also check if a >=3-word proper institutional term has a trailing >=2-word proper sub-phrase
    // ending in the exact same headword
    let englishOccurrences = findEnglishTermOccurrences(englishText, item);
    if (englishOccurrences.length === 0 && tokens.length >= 3) {
      const trailingSubPhrase = tokens.slice(1).join(' ');
      if (/^[A-Z]/.test(tokens[1])) {
        englishOccurrences = findSingleEnglishSurfaceTermOccurrences(
          englishText,
          trailingSubPhrase,
          item
        );
      }
    }

    const candidateForms = expandApprovedBanglaCompoundForms(item.banglaTranslation);
    const allTargetSpans: BanglaTermMatchSpan[] = [];
    for (const form of candidateForms) {
      const spans = findBanglaTermOccurrences(banglaText, form, {
        banglaStem:
          form === normalizeBanglaUnicode(item.banglaTranslation)
            ? item.banglaStem
            : undefined,
        allowInflections: item.allowInflections,
      });
      for (const s of spans) {
        if (!allTargetSpans.some((existing) => spansOverlap(existing, s))) {
          allTargetSpans.push(s);
        }
      }
    }
    allTargetSpans.sort((a, b) => a.start - b.start || a.end - b.end);

    if (allTargetSpans.length <= englishOccurrences.length) {
      continue;
    }

    // Identify ungrounded target spans: either spans not already claimed in Pass 1A-1C,
    // or excess spans beyond `englishOccurrences.length` when called standalone.
    const ungroundedSpans = preConsumedBanglaSpans
      ? allTargetSpans.filter((s) => !localConsumed.some((c) => spansOverlap(s, c)))
      : allTargetSpans.slice(englishOccurrences.length);

    if (ungroundedSpans.length === 0) {
      continue;
    }

    const ungroundedSpan = ungroundedSpans[0];
    localConsumed.push({ start: ungroundedSpan.start, end: ungroundedSpan.end });
    const primaryCollision = siblingCollisions[0];

    const description =
      englishOccurrences.length === 0
        ? `Paragraph ${paragraph.index + 1} [compound_headword_bleed]: Glossary target "${ungroundedSpan.matchedText}" (for "${item.englishTerm}") was injected into a paragraph containing sibling compound "${primaryCollision.matchedSiblingPhrase}" where "${item.englishTerm}" does not occur.`
        : `Paragraph ${paragraph.index + 1} [compound_headword_bleed]: Glossary target "${ungroundedSpan.matchedText}" (for "${item.englishTerm}") appears ${allTargetSpans.length} times in Bangla while "${item.englishTerm}" occurs only ${englishOccurrences.length} time(s) in English alongside sibling compound "${primaryCollision.matchedSiblingPhrase}".`;

    bleedFindings.push(
      createFinding({
        paragraph,
        item,
        matchedEnglishText: primaryCollision.matchedSiblingPhrase,
        detectedBanglaVariant: ungroundedSpan.matchedText,
        severity: 'high',
        classification: 'definite_violation',
        reason: 'unapproved_variant_used',
        code: 'compound_headword_bleed',
        description,
      })
    );
  }

  return bleedFindings;
}

function createFinding(params: {
  paragraph: ParagraphPair;
  item: TerminologyMemoryItem;
  matchedEnglishText: string;
  detectedBanglaVariant?: string;
  severity: 'high' | 'medium' | 'low';
  classification: TerminologyFindingClassification;
  reason: TerminologyFindingReason;
  code?: string;
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
    code,
    description,
  } = params;

  const accepted = item.acceptedAlternatives ?? [];
  const acceptedHint =
    accepted.length > 0 ? ` (or accepted alternative: ${accepted.join(', ')})` : '';
  const editorialGuidance =
    code === 'compound_headword_bleed'
      ? `Do not apply "${item.banglaTranslation}" (which belongs strictly to "${item.englishTerm}") to the sibling compound "${matchedEnglishText}"; translate the distinct head noun of "${matchedEnglishText}" accurately.`
      : detectedBanglaVariant
        ? `Replace "${detectedBanglaVariant}" with "${item.banglaTranslation}"${acceptedHint} while adjusting surrounding Bangla case endings if needed.`
        : `Use "${item.banglaTranslation}"${acceptedHint} for "${matchedEnglishText}" if literal reference is intended.`;

  return {
    id:
      code === 'compound_headword_bleed'
        ? `term-lint-p${paragraph.index}-${item.id}-bleed`
        : `term-lint-p${paragraph.index}-${item.id}`,
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
    ...(code ? { code } : {}),
    matchedEnglishText,
    ...(detectedBanglaVariant ? { detectedBanglaVariant } : {}),
    englishExcerpt: buildExcerpt(paragraph.englishText),
    banglaExcerpt: buildExcerpt(paragraph.banglaText),
    description,
    suggestedFix: undefined,
    editorialGuidance,
    lockedByUser: Boolean(item.lockedByUser),
    isContextSensitive: Boolean(item.isContextSensitive),
    category: item.category,
    ...(item.contextMeaning ? { contextMeaning: item.contextMeaning } : {}),
  };
}

/**
 * Computes a deterministic content fingerprint for an English/Bangla paragraph pair.
 * Used during Stage 5 reconciliation so resolved terminology issues remain resolved
 * only while the underlying paragraph's English and Bangla text are unchanged.
 */
export function computeParagraphContentFingerprint(
  englishText: string,
  banglaText: string
): string {
  const normEn = normalizeEnglishTerm(englishText ?? '').toLowerCase();
  const normBn = normalizeBanglaUnicode(banglaText ?? '');
  return `${normEn}||${normBn}`;
}

/**
 * Computes a deterministic identity signature for a terminology lint finding or deterministic VerificationIssue.
 * Prefixed with `deterministic_lint::` so deterministic terminology findings can never collide with
 * or inherit resolved state from unrelated AI-generated Stage 5 literary QA findings.
 */
export function computeFindingSignature(
  findingOrIssue:
    | Pick<
        TerminologyLintFinding,
        'termId' | 'reason' | 'severity' | 'expectedBangla' | 'detectedBanglaVariant'
      >
    | Pick<
        VerificationIssue,
        'termId' | 'lintReason' | 'severity' | 'expectedBangla' | 'detectedBanglaVariant'
      >
): string {
  const termId = (findingOrIssue.termId ?? '').trim();
  const reason =
    'reason' in findingOrIssue
      ? findingOrIssue.reason
      : (findingOrIssue.lintReason ?? '');
  const severity = findingOrIssue.severity;
  const expectedBangla = normalizeBanglaUnicode(findingOrIssue.expectedBangla ?? '');
  const detectedBanglaVariant = normalizeBanglaUnicode(
    findingOrIssue.detectedBanglaVariant ?? ''
  );

  return `deterministic_lint::${termId}::${reason}::${severity}::${expectedBangla}::${detectedBanglaVariant}`;
}

/**
 * Converts a structured TerminologyLintFinding into a standard VerificationIssue
 * compatible with GolpoTranslate's Stage 5 verification report and completion gate.
 * Note: `paragraphIndex` is the 0-based `ParagraphPair.index` (`finding.paragraphIndex`),
 * while human-readable 1-based numbering remains in `finding.displayParagraphNumber` and `description`.
 * `suggestedFix` is intentionally left `undefined` so deterministic terminology findings
 * never supply an English editorial instruction as a full-paragraph Bangla replacement.
 */
export function terminologyFindingToVerificationIssue(
  finding: TerminologyLintFinding
): VerificationIssue {
  const guidanceSuffix =
    finding.editorialGuidance && !finding.description.includes(finding.editorialGuidance)
      ? ` ${finding.editorialGuidance}`
      : '';

  return {
    id: finding.id,
    severity: finding.severity,
    type: 'terminology',
    paragraphIndex: finding.paragraphIndex,
    description: `${finding.description}${guidanceSuffix}`,
    englishExcerpt: finding.englishExcerpt,
    banglaExcerpt: finding.banglaExcerpt,
    suggestedFix: undefined,
    resolved: false,
    source: 'deterministic_lint',
    termId: finding.termId,
    lintReason: finding.reason,
    expectedBangla: finding.expectedBangla,
    ...(finding.detectedBanglaVariant
      ? { detectedBanglaVariant: finding.detectedBanglaVariant }
      : {}),
    findingSignature: computeFindingSignature(finding),
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

// ============================================================================
// PHASE 2B.1 PURE INTEGRATION HELPERS
// ============================================================================

export interface HydrateGlossaryOptions {
  /**
   * Default AI provenance assigned to legacy entries with missing `source` metadata
   * and `lockedByUser !== true`. Restricted to non-user sources so missing metadata
   * never grants user-update authority or unlocks user-locked entries.
   */
  defaultLegacySource?: Exclude<TerminologySource, 'user'>;
}

/**
 * Conservatively hydrates persisted or legacy project glossary entries at rest:
 * 1. Assigns `defaultLegacySource` (`'stage1_ai'`) to any entry with missing/invalid `source`
 *    unless `lockedByUser === true` (which resolves to `'user'`).
 * 2. Missing `source` metadata NEVER grants user-update authority or allows a duplicate
 *    unlocked record (`lockedByUser: false`) to unlock or overwrite a `lockedByUser: true` entry.
 * 3. During passive storage hydration, if a persisted list contains both a `lockedByUser: true`
 *    entry and an unlocked duplicate (`lockedByUser: false`) for the same key, the locked entry
 *    strictly prevails regardless of array order.
 */
export function hydrateProjectGlossary(
  rawGlossary: ReadonlyArray<Partial<TerminologyMemoryItem>> | undefined | null,
  options: HydrateGlossaryOptions = {}
): TerminologyMemoryItem[] {
  if (!Array.isArray(rawGlossary) || rawGlossary.length === 0) {
    return [];
  }

  const rawDefaultLegacy = options.defaultLegacySource as string | undefined;
  const fallbackAiSource: Exclude<TerminologySource, 'user'> =
    rawDefaultLegacy &&
    rawDefaultLegacy !== 'user' &&
    isValidTerminologySource(rawDefaultLegacy)
      ? (rawDefaultLegacy as Exclude<TerminologySource, 'user'>)
      : 'stage1_ai';

  // Two-pass ordering: process explicitly user-locked entries (`lockedByUser: true`) or
  //preserve original order while guaranteeing that passive hydration never lets an unlocked
  // duplicate (`lockedByUser: false`) unlock or overwrite a locked entry.
  const deduplicated: TerminologyMemoryItem[] = [];

  for (let i = 0; i < rawGlossary.length; i++) {
    const rawItem = rawGlossary[i];
    if (!rawItem || typeof rawItem !== 'object') continue;

    const hasExplicitValidSource = isValidTerminologySource(rawItem.source);
    const explicitlyLocked = rawItem.lockedByUser === true;

    // Conservative provenance resolution:
    // - If `lockedByUser === true`, provenance is `'user'`.
    // - If `source` is missing/invalid and `lockedByUser !== true`, provenance is strictly `fallbackAiSource` (`'stage1_ai'`).
    // - If `source === 'user'` is explicitly stored with `lockedByUser: false`, it remains an unlocked user entry
    //   when standalone, but during passive hydration it must NOT act as an active unlock command against a locked duplicate.
    const conservativeSource: TerminologySource = explicitlyLocked
      ? 'user'
      : hasExplicitValidSource
        ? (rawItem.source as TerminologySource)
        : fallbackAiSource;

    const conservativeLocked: boolean = explicitlyLocked
      ? true
      : typeof rawItem.lockedByUser === 'boolean'
        ? rawItem.lockedByUser
        : conservativeSource === 'user';

    const sanitizedRaw: Partial<TerminologyMemoryItem> = {
      ...rawItem,
      source: conservativeSource,
      lockedByUser: conservativeLocked,
    };

    const candidate = normalizeTerminologyItem(sanitizedRaw, i);
    if (!candidate.englishTerm || !candidate.banglaTranslation) {
      continue;
    }

    const matchIdx = deduplicated.findIndex((existing) =>
      isSameGlossaryEntryKey(existing, candidate)
    );

    if (matchIdx === -1) {
      deduplicated.push(candidate);
      continue;
    }

    const current = deduplicated[matchIdx];

    // Passive hydration safeguard: if `current` is locked and `candidate` is unlocked,
    // treat `candidate` as a non-overwriting AI merge so passive storage loading never unlocks `current`.
    if (current.lockedByUser && !candidate.lockedByUser) {
      deduplicated[matchIdx] = mergeSingleGlossaryPair(
        current,
        { ...sanitizedRaw, source: fallbackAiSource, lockedByUser: false },
        { ...candidate, source: fallbackAiSource, lockedByUser: false },
        fallbackAiSource
      );
      continue;
    }

    // Conversely, if `current` is unlocked and `candidate` is locked, `candidate` upgrades the entry to locked!
    if (!current.lockedByUser && candidate.lockedByUser) {
      deduplicated[matchIdx] = mergeSingleGlossaryPair(
        current,
        { ...sanitizedRaw, source: 'user', lockedByUser: true },
        { ...candidate, source: 'user', lockedByUser: true },
        'user'
      );
      continue;
    }

    // Both have the same lock state: merge with conservative effective source
    const effectiveMergeSource: TerminologySource = candidate.lockedByUser
      ? 'user'
      : conservativeSource === 'user'
        ? fallbackAiSource
        : conservativeSource;

    deduplicated[matchIdx] = mergeSingleGlossaryPair(
      current,
      { ...sanitizedRaw, source: effectiveMergeSource },
      candidate,
      effectiveMergeSource
    );
  }

  // Ensure unique IDs across all hydrated entries without altering already-unique IDs
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
 * Hydrates a legacy or persisted TranslationProject in-memory without reprocessing
 * completed chapters, mutating paragraph order, shifting paragraph slots, or altering
 * scene-break / missing-translation metadata.
 */
export function hydrateLegacyProjectState(
  project: TranslationProject,
  options: HydrateGlossaryOptions = {}
): TranslationProject {
  return {
    ...project,
    terminologyMemory: hydrateProjectGlossary(project.terminologyMemory, options),
    chapters: project.chapters.map((ch) => ({
      ...ch,
      paragraphs: ch.paragraphs.map((p) => ({ ...p })),
      editorialNotes: [...(ch.editorialNotes ?? [])],
      editorialChanges: (ch.editorialChanges ?? []).map((ec) => ({ ...ec })),
      verificationReport: ch.verificationReport
        ? {
            ...ch.verificationReport,
            issues: ch.verificationReport.issues.map((iss) => ({ ...iss })),
          }
        : null,
    })),
  };
}

/**
 * Synchronizes location entries from `StoryContextProfile.locations` into the active glossary
 * with `source: 'location_sync'` and `category: 'place'`, strictly respecting existing user locks
 * and established `stage1_ai` primary translations.
 */
export function syncLocationsToGlossary(
  existingGlossary: ReadonlyArray<TerminologyMemoryItem>,
  locations: ReadonlyArray<{ name: string; banglaName: string; description?: string }> | undefined | null
): TerminologyMemoryItem[] {
  if (!Array.isArray(locations) || locations.length === 0) {
    return normalizeGlossaryList(existingGlossary);
  }

  const incomingPlaceItems: Array<Partial<TerminologyMemoryItem>> = locations
    .filter((loc) => loc && typeof loc.name === 'string' && typeof loc.banglaName === 'string')
    .map((loc, idx) => {
      const { surfaceTerm, parentheticalSense } = extractEnglishSurfaceAndSense(loc.name);
      const cleanEnglishName = surfaceTerm || normalizeEnglishTerm(loc.name);
      const separated = separateCanonicalAndExplanatoryBangla({
        englishTerm: cleanEnglishName,
        banglaTranslation: loc.banglaName,
      });
      const isPairedAlias = Boolean(parentheticalSense && separated.explanatoryMeaning);
      const noteParts = [
        ...(isPairedAlias
          ? [
              `Also called "${parentheticalSense}" -> "${separated.explanatoryMeaning}" (alternative name for this same location; use "${separated.explanatoryMeaning}" when the source text refers to "${parentheticalSense}", and never combine them in parentheses as "${separated.canonicalBangla} (${separated.explanatoryMeaning})" in prose)`,
            ]
          : parentheticalSense
            ? [`Also referred to as: ${parentheticalSense}`]
            : []),
        ...(loc.description?.trim() ? [loc.description.trim()] : []),
      ];
      return {
        id: `loc-sync-${idx}-${cleanEnglishName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'place'}`,
        englishTerm: cleanEnglishName,
        banglaTranslation: separated.canonicalBangla,
        ...(!isPairedAlias && separated.explanatoryMeaning
          ? { explanatoryMeaning: separated.explanatoryMeaning }
          : {}),
        category: 'place' as TerminologyCategory,
        notes: noteParts.join('; ') || 'Synced from Story Context locations',
        contextMeaning: undefined,
        isContextSensitive: false,
        source: 'location_sync' as TerminologySource,
        lockedByUser: false,
      };
    });

  return mergeGlossaryItems(existingGlossary, incomingPlaceItems, {
    defaultSource: 'location_sync',
  });
}

export interface Stage1WindowSlice {
  windowIndex: number;
  text: string;
  charCount: number;
  paragraphCount: number;
  startParagraphIndex: number;
  endParagraphIndex: number;
}

export interface Stage1WindowPlan {
  totalChars: number;
  totalParagraphs: number;
  maxWindowChars: number;
  maxWindows: number;
  allWindows: Stage1WindowSlice[];
  scheduledWindows: Stage1WindowSlice[];
  skippedWindowIndices: number[];
}

export interface Stage1WindowAnalysisPayload {
  storyContext?: Partial<StoryContextProfile> | null;
  characters?: Array<Partial<CharacterMemoryItem>>;
  terminology?: Array<Partial<TerminologyMemoryItem>>;
}

export interface Stage1WindowExecutionOutcome {
  windowIndex: number;
  success: boolean;
  payload?: Stage1WindowAnalysisPayload;
  errorMessage?: string;
}

function splitOversizedParagraphOnSentences(
  paragraphText: string,
  maxWindowChars: number
): string[] {
  const sentences = paragraphText
    .split(/(?<=[.!?]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    const pieces: string[] = [];
    for (let offset = 0; offset < paragraphText.length; offset += maxWindowChars) {
      pieces.push(paragraphText.slice(offset, offset + maxWindowChars));
    }
    return pieces;
  }

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxWindowChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < sentence.length; offset += maxWindowChars) {
        chunks.push(sentence.slice(offset, offset + maxWindowChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxWindowChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Splits a chapter's English text into paragraph-aligned windows for Stage 1 pre-analysis
 * without silent mid-chapter truncation.
 * - Paragraphs are never reordered or dropped.
 * - Windows beyond `maxWindows` (default 8 = ~96,000 chars) are explicitly recorded in
 *   `skippedWindowIndices` so coverage metadata accurately reports incomplete analysis.
 */
export function splitTextIntoStage1Windows(
  englishText: string,
  options: { maxWindowChars?: number; maxWindows?: number } = {}
): Stage1WindowPlan {
  const maxWindowChars = Math.max(1000, options.maxWindowChars ?? 12000);
  const maxWindows = Math.max(1, options.maxWindows ?? 8);

  const normalizedSource = (englishText ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalizedSource) {
    return {
      totalChars: 0,
      totalParagraphs: 0,
      maxWindowChars,
      maxWindows,
      allWindows: [],
      scheduledWindows: [],
      skippedWindowIndices: [],
    };
  }

  const rawParagraphs = normalizedSource
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const allWindows: Stage1WindowSlice[] = [];
  let currentParagraphs: string[] = [];
  let currentStartIdx = 0;
  let currentCharLen = 0;

  const flushWindow = (endParagraphIdx: number) => {
    if (currentParagraphs.length === 0) return;
    const text = currentParagraphs.join('\n\n');
    allWindows.push({
      windowIndex: allWindows.length,
      text,
      charCount: text.length,
      paragraphCount: currentParagraphs.length,
      startParagraphIndex: currentStartIdx,
      endParagraphIndex: endParagraphIdx,
    });
    currentParagraphs = [];
    currentCharLen = 0;
  };

  for (let pIdx = 0; pIdx < rawParagraphs.length; pIdx++) {
    const para = rawParagraphs[pIdx];

    if (para.length > maxWindowChars) {
      if (currentParagraphs.length > 0) {
        flushWindow(pIdx - 1);
      }
      const pieces = splitOversizedParagraphOnSentences(para, maxWindowChars);
      for (const piece of pieces) {
        allWindows.push({
          windowIndex: allWindows.length,
          text: piece,
          charCount: piece.length,
          paragraphCount: 1,
          startParagraphIndex: pIdx,
          endParagraphIndex: pIdx,
        });
      }
      currentStartIdx = pIdx + 1;
      continue;
    }

    const addedLen = currentParagraphs.length === 0 ? para.length : currentCharLen + 2 + para.length;
    if (addedLen > maxWindowChars && currentParagraphs.length > 0) {
      flushWindow(pIdx - 1);
      currentStartIdx = pIdx;
    }

    if (currentParagraphs.length === 0) {
      currentStartIdx = pIdx;
    }
    currentParagraphs.push(para);
    currentCharLen = currentParagraphs.length === 1 ? para.length : currentCharLen + 2 + para.length;
  }

  if (currentParagraphs.length > 0) {
    flushWindow(rawParagraphs.length - 1);
  }

  const totalChars = allWindows.reduce((acc, w) => acc + w.charCount, 0);
  const scheduledWindows = allWindows.slice(0, maxWindows);
  const skippedWindowIndices = allWindows
    .slice(maxWindows)
    .map((w) => w.windowIndex);

  return {
    totalChars,
    totalParagraphs: rawParagraphs.length,
    maxWindowChars,
    maxWindows,
    allWindows,
    scheduledWindows,
    skippedWindowIndices,
  };
}

/**
 * Computes accurate Stage 1 pre-analysis coverage metadata from a `Stage1WindowPlan`
 * and per-window execution outcomes.
 * - A chapter is NEVER reported as `isComplete: true` if any window failed or was skipped.
 * - `analyzedChars` counts ONLY characters from windows that succeeded.
 * - Partial-coverage warnings live in `warningMessage` (never injected into `storyContext`).
 */
export function computeStage1Coverage(
  windowPlan: Stage1WindowPlan,
  outcomes: ReadonlyArray<Stage1WindowExecutionOutcome>
): Stage1CoverageMetadata {
  const totalWindows = windowPlan.allWindows.length;
  const totalChars = windowPlan.totalChars;

  if (totalWindows === 0 || totalChars === 0) {
    return {
      totalChars: 0,
      analyzedChars: 0,
      totalWindows: 0,
      successfulWindows: 0,
      failedWindowIndices: [],
      skippedWindowIndices: [],
      isComplete: true,
      isPartial: false,
    };
  }

  const outcomeByIndex = new Map<number, Stage1WindowExecutionOutcome>();
  for (const outcome of outcomes) {
    outcomeByIndex.set(outcome.windowIndex, outcome);
  }

  let analyzedChars = 0;
  let successfulWindows = 0;
  const failedWindowIndices: number[] = [];
  const budgetSkippedSet = new Set<number>(windowPlan.skippedWindowIndices);
  const unexecutedScheduledIndices: number[] = [];
  const skippedSet = new Set<number>(windowPlan.skippedWindowIndices);

  for (const win of windowPlan.allWindows) {
    if (budgetSkippedSet.has(win.windowIndex)) {
      continue;
    }
    const outcome = outcomeByIndex.get(win.windowIndex);
    if (!outcome) {
      unexecutedScheduledIndices.push(win.windowIndex);
      skippedSet.add(win.windowIndex);
      continue;
    }
    if (outcome.success) {
      successfulWindows++;
      analyzedChars += win.charCount;
    } else {
      failedWindowIndices.push(win.windowIndex);
    }
  }

  const budgetSkippedIndices = Array.from(budgetSkippedSet).sort((a, b) => a - b);
  unexecutedScheduledIndices.sort((a, b) => a - b);
  const skippedWindowIndices = Array.from(skippedSet).sort((a, b) => a - b);
  failedWindowIndices.sort((a, b) => a - b);

  const isComplete =
    successfulWindows === totalWindows &&
    failedWindowIndices.length === 0 &&
    skippedWindowIndices.length === 0;
  const isPartial = !isComplete;

  let warningMessage: string | undefined;
  if (isPartial) {
    const details: string[] = [];
    if (failedWindowIndices.length > 0) {
      details.push(
        `${failedWindowIndices.length} window(s) failed (#${failedWindowIndices.map((i) => i + 1).join(', #')})`
      );
    }
    if (budgetSkippedIndices.length > 0) {
      details.push(
        `${budgetSkippedIndices.length} window(s) skipped due to window budget (#${budgetSkippedIndices.map((i) => i + 1).join(', #')})`
      );
    }
    if (unexecutedScheduledIndices.length > 0) {
      details.push(
        `${unexecutedScheduledIndices.length} scheduled window(s) had no recorded outcome (#${unexecutedScheduledIndices.map((i) => i + 1).join(', #')})`
      );
    }
    warningMessage = `Stage 1 pre-analysis coverage is partial: analyzed ${successfulWindows} of ${totalWindows} windows (${analyzedChars} of ${totalChars} characters; ${details.join('; ')}). While Stage 3 still translates all chapter paragraphs, upfront Stage 1 terminology and entity extraction did not cover the unanalyzed window(s).`;
  }

  return {
    totalChars,
    analyzedChars,
    totalWindows,
    successfulWindows,
    failedWindowIndices,
    skippedWindowIndices,
    isComplete,
    isPartial,
    ...(warningMessage ? { warningMessage } : {}),
  };
}

export interface MergedStage1WindowResults {
  storyContext: StoryContextProfile;
  characterMemory: CharacterMemoryItem[];
  terminologyMemory: TerminologyMemoryItem[];
  coverage: Stage1CoverageMetadata;
}

/**
 * Aggregates multi-window Stage 1 outputs into existing project memory:
 * 1. Preserves Window 1's primary `storyContext` (`summary`, `narrativeTimeline`, `emotionalContext`, `literaryTone`)
 *    without letting continuation windows overwrite them; deduplicates `importantEvents` and `locations`.
 * 2. Never injects coverage warnings into `storyContext`.
 * 3. Deduplicates `characterMemory` across windows and preserves existing character entries.
 * 4. Merges `terminology` across windows using the 3-tier priority hierarchy:
 *    `1. user-locked` > `2. stage1_ai` > `3. chunk_ai` (where `stage1_ai` supersedes provisional `chunk_ai`
 *    primary translations while preserving user locks and first-window `stage1_ai` decisions).
 */
export function mergeStage1WindowResults(params: {
  existingGlossary?: ReadonlyArray<Partial<TerminologyMemoryItem>>;
  existingContext?: StoryContextProfile | null;
  existingCharacters?: ReadonlyArray<CharacterMemoryItem>;
  windowPlan: Stage1WindowPlan;
  windowOutcomes: ReadonlyArray<Stage1WindowExecutionOutcome>;
  syncLocations?: boolean;
}): MergedStage1WindowResults {
  const {
    existingGlossary = [],
    existingContext = null,
    existingCharacters = [],
    windowPlan,
    windowOutcomes,
    syncLocations = true,
  } = params;

  const coverage = computeStage1Coverage(windowPlan, windowOutcomes);
  const successfulOutcomes = [...windowOutcomes]
    .filter((o) => o.success && o.payload)
    .sort((a, b) => a.windowIndex - b.windowIndex);

  const primaryContextPayload = successfulOutcomes[0]?.payload?.storyContext;

  const importantEventsSet = new Set<string>();
  const mergedEvents: string[] = [];
  const addEvent = (ev: unknown) => {
    if (typeof ev !== 'string') return;
    const trimmed = ev.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!importantEventsSet.has(key)) {
      importantEventsSet.add(key);
      mergedEvents.push(trimmed);
    }
  };

  for (const ev of existingContext?.importantEvents ?? []) {
    addEvent(ev);
  }
  for (const outcome of successfulOutcomes) {
    for (const ev of outcome.payload?.storyContext?.importantEvents ?? []) {
      addEvent(ev);
    }
  }

  const locationMap = new Map<
    string,
    { name: string; banglaName: string; description: string }
  >();
  const addLocation = (loc: {
    name?: string;
    banglaName?: string;
    description?: string;
  }) => {
    const rawName = normalizeEnglishTerm(loc?.name ?? '');
    const rawBanglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!rawName || !rawBanglaName) return;
    const { surfaceTerm, parentheticalSense } = extractEnglishSurfaceAndSense(rawName);
    const name = surfaceTerm || rawName;
    const separated = separateCanonicalAndExplanatoryBangla({
      englishTerm: name,
      banglaTranslation: rawBanglaName,
    });
    const banglaName = separated.canonicalBangla || rawBanglaName;
    const isPairedAlias = Boolean(parentheticalSense && separated.explanatoryMeaning);
    const descParts = [
      ...(isPairedAlias
        ? [
            `Also called "${parentheticalSense}" -> "${separated.explanatoryMeaning}" (alternative name for this same location)`,
          ]
        : [
            ...(parentheticalSense ? [`Also referred to as: ${parentheticalSense}`] : []),
            ...(separated.explanatoryMeaning
              ? [`Explanatory meaning: ${separated.explanatoryMeaning}`]
              : []),
          ]),
      ...((loc?.description ?? '').trim() ? [(loc?.description ?? '').trim()] : []),
    ];
    const combinedDesc = descParts.join('; ');
    const key = name.toLowerCase();
    const existingLoc = locationMap.get(key);
    if (!existingLoc) {
      locationMap.set(key, {
        name,
        banglaName,
        description: combinedDesc,
      });
    } else if (!existingLoc.description && combinedDesc) {
      existingLoc.description = combinedDesc;
    }
  };

  for (const loc of existingContext?.locations ?? []) {
    addLocation(loc);
  }
  for (const outcome of successfulOutcomes) {
    for (const loc of outcome.payload?.storyContext?.locations ?? []) {
      addLocation(loc);
    }
  }

  const storyContext: StoryContextProfile = {
    summary:
      primaryContextPayload?.summary?.trim() ||
      existingContext?.summary?.trim() ||
      '',
    narrativeTimeline:
      primaryContextPayload?.narrativeTimeline?.trim() ||
      existingContext?.narrativeTimeline?.trim() ||
      '',
    importantEvents: mergedEvents,
    emotionalContext:
      primaryContextPayload?.emotionalContext?.trim() ||
      existingContext?.emotionalContext?.trim() ||
      '',
    literaryTone:
      primaryContextPayload?.literaryTone?.trim() ||
      existingContext?.literaryTone?.trim() ||
      '',
    locations: Array.from(locationMap.values()),
  };

  // Merge character memory across windows without overwriting existing character definitions
  const characterMap = new Map<string, CharacterMemoryItem>();
  for (const char of existingCharacters) {
    const name = normalizeEnglishTerm(char.englishName);
    if (!name) continue;
    characterMap.set(name.toLowerCase(), { ...char, englishName: name });
  }

  for (const outcome of successfulOutcomes) {
    for (const rawChar of outcome.payload?.characters ?? []) {
      const englishName = normalizeEnglishTerm(rawChar.englishName ?? '');
      const banglaName = normalizeBanglaUnicode(rawChar.banglaName ?? '');
      if (!englishName || !banglaName) continue;
      const key = englishName.toLowerCase();
      const existingChar = characterMap.get(key);
      if (!existingChar) {
        characterMap.set(key, {
          id:
            rawChar.id?.trim() ||
            `char-${characterMap.size + 1}-${key.replace(/[^a-z0-9]+/g, '-')}`,
          englishName,
          banglaName,
          relationships: rawChar.relationships?.trim() || '',
          pronouns: rawChar.pronouns?.trim() || '',
          personality: rawChar.personality?.trim() || '',
          speakingStyle: rawChar.speakingStyle?.trim() || '',
          notes: rawChar.notes?.trim() || '',
        });
      } else {
        characterMap.set(key, {
          ...existingChar,
          relationships: existingChar.relationships || rawChar.relationships?.trim() || '',
          pronouns: existingChar.pronouns || rawChar.pronouns?.trim() || '',
          personality: existingChar.personality || rawChar.personality?.trim() || '',
          speakingStyle: existingChar.speakingStyle || rawChar.speakingStyle?.trim() || '',
          notes: existingChar.notes || rawChar.notes?.trim() || '',
        });
      }
    }
  }

  // Conservatively hydrate existing glossary before merging Stage 1 windows
  let runningGlossary = hydrateProjectGlossary(existingGlossary);

  for (const outcome of successfulOutcomes) {
    const windowTerms = (outcome.payload?.terminology ?? []).map((t) => ({
      ...t,
      source: 'stage1_ai' as TerminologySource,
      lockedByUser: false,
    }));
    runningGlossary = mergeGlossaryItems(runningGlossary, windowTerms, {
      defaultSource: 'stage1_ai',
    });
  }

  if (syncLocations && storyContext.locations.length > 0) {
    runningGlossary = syncLocationsToGlossary(runningGlossary, storyContext.locations);
  }

  return {
    storyContext,
    characterMemory: Array.from(characterMap.values()),
    terminologyMemory: runningGlossary,
    coverage,
  };
}

/**
 * Formats an active glossary into a structured prompt constraint block for Stage 3 or Stage 4:
 * - Separates entries into Tier 1 (User-Locked), Tier 2 (Established Stage 1 / Location AI),
 *   and Tier 3 (Provisional Stage 3 Chunk-Discovered).
 * - Explicitly displays `acceptedAlternatives`, `avoidTranslations`, and contextual sense notes.
 * - In `'stage4'` mode, appends the 5-way Stage 4 Literary Polish Terminology Protection rules.
 */
export function formatGlossaryForPrompt(
  glossary: ReadonlyArray<TerminologyMemoryItem>,
  options: { stage?: 'stage3' | 'stage4' | 'stage5' } = {}
): string {
  const stage = options.stage ?? 'stage3';
  const normalized = normalizeGlossaryList(glossary);
  if (normalized.length === 0) {
    return 'No active glossary terms for this segment.';
  }

  const formatEntryLine = (item: TerminologyMemoryItem): string => {
    if (stage === 'stage3') {
      const separated = separateCanonicalAndExplanatoryBangla({
        englishTerm: item.englishTerm,
        banglaTranslation: item.banglaTranslation,
        explanatoryMeaning: item.explanatoryMeaning,
      });
      const { surfaceTerm: cleanSurface, parentheticalSense } =
        extractEnglishSurfaceAndSense(item.englishTerm);
      const isPairedLegacyAlias = Boolean(
        !separated.isLiteralBracketedMotif &&
          parentheticalSense &&
          separated.explanatoryMeaning &&
          !item.explanatoryMeaning
      );
      const displayEnglish = isPairedLegacyAlias
        ? cleanSurface || item.englishTerm
        : item.englishTerm;
      const banglaLabel = separated.isAmbiguousLegacyParenthetical
        ? `Legacy Unsplit Bangla (CONTAINS PARENTHETICAL NOTES — DO NOT COPY VERBATIM INTO PROSE): "${separated.canonicalBangla}"`
        : `Preferred Bangla: "${separated.canonicalBangla}"`;
      const parts: string[] = [
        `- "${displayEnglish}" (${item.category}${item.caseSensitive ? ', case-sensitive' : ''}) -> ${banglaLabel}`,
      ];
      if (item.acceptedAlternatives && item.acceptedAlternatives.length > 0) {
        parts.push(`Accepted Alternatives: [${item.acceptedAlternatives.map((a) => `"${a}"`).join(', ')}]`);
      }
      if (item.avoidTranslations && item.avoidTranslations.length > 0) {
        parts.push(`FORBIDDEN / AVOID: [${item.avoidTranslations.map((a) => `"${a}"`).join(', ')}]`);
      }
      if (isPairedLegacyAlias) {
        parts.push(
          `Paired Source Alias (alternative name for this same entity when the source uses "${parentheticalSense}"): "${parentheticalSense}" -> "${separated.explanatoryMeaning}" (never combine in parentheses as "${separated.canonicalBangla} (${separated.explanatoryMeaning})" in prose)`
        );
      } else if (separated.explanatoryMeaning) {
        parts.push(
          `Explanatory Meaning (Translator Reference Only — DO NOT insert in parentheses into story prose): "${separated.explanatoryMeaning}"`
        );
      }
      if (item.contextMeaning && !isPairedLegacyAlias) {
        parts.push(`Context Sense: ${item.contextMeaning}`);
      }
      if (item.notes) {
        parts.push(
          `Contextual Guidance (Translator Reference Only — DO NOT copy into story prose): ${item.notes}`
        );
      }
      if (separated.isAmbiguousLegacyParenthetical) {
        parts.push(
          `[Ambiguous Legacy Entry: use only the core canonical Bangla term in story prose; NEVER copy translator notes or parenthetical glosses into the narrative]`
        );
      }
      if (item.isContextSensitive && !isPairedLegacyAlias) {
        parts.push(`[Context-Sensitive Polysemous Term: apply only when this sense fits]`);
      }
      return parts.join(' | ');
    }

    const parts: string[] = [
      `- "${item.englishTerm}" (${item.category}${item.caseSensitive ? ', case-sensitive' : ''}) -> Preferred Bangla: "${item.banglaTranslation}"`,
    ];
    if (item.acceptedAlternatives && item.acceptedAlternatives.length > 0) {
      parts.push(`Accepted Alternatives: [${item.acceptedAlternatives.map((a) => `"${a}"`).join(', ')}]`);
    }
    if (item.avoidTranslations && item.avoidTranslations.length > 0) {
      parts.push(`FORBIDDEN / AVOID: [${item.avoidTranslations.map((a) => `"${a}"`).join(', ')}]`);
    }
    if (item.contextMeaning) {
      parts.push(`Context Sense: ${item.contextMeaning}`);
    }
    if (item.notes) {
      parts.push(`Notes: ${item.notes}`);
    }
    if (item.isContextSensitive) {
      parts.push(`[Context-Sensitive Polysemous Term: apply only when this sense fits]`);
    }
    return parts.join(' | ');
  };

  const tier1Locked = normalized.filter((t) => t.lockedByUser);
  const tier2Stage1 = normalized.filter(
    (t) => !t.lockedByUser && (t.source === 'stage1_ai' || t.source === 'location_sync' || t.source === 'user')
  );
  const tier3ChunkAi = normalized.filter(
    (t) => !t.lockedByUser && t.source === 'chunk_ai'
  );

  const sections: string[] = [];

  if (tier1Locked.length > 0) {
    sections.push(
      `[TIER 1 — MANDATORY USER-LOCKED TERMINOLOGY (HIGHEST AUTHORITY — MUST OBEY)]\n${tier1Locked.map(formatEntryLine).join('\n')}`
    );
  }

  if (tier2Stage1.length > 0) {
    sections.push(
      `[TIER 2 — ESTABLISHED STORY TERMINOLOGY (MAINTAIN CONSISTENCY — DO NOT DRIFT)]\n${tier2Stage1.map(formatEntryLine).join('\n')}`
    );
  }

  if (tier3ChunkAi.length > 0) {
    sections.push(
      `[TIER 3 — PROVISIONAL CHUNK-DISCOVERED TERMINOLOGY (KEEP CONSISTENT ACROSS CHUNKS)]\n${tier3ChunkAi.map(formatEntryLine).join('\n')}`
    );
  }

  if (stage === 'stage3') {
    sections.push(
      [
        '[STAGE 3 TERMINOLOGY & CONTEXTUAL APPLICATION RULES]',
        '1. User-Locked Terms (Tier 1): Strictly use the Preferred Bangla (or listed Accepted Alternatives) whenever the source concept appears. Never use any FORBIDDEN / AVOID translation.',
        '2. Established & Provisional Terms (Tier 2 & Tier 3): Maintain consistent Bangla terminology across all paragraphs and chunks.',
        '3. Proper Names & Named Landmarks: Keep named vessels, bells, paths, and landmarks (when listed as proper names in the glossary) as distinct proper names rather than translating them into generic common nouns.',
        '4. Recurring Expressions & Bracketed Motifs (category: "expression"): Preserve the intended recurring meaning, bracketed/italicized formatting, and verbal relationship between appearances (for example, if `*(Fine.)*` is rendered as `*(ঠিক আছে।)*`, then a later variation such as `*(Not fine. Paid.)*` must echo the same core Bangla root as `*(ঠিক নেই। শোধ হলো।)*` / `*(ঠিক নেই। শোধ।)*`). Allow context-sensitive variation when the original meaning genuinely changes—never force identical Bangla wording where doing so would distort the source.',
        '5. Contextual Sense & Natural Grammar: Apply glossary terms according to their contextual meaning in the sentence (do not force a glossary term into an unrelated idiom or sense), and attach natural Bangla grammatical suffixes/case endings (-টি, -টা, -গুলো, -ে, -ের, -তে, -য়, -কে) where syntax requires.',
        '6. Strict Separation of Canonical Terms vs. Translator-Facing Explanations: Use ONLY the Preferred Bangla canonical term in translated story prose and dialogue. Explanatory Meanings and Contextual Guidance are provided strictly for translator comprehension and worldbuilding accuracy—NEVER insert explanatory glosses in parentheses (such as "হ্যারো-টাইড (সর্বনাশা জোয়ার)") or append dictionary definitions into the story text unless the original English source sentence itself contains parentheses.',
      ].join('\n')
    );
  }

  if (stage === 'stage4') {
    sections.push(
      [
        '[STAGE 4 TERMINOLOGY PROTECTION & LITERARY POLISH RULES]',
        '1. User-Locked Terms (Tier 1): Strictly preserve the Preferred Bangla (or listed Accepted Alternatives). Never omit when the literal concept is present and never introduce any FORBIDDEN / AVOID rendering.',
        '2. Established & Provisional AI Terms (Tier 2 & Tier 3): Do not replace established Bangla terms with unlisted synonyms merely for stylistic variety.',
        '3. Recurring Expressions & Developing Motifs (category: "expression"): Preserve the recurring Bangla expression and its core root across related or developing appearances (e.g., `*(Fine.)*` → `*(ঠিক আছে।)*` and its negated callback `*(Not fine. Paid.)*` → `*(ঠিক নেই। শোধ হলো।)*` / `*(ঠিক নেই। পরিশোধিত।)*`), while respecting genuine shifts in source meaning and preserving surrounding `*...*` italics.',
        '4. Accepted Alternatives: You may keep or switch between the Preferred Bangla and explicitly listed Accepted Alternatives when rhythm or euphony benefits.',
        '5. Natural Bangla Grammatical Inflections (ALLOWED): You may freely attach or adjust natural Bangla nominal suffixes, classifiers, plurals, and case endings (-টি, -টা, -গুলো, -গুলি, -ে, -ের, -তে, -য়, -কে, -দের) on the protected Bangla root so sentence syntax flows naturally.',
        '6. Contextual Paraphrasing & Pronoun Cohesion (ALLOWED): When an unlocked descriptive noun repeats across adjacent clauses where natural literary Bangla uses a pronoun (সেটি, সেখানে, তার), or when a polysemous term is used in a different sense (e.g. a "school of fish" vs an educational institution), follow natural literary Bangla without introducing any FORBIDDEN / AVOID term.',
      ].join('\n')
    );
  }

  if (stage === 'stage5') {
    sections.push(
      [
        '[STAGE 5 TERMINOLOGY AUDIT RULES]',
        '1. Preferred & Accepted Forms (VALID): Do NOT flag a terminology issue when the Bangla translation uses either the Preferred Bangla or any listed Accepted Alternatives, including with natural Bangla grammatical suffixes, classifiers, plurals, and case endings (-টি, -টা, -গুলো, -গুলি, -ে, -ের, -তে, -য়, -কে, -দের).',
        '2. Forbidden / Avoid Terms & Tier 1 Locks (STRICT): ALWAYS flag a terminology issue if any FORBIDDEN / AVOID translation is used, or if a Tier 1 (User-Locked) term is omitted or replaced with an unapproved synonym when its literal English concept is present.',
        '3. Context-Sensitive Polysemous Terms & Recurring Motifs: For entries marked [Context-Sensitive Polysemous Term] or `expression`, verify that the English passage uses the term in the specified sense before flagging a mismatch, and allow context-sensitive variations (such as `*(Not fine. Paid.)*` echoing `*(Fine.)*` via `*(ঠিক নেই। ...)*`) when the source meaning genuinely shifts.',
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}

export const VALID_STAGE5_ISSUE_TYPES: ReadonlySet<VerificationIssueType> =
  new Set<VerificationIssueType>([
    'missing_content',
    'omitted_dialogue',
    'added_info',
    'changed_meaning',
    'character_reference',
    'terminology',
    'emotional_intent',
    'chronology',
  ]);

const STAGE5_ISSUE_TYPE_ALIASES: Readonly<Record<string, VerificationIssueType>> = {
  omission: 'missing_content',
  missing_clause: 'missing_content',
  missing_detail: 'missing_content',
  missing_number: 'missing_content',
  incomplete_translation: 'missing_content',
  dialogue_omission: 'omitted_dialogue',
  lost_dialogue: 'omitted_dialogue',
  dialogue_voice: 'changed_meaning',
  unsupported_addition: 'added_info',
  hallucination: 'added_info',
  invented_detail: 'added_info',
  context_contamination: 'added_info',
  factual_error: 'changed_meaning',
  factual_fidelity: 'changed_meaning',
  entity_fidelity: 'changed_meaning',
  object_substitution: 'changed_meaning',
  physical_action: 'changed_meaning',
  spatial_relationship: 'changed_meaning',
  spatial_relation: 'changed_meaning',
  sensory_imagery: 'changed_meaning',
  environmental_imagery: 'changed_meaning',
  polysemy: 'changed_meaning',
  contextual_polysemy: 'changed_meaning',
  idiom_distortion: 'changed_meaning',
  mistranslation: 'changed_meaning',
  numerical_mismatch: 'changed_meaning',
  pronoun_inconsistency: 'character_reference',
  honorific_mismatch: 'character_reference',
  speaker_attribution: 'character_reference',
  glossary_mismatch: 'terminology',
  term_inconsistency: 'terminology',
  metaphor_imagery: 'emotional_intent',
  tone_shift: 'emotional_intent',
  literary_nuance: 'emotional_intent',
  tense_aspect: 'chronology',
  tense_mismatch: 'chronology',
  negation_error: 'chronology',
  timeline_error: 'chronology',
};

/**
 * Safely normalizes a Stage 5 issue category string into one of the 8 canonical
 * `VerificationIssueType` values, mapping known rubric aliases and defaulting
 * unknown values conservatively to `'changed_meaning'`.
 */
export function normalizeStage5IssueType(
  rawType: unknown
): VerificationIssueType {
  if (typeof rawType !== 'string') {
    return 'changed_meaning';
  }
  const normalized = rawType
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (VALID_STAGE5_ISSUE_TYPES.has(normalized as VerificationIssueType)) {
    return normalized as VerificationIssueType;
  }
  return STAGE5_ISSUE_TYPE_ALIASES[normalized] ?? 'changed_meaning';
}

/**
 * Safely normalizes a Stage 5 issue severity value into `'high' | 'medium' | 'low'`.
 */
export function normalizeStage5IssueSeverity(
  rawSeverity: unknown
): 'high' | 'medium' | 'low' {
  if (typeof rawSeverity !== 'string') {
    return 'medium';
  }
  const norm = rawSeverity.trim().toLowerCase();
  if (norm === 'high' || norm === 'critical' || norm === 'severe' || norm === 'critical_error') {
    return 'high';
  }
  if (norm === 'low' || norm === 'minor' || norm === 'suggestion') {
    return 'low';
  }
  if (norm === 'medium' || norm === 'moderate' || norm === 'major') {
    return 'medium';
  }
  return 'medium';
}

/**
 * Computes the deterministic point penalty for a single unresolved `VerificationIssue` or severity level:
 * - `'high'` (critical factual error, object/entity/number substitution, omitted clause/dialogue): 8 points
 * - `'medium'` (major meaning/nuance shift, register/aspect distortion): 4 points
 * - `'low'` (minor fidelity note or stylistic suggestion): 1 point
 */
export function getVerificationIssueScorePenalty(
  issueOrSeverity:
    | Pick<VerificationIssue, 'severity' | 'resolved'>
    | 'high'
    | 'medium'
    | 'low'
): number {
  if (typeof issueOrSeverity === 'string') {
    if (issueOrSeverity === 'high') return 8;
    if (issueOrSeverity === 'medium') return 4;
    return 1;
  }
  if (issueOrSeverity.resolved) return 0;
  if (issueOrSeverity.severity === 'high') return 8;
  if (issueOrSeverity.severity === 'medium') return 4;
  return 1;
}

export interface MergeVerificationReportParams {
  aiReport?: VerificationReport | null;
  lintResult: ChapterTerminologyLintResult;
  numericalLintResult?: ChapterNumericalLintResult;
  paragraphs: ReadonlyArray<ParagraphPair>;
  previousReport?: VerificationReport | null;
  /**
   * Optional pre-edit unresolved penalty sum from the report prior to invalidating edited-paragraph issues,
   * used during `local_relint` so correcting a flagged paragraph restores its deducted score.
   */
  priorUnresolvedPenaltyOverride?: number;
  /**
   * - `'stage5_full'`: Combining a fresh AI Stage 5 VerificationReport with deterministic terminology lint.
   * - `'local_relint'`: Updating deterministic terminology findings after a local paragraph/glossary edit
   *   while preserving existing non-deterministic AI literary QA issues from `previousReport`.
   */
  mode?: 'stage5_full' | 'local_relint';
  checkedAt?: string;
}

/**
 * Combines AI-generated Stage 5 literary QA findings with deterministic `ChapterTerminologyLintResult`
 * and deterministic `ChapterNumericalLintResult` while strictly separating reconciliation of AI issues
 * vs. deterministic findings:
 * 1. Converts deterministic findings to 0-based `paragraphIndex` (`finding.paragraphIndex`) to match Stage 5 UI.
 * 2. Leaves `suggestedFix: undefined` on all deterministic issues (embedding remediation guidance in `description`).
 * 3. Reconciles `resolved: true` state on deterministic findings ONLY against previous `source === 'deterministic_lint'`
 *    issues whose `paragraphIndex`, `paragraphContentFingerprint`, AND `findingSignature` all match.
 * 4. Never allows a deterministic fingerprint match to alter or preserve the resolved state of an AI-generated issue.
 * 5. Preserves missing-paragraph and unresolved high-severity completion gates.
 */
export function mergeVerificationReportWithTerminologyLint(
  params: MergeVerificationReportParams
): VerificationReport {
  const {
    aiReport = null,
    lintResult,
    numericalLintResult: providedNumericalLint,
    paragraphs,
    previousReport = null,
    priorUnresolvedPenaltyOverride,
    mode = aiReport ? 'stage5_full' : 'local_relint',
    checkedAt = aiReport?.checkedAt ?? new Date().toISOString(),
  } = params;

  const numericalLintResult =
    providedNumericalLint ?? lintChapterNumericalConsistency(paragraphs);

  const paragraphByIndex = new Map<number, ParagraphPair>();
  for (const p of paragraphs) {
    paragraphByIndex.set(p.index, p);
  }

  // Partition previousReport issues strictly by provenance (`deterministic_lint` vs AI issues)
  const previousDeterministicIssues = (previousReport?.issues ?? []).filter(
    (iss) => iss.source === 'deterministic_lint'
  );
  const previousAiIssues = (previousReport?.issues ?? []).filter(
    (iss) => iss.source !== 'deterministic_lint'
  );

  // Build deterministic glossary VerificationIssues with 0-based paragraphIndex and fingerprint reconciliation
  const reconciledGlossaryIssues: VerificationIssue[] = lintResult.findings.map(
    (finding) => {
      const para = paragraphByIndex.get(finding.paragraphIndex);
      const paragraphContentFingerprint = para
        ? computeParagraphContentFingerprint(para.englishText, para.banglaText)
        : '';
      const findingSignature = computeFindingSignature(finding);

      // Match ONLY against previous deterministic issues on the exact same paragraph,
      // with identical underlying paragraph content AND identical finding signature.
      const matchingPreviousDet = previousDeterministicIssues.find(
        (prev) =>
          prev.source === 'deterministic_lint' &&
          prev.paragraphIndex === finding.paragraphIndex &&
          Boolean(paragraphContentFingerprint) &&
          prev.paragraphContentFingerprint === paragraphContentFingerprint &&
          prev.findingSignature === findingSignature
      );

      const guidanceSuffix =
        finding.editorialGuidance && !finding.description.includes(finding.editorialGuidance)
          ? ` ${finding.editorialGuidance}`
          : '';

      return {
        id: matchingPreviousDet?.id ?? finding.id,
        severity: finding.severity,
        type: 'terminology',
        paragraphIndex: finding.paragraphIndex, // 0-based index for Stage 5 UI & WorkspaceView
        description: `${finding.description}${guidanceSuffix}`,
        englishExcerpt: finding.englishExcerpt,
        banglaExcerpt: finding.banglaExcerpt,
        suggestedFix: undefined, // Never provide a Bangla paragraph replacement string on deterministic lint issues
        resolved: matchingPreviousDet ? Boolean(matchingPreviousDet.resolved) : false,
        source: 'deterministic_lint',
        termId: finding.termId,
        lintReason: finding.reason,
        expectedBangla: finding.expectedBangla,
        ...(finding.detectedBanglaVariant
          ? { detectedBanglaVariant: finding.detectedBanglaVariant }
          : {}),
        paragraphContentFingerprint,
        findingSignature,
      };
    }
  );

  // Build deterministic numerical VerificationIssues (only for confirmed mismatches)
  const reconciledNumericalIssues: VerificationIssue[] =
    numericalLintResult.confirmedMismatches.map((finding) => {
      const para = paragraphByIndex.get(finding.paragraphIndex);
      const paragraphContentFingerprint = para
        ? computeParagraphContentFingerprint(para.englishText, para.banglaText)
        : '';
      const findingSignature = finding.findingSignature;

      const matchingPreviousDet = previousDeterministicIssues.find(
        (prev) =>
          prev.source === 'deterministic_lint' &&
          prev.paragraphIndex === finding.paragraphIndex &&
          Boolean(paragraphContentFingerprint) &&
          prev.paragraphContentFingerprint === paragraphContentFingerprint &&
          prev.findingSignature === findingSignature
      );

      const baseIssue = numericalFindingToVerificationIssue(finding);
      return {
        ...baseIssue,
        id: matchingPreviousDet?.id ?? baseIssue.id,
        resolved: matchingPreviousDet ? Boolean(matchingPreviousDet.resolved) : false,
        paragraphContentFingerprint,
        findingSignature,
      };
    });

  const reconciledDeterministicIssues: VerificationIssue[] = [
    ...reconciledGlossaryIssues,
    ...reconciledNumericalIssues,
  ];

  // Determine which AI issues to keep based on `mode`
  const rawAiSourceIssues: VerificationIssue[] =
    mode === 'stage5_full' && aiReport
      ? aiReport.issues
      : previousAiIssues;

  // Normalize AI issues with `source: 'ai_stage5'` while enforcing strict `paragraphIndex` and `suggestedFix` validation,
  // stamping `paragraphContentFingerprint`, conservatively preserving `resolved: true` on unchanged paragraphs,
  // and deduplicating any AI `terminology` or numerical `changed_meaning` issue that overlaps with a deterministic finding.
  const computeStrictAiFindingSignature = (
    iss: Pick<
      VerificationIssue,
      'type' | 'severity' | 'englishExcerpt' | 'banglaExcerpt' | 'findingSignature'
    >
  ): string | undefined => {
    if (
      typeof iss.findingSignature === 'string' &&
      iss.findingSignature.trim().length > 0 &&
      !iss.findingSignature.startsWith('deterministic_lint::')
    ) {
      return iss.findingSignature.trim();
    }
    const enEx = normalizeEnglishTerm(iss.englishExcerpt ?? '').toLowerCase();
    const bnEx = normalizeBanglaUnicode(iss.banglaExcerpt ?? '');
    if (enEx.length > 0 && bnEx.length > 0) {
      return `ai_stage5::${iss.type}::${iss.severity}::${enEx}::${bnEx}`;
    }
    return undefined;
  };

  const survivingAiIssues: VerificationIssue[] = [];
  let deduplicatedAiPenalty = 0;
  for (const aiIss of rawAiSourceIssues) {
    if (!aiIss || typeof aiIss !== 'object') {
      continue;
    }
    if (aiIss.source === 'deterministic_lint') {
      continue;
    }

    // Reject issues with missing or whitespace-only explanation (`description`)
    if (
      typeof aiIss.description !== 'string' ||
      aiIss.description.trim().length === 0
    ) {
      continue;
    }

    const normalizedType = normalizeStage5IssueType(aiIss.type);
    const normalizedSeverity = normalizeStage5IssueSeverity(aiIss.severity);

    // Strict paragraphIndex validation:
    // - Missing or null (`undefined` | `null`): legitimate chapter-level issue (`paragraphIndex: undefined`, `suggestedFix: undefined`)
    // - Negative, non-integer, non-finite, non-number, or out-of-range: invalid issue -> reject!
    const rawIdx = (aiIss as { paragraphIndex?: unknown }).paragraphIndex;
    let validParagraphIndex: number | undefined;
    let paraForIssue: ParagraphPair | undefined;

    if (rawIdx === undefined || rawIdx === null) {
      validParagraphIndex = undefined;
    } else if (
      typeof rawIdx === 'number' &&
      Number.isFinite(rawIdx) &&
      Number.isInteger(rawIdx) &&
      rawIdx >= 0 &&
      paragraphByIndex.has(rawIdx)
    ) {
      validParagraphIndex = rawIdx;
      paraForIssue = paragraphByIndex.get(rawIdx);
    } else {
      // Reject invalid/out-of-range paragraphIndex
      continue;
    }

    if (
      (normalizedType === 'terminology' ||
        normalizedType === 'changed_meaning' ||
        normalizedType === 'character_reference') &&
      validParagraphIndex !== undefined
    ) {
      const overlapsDeterministic = lintResult.findings.some((f) => {
        if (f.paragraphIndex !== validParagraphIndex) return false;
        const surfaceLower = getEnglishSurfaceTerm(f.englishTerm).toLowerCase();
        const descLower = (aiIss.description ?? '').toLowerCase();
        const enExcerptLower = (aiIss.englishExcerpt ?? '').toLowerCase();
        const mentionsEn =
          descLower.includes(surfaceLower) || enExcerptLower.includes(surfaceLower);
        const mentionsBn =
          Boolean(f.expectedBangla && (aiIss.description ?? '').includes(f.expectedBangla)) ||
          Boolean(
            f.detectedBanglaVariant &&
              ((aiIss.description ?? '').includes(f.detectedBanglaVariant) ||
                (aiIss.banglaExcerpt ?? '').includes(f.detectedBanglaVariant))
          );
        return normalizedType === 'terminology'
          ? mentionsEn || mentionsBn
          : mentionsEn && mentionsBn;
      });

      if (overlapsDeterministic) {
        if (!aiIss.resolved) {
          deduplicatedAiPenalty += getVerificationIssueScorePenalty(normalizedSeverity);
        }
        continue;
      }
    }

    if (
      (normalizedType === 'changed_meaning' ||
        normalizedType === 'missing_content' ||
        normalizedType === 'added_info') &&
      validParagraphIndex !== undefined
    ) {
      const overlapsNumerical = numericalLintResult.confirmedMismatches.some((nf) => {
        if (nf.paragraphIndex !== validParagraphIndex) return false;
        const matchedEnLower = nf.matchedEnglishText.toLowerCase();
        const numberOnlyLower = nf.matchedEnglishText
          .toLowerCase()
          .replace(/^(?:number|no\.?|aged?)\s+/i, '');
        const descLower = (aiIss.description ?? '').toLowerCase();
        const enExcerptLower = (aiIss.englishExcerpt ?? '').toLowerCase();
        const mentionsEn =
          descLower.includes(matchedEnLower) ||
          enExcerptLower.includes(matchedEnLower) ||
          (numberOnlyLower.length > 0 &&
            (descLower.includes(numberOnlyLower) ||
              enExcerptLower.includes(numberOnlyLower))) ||
          descLower.includes(String(nf.expectedValue)) ||
          enExcerptLower.includes(String(nf.expectedValue));
        const mentionsBn =
          (Boolean(nf.detectedBanglaText) &&
            ((aiIss.description ?? '').includes(nf.detectedBanglaText!) ||
              (aiIss.banglaExcerpt ?? '').includes(nf.detectedBanglaText!))) ||
          (nf.detectedValue !== undefined &&
            descLower.includes(String(nf.detectedValue))) ||
          Boolean(
            nf.expectedBangla &&
              (aiIss.description ?? '').includes(nf.expectedBangla)
          );
        return mentionsEn && mentionsBn;
      });

      if (overlapsNumerical) {
        if (!aiIss.resolved) {
          deduplicatedAiPenalty += getVerificationIssueScorePenalty(normalizedSeverity);
        }
        continue;
      }
    }

    // Chapter-level issues must NEVER carry a suggestedFix.
    // Paragraph-level issues retain suggestedFix ONLY when it is a non-empty string containing Bangla script.
    const sanitizedSuggestedFix =
      validParagraphIndex !== undefined &&
      typeof aiIss.suggestedFix === 'string' &&
      aiIss.suggestedFix.trim().length > 0 &&
      /[\u0980-\u09FF]/.test(aiIss.suggestedFix)
        ? aiIss.suggestedFix.trim()
        : undefined;

    const paragraphContentFingerprint =
      paraForIssue !== undefined
        ? computeParagraphContentFingerprint(
            paraForIssue.englishText,
            paraForIssue.banglaText
          )
        : undefined;

    const normalizedCandidateForSig = {
      ...aiIss,
      type: normalizedType,
      severity: normalizedSeverity,
    };
    const aiFindingSignature = computeStrictAiFindingSignature(normalizedCandidateForSig);

    // Conservative resolution preservation for AI issues in `stage5_full` mode:
    // Never match by `description` alone. Require:
    // 1. Unique unchanged target paragraph (`prev.paragraphIndex === validParagraphIndex` and matching `paragraphContentFingerprint`).
    // 2. Either identical explicit `findingSignature` OR identical `(type, severity, normalized englishExcerpt, normalized banglaExcerpt)`
    //    where both excerpts are non-empty.
    // 3. Strictly unambiguous match (`matchingPrev.length === 1`).
    let resolvedState = Boolean(aiIss.resolved);
    if (
      !resolvedState &&
      mode === 'stage5_full' &&
      validParagraphIndex !== undefined &&
      Boolean(paragraphContentFingerprint) &&
      Boolean(aiFindingSignature)
    ) {
      const matchingPrev = previousAiIssues.filter((prev) => {
        if (prev.source === 'deterministic_lint') return false;
        if (prev.paragraphIndex !== validParagraphIndex) return false;
        const prevFp =
          prev.paragraphContentFingerprint ||
          (paraForIssue
            ? computeParagraphContentFingerprint(
                paraForIssue.englishText,
                paraForIssue.banglaText
              )
            : '');
        if (!prevFp || prevFp !== paragraphContentFingerprint) {
          return false;
        }
        const prevSig = computeStrictAiFindingSignature({
          ...prev,
          type: normalizeStage5IssueType(prev.type),
          severity: normalizeStage5IssueSeverity(prev.severity),
        });
        return Boolean(prevSig) && prevSig === aiFindingSignature;
      });

      if (matchingPrev.length === 1 && matchingPrev[0].resolved === true) {
        resolvedState = true;
      }
    }

    const normalizedIssue: VerificationIssue = {
      ...aiIss,
      type: normalizedType,
      severity: normalizedSeverity,
      description: aiIss.description.trim(),
      paragraphIndex: validParagraphIndex,
      suggestedFix: sanitizedSuggestedFix,
      resolved: resolvedState,
      source: 'ai_stage5',
      ...(paragraphContentFingerprint ? { paragraphContentFingerprint } : {}),
      ...(aiFindingSignature ? { findingSignature: aiFindingSignature } : {}),
    };
    if (validParagraphIndex === undefined) {
      delete normalizedIssue.paragraphIndex;
      delete normalizedIssue.paragraphContentFingerprint;
    }

    survivingAiIssues.push(normalizedIssue);
  }

  const combinedIssues: VerificationIssue[] = [
    ...survivingAiIssues,
    ...reconciledDeterministicIssues,
  ];

  // Calculate fidelity score accounting for both unresolved deterministic findings and unresolved AI findings
  const hasMissingParagraphs = paragraphs.some(
    (p) => Boolean(p.missingTranslation) || (Boolean(p.englishText?.trim()) && !p.banglaText?.trim())
  );

  const unresolvedDet = reconciledDeterministicIssues.filter((i) => !i.resolved);
  const detPenalty = unresolvedDet.reduce(
    (acc, iss) => acc + getVerificationIssueScorePenalty(iss),
    0
  );

  const unresolvedAi = survivingAiIssues.filter((i) => !i.resolved);
  const aiPenalty = unresolvedAi.reduce(
    (acc, iss) => acc + getVerificationIssueScorePenalty(iss),
    0
  );

  const validRawAiScore =
    aiReport &&
    typeof aiReport.overallScore === 'number' &&
    Number.isFinite(aiReport.overallScore) &&
    aiReport.overallScore >= 0 &&
    aiReport.overallScore <= 100
      ? Math.round(aiReport.overallScore)
      : undefined;

  const baseScore =
    validRawAiScore ??
    (previousReport &&
    typeof previousReport.overallScore === 'number' &&
    Number.isFinite(previousReport.overallScore)
      ? Math.max(0, Math.min(100, Math.round(previousReport.overallScore)))
      : hasMissingParagraphs
        ? 70
        : 95);

  const adjustedScore =
    mode === 'stage5_full'
      ? (() => {
          // If an AI issue was resolved via `previousReport` reconciliation or deduplicated against a deterministic finding,
          // recover its penalty before applying the unresolved AI ceiling and deterministic penalty so the same fact is never penalized twice.
          const resolvedViaMergePenalty = survivingAiIssues
            .filter((i) => i.resolved)
            .reduce(
              (acc, iss) => acc + getVerificationIssueScorePenalty(iss),
              0
            );
          const restoredAiBase = Math.min(
            100,
            baseScore + resolvedViaMergePenalty + deduplicatedAiPenalty
          );
          const cappedAiBase = Math.min(
            restoredAiBase,
            Math.max(0, 100 - aiPenalty)
          );
          return Math.max(0, Math.min(100, cappedAiBase - detPenalty));
        })()
      : previousReport && aiReport === null
        ? (() => {
            const prevPenalty =
              typeof priorUnresolvedPenaltyOverride === 'number'
                ? priorUnresolvedPenaltyOverride
                : (previousReport.issues ?? [])
                    .filter((i) => i && !i.resolved)
                    .reduce(
                      (acc, iss) => acc + getVerificationIssueScorePenalty(iss),
                      0
                    );
            const recoveredBase = Math.min(
              100,
              previousReport.overallScore + prevPenalty
            );
            return Math.max(
              0,
              Math.min(100, recoveredBase - (detPenalty + aiPenalty))
            );
          })()
        : Math.max(
            0,
            Math.min(100, Math.min(baseScore, 100 - aiPenalty) - detPenalty)
          );

  const hasUnresolvedHigh = combinedIssues.some(
    (i) => !i.resolved && i.severity === 'high'
  );

  const hadPriorPartialPrefix = PARTIAL_VERIFICATION_PREFIX_REGEX.test(
    previousReport?.fidelitySummary ?? ''
  );
  const hadPriorDeterministicOnlyPrefix = /^Deterministic terminology check/i.test(
    previousReport?.fidelitySummary ?? ''
  );
  const aiSummaryHasPartialOrDetPrefix =
    PARTIAL_VERIFICATION_PREFIX_REGEX.test(aiReport?.fidelitySummary ?? '') ||
    /^Deterministic terminology check/i.test(aiReport?.fidelitySummary ?? '');

  // Preserve explicit incomplete states (`isComplete: false`):
  // A downstream merge must NEVER silently convert an explicit `false` into `true`.
  const baseIsComplete = aiReport
    ? typeof aiReport.isComplete === 'boolean'
      ? aiReport.isComplete && !aiSummaryHasPartialOrDetPrefix
      : !aiSummaryHasPartialOrDetPrefix &&
        !hasMissingParagraphs &&
        survivingAiIssues.every(
          (i) => i.resolved || (i.severity !== 'high' && i.severity !== 'medium')
        )
    : previousReport
      ? Boolean(previousReport.isComplete) &&
        !hadPriorPartialPrefix &&
        !hadPriorDeterministicOnlyPrefix
      : !hasMissingParagraphs;

  const isComplete =
    baseIsComplete && !hasMissingParagraphs && !hasUnresolvedHigh;

  const rawSummary =
    aiReport?.fidelitySummary?.trim() ||
    previousReport?.fidelitySummary?.trim() ||
    'Verification completed.';

  const unresolvedNumericalCount = reconciledNumericalIssues.filter(
    (i) => !i.resolved
  ).length;
  const baseSummary =
    unresolvedNumericalCount > 0 &&
    !rawSummary.toLowerCase().includes('numerical')
      ? `${rawSummary} Deterministic numerical verification flagged ${unresolvedNumericalCount} factual number mismatch(es).`
      : rawSummary;

  return {
    overallScore: adjustedScore,
    fidelitySummary: baseSummary,
    isComplete,
    issues: combinedIssues,
    checkedAt,
  };
}

/**
 * Returns true when a verification issue originated from deterministic numerical verification
 * (`source === 'deterministic_lint'` with a `numerical:` termId or `deterministic_lint::numerical::` signature),
 * distinguishing it from glossary terminology rule checks.
 */
export function isNumericalDeterministicIssue(
  issue:
    | Pick<VerificationIssue, 'source' | 'termId' | 'findingSignature'>
    | null
    | undefined
): boolean {
  if (!issue || issue.source !== 'deterministic_lint') return false;
  return Boolean(
    issue.termId?.startsWith('numerical:') ||
      issue.findingSignature?.startsWith('deterministic_lint::numerical::')
  );
}

// ============================================================================
// PHASE 2B.2.2a — STAGE 3 DISCOVERY VALIDATION & IN-FLIGHT RECONCILIATION
// ============================================================================

/**
 * Computes a canonical semantic deduplication key (`surfaceKey::category::senseKey`) for a glossary item,
 * honoring `caseSensitive` and explicit contextual sense qualification.
 */
export function getTerminologyDedupeKey(
  item: Pick<
    Partial<TerminologyMemoryItem>,
    'englishTerm' | 'category' | 'contextMeaning' | 'notes' | 'caseSensitive' | 'isContextSensitive'
  >
): string {
  const surface = getEnglishSurfaceTerm(item.englishTerm ?? '');
  const surfaceKey = item.caseSensitive ? surface : surface.toLowerCase();
  const category: TerminologyCategory = isValidTerminologyCategory(item.category)
    ? item.category
    : 'object';
  const senseKey = hasExplicitContextualSenseQualification(item)
    ? extractContextualSenseKey(item)
    : '';
  return `${surfaceKey}::${category}::${senseKey}`;
}

/**
 * Computes a category-agnostic surface + sense key (`surfaceKey::senseKey`) for a glossary item.
 */
export function getTerminologySurfaceSenseKey(
  item: Pick<
    Partial<TerminologyMemoryItem>,
    'englishTerm' | 'contextMeaning' | 'notes' | 'caseSensitive' | 'isContextSensitive'
  >
): string {
  const surface = getEnglishSurfaceTerm(item.englishTerm ?? '');
  const surfaceKey = item.caseSensitive ? surface : surface.toLowerCase();
  const senseKey = hasExplicitContextualSenseQualification(item)
    ? extractContextualSenseKey(item)
    : '';
  return `${surfaceKey}::${senseKey}`;
}

/**
 * Closed set of ultra-common English function words and stopwords that can never be valid standalone glossary terms.
 */
export const COMMON_ENGLISH_STOP_WORDS: ReadonlySet<string> = new Set<string>([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'from',
  'up',
  'down',
  'in',
  'out',
  'over',
  'under',
  'into',
  'onto',
  'upon',
  'about',
  'above',
  'below',
  'between',
  'among',
  'through',
  'during',
  'before',
  'after',
  'since',
  'until',
  'while',
  'where',
  'when',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'will',
  'just',
  'should',
  'now',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'it',
  'its',
  'they',
  'them',
  'their',
  'theirs',
  'we',
  'us',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'i',
  'me',
  'my',
  'mine',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
]);

/**
 * Closed set of strict prefix title markers (`Dr.`, `Captain`, `Inspector`, `Nawab`, etc.)
 * for Stage 3 single-occurrence named-entity validation (Pattern A1).
 * Polysemous English adjectives like `Major` and `General` are intentionally excluded.
 */
export const STAGE3_PREFIX_TITLE_MARKERS: ReadonlySet<string> = new Set<string>([
  'dr',
  'dr.',
  'mr',
  'mr.',
  'mrs',
  'mrs.',
  'ms',
  'ms.',
  'prof',
  'prof.',
  'captain',
  'capt',
  'capt.',
  'inspector',
  'colonel',
  'lieutenant',
  'sergeant',
  'lord',
  'lady',
  'sir',
  'saint',
  'st',
  'st.',
  'pandit',
  'maulvi',
  'mirza',
  'nawab',
  'raja',
  'rani',
  'begum',
]);

/**
 * Closed set of strict South Asian suffix honorifics/kinship titles (`Babu`, `Thakur`, `Didi`, `Sahib`, etc.)
 * for Stage 3 single-occurrence named-entity validation (Pattern A2).
 */
export const STAGE3_SUFFIX_HONORIFIC_MARKERS: ReadonlySet<string> = new Set<string>([
  'babu',
  'thakur',
  'didi',
  'dada',
  'mashi',
  'pishi',
  'kaka',
  'mama',
  'chacha',
  'sahib',
  'saheb',
  'mia',
  'devi',
  'begum',
]);

/**
 * Closed set of geographic prefix markers (`Mount`, `Fort`, `Port`, `Cape`)
 * for Stage 3 single-occurrence named-entity validation (Pattern A3 — strictly 2 tokens).
 */
export const STAGE3_GEO_PREFIX_MARKERS: ReadonlySet<string> = new Set<string>([
  'mount',
  'mt',
  'mt.',
  'fort',
  'port',
  'cape',
]);

/**
 * Deterministic reject list of common English determiners, prepositions, adjectives, and
 * generic architectural/household/landscape nouns that frequently appear capitalized in
 * headings, signage, or Title-Case phrases (`Old Fort Wall`, `Port Wooden Bridge`, `Captain Chair`,
 * `"the chair"`, `*wooden bridge*`, `*silence*`) and must not pass single-occurrence discovery.
 */
export const STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS: ReadonlySet<string> = new Set<string>([
  // Determiners, articles, conjunctions, prepositions
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'by',
  'to',
  'for',
  'from',
  'with',
  'and',
  'or',
  // Common descriptive adjectives
  'old',
  'new',
  'young',
  'broken',
  'forgotten',
  'wooden',
  'stone',
  'iron',
  'brass',
  'copper',
  'glass',
  'brick',
  'mud',
  'clay',
  'dark',
  'bright',
  'light',
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'golden',
  'silver',
  'grey',
  'gray',
  'great',
  'small',
  'little',
  'large',
  'high',
  'low',
  'long',
  'short',
  'wide',
  'narrow',
  'deep',
  'shallow',
  'ancient',
  'modern',
  'ruined',
  'hidden',
  'secret',
  'silent',
  'quiet',
  'empty',
  'abandoned',
  'distant',
  'upper',
  'lower',
  'inner',
  'outer',
  'north',
  'south',
  'east',
  'west',
  'northern',
  'southern',
  'eastern',
  'western',
  'main',
  'central',
  'royal',
  'imperial',
  'public',
  'private',
  'common',
  'general',
  'major',
  'minor',
  'heavy',
  'soft',
  'cold',
  'warm',
  'wet',
  'dry',
  'damp',
  // Common architectural, furniture, landscape, and everyday nouns
  'wall',
  'walls',
  'bridge',
  'bridges',
  'tower',
  'towers',
  'gate',
  'gates',
  'door',
  'doors',
  'window',
  'windows',
  'chair',
  'chairs',
  'table',
  'tables',
  'bed',
  'beds',
  'bench',
  'desk',
  'stool',
  'lamp',
  'lantern',
  'mirror',
  'clock',
  'watch',
  'room',
  'rooms',
  'chamber',
  'chambers',
  'hall',
  'halls',
  'house',
  'houses',
  'home',
  'building',
  'buildings',
  'palace',
  'castle',
  'fortress',
  'citadel',
  'temple',
  'church',
  'mosque',
  'shrine',
  'courtyard',
  'verandah',
  'veranda',
  'balcony',
  'corridor',
  'passage',
  'stairs',
  'staircase',
  'steps',
  'roof',
  'floor',
  'ceiling',
  'road',
  'roads',
  'street',
  'streets',
  'lane',
  'lanes',
  'alley',
  'path',
  'paths',
  'way',
  'square',
  'market',
  'bazaar',
  'shop',
  'store',
  'inn',
  'tavern',
  'hotel',
  'station',
  'office',
  'court',
  'prison',
  'hospital',
  'school',
  'college',
  'library',
  'river',
  'lake',
  'pond',
  'canal',
  'sea',
  'ocean',
  'bay',
  'gulf',
  'harbor',
  'harbour',
  'port',
  'dock',
  'pier',
  'wharf',
  'quay',
  'jetty',
  'island',
  'hill',
  'hills',
  'mountain',
  'mountains',
  'ridge',
  'valley',
  'forest',
  'woods',
  'tree',
  'trees',
  'garden',
  'park',
  'field',
  'meadow',
  'rock',
  'stone',
  'cliff',
  'shore',
  'bank',
  'beach',
  'sand',
  'water',
  'fire',
  'wind',
  'storm',
  'rain',
  'cloud',
  'clouds',
  'mist',
  'fog',
  'sky',
  'sun',
  'moon',
  'star',
  'stars',
  'night',
  'day',
  'morning',
  'evening',
  'dusk',
  'dawn',
  'silence',
  'shadow',
  'shadows',
  'whisper',
  'whispers',
  'sound',
  'voice',
  'voices',
  'man',
  'men',
  'woman',
  'women',
  'child',
  'children',
  'boy',
  'girl',
  'friend',
  'stranger',
  'master',
  'servant',
  'keeper',
  'guard',
  'soldier',
  'sailor',
  'merchant',
  'baker',
  'boat',
  'boats',
  'ship',
  'ships',
  'vessel',
  'time',
  'hand',
  'hands',
  'eye',
  'eyes',
  'face',
  'heart',
  'mind',
  'life',
  'death',
  'world',
  'place',
  'thing',
  'things',
  'word',
  'words',
  'book',
  'letter',
  'note',
  'paper',
  'page',
  'chapter',
  'story',
  'truth',
  'dream',
  'memory',
  'hope',
  'fear',
  'pain',
  'joy',
  'grief',
  'peace',
]);

/**
 * Pruned closed allowlist of genuinely specialized cultural, historical, horological, and nautical
 * single-occurrence loanwords/terms that warrant cross-chunk terminology consistency even on a
 * single occurrence in a Stage 3 chunk (Check C).
 * Generic everyday words (`monsoon`, `ghat`, `sari`, `kurta`, `dhoti`, `bazaar`, `verandah`, `courtyard`, `hookah`)
 * are intentionally excluded from single-occurrence auto-promotion.
 */
export const STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  'zamindar',
  'zamindari',
  'kachari',
  'zenana',
  'andarmahal',
  'baithakkhana',
  'palki',
  'anchal',
  'sindoor',
  'shankha',
  'prasad',
  'arati',
  'jharokha',
  'caravanserai',
  'kalbaisakhi',
  'lascar',
  'serang',
  'tindal',
  'chronometer',
  'escapement',
  'tourbillon',
  'fusee',
  'sextant',
  'octant',
  'astrolabe',
  'binnacle',
  'mizzenmast',
  'keelson',
  'taffrail',
  'gunwale',
]);

/**
 * Closed exclusion set of common English words containing `th`, `ph`, `gh`, `sh`, `ch`, `aa`, `ee`, or `oo`
 * so Check B2's heuristic loanword pattern never accepts ordinary quoted/italicized English vocabulary.
 */
const STAGE3_COMMON_ENGLISH_DIGRAPH_EXCLUSIONS: ReadonlySet<string> = new Set<string>([
  'that',
  'this',
  'these',
  'those',
  'there',
  'their',
  'theirs',
  'them',
  'then',
  'than',
  'thus',
  'though',
  'thought',
  'thoughts',
  'through',
  'throughout',
  'thing',
  'things',
  'think',
  'thin',
  'thick',
  'thief',
  'thirst',
  'third',
  'thirty',
  'thousand',
  'thread',
  'threat',
  'three',
  'threshold',
  'throat',
  'throne',
  'throw',
  'thumb',
  'thunder',
  'truth',
  'breath',
  'breathe',
  'death',
  'earth',
  'faith',
  'father',
  'mother',
  'brother',
  'weather',
  'feather',
  'leather',
  'gather',
  'rather',
  'other',
  'another',
  'nothing',
  'something',
  'everything',
  'anything',
  'both',
  'path',
  'bath',
  'wrath',
  'oath',
  'cloth',
  'clothes',
  'month',
  'mouth',
  'south',
  'north',
  'youth',
  'worth',
  'birth',
  'mirth',
  'hearth',
  'health',
  'wealth',
  'stealth',
  'strength',
  'length',
  'depth',
  'width',
  'warmth',
  'growth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'with',
  'within',
  'without',
  'ghost',
  'ghosts',
  'ghastly',
  'ghetto',
  'night',
  'light',
  'right',
  'sight',
  'might',
  'flight',
  'fright',
  'bright',
  'slight',
  'tight',
  'weight',
  'height',
  'eight',
  'neighbor',
  'neighbour',
  'daughter',
  'slaughter',
  'laughter',
  'laugh',
  'cough',
  'tough',
  'rough',
  'enough',
  'plough',
  'bough',
  'dough',
  'high',
  'sigh',
  'thigh',
  'nigh',
  'phone',
  'photo',
  'photograph',
  'phrase',
  'phase',
  'phantom',
  'philosophy',
  'physical',
  'physician',
  'sphere',
  'triumph',
  'orphan',
  'nephew',
  'cipher',
  'pamphlet',
  'prophet',
  'symphony',
  'telegraph',
  'epitaph',
  'paragraph',
  'graph',
  'book',
  'books',
  'look',
  'looks',
  'took',
  'shook',
  'brook',
  'crook',
  'hook',
  'cook',
  'nook',
  'wood',
  'woods',
  'good',
  'hood',
  'stood',
  'blood',
  'flood',
  'food',
  'mood',
  'rood',
  'roof',
  'hoof',
  'proof',
  'aloof',
  'room',
  'rooms',
  'broom',
  'groom',
  'bloom',
  'gloom',
  'loom',
  'doom',
  'zoom',
  'moon',
  'noon',
  'soon',
  'spoon',
  'swoon',
  'monsoon',
  'cool',
  'pool',
  'tool',
  'stool',
  'wool',
  'fool',
  'school',
  'loop',
  'troop',
  'stoop',
  'droop',
  'root',
  'boot',
  'foot',
  'shoot',
  'soot',
  'hoot',
  'loot',
  'tooth',
  'smooth',
  'booth',
  'soothe',
  'choose',
  'loose',
  'goose',
  'noose',
  'poor',
  'door',
  'floor',
  'moor',
  'boor',
  'tree',
  'trees',
  'free',
  'three',
  'knee',
  'flee',
  'glee',
  'see',
  'bee',
  'fee',
  'agree',
  'degree',
  'decree',
  'deep',
  'keep',
  'sleep',
  'weep',
  'sweep',
  'steep',
  'creep',
  'sheep',
  'peep',
  'seed',
  'need',
  'deed',
  'feed',
  'weed',
  'reed',
  'bleed',
  'breed',
  'speed',
  'greed',
  'steed',
  'creed',
  'heed',
  'feel',
  'heel',
  'wheel',
  'steel',
  'kneel',
  'peel',
  'reel',
  'keel',
  'seem',
  'deem',
  'teem',
  'seen',
  'keen',
  'green',
  'queen',
  'screen',
  'between',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'meet',
  'feet',
  'street',
  'sweet',
  'sheet',
  'fleet',
  'greet',
  'beet',
  'sleet',
  'week',
  'seek',
  'cheek',
  'meek',
  'creek',
  'sleek',
  'reek',
  'peek',
  'beef',
  'reef',
  'leaf',
  'grief',
  'brief',
  'chief',
  'belief',
  'relief',
  'beer',
  'deer',
  'peer',
  'cheer',
  'steer',
  'sheer',
  'sneer',
  'jeer',
  'queer',
  'career',
  'pioneer',
  'engineer',
  'volunteer',
  'bazaar',
  'sari',
  'ghat',
  'kurta',
  'dhoti',
  'hookah',
  'verandah',
  'veranda',
  'courtyard',
]);

/**
 * Checks whether a candidate glossary item has valid non-empty English and Bangla fields
 * (including at least one Bangla script character `/[\u0980-\u09FF]/`) and is not a bare stopword.
 */
export function isValidGlossaryCandidate(raw: Partial<TerminologyMemoryItem>): boolean {
  const englishTerm = normalizeEnglishTerm(raw?.englishTerm ?? '');
  const surface = getEnglishSurfaceTerm(englishTerm);
  const banglaTranslation = normalizeBanglaUnicode(raw?.banglaTranslation ?? '');

  if (!surface || surface.length < 2 || surface.length > 80) {
    return false;
  }
  if (!banglaTranslation || !/[\u0980-\u09FF]/.test(banglaTranslation)) {
    return false;
  }
  if (COMMON_ENGLISH_STOP_WORDS.has(surface.toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * Checks whether a character span `[start, end]` in `text` is immediately enclosed by matching
 * quotation marks (`"..."`, `'...'`, `“...”`, `‘...’`) or markdown italics (`*...*`, `_..._`).
 */
function isSpanEnclosedByTypographicalDelimiters(
  text: string,
  start: number,
  end: number
): boolean {
  if (start <= 0 || end >= text.length) {
    return false;
  }
  const before = text[start - 1];
  const after = text[end];

  if (
    (before === '"' && after === '"') ||
    (before === '“' && after === '”') ||
    (before === '‘' && after === '’') ||
    (before === '*' && after === '*') ||
    (before === '_' && after === '_')
  ) {
    return true;
  }

  // Straight single quotes count as delimiters only when not preceded by an alphanumeric char (avoiding possessives/contractions)
  if (before === "'" && after === "'") {
    const prevBefore = start >= 2 ? text[start - 2] : '';
    if (!/[A-Za-z0-9]/.test(prevBefore)) {
      return true;
    }
  }

  return false;
}

/**
 * Deterministic validation gate for Stage 3 chunk-discovered terminology (`newTerms`):
 * - Grounded against `chunkText` via word-boundary matching (`findEnglishTermOccurrences`).
 * - Terms already established in `existingGlossary` or appearing 2+ times in `chunkText` (and not pure common reject words) pass.
 * - Single-occurrence (`occurrences.length === 1`) terms never rely on AI-reported `category` or `notes` alone;
 *   they must pass at least one of:
 *   - Check A: Strict structural named-entity pattern (title prefix + proper name, proper name + South Asian honorific suffix,
 *     or 2-token geographic prefix + proper name, with all non-marker tokens absent from `STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS`).
 *   - Check B: Typographical delimiter (`"..."`, `'...'`, `“...”`, `‘...’`, `*...*`, `_..._`) combined with either:
 *     - Check B1: Capitalized proper-name token(s) absent from `STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS`, OR
 *     - Check B2 (Explicitly Heuristic): A conservative orthographic heuristic for single-word lowercase romanized
 *       South Asian loanwords (matching characteristic aspiration/digraph patterns such as `bh`, `dh`, `gh`, `jh`,
 *       `kh`, `ph`, `th`, `chh`, `shh`, `aa`, `ee`, `oo` while absent from `STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS`
 *       and `STAGE3_COMMON_ENGLISH_DIGRAPH_EXCLUSIONS`). Note: Check B2 is a conservative orthographic heuristic
 *       and does not claim linguistic certainty.
 *   - Check C: Closed specialized allowlist (`STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST`).
 */
export type Stage3DiscoveryRejectionReason =
  | 'invalid_candidate'
  | 'not_in_source_chunk'
  | 'not_in_bangla_chunk'
  | 'already_in_glossary'
  | 'duplicate_candidate'
  | 'common_single_word_noise'
  | 'single_occurrence_unverified';

export interface Stage3RejectedCandidateInfo {
  candidate: Partial<TerminologyMemoryItem>;
  reason: Stage3DiscoveryRejectionReason;
}

export interface Stage3DiscoveryValidationResult {
  acceptedTerms: TerminologyMemoryItem[];
  rejectedCandidates: Stage3RejectedCandidateInfo[];
}

export interface ValidateStage3DiscoveredTermsParams {
  candidates: ReadonlyArray<Partial<TerminologyMemoryItem>> | undefined | null;
  chunkSourceText: string;
  chunkBanglaText?: string;
  existingGlossary?: ReadonlyArray<TerminologyMemoryItem>;
}

/**
 * Checks whether a candidate Bangla translation (or any of its approved compound expansions / inflections)
 * is grounded in `chunkBanglaText`.
 */
function isCandidateGroundedInBanglaChunk(
  candidate: TerminologyMemoryItem,
  chunkBanglaText: string
): boolean {
  const normChunkBangla = normalizeBanglaUnicode(chunkBanglaText ?? '');
  if (!normChunkBangla) {
    return false;
  }

  const candidateForms = expandApprovedBanglaCompoundForms(candidate.banglaTranslation);
  for (const form of candidateForms) {
    const matches = findBanglaTermOccurrences(normChunkBangla, form, {
      banglaStem:
        form === normalizeBanglaUnicode(candidate.banglaTranslation)
          ? candidate.banglaStem
          : undefined,
      allowInflections: true,
    });
    if (matches.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a candidate glossary item is already covered by `normalizedExisting`
 * while strictly allowing genuinely distinct contextual homonyms (e.g., `bank (river)` vs `bank (finance)`).
 */
function isCandidateAlreadyCoveredByGlossary(
  candidate: TerminologyMemoryItem,
  normalizedExisting: ReadonlyArray<TerminologyMemoryItem>,
  existingDedupeKeys: ReadonlySet<string>,
  existingSurfaceSenseKeys: ReadonlySet<string>
): boolean {
  const dedupeKey = getTerminologyDedupeKey(candidate);
  const surfaceSenseKey = getTerminologySurfaceSenseKey(candidate);

  if (existingDedupeKeys.has(dedupeKey) || existingSurfaceSenseKeys.has(surfaceSenseKey)) {
    return true;
  }

  const candSurface = getEnglishSurfaceTerm(candidate.englishTerm);
  const candSurfaceLower = candSurface.toLowerCase();
  const candHasExplicitSense = hasExplicitContextualSenseQualification(candidate);
  const candSense = candHasExplicitSense ? extractContextualSenseKey(candidate) : '';
  const candBangla = normalizeBanglaUnicode(candidate.banglaTranslation);

  for (const existing of normalizedExisting) {
    const exSurface = getEnglishSurfaceTerm(existing.englishTerm);
    const sameSurface =
      existing.caseSensitive || candidate.caseSensitive
        ? exSurface === candSurface
        : exSurface.toLowerCase() === candSurfaceLower;
    if (!sameSurface) {
      continue;
    }

    const exHasExplicitSense = hasExplicitContextualSenseQualification(existing);
    const exSense = exHasExplicitSense ? extractContextualSenseKey(existing) : '';

    // Distinct contextual homonyms (both have explicit non-empty senses that differ) are NOT duplicates
    if (exHasExplicitSense && exSense && candHasExplicitSense && candSense && exSense !== candSense) {
      continue;
    }

    const exBangla = normalizeBanglaUnicode(existing.banglaTranslation);
    const exAccepted = (existing.acceptedAlternatives ?? []).map((a) => normalizeBanglaUnicode(a));

    // If the candidate has an explicit contextual sense and existing is unqualified,
    // allow the candidate as a distinct contextual homonym ONLY if its Bangla translation is distinct.
    if (!exHasExplicitSense && candHasExplicitSense && candSense) {
      if (candBangla === exBangla || exAccepted.includes(candBangla)) {
        return true;
      }
      continue;
    }

    // If existing has an explicit contextual sense and the candidate is unqualified:
    // treat as already in glossary if the candidate proposes the exact same Bangla translation (or accepted alternative).
    if (exHasExplicitSense && exSense && !candHasExplicitSense) {
      if (candBangla === exBangla || exAccepted.includes(candBangla)) {
        return true;
      }
      continue;
    }

    // Unqualified match on the same surface term
    return true;
  }

  return false;
}

export function validateStage3DiscoveredTerms(
  params: ValidateStage3DiscoveredTermsParams
): Stage3DiscoveryValidationResult;
export function validateStage3DiscoveredTerms(
  rawTerms: ReadonlyArray<Partial<TerminologyMemoryItem>> | undefined | null,
  chunkText: string,
  existingGlossary?: ReadonlyArray<TerminologyMemoryItem>,
  options?: { chunkBanglaText?: string }
): TerminologyMemoryItem[];
export function validateStage3DiscoveredTerms(
  rawTermsOrParams:
    | ReadonlyArray<Partial<TerminologyMemoryItem>>
    | ValidateStage3DiscoveredTermsParams
    | undefined
    | null,
  chunkTextArg?: string,
  existingGlossaryArg: ReadonlyArray<TerminologyMemoryItem> = [],
  optionsArg?: { chunkBanglaText?: string }
): TerminologyMemoryItem[] | Stage3DiscoveryValidationResult {
  const isObjectCall =
    rawTermsOrParams !== null &&
    rawTermsOrParams !== undefined &&
    typeof rawTermsOrParams === 'object' &&
    !Array.isArray(rawTermsOrParams) &&
    ('candidates' in rawTermsOrParams || 'chunkSourceText' in rawTermsOrParams);

  const rawTerms = isObjectCall
    ? (rawTermsOrParams as ValidateStage3DiscoveredTermsParams).candidates
    : (rawTermsOrParams as ReadonlyArray<Partial<TerminologyMemoryItem>> | undefined | null);
  const chunkText = isObjectCall
    ? (rawTermsOrParams as ValidateStage3DiscoveredTermsParams).chunkSourceText
    : (chunkTextArg ?? '');
  const chunkBanglaText = isObjectCall
    ? (rawTermsOrParams as ValidateStage3DiscoveredTermsParams).chunkBanglaText
    : optionsArg?.chunkBanglaText;
  const existingGlossary = isObjectCall
    ? ((rawTermsOrParams as ValidateStage3DiscoveredTermsParams).existingGlossary ?? [])
    : existingGlossaryArg;

  const rejectedCandidates: Stage3RejectedCandidateInfo[] = [];

  if (!Array.isArray(rawTerms) || rawTerms.length === 0 || !chunkText?.trim()) {
    if (Array.isArray(rawTerms) && !chunkText?.trim()) {
      for (const cand of rawTerms) {
        if (cand && typeof cand === 'object') {
          rejectedCandidates.push({ candidate: cand, reason: 'not_in_source_chunk' });
        }
      }
    }
    return isObjectCall ? { acceptedTerms: [], rejectedCandidates } : [];
  }

  const normalizedExisting = normalizeGlossaryList(existingGlossary);
  const existingDedupeKeys = new Set<string>(
    normalizedExisting.map((item) => getTerminologyDedupeKey(item))
  );
  const existingSurfaceSenseKeys = new Set<string>(
    normalizedExisting.map((item) => getTerminologySurfaceSenseKey(item))
  );

  const accepted: TerminologyMemoryItem[] = [];
  const acceptedDedupeKeys = new Set<string>();
  const acceptedSurfaceSenseKeys = new Set<string>();

  for (let i = 0; i < rawTerms.length; i++) {
    const raw = rawTerms[i];
    if (!raw || typeof raw !== 'object' || !isValidGlossaryCandidate(raw)) {
      if (raw && typeof raw === 'object') {
        rejectedCandidates.push({ candidate: raw, reason: 'invalid_candidate' });
      }
      continue;
    }

    const candidate = normalizeTerminologyItem(
      {
        ...raw,
        source: 'chunk_ai',
        lockedByUser: false,
      },
      i
    );

    const surfaceTerm = getEnglishSurfaceTerm(candidate.englishTerm);
    const surfaceLower = surfaceTerm.toLowerCase();
    const tokens = surfaceTerm.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) {
      rejectedCandidates.push({ candidate: raw, reason: 'invalid_candidate' });
      continue;
    }

    // Must occur in the actual English chunk text at word boundaries
    const occurrences = findEnglishTermOccurrences(chunkText, {
      ...candidate,
      caseSensitive: false,
    });
    if (occurrences.length === 0) {
      rejectedCandidates.push({ candidate: raw, reason: 'not_in_source_chunk' });
      continue;
    }

    // When `chunkBanglaText` is supplied, the candidate's Bangla translation must be grounded in the chunk's Bangla translation
    if (chunkBanglaText !== undefined) {
      if (!isCandidateGroundedInBanglaChunk(candidate, chunkBanglaText)) {
        rejectedCandidates.push({ candidate: raw, reason: 'not_in_bangla_chunk' });
        continue;
      }
    }

    // Check C (Duplicate Detection against `existingGlossary`):
    // Rejects candidates already in `existingGlossary` while preserving distinct contextual homonyms.
    const isAlreadyInGlossary = isCandidateAlreadyCoveredByGlossary(
      candidate,
      normalizedExisting,
      existingDedupeKeys,
      existingSurfaceSenseKeys
    );

    if (isAlreadyInGlossary) {
      rejectedCandidates.push({ candidate: raw, reason: 'already_in_glossary' });
      continue;
    }

    const dedupeKey = getTerminologyDedupeKey(candidate);
    const surfaceSenseKey = getTerminologySurfaceSenseKey(candidate);
    if (acceptedDedupeKeys.has(dedupeKey) || acceptedSurfaceSenseKeys.has(surfaceSenseKey)) {
      rejectedCandidates.push({ candidate: raw, reason: 'duplicate_candidate' });
      continue;
    }

    const hasExplicitSense =
      hasExplicitContextualSenseQualification(candidate) &&
      extractContextualSenseKey(candidate) !== '';
    const hasSiblingHomonymInGlossary = normalizedExisting.some(
      (ex) => getEnglishSurfaceTerm(ex.englishTerm).toLowerCase() === surfaceLower
    );

    // Multi-occurrence terms in the chunk (2+ occurrences) pass if they contain at least one
    // substantive token outside common stopwords, title/geo markers, and ordinary reject words,
    // OR if they are explicitly sense-qualified contextual homonyms (e.g. `bank (river)` vs `bank (finance)`).
    if (occurrences.length >= 2) {
      const allGenericOrStopWords = tokens.every((t) => {
        const w = t.toLowerCase().replace(/^['"“‘]+|['"”’.,!?;:]+$/g, '');
        return (
          COMMON_ENGLISH_STOP_WORDS.has(w) ||
          STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has(w) ||
          STAGE3_PREFIX_TITLE_MARKERS.has(w) ||
          STAGE3_SUFFIX_HONORIFIC_MARKERS.has(w) ||
          STAGE3_GEO_PREFIX_MARKERS.has(w)
        );
      });
      if (!allGenericOrStopWords || hasExplicitSense) {
        accepted.push(candidate);
        acceptedDedupeKeys.add(dedupeKey);
        acceptedSurfaceSenseKeys.add(surfaceSenseKey);
      } else {
        rejectedCandidates.push({ candidate: raw, reason: 'common_single_word_noise' });
      }
      continue;
    }

    // If a sibling contextual homonym already exists in `existingGlossary` and this candidate carries
    // an explicit distinct contextual sense (`hasExplicitSense`), accept the disambiguated homonym.
    if (hasExplicitSense && hasSiblingHomonymInGlossary) {
      accepted.push(candidate);
      acceptedDedupeKeys.add(dedupeKey);
      acceptedSurfaceSenseKeys.add(surfaceSenseKey);
      continue;
    }

    // Single-occurrence validation gate (`occurrences.length === 1`)
    const occ = occurrences[0];
    const matchedSlice = chunkText.slice(occ.start, occ.end).trim();
    const matchedTokens = matchedSlice.split(/\s+/).filter(Boolean);
    const lowerTokens = matchedTokens.map((t) =>
      t.toLowerCase().replace(/^['"“‘]+|['"”’.,!?;:]+$/g, '')
    );

    // Closed specialized allowlist (`STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST`)
    const passesAllowlist = STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST.has(surfaceLower);
    if (passesAllowlist) {
      accepted.push(candidate);
      acceptedDedupeKeys.add(dedupeKey);
      acceptedSurfaceSenseKeys.add(surfaceSenseKey);
      continue;
    }

    // Check A: Strict structural named-entity pattern (2 or 3 capitalized tokens in chunkText)
    let passesCheckA = false;
    if (matchedTokens.length >= 2 && matchedTokens.length <= 3) {
      const allCapitalized = matchedTokens.every((tok) =>
        /^[A-Z][a-z]{1,24}(?:['\u2019-][A-Za-z]{1,16})?\.?$/.test(tok)
      );

      if (allCapitalized) {
        const firstLower = matchedTokens[0].toLowerCase();
        const firstLowerNoDot = firstLower.replace(/\.$/, '');
        const lastLower = lowerTokens[lowerTokens.length - 1];

        const isAnyMarker = (w: string): boolean =>
          STAGE3_PREFIX_TITLE_MARKERS.has(w) ||
          STAGE3_PREFIX_TITLE_MARKERS.has(w.replace(/\.$/, '')) ||
          STAGE3_SUFFIX_HONORIFIC_MARKERS.has(w) ||
          STAGE3_GEO_PREFIX_MARKERS.has(w) ||
          STAGE3_GEO_PREFIX_MARKERS.has(w.replace(/\.$/, ''));

        const isValidProperToken = (w: string): boolean =>
          Boolean(w) &&
          !isAnyMarker(w) &&
          !STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has(w) &&
          !COMMON_ENGLISH_STOP_WORDS.has(w);

        // Pattern A1: Title prefix marker (`Dr.`, `Captain`, `Inspector`, `Nawab`, etc.) + 1-2 proper-name tokens
        if (
          STAGE3_PREFIX_TITLE_MARKERS.has(firstLower) ||
          STAGE3_PREFIX_TITLE_MARKERS.has(firstLowerNoDot)
        ) {
          const restTokens = lowerTokens.slice(1);
          if (restTokens.length >= 1 && restTokens.every(isValidProperToken)) {
            passesCheckA = true;
          }
        }

        // Pattern A2: 1-2 proper-name tokens + South Asian suffix honorific (`Babu`, `Thakur`, `Didi`, `Sahib`, etc.)
        if (!passesCheckA && STAGE3_SUFFIX_HONORIFIC_MARKERS.has(lastLower)) {
          const leadingTokens = lowerTokens.slice(0, -1);
          if (leadingTokens.length >= 1 && leadingTokens.every(isValidProperToken)) {
            passesCheckA = true;
          }
        }

        // Pattern A3: Strictly 2-token geographic prefix (`Mount`, `Fort`, `Port`, `Cape`) + 1 proper-name token
        if (
          !passesCheckA &&
          matchedTokens.length === 2 &&
          (STAGE3_GEO_PREFIX_MARKERS.has(firstLower) ||
            STAGE3_GEO_PREFIX_MARKERS.has(firstLowerNoDot))
        ) {
          if (isValidProperToken(lowerTokens[1])) {
            passesCheckA = true;
          }
        }
      }
    }

    if (passesCheckA) {
      accepted.push(candidate);
      acceptedDedupeKeys.add(dedupeKey);
      acceptedSurfaceSenseKeys.add(surfaceSenseKey);
      continue;
    }

    // Check B: Typographical delimiter (`"..."`, `'...'`, `“...”`, `‘...’`, `*...*`, `_..._`)
    // combined with proper-name capitalization (Check B1) or heuristic romanized loanword pattern (Check B2).
    let passesCheckB = false;
    if (
      matchedTokens.length >= 1 &&
      matchedTokens.length <= 2 &&
      isSpanEnclosedByTypographicalDelimiters(chunkText, occ.start, occ.end)
    ) {
      const hasAnyRejectedOrStopWord = lowerTokens.some(
        (w) =>
          STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has(w) ||
          COMMON_ENGLISH_STOP_WORDS.has(w) ||
          STAGE3_COMMON_ENGLISH_DIGRAPH_EXCLUSIONS.has(w)
      );

      if (!hasAnyRejectedOrStopWord) {
        // Check B1: Capitalized proper name(s) not in the common English reject set
        const allProperCapitalized = matchedTokens.every((tok) =>
          /^[A-Z][a-z]{2,24}$/.test(tok)
        );

        // Check B2 (Heuristic only): Single lowercase romanized loanword token (length >= 4)
        // exhibiting characteristic South Asian aspiration/gemination/vowel-digraph orthography.
        // Explicitly heuristic — does not claim linguistic certainty.
        const isHeuristicRomanizedLoanword =
          matchedTokens.length === 1 &&
          /^[a-z]{4,24}$/.test(matchedTokens[0]) &&
          (STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST.has(lowerTokens[0]) ||
            /(?:bh|dh|gh|jh|kh|ph|th|chh|shh|aa|ee|oo)/.test(lowerTokens[0]));

        if (allProperCapitalized || isHeuristicRomanizedLoanword) {
          passesCheckB = true;
        }
      }
    }

    if (passesCheckB) {
      accepted.push(candidate);
      acceptedDedupeKeys.add(dedupeKey);
      acceptedSurfaceSenseKeys.add(surfaceSenseKey);
      continue;
    }

    const isPureCommonNoise = lowerTokens.every(
      (w) =>
        COMMON_ENGLISH_STOP_WORDS.has(w) ||
        STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has(w) ||
        STAGE3_COMMON_ENGLISH_DIGRAPH_EXCLUSIONS.has(w)
    );
    rejectedCandidates.push({
      candidate: raw,
      reason: isPureCommonNoise ? 'common_single_word_noise' : 'single_occurrence_unverified',
    });
  }

  const normalizedAccepted = normalizeGlossaryList(accepted);
  return isObjectCall
    ? { acceptedTerms: normalizedAccepted, rejectedCandidates }
    : normalizedAccepted;
}

/**
 * Snapshot suppression descriptor generated when a glossary entry is deleted, modified in place,
 * or newly created by the user while an AI request is in flight.
 */
export interface SnapshotSuppressionDescriptor {
  id: string;
  dedupeKey: string;
  surfaceSenseKey: string;
  surfaceKey: string;
  category: TerminologyCategory;
  senseKey: string;
  hasExplicitSense: boolean;
  banglaTranslation: string;
  reason: 'deleted' | 'modified_in_place' | 'created_in_flight';
}

function buildSuppressionDescriptor(
  item: TerminologyMemoryItem,
  reason: SnapshotSuppressionDescriptor['reason']
): SnapshotSuppressionDescriptor {
  const surface = getEnglishSurfaceTerm(item.englishTerm);
  const surfaceKey = item.caseSensitive ? surface : surface.toLowerCase();
  const hasExplicitSense = hasExplicitContextualSenseQualification(item);
  const senseKey = hasExplicitSense ? extractContextualSenseKey(item) : '';

  return {
    id: item.id,
    dedupeKey: getTerminologyDedupeKey(item),
    surfaceSenseKey: getTerminologySurfaceSenseKey(item),
    surfaceKey,
    category: item.category,
    senseKey,
    hasExplicitSense,
    banglaTranslation: normalizeBanglaUnicode(item.banglaTranslation),
    reason,
  };
}

function stringArraysEqualNormalized(
  a: ReadonlyArray<string> | undefined,
  b: ReadonlyArray<string> | undefined
): boolean {
  const normA = deduplicateBanglaList(a ?? []);
  const normB = deduplicateBanglaList(b ?? []);
  if (normA.length !== normB.length) return false;
  return normA.every((val, idx) => val === normB[idx]);
}

/**
 * Returns true if any user-editable field of a glossary entry (`englishTerm`, `banglaTranslation`,
 * `category`, `contextMeaning`, `notes`, `caseSensitive`, `isContextSensitive`, `lockedByUser`,
 * `source`, `acceptedAlternatives`, `avoidTranslations`) changed between `snapItem` and `latestItem`.
 */
export function hasGlossaryEntryChangedInFlight(
  snapItem: TerminologyMemoryItem,
  latestItem: TerminologyMemoryItem
): boolean {
  const s = normalizeTerminologyItem(snapItem);
  const l = normalizeTerminologyItem(latestItem);

  return (
    s.englishTerm !== l.englishTerm ||
    s.banglaTranslation !== l.banglaTranslation ||
    s.category !== l.category ||
    (s.contextMeaning ?? '') !== (l.contextMeaning ?? '') ||
    (s.notes ?? '') !== (l.notes ?? '') ||
    Boolean(s.caseSensitive) !== Boolean(l.caseSensitive) ||
    Boolean(s.isContextSensitive) !== Boolean(l.isContextSensitive) ||
    Boolean(s.lockedByUser) !== Boolean(l.lockedByUser) ||
    s.source !== l.source ||
    !stringArraysEqualNormalized(s.acceptedAlternatives, l.acceptedAlternatives) ||
    !stringArraysEqualNormalized(s.avoidTranslations, l.avoidTranslations)
  );
}

/**
 * Evaluates whether an incoming AI glossary candidate matches a `SnapshotSuppressionDescriptor`
 * using the 4-level precedence rules while strictly protecting distinct contextual homonyms:
 * 1. Exact Stable ID Match (`cand.id === descriptor.id`)
 * 2. Exact Semantic Dedupe Key Match (`getTerminologyDedupeKey(cand) === descriptor.dedupeKey`)
 * 3. Contextual Surface-Sense Key Match (`getTerminologySurfaceSenseKey(cand) === descriptor.surfaceSenseKey`
 *    when both carry matching explicit sense or neither has a conflicting explicit sense)
 * 4. Unqualified Surface-Only Fallback (only when the candidate lacks an explicit contextual sense that
 *    belongs to a distinct homonym, and when `latestGlossary` does not have a surviving distinct homonym
 *    whose sense/translation matches the candidate).
 */
export function doesCandidateMatchSuppressionDescriptor(
  candidate: TerminologyMemoryItem,
  descriptor: SnapshotSuppressionDescriptor,
  survivingLatestHomonymsForSurface: ReadonlyArray<TerminologyMemoryItem> = []
): boolean {
  // 1. Exact Stable ID Match
  if (candidate.id && descriptor.id && candidate.id === descriptor.id) {
    return true;
  }

  const candSurface = getEnglishSurfaceTerm(candidate.englishTerm);
  const candSurfaceKey = candidate.caseSensitive ? candSurface : candSurface.toLowerCase();
  const sameSurface =
    candSurfaceKey.toLowerCase() === descriptor.surfaceKey.toLowerCase() &&
    (candidate.caseSensitive ||
    descriptor.surfaceKey !== descriptor.surfaceKey.toLowerCase()
      ? candSurface ===
        (descriptor.surfaceKey !== descriptor.surfaceKey.toLowerCase()
          ? descriptor.surfaceKey
          : candSurface)
      : true);

  if (!sameSurface) {
    return false;
  }

  const candHasExplicitSense = hasExplicitContextualSenseQualification(candidate);
  const candSense = candHasExplicitSense ? extractContextualSenseKey(candidate) : '';

  // Contextual Homonym Isolation Guard:
  // - If BOTH the descriptor and the candidate have explicit contextual senses and those senses differ,
  //   they are distinct contextual homonyms (e.g. `bank (river)` vs `bank (finance)`) -> NEVER match!
  if (
    descriptor.hasExplicitSense &&
    descriptor.senseKey &&
    candHasExplicitSense &&
    candSense &&
    candSense !== descriptor.senseKey
  ) {
    return false;
  }

  // - If the descriptor is unqualified (`!descriptor.hasExplicitSense`) and the candidate has an explicit
  //   contextual sense (`candHasExplicitSense && candSense !== ''`), do not let an unqualified deletion/edit
  //   suppress a genuinely qualified contextual homonym unless they share the exact same primary Bangla translation.
  if (
    !descriptor.hasExplicitSense &&
    candHasExplicitSense &&
    candSense &&
    normalizeBanglaUnicode(candidate.banglaTranslation) !== descriptor.banglaTranslation
  ) {
    return false;
  }

  // 2. Exact Semantic Dedupe Key Match (`surface::category::sense`)
  if (getTerminologyDedupeKey(candidate) === descriptor.dedupeKey) {
    return true;
  }

  // 3. Contextual Surface-Sense Key Match (`surface::sense`) across category changes
  if (getTerminologySurfaceSenseKey(candidate) === descriptor.surfaceSenseKey) {
    return true;
  }

  // 4. Unqualified Surface-Only Fallback:
  //    When the AI returns an unqualified candidate (`!candHasExplicitSense`) for the same surface term
  //    (e.g., AI returns bare `bank` -> `তীর` after the user deleted or edited `bank (river)` -> `তীর`):
  //    - If `survivingLatestHomonymsForSurface` is empty (no other homonym for this surface exists in `latestGlossary`),
  //      suppress the stale unqualified AI candidate.
  //    - If `survivingLatestHomonymsForSurface` is non-empty (e.g. `bank (finance)` -> `ব্যাংক` still exists in `latestGlossary`),
  //      suppress the unqualified AI candidate ONLY if its primary Bangla translation matches `descriptor.banglaTranslation`
  //      (and does not match a surviving distinct homonym's primary Bangla translation).
  if (!candHasExplicitSense) {
    if (survivingLatestHomonymsForSurface.length === 0) {
      return true;
    }
    const candBangla = normalizeBanglaUnicode(candidate.banglaTranslation);
    const matchesSurvivingSibling = survivingLatestHomonymsForSurface.some(
      (sibling) =>
        sibling.id !== descriptor.id &&
        normalizeBanglaUnicode(sibling.banglaTranslation) === candBangla
    );
    if (!matchesSurvivingSibling && candBangla === descriptor.banglaTranslation) {
      return true;
    }
  }

  return false;
}

/**
 * Reconciles an in-flight AI glossary payload (`aiReturnedGlossary`) against the pre-request
 * `snapshotGlossary` and the post-request `latestGlossary` (`projectRef.current.terminologyMemory`):
 * 1. Protects all deletions made while the request was in flight (regardless of original `source` or `lockedByUser`).
 * 2. Protects all in-place user edits made while the request was in flight (including translation-only edits,
 *    category/sense edits, note edits, and renames) by suppressing stale AI echoes and restoring the
 *    user-modified `latestGlossary` entries verbatim.
 * 3. Protects all newly created or recreated entries in `latestGlossary` verbatim.
 * 4. Preserves distinct contextual homonyms without false-positive suppression.
 */
export function reconcileInFlightGlossaryWithLatestState(
  snapshotGlossary: ReadonlyArray<TerminologyMemoryItem> | undefined | null,
  latestGlossary: ReadonlyArray<TerminologyMemoryItem> | undefined | null,
  aiReturnedGlossary: ReadonlyArray<Partial<TerminologyMemoryItem>> | undefined | null,
  options: MergeGlossaryOptions = {}
): TerminologyMemoryItem[] {
  const defaultSource: TerminologySource = options.defaultSource ?? 'stage1_ai';
  const normalizedSnapshot = (snapshotGlossary ?? []).map((item, idx) =>
    normalizeTerminologyItem(item, idx)
  );
  const normalizedLatest = (latestGlossary ?? []).map((item, idx) =>
    normalizeTerminologyItem(item, idx)
  );

  const snapshotById = new Map<string, TerminologyMemoryItem>();
  for (const item of normalizedSnapshot) {
    snapshotById.set(item.id, item);
  }

  const latestById = new Map<string, TerminologyMemoryItem>();
  for (const item of normalizedLatest) {
    latestById.set(item.id, item);
  }

  // Track IDs in `latestGlossary` that were modified in flight or newly created in flight
  // so they can be restored verbatim after merging remaining AI candidates.
  const userModifiedInFlightIds = new Set<string>();
  const suppressionDescriptors: SnapshotSuppressionDescriptor[] = [];

  for (const snapItem of normalizedSnapshot) {
    const latestItem = latestById.get(snapItem.id);
    if (!latestItem) {
      // Deleted in flight (unless recreated under a new ID with identical semantic identity in `latestGlossary` —
      // note that even if recreated, suppressing the stale AI candidate keeps the recreated `latestGlossary` entry authoritative!)
      suppressionDescriptors.push(buildSuppressionDescriptor(snapItem, 'deleted'));
      continue;
    }

    if (hasGlossaryEntryChangedInFlight(snapItem, latestItem)) {
      userModifiedInFlightIds.add(latestItem.id);
      suppressionDescriptors.push(
        buildSuppressionDescriptor(snapItem, 'modified_in_place')
      );
      suppressionDescriptors.push(
        buildSuppressionDescriptor(latestItem, 'modified_in_place')
      );
    }
  }

  for (const latestItem of normalizedLatest) {
    if (!snapshotById.has(latestItem.id)) {
      userModifiedInFlightIds.add(latestItem.id);
      suppressionDescriptors.push(
        buildSuppressionDescriptor(latestItem, 'created_in_flight')
      );
    }
  }

  // Filter `aiReturnedGlossary` against `suppressionDescriptors` (NEVER filtering `latestGlossary`)
  const rawAiList = Array.isArray(aiReturnedGlossary) ? aiReturnedGlossary : [];
  const filteredAiCandidates: Array<Partial<TerminologyMemoryItem>> = [];

  for (let i = 0; i < rawAiList.length; i++) {
    const rawCand = rawAiList[i];
    if (!rawCand || typeof rawCand !== 'object') continue;
    const normCand = normalizeTerminologyItem(
      {
        ...rawCand,
        source: isValidTerminologySource(rawCand.source) ? rawCand.source : defaultSource,
        lockedByUser:
          typeof rawCand.lockedByUser === 'boolean'
            ? rawCand.lockedByUser
            : rawCand.source === 'user',
      },
      normalizedLatest.length + i
    );
    if (!normCand.englishTerm || !normCand.banglaTranslation) continue;

    const candSurfaceLower = getEnglishSurfaceTerm(normCand.englishTerm).toLowerCase();
    const survivingLatestHomonymsForSurface = normalizedLatest.filter(
      (item) => getEnglishSurfaceTerm(item.englishTerm).toLowerCase() === candSurfaceLower
    );

    const isSuppressed = suppressionDescriptors.some((desc) =>
      doesCandidateMatchSuppressionDescriptor(
        normCand,
        desc,
        survivingLatestHomonymsForSurface
      )
    );

    if (!isSuppressed) {
      filteredAiCandidates.push(rawCand);
    }
  }

  const merged = mergeGlossaryItems(normalizedLatest, filteredAiCandidates, {
    defaultSource,
  });

  // Safeguard 1: Restore every user-modified or newly created in-flight entry in `latestGlossary` verbatim
  const restored = merged.map((item) => {
    if (userModifiedInFlightIds.has(item.id) && latestById.has(item.id)) {
      return { ...latestById.get(item.id)! };
    }
    return item;
  });

  for (const protectedId of userModifiedInFlightIds) {
    const protectedItem = latestById.get(protectedId);
    if (protectedItem && !restored.some((r) => r.id === protectedId)) {
      restored.push({ ...protectedItem });
    }
  }

  return restored;
}

/**
 * Reconciles `StoryContextProfile` across `snapshotContext`, `latestContext` (`projectRef.current.storyContext`),
 * and `aiContext` (returned by Stage 1):
 * - Preserves in-flight user edits (including intentional clears `''`) on scalar fields (`summary`,
 *   `narrativeTimeline`, `emotionalContext`, `literaryTone`).
 * - Protects in-flight location deletions and in-flight location edits (`banglaName`, `description`)
 *   while appending genuinely new AI locations.
 * - Protects in-flight `importantEvents` deletions and edits while appending genuinely new AI events.
 *   Note: `locations` and `importantEvents` do not carry stable per-item UUIDs; matching uses normalized
 *   English location name and normalized lowercase event text respectively.
 */
export function reconcileInFlightStoryContext(
  snapshotContext: StoryContextProfile | null | undefined,
  latestContext: StoryContextProfile | null | undefined,
  aiContext: Partial<StoryContextProfile> | null | undefined
): StoryContextProfile {
  const reconcileScalar = (
    snapVal: string | undefined,
    latestVal: string | undefined,
    aiVal: string | undefined
  ): string => {
    const s = (snapVal ?? '').trim();
    const l = (latestVal ?? '').trim();
    const a = (aiVal ?? '').trim();

    // If user modified or intentionally cleared this field in flight (`latestContext` exists and `l !== s`), preserve `l` verbatim
    if (latestContext !== null && latestContext !== undefined && l !== s) {
      return l;
    }
    // Otherwise allow AI Stage 1 primary analysis to populate or update, falling back to `l`
    return a || l;
  };

  // Reconcile `importantEvents`
  const normalizeEventKey = (ev: string): string =>
    ev.trim().replace(/\s+/g, ' ').toLowerCase();

  const snapEvents = (snapshotContext?.importantEvents ?? [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim());
  const latestEvents = (latestContext?.importantEvents ?? [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim());
  const aiEvents = (aiContext?.importantEvents ?? [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim());

  const latestEventKeys = new Set<string>(latestEvents.map(normalizeEventKey));
  const deletedEventKeys = new Set<string>();
  for (const snapEv of snapEvents) {
    const key = normalizeEventKey(snapEv);
    if (!latestEventKeys.has(key)) {
      deletedEventKeys.add(key);
    }
  }

  const reconciledEvents: string[] = [...latestEvents];
  const seenEventKeys = new Set<string>(latestEventKeys);

  for (const aiEv of aiEvents) {
    const key = normalizeEventKey(aiEv);
    if (!key || deletedEventKeys.has(key) || seenEventKeys.has(key)) {
      continue;
    }
    seenEventKeys.add(key);
    reconciledEvents.push(aiEv);
  }

  // Reconcile `locations`
  const normalizeLocKey = (name: string): string =>
    normalizeEnglishTerm(name ?? '').toLowerCase();

  const snapLocByKey = new Map<
    string,
    { name: string; banglaName: string; description: string }
  >();
  for (const loc of snapshotContext?.locations ?? []) {
    const name = normalizeEnglishTerm(loc?.name ?? '');
    const banglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!name || !banglaName) continue;
    snapLocByKey.set(normalizeLocKey(name), {
      name,
      banglaName,
      description: (loc?.description ?? '').trim(),
    });
  }

  const latestLocByKey = new Map<
    string,
    { name: string; banglaName: string; description: string }
  >();
  const reconciledLocations: Array<{
    name: string;
    banglaName: string;
    description: string;
  }> = [];

  for (const loc of latestContext?.locations ?? []) {
    const name = normalizeEnglishTerm(loc?.name ?? '');
    const banglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!name || !banglaName) continue;
    const key = normalizeLocKey(name);
    const entry = {
      name,
      banglaName,
      description: (loc?.description ?? '').trim(),
    };
    latestLocByKey.set(key, entry);
    reconciledLocations.push(entry);
  }

  const deletedLocKeys = new Set<string>();
  for (const snapKey of snapLocByKey.keys()) {
    if (!latestLocByKey.has(snapKey)) {
      deletedLocKeys.add(snapKey);
    }
  }

  for (const aiLoc of aiContext?.locations ?? []) {
    const name = normalizeEnglishTerm(aiLoc?.name ?? '');
    const banglaName = normalizeBanglaUnicode(aiLoc?.banglaName ?? '');
    if (!name || !banglaName) continue;
    const key = normalizeLocKey(name);

    // Never resurrect a location deleted or renamed by the user in flight
    if (deletedLocKeys.has(key)) {
      continue;
    }

    const existingLatest = latestLocByKey.get(key);
    if (!existingLatest) {
      const newLoc = {
        name,
        banglaName,
        description: (aiLoc?.description ?? '').trim(),
      };
      latestLocByKey.set(key, newLoc);
      reconciledLocations.push(newLoc);
    } else {
      // Backfill description only if it was empty in both snapshot and latest (not intentionally cleared by user)
      const snapLoc = snapLocByKey.get(key);
      const userClearedDescription =
        snapLoc !== undefined &&
        snapLoc.description.length > 0 &&
        existingLatest.description.length === 0;
      if (
        !existingLatest.description &&
        !userClearedDescription &&
        aiLoc?.description?.trim()
      ) {
        existingLatest.description = aiLoc.description.trim();
      }
    }
  }

  return {
    summary: reconcileScalar(
      snapshotContext?.summary,
      latestContext?.summary,
      aiContext?.summary
    ),
    narrativeTimeline: reconcileScalar(
      snapshotContext?.narrativeTimeline,
      latestContext?.narrativeTimeline,
      aiContext?.narrativeTimeline
    ),
    importantEvents: reconciledEvents,
    emotionalContext: reconcileScalar(
      snapshotContext?.emotionalContext,
      latestContext?.emotionalContext,
      aiContext?.emotionalContext
    ),
    literaryTone: reconcileScalar(
      snapshotContext?.literaryTone,
      latestContext?.literaryTone,
      aiContext?.literaryTone
    ),
    locations: reconciledLocations,
  };
}

/**
 * Extended character shape supporting both canonical `CharacterMemoryItem` properties
 * (`pronouns`, `personality`, `speakingStyle`) and optional alias fields (`roleAndTone`, `pronounStrategy`)
 * if supplied by callers or tests.
 */
export type ExtendedCharacterMemoryItem = CharacterMemoryItem & {
  roleAndTone?: string;
  pronounStrategy?: string;
};

/**
 * Reconciles `CharacterMemoryItem[]` across `snapshotCharacters`, `latestCharacters`
 * (`projectRef.current.characterMemory`), and `aiCharacters` (returned by Stage 1):
 * - Protects characters deleted or renamed while the request was in flight from resurrection.
 * - Preserves characters newly created or recreated by the user in flight (`!snapshotById.has(latestChar.id)`) verbatim.
 * - For retained characters (`snapshotById.has(latestChar.id)`), reconciles every field independently
 *   (`englishName`, `banglaName`, `relationships`, `pronouns`, `personality`, `speakingStyle`, `notes`,
 *   plus optional `roleAndTone` and `pronounStrategy`):
 *   - If `latestField !== snapField` (including when the user intentionally cleared a field to `''`),
 *     `latestField` wins verbatim.
 *   - If `latestField === snapField` and `latestField` is non-empty, `latestField` wins.
 *   - If `latestField === snapField` and both are empty (`''`), non-empty `aiField` backfills.
 * - Note: Character matching across AI results without stable IDs uses case-insensitive normalized `englishName`
 *   (orthographic aliases or honorific variations such as `"Debu"` vs `"Debendranath"` are treated as distinct names
 *   unless unified in the glossary).
 */
export function reconcileInFlightCharacterMemory<
  T extends ExtendedCharacterMemoryItem = CharacterMemoryItem,
>(
  snapshotCharacters: ReadonlyArray<T> | undefined | null,
  latestCharacters: ReadonlyArray<T> | undefined | null,
  aiCharacters: ReadonlyArray<Partial<T>> | undefined | null
): T[] {
  const snapList = Array.isArray(snapshotCharacters) ? snapshotCharacters : [];
  const latestList = Array.isArray(latestCharacters) ? latestCharacters : [];
  const aiList = Array.isArray(aiCharacters) ? aiCharacters : [];

  const normalizeNameKey = (name: string | undefined): string =>
    normalizeEnglishTerm(name ?? '').toLowerCase();

  const snapshotById = new Map<string, T>();
  for (const c of snapList) {
    if (c && c.id) {
      snapshotById.set(c.id, c);
    }
  }

  const latestById = new Map<string, T>();
  const latestByNameKey = new Map<string, T>();
  for (const c of latestList) {
    if (!c) continue;
    if (c.id) {
      latestById.set(c.id, c);
    }
    const nameKey = normalizeNameKey(c.englishName);
    if (nameKey) {
      latestByNameKey.set(nameKey, c);
    }
  }

  const deletedCharIds = new Set<string>();
  const deletedOrSupersededCharNames = new Set<string>();

  for (const snapChar of snapList) {
    if (!snapChar) continue;
    const snapNameKey = normalizeNameKey(snapChar.englishName);
    const latestChar = snapChar.id ? latestById.get(snapChar.id) : undefined;

    if (!latestChar) {
      if (snapChar.id) deletedCharIds.add(snapChar.id);
      if (snapNameKey && !latestByNameKey.has(snapNameKey)) {
        deletedOrSupersededCharNames.add(snapNameKey);
      }
    } else {
      const latestNameKey = normalizeNameKey(latestChar.englishName);
      if (snapNameKey && snapNameKey !== latestNameKey && !latestByNameKey.has(snapNameKey)) {
        deletedOrSupersededCharNames.add(snapNameKey);
      }
    }
  }

  // Index eligible AI character candidates by ID and by normalized `englishName`
  const aiById = new Map<string, Partial<T>>();
  const aiByNameKey = new Map<string, Partial<T>>();
  const unmatchedAiCandidates: Array<Partial<T>> = [];

  for (const rawAi of aiList) {
    if (!rawAi || typeof rawAi !== 'object') continue;
    const aiId = typeof rawAi.id === 'string' ? rawAi.id.trim() : '';
    const aiName = normalizeEnglishTerm(rawAi.englishName ?? '');
    const aiBangla = normalizeBanglaUnicode(rawAi.banglaName ?? '');
    const aiNameKey = aiName.toLowerCase();

    if (!aiName || !aiBangla) continue;
    if (aiId && deletedCharIds.has(aiId)) continue;
    if (deletedOrSupersededCharNames.has(aiNameKey)) continue;

    if (aiId && latestById.has(aiId)) {
      if (!aiById.has(aiId)) aiById.set(aiId, rawAi);
      continue;
    }

    if (latestByNameKey.has(aiNameKey)) {
      if (!aiByNameKey.has(aiNameKey)) aiByNameKey.set(aiNameKey, rawAi);
      continue;
    }

    unmatchedAiCandidates.push(rawAi);
  }

  const reconcileCharacterField = (
    snapVal: string | undefined,
    latestVal: string | undefined,
    aiVal: string | undefined,
    normalizer: (v: string) => string = (v) => v.trim()
  ): string => {
    const s = normalizer(snapVal ?? '');
    const l = normalizer(latestVal ?? '');
    const a = normalizer(aiVal ?? '');

    // Safeguard 2: If the user modified this field in flight (including intentionally clearing it to `''`),
    // preserve `l` verbatim and never overwrite with stale AI output.
    if (l !== s) {
      return l;
    }
    // If untouched in flight and already populated, keep `l`
    if (l.length > 0) {
      return l;
    }
    // If untouched in flight and empty in both snapshot and latest, allow non-empty `a` to backfill
    return a;
  };

  const reconciled: T[] = [];

  for (const latestChar of latestList) {
    if (!latestChar) continue;
    const snapChar = latestChar.id ? snapshotById.get(latestChar.id) : undefined;

    // Newly created or recreated character in flight (`!snapChar`) -> preserve 100% verbatim
    if (!snapChar) {
      reconciled.push({ ...latestChar });
      continue;
    }

    const latestNameKey = normalizeNameKey(latestChar.englishName);
    const matchingAi =
      (latestChar.id ? aiById.get(latestChar.id) : undefined) ??
      aiByNameKey.get(latestNameKey);

    if (!matchingAi) {
      reconciled.push({ ...latestChar });
      continue;
    }

    const mergedChar: ExtendedCharacterMemoryItem = {
      ...latestChar,
      id: latestChar.id,
      englishName: reconcileCharacterField(
        snapChar.englishName,
        latestChar.englishName,
        matchingAi.englishName,
        normalizeEnglishTerm
      ),
      banglaName: reconcileCharacterField(
        snapChar.banglaName,
        latestChar.banglaName,
        matchingAi.banglaName,
        normalizeBanglaUnicode
      ),
      relationships: reconcileCharacterField(
        snapChar.relationships,
        latestChar.relationships,
        matchingAi.relationships
      ),
      pronouns: reconcileCharacterField(
        snapChar.pronouns,
        latestChar.pronouns,
        matchingAi.pronouns
      ),
      personality: reconcileCharacterField(
        snapChar.personality,
        latestChar.personality,
        matchingAi.personality
      ),
      speakingStyle: reconcileCharacterField(
        snapChar.speakingStyle,
        latestChar.speakingStyle,
        matchingAi.speakingStyle
      ),
      notes: reconcileCharacterField(
        snapChar.notes,
        latestChar.notes,
        matchingAi.notes
      ),
    };

    if (
      'roleAndTone' in snapChar ||
      'roleAndTone' in latestChar ||
      'roleAndTone' in matchingAi
    ) {
      mergedChar.roleAndTone = reconcileCharacterField(
        snapChar.roleAndTone,
        latestChar.roleAndTone,
        matchingAi.roleAndTone
      );
    }

    if (
      'pronounStrategy' in snapChar ||
      'pronounStrategy' in latestChar ||
      'pronounStrategy' in matchingAi
    ) {
      mergedChar.pronounStrategy = reconcileCharacterField(
        snapChar.pronounStrategy,
        latestChar.pronounStrategy,
        matchingAi.pronounStrategy
      );
    }

    reconciled.push(mergedChar as T);
  }

  // Append genuinely new AI characters that were neither deleted nor already present in `latestCharacters`
  const seenNames = new Set<string>(
    reconciled.map((c) => normalizeNameKey(c.englishName)).filter(Boolean)
  );
  const usedIds = new Set<string>(reconciled.map((c) => c.id).filter(Boolean));

  for (const rawAi of unmatchedAiCandidates) {
    const englishName = normalizeEnglishTerm(rawAi.englishName ?? '');
    const banglaName = normalizeBanglaUnicode(rawAi.banglaName ?? '');
    const nameKey = englishName.toLowerCase();
    if (!englishName || !banglaName || seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);

    let id =
      typeof rawAi.id === 'string' && rawAi.id.trim().length > 0
        ? rawAi.id.trim()
        : `char-${reconciled.length + 1}-${nameKey.replace(/[^a-z0-9]+/g, '-')}`;
    while (usedIds.has(id)) {
      id = `${id}-2`;
    }
    usedIds.add(id);

    const newChar: ExtendedCharacterMemoryItem = {
      id,
      englishName,
      banglaName,
      relationships: (rawAi.relationships ?? '').trim(),
      pronouns: (rawAi.pronouns ?? '').trim(),
      personality: (rawAi.personality ?? '').trim(),
      speakingStyle: (rawAi.speakingStyle ?? '').trim(),
      notes: (rawAi.notes ?? '').trim(),
      ...(rawAi.roleAndTone !== undefined
        ? { roleAndTone: (rawAi.roleAndTone ?? '').trim() }
        : {}),
      ...(rawAi.pronounStrategy !== undefined
        ? { pronounStrategy: (rawAi.pronounStrategy ?? '').trim() }
        : {}),
    };
    reconciled.push(newChar as T);
  }

  return reconciled;
}

// ============================================================================
// PHASE 2B.2.2b — PURE STAGE 1 & STAGE 3 RECONCILIATION ORCHESTRATORS
// ============================================================================

export interface ReconcileStage1ResultParams<
  TChar extends ExtendedCharacterMemoryItem = CharacterMemoryItem,
> {
  snapshotStoryContext?: StoryContextProfile | null;
  snapshotContext?: StoryContextProfile | null;
  latestStoryContext?: StoryContextProfile | null;
  latestContext?: StoryContextProfile | null;
  candidateStoryContext?: Partial<StoryContextProfile> | null;
  aiStoryContext?: Partial<StoryContextProfile> | null;
  aiContext?: Partial<StoryContextProfile> | null;

  snapshotCharacters?: ReadonlyArray<TChar> | null;
  latestCharacters?: ReadonlyArray<TChar> | null;
  candidateCharacters?: ReadonlyArray<Partial<TChar>> | null;
  aiCharacters?: ReadonlyArray<Partial<TChar>> | null;
  extractedCharacters?: ReadonlyArray<Partial<TChar>> | null;

  snapshotGlossary?: ReadonlyArray<TerminologyMemoryItem> | null;
  snapshotTerminology?: ReadonlyArray<TerminologyMemoryItem> | null;
  latestGlossary?: ReadonlyArray<TerminologyMemoryItem> | null;
  latestTerminology?: ReadonlyArray<TerminologyMemoryItem> | null;
  candidateGlossary?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
  aiGlossary?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
  extractedTerminology?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
  aiTerminology?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
}

export interface ReconciledStage1Result<
  TChar extends ExtendedCharacterMemoryItem = CharacterMemoryItem,
> {
  storyContext: StoryContextProfile;
  characterMemory: TChar[];
  extractedCharacters: TChar[];
  terminologyMemory: TerminologyMemoryItem[];
  glossary: TerminologyMemoryItem[];
  extractedTerminology: TerminologyMemoryItem[];
}

/**
 * Pure Stage 1 reconciliation orchestrator that coordinates in-flight reconciliation
 * across StoryContext, CharacterMemory, location-to-glossary synchronization, and TerminologyMemory
 * in the mandatory 4-step order:
 * 1. Reconcile story context using `reconcileInFlightStoryContext`.
 * 2. Reconcile character memory using `reconcileInFlightCharacterMemory`.
 * 3. Synchronize locations from the reconciled story context into the Stage 1 candidate glossary
 *    (ensuring locations deleted in flight are stripped and never reintroduced).
 * 4. Reconcile the candidate glossary against the snapshot and latest glossary using
 *    `reconcileInFlightGlossaryWithLatestState`.
 */
export function reconcileStage1ResultWithLatestState<
  TChar extends ExtendedCharacterMemoryItem = CharacterMemoryItem,
>(params: ReconcileStage1ResultParams<TChar>): ReconciledStage1Result<TChar> {
  const snapshotContext = params.snapshotStoryContext ?? params.snapshotContext ?? null;
  const latestContext = params.latestStoryContext ?? params.latestContext ?? null;
  const candidateContext =
    params.candidateStoryContext ??
    params.aiStoryContext ??
    params.aiContext ??
    null;

  const snapshotCharacters = params.snapshotCharacters ?? [];
  const latestCharacters = params.latestCharacters ?? [];
  const candidateCharacters =
    params.candidateCharacters ??
    params.aiCharacters ??
    params.extractedCharacters ??
    [];

  const rawSnapshotGlossary =
    params.snapshotGlossary ?? params.snapshotTerminology ?? [];
  const rawLatestGlossary =
    params.latestGlossary ?? params.latestTerminology ?? [];
  const rawCandidateGlossary =
    params.candidateGlossary ??
    params.aiGlossary ??
    params.extractedTerminology ??
    params.aiTerminology ??
    [];

  const normalizedSnapshotGlossary = (rawSnapshotGlossary ?? []).map((item, idx) =>
    normalizeTerminologyItem(item, idx)
  );
  const normalizedLatestGlossary = (rawLatestGlossary ?? []).map((item, idx) =>
    normalizeTerminologyItem(item, idx)
  );

  // 1. Reconcile StoryContext
  const storyContext = reconcileInFlightStoryContext(
    snapshotContext,
    latestContext,
    candidateContext
  );

  // 2. Reconcile CharacterMemory
  const characterMemory = reconcileInFlightCharacterMemory(
    snapshotCharacters,
    latestCharacters,
    candidateCharacters
  );

  // Identify locations that were deleted or modified in flight in StoryContext.locations
  const normalizeLocKey = (name: string | undefined): string =>
    getEnglishSurfaceTerm(name ?? '').toLowerCase();

  const snapLocByKey = new Map<
    string,
    { name: string; banglaName: string; description: string }
  >();
  for (const loc of snapshotContext?.locations ?? []) {
    const key = normalizeLocKey(loc?.name);
    const banglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!key || !banglaName) continue;
    snapLocByKey.set(key, {
      name: normalizeEnglishTerm(loc.name),
      banglaName,
      description: (loc?.description ?? '').trim(),
    });
  }

  const reconciledLocByKey = new Map<
    string,
    { name: string; banglaName: string; description: string }
  >();
  for (const loc of storyContext.locations ?? []) {
    const key = normalizeLocKey(loc?.name);
    const banglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!key || !banglaName) continue;
    reconciledLocByKey.set(key, {
      name: normalizeEnglishTerm(loc.name),
      banglaName,
      description: (loc?.description ?? '').trim(),
    });
  }

  const deletedInFlightLocationKeys = new Set<string>();
  const modifiedInFlightLocationKeys = new Set<string>();

  for (const [snapKey, snapLoc] of snapLocByKey.entries()) {
    const recLoc = reconciledLocByKey.get(snapKey);
    if (!recLoc) {
      deletedInFlightLocationKeys.add(snapKey);
    } else if (
      recLoc.banglaName !== snapLoc.banglaName ||
      recLoc.description !== snapLoc.description
    ) {
      modifiedInFlightLocationKeys.add(snapKey);
    }
  }

  for (const latestLoc of latestContext?.locations ?? []) {
    const key = normalizeLocKey(latestLoc?.name);
    if (key && !snapLocByKey.has(key) && reconciledLocByKey.has(key)) {
      modifiedInFlightLocationKeys.add(key);
    }
  }

  // Strip any candidate glossary entries corresponding to locations deleted in flight,
  // and strip stale candidate entries for locations modified in flight so Step 3's
  // location sync uses the reconciled StoryContext locations as authoritative.
  const sanitizedCandidateItems: TerminologyMemoryItem[] = [];
  for (let i = 0; i < rawCandidateGlossary.length; i++) {
    const rawCand = rawCandidateGlossary[i];
    if (!rawCand || typeof rawCand !== 'object') continue;
    const candKey = normalizeLocKey(rawCand.englishTerm);
    if (!candKey) continue;

    // Never allow a location deleted in flight from StoryContext.locations to survive in the candidate glossary
    if (deletedInFlightLocationKeys.has(candKey)) {
      continue;
    }

    // If the candidate was a pre-synced `location_sync` item (or a `place` item for a location modified in flight
    // by the user in StoryContext.locations), defer to Step 3's sync from `storyContext.locations`
    if (
      rawCand.source === 'location_sync' ||
      (modifiedInFlightLocationKeys.has(candKey) &&
        (rawCand.category === 'place' || !rawCand.category))
    ) {
      continue;
    }

    sanitizedCandidateItems.push(
      normalizeTerminologyItem(
        {
          ...rawCand,
          source: isValidTerminologySource(rawCand.source)
            ? rawCand.source
            : 'stage1_ai',
          lockedByUser:
            typeof rawCand.lockedByUser === 'boolean'
              ? rawCand.lockedByUser
              : rawCand.source === 'user',
        },
        i
      )
    );
  }

  // 3. Synchronize locations from the reconciled story context into the Stage 1 candidate glossary
  const candidateGlossaryWithLocations = syncLocationsToGlossary(
    sanitizedCandidateItems,
    storyContext.locations
  );

  // If a location was deleted from StoryContext.locations in flight AND `latestGlossary` still holds
  // an untouched `source === 'location_sync'` entry from the snapshot for that deleted location,
  // remove that stale `location_sync` entry from `effectiveLatestGlossary` (and if a location's
  // `banglaName`/`description` was edited in StoryContext.locations in flight while its `location_sync`
  // glossary entry was untouched in `latestGlossary`, update that `location_sync` entry).
  const snapGlossaryById = new Map<string, TerminologyMemoryItem>();
  for (const sItem of normalizedSnapshotGlossary) {
    snapGlossaryById.set(sItem.id, sItem);
  }

  const effectiveLatestGlossary: TerminologyMemoryItem[] = [];
  for (const lItem of normalizedLatestGlossary) {
    const surfaceKey = normalizeLocKey(lItem.englishTerm);
    const snapItem = snapGlossaryById.get(lItem.id);
    const wasUntouchedInGlossary =
      snapItem !== undefined && !hasGlossaryEntryChangedInFlight(snapItem, lItem);

    if (
      deletedInFlightLocationKeys.has(surfaceKey) &&
      wasUntouchedInGlossary &&
      !lItem.lockedByUser &&
      (lItem.source === 'location_sync' || lItem.category === 'place')
    ) {
      continue;
    }

    if (
      modifiedInFlightLocationKeys.has(surfaceKey) &&
      wasUntouchedInGlossary &&
      !lItem.lockedByUser &&
      lItem.source === 'location_sync'
    ) {
      const updatedLoc = reconciledLocByKey.get(surfaceKey);
      if (updatedLoc) {
        effectiveLatestGlossary.push(
          normalizeTerminologyItem({
            ...lItem,
            banglaTranslation: updatedLoc.banglaName,
            notes: updatedLoc.description || 'Synced from Story Context locations',
          })
        );
        continue;
      }
    }

    effectiveLatestGlossary.push(lItem);
  }

  // 4. Reconcile the candidate glossary against the snapshot and latest glossary
  const terminologyMemory = reconcileInFlightGlossaryWithLatestState(
    normalizedSnapshotGlossary,
    effectiveLatestGlossary,
    candidateGlossaryWithLocations,
    { defaultSource: 'stage1_ai' }
  );

  return {
    storyContext,
    characterMemory,
    extractedCharacters: characterMemory,
    terminologyMemory,
    glossary: terminologyMemory,
    extractedTerminology: terminologyMemory,
  };
}

export interface ReconcileStage3ChunkGlossaryParams {
  snapshotGlossary?: ReadonlyArray<TerminologyMemoryItem> | null;
  discoveredCandidates?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
  candidateGlossary?: ReadonlyArray<Partial<TerminologyMemoryItem>> | null;
  latestGlossary?: ReadonlyArray<TerminologyMemoryItem> | null;
  chunkSourceText: string;
  chunkText?: string;
  chunkBanglaText: string;
}

export interface ReconciledStage3ChunkGlossaryResult {
  glossary: TerminologyMemoryItem[];
  terminologyMemory: TerminologyMemoryItem[];
  validation: Stage3DiscoveryValidationResult;
  acceptedTerms: TerminologyMemoryItem[];
  rejectedCandidates: Stage3RejectedCandidateInfo[];
}

/**
 * Pure Stage 3 chunk glossary reconciliation orchestrator:
 * 1. Accepts the pre-request `snapshotGlossary`, server-accepted `discoveredCandidates`,
 *    post-request `latestGlossary`, English `chunkSourceText`, and Bangla `chunkBanglaText`.
 * 2. Revalidates candidates using `validateStage3DiscoveredTerms` against English source text,
 *    Bangla chunk translation, and `latestGlossary` (running Check C `already_in_glossary`
 *    against the latest glossary, including entries added by the user while the request was in flight).
 * 3. Reconciles accepted candidates using `reconcileInFlightGlossaryWithLatestState` with
 *    `defaultSource: 'chunk_ai'`, preserving in-flight user edits, deletions, and distinct contextual homonyms.
 * 4. Returns both the resulting glossary and detailed validation information.
 */
export function reconcileStage3ChunkGlossaryWithLatestState(
  params: ReconcileStage3ChunkGlossaryParams
): ReconciledStage3ChunkGlossaryResult {
  const normalizedSnapshot = hydrateProjectGlossary(params.snapshotGlossary ?? []);
  const normalizedLatest = hydrateProjectGlossary(params.latestGlossary ?? []);
  const rawCandidates =
    params.discoveredCandidates ?? params.candidateGlossary ?? [];
  const chunkSourceText = params.chunkSourceText ?? params.chunkText ?? '';
  const chunkBanglaText = params.chunkBanglaText ?? '';

  const validation = validateStage3DiscoveredTerms({
    candidates: rawCandidates,
    chunkSourceText,
    chunkBanglaText,
    existingGlossary: normalizedLatest,
  });

  const glossary = reconcileInFlightGlossaryWithLatestState(
    normalizedSnapshot,
    normalizedLatest,
    validation.acceptedTerms,
    { defaultSource: 'chunk_ai' }
  );

  return {
    glossary,
    terminologyMemory: glossary,
    validation,
    acceptedTerms: validation.acceptedTerms,
    rejectedCandidates: validation.rejectedCandidates,
  };
}

// ============================================================================
// SUBSTEP 2B.3a — PARAGRAPH IDENTITY MAPPING & STAGE 4 / STAGE 5 RECONCILIATION
// ============================================================================

export interface ParagraphIdentityMapping {
  /** Maps `snapshotParagraphs` index (`snapIdx`) to `latestParagraphs` index (`latestIdx`). */
  snapToLatestIndex: Map<number, number>;
  /** Maps `latestParagraphs` index (`latestIdx`) to `snapshotParagraphs` index (`snapIdx`). */
  latestToSnapIndex: Map<number, number>;
  /** Set of `latestIdx` values that mapped unambiguously to a `snapIdx` AND have identical English/Bangla fingerprints and `missingTranslation` state. */
  unchangedLatestIndices: Set<number>;
  /** Set of `snapIdx` values that mapped unambiguously to a `latestIdx` AND have identical English/Bangla fingerprints and `missingTranslation` state. */
  unchangedSnapIndices: Set<number>;
  /** Sorted `latestIdx` list for paragraphs that were newly inserted, replaced, ambiguously shifted, modified in flight, or remain untranslated/missing. */
  unverifiedLatestIndices: number[];
  /** Sorted `snapIdx` list for snapshot paragraphs that were deleted, replaced, or ambiguously shifted. */
  deletedSnapIndices: number[];
  /** Sorted `latestIdx` list for uniquely matched paragraphs whose array index shifted (`snapIdx !== latestIdx`). */
  reorderedLatestIndices: number[];
  /** Sorted `latestIdx` list for duplicate English paragraphs whose positions changed and were rejected as ambiguous. */
  ambiguousDuplicateLatestIndices: number[];
  /** True if paragraph count changed, any paragraph was deleted/inserted/replaced/unmapped, or any paragraph shifted index. */
  hasStructuralChange: boolean;
  /** True only when every paragraph in `snapshotParagraphs` maps 1-to-1 at the same index in `latestParagraphs` with identical content and non-empty translation. */
  allParagraphsUnchanged: boolean;
}

/**
 * Conservative 2-pass content-based paragraph identity mapper between `snapshotParagraphs` and `latestParagraphs`.
 *
 * Strict Safety Guarantees:
 * 1. NEVER uses equal array lengths (`snapshotParagraphs.length === latestParagraphs.length`) as proof that
 *    no insertion, deletion, or replacement occurred.
 * 2. NEVER uses positional fallback matching when normalized English paragraph text differs.
 * 3. Pass 1 (Exact-Index Content Match — `snapIdx === latestIdx`):
 *    Matches `idx -> idx` only when normalized English text matches AND either:
 *    - the English text is unique in both `snapshotParagraphs` and `latestParagraphs` (`sPos.length === 1 && lPos.length === 1`), OR
 *    - all occurrences of that duplicate English text sit at the exact same indices in both arrays (`samePositions`).
 * 4. Pass 2 (Unique Cross-Index Match — `snapIdx !== latestIdx`):
 *    Matches remaining paragraphs across different indices ONLY when the normalized English text appears
 *    strictly once in `snapshotParagraphs` and strictly once in `latestParagraphs`.
 * 5. Ambiguous duplicate paragraphs whose positions shifted are never guessed and remain unmapped.
 */
export function mapSnapshotParagraphsToLatest(
  snapshotParagraphs: ReadonlyArray<ParagraphPair> | undefined | null,
  latestParagraphs: ReadonlyArray<ParagraphPair> | undefined | null
): ParagraphIdentityMapping {
  const snapList = Array.isArray(snapshotParagraphs) ? snapshotParagraphs : [];
  const latestList = Array.isArray(latestParagraphs) ? latestParagraphs : [];

  const normEn = (text: string | undefined): string =>
    normalizeEnglishTerm(text ?? '');

  const snapIndicesByEn = new Map<string, number[]>();
  for (let i = 0; i < snapList.length; i++) {
    const key = normEn(snapList[i]?.englishText);
    if (!key) continue;
    const list = snapIndicesByEn.get(key) ?? [];
    list.push(i);
    snapIndicesByEn.set(key, list);
  }

  const latestIndicesByEn = new Map<string, number[]>();
  for (let i = 0; i < latestList.length; i++) {
    const key = normEn(latestList[i]?.englishText);
    if (!key) continue;
    const list = latestIndicesByEn.get(key) ?? [];
    list.push(i);
    latestIndicesByEn.set(key, list);
  }

  const snapToLatestIndex = new Map<number, number>();
  const latestToSnapIndex = new Map<number, number>();

  // Pass 1: Exact-Index Content Match (`snapIdx === latestIdx`)
  // Strictly requires unique English text in both OR identical duplicate index positions in both
  // (never relying on `snapList.length === latestList.length`).
  const minLen = Math.min(snapList.length, latestList.length);
  for (let idx = 0; idx < minLen; idx++) {
    const snapEn = normEn(snapList[idx]?.englishText);
    const latestEn = normEn(latestList[idx]?.englishText);
    if (!snapEn || snapEn !== latestEn) {
      continue;
    }

    const sPositions = snapIndicesByEn.get(snapEn) ?? [];
    const lPositions = latestIndicesByEn.get(latestEn) ?? [];

    const isUniqueInBoth = sPositions.length === 1 && lPositions.length === 1;
    const hasIdenticalDuplicatePositions =
      sPositions.length === lPositions.length &&
      sPositions.every((val, k) => val === lPositions[k]);

    if (isUniqueInBoth || hasIdenticalDuplicatePositions) {
      snapToLatestIndex.set(idx, idx);
      latestToSnapIndex.set(idx, idx);
    }
  }

  // Pass 2: Unique Cross-Index Match (`snapIdx !== latestIdx`)
  for (let snapIdx = 0; snapIdx < snapList.length; snapIdx++) {
    if (snapToLatestIndex.has(snapIdx)) {
      continue;
    }

    const snapEn = normEn(snapList[snapIdx]?.englishText);
    if (!snapEn) {
      continue;
    }

    const sPositions = snapIndicesByEn.get(snapEn) ?? [];
    const lPositions = latestIndicesByEn.get(snapEn) ?? [];

    if (sPositions.length === 1 && lPositions.length === 1) {
      const targetLatestIdx = lPositions[0];
      if (!latestToSnapIndex.has(targetLatestIdx)) {
        snapToLatestIndex.set(snapIdx, targetLatestIdx);
        latestToSnapIndex.set(targetLatestIdx, snapIdx);
      }
    }
  }

  const unchangedLatestIndices = new Set<number>();
  const unchangedSnapIndices = new Set<number>();
  const reorderedLatestIndices: number[] = [];

  for (const [snapIdx, latestIdx] of snapToLatestIndex.entries()) {
    const snapPair = snapList[snapIdx];
    const latestPair = latestList[latestIdx];
    if (!snapPair || !latestPair) continue;

    if (snapIdx !== latestIdx) {
      reorderedLatestIndices.push(latestIdx);
    }

    const snapFp = computeParagraphContentFingerprint(
      snapPair.englishText,
      snapPair.banglaText
    );
    const latestFp = computeParagraphContentFingerprint(
      latestPair.englishText,
      latestPair.banglaText
    );
    const sameMissingFlag =
      Boolean(snapPair.missingTranslation) ===
      Boolean(latestPair.missingTranslation);

    if (snapFp === latestFp && sameMissingFlag) {
      unchangedLatestIndices.add(latestIdx);
      unchangedSnapIndices.add(snapIdx);
    }
  }

  reorderedLatestIndices.sort((a, b) => a - b);

  const deletedSnapIndices: number[] = [];
  for (let snapIdx = 0; snapIdx < snapList.length; snapIdx++) {
    if (!snapToLatestIndex.has(snapIdx)) {
      deletedSnapIndices.push(snapIdx);
    }
  }

  const unverifiedLatestIndices: number[] = [];
  const ambiguousDuplicateLatestIndices: number[] = [];

  for (let latestIdx = 0; latestIdx < latestList.length; latestIdx++) {
    const latestPair = latestList[latestIdx];
    const latestEn = normEn(latestPair?.englishText);

    if (!latestToSnapIndex.has(latestIdx) && latestEn) {
      const sCount = snapIndicesByEn.get(latestEn)?.length ?? 0;
      const lCount = latestIndicesByEn.get(latestEn)?.length ?? 0;
      if (sCount > 0 && (sCount > 1 || lCount > 1)) {
        ambiguousDuplicateLatestIndices.push(latestIdx);
      }
    }

    const hasValidTranslation =
      Boolean(latestPair?.banglaText?.trim()) &&
      !latestPair?.missingTranslation;

    if (!unchangedLatestIndices.has(latestIdx) || !hasValidTranslation) {
      unverifiedLatestIndices.push(latestIdx);
    }
  }

  const hasStructuralChange =
    snapList.length !== latestList.length ||
    deletedSnapIndices.length > 0 ||
    latestToSnapIndex.size !== latestList.length ||
    reorderedLatestIndices.length > 0;

  const allParagraphsUnchanged =
    latestList.length > 0 &&
    snapList.length === latestList.length &&
    !hasStructuralChange &&
    unverifiedLatestIndices.length === 0;

  return {
    snapToLatestIndex,
    latestToSnapIndex,
    unchangedLatestIndices,
    unchangedSnapIndices,
    unverifiedLatestIndices,
    deletedSnapIndices,
    reorderedLatestIndices,
    ambiguousDuplicateLatestIndices,
    hasStructuralChange,
    allParagraphsUnchanged,
  };
}

/**
 * Internal helper that joins ParagraphPair items into a continuous Bangla string
 * while preserving ornamental and blank-line scene breaks (matching `joinParagraphsWithSceneBreaks`).
 */
function joinTranslatedParagraphPairsWithSceneBreaks(
  pairs: ReadonlyArray<ParagraphPair>
): string {
  const segments: string[] = [];
  let hasEmittedParagraph = false;
  let pendingSceneBreak = false;
  let pendingMarkers: string[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const textVal = (pair.banglaText ?? '').trim();

    if (textVal) {
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

const PARTIAL_VERIFICATION_PREFIX_REGEX = /^\[Partial Verification[^\]]*\]\s*/i;

function stripPartialVerificationPrefix(summary: string | undefined): string {
  return (summary ?? '').replace(PARTIAL_VERIFICATION_PREFIX_REGEX, '').trim();
}

function buildPartialVerificationSummary(
  baseSummary: string,
  totalParagraphs: number,
  verifiedIndices: ReadonlyArray<number>,
  unverifiedIndices: ReadonlyArray<number>,
  deletedCount: number
): string {
  const cleanBase =
    stripPartialVerificationPrefix(baseSummary) || 'Verification completed.';

  if (unverifiedIndices.length > 0) {
    const labels = unverifiedIndices.map((idx) => `#${idx + 1}`).join(', ');
    return `[Partial Verification — Verified ${verifiedIndices.length} of ${totalParagraphs} paragraph(s); Paragraph ${labels} changed or remained unverified and requires a Stage 5 re-run.] ${cleanBase}`;
  }

  if (deletedCount > 0) {
    return `[Partial Verification — Chapter paragraph structure changed (${deletedCount} paragraph(s) removed since verification). Re-run Stage 5 to verify the updated chapter.] ${cleanBase}`;
  }

  return cleanBase;
}

export interface ReconcileVerificationAfterLocalEditParams {
  previousReport: VerificationReport | null | undefined;
  previousParagraphs?: ReadonlyArray<ParagraphPair> | null;
  latestParagraphs: ReadonlyArray<ParagraphPair>;
  latestGlossary: ReadonlyArray<TerminologyMemoryItem>;
  checkedAt?: string;
}

/**
 * Reconciles an existing `VerificationReport` after a local paragraph edit, revert, refinement,
 * suggested-fix application, or glossary update:
 * 1. Invalidates stale `source: 'ai_stage5'` issues on any paragraph whose content changed or was deleted.
 * 2. Remaps surviving `ai_stage5` issues on unchanged paragraphs if paragraph indices shifted unambiguously.
 * 3. Re-runs deterministic terminology linting (`lintChapterTerminology`) across `latestParagraphs` and `latestGlossary`.
 * 4. Marks partial verification coverage (`isComplete: false` + partial summary prefix) when paragraphs changed since verification.
 */
export function reconcileVerificationReportAfterLocalEdit(
  params: ReconcileVerificationAfterLocalEditParams
): VerificationReport | null {
  const {
    previousReport,
    previousParagraphs = null,
    latestParagraphs,
    latestGlossary,
    checkedAt = new Date().toISOString(),
  } = params;

  if (!previousReport) {
    return null;
  }

  const hydratedGlossary = hydrateProjectGlossary(latestGlossary);
  const lintResult = lintChapterTerminology(latestParagraphs, hydratedGlossary);

  const mapping = previousParagraphs
    ? mapSnapshotParagraphsToLatest(previousParagraphs, latestParagraphs)
    : null;

  // Map latest paragraph fingerprints for fingerprint-based validation when `previousParagraphs` is omitted
  const latestFpByIndex = new Map<number, string>();
  const latestIndicesByFp = new Map<string, number[]>();
  for (let i = 0; i < latestParagraphs.length; i++) {
    const p = latestParagraphs[i];
    const fp = computeParagraphContentFingerprint(p.englishText, p.banglaText);
    latestFpByIndex.set(i, fp);
    const list = latestIndicesByFp.get(fp) ?? [];
    list.push(i);
    latestIndicesByFp.set(fp, list);
  }

  const remappedPreviousIssues: VerificationIssue[] = [];
  let anyAiIssueInvalidatedByEdit = false;

  for (const iss of previousReport.issues ?? []) {
    if (!iss || typeof iss !== 'object') continue;

    // Deterministic issues: remap `paragraphIndex` if `mapping` is available and paragraph shifted unambiguously,
    // then let `mergeVerificationReportWithTerminologyLint` re-evaluate against `lintResult`.
    if (iss.source === 'deterministic_lint') {
      if (
        mapping &&
        typeof iss.paragraphIndex === 'number' &&
        mapping.snapToLatestIndex.has(iss.paragraphIndex)
      ) {
        const mappedIdx = mapping.snapToLatestIndex.get(iss.paragraphIndex)!;
        remappedPreviousIssues.push({
          ...iss,
          paragraphIndex: mappedIdx,
        });
      } else if (
        !mapping &&
        typeof iss.paragraphIndex === 'number' &&
        iss.paragraphContentFingerprint
      ) {
        const currentFpAtIdx = latestFpByIndex.get(iss.paragraphIndex);
        if (currentFpAtIdx === iss.paragraphContentFingerprint) {
          remappedPreviousIssues.push({ ...iss });
        } else {
          const matchingIndices =
            latestIndicesByFp.get(iss.paragraphContentFingerprint) ?? [];
          if (matchingIndices.length === 1) {
            remappedPreviousIssues.push({
              ...iss,
              paragraphIndex: matchingIndices[0],
            });
          } else {
            remappedPreviousIssues.push({ ...iss });
          }
        }
      } else {
        remappedPreviousIssues.push({ ...iss });
      }
      continue;
    }

    // AI Stage 5 issues (`source !== 'deterministic_lint'`)
    const rawIdx = iss.paragraphIndex;

    // Chapter-level AI issue (`paragraphIndex === undefined || paragraphIndex === null`)
    if (rawIdx === undefined || rawIdx === null) {
      if (mapping && mapping.hasStructuralChange) {
        anyAiIssueInvalidatedByEdit = true;
        continue;
      }
      const cleanChapterIssue: VerificationIssue = {
        ...iss,
        source: 'ai_stage5',
        suggestedFix: undefined,
      };
      delete cleanChapterIssue.paragraphIndex;
      delete cleanChapterIssue.paragraphContentFingerprint;
      remappedPreviousIssues.push(cleanChapterIssue);
      continue;
    }

    // Invalid paragraphIndex -> drop
    if (
      typeof rawIdx !== 'number' ||
      !Number.isFinite(rawIdx) ||
      !Number.isInteger(rawIdx) ||
      rawIdx < 0
    ) {
      continue;
    }

    if (mapping) {
      const latestIdx = mapping.snapToLatestIndex.get(rawIdx);
      if (
        latestIdx === undefined ||
        !mapping.unchangedLatestIndices.has(latestIdx)
      ) {
        anyAiIssueInvalidatedByEdit = true;
        continue;
      }
      const latestFp = latestFpByIndex.get(latestIdx) ?? '';
      if (
        iss.paragraphContentFingerprint &&
        iss.paragraphContentFingerprint !== latestFp
      ) {
        anyAiIssueInvalidatedByEdit = true;
        continue;
      }
      remappedPreviousIssues.push({
        ...iss,
        paragraphIndex: latestIdx,
        paragraphContentFingerprint: latestFp,
        source: 'ai_stage5',
      });
    } else {
      // No `previousParagraphs` array supplied: verify via `paragraphContentFingerprint`
      if (rawIdx >= latestParagraphs.length) {
        anyAiIssueInvalidatedByEdit = true;
        continue;
      }
      const currentFpAtIdx = latestFpByIndex.get(rawIdx) ?? '';
      if (iss.paragraphContentFingerprint) {
        if (iss.paragraphContentFingerprint === currentFpAtIdx) {
          remappedPreviousIssues.push({
            ...iss,
            paragraphIndex: rawIdx,
            paragraphContentFingerprint: currentFpAtIdx,
            source: 'ai_stage5',
          });
        } else {
          const matchingIndices =
            latestIndicesByFp.get(iss.paragraphContentFingerprint) ?? [];
          if (matchingIndices.length === 1) {
            remappedPreviousIssues.push({
              ...iss,
              paragraphIndex: matchingIndices[0],
              paragraphContentFingerprint: iss.paragraphContentFingerprint,
              source: 'ai_stage5',
            });
          } else {
            anyAiIssueInvalidatedByEdit = true;
          }
        }
      } else {
        // Legacy AI issue without stored fingerprint: preserve at `rawIdx` and stamp current fingerprint
        remappedPreviousIssues.push({
          ...iss,
          paragraphIndex: rawIdx,
          paragraphContentFingerprint: currentFpAtIdx,
          source: 'ai_stage5',
        });
      }
    }
  }

  const priorUnresolvedPenalty = (previousReport.issues ?? [])
    .filter((i) => i && typeof i === 'object' && !i.resolved)
    .reduce(
      (acc, iss) =>
        acc +
        getVerificationIssueScorePenalty({
          severity: normalizeStage5IssueSeverity(iss.severity),
          resolved: Boolean(iss.resolved),
        }),
      0
    );

  const filteredPreviousReport: VerificationReport = {
    ...previousReport,
    issues: remappedPreviousIssues,
  };

  const merged = mergeVerificationReportWithTerminologyLint({
    aiReport: null,
    lintResult,
    paragraphs: latestParagraphs,
    previousReport: filteredPreviousReport,
    priorUnresolvedPenaltyOverride: priorUnresolvedPenalty,
    mode: 'local_relint',
    checkedAt,
  });

  const hasUnresolvedHigh = merged.issues.some(
    (i) => i.severity === 'high' && !i.resolved
  );
  const hadPriorPartialPrefix = PARTIAL_VERIFICATION_PREFIX_REGEX.test(
    previousReport.fidelitySummary ?? ''
  );

  const isPartialNow =
    hadPriorPartialPrefix ||
    anyAiIssueInvalidatedByEdit ||
    (mapping !== null && !mapping.allParagraphsUnchanged);

  let finalSummary = merged.fidelitySummary;
  if (isPartialNow) {
    if (mapping && !mapping.allParagraphsUnchanged) {
      const verifiedIndices = latestParagraphs
        .map((_, idx) => idx)
        .filter((idx) => !mapping.unverifiedLatestIndices.includes(idx));
      finalSummary = buildPartialVerificationSummary(
        previousReport.fidelitySummary,
        latestParagraphs.length,
        verifiedIndices,
        mapping.unverifiedLatestIndices,
        mapping.deletedSnapIndices.length
      );
    } else if (!PARTIAL_VERIFICATION_PREFIX_REGEX.test(finalSummary)) {
      finalSummary = `[Partial Verification — One or more paragraphs changed after Stage 5 verification and require a Stage 5 re-run.] ${stripPartialVerificationPrefix(finalSummary)}`;
    }
  }

  return {
    ...merged,
    fidelitySummary: finalSummary,
    isComplete: Boolean(merged.isComplete) && !isPartialNow && !hasUnresolvedHigh,
  };
}

export interface ReconcileStage4ResultParams {
  snapshotParagraphs: ReadonlyArray<ParagraphPair>;
  latestParagraphs: ReadonlyArray<ParagraphPair>;
  editedParagraphs: ReadonlyArray<string>;
  editorialNotes?: ReadonlyArray<string> | null;
  editorialChanges?: ReadonlyArray<EditorialChange> | null;
  latestGlossary: ReadonlyArray<TerminologyMemoryItem>;
  latestVerificationReport?: VerificationReport | null;
  wasVerificationCompleted?: boolean;
  checkedAt?: string;
}

export interface ReconciledStage4Result {
  paragraphs: ParagraphPair[];
  translatedText: string;
  editorialNotes: string[];
  editorialChanges: EditorialChange[];
  appliedParagraphIndices: number[];
  preservedInFlightParagraphIndices: number[];
  changedByStage4ParagraphIndices: number[];
  lintResult: ChapterTerminologyLintResult;
  verificationReport: VerificationReport | null;
  stageCompletedEditing: boolean;
  stageCompletedVerification: boolean;
  chapterStatus: ChapterStatus;
}

/**
 * Pure Stage 4 Literary Editing reconciliation orchestrator:
 * 1. Maps `snapshotParagraphs` to `latestParagraphs` using `mapSnapshotParagraphsToLatest`.
 * 2. Validates that `snapshotParagraphs` and `editedParagraphs` are complete, aligned, and non-empty.
 * 3. Applies Stage 4 polished Bangla (`editedParagraphs[snapIdx]`) ONLY to paragraphs that map
 *    unambiguously and whose English/Bangla content was NOT modified in flight, without silent fallback.
 * 4. Preserves in-flight user edits, insertions, same-length replacements, and ambiguous shifted duplicates verbatim.
 * 5. Filters `editorialChanges` to valid integer `snapIdx` slots where Stage 4's edit was applied, remapping to `latestIdx`.
 * 6. Computes `stageCompletedEditing: boolean` honestly so incomplete, unmapped, inserted, deleted, reordered,
 *    or English-replaced paragraphs prevent false Stage 4 completion.
 * 7. Always runs deterministic terminology linting (`lintChapterTerminology`) against the reconciled `latestParagraphs`
 *    and hydrated `latestGlossary`.
 */
export function reconcileStage4ResultWithLatestState(
  params: ReconcileStage4ResultParams
): ReconciledStage4Result {
  const {
    snapshotParagraphs,
    latestParagraphs,
    editedParagraphs,
    editorialNotes = [],
    editorialChanges = [],
    latestGlossary,
    latestVerificationReport = null,
    wasVerificationCompleted = false,
    checkedAt = new Date().toISOString(),
  } = params;

  const hasValidSnapshotInput =
    Array.isArray(snapshotParagraphs) &&
    snapshotParagraphs.length > 0 &&
    snapshotParagraphs.every(
      (p) =>
        typeof p.englishText === 'string' &&
        normalizeEnglishTerm(p.englishText).length > 0 &&
        !p.missingTranslation &&
        typeof p.banglaText === 'string' &&
        p.banglaText.trim().length > 0 &&
        normalizeBanglaUnicode(p.banglaText.trim()).length > 0
    );

  const isValidStage4Output =
    hasValidSnapshotInput &&
    Array.isArray(editedParagraphs) &&
    editedParagraphs.length === snapshotParagraphs.length &&
    editedParagraphs.every(
      (item) =>
        typeof item === 'string' &&
        item.trim().length > 0 &&
        normalizeBanglaUnicode(item.trim()).length > 0
    );

  const mapping = mapSnapshotParagraphsToLatest(
    snapshotParagraphs,
    latestParagraphs
  );

  const appliedParagraphIndices: number[] = [];
  const preservedInFlightParagraphIndices: number[] = [];
  const changedByStage4ParagraphIndices: number[] = [];
  const appliedSnapToLatest = new Map<number, number>();
  const appliedLatestSet = new Set<number>();

  const reconciledParagraphs: ParagraphPair[] = latestParagraphs.map(
    (latestPair, latestIdx) => {
      if (!isValidStage4Output) {
        preservedInFlightParagraphIndices.push(latestIdx);
        return {
          ...latestPair,
          index: latestIdx,
        };
      }

      const snapIdx = mapping.latestToSnapIndex.get(latestIdx);
      const canApplyStage4Edit =
        snapIdx !== undefined && mapping.unchangedLatestIndices.has(latestIdx);

      const rawCandidate =
        snapIdx !== undefined ? editedParagraphs[snapIdx] : undefined;
      const candidate =
        typeof rawCandidate === 'string' ? rawCandidate.trim() : '';
      const hasValidCandidate =
        candidate.length > 0 && normalizeBanglaUnicode(candidate).length > 0;

      if (!canApplyStage4Edit || !hasValidCandidate) {
        preservedInFlightParagraphIndices.push(latestIdx);
        return {
          ...latestPair,
          index: latestIdx,
        };
      }

      appliedParagraphIndices.push(latestIdx);
      appliedLatestSet.add(latestIdx);
      appliedSnapToLatest.set(snapIdx, latestIdx);

      const resolvedBangla = candidate;

      if (
        normalizeBanglaUnicode(resolvedBangla) !==
        normalizeBanglaUnicode(latestPair.banglaText)
      ) {
        changedByStage4ParagraphIndices.push(latestIdx);
      }

      const updated: ParagraphPair = {
        ...latestPair,
        index: latestIdx,
        previousBanglaText: latestPair.banglaText,
        banglaText: resolvedBangla,
        lastRefinementAction: 'stage_4_editorial',
      };
      delete updated.missingTranslation;

      return updated;
    }
  );

  const translatedText =
    joinTranslatedParagraphPairsWithSceneBreaks(reconciledParagraphs);

  const sanitizedNotes: string[] =
    isValidStage4Output && Array.isArray(editorialNotes)
      ? editorialNotes
          .filter(
            (n): n is string => typeof n === 'string' && n.trim().length > 0
          )
          .map((n) => n.trim())
      : [];

  const sanitizedChanges: EditorialChange[] = [];
  if (isValidStage4Output && Array.isArray(editorialChanges)) {
    for (const change of editorialChanges) {
      if (!change || typeof change !== 'object') continue;
      const rawIdx = (change as { paragraphIndex?: unknown }).paragraphIndex;
      if (
        typeof rawIdx !== 'number' ||
        !Number.isFinite(rawIdx) ||
        !Number.isInteger(rawIdx) ||
        rawIdx < 0 ||
        rawIdx >= snapshotParagraphs.length
      ) {
        continue;
      }

      const mappedLatestIdx = appliedSnapToLatest.get(rawIdx);
      if (mappedLatestIdx === undefined) {
        continue;
      }

      sanitizedChanges.push({
        paragraphIndex: mappedLatestIdx,
        aspect: String(change.aspect ?? '').trim(),
        beforeSnippet: String(change.beforeSnippet ?? '').trim(),
        afterSnippet: String(change.afterSnippet ?? '').trim(),
        rationale: String(change.rationale ?? '').trim(),
      });
    }
  }

  const stageCompletedEditing =
    isValidStage4Output &&
    reconciledParagraphs.length > 0 &&
    reconciledParagraphs.length === snapshotParagraphs.length &&
    !mapping.hasStructuralChange &&
    mapping.deletedSnapIndices.length === 0 &&
    mapping.reorderedLatestIndices.length === 0 &&
    mapping.ambiguousDuplicateLatestIndices.length === 0 &&
    mapping.latestToSnapIndex.size === reconciledParagraphs.length &&
    reconciledParagraphs.every((p, latestIdx) => {
      const snapIdx = mapping.latestToSnapIndex.get(latestIdx);
      if (snapIdx === undefined || snapIdx !== latestIdx) {
        return false;
      }
      const snapPair = snapshotParagraphs[snapIdx];
      if (!snapPair) {
        return false;
      }
      const hasValidEnglish =
        typeof p.englishText === 'string' &&
        normalizeEnglishTerm(p.englishText).length > 0 &&
        normalizeEnglishTerm(p.englishText) ===
          normalizeEnglishTerm(snapPair.englishText);
      const hasValidBangla =
        !p.missingTranslation &&
        typeof p.banglaText === 'string' &&
        p.banglaText.trim().length > 0 &&
        normalizeBanglaUnicode(p.banglaText.trim()).length > 0;
      const isInFlightBanglaModifiedOnAlignedEnglish =
        hasValidEnglish &&
        !mapping.unchangedLatestIndices.has(latestIdx) &&
        normalizeBanglaUnicode(p.banglaText.trim()) !==
          normalizeBanglaUnicode((snapPair.banglaText || '').trim());
      const isAccountedFor =
        appliedLatestSet.has(latestIdx) ||
        isInFlightBanglaModifiedOnAlignedEnglish;
      return hasValidEnglish && hasValidBangla && isAccountedFor;
    });

  const hydratedLatestGlossary = hydrateProjectGlossary(latestGlossary);
  const lintResult = lintChapterTerminology(
    reconciledParagraphs,
    hydratedLatestGlossary
  );

  let verificationReport: VerificationReport | null = null;
  let stageCompletedVerification = false;
  let chapterStatus: ChapterStatus = 'needs_review';

  if (!latestVerificationReport) {
    // No previous Stage 5 report exists
    if (lintResult.findings.length === 0) {
      verificationReport = null;
      stageCompletedVerification = false;
      chapterStatus = 'needs_review';
    } else {
      const detReport = mergeVerificationReportWithTerminologyLint({
        aiReport: null,
        lintResult,
        paragraphs: reconciledParagraphs,
        previousReport: null,
        mode: 'local_relint',
        checkedAt,
      });
      verificationReport = {
        ...detReport,
        isComplete: false,
        fidelitySummary: `Deterministic terminology check after Stage 4 Literary Editing flagged ${lintResult.findings.length} terminology issue(s) against the active glossary. Run Stage 5 Accuracy Verification for a full bilingual fidelity audit.`,
      };
      stageCompletedVerification = false;
      chapterStatus = 'needs_review';
    }
  } else {
    // Previous VerificationReport exists: reconcile against reconciledParagraphs and latestGlossary
    const reconciledReport = reconcileVerificationReportAfterLocalEdit({
      previousReport: latestVerificationReport,
      previousParagraphs: latestParagraphs,
      latestParagraphs: reconciledParagraphs,
      latestGlossary: hydratedLatestGlossary,
      checkedAt,
    });

    const anyParagraphChanged =
      changedByStage4ParagraphIndices.length > 0 || !mapping.allParagraphsUnchanged;

    if (reconciledReport) {
      const hasMissing = reconciledParagraphs.some(
        (p) => Boolean(p.missingTranslation) || !p.banglaText?.trim()
      );
      const hasUnresolvedHigh = reconciledReport.issues.some(
        (i) => i.severity === 'high' && !i.resolved
      );

      if (anyParagraphChanged || !stageCompletedEditing) {
        stageCompletedVerification = false;
        verificationReport = {
          ...reconciledReport,
          isComplete: false,
        };
        chapterStatus = 'needs_review';
      } else {
        stageCompletedVerification =
          Boolean(wasVerificationCompleted) &&
          Boolean(reconciledReport.isComplete) &&
          !hasMissing &&
          !hasUnresolvedHigh;
        verificationReport = {
          ...reconciledReport,
          isComplete: stageCompletedVerification,
        };
        chapterStatus = stageCompletedVerification ? 'completed' : 'needs_review';
      }
    }
  }

  return {
    paragraphs: reconciledParagraphs,
    translatedText,
    editorialNotes: sanitizedNotes,
    editorialChanges: sanitizedChanges,
    appliedParagraphIndices,
    preservedInFlightParagraphIndices,
    changedByStage4ParagraphIndices,
    lintResult,
    verificationReport,
    stageCompletedEditing,
    stageCompletedVerification,
    chapterStatus,
  };
}

export interface ReconcileStage5ResultParams {
  snapshotParagraphs: ReadonlyArray<ParagraphPair>;
  latestParagraphs: ReadonlyArray<ParagraphPair>;
  aiReport: VerificationReport;
  latestGlossary: ReadonlyArray<TerminologyMemoryItem>;
  previousVerificationReport?: VerificationReport | null;
  checkedAt?: string;
}

export interface ReconciledStage5Result {
  verificationReport: VerificationReport;
  lintResult: ChapterTerminologyLintResult;
  numericalLintResult: ChapterNumericalLintResult;
  verifiedParagraphIndices: number[];
  unverifiedParagraphIndices: number[];
  discardedStaleIssueCount: number;
  rejectedInvalidIssueCount: number;
  allParagraphsVerified: boolean;
  stageCompletedVerification: boolean;
  chapterStatus: ChapterStatus;
}

/**
 * Pure Stage 5 Accuracy Verification reconciliation orchestrator:
 * 1. Maps `snapshotParagraphs` to `latestParagraphs` using `mapSnapshotParagraphsToLatest`.
 * 2. Normalizes and filters incoming `aiReport.issues`:
 *    - Missing/null `paragraphIndex` -> chapter-level issue (`paragraphIndex: undefined`, `suggestedFix: undefined`),
 *      kept only when the chapter had no in-flight edits or structural changes (`allParagraphsVerified`).
 *    - Negative, non-integer, non-finite, or out-of-range `paragraphIndex` -> rejected (`rejectedInvalidIssueCount++`).
 *    - Valid `paragraphIndex` (`0 <= snapIdx < snapshotParagraphs.length`) -> kept and remapped to `latestIdx`
 *      ONLY if `snapIdx` maps unambiguously to `latestIdx` AND `unchangedLatestIndices.has(latestIdx)`.
 *      Otherwise discarded as stale (`discardedStaleIssueCount++`).
 * 3. Runs `lintChapterTerminology` and `lintChapterNumericalConsistency` against `latestParagraphs` and hydrated `latestGlossary`.
 * 4. Merges AI and deterministic findings via `mergeVerificationReportWithTerminologyLint` in `'stage5_full'` mode,
 *    conservatively preserving `resolved: true` on unchanged paragraphs.
 * 5. Enforces strict completion and partial-verification score presentation semantics:
 *    - Never invents a synthetic score for unverified paragraphs.
 *    - When `!allParagraphsVerified`, sets `verificationReport.isComplete = false`, `stageCompletedVerification = false`,
 *      `chapterStatus = 'needs_review'`, and prefixes `fidelitySummary` with `[Partial Verification — ...]`.
 */
export function reconcileStage5ResultWithLatestState(
  params: ReconcileStage5ResultParams
): ReconciledStage5Result {
  const {
    snapshotParagraphs,
    latestParagraphs,
    aiReport,
    latestGlossary,
    previousVerificationReport = null,
    checkedAt = aiReport?.checkedAt ?? new Date().toISOString(),
  } = params;

  const mapping = mapSnapshotParagraphsToLatest(
    snapshotParagraphs,
    latestParagraphs
  );

  const hasMissingTranslations = latestParagraphs.some(
    (p) => Boolean(p.missingTranslation) || !p.banglaText?.trim()
  );

  const verifiedParagraphIndices: number[] = [];
  const unverifiedParagraphIndices: number[] = [];

  for (let latestIdx = 0; latestIdx < latestParagraphs.length; latestIdx++) {
    const p = latestParagraphs[latestIdx];
    const hasValidBangla = Boolean(p?.banglaText?.trim()) && !p?.missingTranslation;
    if (mapping.unchangedLatestIndices.has(latestIdx) && hasValidBangla) {
      verifiedParagraphIndices.push(latestIdx);
    } else {
      unverifiedParagraphIndices.push(latestIdx);
    }
  }

  const allParagraphsVerified =
    latestParagraphs.length > 0 &&
    unverifiedParagraphIndices.length === 0 &&
    mapping.deletedSnapIndices.length === 0 &&
    !mapping.hasStructuralChange &&
    !hasMissingTranslations;

  let discardedStaleIssueCount = 0;
  let rejectedInvalidIssueCount = 0;
  const filteredRemappedAiIssues: VerificationIssue[] = [];

  for (const rawIss of aiReport?.issues ?? []) {
    if (!rawIss || typeof rawIss !== 'object') {
      rejectedInvalidIssueCount++;
      continue;
    }

    if (
      typeof rawIss.description !== 'string' ||
      rawIss.description.trim().length === 0
    ) {
      rejectedInvalidIssueCount++;
      continue;
    }

    const normalizedType = normalizeStage5IssueType(rawIss.type);
    const normalizedSeverity = normalizeStage5IssueSeverity(rawIss.severity);

    const rawIdx = (rawIss as { paragraphIndex?: unknown }).paragraphIndex;

    // 1. Missing or null paragraphIndex -> legitimate chapter-level issue
    if (rawIdx === undefined || rawIdx === null) {
      if (!allParagraphsVerified) {
        discardedStaleIssueCount++;
        continue;
      }
      const chapterIssue: VerificationIssue = {
        ...rawIss,
        type: normalizedType,
        severity: normalizedSeverity,
        description: rawIss.description.trim(),
        suggestedFix: undefined,
        source: 'ai_stage5',
      };
      delete chapterIssue.paragraphIndex;
      delete chapterIssue.paragraphContentFingerprint;
      filteredRemappedAiIssues.push(chapterIssue);
      continue;
    }

    // 2. Negative, non-integer, non-finite, or out-of-range paragraphIndex -> invalid issue, reject!
    if (
      typeof rawIdx !== 'number' ||
      !Number.isFinite(rawIdx) ||
      !Number.isInteger(rawIdx) ||
      rawIdx < 0 ||
      rawIdx >= snapshotParagraphs.length
    ) {
      rejectedInvalidIssueCount++;
      continue;
    }

    // 3. Valid snapshot paragraphIndex -> check mapping & unchanged state
    const mappedLatestIdx = mapping.snapToLatestIndex.get(rawIdx);
    if (
      mappedLatestIdx === undefined ||
      !mapping.unchangedLatestIndices.has(mappedLatestIdx)
    ) {
      discardedStaleIssueCount++;
      continue;
    }

    const latestPair = latestParagraphs[mappedLatestIdx];
    const fp = computeParagraphContentFingerprint(
      latestPair.englishText,
      latestPair.banglaText
    );
    const validSuggestedFix =
      typeof rawIss.suggestedFix === 'string' &&
      rawIss.suggestedFix.trim().length > 0 &&
      /[\u0980-\u09FF]/.test(rawIss.suggestedFix)
        ? rawIss.suggestedFix.trim()
        : undefined;

    filteredRemappedAiIssues.push({
      ...rawIss,
      type: normalizedType,
      severity: normalizedSeverity,
      description: rawIss.description.trim(),
      paragraphIndex: mappedLatestIdx,
      suggestedFix: validSuggestedFix,
      paragraphContentFingerprint: fp,
      source: 'ai_stage5',
    });
  }

  // Remap previousVerificationReport issues to latest indices where paragraphs shifted unambiguously
  // so resolved state on unchanged shifted paragraphs is preserved accurately.
  let alignedPreviousReport: VerificationReport | null = null;
  if (previousVerificationReport) {
    const latestIndicesByFp = new Map<string, number[]>();
    for (let i = 0; i < latestParagraphs.length; i++) {
      const fp = computeParagraphContentFingerprint(
        latestParagraphs[i].englishText,
        latestParagraphs[i].banglaText
      );
      const list = latestIndicesByFp.get(fp) ?? [];
      list.push(i);
      latestIndicesByFp.set(fp, list);
    }

    const alignedPrevIssues: VerificationIssue[] = [];
    for (const prevIss of previousVerificationReport.issues ?? []) {
      if (!prevIss || typeof prevIss !== 'object') continue;
      if (typeof prevIss.paragraphIndex === 'number') {
        const mappedFromSnap = mapping.snapToLatestIndex.get(
          prevIss.paragraphIndex
        );
        if (
          mappedFromSnap !== undefined &&
          mapping.unchangedLatestIndices.has(mappedFromSnap)
        ) {
          alignedPrevIssues.push({
            ...prevIss,
            paragraphIndex: mappedFromSnap,
          });
          continue;
        }
        if (prevIss.paragraphContentFingerprint) {
          const matches =
            latestIndicesByFp.get(prevIss.paragraphContentFingerprint) ?? [];
          if (matches.length === 1) {
            alignedPrevIssues.push({
              ...prevIss,
              paragraphIndex: matches[0],
            });
            continue;
          }
        }
      }
      alignedPrevIssues.push({ ...prevIss });
    }

    alignedPreviousReport = {
      ...previousVerificationReport,
      issues: alignedPrevIssues,
    };
  }

  const hydratedLatestGlossary = hydrateProjectGlossary(latestGlossary);
  const lintResult = lintChapterTerminology(
    latestParagraphs,
    hydratedLatestGlossary
  );
  const numericalLintResult = lintChapterNumericalConsistency(latestParagraphs);

  const isAiReportStructurallyValid =
    Boolean(aiReport) &&
    typeof aiReport === 'object' &&
    !Array.isArray(aiReport) &&
    Array.isArray(aiReport.issues);

  const hasValidInRangeAiScore =
    typeof aiReport?.overallScore === 'number' &&
    Number.isFinite(aiReport.overallScore) &&
    aiReport.overallScore >= 0 &&
    aiReport.overallScore <= 100;

  const defaultCompletionWhenOmitted =
    isAiReportStructurallyValid &&
    filteredRemappedAiIssues.every(
      (i) => i.resolved || (i.severity !== 'high' && i.severity !== 'medium')
    );

  const aiReportHadHighIssues =
    isAiReportStructurallyValid &&
    (aiReport.issues ?? []).some(
      (i) =>
        i &&
        typeof i === 'object' &&
        normalizeStage5IssueSeverity((i as { severity?: unknown }).severity) ===
          'high' &&
        !(i as { resolved?: boolean }).resolved
    );
  const aiAuditExplicitlyIncomplete =
    !isAiReportStructurallyValid ||
    (aiReport?.isComplete === false && !aiReportHadHighIssues) ||
    PARTIAL_VERIFICATION_PREFIX_REGEX.test(aiReport?.fidelitySummary ?? '') ||
    /^Deterministic terminology check/i.test(aiReport?.fidelitySummary ?? '');

  const sanitizedAiReport: VerificationReport = {
    overallScore: hasValidInRangeAiScore
      ? Math.round(aiReport.overallScore)
      : isAiReportStructurallyValid
        ? 95
        : 85,
    fidelitySummary:
      typeof aiReport?.fidelitySummary === 'string' &&
      aiReport.fidelitySummary.trim()
        ? aiReport.fidelitySummary.trim()
        : 'Verification completed.',
    isComplete:
      isAiReportStructurallyValid &&
      !aiAuditExplicitlyIncomplete &&
      (typeof aiReport?.isComplete === 'boolean'
        ? aiReport.isComplete
        : defaultCompletionWhenOmitted) &&
      allParagraphsVerified,
    issues: filteredRemappedAiIssues,
    checkedAt,
  };

  const mergedReport = mergeVerificationReportWithTerminologyLint({
    aiReport: sanitizedAiReport,
    lintResult,
    numericalLintResult,
    paragraphs: latestParagraphs,
    previousReport: alignedPreviousReport,
    mode: 'stage5_full',
    checkedAt,
  });

  const hasUnresolvedHigh = mergedReport.issues.some(
    (i) => i.severity === 'high' && !i.resolved
  );

  const isComplete =
    Boolean(mergedReport.isComplete) &&
    !aiAuditExplicitlyIncomplete &&
    allParagraphsVerified &&
    !hasUnresolvedHigh &&
    !hasMissingTranslations;

  const finalSummary = allParagraphsVerified
    ? mergedReport.fidelitySummary
    : buildPartialVerificationSummary(
        mergedReport.fidelitySummary,
        latestParagraphs.length,
        verifiedParagraphIndices,
        unverifiedParagraphIndices,
        mapping.deletedSnapIndices.length
      );

  const stageCompletedVerification =
    isAiReportStructurallyValid &&
    !aiAuditExplicitlyIncomplete &&
    allParagraphsVerified &&
    !hasMissingTranslations;
  const chapterStatus: ChapterStatus = isComplete ? 'completed' : 'needs_review';

  const finalReport: VerificationReport = {
    ...mergedReport,
    fidelitySummary: finalSummary,
    isComplete,
  };

  return {
    verificationReport: finalReport,
    lintResult,
    numericalLintResult,
    verifiedParagraphIndices,
    unverifiedParagraphIndices,
    discardedStaleIssueCount,
    rejectedInvalidIssueCount,
    allParagraphsVerified,
    stageCompletedVerification,
    chapterStatus,
  };
}

// ============================================================================
// PHASE 2B.4a — PURE STAGE 2 AUTHOR VOICE & STYLE PROFILE RECONCILIATION
// ============================================================================

export type Stage2AiAnalyzedStyleField = Exclude<
  keyof StyleProfile,
  'customNotes'
>;

/**
 * Exact eleven AI-analyzed style dimensions on `StyleProfile` returned by Stage 2 (`analyzeAuthorVoice`).
 * `customNotes` is strictly user-owned content and is excluded from AI overwriting.
 */
export const STAGE2_AI_ANALYZED_STYLE_FIELDS: ReadonlyArray<Stage2AiAnalyzedStyleField> =
  [
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
  ];

export interface ReconcileStage2ResultParams {
  snapshotStyleProfile?: StyleProfile | null;
  snapshotProfile?: StyleProfile | null;
  latestStyleProfile?: StyleProfile | null;
  latestProfile?: StyleProfile | null;
  aiStyleProfile?: Partial<Record<keyof StyleProfile, unknown>> | null;
  aiProfile?: Partial<Record<keyof StyleProfile, unknown>> | null;
  candidateStyleProfile?: Partial<Record<keyof StyleProfile, unknown>> | null;
}

/**
 * Pure Stage 2 Author Voice & Style Profile reconciliation helper.
 * Reconciles an AI-generated Stage 2 `StyleProfile` with the user's latest `StyleProfile`
 * after an asynchronous request:
 * 1. Protects `customNotes` as strictly user-owned content (preserving concurrent user edits
 *    or existing snapshot `customNotes`, and never allowing the AI result's hardcoded empty
 *    `customNotes` or any AI value to replace it).
 * 2. For each of the 11 AI-analyzed style fields (`STAGE2_AI_ANALYZED_STYLE_FIELDS`):
 *    - Compares the latest value against the request-start snapshot value.
 *    - If the values differ (`latestVal !== snapVal`), preserves the latest value verbatim
 *      (including an intentional empty string `''` when the user cleared a field in flight).
 *    - If the values are unchanged, accepts the AI result only when that field is genuinely
 *      present and is a non-empty string (`typeof rawAiVal === 'string' && rawAiVal.trim().length > 0`).
 *    - If the AI result omits a field (`undefined`) or supplies `null`, an empty/whitespace string,
 *      or a non-string value, retains the latest value rather than overwriting with an invalid or invented default.
 * 3. Deterministic and side-effect free: never mutates its input objects.
 */
export function reconcileStage2ResultWithLatestState(
  params: ReconcileStage2ResultParams
): StyleProfile;
export function reconcileStage2ResultWithLatestState(
  snapshotStyleProfile: StyleProfile | null | undefined,
  latestStyleProfile: StyleProfile | null | undefined,
  aiStyleProfile: Partial<Record<keyof StyleProfile, unknown>> | null | undefined
): StyleProfile;
export function reconcileStage2ResultWithLatestState(
  firstArg: ReconcileStage2ResultParams | StyleProfile | null | undefined,
  secondArg?: StyleProfile | null,
  thirdArg?: Partial<Record<keyof StyleProfile, unknown>> | null
): StyleProfile {
  let snapshotProfile: StyleProfile | null | undefined;
  let latestProfile: StyleProfile | null | undefined;
  let aiProfile: Partial<Record<keyof StyleProfile, unknown>> | null | undefined;

  const isParamsObject =
    arguments.length === 1 &&
    firstArg !== null &&
    firstArg !== undefined &&
    typeof firstArg === 'object' &&
    ('snapshotStyleProfile' in firstArg ||
      'snapshotProfile' in firstArg ||
      'latestStyleProfile' in firstArg ||
      'latestProfile' in firstArg ||
      'aiStyleProfile' in firstArg ||
      'aiProfile' in firstArg ||
      'candidateStyleProfile' in firstArg ||
      !STAGE2_AI_ANALYZED_STYLE_FIELDS.some((f) => f in firstArg));

  if (isParamsObject) {
    const params = firstArg as ReconcileStage2ResultParams;
    snapshotProfile =
      params.snapshotStyleProfile !== undefined
        ? params.snapshotStyleProfile
        : params.snapshotProfile;
    latestProfile =
      params.latestStyleProfile !== undefined
        ? params.latestStyleProfile
        : params.latestProfile;
    aiProfile =
      params.aiStyleProfile !== undefined
        ? params.aiStyleProfile
        : params.aiProfile !== undefined
          ? params.aiProfile
          : params.candidateStyleProfile;
  } else {
    snapshotProfile = firstArg as StyleProfile | null | undefined;
    latestProfile = secondArg;
    aiProfile = thirdArg;
  }

  const snapObj: StyleProfile | null =
    snapshotProfile !== null &&
    snapshotProfile !== undefined &&
    typeof snapshotProfile === 'object'
      ? snapshotProfile
      : null;
  const latestObj: StyleProfile | null =
    latestProfile !== null &&
    latestProfile !== undefined &&
    typeof latestProfile === 'object'
      ? latestProfile
      : null;
  const aiObj: Partial<Record<keyof StyleProfile, unknown>> | null =
    aiProfile !== null &&
    aiProfile !== undefined &&
    typeof aiProfile === 'object' &&
    !Array.isArray(aiProfile)
      ? aiProfile
      : null;

  // A. Preserve customNotes (user-owned content; never overwritten by AI)
  const snapCustomNotes =
    snapObj !== null && typeof snapObj.customNotes === 'string'
      ? snapObj.customNotes
      : '';
  const latestCustomNotes =
    latestObj !== null && typeof latestObj.customNotes === 'string'
      ? latestObj.customNotes
      : snapCustomNotes;

  const reconciled: StyleProfile = {
    overallVoice: '',
    sentenceStructure: '',
    vocabularyComplexity: '',
    narrativePerspective: '',
    dialogueStyle: '',
    emotionalIntensity: '',
    descriptiveTechniques: '',
    metaphorsAndImagery: '',
    literaryCharacteristics: '',
    languageRegister: '',
    banglaAdaptationStrategy: '',
    customNotes: latestCustomNotes,
  };

  // B & C. Reconcile each of the 11 AI-analyzed style fields
  for (const field of STAGE2_AI_ANALYZED_STYLE_FIELDS) {
    const snapVal =
      snapObj !== null && typeof snapObj[field] === 'string'
        ? snapObj[field]
        : '';
    const hasLatestFieldString =
      latestObj !== null && typeof latestObj[field] === 'string';
    const latestVal = hasLatestFieldString
      ? (latestObj![field] as string)
      : snapVal;

    // If the user changed or intentionally cleared (`''`) this field while Stage 2 was running,
    // preserve the latest user value verbatim.
    if (hasLatestFieldString && latestVal !== snapVal) {
      reconciled[field] = latestVal;
      continue;
    }

    // Field was unchanged in flight: accept AI value only if genuinely present and a valid non-empty string
    const rawAiVal = aiObj !== null ? aiObj[field] : undefined;

    if (typeof rawAiVal === 'string' && rawAiVal.trim().length > 0) {
      reconciled[field] = rawAiVal.trim();
    } else {
      reconciled[field] = latestVal;
    }
  }

  return reconciled;
}

// ============================================================================
// SUBSTEP 2B.5b — PURE STAGE 3 RECOVERY, RECONCILIATION & FINALIZATION HELPERS
// ============================================================================

/**
 * Helper A: Determines whether a Stage 3 chunk is complete based on actual paragraph content
 * and source alignment rather than relying on the fragile `completedChunks` counter.
 *
 * A chunk is complete if and only if:
 * 1. Valid non-empty chunk bounds (`0 <= startParagraphIndex <= endParagraphIndex < paragraphs.length`)
 *    match `chunk.paragraphs.length`.
 * 2. Every paragraph index in `chunk.startParagraphIndex .. chunk.endParagraphIndex` exists in `paragraphs`.
 * 3. Each paragraph's normalized English text matches `chunk.paragraphs[offset]`.
 * 4. Each paragraph has non-empty Bangla text (`banglaText.trim().length > 0`).
 * 5. Each paragraph does not have `missingTranslation === true`.
 */
export function isStage3ChunkComplete(
  chunk:
    | Pick<TextChunk, 'paragraphs' | 'startParagraphIndex' | 'endParagraphIndex'>
    | null
    | undefined,
  paragraphs: ReadonlyArray<ParagraphPair> | null | undefined
): boolean {
  if (
    !chunk ||
    !Array.isArray(chunk.paragraphs) ||
    chunk.paragraphs.length === 0 ||
    !Array.isArray(paragraphs) ||
    paragraphs.length === 0
  ) {
    return false;
  }

  const { startParagraphIndex, endParagraphIndex } = chunk;
  if (
    typeof startParagraphIndex !== 'number' ||
    typeof endParagraphIndex !== 'number' ||
    !Number.isInteger(startParagraphIndex) ||
    !Number.isInteger(endParagraphIndex) ||
    startParagraphIndex < 0 ||
    endParagraphIndex < startParagraphIndex ||
    endParagraphIndex >= paragraphs.length ||
    endParagraphIndex - startParagraphIndex + 1 !== chunk.paragraphs.length
  ) {
    return false;
  }

  for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
    const pIdx = startParagraphIndex + offset;
    const pair = paragraphs[pIdx];
    if (!pair) {
      return false;
    }

    const expectedEng = normalizeEnglishTerm(chunk.paragraphs[offset] ?? '');
    const actualEng = normalizeEnglishTerm(pair.englishText ?? '');
    if (expectedEng.length === 0 || actualEng !== expectedEng) {
      return false;
    }

    if (Boolean(pair.missingTranslation)) {
      return false;
    }

    const trimmedBangla =
      typeof pair.banglaText === 'string' ? pair.banglaText.trim() : '';
    if (
      trimmedBangla.length === 0 ||
      normalizeBanglaUnicode(trimmedBangla).length === 0
    ) {
      return false;
    }
  }

  return true;
}

export interface PlanStage3ChunkExecutionParams {
  originalText: string;
  paragraphs?: ReadonlyArray<ParagraphPair> | null;
  maxWordsPerChunk?: number;
  contextWindow?: number;
}

export interface Stage3ChunkExecutionPlan {
  chunks: TextChunk[];
  chunksToExecute: TextChunk[];
  completedChunkIndices: number[];
  pendingChunkIndices: number[];
  isResumeMode: boolean;
  allChunksInitiallyComplete: boolean;
  hasAnyValidTranslation: boolean;
  eligibleParagraphIndicesByChunk: Map<number, number[]>;
  protectedParagraphIndicesByChunk: Map<number, number[]>;
}

/**
 * Helper B: Pure execution planner for Stage 3 chunked translation.
 *
 * Derives chunks via `chunkTextByParagraphs(originalText, maxWordsPerChunk, contextWindow)`
 * and distinguishes three execution modes:
 * 1. First pass (0% translated):
 *    - No valid translated paragraph exists.
 *    - Executes all chunks (`isResumeMode: false`, `allChunksInitiallyComplete: false`).
 * 2. Resume / repair pass (partially translated):
 *    - At least one valid translated paragraph exists, and one or more current chunks are incomplete.
 *    - Skips completed chunks and executes only incomplete chunks (`isResumeMode: true`, `allChunksInitiallyComplete: false`).
 *    - Within incomplete chunks, protects paragraph slots that already have valid aligned translations
 *      (`missingTranslation !== true && banglaText.trim().length > 0`) and marks only missing/empty slots eligible.
 * 3. Fresh full retranslation (100% translated):
 *    - Every current paragraph has a valid translation (`allChunksInitiallyComplete: true`).
 *    - Executes all chunks again (`isResumeMode: false`, `allChunksInitiallyComplete: true`).
 *
 * Zero-paragraph manuscripts return an empty plan with `isResumeMode: false` and `allChunksInitiallyComplete: false`.
 */
export function planStage3ChunkExecution(
  params: PlanStage3ChunkExecutionParams
): Stage3ChunkExecutionPlan {
  const rawOriginalText =
    typeof params?.originalText === 'string' ? params.originalText : '';
  const maxWordsPerChunk =
    typeof params?.maxWordsPerChunk === 'number' && params.maxWordsPerChunk > 0
      ? params.maxWordsPerChunk
      : 500;
  const contextWindow =
    typeof params?.contextWindow === 'number' && params.contextWindow >= 0
      ? params.contextWindow
      : 2;
  const paragraphs = Array.isArray(params?.paragraphs) ? params.paragraphs : [];

  const chunks = chunkTextByParagraphs(
    rawOriginalText,
    maxWordsPerChunk,
    contextWindow
  );

  const eligibleParagraphIndicesByChunk = new Map<number, number[]>();
  const protectedParagraphIndicesByChunk = new Map<number, number[]>();

  if (chunks.length === 0) {
    return {
      chunks: [],
      chunksToExecute: [],
      completedChunkIndices: [],
      pendingChunkIndices: [],
      isResumeMode: false,
      allChunksInitiallyComplete: false,
      hasAnyValidTranslation: false,
      eligibleParagraphIndicesByChunk,
      protectedParagraphIndicesByChunk,
    };
  }

  let hasAnyValidTranslation = false;
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
      const pIdx = chunk.startParagraphIndex + offset;
      const pair = paragraphs[pIdx];
      if (!pair) continue;
      const expectedEng = normalizeEnglishTerm(chunk.paragraphs[offset] ?? '');
      const actualEng = normalizeEnglishTerm(pair.englishText ?? '');
      const trimmedBangla =
        typeof pair.banglaText === 'string' ? pair.banglaText.trim() : '';
      if (
        expectedEng.length > 0 &&
        actualEng === expectedEng &&
        !pair.missingTranslation &&
        trimmedBangla.length > 0 &&
        normalizeBanglaUnicode(trimmedBangla).length > 0
      ) {
        hasAnyValidTranslation = true;
        break;
      }
    }
    if (hasAnyValidTranslation) break;
  }

  // Also check via conservative identity mapping if any current manuscript paragraph has a valid translation
  if (!hasAnyValidTranslation && paragraphs.length > 0) {
    for (const pair of paragraphs) {
      if (!pair) continue;
      const trimmedBangla =
        typeof pair.banglaText === 'string' ? pair.banglaText.trim() : '';
      if (
        !pair.missingTranslation &&
        trimmedBangla.length > 0 &&
        normalizeBanglaUnicode(trimmedBangla).length > 0
      ) {
        hasAnyValidTranslation = true;
        break;
      }
    }
  }

  const completedChunkIndices: number[] = [];
  const pendingChunkIndices: number[] = [];

  for (const chunk of chunks) {
    if (isStage3ChunkComplete(chunk, paragraphs)) {
      completedChunkIndices.push(chunk.chunkIndex);
    } else {
      pendingChunkIndices.push(chunk.chunkIndex);
    }
  }

  const allChunksInitiallyComplete =
    chunks.length > 0 && pendingChunkIndices.length === 0;
  const isResumeMode =
    hasAnyValidTranslation &&
    !allChunksInitiallyComplete &&
    pendingChunkIndices.length > 0;

  const completedSet = new Set<number>(completedChunkIndices);
  const chunksToExecute = isResumeMode
    ? chunks.filter((c) => !completedSet.has(c.chunkIndex))
    : [...chunks];

  for (const chunk of chunks) {
    const eligibleIndices: number[] = [];
    const protectedIndices: number[] = [];

    if (!isResumeMode) {
      // First pass (0%) or Fresh Full Retranslation (100%): all paragraph slots in chunk are eligible
      for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
        eligibleIndices.push(chunk.startParagraphIndex + offset);
      }
    } else if (completedSet.has(chunk.chunkIndex)) {
      // Completed chunk in resume mode: skipped, all its slots are protected
      for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
        protectedIndices.push(chunk.startParagraphIndex + offset);
      }
    } else {
      // Incomplete chunk in resume mode: protect already-translated aligned slots, mark missing/empty slots eligible
      for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
        const pIdx = chunk.startParagraphIndex + offset;
        const pair = paragraphs[pIdx];
        const expectedEng = normalizeEnglishTerm(chunk.paragraphs[offset] ?? '');
        const actualEng = normalizeEnglishTerm(pair?.englishText ?? '');
        const trimmedBangla =
          typeof pair?.banglaText === 'string' ? pair.banglaText.trim() : '';

        if (
          pair &&
          expectedEng.length > 0 &&
          actualEng === expectedEng &&
          !pair.missingTranslation &&
          trimmedBangla.length > 0 &&
          normalizeBanglaUnicode(trimmedBangla).length > 0
        ) {
          protectedIndices.push(pIdx);
        } else {
          eligibleIndices.push(pIdx);
        }
      }
    }

    eligibleParagraphIndicesByChunk.set(chunk.chunkIndex, eligibleIndices);
    protectedParagraphIndicesByChunk.set(chunk.chunkIndex, protectedIndices);
  }

  return {
    chunks,
    chunksToExecute,
    completedChunkIndices,
    pendingChunkIndices,
    isResumeMode,
    allChunksInitiallyComplete,
    hasAnyValidTranslation,
    eligibleParagraphIndicesByChunk,
    protectedParagraphIndicesByChunk,
  };
}

/**
 * Internal helper that detects whether a paragraph pair changed between two snapshots
 * (including English source edits, Bangla edits, manual clears, refinements, or reverts).
 */
function hasParagraphChangedBetweenSnapshots(
  snapPair: ParagraphPair | undefined,
  latestPair: ParagraphPair | undefined
): boolean {
  if (!snapPair || !latestPair) {
    return true;
  }

  if (
    normalizeEnglishTerm(snapPair.englishText ?? '') !==
    normalizeEnglishTerm(latestPair.englishText ?? '')
  ) {
    return true;
  }

  const snapBanglaRaw = (snapPair.banglaText ?? '').trim();
  const latestBanglaRaw = (latestPair.banglaText ?? '').trim();
  if (
    (snapBanglaRaw.length > 0) !== (latestBanglaRaw.length > 0) ||
    normalizeBanglaUnicode(snapBanglaRaw) !==
      normalizeBanglaUnicode(latestBanglaRaw)
  ) {
    return true;
  }

  if (Boolean(snapPair.missingTranslation) !== Boolean(latestPair.missingTranslation)) {
    return true;
  }

  if (
    (snapPair.lastRefinementAction ?? undefined) !==
    (latestPair.lastRefinementAction ?? undefined)
  ) {
    return true;
  }

  const snapPrevDefined =
    snapPair.previousBanglaText !== undefined &&
    snapPair.previousBanglaText !== null;
  const latestPrevDefined =
    latestPair.previousBanglaText !== undefined &&
    latestPair.previousBanglaText !== null;
  if (snapPrevDefined !== latestPrevDefined) {
    return true;
  }
  if (
    snapPrevDefined &&
    latestPrevDefined &&
    normalizeBanglaUnicode(snapPair.previousBanglaText ?? '') !==
      normalizeBanglaUnicode(latestPair.previousBanglaText ?? '')
  ) {
    return true;
  }

  if ((snapPair.refinementRationale ?? '') !== (latestPair.refinementRationale ?? '')) {
    return true;
  }

  return false;
}

export interface ReconcileStage3ChunkParams {
  stage3StartParagraphs?: ReadonlyArray<ParagraphPair> | null;
  chunkSnapshotParagraphs: ReadonlyArray<ParagraphPair>;
  latestParagraphs: ReadonlyArray<ParagraphPair>;
  chunk: Pick<
    TextChunk,
    'chunkIndex' | 'paragraphs' | 'startParagraphIndex' | 'endParagraphIndex'
  > & {
    paragraphMeta?: TextChunk['paragraphMeta'];
  };
  rawChunkOutput: ReadonlyArray<string> | null | undefined;
  isResumeMode?: boolean;
}

export interface ReconciledStage3ChunkResult {
  paragraphs: ParagraphPair[];
  fullBanglaText: string;
  lastNonEmptyBangla: string;
  appliedParagraphIndices: number[];
  preservedParagraphIndices: number[];
  rejectedInFlightEditParagraphIndices: number[];
  missingParagraphIndices: number[];
  chunkComplete: boolean;
}

/**
 * Helper C: Reconciles one completed Stage 3 chunk response against the latest chapter state.
 *
 * Guarantees:
 * - Uses `mapSnapshotParagraphsToLatest` to map `chunkSnapshotParagraphs` -> `latestParagraphs`
 *   (and `stage3StartParagraphs` -> `latestParagraphs` when provided).
 * - Never overwrites paragraphs outside the active chunk.
 * - Never overwrites a paragraph modified during the chunk request or after Stage 3 began
 *   (manual edit, clear to `""`, Paragraph Studio refinement, revert including revert to `""`, or English source edit).
 * - In resume mode (`isResumeMode: true`), preserves existing valid translations inside a partially translated chunk
 *   unless they were empty or marked `missingTranslation === true`.
 * - In full retranslation mode (`isResumeMode: false`), updates untouched paragraphs with new AI output
 *   and stores the prior non-empty Bangla translation in `previousBanglaText`.
 * - Preserves `sceneBreakAfter` and `sceneBreakMarker`.
 * - Marks eligible slots with empty/missing AI output as `missingTranslation: true` while preserving safe existing content.
 */
export function reconcileStage3ChunkWithLatestState(
  params: ReconcileStage3ChunkParams
): ReconciledStage3ChunkResult {
  const chunkSnapshotParagraphs = Array.isArray(params.chunkSnapshotParagraphs)
    ? params.chunkSnapshotParagraphs
    : [];
  const latestParagraphs = Array.isArray(params.latestParagraphs)
    ? params.latestParagraphs
    : [];
  const stage3StartParagraphs = Array.isArray(params.stage3StartParagraphs)
    ? params.stage3StartParagraphs
    : null;
  const chunk = params.chunk;
  const rawChunkOutput = Array.isArray(params.rawChunkOutput)
    ? params.rawChunkOutput
    : [];
  const isResumeMode = Boolean(params.isResumeMode);

  const mappingFromChunkSnap = mapSnapshotParagraphsToLatest(
    chunkSnapshotParagraphs,
    latestParagraphs
  );
  const mappingFromStage3Start = stage3StartParagraphs
    ? mapSnapshotParagraphsToLatest(stage3StartParagraphs, latestParagraphs)
    : null;

  const appliedParagraphIndices: number[] = [];
  const preservedParagraphIndices: number[] = [];
  const rejectedInFlightEditParagraphIndices: number[] = [];
  const missingParagraphIndices: number[] = [];
  let lastNonEmptyBangla = '';

  const reconciledParagraphs: ParagraphPair[] = latestParagraphs.map(
    (latestPair, latestIdx) => {
      const snapIdx = mappingFromChunkSnap.latestToSnapIndex.get(latestIdx);

      // Case 1: Paragraph in latestParagraphs did not map to any paragraph in chunkSnapshotParagraphs
      // (e.g. English source text was edited in flight, a new paragraph was inserted in flight,
      // or duplicate English paragraphs shifted ambiguously after an insertion/deletion).
      if (snapIdx === undefined) {
        const trimmedBangla = (latestPair.banglaText ?? '').trim();
        const isMissing =
          Boolean(latestPair.missingTranslation) || trimmedBangla.length === 0;
        const preservedUnmapped: ParagraphPair = {
          ...latestPair,
          index: latestIdx,
        };
        if (isMissing) {
          preservedUnmapped.missingTranslation = true;
          missingParagraphIndices.push(latestIdx);
        } else {
          delete preservedUnmapped.missingTranslation;
        }
        rejectedInFlightEditParagraphIndices.push(latestIdx);
        return preservedUnmapped;
      }

      // Case 2: Paragraph maps unambiguously to a snapshot paragraph outside the active chunk bounds.
      // Preserve latestPair completely untouched.
      if (
        !chunk ||
        snapIdx < chunk.startParagraphIndex ||
        snapIdx > chunk.endParagraphIndex
      ) {
        return {
          ...latestPair,
          index: latestIdx,
        };
      }

      // Case 3: Paragraph maps to a slot inside the active chunk (`offset = snapIdx - chunk.startParagraphIndex`).
      const offset = snapIdx - chunk.startParagraphIndex;
      const snapPair = chunkSnapshotParagraphs[snapIdx];
      const chunkMeta = chunk.paragraphMeta?.[offset];

      const hasBreak =
        latestPair.sceneBreakAfter ??
        snapPair?.sceneBreakAfter ??
        chunkMeta?.sceneBreakAfter;
      const breakMarker =
        latestPair.sceneBreakMarker !== undefined
          ? latestPair.sceneBreakMarker
          : snapPair?.sceneBreakMarker !== undefined
            ? snapPair.sceneBreakMarker
            : chunkMeta?.sceneBreakMarker;

      const applySceneBreakMeta = (target: ParagraphPair): ParagraphPair => {
        if (hasBreak) {
          target.sceneBreakAfter = true;
          target.sceneBreakMarker = breakMarker ?? '';
        }
        return target;
      };

      // Guard 3a: Verify English source text alignment with `chunk.paragraphs[offset]`
      const expectedChunkEng = normalizeEnglishTerm(
        chunk.paragraphs?.[offset] ?? ''
      );
      const snapEng = normalizeEnglishTerm(snapPair?.englishText ?? '');
      const latestEng = normalizeEnglishTerm(latestPair.englishText ?? '');

      if (
        expectedChunkEng.length === 0 ||
        snapEng !== expectedChunkEng ||
        latestEng !== expectedChunkEng
      ) {
        const trimmedLatestBangla = (latestPair.banglaText ?? '').trim();
        const isMissing =
          Boolean(latestPair.missingTranslation) ||
          trimmedLatestBangla.length === 0;
        const preservedMismatch: ParagraphPair = applySceneBreakMeta({
          ...latestPair,
          index: latestIdx,
        });
        if (isMissing) {
          preservedMismatch.missingTranslation = true;
          missingParagraphIndices.push(latestIdx);
        } else {
          delete preservedMismatch.missingTranslation;
          lastNonEmptyBangla = trimmedLatestBangla;
        }
        preservedParagraphIndices.push(latestIdx);
        rejectedInFlightEditParagraphIndices.push(latestIdx);
        return preservedMismatch;
      }

      // Guard 3b: Check if the user modified, cleared, refined, or reverted this paragraph
      // either while the active chunk was in flight OR since Stage 3 began.
      const changedDuringChunkRequest =
        !mappingFromChunkSnap.unchangedLatestIndices.has(latestIdx) ||
        hasParagraphChangedBetweenSnapshots(snapPair, latestPair);

      let changedSinceStage3Start = false;
      if (mappingFromStage3Start && stage3StartParagraphs) {
        const startIdx = mappingFromStage3Start.latestToSnapIndex.get(latestIdx);
        if (
          startIdx === undefined ||
          !mappingFromStage3Start.unchangedLatestIndices.has(latestIdx) ||
          hasParagraphChangedBetweenSnapshots(
            stage3StartParagraphs[startIdx],
            latestPair
          )
        ) {
          changedSinceStage3Start = true;
        }
      }

      if (changedDuringChunkRequest || changedSinceStage3Start) {
        const trimmedLatestBangla = (latestPair.banglaText ?? '').trim();
        const isMissing =
          Boolean(latestPair.missingTranslation) ||
          trimmedLatestBangla.length === 0;
        const preservedEdited: ParagraphPair = applySceneBreakMeta({
          ...latestPair,
          index: latestIdx,
        });
        if (isMissing) {
          preservedEdited.missingTranslation = true;
          missingParagraphIndices.push(latestIdx);
        } else {
          delete preservedEdited.missingTranslation;
          lastNonEmptyBangla = trimmedLatestBangla;
        }
        preservedParagraphIndices.push(latestIdx);
        rejectedInFlightEditParagraphIndices.push(latestIdx);
        return preservedEdited;
      }

      // Guard 3c: In resume mode (`isResumeMode: true`), protect slots that already have a valid translation.
      const existingBanglaTrimmed = (latestPair.banglaText ?? '').trim();
      const hasValidExistingTranslation =
        !latestPair.missingTranslation &&
        existingBanglaTrimmed.length > 0 &&
        normalizeBanglaUnicode(existingBanglaTrimmed).length > 0;

      if (isResumeMode && hasValidExistingTranslation) {
        const preservedResume: ParagraphPair = applySceneBreakMeta({
          ...latestPair,
          index: latestIdx,
        });
        delete preservedResume.missingTranslation;
        lastNonEmptyBangla = existingBanglaTrimmed;
        preservedParagraphIndices.push(latestIdx);
        return preservedResume;
      }

      // Eligible slot: apply AI chunk translation if non-empty, or mark missing if empty/truncated.
      const rawCandidate = rawChunkOutput[offset];
      const candidateBangla =
        typeof rawCandidate === 'string' ? rawCandidate.trim() : '';

      if (
        candidateBangla.length === 0 ||
        normalizeBanglaUnicode(candidateBangla).length === 0
      ) {
        // AI output is empty or missing for this eligible slot:
        // preserve latest safe content and mark `missingTranslation: true`.
        const fallbackMissing: ParagraphPair = applySceneBreakMeta({
          ...latestPair,
          index: latestIdx,
          banglaText: latestPair.banglaText ?? '',
          missingTranslation: true,
        });
        missingParagraphIndices.push(latestIdx);
        return fallbackMissing;
      }

      const updatedPair: ParagraphPair = applySceneBreakMeta({
        index: latestIdx,
        englishText: latestPair.englishText,
        banglaText: candidateBangla,
      });

      if (
        existingBanglaTrimmed.length > 0 &&
        normalizeBanglaUnicode(existingBanglaTrimmed) !==
          normalizeBanglaUnicode(candidateBangla)
      ) {
        updatedPair.previousBanglaText = existingBanglaTrimmed;
      } else if (latestPair.previousBanglaText !== undefined) {
        updatedPair.previousBanglaText = latestPair.previousBanglaText;
      }

      // Keep refinement metadata only if translation text is unchanged;
      // clear refinement badge/rationale when replaced by a new Stage 3 translation.
      if (
        existingBanglaTrimmed.length > 0 &&
        normalizeBanglaUnicode(existingBanglaTrimmed) ===
          normalizeBanglaUnicode(candidateBangla)
      ) {
        if (latestPair.lastRefinementAction) {
          updatedPair.lastRefinementAction = latestPair.lastRefinementAction;
        }
        if (latestPair.refinementRationale) {
          updatedPair.refinementRationale = latestPair.refinementRationale;
        }
      }

      lastNonEmptyBangla = candidateBangla;
      appliedParagraphIndices.push(latestIdx);
      return updatedPair;
    }
  );

  // Check whether any active-chunk snapshot paragraph was deleted or unmapped in latestParagraphs
  let allActiveChunkSlotsMappedAndTranslated =
    Boolean(chunk) &&
    Array.isArray(chunk.paragraphs) &&
    chunk.paragraphs.length > 0;

  if (allActiveChunkSlotsMappedAndTranslated && chunk) {
    for (let offset = 0; offset < chunk.paragraphs.length; offset++) {
      const snapIdx = chunk.startParagraphIndex + offset;
      const mappedLatestIdx = mappingFromChunkSnap.snapToLatestIndex.get(snapIdx);
      if (mappedLatestIdx === undefined) {
        allActiveChunkSlotsMappedAndTranslated = false;
        break;
      }
      const pair = reconciledParagraphs[mappedLatestIdx];
      const expectedEng = normalizeEnglishTerm(chunk.paragraphs[offset] ?? '');
      const actualEng = normalizeEnglishTerm(pair?.englishText ?? '');
      const trimmedBangla = (pair?.banglaText ?? '').trim();
      if (
        !pair ||
        expectedEng.length === 0 ||
        actualEng !== expectedEng ||
        Boolean(pair.missingTranslation) ||
        trimmedBangla.length === 0 ||
        normalizeBanglaUnicode(trimmedBangla).length === 0
      ) {
        allActiveChunkSlotsMappedAndTranslated = false;
        break;
      }
    }
  }

  const chunkComplete =
    allActiveChunkSlotsMappedAndTranslated &&
    missingParagraphIndices.length === 0;

  const fullBanglaText =
    joinTranslatedParagraphPairsWithSceneBreaks(reconciledParagraphs);

  return {
    paragraphs: reconciledParagraphs,
    fullBanglaText,
    lastNonEmptyBangla,
    appliedParagraphIndices,
    preservedParagraphIndices,
    rejectedInFlightEditParagraphIndices,
    missingParagraphIndices,
    chunkComplete,
  };
}

export interface FinalizeStage3ChapterStateParams {
  stage3StartParagraphs?: ReadonlyArray<ParagraphPair> | null;
  latestParagraphs?: ReadonlyArray<ParagraphPair> | null;
  latestOriginalText?: string | null;
  maxWordsPerChunk?: number;
  contextWindow?: number;
  previousVerificationReport?: VerificationReport | null;
  wasVerificationCompleted?: boolean;
  latestGlossary?: ReadonlyArray<TerminologyMemoryItem> | null;
  checkedAt?: string;
}

export interface FinalizedStage3ChapterState {
  paragraphs: ParagraphPair[];
  translatedText: string;
  draftTranslatedText: string;
  chunkCount: number;
  completedChunks: number;
  missingIndices: number[];
  stageCompletedTranslation: boolean;
  verificationReport?: VerificationReport;
  stageCompletedVerification: boolean;
  status: ChapterStatus;
  chapterStatus: ChapterStatus;
}

/**
 * Helper D: Finalizes chapter state at the end of Stage 3 from the latest reconciled paragraphs.
 *
 * Guarantees:
 * - Never rebuilds from `stage3StartParagraphs` (`preStage3Pairs`).
 * - Preserves the latest English and Bangla paragraph content and scene breaks.
 * - Derives `translatedText` and `draftTranslatedText` from the final paragraph pairs.
 * - Recomputes `chunkCount` and `completedChunks` from the current manuscript and `maxWordsPerChunk`.
 * - Determines whether every current paragraph has a valid translation (`stageCompletedTranslation`).
 * - Reconciles `verificationReport` and `stageCompletedVerification` honestly via `reconcileVerificationReportAfterLocalEdit`.
 */
export function finalizeStage3ChapterState(
  params: FinalizeStage3ChapterStateParams
): FinalizedStage3ChapterState {
  const maxWordsPerChunk =
    typeof params?.maxWordsPerChunk === 'number' && params.maxWordsPerChunk > 0
      ? params.maxWordsPerChunk
      : 500;
  const contextWindow =
    typeof params?.contextWindow === 'number' && params.contextWindow >= 0
      ? params.contextWindow
      : 2;
  const rawLatestParagraphs = Array.isArray(params?.latestParagraphs)
    ? params.latestParagraphs
    : [];
  const hasExplicitOriginalText =
    params?.latestOriginalText !== undefined &&
    params?.latestOriginalText !== null;
  const rawLatestOriginalText = hasExplicitOriginalText
    ? String(params.latestOriginalText)
    : '';

  // If the manuscript is explicitly empty and there are no latest paragraphs, return a clean zero-chunk state.
  if (
    rawLatestParagraphs.length === 0 &&
    (!hasExplicitOriginalText || rawLatestOriginalText.trim().length === 0)
  ) {
    return {
      paragraphs: [],
      translatedText: '',
      draftTranslatedText: '',
      chunkCount: 0,
      completedChunks: 0,
      missingIndices: [],
      stageCompletedTranslation: false,
      verificationReport: undefined,
      stageCompletedVerification: false,
      status: 'pending',
      chapterStatus: 'pending',
    };
  }

  // Build finalParagraphs from latestParagraphs (or derive untranslated slots from latestOriginalText if latestParagraphs was empty)
  let baseParagraphs: ParagraphPair[];
  if (rawLatestParagraphs.length > 0) {
    baseParagraphs = rawLatestParagraphs.map((pair, idx) => {
      const trimmedBangla = (pair.banglaText ?? '').trim();
      const isMissing =
        Boolean(pair.missingTranslation) ||
        trimmedBangla.length === 0 ||
        normalizeBanglaUnicode(trimmedBangla).length === 0;
      const cloned: ParagraphPair = {
        ...pair,
        index: idx,
        englishText: pair.englishText ?? '',
        banglaText: pair.banglaText ?? '',
      };
      if (isMissing) {
        cloned.missingTranslation = true;
      } else {
        delete cloned.missingTranslation;
      }
      return cloned;
    });
  } else {
    const initialChunks = chunkTextByParagraphs(
      rawLatestOriginalText,
      maxWordsPerChunk,
      contextWindow
    );
    baseParagraphs = [];
    for (const ch of initialChunks) {
      for (let offset = 0; offset < ch.paragraphs.length; offset++) {
        const meta = ch.paragraphMeta?.[offset];
        const pair: ParagraphPair = {
          index: baseParagraphs.length,
          englishText: meta?.text ?? ch.paragraphs[offset],
          banglaText: '',
          missingTranslation: true,
        };
        if (meta?.sceneBreakAfter) {
          pair.sceneBreakAfter = true;
          pair.sceneBreakMarker = meta.sceneBreakMarker ?? '';
        }
        baseParagraphs.push(pair);
      }
    }
  }

  if (baseParagraphs.length === 0) {
    return {
      paragraphs: [],
      translatedText: '',
      draftTranslatedText: '',
      chunkCount: 0,
      completedChunks: 0,
      missingIndices: [],
      stageCompletedTranslation: false,
      verificationReport: undefined,
      stageCompletedVerification: false,
      status: 'pending',
      chapterStatus: 'pending',
    };
  }

  // Determine the effective English manuscript text for chunk boundary computation.
  // If `latestOriginalText` was provided and its parsed paragraphs align with `baseParagraphs`, use it;
  // otherwise derive from `baseParagraphs` so in-flight English edits in `latestParagraphs` are always respected.
  const reconstructedOriginalText = joinParagraphsWithSceneBreaks(
    baseParagraphs,
    {
      field: 'englishText',
      omitEmpty: false,
    }
  );

  let effectiveOriginalText = reconstructedOriginalText;
  if (hasExplicitOriginalText && rawLatestOriginalText.trim().length > 0) {
    const candidateChunks = chunkTextByParagraphs(
      rawLatestOriginalText,
      maxWordsPerChunk,
      contextWindow
    );
    const totalChunkParas = candidateChunks.reduce(
      (sum, c) => sum + c.paragraphs.length,
      0
    );
    let matchesLatestParagraphs = totalChunkParas === baseParagraphs.length;
    if (matchesLatestParagraphs) {
      for (const c of candidateChunks) {
        for (let offset = 0; offset < c.paragraphs.length; offset++) {
          const pIdx = c.startParagraphIndex + offset;
          if (
            normalizeEnglishTerm(c.paragraphs[offset] ?? '') !==
            normalizeEnglishTerm(baseParagraphs[pIdx]?.englishText ?? '')
          ) {
            matchesLatestParagraphs = false;
            break;
          }
        }
        if (!matchesLatestParagraphs) break;
      }
    }
    if (matchesLatestParagraphs) {
      effectiveOriginalText = rawLatestOriginalText;
    }
  }

  const executionPlan = planStage3ChunkExecution({
    originalText: effectiveOriginalText,
    paragraphs: baseParagraphs,
    maxWordsPerChunk,
    contextWindow,
  });

  const chunkCount = executionPlan.chunks.length;
  const completedChunks = executionPlan.completedChunkIndices.length;

  const missingIndices: number[] = [];
  for (let idx = 0; idx < baseParagraphs.length; idx++) {
    const p = baseParagraphs[idx];
    const trimmedBangla = (p.banglaText ?? '').trim();
    if (
      Boolean(p.missingTranslation) ||
      trimmedBangla.length === 0 ||
      normalizeBanglaUnicode(trimmedBangla).length === 0
    ) {
      missingIndices.push(idx);
    }
  }

  const stageCompletedTranslation =
    baseParagraphs.length > 0 &&
    chunkCount > 0 &&
    completedChunks === chunkCount &&
    missingIndices.length === 0;

  const translatedText =
    joinTranslatedParagraphPairsWithSceneBreaks(baseParagraphs);
  const draftTranslatedText = translatedText;

  // Check whether any paragraph changed compared to stage3StartParagraphs
  const stage3StartParagraphs = Array.isArray(params?.stage3StartParagraphs)
    ? params.stage3StartParagraphs
    : null;

  let anyParagraphChangedDuringStage3 = false;
  if (stage3StartParagraphs) {
    if (stage3StartParagraphs.length !== baseParagraphs.length) {
      anyParagraphChangedDuringStage3 = true;
    } else {
      for (let i = 0; i < baseParagraphs.length; i++) {
        const startPair = stage3StartParagraphs[i];
        const finalPair = baseParagraphs[i];
        if (
          !startPair ||
          normalizeEnglishTerm(startPair.englishText ?? '') !==
            normalizeEnglishTerm(finalPair.englishText ?? '') ||
          normalizeBanglaUnicode(startPair.banglaText ?? '') !==
            normalizeBanglaUnicode(finalPair.banglaText ?? '') ||
          Boolean(startPair.missingTranslation) !==
            Boolean(finalPair.missingTranslation)
        ) {
          anyParagraphChangedDuringStage3 = true;
          break;
        }
      }
    }
  }

  let reconciledVerificationReport: VerificationReport | undefined = undefined;
  if (params?.previousVerificationReport) {
    const baselineForVerification = stage3StartParagraphs
      ? [...stage3StartParagraphs]
      : [...baseParagraphs];
    const reconciled = reconcileVerificationReportAfterLocalEdit({
      previousReport: params.previousVerificationReport,
      previousParagraphs: baselineForVerification,
      latestParagraphs: baseParagraphs,
      latestGlossary: Array.isArray(params?.latestGlossary)
        ? [...params.latestGlossary]
        : [],
      checkedAt: params?.checkedAt,
    });
    if (reconciled) {
      if (anyParagraphChangedDuringStage3 || !stageCompletedTranslation) {
        reconciledVerificationReport = {
          ...reconciled,
          isComplete: false,
        };
      } else {
        reconciledVerificationReport = reconciled;
      }
    }
  }

  const stageCompletedVerification =
    Boolean(params?.wasVerificationCompleted) &&
    stageCompletedTranslation &&
    !anyParagraphChangedDuringStage3 &&
    Boolean(
      reconciledVerificationReport &&
        reconciledVerificationReport.isComplete !== false
    );

  const hasUnresolvedHighIssues = Boolean(
    reconciledVerificationReport?.issues?.some(
      (issue) => issue.severity === 'high' && !issue.resolved
    )
  );

  const chapterStatus: ChapterStatus =
    stageCompletedTranslation &&
    stageCompletedVerification &&
    !hasUnresolvedHighIssues
      ? 'completed'
      : 'needs_review';

  return {
    paragraphs: baseParagraphs,
    translatedText,
    draftTranslatedText,
    chunkCount,
    completedChunks,
    missingIndices,
    stageCompletedTranslation,
    verificationReport: reconciledVerificationReport,
    stageCompletedVerification,
    status: chapterStatus,
    chapterStatus,
  };
}

// ============================================================================
// MILESTONE 2B.8b — DETERMINISTIC NUMERICAL VERIFICATION
// ============================================================================

export type NumericalComparisonStatus =
  | 'no_mismatch'
  | 'confirmed_mismatch'
  | 'missing_number'
  | 'ambiguous';

export type NumericalFactKind =
  | 'cardinal'
  | 'ordinal'
  | 'age'
  | 'quantity'
  | 'address'
  | 'verbatim_literal'
  | 'fraction'
  | 'compound_measurement';

export interface VerbatimProtectedSpan {
  raw: string;
  startIndex: number;
  endIndex: number;
  kind: 'keyboard_mash' | 'alphanumeric_code' | 'url_or_handle';
}

export interface EnglishNumericalFact {
  rawText: string;
  numberText: string;
  value: number;
  kind: NumericalFactKind;
  isOrdinal: boolean;
  unitOrNoun?: string;
  start: number;
  end: number;
  wholeValue?: number;
  numeratorValue?: number;
  denominatorValue?: number;
  decimalDigits?: number[];
}

export interface BanglaNumericalToken {
  rawText: string;
  stemText: string;
  suffix: string;
  value: number;
  isOrdinal: boolean;
  isDigit: boolean;
  contextKind?: NumericalFactKind;
  start: number;
  end: number;
}

export interface NumericalVerificationFinding {
  id: string;
  paragraphIndex: number;
  displayParagraphNumber: number;
  status: NumericalComparisonStatus;
  kind: NumericalFactKind;
  expectedValue: number;
  detectedValue?: number;
  matchedEnglishText: string;
  expectedBangla: string;
  acceptedBanglaForms: string[];
  detectedBanglaText?: string;
  severity: 'high' | 'medium' | 'low';
  englishExcerpt: string;
  banglaExcerpt: string;
  description: string;
  editorialGuidance?: string;
  suggestedFix?: undefined;
  findingSignature: string;
}

export interface ParagraphNumericalLintResult {
  paragraphIndex: number;
  englishFacts: EnglishNumericalFact[];
  banglaTokens: BanglaNumericalToken[];
  comparisons: NumericalVerificationFinding[];
  findings: NumericalVerificationFinding[];
  confirmedMismatches: NumericalVerificationFinding[];
  missingNumbers: NumericalVerificationFinding[];
  ambiguousComparisons: NumericalVerificationFinding[];
  matchedComparisons: NumericalVerificationFinding[];
  issues: VerificationIssue[];
}

export interface ChapterNumericalLintResult {
  findings: NumericalVerificationFinding[];
  confirmedMismatches: NumericalVerificationFinding[];
  missingNumbers: NumericalVerificationFinding[];
  ambiguousComparisons: NumericalVerificationFinding[];
  matchedComparisons: NumericalVerificationFinding[];
  issues: VerificationIssue[];
  paragraphResults: ParagraphNumericalLintResult[];
  summary: {
    totalParagraphsChecked: number;
    confirmedMismatchCount: number;
    missingNumberCount: number;
    ambiguousComparisonCount: number;
    matchedComparisonCount: number;
  };
}

const ENGLISH_CARDINAL_UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const ENGLISH_CARDINAL_TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ENGLISH_ORDINAL_UNITS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
};

const ENGLISH_ORDINAL_TENS: Readonly<Record<string, number>> = {
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
  sixtieth: 60,
  seventieth: 70,
  eightieth: 80,
  ninetieth: 90,
  hundredth: 100,
};

export const ENGLISH_FRACTIONAL_DENOMINATOR_WORDS: Readonly<Record<string, number>> = {
  tenth: 10,
  tenths: 10,
  hundredth: 100,
  hundredths: 100,
  thousandth: 1000,
  thousandths: 1000,
  quarter: 4,
  quarters: 4,
  third: 3,
  thirds: 3,
  fifth: 5,
  fifths: 5,
  eighth: 8,
  eighths: 8,
  sixteenth: 16,
  sixteenths: 16,
};

const WHITELISTED_ALPHANUMERIC_PATTERNS: ReadonlyArray<RegExp> = [
  /^\d+(?:st|nd|rd|th)s?(?:-[A-Za-z]+)*$/i,
  /^\d{1,2}(?::\d{2})?(?:a\.?m\.?|p\.?m\.?|o'clock)$/i,
  /^\d{2,4}'?s$/i,
  /^(?:2D|3D|4D|2G|3G|4G|5G|6G|A0|A1|A2|A3|A4|A5|A6|B4|B5|MP3|MP4|PDF|H2O|CO2|V6|V8|B12|D3|K9|G7|G8|G20|COVID-19|COVID19)$/i,
  /^\d+(?:\.\d+)?-[a-z]{2,}(?:-[a-z]{2,})*$/,
  /^\d+(?:\.\d+)?(?:mm|cm|km|mg|kg|ml|lb|lbs|oz|ft|yd|in|hr|hrs|min|mins|sec|secs|mph|kph|kmh|hz|khz|mhz|ghz|kb|mb|gb|tb|px|pt|em|rem|deg|db|v|w|kv|kw|mw|mah|ah)%?$/i,
  /^(?:rs\.?|inr|usd|gbp|eur|tk|bdt|\$|£|₹|€)\d+(?:[.,]\d+)*$/i,
];

function isWhitelistedAlphanumericToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  if (/^[\d.,:%+-]+$/.test(trimmed)) return true;
  return WHITELISTED_ALPHANUMERIC_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
}

/**
 * Deterministically extracts non-prose verbatim literal spans from an English paragraph
 * on narrow structural signatures:
 * 1. `keyboard_mash`: >= 3 repeated punctuation/bracket/symbol characters adjacent to letters/digits
 *    (e.g., `]]]]]]77777ggggg`), or >= 3 identical consecutive digits and letters in a mixed token.
 * 2. `alphanumeric_code`: fused serial/license/model identifiers (e.g., `INV-2049-B`, `TL/4402/98`,
 *    `#ZX//90909-kk#`, `4444xYz99`).
 * 3. `url_or_handle`: explicit URLs, emails, `@handle` tokens.
 *
 * Explicitly whitelists standard ordinals (`1st`–`9th`), time expressions (`11am`, `7pm`),
 * decades (`1950s`), common tech/paper tokens (`3D`, `4G`, `5G`, `A4`, `MP3`, `PDF`),
 * and normal italicized English prose.
 */
export function extractVerbatimProtectedSpans(
  englishParagraph: string
): VerbatimProtectedSpan[] {
  const source = englishParagraph ?? '';
  if (!source.trim()) return [];

  const spans: VerbatimProtectedSpan[] = [];
  const chunkRegex = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = chunkRegex.exec(source)) !== null) {
    const rawChunk = match[0];
    const chunkStart = match.index;

    // Split on em-dashes / en-dashes so tokens embedded as `—*]]]]]]77777ggggg*—` are isolated cleanly
    const subChunkRegex = /[^—–]+/g;
    let subMatch: RegExpExecArray | null;
    while ((subMatch = subChunkRegex.exec(rawChunk)) !== null) {
      let token = subMatch[0];
      let localStart = chunkStart + subMatch.index;
      let localEnd = localStart + token.length;

      // Strip outer sentence punctuation and quotes (preserving `#`, `[`, `]`, `/`, `@`, etc.)
      while (token.length > 0 && /^["“”'‘’(),.;:!?]/.test(token)) {
        token = token.slice(1);
        localStart++;
      }
      while (token.length > 0 && /["“”'‘’(),.;:!?]$/.test(token)) {
        token = token.slice(0, -1);
        localEnd--;
      }

      // Strip single paired or outer markdown emphasis `*` or `_` (when not a >=3 symbol run)
      if (
        token.length >= 2 &&
        ((token.startsWith('*') &&
          token.endsWith('*') &&
          !/^\*{3,}/.test(token)) ||
          (token.startsWith('_') &&
            token.endsWith('_') &&
            !/^_{3,}/.test(token)))
      ) {
        token = token.slice(1, -1);
        localStart++;
        localEnd--;
      } else {
        if (token.startsWith('*') && !/^\*{3,}/.test(token)) {
          token = token.slice(1);
          localStart++;
        }
        if (token.endsWith('*') && !/\*{3,}$/.test(token)) {
          token = token.slice(0, -1);
          localEnd--;
        }
      }

      // Strip outer punctuation again in case it was inside `*...*`
      while (token.length > 0 && /^["“”'‘’(),.;:!?]/.test(token)) {
        token = token.slice(1);
        localStart++;
      }
      while (token.length > 0 && /["“”'‘’(),.;:!?]$/.test(token)) {
        token = token.slice(0, -1);
        localEnd--;
      }

      // Strip trailing English possessive `'s` or `’s`
      if (/(?:'s|’s)$/i.test(token) && token.length > 2) {
        token = token.slice(0, -2);
        localEnd -= 2;
      }

      if (token.length < 2) continue;
      if (isWhitelistedAlphanumericToken(token)) continue;

      // 1. URL, email, or @handle
      if (
        /^(?:https?:\/\/|www\.)\S+$/i.test(token) ||
        /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(token) ||
        /^@[A-Za-z0-9_.-]{2,}$/.test(token)
      ) {
        spans.push({
          raw: token,
          startIndex: localStart,
          endIndex: localEnd,
          kind: 'url_or_handle',
        });
        continue;
      }

      const hasLetter = /[A-Za-z]/.test(token);
      const hasDigit = /\d/.test(token);

      // 2. Keyboard-mash / symbol run:
      //    - >= 3 repeated punctuation/bracket/symbol characters adjacent to letters or digits (e.g., `]]]]]]77777ggggg`)
      //    - OR mixed letter+digit token with both >= 3 identical consecutive digits and >= 3 identical consecutive letters
      const hasSymbolRun =
        /(?:[\]\[\{\}\(\)<>~^|_+=#$%&*\\/!?-]){3,}/.test(token) &&
        (hasLetter || hasDigit);
      const hasRepeatedDigitAndLetterRun =
        hasLetter &&
        hasDigit &&
        /(\d)\1{2,}/.test(token) &&
        /([A-Za-z])\1{2,}/.test(token);

      if (hasSymbolRun || hasRepeatedDigitAndLetterRun) {
        spans.push({
          raw: token,
          startIndex: localStart,
          endIndex: localEnd,
          kind: 'keyboard_mash',
        });
        continue;
      }

      // 3. Alphanumeric identifier code:
      //    Contains both letters and digits in a non-whitelisted token:
      //    - Fused letter-digit transitions (`4444xYz99`), OR
      //    - Code delimiters `/`, `#`, `_` joining letters and digits (`TL/4402/98`, `#ZX//90909-kk#`), OR
      //    - Hyphenated serial/license/model code with an uppercase/code prefix or single-letter segment (`INV-2049-B`)
      if (hasLetter && hasDigit) {
        const hasFusedLetterDigit = /[A-Za-z]\d|\d[A-Za-z]/.test(token);
        const hasCodeDelimiter = /[\/#_:]/.test(token);
        const hasSerialHyphenStructure =
          token.includes('-') &&
          (/^[A-Za-z0-9]*[A-Z][A-Za-z0-9]*-/.test(token) ||
            /-[A-Za-z]$/.test(token) ||
            /-\d+-/.test(token));

        if (
          hasFusedLetterDigit ||
          hasCodeDelimiter ||
          hasSerialHyphenStructure
        ) {
          spans.push({
            raw: token,
            startIndex: localStart,
            endIndex: localEnd,
            kind: 'alphanumeric_code',
          });
        }
      }
    }
  }

  return spans;
}

interface BanglaCanonicalNumberInfo {
  value: number;
  cardinalForms: string[];
  ordinalForms: string[];
  banglaDigits: string;
}

const BANGLA_DIGIT_CHARS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

function toBanglaDigits(n: number): string {
  return String(Math.max(0, Math.trunc(n)))
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0) - 48;
      return code >= 0 && code <= 9 ? BANGLA_DIGIT_CHARS[code] : ch;
    })
    .join('');
}

const RAW_BANGLA_NUMBER_TABLE: ReadonlyArray<{
  value: number;
  cardinals: string[];
  ordinals?: string[];
}> = [
  { value: 0, cardinals: ['শূন্য'] },
  { value: 1, cardinals: ['এক'], ordinals: ['প্রথম', 'পয়লা', 'পহেলা'] },
  { value: 2, cardinals: ['দুই', 'দু', 'দুটো', 'দুটি'], ordinals: ['দ্বিতীয়', 'দোসরা'] },
  { value: 3, cardinals: ['তিন'], ordinals: ['তৃতীয়', 'তেসরা'] },
  { value: 4, cardinals: ['চার', 'চারি'], ordinals: ['চতুর্থ', 'চৌঠা'] },
  { value: 5, cardinals: ['পাঁচ', 'পাচ'], ordinals: ['পঞ্চম', 'পাঁচই'] },
  { value: 6, cardinals: ['ছয়'], ordinals: ['ষষ্ঠ', 'ছয়ই'] },
  { value: 7, cardinals: ['সাত'], ordinals: ['সপ্তম', 'সাতই'] },
  { value: 8, cardinals: ['আট'], ordinals: ['অষ্টম', 'আটই'] },
  { value: 9, cardinals: ['নয়'], ordinals: ['নবম', 'নয়ই'] },
  { value: 10, cardinals: ['দশ'], ordinals: ['দশম', 'দশই'] },
  { value: 11, cardinals: ['এগারো', 'এগার'], ordinals: ['একাদশ', 'এগারোই'] },
  { value: 12, cardinals: ['বারো'], ordinals: ['দ্বাদশ', 'বারোই'] },
  { value: 13, cardinals: ['তেরো', 'তের'], ordinals: ['ত্রয়োদশ', 'তেরোই'] },
  { value: 14, cardinals: ['চৌদ্দ'], ordinals: ['চতুর্দশ', 'চৌদ্দই'] },
  { value: 15, cardinals: ['পনেরো', 'পনের', 'পনর'], ordinals: ['পঞ্চদশ', 'পনেরোই'] },
  { value: 16, cardinals: ['ষোলো', 'ষোল'], ordinals: ['ষোড়শ', 'ষোলোই'] },
  { value: 17, cardinals: ['সতেরো', 'সতের'], ordinals: ['সপ্তদশ', 'সতেরোই'] },
  { value: 18, cardinals: ['আঠারো', 'আঠার'], ordinals: ['অষ্টাদশ', 'আঠারোই'] },
  { value: 19, cardinals: ['উনিশ'], ordinals: ['ঊনবিংশ', 'উনবিংশ', 'উনিশে'] },
  { value: 20, cardinals: ['বিশ', 'কুড়ি'], ordinals: ['বিংশ', 'বিশে'] },
  { value: 21, cardinals: ['একুশ'], ordinals: ['একুশে', 'একবিংশ'] },
  { value: 22, cardinals: ['বাইশ'], ordinals: ['বাইশে', 'দ্বাবিংশ'] },
  { value: 23, cardinals: ['তেইশ'], ordinals: ['তেইশে', 'ত্রয়োবিংশ'] },
  { value: 24, cardinals: ['চব্বিশ'], ordinals: ['চব্বিশে', 'চতুর্বিংশ'] },
  { value: 25, cardinals: ['পঁচিশ', 'পচিশ'], ordinals: ['পঁচিশে', 'পঞ্চবিংশ'] },
  { value: 26, cardinals: ['ছাব্বিশ'], ordinals: ['ছাব্বিশে', 'ষড়বিংশ'] },
  { value: 27, cardinals: ['সাতাশ', 'সাতাইশ'], ordinals: ['সাতাশে', 'সাতাইশে', 'সপ্তবিংশ'] },
  { value: 28, cardinals: ['আটাশ', 'আঠাশ'], ordinals: ['আটাশে', 'আঠাশে', 'অষ্টাবিংশ'] },
  { value: 29, cardinals: ['ঊনত্রিশ', 'উনত্রিশ'], ordinals: ['ঊনত্রিশে', 'উনত্রিশে'] },
  { value: 30, cardinals: ['ত্রিশ', 'তিরিশ'], ordinals: ['ত্রিশে', 'তিরিশে', 'ত্রিংশ'] },
  { value: 31, cardinals: ['একত্রিশ'], ordinals: ['একত্রিশে'] },
  { value: 32, cardinals: ['বত্রিশ'], ordinals: ['বত্রিশে'] },
  { value: 33, cardinals: ['তেত্রিশ'], ordinals: ['তেত্রিশে'] },
  { value: 34, cardinals: ['চৌত্রিশ'] },
  { value: 35, cardinals: ['পঁয়ত্রিশ', 'পয়ত্রিশ'] },
  { value: 36, cardinals: ['ছত্রিশ'] },
  { value: 37, cardinals: ['সাঁইত্রিশ', 'সাইত্রিশ'] },
  { value: 38, cardinals: ['আটত্রিশ'] },
  { value: 39, cardinals: ['ঊনচল্লিশ', 'উনচল্লিশ'] },
  { value: 40, cardinals: ['চল্লিশ'], ordinals: ['চত্বারিংশ'] },
  { value: 41, cardinals: ['একচল্লিশ'] },
  { value: 42, cardinals: ['বিয়াল্লিশ'] },
  { value: 43, cardinals: ['তেতাল্লিশ', 'তেঁতাল্লিশ'] },
  { value: 44, cardinals: ['চুয়াল্লিশ'] },
  { value: 45, cardinals: ['পঁয়তাল্লিশ', 'পয়তাল্লিশ'] },
  { value: 46, cardinals: ['ছেচল্লিশ'] },
  { value: 47, cardinals: ['সাতচল্লিশ'] },
  { value: 48, cardinals: ['আটচল্লিশ'] },
  { value: 49, cardinals: ['ঊনপঞ্চাশ', 'উনপঞ্চাশ'] },
  { value: 50, cardinals: ['পঞ্চাশ'], ordinals: ['পঞ্চাশৎ'] },
  { value: 51, cardinals: ['একান্ন'] },
  { value: 52, cardinals: ['বায়ান্ন', 'বাহান্ন'] },
  { value: 53, cardinals: ['তিপ্পান্ন'] },
  { value: 54, cardinals: ['চুয়ান্ন'] },
  { value: 55, cardinals: ['পঞ্চান্ন'] },
  { value: 56, cardinals: ['ছাপ্পান্ন'] },
  { value: 57, cardinals: ['সাতান্ন'] },
  { value: 58, cardinals: ['আটান্ন'] },
  { value: 59, cardinals: ['ঊনষাট', 'উনষাট'] },
  { value: 60, cardinals: ['ষাট'] },
  { value: 61, cardinals: ['একষট্টি'] },
  { value: 62, cardinals: ['বাষট্টি'] },
  { value: 63, cardinals: ['তেষট্টি'] },
  { value: 64, cardinals: ['চৌষট্টি'] },
  { value: 65, cardinals: ['পঁয়ষট্টি', 'পয়ষট্টি'] },
  { value: 66, cardinals: ['ছেষট্টি'] },
  { value: 67, cardinals: ['সাতষট্টি'] },
  { value: 68, cardinals: ['আটষট্টি'] },
  { value: 69, cardinals: ['ঊনসত্তর', 'উনসত্তর'] },
  { value: 70, cardinals: ['সত্তর'] },
  { value: 71, cardinals: ['একাত্তর'] },
  { value: 72, cardinals: ['বাহাত্তর'] },
  { value: 73, cardinals: ['তেহাত্তর', 'তিয়াত্তর'] },
  { value: 74, cardinals: ['চুয়াত্তর'] },
  { value: 75, cardinals: ['পঁচাত্তর', 'পচাত্তর'] },
  { value: 76, cardinals: ['ছিয়াত্তর'] },
  { value: 77, cardinals: ['সাতাত্তর'] },
  { value: 78, cardinals: ['আটাত্তর'] },
  { value: 79, cardinals: ['ঊনআশি', 'উনআশি'] },
  { value: 80, cardinals: ['আশি'] },
  { value: 81, cardinals: ['একাশি'] },
  { value: 82, cardinals: ['বিরাশি', 'বেরাশি'] },
  { value: 83, cardinals: ['তিরাশি'] },
  { value: 84, cardinals: ['চুরাশি'] },
  { value: 85, cardinals: ['পঁচাশি', 'পচাশি'] },
  { value: 86, cardinals: ['ছিয়াশি'] },
  { value: 87, cardinals: ['সাতাশি'] },
  { value: 88, cardinals: ['আটাশি', 'অষ্টাশি'] },
  { value: 89, cardinals: ['ঊননব্বই', 'উননব্বই'] },
  { value: 90, cardinals: ['নব্বই'] },
  { value: 91, cardinals: ['একানব্বই'] },
  { value: 92, cardinals: ['বিরানব্বই', 'বেরানব্বই'] },
  { value: 93, cardinals: ['তিরানব্বই'] },
  { value: 94, cardinals: ['চুরানব্বই'] },
  { value: 95, cardinals: ['পঁচানব্বই', 'পচানব্বই'] },
  { value: 96, cardinals: ['ছিয়ানব্বই'] },
  { value: 97, cardinals: ['সাতানব্বই'] },
  { value: 98, cardinals: ['আটানব্বই'] },
  { value: 99, cardinals: ['নিরানব্বই'] },
  { value: 100, cardinals: ['একশো', 'একশ', 'শত'], ordinals: ['শততম'] },
  { value: 1000, cardinals: ['হাজার', 'সহস্র'], ordinals: ['সহস্রতম'] },
];

const BANGLA_CANONICAL_BY_VALUE = new Map<number, BanglaCanonicalNumberInfo>();

interface BanglaStemLookupEntry {
  stem: string;
  value: number;
  isOrdinalStem: boolean;
}

const BANGLA_STEM_LOOKUP: BanglaStemLookupEntry[] = [];

for (const row of RAW_BANGLA_NUMBER_TABLE) {
  const normCardinals = row.cardinals.map((c) => normalizeBanglaUnicode(c));
  const normOrdinals = (row.ordinals ?? []).map((o) => normalizeBanglaUnicode(o));
  const banglaDigits = toBanglaDigits(row.value);

  BANGLA_CANONICAL_BY_VALUE.set(row.value, {
    value: row.value,
    cardinalForms: normCardinals,
    ordinalForms: normOrdinals,
    banglaDigits,
  });

  for (const c of normCardinals) {
    BANGLA_STEM_LOOKUP.push({
      stem: c,
      value: row.value,
      isOrdinalStem: false,
    });
  }
  for (const o of normOrdinals) {
    if (!normCardinals.includes(o)) {
      BANGLA_STEM_LOOKUP.push({
        stem: o,
        value: row.value,
        isOrdinalStem: true,
      });
    }
  }
}

// Sort strictly by descending stem length so longer stems (e.g. "সাতাশি" [87], "সাতাইশ" [27],
// "আটত্রিশ" [38], "আটাশি" [88], "সাতাশ" [27]) are tested before shorter prefixes ("সাত" [7], "আট" [8]).
BANGLA_STEM_LOOKUP.sort(
  (a, b) => b.stem.length - a.stem.length || a.value - b.value
);

/**
 * Closed whitelist of grammatical suffixes, classifiers, ordinal suffixes, and case markers
 * that may validly attach to a Bangla numeral stem or digit token.
 *
 * CRITICAL DISTINCTION:
 * Dependent vowel sign `ি` (\u09BF) and `িটি` (\u09BF\u099F\u09BF) are NEVER valid suffixes.
 * Therefore:
 * - "সাতাশি" (87) and "সাতাশিটি" (87 + টি) match ONLY stem "সাতাশি" (87) with suffix "" or "টি",
 *   and can NEVER match stem "সাতাশ" (27) because "ি" and "িটি" are rejected as suffixes.
 * - "সাতাশটি" (27 + টি) matches ONLY stem "সাতাশ" (27) with suffix "টি".
 * - "আটাশি" (88) and "আটাশিটি" (88 + টি) match ONLY stem "আটাশি" (88), never "আটাশ" (28).
 */
const EXTRA_BANGLA_NUMERICAL_SUFFIXES: ReadonlySet<string> = new Set<string>(
  [
    'টে',
    'টের',
    'টেয়',
    'টেতে',
    'টেও',
    'টেই',
    'টেকে',
    'টো',
    'টোর',
    'টোয়',
    'টোতে',
    'টোও',
    'টোই',
    'টোকে',
    'জন',
    'জনের',
    'জনকে',
    'জনে',
    'জনেই',
    'জনও',
    'জনই',
    'বার',
    'বারে',
    'বারের',
    'বারও',
    'বারই',
    'তম',
    'তমের',
    'তমটি',
    'তমটা',
    'ই', // Independent vowel ই (\u0987, e.g. চৌদ্দই, সতেরোই), distinct from dependent vowel sign ি (\u09BF)
    'ও',
    'শে',
    'লা',
    'রা',
    'ঠা',
    'ম',
    'য়',
    'র্থ',
    'ষ্ঠ',
    'শ',
    'তলা',
    'তলায়',
    'তলার',
    'গুণ',
  ].map((s) => normalizeBanglaUnicode(s))
);

const ORDINAL_INDICATING_SUFFIXES: ReadonlySet<string> = new Set<string>(
  ['তম', 'তমের', 'তমটি', 'তমটা', 'ই', 'শে', 'লা', 'রা', 'ঠা', 'র্থ', 'ষ্ঠ'].map((s) =>
    normalizeBanglaUnicode(s)
  )
);

const DEFINITE_CLASSIFIER_SUFFIXES: ReadonlySet<string> = new Set<string>(
  [
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
    'টে',
    'টের',
    'টেয়',
    'টেতে',
    'টেও',
    'টেই',
    'টেকে',
    'টো',
    'টোর',
    'টোয়',
    'টোতে',
    'টোও',
    'টোই',
    'টোকে',
    'খানা',
    'খানি',
    'খানার',
    'খানির',
    'জন',
    'জনের',
    'জনকে',
    'জনে',
    'বার',
    'তম',
    'তলা',
    'গুণ',
  ].map((s) => normalizeBanglaUnicode(s))
);

export function isAllowedBanglaNumericalSuffix(
  stem: string,
  suffix: string,
  isDigitStem = false
): boolean {
  const normSuffix = normalizeBanglaUnicode(suffix);
  if (!normSuffix) return true;

  // Never allow dependent vowel sign ি (\u09BF) at the start of a suffix:
  // prevents "সাতাশ" (27) from matching "সাতাশি" (87) or "সাতাশিটি" (87),
  // and prevents "আটাশ" (28) from matching "আটাশি" (88) or "আটাশিটি" (88).
  if (normSuffix.charCodeAt(0) === 0x09bf) {
    return false;
  }

  if (EXTRA_BANGLA_NUMERICAL_SUFFIXES.has(normSuffix)) {
    return true;
  }

  if (isDigitStem) {
    return (
      UNIVERSAL_BANGLA_NOMINAL_SUFFIXES.has(normSuffix) ||
      CONSONANT_STEM_ONLY_SUFFIXES.has(normSuffix) ||
      VOWEL_STEM_ONLY_SUFFIXES.has(normSuffix)
    );
  }

  return isAllowedBanglaNominalSuffix(stem, normSuffix);
}

/**
 * Normalizes a single Bangla word/digit token into its underlying numerical value,
 * base stem, and grammatical classifier/case/ordinal suffix.
 * Returns `null` if the token is not a valid Bangla number construction.
 */
export function normalizeBanglaNumberToken(rawToken: string): {
  value: number;
  stemText: string;
  suffix: string;
  isOrdinal: boolean;
  isDigit: boolean;
} | null {
  const cleaned = normalizeBanglaUnicode(rawToken).replace(
    /^[^\u0980-\u09FF0-9]+|[^\u0980-\u09FF0-9]+$/g,
    ''
  );
  if (!cleaned) return null;

  // 1. Check leading Bangla or Arabic digits (e.g. "৮৮", "৮৮টি", "88", "১৪ই", "১১তম")
  const digitMatch = /^([\u09E6-\u09EF0-9]+)(.*)$/.exec(cleaned);
  if (digitMatch) {
    const digitPart = digitMatch[1];
    const remSuffix = digitMatch[2] ?? '';
    if (!isAllowedBanglaNumericalSuffix(digitPart, remSuffix, true)) {
      return null;
    }
    const asciiDigits = digitPart
      .split('')
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 0x09e6 && code <= 0x09ef) {
          return String(code - 0x09e6);
        }
        return ch;
      })
      .join('');
    const parsedVal = Number.parseInt(asciiDigits, 10);
    if (!Number.isFinite(parsedVal) || parsedVal < 0) {
      return null;
    }
    return {
      value: parsedVal,
      stemText: digitPart,
      suffix: remSuffix,
      isOrdinal: ORDINAL_INDICATING_SUFFIXES.has(remSuffix),
      isDigit: true,
    };
  }

  // 2. Check lexical Bangla number stems (ordered longest-first)
  for (const entry of BANGLA_STEM_LOOKUP) {
    if (!cleaned.startsWith(entry.stem)) continue;
    const remSuffix = cleaned.slice(entry.stem.length);

    // Short stem "দু" (2) is only valid as exact "দু" (when followed by a unit) or with a definite classifier ("দুটো", "দুটি", "দুজন", "দুখানা", "দুবার")
    if (entry.stem === 'দু' && remSuffix.length > 0 && !DEFINITE_CLASSIFIER_SUFFIXES.has(remSuffix)) {
      continue;
    }

    if (!isAllowedBanglaNumericalSuffix(entry.stem, remSuffix, false)) {
      continue;
    }

    return {
      value: entry.value,
      stemText: entry.stem,
      suffix: remSuffix,
      isOrdinal:
        entry.isOrdinalStem || ORDINAL_INDICATING_SUFFIXES.has(remSuffix),
      isDigit: false,
    };
  }

  return null;
}

/**
 * Returns the canonical Bangla primary representation, accepted lexical/digit alternatives,
 * and Bangla digit string for a given integer value and contextual fact kind.
 */
export function getCanonicalBanglaNumberForms(
  value: number,
  kind: NumericalFactKind = 'cardinal'
): {
  primary: string;
  alternatives: string[];
  banglaDigits: string;
} {
  const banglaDigits = toBanglaDigits(value);
  const info = BANGLA_CANONICAL_BY_VALUE.get(value);
  if (!info) {
    return {
      primary: banglaDigits,
      alternatives: [String(value)],
      banglaDigits,
    };
  }

  const basePrimary = info.cardinalForms[0] ?? banglaDigits;
  if (kind === 'address') {
    const primary = `${basePrimary} নম্বর`;
    const alternatives = deduplicateBanglaList(
      [
        ...info.cardinalForms.map((c) => `${c} নম্বর`),
        `${banglaDigits} নম্বর`,
        ...info.cardinalForms,
        ...info.ordinalForms,
        banglaDigits,
      ],
      new Set([primary])
    );
    return { primary, alternatives, banglaDigits };
  }

  if (kind === 'ordinal') {
    const ordPrimary = info.ordinalForms[0] ?? `${basePrimary} নম্বর`;
    const alternatives = deduplicateBanglaList(
      [
        ...info.ordinalForms,
        ...info.cardinalForms.map((c) => `${c} নম্বর`),
        ...info.cardinalForms.map((c) => `${c}তম`),
        `${banglaDigits}তম`,
        `${banglaDigits} নম্বর`,
        ...info.cardinalForms,
        banglaDigits,
      ],
      new Set([ordPrimary])
    );
    return { primary: ordPrimary, alternatives, banglaDigits };
  }

  const alternatives = deduplicateBanglaList(
    [...info.cardinalForms.slice(1), ...info.ordinalForms, banglaDigits],
    new Set([basePrimary])
  );
  return {
    primary: basePrimary,
    alternatives,
    banglaDigits,
  };
}

const BANGLA_ADDRESS_MARKERS: ReadonlySet<string> = new Set(
  ['নম্বর', 'নম্বরে', 'নম্বরের', 'নম্বরটি', 'নম্বরটা', 'নং'].map((s) =>
    normalizeBanglaUnicode(s)
  )
);

const BANGLA_AGE_OR_YEAR_MARKERS: ReadonlySet<string> = new Set(
  [
    'বছর',
    'বছরে',
    'বছরের',
    'বছরটা',
    'বছরটি',
    'বৎসর',
    'বৎসরে',
    'বৎসরের',
    'বয়স',
    'বয়সে',
    'বয়সের',
    'বয়সী',
  ].map((s) => normalizeBanglaUnicode(s))
);

const BANGLA_DATE_OR_ORDINAL_MARKERS: ReadonlySet<string> = new Set(
  [
    'তারিখ',
    'তারিখে',
    'তারিখেই',
    'তারিখের',
    'তারিখটা',
    'তারিখটি',
    'তারিখটায়',
  ].map((s) => normalizeBanglaUnicode(s))
);

const BANGLA_MEASUREMENT_OR_TIME_UNITS: ReadonlySet<string> = new Set(
  [
    'দিন',
    'দিনে',
    'দিনের',
    'মাস',
    'মাসে',
    'মাসের',
    'সপ্তাহ',
    'সপ্তাহে',
    'সপ্তাহের',
    'ঘণ্টা',
    'ঘণ্টায়',
    'ঘণ্টার',
    'মিনিট',
    'মিনিটে',
    'মিনিটের',
    'সেকেন্ড',
    'মাইল',
    'ফুট',
    'হাত',
    'গজ',
    'টাকা',
    'পয়সা',
    'বার',
    'পা',
    'কদম',
    'পৃষ্ঠা',
    'পাতা',
    'অধ্যায়',
    'নোট',
    'চিঠি',
    'বাড়ি',
    'ঘর',
    'কক্ষ',
    'জানালা',
    'দরজা',
  ].map((s) => normalizeBanglaUnicode(s))
);

/**
 * Words that commonly precede Bangla negative copula "নয়" ("is not") when it is NOT the number 9.
 */
const BANGLA_NEGATIVE_COPULA_PRECEDERS: ReadonlySet<string> = new Set(
  [
    'তা',
    'এটা',
    'সেটা',
    'ওটা',
    'কিছু',
    'কিছুই',
    'মোটেও',
    'মোটেই',
    'কখনো',
    'কখনোই',
    'আসলে',
    'শুধু',
    'কেবল',
    'যথেষ্ট',
    'সম্ভব',
    'সহজ',
    'কঠিন',
    'সত্য',
    'সত্যি',
    'মিথ্যা',
    'মিথ্যে',
    'ঠিক',
    'ভুল',
    'উচিত',
    'দরকার',
    'প্রয়োজন',
    'কম',
    'বেশি',
    'একা',
    'নতুন',
    'পুরোনো',
    'ভালো',
    'খারাপ',
    'স্বাভাবিক',
    'অস্বাভাবিক',
  ].map((s) => normalizeBanglaUnicode(s))
);

const BANGLA_IDIOMATIC_NUMBER_PAIRS: ReadonlySet<string> = new Set(
  [
    'সাত পাঁচ',
    'নয় ছয়',
    'উনিশ বিশ',
    'এক আধ',
    'একটু আধটু',
    'আট ঘাট',
    'এক এক',
    'একে একে',
    'দু এক',
    'দুই এক',
    'দু চার',
    'দুই চার',
    'চার পাঁচ',
    'পাঁচ সাত',
    'সাত আট',
    'দশ বারো',
  ].map((s) => normalizeBanglaUnicode(s))
);

/**
 * Extracts explicit Bangla numerical tokens from a Bangla paragraph,
 * normalizing classifiers/suffixes while filtering out non-numerical homographs
 * (such as clause-final negative copula "নয়" = "is not") and idiomatic reduplications.
 */
export function parseBanglaNumericalTokens(
  banglaText: string
): BanglaNumericalToken[] {
  const normalizedText = normalizeBanglaUnicode(banglaText ?? '');
  if (!normalizedText) return [];

  const rawWords: Array<{
    word: string;
    start: number;
    end: number;
    followingChars: string;
  }> = [];

  const wordRegex = /[\u0980-\u09FF0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(normalizedText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    rawWords.push({
      word: match[0],
      start,
      end,
      followingChars: normalizedText.slice(end, Math.min(normalizedText.length, end + 4)),
    });
  }

  const tokens: BanglaNumericalToken[] = [];
  let idx = 0;

  while (idx < rawWords.length) {
    const current = rawWords[idx];
    const next = idx + 1 < rawWords.length ? rawWords[idx + 1] : undefined;
    const prev = idx > 0 ? rawWords[idx - 1] : undefined;

    // 1. Skip idiomatic Bangla number pairs (e.g., "সাত-পাঁচ", "নয়-ছয়", "উনিশ-বিশ", "একে একে")
    if (next) {
      const pairStr = `${current.word} ${next.word}`;
      const normCurr = normalizeBanglaNumberToken(current.word);
      const normNext = normalizeBanglaNumberToken(next.word);
      const betweenText = normalizedText.slice(current.end, next.start);
      const isImmediatelyAdjacentOrHyphenated = /^[\s-]*$/.test(betweenText);

      if (
        isImmediatelyAdjacentOrHyphenated &&
        (BANGLA_IDIOMATIC_NUMBER_PAIRS.has(pairStr) ||
          (normCurr &&
            normNext &&
            BANGLA_IDIOMATIC_NUMBER_PAIRS.has(
              `${normCurr.stemText} ${normNext.stemText}`
            )))
      ) {
        idx += 2;
        continue;
      }
    }

    const parsed = normalizeBanglaNumberToken(current.word);
    if (!parsed) {
      idx++;
      continue;
    }

    // 2. Filter out non-numerical Bangla homograph "নয়" ("is not" negative copula)
    if (!parsed.isDigit && parsed.stemText === 'নয়' && parsed.suffix === '') {
      const nextWord = next?.word ?? '';
      const prevWord = prev?.word ?? '';
      const isFollowedByClauseBoundary = /^[।,;.?!—–)\]"'”’\s]*$/.test(
        current.followingChars
      ) && (current.followingChars.includes('।') ||
            current.followingChars.includes(',') ||
            current.followingChars.includes(';') ||
            current.followingChars.includes('?') ||
            current.followingChars.includes('!') ||
            current.followingChars.includes('—') ||
            next === undefined);

      const isFollowedByNumericContext =
        BANGLA_ADDRESS_MARKERS.has(nextWord) ||
        BANGLA_AGE_OR_YEAR_MARKERS.has(nextWord) ||
        BANGLA_MEASUREMENT_OR_TIME_UNITS.has(nextWord) ||
        nextWord === 'শত' ||
        nextWord === 'হাজার' ||
        prevWord === 'দশমিক';

      if (!isFollowedByNumericContext) {
        if (
          isFollowedByClauseBoundary ||
          BANGLA_NEGATIVE_COPULA_PRECEDERS.has(prevWord)
        ) {
          idx++;
          continue;
        }
      }
    }

    // 3. Filter out bare "দু" when not followed by a unit/classifier
    if (!parsed.isDigit && parsed.stemText === 'দু' && parsed.suffix === '') {
      const nextWord = next?.word ?? '';
      const isFollowedByUnit =
        BANGLA_ADDRESS_MARKERS.has(nextWord) ||
        BANGLA_AGE_OR_YEAR_MARKERS.has(nextWord) ||
        BANGLA_MEASUREMENT_OR_TIME_UNITS.has(nextWord) ||
        nextWord === 'শত' ||
        nextWord === 'হাজার';
      if (!isFollowedByUnit) {
        idx++;
        continue;
      }
    }

    // 4. Combine multiplier compounds like "এক শত" (100), "দুই শত" (200), "এক হাজার" (1000)
    if (
      parsed.value >= 1 &&
      parsed.value <= 9 &&
      parsed.suffix === '' &&
      next &&
      /^[\s-]*$/.test(normalizedText.slice(current.end, next.start))
    ) {
      const nextParsed = normalizeBanglaNumberToken(next.word);
      if (
        nextParsed &&
        (nextParsed.value === 100 || nextParsed.value === 1000)
      ) {
        const combinedVal = parsed.value * nextParsed.value;
        const afterNext =
          idx + 2 < rawWords.length ? rawWords[idx + 2] : undefined;
        let contextKind: NumericalFactKind = nextParsed.isOrdinal
          ? 'ordinal'
          : 'cardinal';
        let endOffset = next.end;
        if (
          afterNext &&
          /^[\s-]*$/.test(normalizedText.slice(next.end, afterNext.start))
        ) {
          if (BANGLA_ADDRESS_MARKERS.has(afterNext.word)) {
            contextKind = 'address';
            endOffset = afterNext.end;
            idx += 3;
          } else if (BANGLA_AGE_OR_YEAR_MARKERS.has(afterNext.word)) {
            contextKind = 'age';
            endOffset = afterNext.end;
            idx += 3;
          } else {
            idx += 2;
          }
        } else {
          idx += 2;
        }

        tokens.push({
          rawText: normalizedText.slice(current.start, endOffset),
          stemText: `${parsed.stemText} ${nextParsed.stemText}`,
          suffix: nextParsed.suffix,
          value: combinedVal,
          isOrdinal: nextParsed.isOrdinal || contextKind === 'address',
          isDigit: parsed.isDigit || nextParsed.isDigit,
          contextKind,
          start: current.start,
          end: endOffset,
        });
        continue;
      }
    }

    // 5. Inspect immediately following word for address ("নম্বর"/"নং") or age ("বছর"/"বয়স") context
    let contextKind: NumericalFactKind = parsed.isOrdinal
      ? 'ordinal'
      : DEFINITE_CLASSIFIER_SUFFIXES.has(parsed.suffix)
        ? 'quantity'
        : 'cardinal';
    let tokenEnd = current.end;
    let isOrdinal = parsed.isOrdinal;

    if (
      next &&
      /^[\s-]*$/.test(normalizedText.slice(current.end, next.start))
    ) {
      if (BANGLA_ADDRESS_MARKERS.has(next.word)) {
        contextKind = 'address';
        isOrdinal = true;
        tokenEnd = next.end;
        idx += 2;
        tokens.push({
          rawText: normalizedText.slice(current.start, tokenEnd),
          stemText: parsed.stemText,
          suffix: parsed.suffix,
          value: parsed.value,
          isOrdinal,
          isDigit: parsed.isDigit,
          contextKind,
          start: current.start,
          end: tokenEnd,
        });
        continue;
      }

      if (BANGLA_AGE_OR_YEAR_MARKERS.has(next.word)) {
        contextKind = 'age';
        tokenEnd = next.end;
        idx += 2;
        tokens.push({
          rawText: normalizedText.slice(current.start, tokenEnd),
          stemText: parsed.stemText,
          suffix: parsed.suffix,
          value: parsed.value,
          isOrdinal,
          isDigit: parsed.isDigit,
          contextKind,
          start: current.start,
          end: tokenEnd,
        });
        continue;
      }

      if (BANGLA_DATE_OR_ORDINAL_MARKERS.has(next.word)) {
        contextKind = 'ordinal';
        isOrdinal = true;
        tokenEnd = next.end;
        idx += 2;
        tokens.push({
          rawText: normalizedText.slice(current.start, tokenEnd),
          stemText: parsed.stemText,
          suffix: parsed.suffix,
          value: parsed.value,
          isOrdinal,
          isDigit: parsed.isDigit,
          contextKind,
          start: current.start,
          end: tokenEnd,
        });
        continue;
      }

      if (contextKind === 'cardinal' && BANGLA_MEASUREMENT_OR_TIME_UNITS.has(next.word)) {
        contextKind = 'quantity';
      }
    }

    tokens.push({
      rawText: normalizedText.slice(current.start, tokenEnd),
      stemText: parsed.stemText,
      suffix: parsed.suffix,
      value: parsed.value,
      isOrdinal,
      isDigit: parsed.isDigit,
      contextKind,
      start: current.start,
      end: tokenEnd,
    });
    idx++;
  }

  return tokens;
}

const ENGLISH_ADDRESS_PREFIX_WORDS = new Set([
  'number',
  'no',
  'no.',
  'room',
  'house',
  'flat',
  'apartment',
  'ward',
  'platform',
  'gate',
  'dock',
  'pier',
  'berth',
]);

const ENGLISH_NON_NOUN_FOLLOWERS = new Set([
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'for',
  'of',
  'in',
  'on',
  'at',
  'to',
  'from',
  'by',
  'with',
  'without',
  'into',
  'onto',
  'upon',
  'over',
  'under',
  'above',
  'below',
  'between',
  'among',
  'through',
  'during',
  'before',
  'after',
  'since',
  'until',
  'while',
  'where',
  'when',
  'who',
  'whom',
  'whose',
  'which',
  'that',
  'this',
  'these',
  'those',
  'is',
  'was',
  'were',
  'are',
  'be',
  'been',
  'being',
  'had',
  'has',
  'have',
  'did',
  'do',
  'does',
  'would',
  'could',
  'should',
  'might',
  'must',
  'can',
  'will',
  'shall',
  'may',
  'not',
  'never',
  'always',
  'often',
  'still',
  'already',
  'even',
  'only',
  'just',
  'very',
  'too',
  'as',
  'than',
  'if',
  'though',
  'although',
  'because',
  'unless',
  'he',
  'she',
  'it',
  'they',
  'we',
  'you',
  'i',
  'him',
  'her',
  'them',
  'us',
  'his',
  'their',
  'our',
  'your',
  'my',
  'the',
  'a',
  'an',
]);

const ENGLISH_IDIOM_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:no|some|any|every)\s+one\b/gi,
  /\bone\s+(?:another|by\s+one|of\s+the|of\s+them|of\s+his|of\s+her|of\s+their|of\s+our|of\s+us|of\s+you|of\s+these|of\s+those|or\s+two|day|morning|evening|night|afternoon|winter|summer|spring|autumn|moment|instant|thing|way|side|hand)\b/gi,
  /\b(?:this|that|which|another|each|either|neither|only|certain)\s+one\b/gi,
  /\bthe\s+one\s+(?:who|that|which|with|in|on|at|by|from)\b/gi,
  /\b(?:two|three|four|five|six)\s+or\s+(?:three|four|five|six|seven|eight)\b/gi,
  /\bat\s+sixes\s+and\s+sevens\b/gi,
  /\bon\s+cloud\s+nine\b/gi,
  /\bdressed\s+to\s+the\s+nines\b/gi,
  /\bnine\s+(?:lives|times\s+out\s+of\s+ten)\b/gi,
  /\bten\s+to\s+one\b/gi,
  /\bninety[-\s]nine\s+times\s+out\s+of\s+a\s+hundred\b/gi,
  /\b(?:a|one)\s+(?:hundred|thousand|million)\s+times\b/gi,
  /\b(?:hundreds|thousands|millions|dozens)\s+of\b/gi,
  /\b(?:a\s+couple(?:\s+of)?|a\s+few)\b/gi,
  /\b(?:in\s+two\s+minds|two\s+cents|two[-\s]faced|two\s+by\s+two|all\s+in\s+one|on\s+all\s+fours)\b/gi,
  /\b(?:a|an)\s+[a-z]+\s+or\s+two\b/gi,
  /\b(?:first|second)\s+[-\s]?(?:hand|nature|wind|thought|thoughts|sight|rate|class|string|cousin|childhood)\b/gi,
  /\b(?:sixth\s+sense|seventh\s+heaven|third\s+degree|eleventh\s+hour|four\s+corners|three\s+cheers|twenty[-\s]four\s+seven|24\/7)\b/gi,
  /\b(?:wait|just|for|in|after|within|split|every|another|one|a)\s+(?:a\s+|one\s+|split\s+)?seconds?\b/gi,
  /\b(?:quarter|half)\s+(?:of\s+an\s+hour|an\s+hour|past|to)\b/gi,
  /\b\w+[-\s]odd\b/gi,
];

function parseSingleOrCompoundEnglishNumberTokens(
  tokens: ReadonlyArray<{ text: string; lower: string; start: number; end: number }>,
  startIdx: number,
  sourceText: string
): {
  value: number;
  isOrdinal: boolean;
  consumedTokenCount: number;
  start: number;
  end: number;
  numberText: string;
} | null {
  const first = tokens[startIdx];
  if (!first) return null;

  const w1 = first.lower;

  // 1. Check Arabic digits (cardinal or ordinal: "88", "88th", "11", "9th")
  const digitOrdMatch = /^(\d+)(st|nd|rd|th)?$/i.exec(w1);
  if (digitOrdMatch) {
    const val = Number.parseInt(digitOrdMatch[1], 10);
    if (!Number.isFinite(val) || val < 0) return null;
    return {
      value: val,
      isOrdinal: Boolean(digitOrdMatch[2]),
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }

  // 2. Check hyphenated compound inside a single token (e.g. "eighty-eight", "eighty-seven", "twenty-seven", "eighty-eighth", "eighty-eight-year-old")
  if (w1.includes('-')) {
    const parts = w1.split('-');
    if (parts.length >= 2) {
      const p0 = parts[0];
      const p1 = parts[1];
      const tensVal = ENGLISH_CARDINAL_TENS[p0];
      if (tensVal !== undefined) {
        if (ENGLISH_CARDINAL_UNITS[p1] !== undefined && ENGLISH_CARDINAL_UNITS[p1] >= 1 && ENGLISH_CARDINAL_UNITS[p1] <= 9) {
          const val = tensVal + ENGLISH_CARDINAL_UNITS[p1];
          // If hyphenated with "-year-old" or "-years-old", slice only the number part so caller sees "years"
          const numPartText = `${first.text.split('-')[0]}-${first.text.split('-')[1]}`;
          const numEnd = first.start + numPartText.length;
          return {
            value: val,
            isOrdinal: false,
            consumedTokenCount: 1,
            start: first.start,
            end: numEnd,
            numberText: sourceText.slice(first.start, numEnd),
          };
        }
        if (ENGLISH_ORDINAL_UNITS[p1] !== undefined && ENGLISH_ORDINAL_UNITS[p1] >= 1 && ENGLISH_ORDINAL_UNITS[p1] <= 9) {
          const val = tensVal + ENGLISH_ORDINAL_UNITS[p1];
          const numPartText = `${first.text.split('-')[0]}-${first.text.split('-')[1]}`;
          const numEnd = first.start + numPartText.length;
          return {
            value: val,
            isOrdinal: true,
            consumedTokenCount: 1,
            start: first.start,
            end: numEnd,
            numberText: sourceText.slice(first.start, numEnd),
          };
        }
      }
    }
  }

  // 3. Check space-separated compound tens + unit (e.g. "eighty eight", "eighty eighth", "twenty seven")
  if (ENGLISH_CARDINAL_TENS[w1] !== undefined) {
    const tensVal = ENGLISH_CARDINAL_TENS[w1];
    const second = tokens[startIdx + 1];
    if (
      second &&
      /^\s+$/.test(sourceText.slice(first.end, second.start))
    ) {
      const w2 = second.lower;
      if (ENGLISH_CARDINAL_UNITS[w2] !== undefined && ENGLISH_CARDINAL_UNITS[w2] >= 1 && ENGLISH_CARDINAL_UNITS[w2] <= 9) {
        return {
          value: tensVal + ENGLISH_CARDINAL_UNITS[w2],
          isOrdinal: false,
          consumedTokenCount: 2,
          start: first.start,
          end: second.end,
          numberText: sourceText.slice(first.start, second.end),
        };
      }
      if (ENGLISH_ORDINAL_UNITS[w2] !== undefined && ENGLISH_ORDINAL_UNITS[w2] >= 1 && ENGLISH_ORDINAL_UNITS[w2] <= 9) {
        return {
          value: tensVal + ENGLISH_ORDINAL_UNITS[w2],
          isOrdinal: true,
          consumedTokenCount: 2,
          start: first.start,
          end: second.end,
          numberText: sourceText.slice(first.start, second.end),
        };
      }
    }

    return {
      value: tensVal,
      isOrdinal: false,
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }

  // 4. Check unit + hundred/thousand (e.g., "one hundred", "two hundred", "one thousand")
  if (ENGLISH_CARDINAL_UNITS[w1] !== undefined) {
    const unitVal = ENGLISH_CARDINAL_UNITS[w1];
    const second = tokens[startIdx + 1];
    if (
      unitVal >= 1 &&
      unitVal <= 9 &&
      second &&
      /^\s+$/.test(sourceText.slice(first.end, second.start)) &&
      (second.lower === 'hundred' || second.lower === 'thousand')
    ) {
      const mult = second.lower === 'hundred' ? 100 : 1000;
      return {
        value: unitVal * mult,
        isOrdinal: false,
        consumedTokenCount: 2,
        start: first.start,
        end: second.end,
        numberText: sourceText.slice(first.start, second.end),
      };
    }

    return {
      value: unitVal,
      isOrdinal: false,
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }

  // 5. Check single-word ordinals ("first" .. "nineteenth", "twentieth" .. "hundredth")
  if (ENGLISH_ORDINAL_UNITS[w1] !== undefined) {
    return {
      value: ENGLISH_ORDINAL_UNITS[w1],
      isOrdinal: true,
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }
  if (ENGLISH_ORDINAL_TENS[w1] !== undefined) {
    return {
      value: ENGLISH_ORDINAL_TENS[w1],
      isOrdinal: true,
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }

  // 6. Standalone "hundred" or "thousand" when preceded by "a" ("a hundred notes")
  if (w1 === 'hundred' || w1 === 'thousand') {
    return {
      value: w1 === 'hundred' ? 100 : 1000,
      isOrdinal: false,
      consumedTokenCount: 1,
      start: first.start,
      end: first.end,
      numberText: first.text,
    };
  }

  return null;
}

/**
 * Conservatively extracts explicit, comparable numerical facts from an English paragraph,
 * classifying each as `'address'`, `'age'`, `'ordinal'`, `'quantity'`, or `'cardinal'`,
 * while excluding idiomatic, figurative, indefinite, and non-numerical homograph uses.
 */
export function parseEnglishNumericalExpressions(
  englishText: string
): EnglishNumericalFact[] {
  const source = normalizeEnglishTerm(englishText ?? '');
  if (!source) return [];

  // 1. Identify excluded idiomatic/non-numerical character spans
  const excludedSpans: Array<{ start: number; end: number }> = [];
  for (const pattern of ENGLISH_IDIOM_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(source)) !== null) {
      excludedSpans.push({
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }

  const isSpanExcluded = (start: number, end: number): boolean =>
    excludedSpans.some((ex) => start < ex.end && end > ex.start);

  // 1b. Extract verbatim protected spans (`keyboard_mash`, `alphanumeric_code`, `url_or_handle`)
  //     and emit embedded digit runs as `kind: 'verbatim_literal'` facts.
  const verbatimSpans = extractVerbatimProtectedSpans(source);
  const verbatimFacts: EnglishNumericalFact[] = [];
  for (const vSpan of verbatimSpans) {
    const digitRegex = /\d+/g;
    let dm: RegExpExecArray | null;
    while ((dm = digitRegex.exec(vSpan.raw)) !== null) {
      const dStart = vSpan.startIndex + dm.index;
      const dEnd = dStart + dm[0].length;
      if (!isSpanExcluded(dStart, dEnd)) {
        verbatimFacts.push({
          rawText: vSpan.raw,
          numberText: dm[0],
          value: Number(dm[0]),
          kind: 'verbatim_literal',
          isOrdinal: false,
          unitOrNoun: vSpan.raw,
          start: dStart,
          end: dEnd,
        });
      }
    }
  }

  // 1c. Identify numeric decimal expressions (e.g., "7.92 inches") outside verbatim/excluded spans
  const decimalSpans: Array<{ start: number; end: number }> = [];
  const decimalFacts: EnglishNumericalFact[] = [];
  const decimalRegex = /\b(\d+)\.(\d+)(?:\s+([A-Za-z]+))?/g;
  let decMatch: RegExpExecArray | null;
  while ((decMatch = decimalRegex.exec(source)) !== null) {
    const decStart = decMatch.index;
    const numEnd = decStart + decMatch[1].length + 1 + decMatch[2].length;
    const fullEnd = decMatch.index + decMatch[0].length;
    const overlapsVerbatim = verbatimSpans.some(
      (vs) => decStart < vs.endIndex && fullEnd > vs.startIndex
    );
    if (overlapsVerbatim || isSpanExcluded(decStart, fullEnd)) continue;

    const wholeVal = Number(decMatch[1]);
    const fracStr = decMatch[2];
    const numVal = Number(fracStr);
    const denomVal = Math.pow(10, fracStr.length);
    const decDigits = fracStr.split('').map((c) => Number(c));
    const unitWord = decMatch[3];
    const hasUnit =
      unitWord &&
      !ENGLISH_NON_NOUN_FOLLOWERS.has(unitWord.toLowerCase());

    decimalSpans.push({
      start: decStart,
      end: hasUnit ? fullEnd : numEnd,
    });
    decimalFacts.push({
      rawText: source.slice(decStart, hasUnit ? fullEnd : numEnd),
      numberText: `${decMatch[1]}.${decMatch[2]}`,
      value: Number(`${decMatch[1]}.${decMatch[2]}`),
      kind: 'compound_measurement',
      isOrdinal: false,
      ...(hasUnit ? { unitOrNoun: unitWord } : {}),
      start: decStart,
      end: hasUnit ? fullEnd : numEnd,
      wholeValue: wholeVal,
      numeratorValue: numVal,
      denominatorValue: denomVal,
      decimalDigits: decDigits,
    });
  }

  const isInVerbatimOrDecimalSpan = (start: number, end: number): boolean =>
    verbatimSpans.some((vs) => start < vs.endIndex && end > vs.startIndex) ||
    decimalSpans.some((ds) => start < ds.end && end > ds.start);

  // 2. Tokenize English words (preserving `.` on `No.` when followed by space + number,
  //    and splitting hyphenated clock times / number pairs like "four-ten" or "six-thirty"
  //    where the first part is a unit 1..12 and the second part is also a cardinal number)
  const rawTokens: Array<{ text: string; lower: string; start: number; end: number }> = [];
  const tokenRegex = /\b(?:No\.|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRegex.exec(source)) !== null) {
    const tokenStart = tm.index;
    const tokenEnd = tm.index + tm[0].length;
    if (isInVerbatimOrDecimalSpan(tokenStart, tokenEnd)) {
      continue;
    }
    const tokenText = tm[0];
    const tokenLower = tokenText.toLowerCase();
    const parts = tokenText.split('-');
    if (parts.length === 2) {
      const p0Lower = parts[0].toLowerCase();
      const p1Lower = parts[1].toLowerCase();
      const p0Unit = ENGLISH_CARDINAL_UNITS[p0Lower];
      const p1IsNumber =
        ENGLISH_CARDINAL_UNITS[p1Lower] !== undefined ||
        ENGLISH_CARDINAL_TENS[p1Lower] !== undefined;
      if (p0Unit !== undefined && p0Unit >= 1 && p0Unit <= 12 && p1IsNumber) {
        const p0End = tm.index + parts[0].length;
        const p1Start = p0End + 1;
        rawTokens.push({
          text: parts[0],
          lower: p0Lower,
          start: tm.index,
          end: p0End,
        });
        rawTokens.push({
          text: parts[1],
          lower: p1Lower,
          start: p1Start,
          end: tm.index + tokenText.length,
        });
        continue;
      }
    }
    rawTokens.push({
      text: tokenText,
      lower: tokenLower,
      start: tm.index,
      end: tm.index + tokenText.length,
    });
  }

  const computeDecimalDigitsForFraction = (
    numeratorVal: number,
    denominatorVal: number
  ): number[] | undefined => {
    if (
      denominatorVal === 10 ||
      denominatorVal === 100 ||
      denominatorVal === 1000
    ) {
      const width = Math.round(Math.log10(denominatorVal));
      return String(numeratorVal)
        .padStart(width, '0')
        .split('')
        .map((c) => Number(c));
    }
    const ratioStr = String(Number((numeratorVal / denominatorVal).toFixed(4)));
    const dotIdx = ratioStr.indexOf('.');
    if (dotIdx !== -1) {
      return ratioStr
        .slice(dotIdx + 1)
        .split('')
        .map((c) => Number(c));
    }
    return undefined;
  };

  const facts: EnglishNumericalFact[] = [...verbatimFacts, ...decimalFacts];
  let i = 0;

  while (i < rawTokens.length) {
    const tok = rawTokens[i];

    // Check if current token is an address/identifier prefix ("number eleven", "No. 9", "room 11")
    if (
      ENGLISH_ADDRESS_PREFIX_WORDS.has(tok.lower) &&
      i + 1 < rawTokens.length &&
      /^\s+$/.test(source.slice(tok.end, rawTokens[i + 1].start))
    ) {
      const numMatch = parseSingleOrCompoundEnglishNumberTokens(
        rawTokens,
        i + 1,
        source
      );
      if (numMatch && !isSpanExcluded(tok.start, numMatch.end)) {
        facts.push({
          rawText: source.slice(tok.start, numMatch.end),
          numberText: numMatch.numberText,
          value: numMatch.value,
          kind: 'address',
          isOrdinal: numMatch.isOrdinal,
          unitOrNoun: tok.text,
          start: tok.start,
          end: numMatch.end,
        });
        i += 1 + numMatch.consumedTokenCount;
        continue;
      }
    }

    // Check if current token is an age prefix ("aged 88", "aged eighty-eight")
    if (
      (tok.lower === 'aged' || tok.lower === 'age') &&
      i + 1 < rawTokens.length &&
      /^\s+$/.test(source.slice(tok.end, rawTokens[i + 1].start))
    ) {
      const numMatch = parseSingleOrCompoundEnglishNumberTokens(
        rawTokens,
        i + 1,
        source
      );
      if (numMatch && !isSpanExcluded(tok.start, numMatch.end)) {
        facts.push({
          rawText: source.slice(tok.start, numMatch.end),
          numberText: numMatch.numberText,
          value: numMatch.value,
          kind: 'age',
          isOrdinal: false,
          unitOrNoun: tok.text,
          start: tok.start,
          end: numMatch.end,
        });
        i += 1 + numMatch.consumedTokenCount;
        continue;
      }
    }

    const numMatch = parseSingleOrCompoundEnglishNumberTokens(
      rawTokens,
      i,
      source
    );
    if (!numMatch) {
      i++;
      continue;
    }

    if (isSpanExcluded(numMatch.start, numMatch.end)) {
      i += numMatch.consumedTokenCount;
      continue;
    }

    const nextTokenIdx = i + numMatch.consumedTokenCount;
    const nextTok = rawTokens[nextTokenIdx];
    const prevTok = i > 0 ? rawTokens[i - 1] : undefined;

    // Pattern F1: Compound unit + fractional denominator
    // `[Cardinal A] [Unit] and [Cardinal B] [Fractional Denominator]`
    // e.g., "seven inches and ninety-two hundredths", "four grains and thirty-five thousandths"
    if (
      !numMatch.isOrdinal &&
      nextTok &&
      /^\s+$/.test(source.slice(numMatch.end, nextTok.start)) &&
      /^[a-z]+$/i.test(nextTok.text) &&
      !ENGLISH_NON_NOUN_FOLLOWERS.has(nextTok.lower)
    ) {
      const andTok = rawTokens[nextTokenIdx + 1];
      if (
        andTok &&
        andTok.lower === 'and' &&
        /^\s+$/.test(source.slice(nextTok.end, andTok.start)) &&
        nextTokenIdx + 2 < rawTokens.length &&
        /^\s+$/.test(source.slice(andTok.end, rawTokens[nextTokenIdx + 2].start))
      ) {
        const fracNumMatch = parseSingleOrCompoundEnglishNumberTokens(
          rawTokens,
          nextTokenIdx + 2,
          source
        );
        if (fracNumMatch && !fracNumMatch.isOrdinal) {
          const denomIdx = nextTokenIdx + 2 + fracNumMatch.consumedTokenCount;
          const denomTok = rawTokens[denomIdx];
          const denomVal = denomTok
            ? ENGLISH_FRACTIONAL_DENOMINATOR_WORDS[denomTok.lower]
            : undefined;
          if (
            denomTok &&
            denomVal !== undefined &&
            /^[\s-]+$/.test(source.slice(fracNumMatch.end, denomTok.start))
          ) {
            const compoundVal = Number(
              (numMatch.value + fracNumMatch.value / denomVal).toFixed(6)
            );
            facts.push({
              rawText: source.slice(numMatch.start, denomTok.end),
              numberText: `${numMatch.numberText} and ${fracNumMatch.numberText} ${denomTok.text}`,
              value: compoundVal,
              kind: 'compound_measurement',
              isOrdinal: false,
              unitOrNoun: nextTok.text,
              start: numMatch.start,
              end: denomTok.end,
              wholeValue: numMatch.value,
              numeratorValue: fracNumMatch.value,
              denominatorValue: denomVal,
              decimalDigits: computeDecimalDigitsForFraction(
                fracNumMatch.value,
                denomVal
              ),
            });
            i = denomIdx + 1;
            continue;
          }
        }
      }
    }

    // Pattern F2: Standalone fractional expression
    // `[Cardinal B] [Fractional Denominator] (of a/an/the [Unit])?`
    // e.g., "ninety-two hundredths of an inch", "three eighths of a dram", "six tenths of a millimetre"
    if (
      !numMatch.isOrdinal &&
      nextTok &&
      /^[\s-]+$/.test(source.slice(numMatch.end, nextTok.start)) &&
      ENGLISH_FRACTIONAL_DENOMINATOR_WORDS[nextTok.lower] !== undefined
    ) {
      const denomVal = ENGLISH_FRACTIONAL_DENOMINATOR_WORDS[nextTok.lower];
      let endIdx = nextTokenIdx + 1;
      let endPos = nextTok.end;
      let unitStr: string | undefined;

      const ofTok = rawTokens[nextTokenIdx + 1];
      const artTok = rawTokens[nextTokenIdx + 2];
      const unitCandidateTok = rawTokens[nextTokenIdx + 3];
      if (
        ofTok &&
        ofTok.lower === 'of' &&
        /^\s+$/.test(source.slice(nextTok.end, ofTok.start)) &&
        artTok &&
        (artTok.lower === 'a' ||
          artTok.lower === 'an' ||
          artTok.lower === 'the' ||
          artTok.lower === 'one') &&
        /^\s+$/.test(source.slice(ofTok.end, artTok.start)) &&
        unitCandidateTok &&
        /^[a-z]+$/i.test(unitCandidateTok.text) &&
        /^\s+$/.test(source.slice(artTok.end, unitCandidateTok.start))
      ) {
        endIdx = nextTokenIdx + 4;
        endPos = unitCandidateTok.end;
        unitStr = unitCandidateTok.text;
      }

      const fracVal = Number((numMatch.value / denomVal).toFixed(6));
      facts.push({
        rawText: source.slice(numMatch.start, endPos),
        numberText: `${numMatch.numberText} ${nextTok.text}`,
        value: fracVal,
        kind: 'fraction',
        isOrdinal: false,
        ...(unitStr ? { unitOrNoun: unitStr } : {}),
        start: numMatch.start,
        end: endPos,
        wholeValue: 0,
        numeratorValue: numMatch.value,
        denominatorValue: denomVal,
        decimalDigits: computeDecimalDigitsForFraction(
          numMatch.value,
          denomVal
        ),
      });
      i = endIdx;
      continue;
    }

    // Guard on bare "one" (value === 1, non-ordinal, not part of compound like "one hundred"):
    // Only treat bare "one" as an explicit numerical fact when followed by "year(s) old" or "o'clock"
    // or in an explicit paragraph label ("Paragraph one"), never as a generic determiner/pronoun ("one umbrella", "for one").
    if (
      numMatch.value === 1 &&
      !numMatch.isOrdinal &&
      numMatch.numberText.toLowerCase() === 'one'
    ) {
      const followedByYearOldOrClock =
        nextTok &&
        /^[\s-]+$/.test(source.slice(numMatch.end, nextTok.start)) &&
        (nextTok.lower === 'year' ||
          nextTok.lower === 'years' ||
          nextTok.lower === "o'clock");
      const precededByLabel =
        prevTok &&
        /^\s+$/.test(source.slice(prevTok.end, numMatch.start)) &&
        (prevTok.lower === 'paragraph' ||
          prevTok.lower === 'chapter' ||
          prevTok.lower === 'page' ||
          prevTok.lower === 'struck');

      if (!followedByYearOldOrClock && !precededByLabel) {
        i += numMatch.consumedTokenCount;
        continue;
      }
    }

    // Guard on "second" used as a noun ("every second", "the last second")
    if (numMatch.isOrdinal && numMatch.numberText.toLowerCase() === 'second') {
      const nextIsPunctOrTime =
        !nextTok ||
        !/^\s+$/.test(source.slice(numMatch.end, nextTok.start)) ||
        nextTok.lower === 'later' ||
        nextTok.lower === 'passed' ||
        nextTok.lower === 'ago' ||
        nextTok.lower === 'before' ||
        nextTok.lower === 'after';
      const prevIsTimeDeterminer =
        prevTok &&
        /^\s+$/.test(source.slice(prevTok.end, numMatch.start)) &&
        (prevTok.lower === 'last' ||
          prevTok.lower === 'final' ||
          prevTok.lower === 'next' ||
          prevTok.lower === 'very' ||
          prevTok.lower === 'half');
      if (nextIsPunctOrTime && prevIsTimeDeterminer) {
        i += numMatch.consumedTokenCount;
        continue;
      }
    }

    // Check if hyphenated token itself had "-year-old" or "-years-old" suffix (e.g. "eighty-eight-year-old")
    if (
      tok.lower.endsWith('-year-old') ||
      tok.lower.endsWith('-years-old')
    ) {
      facts.push({
        rawText: tok.text,
        numberText: numMatch.numberText,
        value: numMatch.value,
        kind: 'age',
        isOrdinal: false,
        unitOrNoun: 'year-old',
        start: tok.start,
        end: tok.end,
      });
      i += numMatch.consumedTokenCount;
      continue;
    }

    // Check following token(s) for "years [old]" -> kind: 'age'
    if (
      nextTok &&
      /^[\s-]+$/.test(source.slice(numMatch.end, nextTok.start)) &&
      (nextTok.lower === 'year' ||
        nextTok.lower === 'years' ||
        nextTok.lower === 'year-old' ||
        nextTok.lower === 'years-old')
    ) {
      const afterYears = rawTokens[nextTokenIdx + 1];
      const hasOld =
        afterYears &&
        /^\s+$/.test(source.slice(nextTok.end, afterYears.start)) &&
        afterYears.lower === 'old';
      const endPos = hasOld ? afterYears.end : nextTok.end;
      const unitStr = hasOld ? `${nextTok.text} ${afterYears.text}` : nextTok.text;

      facts.push({
        rawText: source.slice(numMatch.start, endPos),
        numberText: numMatch.numberText,
        value: numMatch.value,
        kind: 'age',
        isOrdinal: false,
        unitOrNoun: unitStr,
        start: numMatch.start,
        end: endPos,
      });
      i = nextTokenIdx + (hasOld ? 2 : 1);
      continue;
    }

    // If ordinal ("ninth", "eleventh", "eighty-eighth", "14th")
    if (numMatch.isOrdinal) {
      facts.push({
        rawText: numMatch.numberText,
        numberText: numMatch.numberText,
        value: numMatch.value,
        kind: 'ordinal',
        isOrdinal: true,
        start: numMatch.start,
        end: numMatch.end,
      });
      i += numMatch.consumedTokenCount;
      continue;
    }

    // Check if followed by a counted noun ("eighty-seven notes", "eleven houses")
    if (
      nextTok &&
      /^\s+$/.test(source.slice(numMatch.end, nextTok.start)) &&
      /^[a-z]+$/i.test(nextTok.text) &&
      !ENGLISH_NON_NOUN_FOLLOWERS.has(nextTok.lower) &&
      ENGLISH_CARDINAL_UNITS[nextTok.lower] === undefined &&
      ENGLISH_CARDINAL_TENS[nextTok.lower] === undefined &&
      ENGLISH_ORDINAL_UNITS[nextTok.lower] === undefined &&
      ENGLISH_ORDINAL_TENS[nextTok.lower] === undefined
    ) {
      facts.push({
        rawText: source.slice(numMatch.start, nextTok.end),
        numberText: numMatch.numberText,
        value: numMatch.value,
        kind: 'quantity',
        isOrdinal: false,
        unitOrNoun: nextTok.text,
        start: numMatch.start,
        end: nextTok.end,
      });
      i = nextTokenIdx + 1;
      continue;
    }

    // Standalone cardinal number
    facts.push({
      rawText: numMatch.numberText,
      numberText: numMatch.numberText,
      value: numMatch.value,
      kind: 'cardinal',
      isOrdinal: false,
      start: numMatch.start,
      end: numMatch.end,
    });
    i += numMatch.consumedTokenCount;
  }

  facts.sort((a, b) => a.start - b.start);
  return facts;
}

/**
 * Computes a deterministic identity signature for a numerical verification finding.
 * Prefixed with `deterministic_lint::numerical::` so it is clearly distinguished from
 * glossary terminology findings (`deterministic_lint::<termId>::...`) and AI Stage 5 issues.
 */
export function computeNumericalFindingSignature(
  finding: Pick<
    NumericalVerificationFinding,
    'kind' | 'expectedValue' | 'detectedValue' | 'expectedBangla' | 'detectedBanglaText'
  >
): string {
  const expectedBn = normalizeBanglaUnicode(finding.expectedBangla ?? '');
  const detectedBn = normalizeBanglaUnicode(finding.detectedBanglaText ?? '');
  return `deterministic_lint::numerical::${finding.kind}::${finding.expectedValue}::${finding.detectedValue ?? 'none'}::${expectedBn}::${detectedBn}`;
}

/**
 * Converts a confirmed `NumericalVerificationFinding` into a standard `VerificationIssue`
 * compatible with Stage 5 verification reports.
 * Uses `source: 'deterministic_lint'`, `type: 'changed_meaning'`, and `termId: 'numerical:<kind>:<expectedValue>'`
 * so numerical findings are cleanly distinguished from glossary `terminology` issues without altering `lib/types.ts`.
 * `suggestedFix` is always `undefined` so translations are never automatically overwritten.
 */
export function numericalFindingToVerificationIssue(
  finding: NumericalVerificationFinding
): VerificationIssue {
  const guidanceSuffix =
    finding.editorialGuidance && !finding.description.includes(finding.editorialGuidance)
      ? ` ${finding.editorialGuidance}`
      : '';

  return {
    id: finding.id,
    severity: finding.severity,
    type: 'changed_meaning',
    paragraphIndex: finding.paragraphIndex,
    description: `${finding.description}${guidanceSuffix}`,
    englishExcerpt: finding.englishExcerpt,
    banglaExcerpt: finding.banglaExcerpt,
    suggestedFix: undefined,
    resolved: false,
    source: 'deterministic_lint',
    termId: `numerical:${finding.kind}:${finding.expectedValue}`,
    expectedBangla: finding.expectedBangla,
    ...(finding.detectedBanglaText
      ? { detectedBanglaVariant: finding.detectedBanglaText }
      : {}),
    findingSignature: finding.findingSignature,
  };
}

/**
 * Deterministically compares explicit numerical facts in a single aligned English/Bangla `ParagraphPair`.
 * Classifies each comparison into:
 * - `'no_mismatch'`: The expected number (in Bangla word, ordinal, classifier, or digit form) is present.
 * - `'confirmed_mismatch'`: The expected number is absent and a conflicting Bangla number is unambiguously paired.
 * - `'missing_number'`: The expected number is absent and no conflicting Bangla number is present.
 * - `'ambiguous'`: Multiple unmatched numbers exist without a unique contextual pairing.
 *
 * Only `'confirmed_mismatch'` findings are placed in `confirmedMismatches` (and `findings`) to generate
 * deterministic Stage 5 issues.
 */
export function lintParagraphNumericalConsistency(
  paragraph:
    | ParagraphPair
    | {
        index?: number;
        paragraphIndex?: number;
        englishText: string;
        banglaText: string;
        missingTranslation?: boolean;
      }
): ParagraphNumericalLintResult {
  const pIndex =
    typeof (paragraph as ParagraphPair).index === 'number'
      ? (paragraph as ParagraphPair).index
      : typeof (paragraph as { paragraphIndex?: number }).paragraphIndex ===
          'number'
        ? (paragraph as { paragraphIndex: number }).paragraphIndex
        : 0;
  const englishText = paragraph.englishText ?? '';
  const banglaText = normalizeBanglaUnicode(paragraph.banglaText ?? '');

  if (!englishText.trim() || !banglaText || paragraph.missingTranslation) {
    return {
      paragraphIndex: pIndex,
      englishFacts: [],
      banglaTokens: [],
      comparisons: [],
      findings: [],
      confirmedMismatches: [],
      missingNumbers: [],
      ambiguousComparisons: [],
      matchedComparisons: [],
      issues: [],
    };
  }

  const englishFacts = parseEnglishNumericalExpressions(englishText);
  const banglaTokens = parseBanglaNumericalTokens(banglaText);

  // Check explicit fractional half-unit expressions ("half a step" -> "আধ পা" vs "এক পা",
  // "half an inch" -> "আধ ইঞ্চি" vs "এক ইঞ্চি") before returning early when englishFacts is empty.
  const halfUnitChecks: Array<{
    enRegex: RegExp;
    wrongBnRegex: RegExp;
    validHalfBnRegex: RegExp;
    expectedBn: string;
    acceptedBn: string[];
  }> = [
    {
      enRegex: /\bhalf\s+a\s+step\b/i,
      wrongBnRegex: /(?:^|[^\u0980-\u09FF])(এক\s+পা)(?:$|[^\u0980-\u09FF])/u,
      validHalfBnRegex: /(?:আধ|আধা|অর্ধেক)\s*পা/u,
      expectedBn: 'আধ পা',
      acceptedBn: ['আধা পা', 'অর্ধেক পা'],
    },
    {
      enRegex: /\bhalf\s+an\s+inch\b/i,
      wrongBnRegex: /(?:^|[^\u0980-\u09FF])(এক\s+ইঞ্চি)(?:$|[^\u0980-\u09FF])/u,
      validHalfBnRegex: /(?:আধ|আধা|অর্ধেক)\s*ইঞ্চি/u,
      expectedBn: 'আধ ইঞ্চি',
      acceptedBn: ['আধা ইঞ্চি', 'অর্ধেক ইঞ্চি'],
    },
  ];

  const halfUnitMismatches: NumericalVerificationFinding[] = [];
  for (const check of halfUnitChecks) {
    const enMatch = check.enRegex.exec(englishText);
    if (enMatch && !check.validHalfBnRegex.test(banglaText)) {
      const wrongBnMatch = check.wrongBnRegex.exec(banglaText);
      if (wrongBnMatch) {
        const detectedBn = wrongBnMatch[1];
        const matchedEn = enMatch[0];
        const editorialGuidance = `Replace "${detectedBn}" (1) with "${check.expectedBn}" (0.5) to match "${matchedEn}".`;
        halfUnitMismatches.push({
          id: `num-lint-p${pIndex}-half-to-one-${halfUnitMismatches.length}`,
          paragraphIndex: pIndex,
          displayParagraphNumber: pIndex + 1,
          status: 'confirmed_mismatch',
          kind: 'quantity',
          expectedValue: 0.5,
          detectedValue: 1,
          matchedEnglishText: matchedEn,
          expectedBangla: check.expectedBn,
          acceptedBanglaForms: check.acceptedBn,
          detectedBanglaText: detectedBn,
          severity: 'high',
          englishExcerpt: buildExcerpt(englishText),
          banglaExcerpt: buildExcerpt(banglaText),
          description: `[Numerical Mismatch] Paragraph ${pIndex + 1} translates "${matchedEn}" (0.5) as "${detectedBn}" (1) instead of expected "${check.expectedBn}" (0.5).`,
          editorialGuidance,
          suggestedFix: undefined,
          findingSignature: computeNumericalFindingSignature({
            kind: 'quantity',
            expectedValue: 0.5,
            detectedValue: 1,
            expectedBangla: check.expectedBn,
            detectedBanglaText: detectedBn,
          }),
        });
      }
    }
  }

  if (englishFacts.length === 0) {
    return {
      paragraphIndex: pIndex,
      englishFacts,
      banglaTokens,
      comparisons: [...halfUnitMismatches],
      findings: [...halfUnitMismatches],
      confirmedMismatches: [...halfUnitMismatches],
      missingNumbers: [],
      ambiguousComparisons: [],
      matchedComparisons: [],
      issues: halfUnitMismatches.map(numericalFindingToVerificationIssue),
    };
  }

  const consumedBanglaIndices = new Set<number>();
  const matchedFactIndices = new Set<number>();
  const comparisonsByFactIdx = new Map<number, NumericalVerificationFinding>();

  // Rule M-1 (`measurement_unit_distortion`):
  // If English contains a fractional denominator word (`tenth/tenths`, `hundredth/hundredths`,
  // `thousandth/thousandths`, `quarter/quarters`, `third/thirds`, `fifth/fifths`, `eighth/eighths`, `sixteenth/sixteenths`)
  // and does NOT contain `percent` / `per cent` / `percentage` / `%`, flag Bangla bare `শতাংশ` / `শতাংশের` / `শতকরা` / `%`
  // (when not accompanied by fractional qualifiers like `ভাগের` / `শতাংশ ভাগ`) as `measurement_unit_distortion`.
  const englishHasFractionalDenominator =
    englishFacts.some(
      (f) =>
        (f.kind === 'compound_measurement' || f.kind === 'fraction') &&
        f.denominatorValue !== undefined
    ) ||
    /\b(?:tenths?|hundredths?|thousandths?|quarters?|thirds?|fifths?|eighths?|sixteenths?)\b/i.test(
      englishText
    );
  const englishHasExplicitPercent =
    /\b(?:percent|per\s+cent|percentage)\b|%/i.test(englishText);
  const bareBanglaPercentMatch =
    /(?:^|[^\u0980-\u09FF])(শতাংশ(?:ের|ে|ই|ও)?|শতকরা|%)(?=$|[^\u0980-\u09FF])/u.exec(
      banglaText
    );
  const banglaHasFractionalPartQualifier = /ভাগের|শতাংশ\s*ভাগ/u.test(banglaText);
  const isMeasurementUnitDistortion =
    englishHasFractionalDenominator &&
    !englishHasExplicitPercent &&
    bareBanglaPercentMatch !== null &&
    !banglaHasFractionalPartQualifier;

  // PASS 0A: Validate `verbatim_literal` facts first.
  // A `verbatim_literal` fact is satisfied ONLY if the exact ASCII substring or exact digit sequence
  // inside the verbatim token is preserved — never by an unrelated number elsewhere in the paragraph.
  const verbatimGroupOffsetByToken = new Map<string, number>();
  const missingVerbatimTokenReported = new Set<string>();
  for (let fIdx = 0; fIdx < englishFacts.length; fIdx++) {
    const fact = englishFacts[fIdx];
    if (fact.kind !== 'verbatim_literal') continue;

    const fullVerbatimToken = fact.unitOrNoun ?? fact.rawText;
    const groupIdx = (verbatimGroupOffsetByToken.get(fullVerbatimToken) ?? 0) + 1;
    verbatimGroupOffsetByToken.set(fullVerbatimToken, groupIdx);

    const escapedCapturingPattern = fullVerbatimToken
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\d+/g, '([\\d\\u09E6-\\u09EF]+)');
    const corruptedTokenRegex = new RegExp(escapedCapturingPattern, 'u');
    const corruptedMatch = corruptedTokenRegex.exec(banglaText);

    const capturedGroupText = corruptedMatch ? corruptedMatch[groupIdx] : undefined;
    const isExactDigitGroupPreserved =
      banglaText.includes(fullVerbatimToken) ||
      capturedGroupText === fact.numberText;

    if (isExactDigitGroupPreserved) {
      if (corruptedMatch) {
        const cStart = corruptedMatch.index;
        const cEnd = cStart + corruptedMatch[0].length;
        for (let bIdx = 0; bIdx < banglaTokens.length; bIdx++) {
          const bt = banglaTokens[bIdx];
          if (bt.start < cEnd && bt.end > cStart && bt.rawText === fact.numberText) {
            consumedBanglaIndices.add(bIdx);
          }
        }
      }
      matchedFactIndices.add(fIdx);
      comparisonsByFactIdx.set(fIdx, {
        id: `num-match-p${pIndex}-f${fIdx}-verbatim`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'no_mismatch',
        kind: 'verbatim_literal',
        expectedValue: fact.value,
        detectedValue: fact.value,
        matchedEnglishText: fullVerbatimToken,
        expectedBangla: fullVerbatimToken,
        acceptedBanglaForms: [fact.numberText],
        detectedBanglaText: fullVerbatimToken,
        severity: 'low',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `Paragraph ${pIndex + 1} preserves verbatim literal token "${fullVerbatimToken}".`,
        suggestedFix: undefined,
        findingSignature: computeNumericalFindingSignature({
          kind: 'verbatim_literal',
          expectedValue: fact.value,
          detectedValue: fact.value,
          expectedBangla: fullVerbatimToken,
          detectedBanglaText: fullVerbatimToken,
        }),
      });
    } else if (
      !corruptedMatch &&
      missingVerbatimTokenReported.has(fullVerbatimToken)
    ) {
      matchedFactIndices.add(fIdx);
    } else {
      if (!corruptedMatch) {
        missingVerbatimTokenReported.add(fullVerbatimToken);
      }
      // Mark any Bangla number tokens that lie inside the corrupted verbatim token span as consumed
      let detectedCorruptedText = corruptedMatch ? corruptedMatch[0] : undefined;
      let detectedCorruptedVal: number | undefined;
      if (capturedGroupText) {
        const parsedGroup = normalizeBanglaNumberToken(capturedGroupText);
        if (parsedGroup) {
          detectedCorruptedVal = parsedGroup.value;
        }
      }
      if (corruptedMatch) {
        const cStart = corruptedMatch.index;
        const cEnd = cStart + corruptedMatch[0].length;
        for (let bIdx = 0; bIdx < banglaTokens.length; bIdx++) {
          const bt = banglaTokens[bIdx];
          if (bt.start < cEnd && bt.end > cStart) {
            consumedBanglaIndices.add(bIdx);
            if (detectedCorruptedVal === undefined) {
              detectedCorruptedVal = bt.value;
            }
          }
        }
      }
      if (!detectedCorruptedText) {
        detectedCorruptedText = banglaText;
      }
      const editorialGuidance = `Restore exact verbatim literal token "${fullVerbatimToken}" (preserving ASCII digits "${fact.numberText}") instead of corrupted "${detectedCorruptedText}".`;
      comparisonsByFactIdx.set(fIdx, {
        id: `num-lint-p${pIndex}-f${fIdx}-verbatim-corruption`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'confirmed_mismatch',
        kind: 'verbatim_literal',
        expectedValue: fact.value,
        detectedValue: detectedCorruptedVal,
        matchedEnglishText: fullVerbatimToken,
        expectedBangla: fullVerbatimToken,
        acceptedBanglaForms: [fact.numberText],
        detectedBanglaText: detectedCorruptedText,
        severity: 'high',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `[Verbatim Literal Corruption] Paragraph ${pIndex + 1} corrupted verbatim literal token "${fullVerbatimToken}" (${fact.numberText}) into "${detectedCorruptedText}".`,
        editorialGuidance,
        suggestedFix: undefined,
        findingSignature: computeNumericalFindingSignature({
          kind: 'verbatim_literal',
          expectedValue: fact.value,
          detectedValue: detectedCorruptedVal,
          expectedBangla: fullVerbatimToken,
          detectedBanglaText: detectedCorruptedText,
        }),
      });
      matchedFactIndices.add(fIdx);
    }
  }

  // PASS 0B: Validate `compound_measurement` and `fraction` facts (including Rule M-1 `measurement_unit_distortion`)
  for (let fIdx = 0; fIdx < englishFacts.length; fIdx++) {
    const fact = englishFacts[fIdx];
    if (fact.kind !== 'compound_measurement' && fact.kind !== 'fraction') {
      continue;
    }

    const wholeVal = fact.wholeValue ?? 0;
    const numVal = fact.numeratorValue ?? fact.value;
    const denomVal = fact.denominatorValue ?? 100;
    const decDigits = fact.decimalDigits ?? [];

    const consumeMatchingBanglaValue = (targetVal: number): number => {
      for (let bIdx = 0; bIdx < banglaTokens.length; bIdx++) {
        if (consumedBanglaIndices.has(bIdx)) continue;
        if (banglaTokens[bIdx].value === targetVal) {
          consumedBanglaIndices.add(bIdx);
          return bIdx;
        }
      }
      return -1;
    };

    if (isMeasurementUnitDistortion && bareBanglaPercentMatch) {
      // Consume the whole/numerator tokens that were distorted into a percentage so they do not misfire on other facts
      if (wholeVal > 0) consumeMatchingBanglaValue(wholeVal);
      const numBnIdx = consumeMatchingBanglaValue(numVal);
      const detectedPercentPhrase =
        numBnIdx !== -1
          ? `${banglaTokens[numBnIdx].rawText} ${bareBanglaPercentMatch[1]}`
          : bareBanglaPercentMatch[1];
      const wholeCanonical =
        wholeVal > 0 ? getCanonicalBanglaNumberForms(wholeVal, 'cardinal').primary : '';
      const numCanonical = getCanonicalBanglaNumberForms(numVal, 'cardinal').primary;
      const denomCanonical = getCanonicalBanglaNumberForms(denomVal, 'cardinal').primary;
      const expectedFractionBn =
        wholeVal > 0
          ? `${wholeCanonical} ${fact.unitOrNoun ?? ''} ও একশো ভাগের ${numCanonical} ভাগ`.replace(/\s+/g, ' ').trim()
          : `${denomCanonical} ভাগের ${numCanonical} ভাগ`;
      const editorialGuidance = `Replace percentage distortion "${detectedPercentPhrase}" with an accurate fractional or decimal measurement (e.g., "${expectedFractionBn}") to match "${fact.rawText}" (measurement_unit_distortion).`;

      comparisonsByFactIdx.set(fIdx, {
        id: `num-lint-p${pIndex}-f${fIdx}-measurement-unit-distortion`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'confirmed_mismatch',
        kind: fact.kind,
        expectedValue: fact.value,
        detectedValue: numVal,
        matchedEnglishText: fact.rawText,
        expectedBangla: expectedFractionBn,
        acceptedBanglaForms: [expectedFractionBn],
        detectedBanglaText: detectedPercentPhrase,
        severity: 'high',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `[Measurement Unit Distortion (measurement_unit_distortion)] Paragraph ${pIndex + 1} mistranslates fractional measurement "${fact.rawText}" (${fact.value}) as percentage "${detectedPercentPhrase}".`,
        editorialGuidance,
        suggestedFix: undefined,
        findingSignature: `deterministic_lint::numerical::measurement_unit_distortion::${fact.value}::${numVal}::${normalizeBanglaUnicode(expectedFractionBn)}::${normalizeBanglaUnicode(detectedPercentPhrase)}`,
      });
      matchedFactIndices.add(fIdx);
      continue;
    }

    // Check valid fractional or decimal renderings in Bangla:
    // 1. Fractional rendering: `wholeVal` (if > 0) + `numVal` (and optional `denomVal`)
    // 2. Spoken/written decimal rendering with `দশমিক`: `wholeVal` (if > 0) + `দশমিক` + `decDigits` (or `numVal`)
    // 3. Numeric decimal rendering (`7.92` or `৭.৯২`)
    const hasWholeInBn =
      wholeVal === 0 ||
      banglaTokens.some(
        (bt, idx) => !consumedBanglaIndices.has(idx) && bt.value === wholeVal
      );
    const hasNumeratorInBn = banglaTokens.some(
      (bt, idx) => !consumedBanglaIndices.has(idx) && bt.value === numVal
    );
    const hasDashomik = /দশমিক/u.test(banglaText);
    const nonZeroDecDigits = decDigits.filter((d) => d !== 0);
    const hasDecimalDigitsInBn =
      hasDashomik &&
      nonZeroDecDigits.length > 0 &&
      nonZeroDecDigits.every((d) =>
        banglaTokens.some(
          (bt, idx) => !consumedBanglaIndices.has(idx) && bt.value === d
        )
      );

    if (hasWholeInBn && (hasNumeratorInBn || hasDecimalDigitsInBn)) {
      if (wholeVal > 0) consumeMatchingBanglaValue(wholeVal);
      if (hasNumeratorInBn) {
        consumeMatchingBanglaValue(numVal);
      } else if (hasDecimalDigitsInBn) {
        for (const d of decDigits) {
          consumeMatchingBanglaValue(d);
        }
      }
      // Also consume the denominator token (e.g., `একশো` = 100, `হাজার` = 1000, `আট` = 8, `দশ` = 10) if present
      consumeMatchingBanglaValue(denomVal);

      matchedFactIndices.add(fIdx);
      comparisonsByFactIdx.set(fIdx, {
        id: `num-match-p${pIndex}-f${fIdx}-v${fact.value}`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'no_mismatch',
        kind: fact.kind,
        expectedValue: fact.value,
        detectedValue: fact.value,
        matchedEnglishText: fact.rawText,
        expectedBangla: String(fact.value),
        acceptedBanglaForms: [String(fact.value)],
        detectedBanglaText: fact.rawText,
        severity: 'low',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `Paragraph ${pIndex + 1} accurately renders fractional/compound measurement "${fact.rawText}" (${fact.value}).`,
        suggestedFix: undefined,
        findingSignature: computeNumericalFindingSignature({
          kind: fact.kind,
          expectedValue: fact.value,
          detectedValue: fact.value,
          expectedBangla: String(fact.value),
          detectedBanglaText: fact.rawText,
        }),
      });
    } else {
      // Partially consume wholeVal and denomVal if present so any conflicting numerator pairs cleanly in PASS 2B
      if (wholeVal > 0) consumeMatchingBanglaValue(wholeVal);
      consumeMatchingBanglaValue(denomVal);
    }
  }

  // PASS 1: Match English numerical facts whose exact numeric value is present in `banglaTokens`
  for (let fIdx = 0; fIdx < englishFacts.length; fIdx++) {
    if (matchedFactIndices.has(fIdx)) continue;
    const fact = englishFacts[fIdx];

    // Prefer a Bangla token with matching value AND compatible contextKind, otherwise any unconsumed token with matching value
    let bestBnIdx = -1;
    for (let bIdx = 0; bIdx < banglaTokens.length; bIdx++) {
      if (consumedBanglaIndices.has(bIdx)) continue;
      const bnTok = banglaTokens[bIdx];
      if (bnTok.value === fact.value) {
        if (bnTok.contextKind === fact.kind) {
          bestBnIdx = bIdx;
          break;
        }
        if (bestBnIdx === -1) {
          bestBnIdx = bIdx;
        }
      }
    }

    if (bestBnIdx !== -1) {
      consumedBanglaIndices.add(bestBnIdx);
      matchedFactIndices.add(fIdx);
      const matchedBn = banglaTokens[bestBnIdx];
      const canonical = getCanonicalBanglaNumberForms(fact.value, fact.kind);
      const finding: NumericalVerificationFinding = {
        id: `num-match-p${pIndex}-f${fIdx}-v${fact.value}`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'no_mismatch',
        kind: fact.kind,
        expectedValue: fact.value,
        detectedValue: matchedBn.value,
        matchedEnglishText: fact.rawText,
        expectedBangla: canonical.primary,
        acceptedBanglaForms: canonical.alternatives,
        detectedBanglaText: matchedBn.rawText,
        severity: 'low',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `Paragraph ${pIndex + 1} accurately renders "${fact.rawText}" (${fact.value}) as "${matchedBn.rawText}".`,
        suggestedFix: undefined,
        findingSignature: computeNumericalFindingSignature({
          kind: fact.kind,
          expectedValue: fact.value,
          detectedValue: matchedBn.value,
          expectedBangla: canonical.primary,
          detectedBanglaText: matchedBn.rawText,
        }),
      };
      comparisonsByFactIdx.set(fIdx, finding);
    }
  }

  // Filter unconsumed Bangla tokens that can act as genuine conflicting numbers:
  // 1. Exclude benign indefinite-article "এক"/"একটি"/"একটা"/"একজন" (value === 1) when not in an address ("এক নম্বর")
  //    or age ("এক বছর") construction, since English "a"/"an" routinely translates to "একটি"/"একটা"/"একজন".
  // 2. Exclude Bangla "বারোটা"/"বারোটার"/"বারোটাই" (value === 12) when preceded by "দুপুর" and the English source
  //    contains "noon" or "midday", since "দুপুর বারোটা" is the idiomatic Bangla rendering of "noon".
  // 3. Exclude Bangla tokens that lie inside a preserved verbatim protected span.
  const englishHasNoonOrMidday = /\b(?:noon|midday)\b/i.test(englishText);
  const candidateConflictingBnIndices = banglaTokens
    .map((_, idx) => idx)
    .filter((bIdx) => {
      if (consumedBanglaIndices.has(bIdx)) return false;
      const tok = banglaTokens[bIdx];
      const isInsidePreservedVerbatim = englishFacts.some(
        (ef) =>
          ef.kind === 'verbatim_literal' &&
          ef.unitOrNoun &&
          banglaText.includes(ef.unitOrNoun) &&
          tok.rawText === ef.numberText
      );
      if (isInsidePreservedVerbatim) return false;
      if (
        tok.value === 1 &&
        !tok.isDigit &&
        tok.contextKind !== 'address' &&
        tok.contextKind !== 'age' &&
        !tok.isOrdinal
      ) {
        return false;
      }
      if (englishHasNoonOrMidday && tok.value === 12) {
        const prefixSlice = banglaText.slice(Math.max(0, tok.start - 12), tok.start);
        if (/দুপুর\s*$/u.test(prefixSlice)) {
          return false;
        }
      }
      return true;
    });

  const unmatchedFactIndices = englishFacts
    .map((_, idx) => idx)
    .filter((fIdx) => !matchedFactIndices.has(fIdx));

  // PASS 2A: Pair unmatched English facts with unconsumed Bangla tokens sharing the exact same specific context (`address`, `age`, `ordinal`)
  for (const fIdx of unmatchedFactIndices) {
    if (comparisonsByFactIdx.has(fIdx)) continue;
    const fact = englishFacts[fIdx];
    if (fact.kind !== 'address' && fact.kind !== 'age' && fact.kind !== 'ordinal') {
      continue;
    }

    const matchingContextBnIndices = candidateConflictingBnIndices.filter((bIdx) => {
      if (consumedBanglaIndices.has(bIdx)) return false;
      const bnTok = banglaTokens[bIdx];
      if (fact.kind === 'address') return bnTok.contextKind === 'address';
      if (fact.kind === 'age') return bnTok.contextKind === 'age';
      if (fact.kind === 'ordinal') return bnTok.isOrdinal;
      return false;
    });

    const sameKindUnmatchedFacts = unmatchedFactIndices.filter(
      (otherIdx) => !comparisonsByFactIdx.has(otherIdx) && englishFacts[otherIdx].kind === fact.kind
    );

    if (matchingContextBnIndices.length === 1 && sameKindUnmatchedFacts.length === 1) {
      const bIdx = matchingContextBnIndices[0];
      consumedBanglaIndices.add(bIdx);
      const conflictBn = banglaTokens[bIdx];
      const canonical = getCanonicalBanglaNumberForms(fact.value, fact.kind);
      const altHint =
        canonical.alternatives.length > 0
          ? ` (or ${canonical.alternatives.slice(0, 2).join(' / ')})`
          : '';
      const editorialGuidance = `Replace "${conflictBn.rawText}" (${conflictBn.value}) with "${canonical.primary}"${altHint} (${fact.value}) to match "${fact.rawText}".`;
      const finding: NumericalVerificationFinding = {
        id: `num-lint-p${pIndex}-f${fIdx}-v${fact.value}-to-v${conflictBn.value}`,
        paragraphIndex: pIndex,
        displayParagraphNumber: pIndex + 1,
        status: 'confirmed_mismatch',
        kind: fact.kind,
        expectedValue: fact.value,
        detectedValue: conflictBn.value,
        matchedEnglishText: fact.rawText,
        expectedBangla: canonical.primary,
        acceptedBanglaForms: canonical.alternatives,
        detectedBanglaText: conflictBn.rawText,
        severity: 'high',
        englishExcerpt: buildExcerpt(englishText),
        banglaExcerpt: buildExcerpt(banglaText),
        description: `[Numerical Mismatch] Paragraph ${pIndex + 1} translates "${fact.rawText}" (${fact.value}) as "${conflictBn.rawText}" (${conflictBn.value}) instead of expected Bangla number "${canonical.primary}" (${fact.value}).`,
        editorialGuidance,
        suggestedFix: undefined,
        findingSignature: computeNumericalFindingSignature({
          kind: fact.kind,
          expectedValue: fact.value,
          detectedValue: conflictBn.value,
          expectedBangla: canonical.primary,
          detectedBanglaText: conflictBn.rawText,
        }),
      };
      comparisonsByFactIdx.set(fIdx, finding);
    }
  }

  // PASS 2B: Evaluate remaining unmatched English facts
  const remainingUnmatchedFactIndices = unmatchedFactIndices.filter(
    (fIdx) => !comparisonsByFactIdx.has(fIdx)
  );
  const remainingConflictBnIndices = candidateConflictingBnIndices.filter(
    (bIdx) => !consumedBanglaIndices.has(bIdx)
  );

  if (
    remainingUnmatchedFactIndices.length === 1 &&
    remainingConflictBnIndices.length === 1
  ) {
    // Unambiguous 1-to-1 conflicting number in the aligned paragraph
    const fIdx = remainingUnmatchedFactIndices[0];
    const bIdx = remainingConflictBnIndices[0];
    consumedBanglaIndices.add(bIdx);
    const fact = englishFacts[fIdx];
    const conflictBn = banglaTokens[bIdx];
    const canonical = getCanonicalBanglaNumberForms(fact.value, fact.kind);
    const altHint =
      canonical.alternatives.length > 0
        ? ` (or ${canonical.alternatives.slice(0, 2).join(' / ')})`
        : '';
    const editorialGuidance = `Replace "${conflictBn.rawText}" (${conflictBn.value}) with "${canonical.primary}"${altHint} (${fact.value}) to match "${fact.rawText}".`;

    comparisonsByFactIdx.set(fIdx, {
      id: `num-lint-p${pIndex}-f${fIdx}-v${fact.value}-to-v${conflictBn.value}`,
      paragraphIndex: pIndex,
      displayParagraphNumber: pIndex + 1,
      status: 'confirmed_mismatch',
      kind: fact.kind,
      expectedValue: fact.value,
      detectedValue: conflictBn.value,
      matchedEnglishText: fact.rawText,
      expectedBangla: canonical.primary,
      acceptedBanglaForms: canonical.alternatives,
      detectedBanglaText: conflictBn.rawText,
      severity: 'high',
      englishExcerpt: buildExcerpt(englishText),
      banglaExcerpt: buildExcerpt(banglaText),
      description: `[Numerical Mismatch] Paragraph ${pIndex + 1} translates "${fact.rawText}" (${fact.value}) as "${conflictBn.rawText}" (${conflictBn.value}) instead of expected Bangla number "${canonical.primary}" (${fact.value}).`,
      editorialGuidance,
      suggestedFix: undefined,
      findingSignature: computeNumericalFindingSignature({
        kind: fact.kind,
        expectedValue: fact.value,
        detectedValue: conflictBn.value,
        expectedBangla: canonical.primary,
        detectedBanglaText: conflictBn.rawText,
      }),
    });
  } else {
    for (const fIdx of remainingUnmatchedFactIndices) {
      const fact = englishFacts[fIdx];
      const canonical = getCanonicalBanglaNumberForms(fact.value, fact.kind);

      if (remainingConflictBnIndices.length === 0) {
        // No conflicting Bangla number exists -> missing or paraphrased number
        comparisonsByFactIdx.set(fIdx, {
          id: `num-missing-p${pIndex}-f${fIdx}-v${fact.value}`,
          paragraphIndex: pIndex,
          displayParagraphNumber: pIndex + 1,
          status: 'missing_number',
          kind: fact.kind,
          expectedValue: fact.value,
          matchedEnglishText: fact.rawText,
          expectedBangla: canonical.primary,
          acceptedBanglaForms: canonical.alternatives,
          severity: 'low',
          englishExcerpt: buildExcerpt(englishText),
          banglaExcerpt: buildExcerpt(banglaText),
          description: `Numerical expression "${fact.rawText}" (${fact.value}) in Paragraph ${pIndex + 1} has no explicit Bangla numerical counterpart (may be omitted or paraphrased).`,
          suggestedFix: undefined,
          findingSignature: computeNumericalFindingSignature({
            kind: fact.kind,
            expectedValue: fact.value,
            expectedBangla: canonical.primary,
          }),
        });
      } else {
        // Multiple unmatched numbers with uncertain alignment -> ambiguous comparison (never a false high-severity error)
        const candidateTexts = remainingConflictBnIndices
          .map((bIdx) => `${banglaTokens[bIdx].rawText} (${banglaTokens[bIdx].value})`)
          .join(', ');
        comparisonsByFactIdx.set(fIdx, {
          id: `num-ambig-p${pIndex}-f${fIdx}-v${fact.value}`,
          paragraphIndex: pIndex,
          displayParagraphNumber: pIndex + 1,
          status: 'ambiguous',
          kind: fact.kind,
          expectedValue: fact.value,
          matchedEnglishText: fact.rawText,
          expectedBangla: canonical.primary,
          acceptedBanglaForms: canonical.alternatives,
          severity: 'low',
          englishExcerpt: buildExcerpt(englishText),
          banglaExcerpt: buildExcerpt(banglaText),
          description: `Ambiguous numerical comparison for "${fact.rawText}" (${fact.value}) in Paragraph ${pIndex + 1} alongside unmatched Bangla number(s): ${candidateTexts}.`,
          suggestedFix: undefined,
          findingSignature: computeNumericalFindingSignature({
            kind: fact.kind,
            expectedValue: fact.value,
            expectedBangla: canonical.primary,
          }),
        });
      }
    }
  }

  const comparisons: NumericalVerificationFinding[] = [...halfUnitMismatches];
  for (let fIdx = 0; fIdx < englishFacts.length; fIdx++) {
    const comp = comparisonsByFactIdx.get(fIdx);
    if (comp) {
      comparisons.push(comp);
    }
  }

  const confirmedMismatches = comparisons.filter(
    (c) => c.status === 'confirmed_mismatch'
  );
  const missingNumbers = comparisons.filter(
    (c) => c.status === 'missing_number'
  );
  const ambiguousComparisons = comparisons.filter(
    (c) => c.status === 'ambiguous'
  );
  const matchedComparisons = comparisons.filter(
    (c) => c.status === 'no_mismatch'
  );

  return {
    paragraphIndex: pIndex,
    englishFacts,
    banglaTokens,
    comparisons,
    findings: comparisons,
    confirmedMismatches,
    missingNumbers,
    ambiguousComparisons,
    matchedComparisons,
    issues: confirmedMismatches.map(numericalFindingToVerificationIssue),
  };
}

/**
 * Deterministically checks an entire chapter's `ParagraphPair[]` for explicit numerical consistency.
 * Pure and side-effect free: never mutates `paragraphs`.
 */
export function lintChapterNumericalConsistency(
  paragraphs: ReadonlyArray<ParagraphPair>
): ChapterNumericalLintResult {
  const paragraphResults: ParagraphNumericalLintResult[] = [];
  const confirmedMismatches: NumericalVerificationFinding[] = [];
  const missingNumbers: NumericalVerificationFinding[] = [];
  const ambiguousComparisons: NumericalVerificationFinding[] = [];
  const matchedComparisons: NumericalVerificationFinding[] = [];

  let totalParagraphsChecked = 0;

  for (const p of paragraphs) {
    if (p.englishText?.trim() && p.banglaText?.trim() && !p.missingTranslation) {
      totalParagraphsChecked++;
    }
    const res = lintParagraphNumericalConsistency(p);
    paragraphResults.push(res);
    confirmedMismatches.push(...res.confirmedMismatches);
    missingNumbers.push(...res.missingNumbers);
    ambiguousComparisons.push(...res.ambiguousComparisons);
    matchedComparisons.push(...res.matchedComparisons);
  }

  return {
    findings: confirmedMismatches,
    confirmedMismatches,
    missingNumbers,
    ambiguousComparisons,
    matchedComparisons,
    issues: confirmedMismatches.map(numericalFindingToVerificationIssue),
    paragraphResults,
    summary: {
      totalParagraphsChecked,
      confirmedMismatchCount: confirmedMismatches.length,
      missingNumberCount: missingNumbers.length,
      ambiguousComparisonCount: ambiguousComparisons.length,
      matchedComparisonCount: matchedComparisons.length,
    },
  };
}

