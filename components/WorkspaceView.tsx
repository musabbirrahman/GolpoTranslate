'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  BookMarked,
  Check,
  CheckCircle2,
  Download,
  Feather,
  FileText,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
} from 'lucide-react';
import type {
  AppSettings,
  CharacterMemoryItem,
  Chapter,
  HistoryActionType,
  ParagraphPair,
  ParagraphRefinementAction,
  StoryContextProfile,
  StyleProfile,
  TerminologyMemoryItem,
  TranslationProject,
  TranslationStyleControls,
  VerificationIssue,
  VerificationReport,
} from '@/lib/types';
import {
  alignParagraphs,
  applyContinuousBanglaEdit,
  assembleTranslatedChunks,
  canEditContinuousBangla,
  chunkTextByParagraphs,
  countWords,
  formatBilingualExport,
  formatChapterExport,
  formatFullStoryExport,
  getPipelineCompletionState,
  joinParagraphsWithSceneBreaks,
  mergeStage3ChunkProgress,
  resolveVerificationIssue,
  revertParagraphTranslation,
  splitIntoParagraphs,
  updateParagraphTranslation,
} from '@/lib/chunker';
import {
  computeParagraphContentFingerprint,
  extractEnglishSurfaceAndSense,
  findEnglishTermOccurrences,
  hydrateProjectGlossary,
  mapSnapshotParagraphsToLatest,
  normalizeBanglaUnicode,
  normalizeEnglishTerm,
  reconcileStage1ResultWithLatestState,
  reconcileStage3ChunkGlossaryWithLatestState,
  reconcileStage4ResultWithLatestState,
  reconcileStage5ResultWithLatestState,
  reconcileVerificationReportAfterLocalEdit,
} from '@/lib/terminology';
import VoiceAndControlsPanel from './VoiceAndControlsPanel';
import ContextAndMemoryPanel from './ContextAndMemoryPanel';
import VerificationAndEditorialPanel from './VerificationAndEditorialPanel';

interface WorkspaceViewProps {
  project: TranslationProject;
  activeChapterId: string;
  settings: AppSettings;
  autoRunPipelineTrigger: number;
  onSelectChapter: (chapterId: string) => void;
  onUpdateProject: (updated: TranslationProject) => void;
  onLogHistory: (entry: {
    projectId: string;
    projectTitle: string;
    chapterId: string;
    chapterTitle: string;
    actionType: HistoryActionType;
    summary: string;
    paragraphIndex?: number;
    previousText?: string;
    newText?: string;
  }) => void;
}

type WorkspaceSubTab = 'manuscript' | 'voice' | 'memory' | 'verification';
type EditorViewMode = 'paragraphs' | 'continuous';

interface ActiveParagraphRefinementRequest {
  reqId: number;
  chapterId: string;
  snapshotParagraphs: ParagraphPair[];
  snapshotIndex: number;
  snapshotTargetFp: string;
  isDuplicateEnglishInSnapshot: boolean;
}

const BANGLA_SCRIPT_CHECK_RE = /[\u0980-\u09FF]/;
const PARTIAL_OR_DET_SUMMARY_PREFIX_RE =
  /^(\[Partial Verification|Deterministic terminology check)/i;

function normalizeStringListForRuleDiff(
  list: ReadonlyArray<string> | undefined,
  normalizer: (val: string) => string
): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  return [...list]
    .map((item) => normalizer(item ?? ''))
    .filter(Boolean)
    .sort()
    .join('\u0001');
}

function hasVerificationRelevantGlossaryRuleChanged(
  a: TerminologyMemoryItem,
  b: TerminologyMemoryItem
): boolean {
  if (normalizeEnglishTerm(a.englishTerm) !== normalizeEnglishTerm(b.englishTerm)) {
    return true;
  }
  if (
    normalizeBanglaUnicode(a.banglaTranslation) !==
    normalizeBanglaUnicode(b.banglaTranslation)
  ) {
    return true;
  }
  if (
    normalizeStringListForRuleDiff(a.acceptedAlternatives, normalizeBanglaUnicode) !==
    normalizeStringListForRuleDiff(b.acceptedAlternatives, normalizeBanglaUnicode)
  ) {
    return true;
  }
  if (
    normalizeStringListForRuleDiff(a.avoidTranslations, normalizeBanglaUnicode) !==
    normalizeStringListForRuleDiff(b.avoidTranslations, normalizeBanglaUnicode)
  ) {
    return true;
  }
  if (Boolean(a.lockedByUser) !== Boolean(b.lockedByUser)) {
    return true;
  }
  if (a.category !== b.category) {
    return true;
  }
  if (
    normalizeEnglishTerm(a.contextMeaning ?? '') !==
    normalizeEnglishTerm(b.contextMeaning ?? '')
  ) {
    return true;
  }
  if (Boolean(a.caseSensitive) !== Boolean(b.caseSensitive)) {
    return true;
  }
  if (Boolean(a.isContextSensitive) !== Boolean(b.isContextSensitive)) {
    return true;
  }
  if (
    normalizeBanglaUnicode(a.banglaStem ?? '') !==
    normalizeBanglaUnicode(b.banglaStem ?? '')
  ) {
    return true;
  }
  if (Boolean(a.allowInflections) !== Boolean(b.allowInflections)) {
    return true;
  }
  return false;
}

function doesAiTerminologyIssueMatchChangedTerm(
  issue: VerificationIssue,
  changedTerm: TerminologyMemoryItem,
  paragraphEnglishText?: string
): boolean {
  if (issue.termId) {
    return issue.termId === changedTerm.id;
  }

  const { surfaceTerm } = extractEnglishSurfaceAndSense(changedTerm.englishTerm);
  const normalizedSurface = normalizeEnglishTerm(surfaceTerm);
  if (normalizedSurface) {
    const matchesInExcerpt =
      findEnglishTermOccurrences(issue.englishExcerpt ?? '', changedTerm).length > 0;
    const matchesInDescription =
      findEnglishTermOccurrences(issue.description ?? '', changedTerm).length > 0;
    if (matchesInExcerpt || matchesInDescription) {
      return true;
    }

    if (
      paragraphEnglishText &&
      findEnglishTermOccurrences(paragraphEnglishText, changedTerm).length > 0 &&
      (issue.description ?? '').toLowerCase().includes(normalizedSurface.toLowerCase())
    ) {
      return true;
    }
  }

  const banglaCandidates = [
    changedTerm.banglaTranslation,
    ...(changedTerm.acceptedAlternatives ?? []),
    ...(changedTerm.avoidTranslations ?? []),
  ]
    .map((v) => normalizeBanglaUnicode(v ?? ''))
    .filter((v) => v.length > 0);

  const normBnExcerpt = normalizeBanglaUnicode(issue.banglaExcerpt ?? '');
  const normDesc = normalizeBanglaUnicode(issue.description ?? '');

  for (const candidate of banglaCandidates) {
    if (
      (normBnExcerpt && normBnExcerpt.includes(candidate)) ||
      (normDesc && normDesc.includes(candidate))
    ) {
      return true;
    }
  }

  return false;
}

function ensureGlossaryPartialVerificationSummary(summary: string | undefined): string {
  const trimmed = (summary ?? '').trim();
  if (PARTIAL_OR_DET_SUMMARY_PREFIX_RE.test(trimmed)) {
    return trimmed;
  }
  const base = trimmed || 'Verification completed.';
  return `[Partial Verification — Glossary terminology rules were updated after Stage 5 verification; deterministic terminology checks were refreshed, but a Stage 5 re-run is required for full verification.] ${base}`;
}

const PARAGRAPH_REFINEMENT_OPTIONS: Array<{
  id: ParagraphRefinementAction;
  label: string;
  banglaHint: string;
}> = [
  { id: 'more_natural', label: 'More Natural Flow', banglaHint: 'আরও স্বাভাবিক প্রবাহ' },
  { id: 'improve_literary', label: 'Improve Literary Expression', banglaHint: 'সাহিত্যিক মাধুর্য বৃদ্ধি' },
  { id: 'conversational_dialogue', label: 'More Conversational Dialogue', banglaHint: 'জীবন্ত কথোপকথন' },
  { id: 'simpler_language', label: 'Simpler Language', banglaHint: 'সহজ ও প্রাঞ্জল ভাষা' },
  { id: 'more_expressive', label: 'More Expressive', banglaHint: 'আবেগ ও ভাবের গভীরতা' },
  { id: 'match_author_style', label: "Re-translate in Author's Style", banglaHint: 'মূল লেখকের শৈলীতে' },
];

export default function WorkspaceView({
  project,
  activeChapterId,
  settings,
  autoRunPipelineTrigger,
  onSelectChapter,
  onUpdateProject,
  onLogHistory,
}: WorkspaceViewProps) {
  const activeChapter =
    project.chapters.find((c) => c.id === activeChapterId) || project.chapters[0];

  const [subTab, setSubTab] = useState<WorkspaceSubTab>('manuscript');
  const [editorMode, setEditorMode] = useState<EditorViewMode>('paragraphs');
  const [selectedParagraphIdx, setSelectedParagraphIdx] = useState<number | null>(0);
  const [customParagraphNote, setCustomParagraphNote] = useState('');
  const [refiningParagraphIdx, setRefiningParagraphIdx] = useState<number | null>(null);

  // Stage execution states
  const [runningStage, setRunningStage] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [pipelineBanner, setPipelineBanner] = useState<string | null>(null);
  const [pipelineBannerTone, setPipelineBannerTone] = useState<'success' | 'warning'>('success');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState(false);

  // Add Chapter Modal state
  const [showAddChapter, setShowAddChapter] = useState(false);
  const [newChTitle, setNewChTitle] = useState('');
  const [newChText, setNewChText] = useState('');

  const lastTriggerRef = useRef<number>(0);

  // Keep latest project ref for sequential pipeline steps and concurrent edits
  const projectRef = useRef<TranslationProject>(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Stage 5 per-chapter request sequence counter (incremented ONLY when a new Stage 5 request starts)
  const stage5RequestSeqByChapterRef = useRef<Record<string, number>>({});

  // Movement-safe paragraph refinement request registry
  const refineRequestSeqRef = useRef<number>(0);
  const activeRefineRequestsRef = useRef<ActiveParagraphRefinementRequest[]>([]);

  const updateChapterInProject = (
    baseProject: TranslationProject,
    chapterId: string,
    updater: (ch: Chapter) => Chapter
  ): TranslationProject => {
    const updatedChapters = baseProject.chapters.map((ch) =>
      ch.id === chapterId ? updater(ch) : ch
    );
    const nextProj: TranslationProject = {
      ...baseProject,
      updatedAt: new Date().toISOString(),
      chapters: updatedChapters,
    };
    projectRef.current = nextProj;
    onUpdateProject(nextProj);
    return nextProj;
  };

  /**
   * Applies a local paragraph edit, revert, or continuous edit to a chapter using `projectRef.current`,
   * reconciling any existing `VerificationReport` via `reconcileVerificationReportAfterLocalEdit`
   * and maintaining accurate `stageCompleted.verification` and `status` state.
   */
  const applyChapterLocalEditWithReconciliation = (
    chapterId: string,
    computeEdit: (existing: Chapter) => {
      nextParagraphs: ParagraphPair[];
      nextTranslatedText: string;
      nextOriginalText?: string;
    }
  ): TranslationProject => {
    const latestProj = projectRef.current;
    return updateChapterInProject(latestProj, chapterId, (existing) => {
      const previousParagraphs = existing.paragraphs.map((p) => ({ ...p }));
      const { nextParagraphs, nextTranslatedText, nextOriginalText } =
        computeEdit(existing);

      const mapping = mapSnapshotParagraphsToLatest(
        previousParagraphs,
        nextParagraphs
      );

      const reconciledReport: VerificationReport | null =
        existing.verificationReport
          ? reconcileVerificationReportAfterLocalEdit({
              previousReport: existing.verificationReport,
              previousParagraphs,
              latestParagraphs: nextParagraphs,
              latestGlossary: latestProj.terminologyMemory,
            })
          : null;

      const nextStageCompletedVerification = mapping.allParagraphsUnchanged
        ? Boolean(
            existing.stageCompleted.verification && reconciledReport?.isComplete
          )
        : false;

      let nextStatus = existing.status;
      if (nextStageCompletedVerification && reconciledReport) {
        nextStatus = getPipelineCompletionState(
          nextParagraphs,
          reconciledReport.issues
        ).chapterStatus;
      } else if (
        existing.stageCompleted.translation ||
        existing.status === 'completed' ||
        existing.status === 'needs_review' ||
        nextParagraphs.some((p) => p.banglaText.trim().length > 0)
      ) {
        nextStatus = 'needs_review';
      }

      return {
        ...existing,
        ...(nextOriginalText !== undefined
          ? { originalText: nextOriginalText }
          : {}),
        translatedText: nextTranslatedText,
        paragraphs: nextParagraphs,
        verificationReport: reconciledReport,
        stageCompleted: {
          ...existing.stageCompleted,
          verification: nextStageCompletedVerification,
        },
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Stage 1: Literary Understanding & Character/Terminology Extraction
  const executeStage1 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const preRequestProj = projectRef.current ?? currentProj;
    const ch =
      preRequestProj.chapters.find((c) => c.id === activeChapter.id) ||
      preRequestProj.chapters[0];
    if (!ch.originalText.trim()) {
      throw new Error('Original English text is empty. Please add English text first.');
    }

    // 1. Capture pre-request project-state snapshot before starting Stage 1 request
    const snapshotStoryContext: StoryContextProfile | null = preRequestProj.storyContext
      ? {
          ...preRequestProj.storyContext,
          importantEvents: [...(preRequestProj.storyContext.importantEvents || [])],
          locations: (preRequestProj.storyContext.locations || []).map((loc) => ({
            ...loc,
          })),
        }
      : null;
    const snapshotCharacters: CharacterMemoryItem[] = (
      preRequestProj.characterMemory || []
    ).map((c) => ({ ...c }));
    const snapshotGlossary: TerminologyMemoryItem[] = (
      preRequestProj.terminologyMemory || []
    ).map((t) => ({
      ...t,
      acceptedAlternatives: t.acceptedAlternatives
        ? [...t.acceptedAlternatives]
        : undefined,
      avoidTranslations: t.avoidTranslations ? [...t.avoidTranslations] : undefined,
    }));

    setErrorBanner(null);
    setRunningStage(1);
    setPipelineBanner('Stage 1/5: Analyzing literary context, characters, and recurring terminology...');

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stage1_understanding',
        text: ch.originalText,
        projectTitle: preRequestProj.title,
        genre: preRequestProj.genre,
        existingStoryContext: snapshotStoryContext,
        existingCharacters: snapshotCharacters,
        existingTerminology: snapshotGlossary,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 1 Literary Understanding failed');
    }

    // 2. Read authoritative latest project state from projectRef.current after async boundary
    const latestProj = projectRef.current;

    // 3. Reconcile Stage 1 AI response against pre-request snapshot and latest state
    const reconciledStage1 = reconcileStage1ResultWithLatestState({
      snapshotStoryContext,
      latestStoryContext: latestProj.storyContext,
      candidateStoryContext: data.storyContext ?? null,
      snapshotCharacters,
      latestCharacters: latestProj.characterMemory,
      extractedCharacters: Array.isArray(data.extractedCharacters)
        ? data.extractedCharacters
        : [],
      snapshotGlossary,
      latestGlossary: latestProj.terminologyMemory,
      extractedTerminology: Array.isArray(data.extractedTerminology)
        ? data.extractedTerminology
        : [],
    });

    // 4. Apply reconciled story context, character memory, and terminology memory together
    const now = new Date().toISOString();
    const updatedProj: TranslationProject = {
      ...latestProj,
      storyContext: reconciledStage1.storyContext,
      characterMemory: reconciledStage1.characterMemory,
      terminologyMemory: reconciledStage1.terminologyMemory,
      updatedAt: now,
      chapters: latestProj.chapters.map((item) =>
        item.id === ch.id
          ? {
              ...item,
              currentStage: 1,
              stageCompleted: { ...item.stageCompleted, understanding: true },
              ...(data.stage1Coverage ? { stage1Coverage: data.stage1Coverage } : {}),
              updatedAt: now,
            }
          : item
      ),
    };

    projectRef.current = updatedProj;
    onUpdateProject(updatedProj);
    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_1_understanding',
      summary: `Extracted story context, ${reconciledStage1.characterMemory.length} characters, and ${reconciledStage1.terminologyMemory.length} glossary terms.`,
    });

    return updatedProj;
  };

  // Stage 2: Author Voice & Style Profile
  const executeStage2 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const ch =
      currentProj.chapters.find((c) => c.id === activeChapter.id) || currentProj.chapters[0];
    if (!ch.originalText.trim()) {
      throw new Error('Original English text is empty.');
    }

    setErrorBanner(null);
    setRunningStage(2);
    setPipelineBanner("Stage 2/5: Analyzing original author's literary voice and building reusable Style Profile...");

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stage2_voice',
        text: ch.originalText,
        projectTitle: currentProj.title,
        authorName: currentProj.authorName,
        genre: currentProj.genre,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 2 Author Voice Analysis failed');
    }

    const updatedProj: TranslationProject = {
      ...currentProj,
      styleProfile: data.styleProfile,
      updatedAt: new Date().toISOString(),
      chapters: currentProj.chapters.map((item) =>
        item.id === ch.id
          ? {
              ...item,
              currentStage: 2,
              stageCompleted: { ...item.stageCompleted, voiceAnalysis: true },
              updatedAt: new Date().toISOString(),
            }
          : item
      ),
    };

    projectRef.current = updatedProj;
    onUpdateProject(updatedProj);
    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_2_voice',
      summary: `Generated Author Style Profile: ${data.styleProfile?.overallVoice?.slice(0, 120) || 'Completed'}`,
    });

    return updatedProj;
  };

  // Stage 3: Faithful Literary Translation (Chunked & Context-Aware)
  const executeStage3 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const initialProj = projectRef.current ?? currentProj;
    const ch =
      initialProj.chapters.find((c) => c.id === activeChapter.id) || initialProj.chapters[0];
    const englishParagraphs = splitIntoParagraphs(ch.originalText);
    if (englishParagraphs.length === 0) {
      throw new Error('Original English text has no paragraphs to translate.');
    }

    setErrorBanner(null);
    setPipelineBannerTone('success');
    setRunningStage(3);

    const preStage3Pairs = ch.paragraphs.map((p) => ({ ...p }));

    const chunks = chunkTextByParagraphs(
      ch.originalText,
      settings.maxWordsPerChunk || 500,
      2
    );

    const translatedChunks: string[][] = [];
    let prevChunkLastBangla = '';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setPipelineBanner(
        `Stage 3/5: Translating chunk ${i + 1} of ${chunks.length} (${chunk.paragraphs.length} paragraphs) using Author Style Profile & Memory...`
      );

      // 1. Capture a fresh glossary snapshot immediately before each individual chunk request
      const chunkStartProj = projectRef.current;
      const chunkGlossarySnapshot: TerminologyMemoryItem[] = (
        chunkStartProj.terminologyMemory || []
      ).map((t) => ({
        ...t,
        acceptedAlternatives: t.acceptedAlternatives
          ? [...t.acceptedAlternatives]
          : undefined,
        avoidTranslations: t.avoidTranslations ? [...t.avoidTranslations] : undefined,
      }));

      // 2. Pass that snapshot as the glossary used for the corresponding server request
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'stage3_translate_chunk',
          paragraphs: chunk.paragraphs,
          previousContextParagraphs: chunk.previousContextParagraphs,
          styleProfile: chunkStartProj.styleProfile,
          storyContext: chunkStartProj.storyContext,
          characters: chunkStartProj.characterMemory,
          terminology: chunkGlossarySnapshot,
          styleControls: chunkStartProj.styleControls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed on chunk ${i + 1} of ${chunks.length}`);
      }

      const rawChunkOutput: string[] = Array.isArray(data.translatedParagraphs)
        ? data.translatedParagraphs
        : [];
      translatedChunks.push(rawChunkOutput);

      // 3. Read latest project and glossary from projectRef.current after async boundary
      const latestAfterChunk = projectRef.current;
      const existingCh =
        latestAfterChunk.chapters.find((item) => item.id === ch.id) || ch;

      // Update partial chunk progress strictly within active chunk bounds [chunk.startParagraphIndex .. chunk.endParagraphIndex]
      // while preserving existing translations and refinement metadata outside the active chunk
      // and passing prevChunkLastBangla so echoed boundary paragraphs are stripped immediately.
      const partial = mergeStage3ChunkProgress(
        englishParagraphs,
        existingCh.paragraphs,
        chunk,
        rawChunkOutput,
        prevChunkLastBangla
      );
      const nextChunkLastBangla = partial.lastNonEmptyBangla;

      // 4. Pass snapshot, returned discoveredTerms, latest glossary, source chunk text,
      // and aligned Bangla chunk text into the orchestrator
      const chunkSourceText = chunk.paragraphs.join('\n\n');
      const alignedChunkBanglaText = partial.pairs
        .slice(chunk.startParagraphIndex, chunk.endParagraphIndex + 1)
        .map((p) => p.banglaText)
        .join('\n\n');
      const discoveredTerms: Partial<TerminologyMemoryItem>[] = Array.isArray(
        data.discoveredTerms
      )
        ? data.discoveredTerms
        : [];

      const reconciledChunkGlossary = reconcileStage3ChunkGlossaryWithLatestState({
        snapshotGlossary: chunkGlossarySnapshot,
        discoveredCandidates: discoveredTerms,
        latestGlossary: latestAfterChunk.terminologyMemory,
        chunkSourceText,
        chunkBanglaText: alignedChunkBanglaText,
      });

      // 5. Persist the reconciled glossary and partial chunk progress before proceeding to the next chunk
      const chunkCompletedAt = new Date().toISOString();
      const nextChunkProj: TranslationProject = {
        ...latestAfterChunk,
        terminologyMemory: reconciledChunkGlossary.terminologyMemory,
        updatedAt: chunkCompletedAt,
        chapters: latestAfterChunk.chapters.map((item) =>
          item.id === ch.id
            ? {
                ...item,
                status: 'in_progress',
                currentStage: 3,
                chunkCount: chunks.length,
                completedChunks: i + 1,
                translatedText: partial.fullBanglaText,
                paragraphs: partial.pairs,
                updatedAt: chunkCompletedAt,
              }
            : item
        ),
      };
      projectRef.current = nextChunkProj;
      onUpdateProject(nextChunkProj);
      prevChunkLastBangla = nextChunkLastBangla;
    }

    const { pairs, fullBanglaText, missingIndices } = assembleTranslatedChunks(
      englishParagraphs,
      translatedChunks,
      chunks,
      preStage3Pairs
    );

    const latestAtStage3End = projectRef.current;
    const updatedProj = updateChapterInProject(latestAtStage3End, ch.id, (existing) => {
      const mapping = mapSnapshotParagraphsToLatest(preStage3Pairs, pairs);
      const reconciledReport = existing.verificationReport
        ? reconcileVerificationReportAfterLocalEdit({
            previousReport: existing.verificationReport,
            previousParagraphs: preStage3Pairs,
            latestParagraphs: pairs,
            latestGlossary: latestAtStage3End.terminologyMemory,
          })
        : null;
      const keepVerificationComplete =
        mapping.allParagraphsUnchanged &&
        Boolean(existing.stageCompleted.verification && reconciledReport?.isComplete);

      return {
        ...existing,
        translatedText: fullBanglaText,
        draftTranslatedText: fullBanglaText,
        paragraphs: pairs,
        verificationReport: reconciledReport,
        status: 'needs_review',
        currentStage: 3,
        chunkCount: chunks.length,
        completedChunks: chunks.length,
        stageCompleted: {
          ...existing.stageCompleted,
          translation: true,
          verification: keepVerificationComplete,
        },
        updatedAt: new Date().toISOString(),
      };
    });

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_3_translation',
      summary:
        missingIndices.length > 0
          ? `Translated ${englishParagraphs.length - missingIndices.length}/${englishParagraphs.length} paragraphs across ${chunks.length} chunk(s) (${missingIndices.length} missing).`
          : `Translated ${englishParagraphs.length} paragraphs across ${chunks.length} chunk(s) into literary Bangla.`,
    });

    return updatedProj;
  };

  // Stage 4: Literary Editing Pass
  const executeStage4 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const preRequestProj = projectRef.current ?? currentProj;
    const ch =
      preRequestProj.chapters.find((c) => c.id === activeChapter.id) ||
      preRequestProj.chapters[0];
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    // 1. Snapshot target chapter paragraph pairs and relevant project memory before request
    const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({ ...p }));
    const engParagraphs = snapshotParagraphs.map((p) => p.englishText);
    const bnParagraphs = snapshotParagraphs.map((p) => p.banglaText);

    if (bnParagraphs.every((b) => !b.trim())) {
      throw new Error('Please run Stage 3 Translation before running Stage 4 Literary Editing.');
    }

    const snapshotCharacters: CharacterMemoryItem[] = (
      preRequestProj.characterMemory || []
    ).map((c) => ({ ...c }));
    const snapshotGlossary: TerminologyMemoryItem[] = (
      preRequestProj.terminologyMemory || []
    ).map((t) => ({
      ...t,
      acceptedAlternatives: t.acceptedAlternatives
        ? [...t.acceptedAlternatives]
        : undefined,
      avoidTranslations: t.avoidTranslations ? [...t.avoidTranslations] : undefined,
    }));
    const snapshotStyleProfile: StyleProfile | null = preRequestProj.styleProfile
      ? { ...preRequestProj.styleProfile }
      : null;
    const snapshotStyleControls: TranslationStyleControls = {
      ...preRequestProj.styleControls,
    };

    setErrorBanner(null);
    setRunningStage(4);
    setPipelineBanner(
      'Stage 4/5: Running Chief Literary Editor pass to elevate Bangla sentence flow, dialogue cadence, and word choice...'
    );

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stage4_editing',
        englishParagraphs: engParagraphs,
        banglaParagraphs: bnParagraphs,
        styleProfile: snapshotStyleProfile,
        characters: snapshotCharacters,
        terminology: snapshotGlossary,
        styleControls: snapshotStyleControls,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 4 Literary Editing failed');
    }

    // 2. Read authoritative latest project state from projectRef.current after async boundary
    const latestProj = projectRef.current;
    const latestChapter = latestProj.chapters.find((c) => c.id === targetChapterId);
    if (!latestChapter) {
      return latestProj;
    }

    // 3. Reconcile Stage 4 output against snapshot and latest paragraphs/glossary/verification report
    const reconciledStage4 = reconcileStage4ResultWithLatestState({
      snapshotParagraphs,
      latestParagraphs: latestChapter.paragraphs,
      editedParagraphs: Array.isArray(data.editedParagraphs)
        ? data.editedParagraphs
        : bnParagraphs,
      editorialNotes: Array.isArray(data.editorialNotes) ? data.editorialNotes : [],
      editorialChanges: Array.isArray(data.editorialChanges)
        ? data.editorialChanges
        : [],
      latestGlossary: latestProj.terminologyMemory,
      latestVerificationReport: latestChapter.verificationReport,
      wasVerificationCompleted: latestChapter.stageCompleted.verification,
    });

    const updatedProj = updateChapterInProject(
      latestProj,
      targetChapterId,
      (existing) => ({
        ...existing,
        translatedText: reconciledStage4.translatedText,
        paragraphs: reconciledStage4.paragraphs,
        currentStage: 4,
        editorialNotes: reconciledStage4.editorialNotes,
        editorialChanges: reconciledStage4.editorialChanges,
        verificationReport: reconciledStage4.verificationReport,
        status: reconciledStage4.chapterStatus,
        stageCompleted: {
          ...existing.stageCompleted,
          editing: true,
          verification: reconciledStage4.stageCompletedVerification,
        },
        updatedAt: new Date().toISOString(),
      })
    );

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: targetChapterId,
      chapterTitle: targetChapterTitle,
      actionType: 'stage_4_editing',
      summary:
        reconciledStage4.preservedInFlightParagraphIndices.length > 0
          ? `Completed Stage 4 Literary Editing (${reconciledStage4.editorialChanges.length} stylistic improvements applied; ${reconciledStage4.preservedInFlightParagraphIndices.length} paragraph(s) edited in flight preserved).`
          : `Completed Stage 4 Literary Editing with ${reconciledStage4.editorialChanges.length} stylistic improvements.`,
    });

    return updatedProj;
  };

  // Stage 5: Accuracy Verification
  const executeStage5 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const preRequestProj = projectRef.current ?? currentProj;
    const ch =
      preRequestProj.chapters.find((c) => c.id === activeChapter.id) ||
      preRequestProj.chapters[0];
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    // 1. Snapshot target chapter paragraphs and memory before starting Stage 5 request
    const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({ ...p }));
    const engParagraphs = snapshotParagraphs.map((p) => p.englishText);
    const bnParagraphs = snapshotParagraphs.map((p) => p.banglaText);

    if (bnParagraphs.every((b) => !b.trim())) {
      throw new Error('Please translate the chapter before running Accuracy Verification.');
    }

    const snapshotCharacters: CharacterMemoryItem[] = (
      preRequestProj.characterMemory || []
    ).map((c) => ({ ...c }));
    const snapshotGlossary: TerminologyMemoryItem[] = (
      preRequestProj.terminologyMemory || []
    ).map((t) => ({
      ...t,
      acceptedAlternatives: t.acceptedAlternatives
        ? [...t.acceptedAlternatives]
        : undefined,
      avoidTranslations: t.avoidTranslations ? [...t.avoidTranslations] : undefined,
    }));

    // 2. Increment Stage 5 sequence counter exclusively when a new Stage 5 request starts for this chapter
    const requestSeq =
      (stage5RequestSeqByChapterRef.current[targetChapterId] ?? 0) + 1;
    stage5RequestSeqByChapterRef.current[targetChapterId] = requestSeq;

    setErrorBanner(null);
    setRunningStage(5);
    setPipelineBanner(
      'Stage 5/5: Comparing Original English against Final Bangla to verify completeness, dialogue accuracy, and emotional fidelity...'
    );

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stage5_verification',
        englishParagraphs: engParagraphs,
        banglaParagraphs: bnParagraphs,
        characters: snapshotCharacters,
        terminology: snapshotGlossary,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 5 Accuracy Verification failed');
    }

    // 3. Discard response ONLY if a newer Stage 5 request for the same chapter superseded this request
    if (stage5RequestSeqByChapterRef.current[targetChapterId] !== requestSeq) {
      return projectRef.current;
    }

    // 4. Read authoritative latest project state from projectRef.current and reconcile via reconcileStage5ResultWithLatestState
    const latestProj = projectRef.current;
    const latestChapter = latestProj.chapters.find((c) => c.id === targetChapterId);
    if (!latestChapter) {
      return latestProj;
    }

    const reconciledStage5 = reconcileStage5ResultWithLatestState({
      snapshotParagraphs,
      latestParagraphs: latestChapter.paragraphs,
      aiReport: data.report,
      latestGlossary: latestProj.terminologyMemory,
      previousVerificationReport: latestChapter.verificationReport,
    });

    const updatedProj = updateChapterInProject(
      latestProj,
      targetChapterId,
      (existing) => ({
        ...existing,
        currentStage: 5,
        verificationReport: reconciledStage5.verificationReport,
        status: reconciledStage5.chapterStatus,
        stageCompleted: {
          ...existing.stageCompleted,
          verification: reconciledStage5.stageCompletedVerification,
        },
        updatedAt: new Date().toISOString(),
      })
    );

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: targetChapterId,
      chapterTitle: targetChapterTitle,
      actionType: 'stage_5_verification',
      summary: reconciledStage5.allParagraphsVerified
        ? `Accuracy Verification Score: ${reconciledStage5.verificationReport.overallScore}% (${reconciledStage5.verificationReport.issues.length} items flagged).`
        : `Partial Accuracy Verification (${reconciledStage5.verifiedParagraphIndices.length}/${latestChapter.paragraphs.length} paragraphs verified; ${reconciledStage5.unverifiedParagraphIndices.length} changed in flight require re-verification).`,
    });

    return updatedProj;
  };

  // Full 5-Stage Automated Adaptive Pipeline
  const handleRunFullPipeline = async () => {
    try {
      setErrorBanner(null);
      setPipelineBannerTone('success');
      let cur = projectRef.current;

      // Always run Stage 1 to extract context/characters from current chapter
      cur = await executeStage1(cur);

      // Run Stage 2 if no Style Profile exists yet, or to calibrate voice
      if (!cur.styleProfile) {
        cur = await executeStage2(cur);
      }

      // Stage 3: Faithful Literary Translation
      cur = await executeStage3(cur);

      // Stage 4: Literary Editing Pass
      cur = await executeStage4(cur);

      // Stage 5: Accuracy Verification
      cur = await executeStage5(cur);

      const finalCh =
        cur.chapters.find((c) => c.id === activeChapter.id) || cur.chapters[0];
      const hasUnresolvedHigh = (finalCh.verificationReport?.issues || []).some(
        (i: VerificationIssue) => i.severity === 'high' && !i.resolved
      );
      const completion = getPipelineCompletionState(
        finalCh.paragraphs,
        hasUnresolvedHigh
      );

      if (!finalCh.stageCompleted.verification) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Pipeline finished with partial verification because paragraphs or glossary rules changed during verification. Re-run Stage 5 to verify all paragraphs.'
        );
      } else {
        setPipelineBannerTone(completion.bannerTone);
        setPipelineBanner(completion.bannerMessage);
        if (completion.isComplete) {
          setTimeout(() => setPipelineBanner(null), 5000);
        }
      }
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Pipeline execution encountered an error.'
      );
      setPipelineBanner(null);
    } finally {
      setRunningStage(0);
    }
  };

  // Trigger auto-pipeline if requested upon project creation
  useEffect(() => {
    if (
      autoRunPipelineTrigger > 0 &&
      autoRunPipelineTrigger !== lastTriggerRef.current
    ) {
      lastTriggerRef.current = autoRunPipelineTrigger;
      handleRunFullPipeline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunPipelineTrigger]);

  // Individual Paragraph Refinement Handler (Movement-Safe Sequencing & Fingerprint Guard)
  const handleRefineParagraph = async (
    paragraphIndex: number,
    action: ParagraphRefinementAction
  ) => {
    const preRequestProj = projectRef.current;
    const ch =
      preRequestProj.chapters.find((c) => c.id === activeChapter.id) ||
      preRequestProj.chapters[0];
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({ ...p }));
    const pair = snapshotParagraphs[paragraphIndex];
    if (!pair) return;

    const snapshotTargetFp = computeParagraphContentFingerprint(
      pair.englishText,
      pair.banglaText
    );
    const normTargetEn = normalizeEnglishTerm(pair.englishText);
    const isDuplicateEnglishInSnapshot =
      snapshotParagraphs.filter(
        (p) => normalizeEnglishTerm(p.englishText) === normTargetEn
      ).length > 1;

    // Supersede any older in-flight refinement request for the same underlying paragraph,
    // even if an insertion or deletion shifted its index between the two requests.
    const reqId = ++refineRequestSeqRef.current;
    activeRefineRequestsRef.current = activeRefineRequestsRef.current.filter(
      (oldReq) => {
        if (oldReq.chapterId !== targetChapterId) {
          return true;
        }
        const mapOldToCurrent = mapSnapshotParagraphsToLatest(
          oldReq.snapshotParagraphs,
          snapshotParagraphs
        );
        const oldMappedToCurrentIdx = mapOldToCurrent.snapToLatestIndex.get(
          oldReq.snapshotIndex
        );
        if (oldMappedToCurrentIdx === paragraphIndex) {
          return false; // Superseded: same mapped paragraph slot
        }
        if (
          !isDuplicateEnglishInSnapshot &&
          !oldReq.isDuplicateEnglishInSnapshot &&
          oldReq.snapshotTargetFp === snapshotTargetFp
        ) {
          return false; // Superseded: unique paragraph with identical content fingerprint
        }
        return true;
      }
    );

    activeRefineRequestsRef.current.push({
      reqId,
      chapterId: targetChapterId,
      snapshotParagraphs,
      snapshotIndex: paragraphIndex,
      snapshotTargetFp,
      isDuplicateEnglishInSnapshot,
    });

    setErrorBanner(null);
    setRefiningParagraphIdx(paragraphIndex);

    try {
      const prevEng = snapshotParagraphs[paragraphIndex - 1]?.englishText;
      const nextEng = snapshotParagraphs[paragraphIndex + 1]?.englishText;

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'refine_paragraph',
          englishParagraph: pair.englishText,
          currentBanglaParagraph: pair.banglaText,
          previousEnglishParagraph: prevEng,
          nextEnglishParagraph: nextEng,
          action,
          customInstruction: customParagraphNote.trim() || undefined,
          styleProfile: preRequestProj.styleProfile,
          characters: preRequestProj.characterMemory,
          terminology: preRequestProj.terminologyMemory,
          styleControls: preRequestProj.styleControls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Paragraph refinement failed');
      }

      // Check if this request is still active (not superseded by a newer request for the same paragraph)
      const stillActive = activeRefineRequestsRef.current.some(
        (r) => r.reqId === reqId
      );
      if (!stillActive) {
        return;
      }
      activeRefineRequestsRef.current = activeRefineRequestsRef.current.filter(
        (r) => r.reqId !== reqId
      );

      const latestProj = projectRef.current;
      const latestChapter = latestProj.chapters.find((c) => c.id === targetChapterId);
      if (!latestChapter) {
        return;
      }

      const mapping = mapSnapshotParagraphsToLatest(
        snapshotParagraphs,
        latestChapter.paragraphs
      );
      const mappedLatestIdx = mapping.snapToLatestIndex.get(paragraphIndex);
      const isDuplicateEnglishInLatest =
        latestChapter.paragraphs.filter(
          (p) => normalizeEnglishTerm(p.englishText) === normTargetEn
        ).length > 1;

      const rejectedAmbiguousDuplicate =
        (isDuplicateEnglishInSnapshot || isDuplicateEnglishInLatest) &&
        mapping.hasStructuralChange;

      const latestTargetPair =
        mappedLatestIdx !== undefined
          ? latestChapter.paragraphs[mappedLatestIdx]
          : undefined;
      const latestTargetFp = latestTargetPair
        ? computeParagraphContentFingerprint(
            latestTargetPair.englishText,
            latestTargetPair.banglaText
          )
        : '';

      if (
        rejectedAmbiguousDuplicate ||
        mappedLatestIdx === undefined ||
        !mapping.unchangedLatestIndices.has(mappedLatestIdx) ||
        !latestTargetPair ||
        latestTargetFp !== snapshotTargetFp
      ) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          `Paragraph #${paragraphIndex + 1} was modified or moved while refinement was running; your latest text was preserved.`
        );
        return;
      }

      const updatedProj = applyChapterLocalEditWithReconciliation(
        targetChapterId,
        (existing) => {
          const newPairs = existing.paragraphs.map((item, idx) =>
            idx === mappedLatestIdx
              ? updateParagraphTranslation(item, data.refinedBangla, {
                  previousBanglaText: item.banglaText,
                  lastRefinementAction: action,
                  refinementRationale: data.rationale,
                  markEmptyAsMissing: true,
                })
              : item
          );
          const fullBangla = joinParagraphsWithSceneBreaks(newPairs, {
            field: 'banglaText',
            omitEmpty: true,
          });
          return {
            nextParagraphs: newPairs,
            nextTranslatedText: fullBangla,
          };
        }
      );

      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: targetChapterTitle,
        actionType: 'paragraph_refinement',
        summary: `Refined Paragraph ${mappedLatestIdx + 1} (${action.replace(/_/g, ' ')}): ${data.rationale}`,
        paragraphIndex: mappedLatestIdx,
        previousText: latestTargetPair.banglaText,
        newText: data.refinedBangla,
      });

      setCustomParagraphNote('');
    } catch (err: unknown) {
      activeRefineRequestsRef.current = activeRefineRequestsRef.current.filter(
        (r) => r.reqId !== reqId
      );
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not refine paragraph.'
      );
    } finally {
      if (activeRefineRequestsRef.current.length === 0) {
        setRefiningParagraphIdx(null);
      }
    }
  };

  // Manual edit of a single Bangla paragraph
  const handleManualParagraphChange = (paragraphIndex: number, newBangla: string) => {
    applyChapterLocalEditWithReconciliation(activeChapter.id, (existing) => {
      const newPairs = existing.paragraphs.map((item, idx) => {
        if (idx !== paragraphIndex) return item;
        const shouldCapturePrevious =
          item.previousBanglaText === undefined ||
          item.previousBanglaText === null ||
          item.lastRefinementAction !== 'manual_edit';
        return updateParagraphTranslation(item, newBangla, {
          previousBanglaText: shouldCapturePrevious
            ? item.banglaText
            : item.previousBanglaText,
          lastRefinementAction: 'manual_edit',
        });
      });
      const fullBangla = joinParagraphsWithSceneBreaks(newPairs, {
        field: 'banglaText',
        omitEmpty: true,
      });
      return {
        nextParagraphs: newPairs,
        nextTranslatedText: fullBangla,
      };
    });
  };

  // Revert a single paragraph to its previous version
  const handleRevertParagraph = (paragraphIndex: number) => {
    const latestProj = projectRef.current;
    const currentCh =
      latestProj.chapters.find((c) => c.id === activeChapter.id) ||
      latestProj.chapters[0];
    const pair = currentCh?.paragraphs[paragraphIndex];
    if (
      !pair ||
      pair.previousBanglaText === undefined ||
      pair.previousBanglaText === null
    ) {
      return;
    }

    applyChapterLocalEditWithReconciliation(currentCh.id, (existing) => {
      const newPairs = existing.paragraphs.map((item, idx) =>
        idx === paragraphIndex ? revertParagraphTranslation(item) : item
      );
      const fullBangla = joinParagraphsWithSceneBreaks(newPairs, {
        field: 'banglaText',
        omitEmpty: true,
      });
      return {
        nextParagraphs: newPairs,
        nextTranslatedText: fullBangla,
      };
    });
  };

  // Continuous source or target text change
  const handleContinuousSourceChange = (newEnglish: string) => {
    applyChapterLocalEditWithReconciliation(activeChapter.id, (existing) => {
      const aligned = alignParagraphs(newEnglish, '', existing.paragraphs);
      const syncedBangla = joinParagraphsWithSceneBreaks(aligned, {
        field: 'banglaText',
        omitEmpty: true,
      });
      return {
        nextOriginalText: newEnglish,
        nextParagraphs: aligned,
        nextTranslatedText: syncedBangla,
      };
    });
  };

  const handleContinuousBanglaChange = (newBangla: string) => {
    const latestProj = projectRef.current;
    const currentCh =
      latestProj.chapters.find((c) => c.id === activeChapter.id) ||
      latestProj.chapters[0];
    const result = applyContinuousBanglaEdit(
      currentCh.originalText,
      newBangla,
      currentCh.paragraphs
    );
    if (!result.applied) {
      if (result.reason) {
        setErrorBanner(result.reason);
      }
      return;
    }
    applyChapterLocalEditWithReconciliation(currentCh.id, () => ({
      nextParagraphs: result.paragraphs,
      nextTranslatedText: result.translatedText,
    }));
  };

  // Add New Chapter to Project
  const handleCreateChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChText.trim()) return;

    const nextNum = project.chapters.length + 1;
    const chTitle = newChTitle.trim() || `Chapter ${nextNum}`;
    const chunks = chunkTextByParagraphs(newChText, settings.maxWordsPerChunk || 500);
    const now = new Date().toISOString();

    const created: Chapter = {
      id: `ch-${Date.now()}`,
      number: nextNum,
      title: chTitle,
      originalText: newChText.trim(),
      translatedText: '',
      paragraphs: alignParagraphs(newChText, ''),
      status: 'pending',
      currentStage: 0,
      stageCompleted: {
        understanding: false,
        voiceAnalysis: Boolean(project.styleProfile),
        translation: false,
        editing: false,
        verification: false,
      },
      editorialNotes: [],
      editorialChanges: [],
      verificationReport: null,
      chunkCount: Math.max(1, chunks.length),
      completedChunks: 0,
      updatedAt: now,
    };

    const updatedProj: TranslationProject = {
      ...project,
      updatedAt: now,
      chapters: [...project.chapters, created],
    };

    projectRef.current = updatedProj;
    onUpdateProject(updatedProj);
    onSelectChapter(created.id);
    setNewChTitle('');
    setNewChText('');
    setShowAddChapter(false);
  };

  const handleManualSaveClick = () => {
    onUpdateProject({ ...project, updatedAt: new Date().toISOString() });
    onLogHistory({
      projectId: project.id,
      projectTitle: project.title,
      chapterId: activeChapter.id,
      chapterTitle: activeChapter.title,
      actionType: 'manual_save',
      summary: `Saved chapter "${activeChapter.title}" (${activeChapter.paragraphs.length} paragraphs).`,
    });
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const translatedParagraphCount = activeChapter.paragraphs.filter(
    (p) => p.banglaText.trim().length > 0
  ).length;
  const totalParagraphCount = activeChapter.paragraphs.length;
  const missingParagraphIndices = activeChapter.paragraphs
    .filter((p) => Boolean(p.missingTranslation))
    .map((p) => p.index);
  const hasMissingTranslations = missingParagraphIndices.length > 0;
  const hasUnresolvedHighVerificationIssues = (
    activeChapter.verificationReport?.issues || []
  ).some((i) => i.severity === 'high' && !i.resolved);
  const continuousBanglaGuard = canEditContinuousBangla(activeChapter.paragraphs);
  const isAnyOperationRunning = runningStage !== 0 || refiningParagraphIdx !== null;
  const isVerificationPartialOrDet = Boolean(
    activeChapter.verificationReport?.fidelitySummary &&
      PARTIAL_OR_DET_SUMMARY_PREFIX_RE.test(
        activeChapter.verificationReport.fidelitySummary
      )
  );
  const isDeterministicOnlyReport = Boolean(
    activeChapter.verificationReport?.fidelitySummary &&
      /^Deterministic terminology check/i.test(
        activeChapter.verificationReport.fidelitySummary
      )
  );
  const isFullChapterVerified = Boolean(
    activeChapter.verificationReport &&
      activeChapter.stageCompleted.verification &&
      !isVerificationPartialOrDet
  );

  return (
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-6 space-y-6">
      {/* Top Studio Header Bar */}
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
            <span className="font-semibold text-[#9A3412]">{project.genre}</span>
            <span aria-hidden="true">·</span>
            <span>Author: {project.authorName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {project.sourceLanguage} → {project.targetLanguage}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#1C1917]">
            {project.title}
          </h1>
        </div>

        {/* Chapter Switcher + Save + Export */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Chapter Selector */}
          <select
            aria-label="Select Active Chapter"
            value={activeChapter.id}
            onChange={(e) => onSelectChapter(e.target.value)}
            className="px-3.5 py-2 text-xs font-semibold text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
          >
            {project.chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.title} (
                {ch.status === 'completed'
                  ? 'Completed'
                  : ch.status === 'needs_review'
                    ? 'Needs Review'
                    : 'Pending'}
                )
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowAddChapter(!showAddChapter)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-[#9A3412]" />
            <span>Add Chapter</span>
          </button>

          <button
            type="button"
            onClick={handleManualSaveClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {saveToast ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                <span className="text-[#16A34A] font-semibold">Saved</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 text-[#57534E]" />
                <span>Save</span>
              </>
            )}
          </button>

          {/* Export Chapter TXT */}
          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${project.title.toLowerCase().replace(/\s+/g, '-')}-${activeChapter.title.toLowerCase().replace(/\s+/g, '-')}.txt`,
                formatChapterExport(project.title, activeChapter)
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#9A3412]" />
            <span>Export Chapter TXT</span>
          </button>

          {/* Export Full Story TXT */}
          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${project.title.toLowerCase().replace(/\s+/g, '-')}-complete-bangla.txt`,
                formatFullStoryExport(project)
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#57534E]" />
            <span>Export Full Story TXT</span>
          </button>

          {/* Export Bilingual Project TXT */}
          <button
            type="button"
            onClick={() =>
              downloadFile(
                `${project.title.toLowerCase().replace(/\s+/g, '-')}-bilingual.txt`,
                formatBilingualExport(project)
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#57534E]" />
            <span>Export Bilingual TXT</span>
          </button>
        </div>
      </div>

      {/* Optional Add Chapter Drawer */}
      {showAddChapter && (
        <form
          onSubmit={handleCreateChapter}
          className="bg-[#F3EFEA] border border-[#E5E0D8] rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl font-semibold text-[#1C1917]">
              Add New Chapter to {project.title}
            </h3>
            <span className="text-xs text-[#57534E]">
              Inherits Project Style Profile, Character Memory & Terminology Memory
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={newChTitle}
              onChange={(e) => setNewChTitle(e.target.value)}
              placeholder={`Chapter ${project.chapters.length + 1}: Title`}
              aria-label="New Chapter Title"
              className="px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
            />
          </div>
          <textarea
            rows={5}
            value={newChText}
            onChange={(e) => setNewChText(e.target.value)}
            placeholder="Paste the English text for this chapter..."
            aria-label="New Chapter English Text"
            className="w-full p-3.5 text-xs bg-white border border-[#D6CFC5] rounded-lg"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddChapter(false)}
              className="px-3.5 py-1.5 text-xs text-[#57534E] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] cursor-pointer"
            >
              Save & Switch to Chapter
            </button>
          </div>
        </form>
      )}

      {/* 5-Stage Multi-Stage Translation Workflow Bar */}
      <div className="bg-[#F3EFEA] border border-[#E5E0D8] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Stage 1 */}
            <button
              type="button"
              disabled={isAnyOperationRunning}
              onClick={async () => {
                try {
                  await executeStage1();
                  setPipelineBanner(null);
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 1 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.understanding
                  ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                  : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 1 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : activeChapter.stageCompleted.understanding ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">01.</span>
              )}
              <span>Literary Understanding</span>
            </button>

            {/* Stage 2 */}
            <button
              type="button"
              disabled={isAnyOperationRunning}
              onClick={async () => {
                try {
                  await executeStage2();
                  setPipelineBanner(null);
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 2 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.voiceAnalysis || project.styleProfile
                  ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                  : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 2 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : activeChapter.stageCompleted.voiceAnalysis || project.styleProfile ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">02.</span>
              )}
              <span>Author Voice Profile</span>
            </button>

            {/* Stage 3 */}
            <button
              type="button"
              disabled={isAnyOperationRunning}
              onClick={async () => {
                try {
                  await executeStage3();
                  setPipelineBanner(null);
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 3 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                hasMissingTranslations
                  ? 'bg-[#FFFBEB] border-[#F59E0B] text-[#92400E]'
                  : activeChapter.stageCompleted.translation
                    ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                    : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 3 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : hasMissingTranslations ? (
                <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
              ) : activeChapter.stageCompleted.translation ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">03.</span>
              )}
              <span>
                Faithful Translation
                {hasMissingTranslations
                  ? ` (${missingParagraphIndices.length} Missing)`
                  : ''}
              </span>
            </button>

            {/* Stage 4 */}
            <button
              type="button"
              disabled={isAnyOperationRunning}
              onClick={async () => {
                try {
                  await executeStage4();
                  setPipelineBanner(null);
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 4 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.editing
                  ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                  : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 4 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : activeChapter.stageCompleted.editing ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">04.</span>
              )}
              <span>Literary Editing</span>
            </button>

            {/* Stage 5 */}
            <button
              type="button"
              disabled={isAnyOperationRunning}
              onClick={async () => {
                try {
                  const updated = await executeStage5();
                  const finalCh =
                    updated.chapters.find((c) => c.id === activeChapter.id) ||
                    updated.chapters[0];
                  if (!finalCh.stageCompleted.verification) {
                    setPipelineBannerTone('warning');
                    setPipelineBanner(
                      `Stage 5 verification reconciled with concurrent chapter edits. Some paragraphs remain unverified—please re-run Stage 5 to complete full-chapter verification.`
                    );
                  } else {
                    const hasUnresolvedHigh = (
                      finalCh.verificationReport?.issues || []
                    ).some((i) => i.severity === 'high' && !i.resolved);
                    const completion = getPipelineCompletionState(
                      finalCh.paragraphs,
                      hasUnresolvedHigh
                    );
                    if (!completion.isComplete) {
                      setPipelineBannerTone(completion.bannerTone);
                      setPipelineBanner(completion.bannerMessage);
                    } else {
                      setPipelineBanner(null);
                    }
                  }
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.verification &&
                (hasMissingTranslations || hasUnresolvedHighVerificationIssues)
                  ? 'bg-[#FFFBEB] border-[#F59E0B] text-[#92400E]'
                  : activeChapter.stageCompleted.verification
                    ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                    : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 5 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : activeChapter.stageCompleted.verification &&
                (hasMissingTranslations || hasUnresolvedHighVerificationIssues) ? (
                <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
              ) : activeChapter.stageCompleted.verification ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">05.</span>
              )}
              <span>Accuracy Verification</span>
            </button>
          </div>

          {/* Primary Action: Run Complete 5-Stage Adaptive Pipeline */}
          <button
            type="button"
            disabled={isAnyOperationRunning}
            onClick={handleRunFullPipeline}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
          >
            {runningStage !== 0 ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Stage {runningStage} of 5...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Run Full 5-Stage Adaptive Translation</span>
              </>
            )}
          </button>
        </div>

        {/* Live Progress or Error Feedback */}
        {pipelineBanner && (
          <div
            className={`p-3 rounded-lg flex items-center gap-2.5 text-xs ${
              runningStage === 0 &&
              (pipelineBannerTone === 'warning' || hasMissingTranslations)
                ? 'bg-[#FFFBEB] border border-[#F59E0B] text-[#92400E]'
                : 'bg-white border border-[#D6CFC5] text-[#1C1917]'
            }`}
          >
            {runningStage !== 0 ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#9A3412] shrink-0" />
            ) : pipelineBannerTone === 'warning' || hasMissingTranslations ? (
              <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            )}
            <span>{pipelineBanner}</span>
          </div>
        )}

        {errorBanner && (
          <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center justify-between gap-3 text-xs text-[#991B1B]">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="underline font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Summary Warning Banner when Stage 3 left missing paragraph translations */}
        {hasMissingTranslations && (
          <div
            role="alert"
            className="p-3 bg-[#FFFBEB] border border-[#F59E0B] rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs text-[#92400E]"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
              <span>
                <strong>Incomplete Translation Warning:</strong>{' '}
                {missingParagraphIndices.length}{' '}
                {missingParagraphIndices.length === 1 ? 'paragraph is' : 'paragraphs are'}{' '}
                missing a Bangla translation (Paragraph{' '}
                {missingParagraphIndices.map((idx) => `#${idx + 1}`).join(', ')}). Original
                paragraph positions were preserved—please edit or retry the highlighted{' '}
                {missingParagraphIndices.length === 1 ? 'paragraph' : 'paragraphs'} below.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubTab('manuscript');
                setEditorMode('paragraphs');
                setSelectedParagraphIdx(missingParagraphIndices[0]);
              }}
              className="px-2.5 py-1 text-xs font-semibold text-[#92400E] bg-[#FEF3C7] hover:bg-[#FDE68A] border border-[#F59E0B] rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              Jump to Paragraph #{missingParagraphIndices[0] + 1}
            </button>
          </div>
        )}
      </div>

      {/* Studio Sub-Navigation Tabs + Progress Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('manuscript')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'manuscript'
                ? 'bg-[#1C1917] text-white font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917] bg-[#F3EFEA]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Side-by-Side Manuscript ({translatedParagraphCount}/{totalParagraphCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('voice')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'voice'
                ? 'bg-[#1C1917] text-white font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917] bg-[#F3EFEA]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Author Voice & Style Controls</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('memory')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'memory'
                ? 'bg-[#1C1917] text-white font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917] bg-[#F3EFEA]'
            }`}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span>
              Context & Memory Vault ({project.characterMemory.length + project.terminologyMemory.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('verification')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'verification'
                ? 'bg-[#1C1917] text-white font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917] bg-[#F3EFEA]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>
              Editorial & Accuracy Audit
              {isFullChapterVerified && activeChapter.verificationReport
                ? ` (${activeChapter.verificationReport.overallScore}%)`
                : activeChapter.verificationReport && isDeterministicOnlyReport
                  ? ' (Terminology Check)'
                  : activeChapter.verificationReport
                    ? ' (Re-verify Needed)'
                    : ''}
            </span>
          </button>
        </div>

        {/* Editor Mode Switcher when on Manuscript Tab */}
        {subTab === 'manuscript' && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#57534E] font-mono-num">
              {countWords(activeChapter.originalText)} English words ·{' '}
              {activeChapter.chunkCount} {activeChapter.chunkCount === 1 ? 'chunk' : 'chunks'}
            </span>

            <div className="flex items-center gap-1 p-1 bg-[#F3EFEA] border border-[#E5E0D8] rounded-lg">
              <button
                type="button"
                onClick={() => setEditorMode('paragraphs')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  editorMode === 'paragraphs'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Paragraph Studio
              </button>
              <button
                type="button"
                onClick={() => setEditorMode('continuous')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  editorMode === 'continuous'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Full-Chapter Editors
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sub-Tab 1: Side-by-Side Manuscript Editor */}
      {subTab === 'manuscript' && (
        <div className="space-y-4">
          {editorMode === 'paragraphs' ? (
            <div className="space-y-4">
              {/* Column Headers */}
              <div className="hidden lg:grid lg:grid-cols-12 gap-6 px-4 text-xs font-semibold text-[#57534E]">
                <div className="lg:col-span-6">
                  Original English Passage ({activeChapter.title})
                </div>
                <div className="lg:col-span-6 flex items-center justify-between">
                  <span>Adaptive Literary Bangla (সাহিত্যিক বাংলা অনুবাদ — ক্লিক করে অনুচ্ছেদ সম্পাদনা করুন)</span>
                </div>
              </div>

              {activeChapter.paragraphs.map((pair, idx) => {
                const isSelected = selectedParagraphIdx === idx;
                const isRefiningThis = refiningParagraphIdx === idx;
                const isMissing = Boolean(pair.missingTranslation);

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedParagraphIdx(idx)}
                    className={`rounded-xl border transition-colors p-5 space-y-4 ${
                      isMissing
                        ? 'bg-[#FFFDF9] border-[#F59E0B] shadow-xs'
                        : isSelected
                          ? 'bg-white border-[#9A3412] shadow-xs'
                          : 'bg-white border-[#E5E0D8] hover:border-[#D6CFC5]'
                    }`}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Left: English Paragraph */}
                      <div className="lg:col-span-6 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-[#78716C] font-mono-num">
                          <span>Paragraph {idx + 1} · English Source</span>
                          {pair.sceneBreakAfter && (
                            <span className="px-2 py-0.5 rounded bg-[#F3EFEA] text-[#57534E] font-mono text-[10px]">
                              Scene Break After ({pair.sceneBreakMarker || 'Blank Lines'})
                            </span>
                          )}
                        </div>
                        <p
                          className="text-[#1C1917] leading-relaxed select-text"
                          style={{ fontSize: `${settings.englishFontSize}px` }}
                        >
                          {pair.englishText}
                        </p>
                      </div>

                      {/* Right: Editable Bangla Paragraph */}
                      <div className="lg:col-span-6 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#78716C]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num">
                              অনুচ্ছেদ {idx + 1} · বাংলা অনুবাদ
                            </span>
                            {isMissing && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FEF3C7] border border-[#F59E0B] text-[#92400E] font-semibold">
                                <AlertCircle className="w-3 h-3 text-[#D97706]" />
                                <span>Missing Translation</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isMissing && (
                              <button
                                type="button"
                                disabled={isRefiningThis || runningStage !== 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRefineParagraph(idx, 'match_author_style');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#9A3412] text-white font-semibold hover:bg-[#7C2D12] disabled:opacity-50 cursor-pointer"
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                <span>Retry Translation</span>
                              </button>
                            )}
                            {!isMissing && pair.lastRefinementAction && (
                              <span className="text-[#9A3412]">
                                Refined ({pair.lastRefinementAction.replace(/_/g, ' ')})
                              </span>
                            )}
                          </div>
                        </div>
                        <textarea
                          rows={Math.max(
                            4,
                            Math.ceil(
                              Math.max(pair.englishText.length, pair.banglaText.length) / 62
                            ) + 1
                          )}
                          value={pair.banglaText}
                          onChange={(e) =>
                            handleManualParagraphChange(idx, e.target.value)
                          }
                          placeholder={
                            isMissing
                              ? 'সতর্কবার্তা: এই অনুচ্ছেদটির অনুবাদ পাওয়া যায়নি। এখানে সরাসরি বাংলা লিখুন অথবা "Retry Translation" বোতামে ক্লিক করুন...'
                              : 'এই অনুচ্ছেদের বাংলা অনুবাদ এখানে প্রদর্শিত হবে...'
                          }
                          aria-label={`Bangla translation for paragraph ${idx + 1}`}
                          style={{ fontSize: `${settings.banglaFontSize}px` }}
                          className={`w-full p-3 font-bangla text-[#1C1917] rounded-lg focus:outline-none focus:bg-white transition-colors ${
                            isMissing
                              ? 'bg-[#FFFBEB] border border-[#F59E0B] focus:border-[#D97706]'
                              : 'bg-[#FAF8F5] border border-[#E5E0D8] focus:border-[#9A3412]'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Paragraph-Level AI Refinement Studio (Shown when paragraph is selected) */}
                    {isSelected && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="pt-3 border-t border-[#E5E0D8] space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#1C1917]">
                            Paragraph {idx + 1} Literary Refinement Controls (Edits only this paragraph):
                          </span>
                          {pair.previousBanglaText !== undefined &&
                            pair.previousBanglaText !== null && (
                              <button
                                type="button"
                                onClick={() => handleRevertParagraph(idx)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#9A3412] hover:underline cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Revert to Previous Version</span>
                              </button>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {PARAGRAPH_REFINEMENT_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={isRefiningThis || runningStage !== 0}
                              onClick={() => handleRefineParagraph(idx, opt.id)}
                              className="px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#F3EFEA] hover:bg-[#EAE4DC] border border-[#D6CFC5] rounded-lg transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <span>{opt.label}</span>
                              <span className="text-[#78716C] ml-1.5 font-bangla text-[11px]">
                                · {opt.banglaHint}
                              </span>
                            </button>
                          ))}
                        </div>

                        {/* Optional custom instruction for this paragraph */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={customParagraphNote}
                            onChange={(e) => setCustomParagraphNote(e.target.value)}
                            placeholder="Optional specific note for this paragraph (e.g., 'Use তুমি instead of আপনি in this line')..."
                            aria-label={`Custom instruction for paragraph ${idx + 1}`}
                            className="flex-1 px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg"
                          />
                          {isRefiningThis && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9A3412]">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Refining paragraph...</span>
                            </span>
                          )}
                        </div>

                        {/* Comparison with Previous Version */}
                        {pair.previousBanglaText !== undefined &&
                          pair.previousBanglaText !== null &&
                          pair.previousBanglaText !== pair.banglaText && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg">
                              <div>
                                <div className="text-[11px] font-semibold text-[#78716C] mb-1">
                                  Previous Paragraph Version
                                </div>
                                <p className="font-bangla text-sm text-[#57534E]">
                                  {pair.previousBanglaText || '(Empty / Untranslated)'}
                                </p>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold text-[#9A3412] mb-1">
                                  Current Revised Version
                                  {pair.refinementRationale
                                    ? ` — ${pair.refinementRationale}`
                                    : ''}
                                </div>
                                <p className="font-bangla text-sm text-[#1C1917]">
                                  {pair.banglaText || '(Empty / Untranslated)'}
                                </p>
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Continuous Full-Chapter Side-by-Side Text Editors */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-[#E5E0D8] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-[#E5E0D8] pb-2.5">
                  <span className="text-xs font-semibold text-[#1C1917]">
                    Original English Manuscript ({activeChapter.title})
                  </span>
                  <span className="text-xs text-[#78716C] font-mono-num">
                    {countWords(activeChapter.originalText)} words
                  </span>
                </div>
                <textarea
                  rows={22}
                  value={activeChapter.originalText}
                  onChange={(e) => handleContinuousSourceChange(e.target.value)}
                  aria-label="Original English Chapter Editor"
                  style={{ fontSize: `${settings.englishFontSize}px` }}
                  className="w-full p-3 leading-relaxed bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg focus:outline-none focus:border-[#9A3412]"
                />
              </div>

              <div className="bg-white border border-[#E5E0D8] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-[#E5E0D8] pb-2.5">
                  <span className="text-xs font-semibold text-[#1C1917]">
                    Translated Bangla Manuscript (বাংলা সাহিত্যিক অনুবাদ)
                  </span>
                  <span className="text-xs text-[#78716C] font-mono-num">
                    {countWords(activeChapter.translatedText)} words
                  </span>
                </div>

                {!continuousBanglaGuard.allowed && (
                  <div
                    role="status"
                    className="p-3 bg-[#FFFBEB] border border-[#F59E0B] rounded-lg space-y-2 text-xs text-[#92400E]"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                      <span>
                        <strong>Continuous Bangla Editor Locked:</strong>{' '}
                        {continuousBanglaGuard.reason}
                      </span>
                    </div>
                    {continuousBanglaGuard.missingIndices.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditorMode('paragraphs');
                            setSelectedParagraphIdx(continuousBanglaGuard.missingIndices[0]);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-[#92400E] bg-[#FEF3C7] hover:bg-[#FDE68A] border border-[#F59E0B] rounded-md cursor-pointer"
                        >
                          Open Paragraph Studio (Paragraph #
                          {continuousBanglaGuard.missingIndices[0] + 1})
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <textarea
                  rows={22}
                  value={activeChapter.translatedText}
                  readOnly={!continuousBanglaGuard.allowed}
                  onChange={(e) => handleContinuousBanglaChange(e.target.value)}
                  placeholder="বাংলা অনুবাদ এখানে সম্পাদনা করুন..."
                  aria-label="Translated Bangla Chapter Editor"
                  style={{ fontSize: `${settings.banglaFontSize}px` }}
                  className={`w-full p-3 font-bangla leading-relaxed border rounded-lg focus:outline-none ${
                    continuousBanglaGuard.allowed
                      ? 'bg-[#FAF8F5] border-[#E5E0D8] focus:border-[#9A3412]'
                      : 'bg-[#F5F2EB] border-[#E5E0D8] text-[#57534E] cursor-text'
                  }`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Author Voice & Style Controls */}
      {subTab === 'voice' && (
        <VoiceAndControlsPanel
          styleProfile={project.styleProfile}
          styleControls={project.styleControls}
          isRunningStage2={runningStage === 2}
          onRunStage2={async () => {
            try {
              await executeStage2();
              setPipelineBanner(null);
            } catch (e: unknown) {
              setErrorBanner(e instanceof Error ? e.message : 'Stage 2 error');
            } finally {
              setRunningStage(0);
            }
          }}
          onUpdateStyleProfile={(updatedProfile) => {
            const nextProj: TranslationProject = {
              ...projectRef.current,
              styleProfile: updatedProfile,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateStyleControls={(updatedControls) => {
            const nextProj: TranslationProject = {
              ...projectRef.current,
              styleControls: updatedControls,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
        />
      )}

      {/* Sub-Tab 3: Story Context, Character Memory & Terminology Memory */}
      {subTab === 'memory' && (
        <ContextAndMemoryPanel
          storyContext={project.storyContext}
          characters={project.characterMemory}
          terminology={project.terminologyMemory}
          isRunningStage1={runningStage === 1}
          onRunStage1={async () => {
            try {
              await executeStage1();
              setPipelineBanner(null);
            } catch (e: unknown) {
              setErrorBanner(e instanceof Error ? e.message : 'Stage 1 error');
            } finally {
              setRunningStage(0);
            }
          }}
          onUpdateStoryContext={(ctx) => {
            const nextProj: TranslationProject = {
              ...projectRef.current,
              storyContext: ctx,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateCharacters={(chars) => {
            const nextProj: TranslationProject = {
              ...projectRef.current,
              characterMemory: chars,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateTerminology={(terms) => {
            const latestProj = projectRef.current;
            const prevGlossary = hydrateProjectGlossary(latestProj.terminologyMemory);
            const nextGlossary = hydrateProjectGlossary(terms);

            const prevMap = new Map(prevGlossary.map((t) => [t.id, t]));
            const nextMap = new Map(nextGlossary.map((t) => [t.id, t]));

            const changedTermIds = new Set<string>();
            const changedTerms: TerminologyMemoryItem[] = [];

            for (const [id, prevTerm] of prevMap.entries()) {
              const nextTerm = nextMap.get(id);
              if (!nextTerm) {
                changedTermIds.add(id);
                changedTerms.push(prevTerm);
              } else if (hasVerificationRelevantGlossaryRuleChanged(prevTerm, nextTerm)) {
                changedTermIds.add(id);
                changedTerms.push(prevTerm, nextTerm);
              }
            }

            for (const [id, nextTerm] of nextMap.entries()) {
              if (!prevMap.has(id)) {
                changedTermIds.add(id);
                changedTerms.push(nextTerm);
              }
            }

            const now = new Date().toISOString();
            const updatedChapters =
              changedTermIds.size === 0
                ? latestProj.chapters
                : latestProj.chapters.map((ch) => {
                    if (!ch.verificationReport) return ch;

                    const preFilteredIssues = ch.verificationReport.issues.filter(
                      (issue) => {
                        if (issue.source === 'deterministic_lint') return true;
                        if (issue.type !== 'terminology') return true;
                        if (issue.termId && changedTermIds.has(issue.termId)) {
                          return false;
                        }
                        const pIdx = issue.paragraphIndex;
                        const paragraphEn =
                          typeof pIdx === 'number' &&
                          Number.isInteger(pIdx) &&
                          pIdx >= 0 &&
                          pIdx < ch.paragraphs.length
                            ? ch.paragraphs[pIdx].englishText
                            : undefined;

                        if (
                          changedTerms.some((term) =>
                            doesAiTerminologyIssueMatchChangedTerm(
                              issue,
                              term,
                              paragraphEn
                            )
                          )
                        ) {
                          return false;
                        }
                        return true;
                      }
                    );

                    const reconciledReport = reconcileVerificationReportAfterLocalEdit({
                      previousReport: {
                        ...ch.verificationReport,
                        issues: preFilteredIssues,
                      },
                      previousParagraphs: ch.paragraphs,
                      latestParagraphs: ch.paragraphs,
                      latestGlossary: nextGlossary,
                    });

                    const nextReport: VerificationReport | null = reconciledReport
                      ? {
                          ...reconciledReport,
                          isComplete: false,
                          fidelitySummary: ensureGlossaryPartialVerificationSummary(
                            reconciledReport.fidelitySummary
                          ),
                        }
                      : null;

                    return {
                      ...ch,
                      verificationReport: nextReport,
                      stageCompleted: {
                        ...ch.stageCompleted,
                        verification: false,
                      },
                      status: ch.status === 'completed' ? 'needs_review' : ch.status,
                      updatedAt: now,
                    };
                  });

            const nextProj: TranslationProject = {
              ...latestProj,
              terminologyMemory: nextGlossary,
              chapters: updatedChapters,
              updatedAt: now,
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
        />
      )}

      {/* Sub-Tab 4: Editorial & Accuracy Verification */}
      {subTab === 'verification' && (
        <VerificationAndEditorialPanel
          editorialNotes={activeChapter.editorialNotes}
          editorialChanges={activeChapter.editorialChanges}
          verificationReport={activeChapter.verificationReport}
          isVerificationComplete={activeChapter.stageCompleted.verification}
          isAnyStageRunning={isAnyOperationRunning}
          isRunningStage4={runningStage === 4}
          isRunningStage5={runningStage === 5}
          onRunStage4={async () => {
            try {
              await executeStage4();
              setPipelineBanner(null);
            } catch (e: unknown) {
              setErrorBanner(e instanceof Error ? e.message : 'Stage 4 error');
            } finally {
              setRunningStage(0);
            }
          }}
          onRunStage5={async () => {
            try {
              const updated = await executeStage5();
              const finalCh =
                updated.chapters.find((c) => c.id === activeChapter.id) ||
                updated.chapters[0];
              if (!finalCh.stageCompleted.verification) {
                setPipelineBannerTone('warning');
                setPipelineBanner(
                  `Stage 5 verification reconciled with concurrent chapter edits. Some paragraphs remain unverified—please re-run Stage 5 to complete full-chapter verification.`
                );
              } else {
                const completion = getPipelineCompletionState(
                  finalCh.paragraphs,
                  finalCh.verificationReport?.issues || []
                );
                if (!completion.isComplete) {
                  setPipelineBannerTone(completion.bannerTone);
                  setPipelineBanner(completion.bannerMessage);
                } else {
                  setPipelineBanner(null);
                }
              }
            } catch (e: unknown) {
              setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
            } finally {
              setRunningStage(0);
            }
          }}
          onApplySuggestedFix={(issue) => {
            if (issue.source === 'deterministic_lint') return;
            if (
              typeof issue.paragraphIndex !== 'number' ||
              !Number.isFinite(issue.paragraphIndex) ||
              !Number.isInteger(issue.paragraphIndex) ||
              issue.paragraphIndex < 0
            ) {
              return;
            }
            if (
              typeof issue.suggestedFix !== 'string' ||
              !issue.suggestedFix.trim() ||
              !BANGLA_SCRIPT_CHECK_RE.test(issue.suggestedFix)
            ) {
              return;
            }

            const pIdx = issue.paragraphIndex;
            const trimmedFix = issue.suggestedFix.trim();
            const latestProj = projectRef.current;
            const currentCh =
              latestProj.chapters.find((c) => c.id === activeChapter.id) ||
              latestProj.chapters[0];
            const targetPair = currentCh?.paragraphs[pIdx];
            if (!currentCh || !targetPair) return;

            if (issue.paragraphContentFingerprint) {
              const currentFp = computeParagraphContentFingerprint(
                targetPair.englishText,
                targetPair.banglaText
              );
              if (currentFp !== issue.paragraphContentFingerprint) {
                setErrorBanner(
                  `Cannot apply suggested fix to Paragraph ${pIdx + 1}: its text was modified since this verification finding was generated. Please re-run Stage 5 or edit the paragraph directly.`
                );
                return;
              }
            }

            updateChapterInProject(projectRef.current, currentCh.id, (existing) => {
              const existingTarget = existing.paragraphs[pIdx];
              if (!existingTarget) return existing;

              if (issue.paragraphContentFingerprint) {
                const existingFp = computeParagraphContentFingerprint(
                  existingTarget.englishText,
                  existingTarget.banglaText
                );
                if (existingFp !== issue.paragraphContentFingerprint) {
                  return existing;
                }
              }

              const newPairs = existing.paragraphs.map((item, idx) =>
                idx === pIdx
                  ? updateParagraphTranslation(item, trimmedFix, {
                      previousBanglaText: item.banglaText,
                      lastRefinementAction: 'manual_edit',
                    })
                  : item
              );
              const fullBangla = joinParagraphsWithSceneBreaks(newPairs, {
                field: 'banglaText',
                omitEmpty: true,
              });

              const reportWithResolvedIssue: VerificationReport | null =
                existing.verificationReport
                  ? {
                      ...existing.verificationReport,
                      issues: existing.verificationReport.issues.map((i) =>
                        i.id === issue.id ? { ...i, resolved: true } : i
                      ),
                    }
                  : null;

              const reconciledReport = reconcileVerificationReportAfterLocalEdit({
                previousReport: reportWithResolvedIssue,
                previousParagraphs: existing.paragraphs,
                latestParagraphs: newPairs,
                latestGlossary: hydrateProjectGlossary(
                  projectRef.current.terminologyMemory
                ),
              });

              const nextVerificationCompleted = Boolean(
                existing.stageCompleted.verification &&
                  reconciledReport &&
                  reconciledReport.isComplete !== false &&
                  !PARTIAL_OR_DET_SUMMARY_PREFIX_RE.test(
                    reconciledReport.fidelitySummary || ''
                  )
              );

              const hasMissing = newPairs.some(
                (p) => Boolean(p.missingTranslation) || !p.banglaText.trim()
              );
              const hasUnresolvedHigh = (reconciledReport?.issues || []).some(
                (i) => i.severity === 'high' && !i.resolved
              );
              const hasTranslated = newPairs.some((p) => p.banglaText.trim().length > 0);
              const nextStatus: Chapter['status'] =
                nextVerificationCompleted && !hasMissing && !hasUnresolvedHigh
                  ? 'completed'
                  : hasTranslated
                    ? 'needs_review'
                    : 'pending';

              if (pipelineBanner) {
                if (nextStatus === 'completed') {
                  setPipelineBanner(null);
                } else {
                  const completion = getPipelineCompletionState(
                    newPairs,
                    reconciledReport?.issues || []
                  );
                  if (!completion.isComplete) {
                    setPipelineBannerTone(completion.bannerTone);
                    setPipelineBanner(completion.bannerMessage);
                  } else {
                    setPipelineBannerTone('warning');
                    setPipelineBanner(
                      `Paragraph ${pIdx + 1} was updated with the suggested fix. Re-run Stage 5 to complete full-chapter verification.`
                    );
                  }
                }
              }

              return {
                ...existing,
                translatedText: fullBangla,
                paragraphs: newPairs,
                stageCompleted: {
                  ...existing.stageCompleted,
                  verification: nextVerificationCompleted,
                },
                status: nextStatus,
                verificationReport: reconciledReport,
                updatedAt: new Date().toISOString(),
              };
            });
          }}
          onMarkIssueResolved={(issueId) => {
            if (!activeChapter.verificationReport) return;
            updateChapterInProject(projectRef.current, activeChapter.id, (existing) => {
              const currentIssues = existing.verificationReport?.issues || [];
              const resolved = resolveVerificationIssue(
                existing.paragraphs,
                currentIssues,
                issueId
              );
              const isTrulyCompleteVerification = Boolean(
                existing.stageCompleted.verification &&
                  existing.verificationReport &&
                  existing.verificationReport.isComplete !== false &&
                  !PARTIAL_OR_DET_SUMMARY_PREFIX_RE.test(
                    existing.verificationReport.fidelitySummary || ''
                  )
              );

              if (pipelineBanner) {
                if (isTrulyCompleteVerification && resolved.completion.isComplete) {
                  setPipelineBanner(null);
                } else if (!resolved.completion.isComplete) {
                  setPipelineBannerTone(resolved.completion.bannerTone);
                  setPipelineBanner(resolved.completion.bannerMessage);
                }
              }

              const hasTranslated = existing.paragraphs.some(
                (p) => p.banglaText.trim().length > 0
              );
              const nextStatus: Chapter['status'] = isTrulyCompleteVerification
                ? resolved.chapterStatus
                : hasTranslated
                  ? 'needs_review'
                  : 'pending';

              return {
                ...existing,
                status: nextStatus,
                verificationReport: existing.verificationReport
                  ? { ...existing.verificationReport, issues: resolved.updatedIssues }
                  : null,
                updatedAt: new Date().toISOString(),
              };
            });
          }}
        />
      )}
    </div>
  );
}

