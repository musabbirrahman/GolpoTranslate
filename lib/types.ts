export interface StyleProfile {
  overallVoice: string;
  sentenceStructure: string;
  vocabularyComplexity: string;
  narrativePerspective: string;
  dialogueStyle: string;
  emotionalIntensity: string;
  descriptiveTechniques: string;
  metaphorsAndImagery: string;
  literaryCharacteristics: string;
  languageRegister: string;
  banglaAdaptationStrategy: string;
  customNotes: string;
}

export interface StoryContextProfile {
  summary: string;
  narrativeTimeline: string;
  importantEvents: string[];
  emotionalContext: string;
  literaryTone: string;
  locations: Array<{
    name: string;
    banglaName: string;
    description: string;
  }>;
}

export interface CharacterMemoryItem {
  id: string;
  englishName: string;
  banglaName: string;
  relationships: string;
  pronouns: string;
  personality: string;
  speakingStyle: string;
  notes: string;
}

export type TerminologyCategory =
  | 'name'
  | 'place'
  | 'title'
  | 'object'
  | 'fantasy'
  | 'expression';

export interface TerminologyMemoryItem {
  id: string;
  englishTerm: string;
  banglaTranslation: string;
  category: TerminologyCategory;
  notes: string;
}

export interface TranslationStyleControls {
  preserveAuthorStyle: boolean;
  naturalness: 'balanced' | 'highly_natural';
  literaryExpression: 'subtle' | 'rich';
  languageComplexity: 'simple' | 'moderate' | 'advanced';
  dialogueStyle: 'faithful' | 'more_conversational';
  translationApproach: 'faithful_literary' | 'expressive_adaptation';
}

export type ParagraphRefinementAction =
  | 'more_natural'
  | 'improve_literary'
  | 'conversational_dialogue'
  | 'simpler_language'
  | 'more_expressive'
  | 'match_author_style';

export interface ParagraphPair {
  index: number;
  englishText: string;
  banglaText: string;
  previousBanglaText?: string;
  lastRefinementAction?: ParagraphRefinementAction | 'stage_4_editorial' | 'manual_edit';
  refinementRationale?: string;
}

export interface EditorialChange {
  paragraphIndex: number;
  aspect: string;
  beforeSnippet: string;
  afterSnippet: string;
  rationale: string;
}

export type VerificationIssueType =
  | 'missing_content'
  | 'omitted_dialogue'
  | 'added_info'
  | 'changed_meaning'
  | 'character_reference'
  | 'terminology'
  | 'emotional_intent'
  | 'chronology';

export interface VerificationIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  type: VerificationIssueType;
  paragraphIndex?: number;
  description: string;
  englishExcerpt?: string;
  banglaExcerpt?: string;
  suggestedFix?: string;
  resolved: boolean;
}

export interface VerificationReport {
  overallScore: number;
  fidelitySummary: string;
  isComplete: boolean;
  issues: VerificationIssue[];
  checkedAt: string;
}

export type ChapterStatus = 'pending' | 'in_progress' | 'needs_review' | 'completed';

export interface StageCompletionState {
  understanding: boolean;
  voiceAnalysis: boolean;
  translation: boolean;
  editing: boolean;
  verification: boolean;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  originalText: string;
  translatedText: string;
  draftTranslatedText?: string;
  paragraphs: ParagraphPair[];
  status: ChapterStatus;
  currentStage: 0 | 1 | 2 | 3 | 4 | 5;
  stageCompleted: StageCompletionState;
  editorialNotes: string[];
  editorialChanges: EditorialChange[];
  verificationReport: VerificationReport | null;
  chunkCount: number;
  completedChunks: number;
  updatedAt: string;
}

export interface TranslationProject {
  id: string;
  title: string;
  authorName: string;
  genre: string;
  sourceLanguage: 'English';
  targetLanguage: 'Bangla (বাংলা)';
  createdAt: string;
  updatedAt: string;
  styleProfile: StyleProfile | null;
  storyContext: StoryContextProfile | null;
  characterMemory: CharacterMemoryItem[];
  terminologyMemory: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
  chapters: Chapter[];
}

export type HistoryActionType =
  | 'stage_1_understanding'
  | 'stage_2_voice'
  | 'stage_3_translation'
  | 'stage_4_editing'
  | 'stage_5_verification'
  | 'paragraph_refinement'
  | 'manual_save';

export interface TranslationHistoryEntry {
  id: string;
  projectId: string;
  projectTitle: string;
  chapterId: string;
  chapterTitle: string;
  actionType: HistoryActionType;
  summary: string;
  timestamp: string;
  paragraphIndex?: number;
  previousText?: string;
  newText?: string;
}

export interface AppSettings {
  defaultStyleControls: TranslationStyleControls;
  maxWordsPerChunk: number;
  autoSave: boolean;
  banglaFontSize: number;
  englishFontSize: number;
  lineSpacing: 'comfortable' | 'relaxed' | 'spacious';
}

export const DEFAULT_STYLE_CONTROLS: TranslationStyleControls = {
  preserveAuthorStyle: true,
  naturalness: 'highly_natural',
  literaryExpression: 'rich',
  languageComplexity: 'moderate',
  dialogueStyle: 'more_conversational',
  translationApproach: 'faithful_literary',
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultStyleControls: DEFAULT_STYLE_CONTROLS,
  maxWordsPerChunk: 500,
  autoSave: true,
  banglaFontSize: 18,
  englishFontSize: 16,
  lineSpacing: 'relaxed',
};
