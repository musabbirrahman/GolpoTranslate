import type {
  CharacterMemoryItem,
  ChapterStatus,
  EditorialChange,
  ParagraphPair,
  Stage1CoverageMetadata,
  StoryContextProfile,
  TerminologyCategory,
  TerminologyFindingClassification,
  TerminologyFindingReason,
  TerminologyLintFinding,
  TerminologyMemoryItem,
  TerminologySource,
  TranslationProject,
  VerificationIssue,
  VerificationReport,
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
  if (match && match[1].trim().length > 0 && match[2].trim().length > 0) {
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
  const term = getEnglishSurfaceTerm(item.englishTerm);
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
  const editorialGuidance = detectedBanglaVariant
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
    .map((loc, idx) => ({
      id: `loc-sync-${idx}-${normalizeEnglishTerm(loc.name).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'place'}`,
      englishTerm: loc.name,
      banglaTranslation: loc.banglaName,
      category: 'place' as TerminologyCategory,
      notes: loc.description?.trim() || 'Synced from Story Context locations',
      source: 'location_sync' as TerminologySource,
      lockedByUser: false,
    }));

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
    const name = normalizeEnglishTerm(loc?.name ?? '');
    const banglaName = normalizeBanglaUnicode(loc?.banglaName ?? '');
    if (!name || !banglaName) return;
    const key = name.toLowerCase();
    const existingLoc = locationMap.get(key);
    if (!existingLoc) {
      locationMap.set(key, {
        name,
        banglaName,
        description: (loc?.description ?? '').trim(),
      });
    } else if (!existingLoc.description && loc?.description?.trim()) {
      existingLoc.description = loc.description.trim();
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

  if (stage === 'stage4') {
    sections.push(
      [
        '[STAGE 4 TERMINOLOGY PROTECTION & LITERARY POLISH RULES]',
        '1. User-Locked Terms (Tier 1): Strictly preserve the Preferred Bangla (or listed Accepted Alternatives). Never omit when the literal concept is present and never introduce any FORBIDDEN / AVOID rendering.',
        '2. Established & Provisional AI Terms (Tier 2 & Tier 3): Do not replace established Bangla terms with unlisted synonyms merely for stylistic variety.',
        '3. Accepted Alternatives: You may keep or switch between the Preferred Bangla and explicitly listed Accepted Alternatives when rhythm or euphony benefits.',
        '4. Natural Bangla Grammatical Inflections (ALLOWED): You may freely attach or adjust natural Bangla nominal suffixes, classifiers, plurals, and case endings (-টি, -টা, -গুলো, -গুলি, -ে, -ের, -তে, -য়, -কে, -দের) on the protected Bangla root so sentence syntax flows naturally.',
        '5. Contextual Paraphrasing & Pronoun Cohesion (ALLOWED): When an unlocked descriptive noun repeats across adjacent clauses where natural literary Bangla uses a pronoun (সেটি, সেখানে, তার), or when a polysemous term is used in a different sense (e.g. a "school of fish" vs an educational institution), follow natural literary Bangla without introducing any FORBIDDEN / AVOID term.',
      ].join('\n')
    );
  }

  if (stage === 'stage5') {
    sections.push(
      [
        '[STAGE 5 TERMINOLOGY AUDIT RULES]',
        '1. Preferred & Accepted Forms (VALID): Do NOT flag a terminology issue when the Bangla translation uses either the Preferred Bangla or any listed Accepted Alternatives, including with natural Bangla grammatical suffixes, classifiers, plurals, and case endings (-টি, -টা, -গুলো, -গুলি, -ে, -ের, -তে, -য়, -কে, -দের).',
        '2. Forbidden / Avoid Terms & Tier 1 Locks (STRICT): ALWAYS flag a terminology issue if any FORBIDDEN / AVOID translation is used, or if a Tier 1 (User-Locked) term is omitted or replaced with an unapproved synonym when its literal English concept is present.',
        '3. Context-Sensitive Polysemous Terms: For entries marked [Context-Sensitive Polysemous Term], verify that the English passage uses the term in the specified Context Sense before flagging a terminology mismatch.',
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}

export interface MergeVerificationReportParams {
  aiReport?: VerificationReport | null;
  lintResult: ChapterTerminologyLintResult;
  paragraphs: ReadonlyArray<ParagraphPair>;
  previousReport?: VerificationReport | null;
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
 * while strictly separating reconciliation of AI issues vs. deterministic terminology findings:
 * 1. Converts deterministic findings to 0-based `paragraphIndex` (`finding.paragraphIndex`) to match Stage 5 UI.
 * 2. Leaves `suggestedFix: undefined` on all deterministic terminology issues (embedding remediation guidance in `description`).
 * 3. Reconciles `resolved: true` state on deterministic findings ONLY against previous `source === 'deterministic_lint'`
 *    issues whose `paragraphIndex`, `paragraphContentFingerprint`, AND `findingSignature` all match.
 * 4. Never allows a deterministic fingerprint match to alter or preserve the resolved state of an AI-generated issue.
 * 5. Preserves missing-paragraph completion gates (`missingTranslation: true` -> `isComplete: false`).
 */
export function mergeVerificationReportWithTerminologyLint(
  params: MergeVerificationReportParams
): VerificationReport {
  const {
    aiReport = null,
    lintResult,
    paragraphs,
    previousReport = null,
    mode = aiReport ? 'stage5_full' : 'local_relint',
    checkedAt = aiReport?.checkedAt ?? new Date().toISOString(),
  } = params;

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

  // Build deterministic VerificationIssues with 0-based paragraphIndex and fingerprint reconciliation
  const reconciledDeterministicIssues: VerificationIssue[] = lintResult.findings.map(
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

  // Determine which AI issues to keep based on `mode`
  const rawAiSourceIssues: VerificationIssue[] =
    mode === 'stage5_full' && aiReport
      ? aiReport.issues
      : previousAiIssues;

  // Normalize AI issues with `source: 'ai_stage5'` while enforcing strict `paragraphIndex` and `suggestedFix` validation,
  // stamping `paragraphContentFingerprint`, conservatively preserving `resolved: true` on unchanged paragraphs,
  // and deduplicating any AI `terminology` issue that overlaps with a deterministic finding on the same paragraph & term.
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
  for (const aiIss of rawAiSourceIssues) {
    if (!aiIss || typeof aiIss !== 'object') {
      continue;
    }
    if (aiIss.source === 'deterministic_lint') {
      continue;
    }

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

    if (aiIss.type === 'terminology' && validParagraphIndex !== undefined) {
      const overlapsDeterministic = lintResult.findings.some((f) => {
        if (f.paragraphIndex !== validParagraphIndex) return false;
        const surfaceLower = getEnglishSurfaceTerm(f.englishTerm).toLowerCase();
        const descLower = (aiIss.description ?? '').toLowerCase();
        const enExcerptLower = (aiIss.englishExcerpt ?? '').toLowerCase();
        return (
          descLower.includes(surfaceLower) ||
          enExcerptLower.includes(surfaceLower) ||
          (f.expectedBangla && (aiIss.description ?? '').includes(f.expectedBangla)) ||
          (f.detectedBanglaVariant &&
            ((aiIss.description ?? '').includes(f.detectedBanglaVariant) ||
              (aiIss.banglaExcerpt ?? '').includes(f.detectedBanglaVariant)))
        );
      });

      if (overlapsDeterministic) {
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

    const aiFindingSignature = computeStrictAiFindingSignature(aiIss);

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
        const prevSig = computeStrictAiFindingSignature(prev);
        return Boolean(prevSig) && prevSig === aiFindingSignature;
      });

      if (matchingPrev.length === 1 && matchingPrev[0].resolved === true) {
        resolvedState = true;
      }
    }

    const normalizedIssue: VerificationIssue = {
      ...aiIss,
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

  // Calculate fidelity score accounting for unresolved deterministic terminology findings
  const hasMissingParagraphs = paragraphs.some(
    (p) => Boolean(p.missingTranslation) || (Boolean(p.englishText?.trim()) && !p.banglaText?.trim())
  );

  const unresolvedDet = reconciledDeterministicIssues.filter((i) => !i.resolved);
  const detPenalty = unresolvedDet.reduce((acc, iss) => {
    if (iss.severity === 'high') return acc + 8;
    if (iss.severity === 'medium') return acc + 4;
    return acc + 1;
  }, 0);

  const baseScore =
    aiReport?.overallScore ??
    previousReport?.overallScore ??
    (hasMissingParagraphs ? 70 : 98);

  const adjustedScore =
    mode === 'stage5_full'
      ? Math.max(0, Math.min(100, baseScore - detPenalty))
      : previousReport && aiReport === null
        ? (() => {
            const prevUnresolvedDet = previousDeterministicIssues.filter((i) => !i.resolved);
            const prevPenalty = prevUnresolvedDet.reduce((acc, iss) => {
              if (iss.severity === 'high') return acc + 8;
              if (iss.severity === 'medium') return acc + 4;
              return acc + 1;
            }, 0);
            const recoveredBase = Math.min(100, previousReport.overallScore + prevPenalty);
            return Math.max(0, Math.min(100, recoveredBase - detPenalty));
          })()
        : Math.max(0, Math.min(100, baseScore - detPenalty));

  const baseIsComplete = aiReport
    ? Boolean(aiReport.isComplete)
    : previousReport
      ? Boolean(previousReport.isComplete)
      : !hasMissingParagraphs;

  const isComplete = baseIsComplete && !hasMissingParagraphs;

  const baseSummary =
    aiReport?.fidelitySummary?.trim() ||
    previousReport?.fidelitySummary?.trim() ||
    'Verification completed.';

  return {
    overallScore: adjustedScore,
    fidelitySummary: baseSummary,
    isComplete,
    issues: combinedIssues,
    checkedAt,
  };
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

  const filteredPreviousReport: VerificationReport = {
    ...previousReport,
    issues: remappedPreviousIssues,
  };

  const merged = mergeVerificationReportWithTerminologyLint({
    aiReport: null,
    lintResult,
    paragraphs: latestParagraphs,
    previousReport: filteredPreviousReport,
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
  stageCompletedVerification: boolean;
  chapterStatus: ChapterStatus;
}

/**
 * Pure Stage 4 Literary Editing reconciliation orchestrator:
 * 1. Maps `snapshotParagraphs` to `latestParagraphs` using `mapSnapshotParagraphsToLatest`.
 * 2. Applies Stage 4 polished Bangla (`editedParagraphs[snapIdx]`) ONLY to paragraphs that map
 *    unambiguously and whose English/Bangla content was NOT modified in flight.
 * 3. Preserves in-flight user edits, insertions, same-length replacements, and ambiguous shifted duplicates verbatim.
 * 4. Filters `editorialChanges` to valid integer `snapIdx` slots where Stage 4's edit was applied, remapping to `latestIdx`.
 * 5. Always runs deterministic terminology linting (`lintChapterTerminology`) against the reconciled `latestParagraphs`
 *    and hydrated `latestGlossary`:
 *    - When `latestVerificationReport` is `null` and `lintResult.findings.length === 0`, keeps `verificationReport: null`
 *      and `stageCompletedVerification: false`.
 *    - When `latestVerificationReport` is `null` and `lintResult.findings.length > 0`, produces a deterministic-only
 *      `VerificationReport` (`isComplete: false`, `stageCompletedVerification: false`).
 *    - When `latestVerificationReport` exists, reconciles it against the updated paragraphs and latest glossary.
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

  const mapping = mapSnapshotParagraphsToLatest(
    snapshotParagraphs,
    latestParagraphs
  );

  const appliedParagraphIndices: number[] = [];
  const preservedInFlightParagraphIndices: number[] = [];
  const changedByStage4ParagraphIndices: number[] = [];
  const appliedSnapToLatest = new Map<number, number>();

  const reconciledParagraphs: ParagraphPair[] = latestParagraphs.map(
    (latestPair, latestIdx) => {
      const snapIdx = mapping.latestToSnapIndex.get(latestIdx);
      const canApplyStage4Edit =
        snapIdx !== undefined && mapping.unchangedLatestIndices.has(latestIdx);

      if (!canApplyStage4Edit) {
        preservedInFlightParagraphIndices.push(latestIdx);
        return {
          ...latestPair,
          index: latestIdx,
        };
      }

      appliedParagraphIndices.push(latestIdx);
      appliedSnapToLatest.set(snapIdx, latestIdx);

      const candidate =
        typeof editedParagraphs[snapIdx] === 'string'
          ? editedParagraphs[snapIdx].trim()
          : '';
      const resolvedBangla = candidate || latestPair.banglaText;
      const isStillEmpty = resolvedBangla.trim().length === 0;

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
      };

      if (!isStillEmpty) {
        updated.lastRefinementAction = 'stage_4_editorial';
        delete updated.missingTranslation;
      } else {
        updated.missingTranslation = true;
      }

      return updated;
    }
  );

  const translatedText =
    joinTranslatedParagraphPairsWithSceneBreaks(reconciledParagraphs);

  const sanitizedNotes: string[] = Array.isArray(editorialNotes)
    ? editorialNotes
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n) => n.trim())
    : [];

  const sanitizedChanges: EditorialChange[] = [];
  if (Array.isArray(editorialChanges)) {
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

      if (anyParagraphChanged) {
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
 * 3. Runs `lintChapterTerminology` against `latestParagraphs` and hydrated `latestGlossary`.
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

    const rawIdx = (rawIss as { paragraphIndex?: unknown }).paragraphIndex;

    // 1. Missing or null paragraphIndex -> legitimate chapter-level issue
    if (rawIdx === undefined || rawIdx === null) {
      if (!allParagraphsVerified) {
        discardedStaleIssueCount++;
        continue;
      }
      const chapterIssue: VerificationIssue = {
        ...rawIss,
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

  const sanitizedAiReport: VerificationReport = {
    overallScore:
      typeof aiReport?.overallScore === 'number' &&
      Number.isFinite(aiReport.overallScore)
        ? Math.max(0, Math.min(100, Math.round(aiReport.overallScore)))
        : 95,
    fidelitySummary:
      aiReport?.fidelitySummary?.trim() ||
      'Verification completed successfully.',
    isComplete: Boolean(aiReport?.isComplete ?? true) && allParagraphsVerified,
    issues: filteredRemappedAiIssues,
    checkedAt,
  };

  const mergedReport = mergeVerificationReportWithTerminologyLint({
    aiReport: sanitizedAiReport,
    lintResult,
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
    allParagraphsVerified && !hasMissingTranslations;
  const chapterStatus: ChapterStatus = isComplete ? 'completed' : 'needs_review';

  const finalReport: VerificationReport = {
    ...mergedReport,
    fidelitySummary: finalSummary,
    isComplete,
  };

  return {
    verificationReport: finalReport,
    lintResult,
    verifiedParagraphIndices,
    unverifiedParagraphIndices,
    discardedStaleIssueCount,
    rejectedInvalidIssueCount,
    allParagraphsVerified,
    stageCompletedVerification,
    chapterStatus,
  };
}

