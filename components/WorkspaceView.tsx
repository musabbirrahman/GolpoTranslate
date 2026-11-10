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
  canEditContinuousBangla,
  chunkTextByParagraphs,
  countWords,
  formatBilingualExport,
  formatChapterExport,
  formatFullStoryExport,
  getPipelineCompletionState,
  joinParagraphsWithSceneBreaks,
  resolveVerificationIssue,
  revertParagraphTranslation,
  splitIntoParagraphs,
  type TextChunk,
  updateParagraphTranslation,
} from '@/lib/chunker';
import {
  computeParagraphContentFingerprint,
  extractEnglishSurfaceAndSense,
  finalizeStage3ChapterState,
  findEnglishTermOccurrences,
  hydrateProjectGlossary,
  mapSnapshotParagraphsToLatest,
  normalizeBanglaUnicode,
  normalizeEnglishTerm,
  planStage3ChunkExecution,
  reconcileStage1ResultWithLatestState,
  reconcileStage2ResultWithLatestState,
  reconcileStage3ChunkGlossaryWithLatestState,
  reconcileStage3ChunkWithLatestState,
  reconcileStage4ResultWithLatestState,
  reconcileStage5ResultWithLatestState,
  reconcileVerificationReportAfterLocalEdit,
} from '@/lib/terminology';
import VoiceAndControlsPanel from './VoiceAndControlsPanel';
import ContextAndMemoryPanel from './ContextAndMemoryPanel';
import VerificationAndEditorialPanel from './VerificationAndEditorialPanel';

export interface WorkspaceViewProps {
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

export interface ActiveParagraphRefinementRequest {
  reqId: number;
  projectId: string;
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

export function hasVerificationRelevantGlossaryRuleChanged(
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

export function applyTerminologyUpdateToProject(
  latestProj: TranslationProject,
  terms: TerminologyMemoryItem[],
  now = new Date().toISOString()
): TranslationProject {
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

  const updatedChapters =
    changedTermIds.size === 0
      ? latestProj.chapters
      : latestProj.chapters.map((ch) => {
          if (!ch.verificationReport) return ch;

          const preFilteredIssues = ch.verificationReport.issues.filter((issue) => {
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
                doesAiTerminologyIssueMatchChangedTerm(issue, term, paragraphEn)
              )
            ) {
              return false;
            }
            return true;
          });

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

  return {
    ...latestProj,
    terminologyMemory: nextGlossary,
    chapters: updatedChapters,
    updatedAt: now,
  };
}

export interface ApplyStage2ResponseParams {
  targetProjectId: string;
  targetChapterId: string;
  snapshotStyleProfile: StyleProfile | null;
  latestProject: TranslationProject;
  aiStyleProfile: Partial<Record<keyof StyleProfile, unknown>> | null | undefined;
  now?: string;
}

export interface ApplyStage2ResponseOutcome {
  applied: boolean;
  discardReason?: 'project_switched' | 'chapter_deleted';
  project: TranslationProject;
  targetChapterTitle?: string;
  reconciledStyleProfile?: StyleProfile;
  warningBanner?: string;
}

export function applyStage2ResponseToLatestProject(
  params: ApplyStage2ResponseParams
): ApplyStage2ResponseOutcome {
  const {
    targetProjectId,
    targetChapterId,
    snapshotStyleProfile,
    latestProject,
    aiStyleProfile,
    now = new Date().toISOString(),
  } = params;

  if (!latestProject || latestProject.id !== targetProjectId) {
    return {
      applied: false,
      discardReason: 'project_switched',
      project: latestProject,
    };
  }

  const targetChapter = latestProject.chapters.find(
    (c) => c.id === targetChapterId
  );
  if (!targetChapter) {
    return {
      applied: false,
      discardReason: 'chapter_deleted',
      project: latestProject,
      warningBanner:
        'Stage 2 Author Voice Analysis finished, but its target chapter was no longer found. No changes were applied.',
    };
  }

  const reconciledStyleProfile = reconcileStage2ResultWithLatestState({
    snapshotStyleProfile,
    latestStyleProfile: latestProject.styleProfile,
    aiStyleProfile,
  });

  const updatedProj: TranslationProject = {
    ...latestProject,
    styleProfile: reconciledStyleProfile,
    updatedAt: now,
    chapters: latestProject.chapters.map((item) =>
      item.id === targetChapterId
        ? {
            ...item,
            currentStage: 2,
            stageCompleted: { ...item.stageCompleted, voiceAnalysis: true },
            updatedAt: now,
          }
        : item
    ),
  };

  return {
    applied: true,
    project: updatedProj,
    targetChapterTitle: targetChapter.title,
    reconciledStyleProfile,
  };
}

export function createChapterInLatestProject(params: {
  intendedProjectId: string;
  latestProject: TranslationProject;
  newChTitle: string;
  newChText: string;
  maxWordsPerChunk: number;
  now?: string;
  newChapterId?: string;
}): {
  applied: boolean;
  project: TranslationProject;
  createdChapter?: Chapter;
} {
  const {
    intendedProjectId,
    latestProject,
    newChTitle,
    newChText,
    maxWordsPerChunk,
    now = new Date().toISOString(),
    newChapterId = `ch-${Date.now()}`,
  } = params;

  if (!latestProject || latestProject.id !== intendedProjectId || !newChText.trim()) {
    return {
      applied: false,
      project: latestProject,
    };
  }

  const nextNum = latestProject.chapters.length + 1;
  const chTitle = newChTitle.trim() || `Chapter ${nextNum}`;
  const chunks = chunkTextByParagraphs(newChText, maxWordsPerChunk || 500);

  const created: Chapter = {
    id: newChapterId,
    number: nextNum,
    title: chTitle,
    originalText: newChText.trim(),
    translatedText: '',
    paragraphs: alignParagraphs(newChText, ''),
    status: 'pending',
    currentStage: 0,
    stageCompleted: {
      understanding: false,
      voiceAnalysis: Boolean(latestProject.styleProfile),
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
    ...latestProject,
    updatedAt: now,
    chapters: [...latestProject.chapters, created],
  };

  return {
    applied: true,
    project: updatedProj,
    createdChapter: created,
  };
}

export function buildManualSaveFromLatestProject(params: {
  intendedProjectId: string;
  activeChapterId: string;
  latestProject: TranslationProject;
  now?: string;
}): {
  applied: boolean;
  project: TranslationProject;
  historyEntry?: {
    projectId: string;
    projectTitle: string;
    chapterId: string;
    chapterTitle: string;
    actionType: HistoryActionType;
    summary: string;
  };
} {
  const {
    intendedProjectId,
    activeChapterId,
    latestProject,
    now = new Date().toISOString(),
  } = params;

  if (!latestProject || latestProject.id !== intendedProjectId) {
    return {
      applied: false,
      project: latestProject,
    };
  }

  const latestActiveChapter =
    latestProject.chapters.find((c) => c.id === activeChapterId) ||
    latestProject.chapters[0];
  if (!latestActiveChapter) {
    return {
      applied: false,
      project: latestProject,
    };
  }

  const savedProject: TranslationProject = {
    ...latestProject,
    updatedAt: now,
  };

  return {
    applied: true,
    project: savedProject,
    historyEntry: {
      projectId: savedProject.id,
      projectTitle: savedProject.title,
      chapterId: latestActiveChapter.id,
      chapterTitle: latestActiveChapter.title,
      actionType: 'manual_save',
      summary: `Saved chapter "${latestActiveChapter.title}" (${latestActiveChapter.paragraphs.length} paragraphs).`,
    },
  };
}

export interface WorkspaceExecutionContext {
  getProject: () => TranslationProject;
  setProject: (next: TranslationProject) => void;
  getStage3SeqMap?: () => Record<string, number>;
  getStage5SeqMap: () => Record<string, number>;
  nextRefineRequestId: () => number;
  getActiveRefineRequests: () => ActiveParagraphRefinementRequest[];
  setActiveRefineRequests: (next: ActiveParagraphRefinementRequest[]) => void;
  getActiveChapterId: () => string;
  getMaxWordsPerChunk?: () => number;
  getCustomParagraphNote?: () => string;
  setCustomParagraphNote?: (val: string) => void;
  setRunningStage?: (stage: 0 | 1 | 2 | 3 | 4 | 5) => void;
  setPipelineBanner?: (msg: string | null) => void;
  setPipelineBannerTone?: (tone: 'success' | 'warning') => void;
  setErrorBanner?: (msg: string | null) => void;
  setRefiningParagraphIdx?: (idx: number | null) => void;
  onUpdateProject: (updated: TranslationProject) => void;
  onLogHistory?: WorkspaceViewProps['onLogHistory'];
  fetchImpl?: typeof fetch;
  scheduleBannerClear?: (fn: () => void, ms: number) => void;
}

const defaultStage3SeqMapByProject = new WeakMap<
  object,
  Record<string, number>
>();

const WORKSPACE_EXEC_SEQ_KEY = '__workspace_exec_seq__';

export function createWorkspaceStageExecutors(ctx: WorkspaceExecutionContext) {
  const fetchFn: typeof fetch =
    ctx.fetchImpl ?? ((...args) => fetch(...args));
  const scheduleClear =
    ctx.scheduleBannerClear ?? ((fn, ms) => setTimeout(fn, ms));
  const getMaxWordsPerChunk = ctx.getMaxWordsPerChunk ?? (() => 500);
  const getCustomParagraphNote = ctx.getCustomParagraphNote ?? (() => '');
  const setCustomParagraphNote = ctx.setCustomParagraphNote ?? (() => {});
  const setRunningStage = ctx.setRunningStage ?? (() => {});
  const setPipelineBanner = ctx.setPipelineBanner ?? (() => {});
  const setPipelineBannerTone = ctx.setPipelineBannerTone ?? (() => {});
  const setErrorBanner = ctx.setErrorBanner ?? (() => {});
  const setRefiningParagraphIdx = ctx.setRefiningParagraphIdx ?? (() => {});
  const onLogHistory = ctx.onLogHistory ?? (() => {});
  const getStage3SeqMap =
    ctx.getStage3SeqMap ??
    (() => {
      const keyObj = ctx.getStage5SeqMap();
      let map = defaultStage3SeqMapByProject.get(keyObj);
      if (!map) {
        map = {};
        defaultStage3SeqMapByProject.set(keyObj, map);
      }
      return map;
    });

  const claimWorkspaceExecution = (): number => {
    const seqMap = getStage3SeqMap();
    const nextExecId = (seqMap[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    seqMap[WORKSPACE_EXEC_SEQ_KEY] = nextExecId;
    return nextExecId;
  };

  const isCurrentWorkspaceExecution = (
    execId: number,
    expectedProjectId?: string
  ): boolean => {
    if (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] !== execId) {
      return false;
    }
    if (expectedProjectId !== undefined) {
      const latestProj = ctx.getProject();
      if (!latestProj || latestProj.id !== expectedProjectId) {
        return false;
      }
    }
    return true;
  };

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
    ctx.setProject(nextProj);
    ctx.onUpdateProject(nextProj);
    return nextProj;
  };

  const applyChapterLocalEditWithReconciliation = (
    chapterId: string,
    computeEdit: (existing: Chapter) => {
      nextParagraphs: ParagraphPair[];
      nextTranslatedText: string;
      nextOriginalText?: string;
    },
    expectedProjectId?: string
  ): TranslationProject => {
    const latestProj = ctx.getProject();
    if (
      !latestProj ||
      (expectedProjectId !== undefined && latestProj.id !== expectedProjectId)
    ) {
      return latestProj;
    }
    if (!latestProj.chapters.some((c) => c.id === chapterId)) {
      return latestProj;
    }
    return updateChapterInProject(latestProj, chapterId, (existing) => {
      const previousParagraphs = existing.paragraphs.map((p) => ({ ...p }));
      const { nextParagraphs, nextTranslatedText, nextOriginalText } =
        computeEdit(existing);

      const effectiveOriginalText =
        nextOriginalText !== undefined
          ? nextOriginalText
          : existing.originalText;
      const localChunkPlan = planStage3ChunkExecution({
        originalText: effectiveOriginalText,
        paragraphs: nextParagraphs,
        maxWordsPerChunk: getMaxWordsPerChunk() || 500,
        contextWindow: 4,
      });
      const nextChunkCount = localChunkPlan.chunks.length;
      const nextCompletedChunks = localChunkPlan.completedChunkIndices.length;
      const nextStageCompletedTranslation =
        nextChunkCount > 0 &&
        nextCompletedChunks === nextChunkCount &&
        localChunkPlan.allChunksInitiallyComplete;

      const mapping = mapSnapshotParagraphsToLatest(
        previousParagraphs,
        nextParagraphs
      );

      const prevSplitEng = splitIntoParagraphs(existing.originalText || '');
      const nextSplitEng = splitIntoParagraphs(effectiveOriginalText || '');
      const splitEngChanged =
        prevSplitEng.length !== nextSplitEng.length ||
        prevSplitEng.some(
          (eng, idx) =>
            normalizeEnglishTerm(eng) !==
            normalizeEnglishTerm(nextSplitEng[idx] || '')
        );
      const paragraphEnglishOrStructureChanged =
        splitEngChanged ||
        previousParagraphs.length !== nextParagraphs.length ||
        nextParagraphs.length !== nextSplitEng.length ||
        mapping.hasStructuralChange ||
        mapping.deletedSnapIndices.length > 0 ||
        mapping.reorderedLatestIndices.length > 0 ||
        mapping.ambiguousDuplicateLatestIndices.length > 0 ||
        mapping.latestToSnapIndex.size !== nextParagraphs.length ||
        previousParagraphs.some(
          (prevP, idx) =>
            normalizeEnglishTerm(prevP.englishText || '') !==
              normalizeEnglishTerm(nextParagraphs[idx]?.englishText || '') ||
            normalizeEnglishTerm(nextParagraphs[idx]?.englishText || '') !==
              normalizeEnglishTerm(nextSplitEng[idx] || '')
        );
      const allNextParagraphsHaveValidBangla =
        nextParagraphs.length > 0 &&
        nextParagraphs.every(
          (p) =>
            !p.missingTranslation &&
            typeof p.banglaText === 'string' &&
            p.banglaText.trim().length > 0 &&
            normalizeBanglaUnicode(p.banglaText.trim()).length > 0
        );
      const nextStageCompletedEditing =
        !paragraphEnglishOrStructureChanged &&
        nextStageCompletedTranslation &&
        allNextParagraphsHaveValidBangla
          ? Boolean(existing.stageCompleted.editing)
          : false;

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

      let nextStatus: Chapter['status'] = existing.status;
      if (
        nextStageCompletedVerification &&
        reconciledReport &&
        nextStageCompletedTranslation
      ) {
        nextStatus = getPipelineCompletionState(
          nextParagraphs,
          reconciledReport.issues
        ).chapterStatus;
      } else if (
        nextStageCompletedTranslation ||
        existing.stageCompleted.translation ||
        existing.status === 'completed' ||
        existing.status === 'needs_review' ||
        nextParagraphs.some(
          (p) => p.banglaText.trim().length > 0 || Boolean(p.missingTranslation)
        )
      ) {
        nextStatus = nextChunkCount === 0 ? 'pending' : 'needs_review';
      } else {
        nextStatus = 'pending';
      }

      return {
        ...existing,
        ...(nextOriginalText !== undefined
          ? { originalText: nextOriginalText }
          : {}),
        translatedText: nextTranslatedText,
        paragraphs: nextParagraphs,
        chunkCount: nextChunkCount,
        completedChunks: nextCompletedChunks,
        verificationReport: reconciledReport,
        stageCompleted: {
          ...existing.stageCompleted,
          translation: nextStageCompletedTranslation,
          editing: nextStageCompletedEditing,
          verification: nextStageCompletedVerification,
        },
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const resolvePinnedOrActiveChapter = (
    proj: TranslationProject,
    pinnedTargetChapterId?: string
  ): Chapter | undefined => {
    if (pinnedTargetChapterId !== undefined) {
      return proj.chapters.find((c) => c.id === pinnedTargetChapterId);
    }
    const activeId = ctx.getActiveChapterId();
    return proj.chapters.find((c) => c.id === activeId) || proj.chapters[0];
  };

  // Stage 1: Literary Understanding & Character/Terminology Extraction
  const executeStage1 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    inheritedWorkspaceExecId?: number
  ): Promise<TranslationProject> => {
    const isStandaloneRun = inheritedWorkspaceExecId === undefined;
    const workspaceExecId =
      inheritedWorkspaceExecId ?? claimWorkspaceExecution();
    const preRequestProj = ctx.getProject() ?? currentProj;
    const targetProjectId = pinnedTargetProjectId ?? preRequestProj?.id;
    if (
      !preRequestProj ||
      !targetProjectId ||
      preRequestProj.id !== targetProjectId
    ) {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
      return preRequestProj;
    }

    const canOwnUI = (): boolean =>
      isCurrentWorkspaceExecution(workspaceExecId, targetProjectId);

    try {
      const ch = resolvePinnedOrActiveChapter(
        preRequestProj,
        pinnedTargetChapterId
      );
      if (!ch) {
        if (canOwnUI()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Stage 1 Literary Understanding could not run because the target chapter was no longer found.'
          );
        }
        return preRequestProj;
      }
      const targetChapterId = ch.id;
      const targetChapterTitle = ch.title;

      if (!ch.originalText.trim()) {
        throw new Error(
          'Original English text is empty. Please add English text first.'
        );
      }

      // 1. Capture pre-request project-state snapshot before starting Stage 1 request
      const snapshotStoryContext: StoryContextProfile | null =
        preRequestProj.storyContext
          ? {
              ...preRequestProj.storyContext,
              importantEvents: [
                ...(preRequestProj.storyContext.importantEvents || []),
              ],
              locations: (preRequestProj.storyContext.locations || []).map(
                (loc) => ({
                  ...loc,
                })
              ),
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
        avoidTranslations: t.avoidTranslations
          ? [...t.avoidTranslations]
          : undefined,
      }));

      if (canOwnUI()) {
        setErrorBanner(null);
        setRunningStage(1);
        setPipelineBanner(
          'Stage 1/5: Analyzing literary context, characters, and recurring terminology...'
        );
      }

      const res = await fetchFn('/api/translate', {
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

      // 2. Read authoritative latest project state after async boundary
      const latestProj = ctx.getProject();
      if (!latestProj || latestProj.id !== targetProjectId) {
        return latestProj;
      }
      const latestTargetCh = latestProj.chapters.find(
        (item) => item.id === targetChapterId
      );
      if (!latestTargetCh) {
        if (canOwnUI()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Stage 1 Literary Understanding finished, but its target chapter was no longer found. No changes were applied.'
          );
        }
        return latestProj;
      }

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
          item.id === targetChapterId
            ? {
                ...item,
                currentStage: 1,
                stageCompleted: { ...item.stageCompleted, understanding: true },
                ...(data.stage1Coverage
                  ? { stage1Coverage: data.stage1Coverage }
                  : {}),
                updatedAt: now,
              }
            : item
        ),
      };

      ctx.setProject(updatedProj);
      ctx.onUpdateProject(updatedProj);
      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: targetChapterTitle,
        actionType: 'stage_1_understanding',
        summary: `Extracted story context, ${reconciledStage1.characterMemory.length} characters, and ${reconciledStage1.terminologyMemory.length} glossary terms.`,
      });

      return updatedProj;
    } finally {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
    }
  };

  // Stage 2: Author Voice & Style Profile
  const executeStage2 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    inheritedWorkspaceExecId?: number
  ): Promise<TranslationProject> => {
    const isStandaloneRun = inheritedWorkspaceExecId === undefined;
    const workspaceExecId =
      inheritedWorkspaceExecId ?? claimWorkspaceExecution();
    const preRequestProj = ctx.getProject() ?? currentProj;
    const targetProjectId = pinnedTargetProjectId ?? preRequestProj?.id;
    if (
      !preRequestProj ||
      !targetProjectId ||
      preRequestProj.id !== targetProjectId
    ) {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
      return preRequestProj;
    }

    const canOwnUI = (): boolean =>
      isCurrentWorkspaceExecution(workspaceExecId, targetProjectId);

    try {
      const ch = resolvePinnedOrActiveChapter(
        preRequestProj,
        pinnedTargetChapterId
      );
      if (!ch) {
        if (canOwnUI()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Stage 2 Author Voice Analysis could not run because the target chapter was no longer found.'
          );
        }
        return preRequestProj;
      }
      const targetChapterId = ch.id;

      if (!ch.originalText.trim()) {
        throw new Error('Original English text is empty.');
      }

      const snapshotStyleProfile: StyleProfile | null =
        preRequestProj.styleProfile ? { ...preRequestProj.styleProfile } : null;

      if (canOwnUI()) {
        setErrorBanner(null);
        setRunningStage(2);
        setPipelineBanner(
          "Stage 2/5: Analyzing original author's literary voice and building reusable Style Profile..."
        );
      }

      const res = await fetchFn('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'stage2_voice',
          text: ch.originalText,
          projectTitle: preRequestProj.title,
          authorName: preRequestProj.authorName,
          genre: preRequestProj.genre,
          customNotes: preRequestProj.styleProfile?.customNotes ?? '',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Stage 2 Author Voice Analysis failed');
      }

      const outcome = applyStage2ResponseToLatestProject({
        targetProjectId,
        targetChapterId,
        snapshotStyleProfile,
        latestProject: ctx.getProject(),
        aiStyleProfile: data.styleProfile,
      });

      if (!outcome.applied) {
        if (
          outcome.discardReason === 'chapter_deleted' &&
          outcome.warningBanner &&
          canOwnUI()
        ) {
          setPipelineBannerTone('warning');
          setPipelineBanner(outcome.warningBanner);
        }
        return outcome.project;
      }

      const updatedProj = outcome.project;
      ctx.setProject(updatedProj);
      ctx.onUpdateProject(updatedProj);
      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: outcome.targetChapterTitle!,
        actionType: 'stage_2_voice',
        summary: `Generated Author Style Profile: ${outcome.reconciledStyleProfile?.overallVoice?.slice(0, 120) || 'Completed'}`,
      });

      return updatedProj;
    } finally {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
    }
  };

  // Stage 3: Faithful Literary Translation (Chunked, Resume/Repair-Aware & In-Flight Edit Protected)
  const executeStage3 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    inheritedWorkspaceExecId?: number
  ): Promise<TranslationProject> => {
    const isStandaloneRun = inheritedWorkspaceExecId === undefined;
    const workspaceExecId =
      inheritedWorkspaceExecId ?? claimWorkspaceExecution();
    const initialProj = ctx.getProject() ?? currentProj;
    const targetProjectId = pinnedTargetProjectId ?? initialProj?.id;
    if (
      !initialProj ||
      !targetProjectId ||
      initialProj.id !== targetProjectId
    ) {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
      return initialProj;
    }

    const ch = resolvePinnedOrActiveChapter(
      initialProj,
      pinnedTargetChapterId
    );
    if (!ch) {
      if (isCurrentWorkspaceExecution(workspaceExecId, targetProjectId)) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Stage 3 Translation could not run because the target chapter was no longer found.'
        );
        if (isStandaloneRun) {
          setRunningStage(0);
        }
      }
      return initialProj;
    }
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    // Per-project + chapter Stage 3 request sequence guard
    const stage3SeqMap = getStage3SeqMap();
    const stage3SeqKey = `${targetProjectId}:${targetChapterId}`;
    const requestSeq = (stage3SeqMap[stage3SeqKey] ?? 0) + 1;
    stage3SeqMap[stage3SeqKey] = requestSeq;
    stage3SeqMap[targetChapterId] = requestSeq;
    stage3SeqMap[`__exec_stage3_seq_${workspaceExecId}__`] = requestSeq;

    const isCurrentStage3Run = (): boolean =>
      getStage3SeqMap()[stage3SeqKey] === requestSeq;

    const canOwnStage3UI = (): boolean =>
      isCurrentStage3Run() &&
      isCurrentWorkspaceExecution(workspaceExecId, targetProjectId);

    const setStage3Banner = (msg: string | null) => {
      if (canOwnStage3UI()) {
        setPipelineBanner(msg);
      }
    };
    const setStage3BannerTone = (tone: 'success' | 'warning') => {
      if (canOwnStage3UI()) {
        setPipelineBannerTone(tone);
      }
    };

    try {
      const initialEnglishParagraphs = splitIntoParagraphs(ch.originalText);
      if (initialEnglishParagraphs.length === 0) {
        throw new Error(
          'Original English text has no paragraphs to translate.'
        );
      }

      if (canOwnStage3UI()) {
        setErrorBanner(null);
        setPipelineBannerTone('success');
        setRunningStage(3);
      }

      const maxWordsPerChunk = getMaxWordsPerChunk() || 500;
      const contextWindow = 4;

      // Capture immutable start snapshot of target chapter's paragraph pairs
      const alignedInitialPairs =
        ch.paragraphs.length === initialEnglishParagraphs.length
          ? ch.paragraphs
          : alignParagraphs(ch.originalText, ch.translatedText, ch.paragraphs);
      const stage3StartParagraphs: ParagraphPair[] = alignedInitialPairs.map(
        (p) => ({ ...p })
      );

      const initialPlan = planStage3ChunkExecution({
        originalText: ch.originalText,
        paragraphs: stage3StartParagraphs,
        maxWordsPerChunk,
        contextWindow,
      });

      const runIsResumeMode = initialPlan.isResumeMode;
      const isFullRetranslationRun =
        !initialPlan.isResumeMode && initialPlan.allChunksInitiallyComplete;

      const hasBanglaStateChangedBetweenPairs = (
        baselinePair: ParagraphPair,
        currentPair: ParagraphPair
      ): boolean => {
        const baseBn = (baselinePair.banglaText ?? '').trim();
        const currBn = (currentPair.banglaText ?? '').trim();
        if (
          (baseBn.length > 0) !== (currBn.length > 0) ||
          normalizeBanglaUnicode(baseBn) !== normalizeBanglaUnicode(currBn)
        ) {
          return true;
        }
        if (
          (baselinePair.lastRefinementAction ?? undefined) !==
          (currentPair.lastRefinementAction ?? undefined)
        ) {
          return true;
        }
        const basePrevDefined =
          baselinePair.previousBanglaText !== undefined &&
          baselinePair.previousBanglaText !== null;
        const currPrevDefined =
          currentPair.previousBanglaText !== undefined &&
          currentPair.previousBanglaText !== null;
        if (basePrevDefined !== currPrevDefined) {
          return true;
        }
        if (
          basePrevDefined &&
          currPrevDefined &&
          normalizeBanglaUnicode(baselinePair.previousBanglaText ?? '') !==
            normalizeBanglaUnicode(currentPair.previousBanglaText ?? '')
        ) {
          return true;
        }
        if (
          (baselinePair.refinementRationale ?? '') !==
          (currentPair.refinementRationale ?? '')
        ) {
          return true;
        }
        return false;
      };

      const findPreStage3BaselinePair = (
        latestPair: ParagraphPair | undefined,
        latestIdx: number,
        startToLatestMapping: ReturnType<typeof mapSnapshotParagraphsToLatest>,
        totalCurrentParagraphs: number
      ): ParagraphPair | undefined => {
        const startIdx = startToLatestMapping.latestToSnapIndex.get(latestIdx);
        if (startIdx !== undefined) {
          return stage3StartParagraphs[startIdx];
        }
        // When the English paragraph has no reliable mapping in startToLatestMapping:
        // Never match a manually edited paragraph (lastRefinementAction === 'manual_edit')
        // to an unrelated or deleted pre-Stage 3 baseline paragraph.
        if (!latestPair || latestPair.lastRefinementAction === 'manual_edit') {
          return undefined;
        }
        if ((latestPair.banglaText ?? '').trim().length === 0) {
          return undefined;
        }
        // Only match an unmatched baseline when alignParagraphs Pass 3 carried over a
        // pre-Stage 3 translation in-place (same paragraph count, no cross-index shifts,
        // and unchanged Bangla state at the same slot).
        const hasAnyShiftedMatch = Array.from(
          startToLatestMapping.snapToLatestIndex.entries()
        ).some(([sIdx, lIdx]) => sIdx !== lIdx);
        if (
          stage3StartParagraphs.length === totalCurrentParagraphs &&
          !hasAnyShiftedMatch &&
          !startToLatestMapping.snapToLatestIndex.has(latestIdx) &&
          stage3StartParagraphs[latestIdx] &&
          !hasBanglaStateChangedBetweenPairs(
            stage3StartParagraphs[latestIdx],
            latestPair
          )
        ) {
          return stage3StartParagraphs[latestIdx];
        }
        return undefined;
      };

      const hasUserAuthoredValidBanglaDuringRun = (
        latestPair: ParagraphPair | undefined,
        latestIdx: number,
        startToLatestMapping: ReturnType<typeof mapSnapshotParagraphsToLatest>,
        totalCurrentParagraphs: number
      ): boolean => {
        if (!latestPair || Boolean(latestPair.missingTranslation)) {
          return false;
        }
        const trimmedBn = (latestPair.banglaText ?? '').trim();
        if (
          trimmedBn.length === 0 ||
          normalizeBanglaUnicode(trimmedBn).length === 0
        ) {
          return false;
        }
        const baselinePair = findPreStage3BaselinePair(
          latestPair,
          latestIdx,
          startToLatestMapping,
          totalCurrentParagraphs
        );
        if (!baselinePair) {
          return true;
        }
        return hasBanglaStateChangedBetweenPairs(baselinePair, latestPair);
      };

      const isIntentionalInFlightClearOrRevert = (
        latestPair: ParagraphPair | undefined,
        latestIdx: number,
        startToLatestMapping: ReturnType<typeof mapSnapshotParagraphsToLatest>,
        _totalCurrentParagraphs: number,
        snapToLatestMapping?: ReturnType<typeof mapSnapshotParagraphsToLatest>,
        chunkSnapPairs?: ReadonlyArray<ParagraphPair>
      ): boolean => {
        if (!latestPair || latestPair.banglaText.trim().length > 0) {
          return false;
        }
        const startIdx = startToLatestMapping.latestToSnapIndex.get(latestIdx);
        const startPair =
          startIdx !== undefined ? stage3StartParagraphs[startIdx] : undefined;
        if (startPair && startPair.banglaText.trim().length > 0) {
          return true;
        }
        if (snapToLatestMapping && chunkSnapPairs) {
          const snapIdx = snapToLatestMapping.latestToSnapIndex.get(latestIdx);
          const snapPair =
            snapIdx !== undefined ? chunkSnapPairs[snapIdx] : undefined;
          if (snapPair && snapPair.banglaText.trim().length > 0) {
            return true;
          }
        }
        // When reliably mapped to startPair, detect manual_edit or revert since startPair:
        if (startPair) {
          if (
            latestPair.lastRefinementAction === 'manual_edit' &&
            startPair.lastRefinementAction !== 'manual_edit'
          ) {
            return true;
          }
          if (
            Boolean(latestPair.missingTranslation) &&
            (latestPair.previousBanglaText ?? '').trim().length > 0 &&
            (latestPair.previousBanglaText ?? '') !==
              (startPair.previousBanglaText ?? '')
          ) {
            return true;
          }
          return false;
        }
        // When the English paragraph has NO reliable mapping in startToLatestMapping (startIdx === undefined):
        // Do NOT treat a positional baseline with non-empty Bangla as sufficient evidence.
        // Require explicit clear/revert evidence on latestPair:
        if (latestPair.lastRefinementAction === 'manual_edit') {
          return true;
        }
        if (
          Boolean(latestPair.missingTranslation) &&
          (latestPair.previousBanglaText ?? '').trim().length > 0
        ) {
          return true;
        }
        return false;
      };

      const MAX_STAGE3_MANUSCRIPT_REPLANS = 2;
      const maxTotalChunkIterations = Math.max(
        8,
        initialPlan.chunks.length * 4 + 4
      );

      let trackedParagraphs: ParagraphPair[] = stage3StartParagraphs.map((p) => ({
        ...p,
      }));
      let processedIndices = new Set<number>();
      if (runIsResumeMode) {
        for (const protectedList of initialPlan.protectedParagraphIndicesByChunk.values()) {
          for (const pIdx of protectedList) {
            processedIndices.add(pIdx);
          }
        }
      }
      let lastPlannedOriginalText = ch.originalText;
      let manuscriptReplanCount = 0;
      let stoppedDueToManuscriptChanges = false;
      let executedChunkIterations = 0;

      while (executedChunkIterations < maxTotalChunkIterations) {
        if (!isCurrentStage3Run()) {
          return ctx.getProject();
        }
        const chunkStartProj = ctx.getProject();
        if (!chunkStartProj || chunkStartProj.id !== targetProjectId) {
          return chunkStartProj;
        }
        const chunkStartCh = chunkStartProj.chapters.find(
          (item) => item.id === targetChapterId
        );
        if (!chunkStartCh) {
          setStage3BannerTone('warning');
          setStage3Banner(
            'Stage 3 Translation stopped because the target chapter was no longer found.'
          );
          return chunkStartProj;
        }

        const currentChapterParagraphs =
          chunkStartCh.paragraphs.length > 0 ||
          !chunkStartCh.originalText.trim()
            ? chunkStartCh.paragraphs.map((p) => ({ ...p }))
            : alignParagraphs(
                chunkStartCh.originalText,
                chunkStartCh.translatedText,
                chunkStartCh.paragraphs
              );

        const mapTrackedToCurrent = mapSnapshotParagraphsToLatest(
          trackedParagraphs,
          currentChapterParagraphs
        );
        const nextProcessed = new Set<number>();
        for (const oldIdx of processedIndices) {
          const mappedIdx = mapTrackedToCurrent.snapToLatestIndex.get(oldIdx);
          if (mappedIdx !== undefined) {
            nextProcessed.add(mappedIdx);
          }
        }
        trackedParagraphs = currentChapterParagraphs.map((p) => ({ ...p }));
        processedIndices = nextProcessed;

        if (chunkStartCh.originalText !== lastPlannedOriginalText) {
          manuscriptReplanCount += 1;
          lastPlannedOriginalText = chunkStartCh.originalText;
          if (
            manuscriptReplanCount > MAX_STAGE3_MANUSCRIPT_REPLANS ||
            !chunkStartCh.originalText.trim()
          ) {
            stoppedDueToManuscriptChanges =
              manuscriptReplanCount > MAX_STAGE3_MANUSCRIPT_REPLANS;
            break;
          }
        }

        const currentPlan = planStage3ChunkExecution({
          originalText: chunkStartCh.originalText,
          paragraphs: currentChapterParagraphs,
          maxWordsPerChunk,
          contextWindow,
        });

        if (currentPlan.chunks.length === 0) {
          break;
        }

        const mapStartToCurrent = mapSnapshotParagraphsToLatest(
          stage3StartParagraphs,
          currentChapterParagraphs
        );

        const hasStaleCarriedOverBanglaAt = (
          pair: ParagraphPair | undefined,
          pIdx: number
        ): boolean => {
          if (!pair || processedIndices.has(pIdx)) return false;
          if (mapStartToCurrent.latestToSnapIndex.get(pIdx) !== undefined) {
            return false;
          }
          if (pair.banglaText.trim().length === 0) return false;
          return !hasUserAuthoredValidBanglaDuringRun(
            pair,
            pIdx,
            mapStartToCurrent,
            currentChapterParagraphs.length
          );
        };

        const anySlotHasStaleCarriedOverBangla = currentChapterParagraphs.some(
          (pair, pIdx) => hasStaleCarriedOverBanglaAt(pair, pIdx)
        );

        if (
          !isFullRetranslationRun &&
          (runIsResumeMode || manuscriptReplanCount > 0) &&
          currentPlan.allChunksInitiallyComplete &&
          !anySlotHasStaleCarriedOverBangla
        ) {
          break;
        }

        let selectedChunk: TextChunk | null = null;
        let requestedOffsets: number[] = [];
        let chunkIsResumeMode = runIsResumeMode;

        for (const candidateChunk of currentPlan.chunks) {
          const chunkHasAnyProcessed = candidateChunk.paragraphs.some((_, off) =>
            processedIndices.has(candidateChunk.startParagraphIndex + off)
          );
          const effectiveResumeForCandidate =
            runIsResumeMode ||
            manuscriptReplanCount > 0 ||
            chunkHasAnyProcessed;

          if (effectiveResumeForCandidate && !isFullRetranslationRun) {
            const offsets: number[] = [];
            for (let off = 0; off < candidateChunk.paragraphs.length; off++) {
              const pIdx = candidateChunk.startParagraphIndex + off;
              if (processedIndices.has(pIdx)) continue;
              const pair = currentChapterParagraphs[pIdx];
              const isSlotIncomplete =
                !pair ||
                Boolean(pair.missingTranslation) ||
                pair.banglaText.trim().length === 0 ||
                normalizeEnglishTerm(pair.englishText) !==
                  normalizeEnglishTerm(candidateChunk.paragraphs[off]) ||
                hasStaleCarriedOverBanglaAt(pair, pIdx);
              if (!isSlotIncomplete) continue;
              if (
                isIntentionalInFlightClearOrRevert(
                  pair,
                  pIdx,
                  mapStartToCurrent,
                  currentChapterParagraphs.length
                )
              ) {
                processedIndices.add(pIdx);
                continue;
              }
              offsets.push(off);
            }
            if (offsets.length > 0) {
              selectedChunk = candidateChunk;
              requestedOffsets = offsets;
              chunkIsResumeMode = true;
              break;
            }
          } else if (isFullRetranslationRun) {
            const offsets: number[] = [];
            for (let off = 0; off < candidateChunk.paragraphs.length; off++) {
              const pIdx = candidateChunk.startParagraphIndex + off;
              if (processedIndices.has(pIdx)) {
                continue;
              }
              const pair = currentChapterParagraphs[pIdx];
              if (
                isIntentionalInFlightClearOrRevert(
                  pair,
                  pIdx,
                  mapStartToCurrent,
                  currentChapterParagraphs.length
                ) ||
                hasUserAuthoredValidBanglaDuringRun(
                  pair,
                  pIdx,
                  mapStartToCurrent,
                  currentChapterParagraphs.length
                )
              ) {
                processedIndices.add(pIdx);
                continue;
              }
              offsets.push(off);
            }
            if (offsets.length > 0) {
              selectedChunk = candidateChunk;
              requestedOffsets = offsets;
              chunkIsResumeMode = false;
              break;
            }
          } else {
            const offsets: number[] = [];
            for (let off = 0; off < candidateChunk.paragraphs.length; off++) {
              const pIdx = candidateChunk.startParagraphIndex + off;
              if (processedIndices.has(pIdx)) {
                continue;
              }
              const pair = currentChapterParagraphs[pIdx];
              if (
                isIntentionalInFlightClearOrRevert(
                  pair,
                  pIdx,
                  mapStartToCurrent,
                  currentChapterParagraphs.length
                ) ||
                hasUserAuthoredValidBanglaDuringRun(
                  pair,
                  pIdx,
                  mapStartToCurrent,
                  currentChapterParagraphs.length
                )
              ) {
                processedIndices.add(pIdx);
                continue;
              }
              offsets.push(off);
            }
            if (offsets.length > 0) {
              selectedChunk = candidateChunk;
              requestedOffsets = offsets;
              chunkIsResumeMode = false;
              break;
            }
          }
        }

        if (!selectedChunk || requestedOffsets.length === 0) {
          break;
        }

        executedChunkIterations += 1;
        const chunk = selectedChunk;
        const chunkSnapshotParagraphs: ParagraphPair[] =
          currentChapterParagraphs.map((p) => ({ ...p }));
        const chunkStartOriginalText = chunkStartCh.originalText;

        const firstRequestedOffset = requestedOffsets[0] ?? 0;
        const firstTargetGlobalIdx =
          chunk.startParagraphIndex + firstRequestedOffset;

        // Derive continuity context from the latest preceding paragraphs before firstTargetGlobalIdx
        const previousContextParagraphs: string[] = [];
        const priorTranslatedPairs: Array<{
          englishText: string;
          banglaText: string;
        }> = [];
        if (firstTargetGlobalIdx > 0) {
          const ctxStart = Math.max(0, firstTargetGlobalIdx - contextWindow);
          for (let idx = 0; idx < ctxStart; idx++) {
            const pair = chunkSnapshotParagraphs[idx];
            if (pair) {
              const bnTrimmed = pair.banglaText.trim();
              if (bnTrimmed.length > 0) {
                priorTranslatedPairs.push({
                  englishText: pair.englishText,
                  banglaText: bnTrimmed,
                });
              }
            }
          }
          for (let idx = ctxStart; idx < firstTargetGlobalIdx; idx++) {
            const pair = chunkSnapshotParagraphs[idx];
            if (pair) {
              const bnTrimmed = pair.banglaText.trim();
              previousContextParagraphs.push(
                bnTrimmed.length > 0
                  ? `${pair.englishText}\n[Bangla: ${bnTrimmed}]`
                  : pair.englishText
              );
            }
          }
        }

        // Derive latest preceding non-empty Bangla translation for duplicate context-echo stripping
        let prevLastBangla = '';
        for (let idx = firstTargetGlobalIdx - 1; idx >= 0; idx--) {
          const bnTrimmed = (
            chunkSnapshotParagraphs[idx]?.banglaText ?? ''
          ).trim();
          if (bnTrimmed.length > 0) {
            prevLastBangla = bnTrimmed;
            break;
          }
        }

        const requestParagraphs = requestedOffsets.map(
          (off) => chunk.paragraphs[off]
        );

        setStage3Banner(
          chunkIsResumeMode
            ? `Stage 3/5: Resuming chunk ${chunk.chunkIndex + 1} of ${currentPlan.chunks.length} (${requestParagraphs.length} missing paragraph${requestParagraphs.length === 1 ? '' : 's'}) using Author Style Profile & Memory...`
            : `Stage 3/5: Translating chunk ${chunk.chunkIndex + 1} of ${currentPlan.chunks.length} (${requestParagraphs.length} paragraphs) using Author Style Profile & Memory...`
        );

        // 1. Capture a fresh glossary snapshot immediately before each individual chunk request
        const chunkGlossarySnapshot: TerminologyMemoryItem[] = (
          chunkStartProj.terminologyMemory || []
        ).map((t) => ({
          ...t,
          acceptedAlternatives: t.acceptedAlternatives
            ? [...t.acceptedAlternatives]
            : undefined,
          avoidTranslations: t.avoidTranslations
            ? [...t.avoidTranslations]
            : undefined,
        }));

        // 2. Pass that snapshot and compacted/full requestParagraphs to the server
        const res = await fetchFn('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'stage3_translate_chunk',
            paragraphs: requestParagraphs,
            previousContextParagraphs,
            ...(priorTranslatedPairs.length > 0
              ? { priorTranslatedPairs }
              : {}),
            styleProfile: chunkStartProj.styleProfile,
            storyContext: chunkStartProj.storyContext,
            characters: chunkStartProj.characterMemory,
            terminology: chunkGlossarySnapshot,
            styleControls: chunkStartProj.styleControls,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ||
              `Failed on chunk ${chunk.chunkIndex + 1} of ${currentPlan.chunks.length}`
          );
        }

        // 3. Verify sequence and project/chapter identity after async boundary
        if (!isCurrentStage3Run()) {
          return ctx.getProject();
        }
        const latestAfterChunk = ctx.getProject();
        if (!latestAfterChunk || latestAfterChunk.id !== targetProjectId) {
          return latestAfterChunk;
        }
        const existingCh = latestAfterChunk.chapters.find(
          (item) => item.id === targetChapterId
        );
        if (!existingCh) {
          setStage3BannerTone('warning');
          setStage3Banner(
            'Stage 3 Translation stopped because the target chapter was no longer found.'
          );
          return latestAfterChunk;
        }

        const latestChParagraphs =
          existingCh.paragraphs.length > 0 || !existingCh.originalText.trim()
            ? existingCh.paragraphs
            : alignParagraphs(
                existingCh.originalText,
                existingCh.translatedText,
                existingCh.paragraphs
              );

        if (existingCh.originalText !== chunkStartOriginalText) {
          manuscriptReplanCount += 1;
          lastPlannedOriginalText = existingCh.originalText;
        }

        const rawReturnedParagraphs: string[] = Array.isArray(
          data.translatedParagraphs
        )
          ? data.translatedParagraphs.map((p: unknown) =>
              typeof p === 'string' ? p : String(p ?? '')
            )
          : [];

        const cleanedReturnedParagraphs = [...rawReturnedParagraphs];
        if (
          firstTargetGlobalIdx > 0 &&
          cleanedReturnedParagraphs.length > requestedOffsets.length &&
          prevLastBangla.length > 0 &&
          (cleanedReturnedParagraphs[0] ?? '').trim() === prevLastBangla
        ) {
          cleanedReturnedParagraphs.shift();
        }

        const mapStartToLatestAfter = mapSnapshotParagraphsToLatest(
          stage3StartParagraphs,
          latestChParagraphs
        );
        const mapSnapToLatestAfter = mapSnapshotParagraphsToLatest(
          chunkSnapshotParagraphs,
          latestChParagraphs
        );

        // Reconstruct rawChunkOutput to match the full chunk paragraph length (0 .. chunk.paragraphs.length - 1)
        const reconstructedRawChunkOutput = new Array<string>(
          chunk.paragraphs.length
        ).fill('');
        for (let reqIdx = 0; reqIdx < requestedOffsets.length; reqIdx++) {
          const offset = requestedOffsets[reqIdx];
          const snapGlobalIdx = chunk.startParagraphIndex + offset;
          const mappedLatestIdx =
            mapSnapToLatestAfter.snapToLatestIndex.get(snapGlobalIdx);
          if (
            mappedLatestIdx !== undefined &&
            isIntentionalInFlightClearOrRevert(
              latestChParagraphs[mappedLatestIdx],
              mappedLatestIdx,
              mapStartToLatestAfter,
              latestChParagraphs.length,
              mapSnapToLatestAfter,
              chunkSnapshotParagraphs
            )
          ) {
            reconstructedRawChunkOutput[offset] = '';
          } else {
            reconstructedRawChunkOutput[offset] =
              cleanedReturnedParagraphs[reqIdx] ?? '';
          }
        }

        const mapStartToChunkSnap = mapSnapshotParagraphsToLatest(
          stage3StartParagraphs,
          chunkSnapshotParagraphs
        );
        const effectiveStage3StartParagraphs: ParagraphPair[] =
          chunkSnapshotParagraphs.map((snapPair, snapIdx) => {
            if (
              isIntentionalInFlightClearOrRevert(
                snapPair,
                snapIdx,
                mapStartToChunkSnap,
                chunkSnapshotParagraphs.length
              )
            ) {
              return {
                index: snapIdx,
                englishText: snapPair.englishText,
                banglaText:
                  snapPair.previousBanglaText &&
                  snapPair.previousBanglaText.trim().length > 0
                    ? snapPair.previousBanglaText
                    : 'প্রাথমিক অনুবাদ',
              };
            }
            if (
              hasUserAuthoredValidBanglaDuringRun(
                snapPair,
                snapIdx,
                mapStartToChunkSnap,
                chunkSnapshotParagraphs.length
              ) ||
              (isFullRetranslationRun &&
                processedIndices.has(snapIdx) &&
                !snapPair.missingTranslation &&
                normalizeBanglaUnicode((snapPair.banglaText ?? '').trim())
                  .length > 0)
            ) {
              return {
                index: snapIdx,
                englishText: snapPair.englishText,
                banglaText: '',
              };
            }
            const startIdx = mapStartToChunkSnap.latestToSnapIndex.get(snapIdx);
            if (startIdx !== undefined && stage3StartParagraphs[startIdx]) {
              return stage3StartParagraphs[startIdx];
            }
            if (hasStaleCarriedOverBanglaAt(snapPair, snapIdx)) {
              return {
                ...snapPair,
                missingTranslation: true,
              };
            }
            return snapPair;
          });

        const effectiveChunkSnapshotParagraphs: ParagraphPair[] =
          chunkSnapshotParagraphs.map((snapPair, snapIdx) => {
            if (hasStaleCarriedOverBanglaAt(snapPair, snapIdx)) {
              return {
                ...snapPair,
                missingTranslation: true,
              };
            }
            return snapPair;
          });

        const effectiveLatestParagraphs: ParagraphPair[] =
          latestChParagraphs.map((latestPair, latestIdx) => {
            const snapIdx =
              mapSnapToLatestAfter.latestToSnapIndex.get(latestIdx);
            if (snapIdx !== undefined && chunkSnapshotParagraphs[snapIdx]) {
              const snapPair = chunkSnapshotParagraphs[snapIdx];
              if (
                !hasBanglaStateChangedBetweenPairs(snapPair, latestPair) &&
                hasStaleCarriedOverBanglaAt(snapPair, snapIdx)
              ) {
                return {
                  ...latestPair,
                  missingTranslation: true,
                };
              }
              if (
                (snapPair.banglaText ?? '').trim().length === 0 &&
                (latestPair.banglaText ?? '').trim().length === 0 &&
                Boolean(snapPair.missingTranslation) !==
                  Boolean(latestPair.missingTranslation) &&
                !isIntentionalInFlightClearOrRevert(
                  latestPair,
                  latestIdx,
                  mapStartToLatestAfter,
                  latestChParagraphs.length,
                  mapSnapToLatestAfter,
                  chunkSnapshotParagraphs
                )
              ) {
                const syncedEmpty: ParagraphPair = {
                  ...latestPair,
                };
                if (snapPair.missingTranslation) {
                  syncedEmpty.missingTranslation = true;
                } else {
                  delete syncedEmpty.missingTranslation;
                }
                return syncedEmpty;
              }
            }
            return latestPair;
          });

        const reconciledChunk = reconcileStage3ChunkWithLatestState({
          stage3StartParagraphs: effectiveStage3StartParagraphs,
          chunkSnapshotParagraphs: effectiveChunkSnapshotParagraphs,
          latestParagraphs: effectiveLatestParagraphs,
          chunk,
          rawChunkOutput: reconstructedRawChunkOutput,
          isResumeMode: chunkIsResumeMode,
        });

        const mapTrackedToReconciled = mapSnapshotParagraphsToLatest(
          trackedParagraphs,
          reconciledChunk.paragraphs
        );
        const updatedProcessed = new Set<number>();
        for (const oldIdx of processedIndices) {
          const mappedIdx =
            mapTrackedToReconciled.snapToLatestIndex.get(oldIdx);
          if (mappedIdx !== undefined) {
            updatedProcessed.add(mappedIdx);
          }
        }
        const mapSnapToReconciled = mapSnapshotParagraphsToLatest(
          chunkSnapshotParagraphs,
          reconciledChunk.paragraphs
        );
        for (let off = 0; off < chunk.paragraphs.length; off++) {
          const snapGlobalIdx = chunk.startParagraphIndex + off;
          const mappedIdx =
            mapSnapToReconciled.snapToLatestIndex.get(snapGlobalIdx);
          if (mappedIdx !== undefined) {
            updatedProcessed.add(mappedIdx);
          }
        }
        trackedParagraphs = reconciledChunk.paragraphs.map((p) => ({ ...p }));
        processedIndices = updatedProcessed;

        // 4. Ground Stage 3 glossary discovery strictly against the actual applied paragraph translations
        const appliedSourceTexts: string[] = [];
        const appliedBanglaTexts: string[] = [];
        for (const appliedIdx of reconciledChunk.appliedParagraphIndices) {
          const appliedPair = reconciledChunk.paragraphs[appliedIdx];
          if (appliedPair && appliedPair.banglaText.trim().length > 0) {
            appliedSourceTexts.push(appliedPair.englishText);
            appliedBanglaTexts.push(appliedPair.banglaText);
          }
        }
        const appliedChunkSourceText = appliedSourceTexts.join('\n\n');
        const appliedChunkBanglaText = appliedBanglaTexts.join('\n\n');

        const discoveredTerms: Partial<TerminologyMemoryItem>[] = Array.isArray(
          data.discoveredTerms
        )
          ? data.discoveredTerms
          : [];

        const reconciledChunkGlossary =
          reconcileStage3ChunkGlossaryWithLatestState({
            snapshotGlossary: chunkGlossarySnapshot,
            discoveredCandidates: discoveredTerms,
            latestGlossary: latestAfterChunk.terminologyMemory,
            chunkSourceText: appliedChunkSourceText,
            chunkBanglaText: appliedChunkBanglaText,
          });

        const postChunkPlan = planStage3ChunkExecution({
          originalText: existingCh.originalText,
          paragraphs: reconciledChunk.paragraphs,
          maxWordsPerChunk,
          contextWindow,
        });

        // 5. Persist the reconciled glossary and partial chunk progress before proceeding to the next chunk
        const chunkCompletedAt = new Date().toISOString();
        const nextChunkProj: TranslationProject = {
          ...latestAfterChunk,
          terminologyMemory: reconciledChunkGlossary.terminologyMemory,
          updatedAt: chunkCompletedAt,
          chapters: latestAfterChunk.chapters.map((item) =>
            item.id === targetChapterId
              ? {
                  ...item,
                  status: 'in_progress',
                  currentStage: 3,
                  chunkCount: postChunkPlan.chunks.length,
                  completedChunks: postChunkPlan.completedChunkIndices.length,
                  translatedText: reconciledChunk.fullBanglaText,
                  paragraphs: reconciledChunk.paragraphs,
                  updatedAt: chunkCompletedAt,
                }
              : item
          ),
        };
        ctx.setProject(nextChunkProj);
        ctx.onUpdateProject(nextChunkProj);

        if (
          manuscriptReplanCount > MAX_STAGE3_MANUSCRIPT_REPLANS ||
          !existingCh.originalText.trim() ||
          (existingCh.originalText !== chunkStartOriginalText &&
            mapSnapToReconciled.snapToLatestIndex.size === 0)
        ) {
          stoppedDueToManuscriptChanges =
            manuscriptReplanCount > MAX_STAGE3_MANUSCRIPT_REPLANS ||
            (existingCh.originalText !== chunkStartOriginalText &&
              mapSnapToReconciled.snapToLatestIndex.size === 0);
          break;
        }
      }

      if (!isCurrentStage3Run()) {
        return ctx.getProject();
      }
      const latestAtStage3End = ctx.getProject();
      if (!latestAtStage3End || latestAtStage3End.id !== targetProjectId) {
        return latestAtStage3End;
      }
      const endTargetCh = latestAtStage3End.chapters.find(
        (item) => item.id === targetChapterId
      );
      if (!endTargetCh) {
        setStage3BannerTone('warning');
        setStage3Banner(
          'Stage 3 Translation finished, but its target chapter was no longer found. No final changes were applied.'
        );
        return latestAtStage3End;
      }

      const finalized = finalizeStage3ChapterState({
        stage3StartParagraphs,
        latestParagraphs: endTargetCh.paragraphs,
        latestOriginalText: endTargetCh.originalText,
        maxWordsPerChunk,
        contextWindow,
        previousVerificationReport: endTargetCh.verificationReport,
        wasVerificationCompleted: endTargetCh.stageCompleted.verification,
        latestGlossary: latestAtStage3End.terminologyMemory,
      });

      const effectiveStageCompletedTranslation = stoppedDueToManuscriptChanges
        ? false
        : finalized.stageCompletedTranslation;
      const effectiveStatus: Chapter['status'] = stoppedDueToManuscriptChanges
        ? 'needs_review'
        : finalized.chapterStatus;
      const effectiveVerificationReport: VerificationReport | null =
        finalized.verificationReport
          ? finalized.stageCompletedVerification
            ? finalized.verificationReport
            : { ...finalized.verificationReport, isComplete: false }
          : null;

      const updatedProj = updateChapterInProject(
        latestAtStage3End,
        targetChapterId,
        (existing) => ({
          ...existing,
          translatedText: finalized.translatedText,
          draftTranslatedText: finalized.draftTranslatedText,
          paragraphs: finalized.paragraphs,
          verificationReport: effectiveVerificationReport,
          status: effectiveStatus,
          currentStage: 3,
          chunkCount: finalized.chunkCount,
          completedChunks: finalized.completedChunks,
          stageCompleted: {
            ...existing.stageCompleted,
            translation: effectiveStageCompletedTranslation,
            verification: finalized.stageCompletedVerification,
          },
          updatedAt: new Date().toISOString(),
        })
      );

      if (canOwnStage3UI()) {
        stage3SeqMap[`__exec_stage3_completed_seq_${workspaceExecId}__`] =
          requestSeq;
      }

      if (stoppedDueToManuscriptChanges) {
        setStage3BannerTone('warning');
        setStage3Banner(
          `Stage 3 Translation stopped early because the English manuscript kept changing while translation was in progress (${finalized.completedChunks}/${finalized.chunkCount} chunk(s) complete). Committed paragraph translations were preserved—please review and resume Stage 3 when ready.`
        );
      } else if (
        !effectiveStageCompletedTranslation ||
        finalized.missingIndices.length > 0 ||
        finalized.completedChunks < finalized.chunkCount
      ) {
        setStage3BannerTone('warning');
        setStage3Banner(
          `Stage 3 Translation finished with incomplete paragraphs (${finalized.completedChunks}/${finalized.chunkCount} chunk(s) complete; ${finalized.missingIndices.length} paragraph(s) missing translation). Please review or resume Stage 3.`
        );
      } else if (isStandaloneRun) {
        setStage3Banner(null);
      }

      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: targetChapterTitle,
        actionType: 'stage_3_translation',
        summary: stoppedDueToManuscriptChanges
          ? `Stage 3 stopped early after repeated manuscript edits (${finalized.completedChunks}/${finalized.chunkCount} chunk(s) complete; ${finalized.missingIndices.length} missing).`
          : finalized.missingIndices.length > 0
            ? `Translated ${finalized.paragraphs.length - finalized.missingIndices.length}/${finalized.paragraphs.length} paragraphs across ${finalized.chunkCount} chunk(s) (${finalized.missingIndices.length} missing).`
            : `Translated ${finalized.paragraphs.length} paragraphs across ${finalized.chunkCount} chunk(s) into literary Bangla.`,
      });

      return updatedProj;
    } finally {
      if (
        isStandaloneRun &&
        isCurrentStage3Run() &&
        isCurrentWorkspaceExecution(workspaceExecId)
      ) {
        setRunningStage(0);
      }
    }
  };

  // Stage 4: Literary Editing Pass
  const executeStage4 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    inheritedWorkspaceExecId?: number
  ): Promise<TranslationProject> => {
    const isStandaloneRun = inheritedWorkspaceExecId === undefined;
    const workspaceExecId =
      inheritedWorkspaceExecId ?? claimWorkspaceExecution();
    const preRequestProj = ctx.getProject() ?? currentProj;
    const targetProjectId = pinnedTargetProjectId ?? preRequestProj?.id;
    if (
      !preRequestProj ||
      !targetProjectId ||
      preRequestProj.id !== targetProjectId
    ) {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
      return preRequestProj;
    }

    const ch = resolvePinnedOrActiveChapter(
      preRequestProj,
      pinnedTargetChapterId
    );
    if (!ch) {
      if (isCurrentWorkspaceExecution(workspaceExecId, targetProjectId)) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Stage 4 Literary Editing could not run because the target chapter was no longer found.'
        );
        if (isStandaloneRun) {
          setRunningStage(0);
        }
      }
      return preRequestProj;
    }
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    const stage3SeqMap = getStage3SeqMap();
    const stage4SeqKey = `__stage4_seq__:${targetProjectId}:${targetChapterId}`;
    const requestSeq = (stage3SeqMap[stage4SeqKey] ?? 0) + 1;
    stage3SeqMap[stage4SeqKey] = requestSeq;
    stage3SeqMap[`__exec_stage4_seq_${workspaceExecId}__`] = requestSeq;

    const isCurrentStage4Run = (): boolean =>
      getStage3SeqMap()[stage4SeqKey] === requestSeq &&
      isCurrentWorkspaceExecution(workspaceExecId, targetProjectId);

    const invalidateEditingFlagIfSet = (): void => {
      const latest = ctx.getProject();
      if (!latest || latest.id !== targetProjectId) return;
      const latestCh = latest.chapters.find((c) => c.id === targetChapterId);
      if (latestCh && latestCh.stageCompleted.editing) {
        updateChapterInProject(latest, targetChapterId, (existing) => ({
          ...existing,
          stageCompleted: {
            ...existing.stageCompleted,
            editing: false,
          },
          updatedAt: new Date().toISOString(),
        }));
      }
    };

    try {
      // 1. Snapshot target chapter paragraph pairs and validate Stage 4 input preconditions before request
      const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({
        ...p,
      }));
      const engParagraphs = snapshotParagraphs.map((p) => p.englishText);
      const bnParagraphs = snapshotParagraphs.map((p) => p.banglaText);

      const expectedSourceParagraphs = splitIntoParagraphs(
        ch.originalText || ''
      );
      if (
        snapshotParagraphs.length === 0 ||
        expectedSourceParagraphs.length === 0
      ) {
        invalidateEditingFlagIfSet();
        throw new Error(
          'Stage 4 Literary Editing requires at least one paragraph in the chapter.'
        );
      }

      if (snapshotParagraphs.length !== expectedSourceParagraphs.length) {
        invalidateEditingFlagIfSet();
        throw new Error(
          'Stage 4 Literary Editing cannot run because chapter paragraphs are not aligned with the English manuscript. Please run Stage 3 Translation first.'
        );
      }

      const misalignedOrEmptyEnglishIdx = snapshotParagraphs.findIndex(
        (p, idx) =>
          typeof p.englishText !== 'string' ||
          normalizeEnglishTerm(p.englishText).length === 0 ||
          normalizeEnglishTerm(p.englishText) !==
            normalizeEnglishTerm(expectedSourceParagraphs[idx] || '')
      );
      if (misalignedOrEmptyEnglishIdx !== -1) {
        invalidateEditingFlagIfSet();
        throw new Error(
          `Stage 4 Literary Editing cannot run because paragraph ${misalignedOrEmptyEnglishIdx + 1} has empty or unaligned English source text.`
        );
      }

      if (bnParagraphs.every((b) => !b || !b.trim())) {
        invalidateEditingFlagIfSet();
        throw new Error(
          'Please run Stage 3 Translation before running Stage 4 Literary Editing.'
        );
      }

      const missingOrBlankBanglaIdx = snapshotParagraphs.findIndex(
        (p) =>
          Boolean(p.missingTranslation) ||
          typeof p.banglaText !== 'string' ||
          p.banglaText.trim().length === 0 ||
          normalizeBanglaUnicode(p.banglaText.trim()).length === 0
      );
      if (missingOrBlankBanglaIdx !== -1) {
        invalidateEditingFlagIfSet();
        throw new Error(
          `Stage 4 Literary Editing requires all paragraphs to be translated before editing (paragraph ${missingOrBlankBanglaIdx + 1} is untranslated or blank).`
        );
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
        avoidTranslations: t.avoidTranslations
          ? [...t.avoidTranslations]
          : undefined,
      }));
      const snapshotStyleProfile: StyleProfile | null =
        preRequestProj.styleProfile
          ? { ...preRequestProj.styleProfile }
          : null;
      const snapshotStyleControls: TranslationStyleControls = {
        ...preRequestProj.styleControls,
      };

      if (!isCurrentStage4Run()) {
        return ctx.getProject();
      }

      if (isCurrentStage4Run()) {
        setErrorBanner(null);
        setRunningStage(4);
        setPipelineBanner(
          'Stage 4/5: Running Chief Literary Editor pass to elevate Bangla sentence flow, dialogue cadence, and word choice...'
        );
      }

      const res = await fetchFn('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'stage4_editing',
          englishParagraphs: engParagraphs,
          banglaParagraphs: bnParagraphs,
          styleProfile: snapshotStyleProfile,
          storyContext: preRequestProj.storyContext || null,
          characters: snapshotCharacters,
          terminology: snapshotGlossary,
          styleControls: snapshotStyleControls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Stage 4 Literary Editing failed');
      }

      if (!Array.isArray(data.editedParagraphs)) {
        throw new Error(
          'Stage 4 Literary Editing returned an invalid response: missing editedParagraphs array.'
        );
      }
      if (data.editedParagraphs.length !== snapshotParagraphs.length) {
        throw new Error(
          `Stage 4 Literary Editing returned ${data.editedParagraphs.length} paragraph(s), expected ${snapshotParagraphs.length}.`
        );
      }
      for (let idx = 0; idx < snapshotParagraphs.length; idx++) {
        const item = data.editedParagraphs[idx];
        if (
          typeof item !== 'string' ||
          item.trim().length === 0 ||
          normalizeBanglaUnicode(item.trim()).length === 0
        ) {
          throw new Error(
            `Stage 4 Literary Editing returned an empty or invalid translation for paragraph ${idx + 1}.`
          );
        }
      }

      // 2. Read authoritative latest project state and verify execution ownership after async boundary
      const latestProj = ctx.getProject();
      if (!latestProj || latestProj.id !== targetProjectId) {
        return latestProj;
      }
      if (!isCurrentStage4Run()) {
        return latestProj;
      }

      const latestChapter = latestProj.chapters.find(
        (c) => c.id === targetChapterId
      );
      if (!latestChapter) {
        if (isCurrentStage4Run()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Stage 4 Literary Editing finished, but its target chapter was no longer found. No changes were applied.'
          );
        }
        return latestProj;
      }

      // 3. Reconcile Stage 4 output against snapshot and latest paragraphs/glossary/verification report
      const reconciledStage4 = reconcileStage4ResultWithLatestState({
        snapshotParagraphs,
        latestParagraphs: latestChapter.paragraphs,
        editedParagraphs: data.editedParagraphs,
        editorialNotes: Array.isArray(data.editorialNotes)
          ? data.editorialNotes
          : [],
        editorialChanges: Array.isArray(data.editorialChanges)
          ? data.editorialChanges
          : [],
        latestGlossary: latestProj.terminologyMemory,
        latestVerificationReport: latestChapter.verificationReport,
        wasVerificationCompleted: latestChapter.stageCompleted.verification,
      });

      const latestExpectedEng = splitIntoParagraphs(
        latestChapter.originalText || ''
      );
      const isLatestAlignedWithOriginalText =
        latestExpectedEng.length > 0 &&
        latestExpectedEng.length === reconciledStage4.paragraphs.length &&
        reconciledStage4.paragraphs.every(
          (p, idx) =>
            typeof p.englishText === 'string' &&
            normalizeEnglishTerm(p.englishText).length > 0 &&
            normalizeEnglishTerm(p.englishText) ===
              normalizeEnglishTerm(latestExpectedEng[idx] || '') &&
            !p.missingTranslation &&
            typeof p.banglaText === 'string' &&
            p.banglaText.trim().length > 0 &&
            normalizeBanglaUnicode(p.banglaText.trim()).length > 0
        );

      const effectiveStageCompletedEditing =
        reconciledStage4.stageCompletedEditing &&
        isLatestAlignedWithOriginalText;
      const effectiveStageCompletedVerification =
        effectiveStageCompletedEditing &&
        reconciledStage4.stageCompletedVerification;
      const effectiveChapterStatus: Chapter['status'] =
        effectiveStageCompletedVerification
          ? reconciledStage4.chapterStatus
          : 'needs_review';

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
          status: effectiveChapterStatus,
          stageCompleted: {
            ...existing.stageCompleted,
            editing: effectiveStageCompletedEditing,
            verification: effectiveStageCompletedVerification,
          },
          updatedAt: new Date().toISOString(),
        })
      );

      if (effectiveStageCompletedEditing) {
        getStage3SeqMap()[`__exec_stage4_completed_seq_${workspaceExecId}__`] =
          requestSeq;
      } else if (isCurrentStage4Run()) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Stage 4 Literary Editing reconciled with concurrent manuscript edits, leaving some paragraphs unedited. Re-run Stage 4 to complete literary editing.'
        );
      }

      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: targetChapterTitle,
        actionType: 'stage_4_editing',
        summary: !effectiveStageCompletedEditing
          ? `Partial Stage 4 Literary Editing (${reconciledStage4.appliedParagraphIndices.length}/${reconciledStage4.paragraphs.length} paragraphs edited; manuscript changed during editing).`
          : reconciledStage4.preservedInFlightParagraphIndices.length > 0
            ? `Completed Stage 4 Literary Editing (${reconciledStage4.editorialChanges.length} stylistic improvements applied; ${reconciledStage4.preservedInFlightParagraphIndices.length} paragraph(s) edited in flight preserved).`
            : `Completed Stage 4 Literary Editing with ${reconciledStage4.editorialChanges.length} stylistic improvements.`,
      });

      return updatedProj;
    } finally {
      if (
        isStandaloneRun &&
        getStage3SeqMap()[stage4SeqKey] === requestSeq &&
        isCurrentWorkspaceExecution(workspaceExecId)
      ) {
        setRunningStage(0);
      }
    }
  };

  // Stage 5: Accuracy Verification
  const executeStage5 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    inheritedWorkspaceExecId?: number
  ): Promise<TranslationProject> => {
    const isStandaloneRun = inheritedWorkspaceExecId === undefined;
    const workspaceExecId =
      inheritedWorkspaceExecId ?? claimWorkspaceExecution();
    const preRequestProj = ctx.getProject() ?? currentProj;
    const targetProjectId = pinnedTargetProjectId ?? preRequestProj?.id;
    if (
      !preRequestProj ||
      !targetProjectId ||
      preRequestProj.id !== targetProjectId
    ) {
      if (isStandaloneRun && isCurrentWorkspaceExecution(workspaceExecId)) {
        setRunningStage(0);
      }
      return preRequestProj;
    }

    const ch = resolvePinnedOrActiveChapter(
      preRequestProj,
      pinnedTargetChapterId
    );
    if (!ch) {
      if (isCurrentWorkspaceExecution(workspaceExecId, targetProjectId)) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Stage 5 Accuracy Verification could not run because the target chapter was no longer found.'
        );
        if (isStandaloneRun) {
          setRunningStage(0);
        }
      }
      return preRequestProj;
    }
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    // 1. Snapshot target chapter paragraphs and memory before starting Stage 5 request
    const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({
      ...p,
    }));
    const engParagraphs = snapshotParagraphs.map((p) => p.englishText);
    const bnParagraphs = snapshotParagraphs.map((p) => p.banglaText);

    // 2. Increment Stage 5 sequence counter exclusively when a new Stage 5 request starts for this project+chapter
    const seqMap = ctx.getStage5SeqMap();
    const seqKey = `${targetProjectId}:${targetChapterId}`;
    const requestSeq = (seqMap[seqKey] ?? 0) + 1;
    seqMap[seqKey] = requestSeq;
    seqMap[targetChapterId] = requestSeq;

    const canOwnStage5UI = (): boolean =>
      ctx.getStage5SeqMap()[seqKey] === requestSeq &&
      isCurrentWorkspaceExecution(workspaceExecId, targetProjectId);

    try {
      if (bnParagraphs.every((b) => !b.trim())) {
        throw new Error(
          'Please translate the chapter before running Accuracy Verification.'
        );
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
        avoidTranslations: t.avoidTranslations
          ? [...t.avoidTranslations]
          : undefined,
      }));

      if (canOwnStage5UI()) {
        setErrorBanner(null);
        setRunningStage(5);
        setPipelineBanner(
          'Stage 5/5: Comparing Original English against Final Bangla to verify completeness, dialogue accuracy, and emotional fidelity...'
        );
      }

      const res = await fetchFn('/api/translate', {
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

      // 3. Verify project identity first
      const latestProj = ctx.getProject();
      if (!latestProj || latestProj.id !== targetProjectId) {
        return latestProj;
      }

      // 4. Discard response ONLY if a newer Stage 5 request for the same project+chapter superseded this request
      if (ctx.getStage5SeqMap()[seqKey] !== requestSeq) {
        return latestProj;
      }

      // 5. Locate target chapter and reconcile via reconcileStage5ResultWithLatestState
      const latestChapter = latestProj.chapters.find(
        (c) => c.id === targetChapterId
      );
      if (!latestChapter) {
        if (canOwnStage5UI()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Stage 5 Accuracy Verification finished, but its target chapter was no longer found. No changes were applied.'
          );
        }
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
    } finally {
      if (
        isStandaloneRun &&
        ctx.getStage5SeqMap()[seqKey] === requestSeq &&
        isCurrentWorkspaceExecution(workspaceExecId)
      ) {
        setRunningStage(0);
      }
    }
  };

  // Full 5-Stage Automated Adaptive Pipeline (Pinned to target project & target chapter)
  const handleRunFullPipeline = async (
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const pipelineExecId = claimWorkspaceExecution();
    const startProj = ctx.getProject();
    const targetProjectId = pinnedTargetProjectId ?? startProj?.id;
    if (!startProj || !targetProjectId || startProj.id !== targetProjectId) {
      if (isCurrentWorkspaceExecution(pipelineExecId)) {
        setRunningStage(0);
      }
      return startProj;
    }

    const canOwnPipelineUI = (): boolean =>
      isCurrentWorkspaceExecution(pipelineExecId, targetProjectId);

    try {
      if (canOwnPipelineUI()) {
        setErrorBanner(null);
        setPipelineBannerTone('success');
      }

      const initialCh = resolvePinnedOrActiveChapter(
        startProj,
        pinnedTargetChapterId
      );
      if (!initialCh) {
        if (canOwnPipelineUI()) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Pipeline could not start because the target chapter was not found.'
          );
        }
        return startProj;
      }
      const targetChapterId = initialCh.id;

      const canContinue = (): boolean => {
        if (!isCurrentWorkspaceExecution(pipelineExecId, targetProjectId)) {
          return false;
        }
        const latest = ctx.getProject();
        if (!latest || latest.id !== targetProjectId) {
          return false;
        }
        if (!latest.chapters.some((c) => c.id === targetChapterId)) {
          if (canOwnPipelineUI()) {
            setPipelineBannerTone('warning');
            setPipelineBanner(
              'Pipeline stopped because the target chapter was no longer found.'
            );
          }
          return false;
        }
        return true;
      };

      // Stage 1: Literary Understanding
      let cur = await executeStage1(
        startProj,
        targetChapterId,
        targetProjectId,
        pipelineExecId
      );
      if (!canContinue()) return ctx.getProject();

      // Stage 2: Author Voice Profile (if no Style Profile exists yet)
      cur = ctx.getProject();
      if (!cur.styleProfile) {
        cur = await executeStage2(
          cur,
          targetChapterId,
          targetProjectId,
          pipelineExecId
        );
        if (!canContinue()) return ctx.getProject();
      }

      // Stage 3: Faithful Literary Translation
      cur = await executeStage3(
        ctx.getProject(),
        targetChapterId,
        targetProjectId,
        pipelineExecId
      );
      if (!canContinue()) return ctx.getProject();

      // Fix A: Verify Stage 3 execution ownership and full chapter translation completeness before Stage 4/5
      const stage3SeqMap = getStage3SeqMap();
      const stage3SeqKey = `${targetProjectId}:${targetChapterId}`;
      const expectedStage3Seq =
        stage3SeqMap[`__exec_stage3_seq_${pipelineExecId}__`];
      const completedStage3Seq =
        stage3SeqMap[`__exec_stage3_completed_seq_${pipelineExecId}__`];
      if (
        expectedStage3Seq === undefined ||
        completedStage3Seq !== expectedStage3Seq ||
        stage3SeqMap[stage3SeqKey] !== expectedStage3Seq
      ) {
        return ctx.getProject();
      }

      const latestAfterStage3 = ctx.getProject();
      const chAfterStage3 = latestAfterStage3?.chapters.find(
        (c) => c.id === targetChapterId
      );
      const expectedParagraphsAfterStage3 = chAfterStage3
        ? splitIntoParagraphs(chAfterStage3.originalText)
        : [];
      const isStage3FullyTranslated =
        Boolean(chAfterStage3) &&
        chAfterStage3!.stageCompleted.translation === true &&
        expectedParagraphsAfterStage3.length > 0 &&
        chAfterStage3!.paragraphs.length ===
          expectedParagraphsAfterStage3.length &&
        chAfterStage3!.paragraphs.every(
          (p) =>
            !p.missingTranslation &&
            (p.banglaText ?? '').trim().length > 0 &&
            normalizeBanglaUnicode((p.banglaText ?? '').trim()).length > 0
        );
      if (!isStage3FullyTranslated) {
        return latestAfterStage3;
      }

      // Stage 4: Literary Editing Pass
      cur = await executeStage4(
        ctx.getProject(),
        targetChapterId,
        targetProjectId,
        pipelineExecId
      );
      if (!canContinue()) return ctx.getProject();

      // Verify Stage 4 execution ownership and full chapter editing completeness before Stage 5
      const stage4SeqKey = `__stage4_seq__:${targetProjectId}:${targetChapterId}`;
      const expectedStage4Seq =
        stage3SeqMap[`__exec_stage4_seq_${pipelineExecId}__`];
      const completedStage4Seq =
        stage3SeqMap[`__exec_stage4_completed_seq_${pipelineExecId}__`];
      if (
        expectedStage4Seq === undefined ||
        completedStage4Seq !== expectedStage4Seq ||
        stage3SeqMap[stage4SeqKey] !== expectedStage4Seq
      ) {
        return ctx.getProject();
      }

      const latestAfterStage4 = ctx.getProject();
      const chAfterStage4 = latestAfterStage4?.chapters.find(
        (c) => c.id === targetChapterId
      );
      const expectedParagraphsAfterStage4 = chAfterStage4
        ? splitIntoParagraphs(chAfterStage4.originalText)
        : [];
      const isStage4FullyEdited =
        Boolean(chAfterStage4) &&
        chAfterStage4!.stageCompleted.translation === true &&
        chAfterStage4!.stageCompleted.editing === true &&
        expectedParagraphsAfterStage4.length > 0 &&
        chAfterStage4!.paragraphs.length ===
          expectedParagraphsAfterStage4.length &&
        chAfterStage4!.paragraphs.every(
          (p, idx) =>
            typeof p.englishText === 'string' &&
            normalizeEnglishTerm(p.englishText).length > 0 &&
            normalizeEnglishTerm(p.englishText) ===
              normalizeEnglishTerm(expectedParagraphsAfterStage4[idx] || '') &&
            !p.missingTranslation &&
            (p.banglaText ?? '').trim().length > 0 &&
            normalizeBanglaUnicode((p.banglaText ?? '').trim()).length > 0
        );
      if (!isStage4FullyEdited) {
        return latestAfterStage4;
      }

      // Stage 5: Accuracy Verification
      cur = await executeStage5(
        ctx.getProject(),
        targetChapterId,
        targetProjectId,
        pipelineExecId
      );
      if (!canContinue()) return ctx.getProject();

      const finalCh = cur.chapters.find((c) => c.id === targetChapterId);
      if (!finalCh) {
        return cur;
      }

      const hasUnresolvedHigh = (finalCh.verificationReport?.issues || []).some(
        (i: VerificationIssue) => i.severity === 'high' && !i.resolved
      );
      const completion = getPipelineCompletionState(
        finalCh.paragraphs,
        hasUnresolvedHigh
      );

      if (canOwnPipelineUI()) {
        if (!finalCh.stageCompleted.verification) {
          setPipelineBannerTone('warning');
          setPipelineBanner(
            'Pipeline finished with partial verification because paragraphs or glossary rules changed during verification. Re-run Stage 5 to verify all paragraphs.'
          );
        } else {
          setPipelineBannerTone(completion.bannerTone);
          setPipelineBanner(completion.bannerMessage);
          if (completion.isComplete) {
            scheduleClear(() => {
              if (canOwnPipelineUI()) {
                setPipelineBanner(null);
              }
            }, 5000);
          }
        }
      }

      return cur;
    } catch (err: unknown) {
      if (canOwnPipelineUI()) {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : 'Pipeline execution encountered an error.'
        );
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(pipelineExecId)) {
        setRunningStage(0);
      }
    }
  };

  // Individual Paragraph Refinement Handler (Movement-Safe Sequencing, Fingerprint & Cross-Project Guard)
  const handleRefineParagraph = async (
    paragraphIndex: number,
    action: ParagraphRefinementAction,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    repairIssue?: VerificationIssue | null
  ): Promise<void> => {
    const preRequestProj = ctx.getProject();
    const targetProjectId = pinnedTargetProjectId ?? preRequestProj.id;
    if (!preRequestProj || preRequestProj.id !== targetProjectId) {
      return;
    }

    const ch = resolvePinnedOrActiveChapter(
      preRequestProj,
      pinnedTargetChapterId
    );
    if (!ch) return;
    const targetChapterId = ch.id;
    const targetChapterTitle = ch.title;

    const snapshotParagraphs: ParagraphPair[] = ch.paragraphs.map((p) => ({
      ...p,
    }));
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

    // Supersede any older in-flight refinement request for the same underlying paragraph in the same project+chapter
    const reqId = ctx.nextRefineRequestId();
    const filteredActive = ctx
      .getActiveRefineRequests()
      .filter((oldReq) => {
        if (
          oldReq.projectId !== targetProjectId ||
          oldReq.chapterId !== targetChapterId
        ) {
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
      });

    ctx.setActiveRefineRequests([
      ...filteredActive,
      {
        reqId,
        projectId: targetProjectId,
        chapterId: targetChapterId,
        snapshotParagraphs,
        snapshotIndex: paragraphIndex,
        snapshotTargetFp,
        isDuplicateEnglishInSnapshot,
      },
    ]);

    setErrorBanner(null);
    setRefiningParagraphIdx(paragraphIndex);

    try {
      const prevEng = snapshotParagraphs[paragraphIndex - 1]?.englishText;
      const nextEng = snapshotParagraphs[paragraphIndex + 1]?.englishText;
      const prevBangla = snapshotParagraphs[paragraphIndex - 1]?.banglaText;
      const nextBangla = snapshotParagraphs[paragraphIndex + 1]?.banglaText;
      const customNote = getCustomParagraphNote().trim();

      const res = await fetchFn('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'refine_paragraph',
          englishParagraph: pair.englishText,
          currentBanglaParagraph: pair.banglaText,
          previousEnglishParagraph: prevEng,
          nextEnglishParagraph: nextEng,
          previousBanglaParagraph: prevBangla,
          nextBanglaParagraph: nextBangla,
          storyContext: preRequestProj.storyContext,
          action,
          customInstruction: customNote || undefined,
          repairIssue: repairIssue
            ? {
                id: repairIssue.id,
                type: repairIssue.type,
                severity: repairIssue.severity,
                paragraphIndex: repairIssue.paragraphIndex,
                description: repairIssue.description,
                englishExcerpt: repairIssue.englishExcerpt,
                banglaExcerpt: repairIssue.banglaExcerpt,
                expectedBangla: repairIssue.expectedBangla,
                detectedBanglaVariant: repairIssue.detectedBanglaVariant,
                source: repairIssue.source,
                lintReason: repairIssue.lintReason,
              }
            : undefined,
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
      const currentActive = ctx.getActiveRefineRequests();
      const stillActive = currentActive.some((r) => r.reqId === reqId);
      if (!stillActive) {
        return;
      }
      ctx.setActiveRefineRequests(
        currentActive.filter((r) => r.reqId !== reqId)
      );

      // Verify project identity after async boundary
      const latestProj = ctx.getProject();
      if (!latestProj || latestProj.id !== targetProjectId) {
        return;
      }

      const latestChapter = latestProj.chapters.find(
        (c) => c.id === targetChapterId
      );
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

      const retainedUnchanged =
        Boolean(data.retainedExisting) ||
        normalizeBanglaUnicode((data.refinedBangla ?? '').trim()) ===
          normalizeBanglaUnicode(latestTargetPair.banglaText.trim());

      const updatedProj = applyChapterLocalEditWithReconciliation(
        targetChapterId,
        (existing) => {
          const newPairs = existing.paragraphs.map((item, idx) =>
            idx === mappedLatestIdx
              ? retainedUnchanged
                ? {
                    ...item,
                    lastRefinementAction: action,
                    refinementRationale: data.rationale,
                  }
                : updateParagraphTranslation(item, data.refinedBangla, {
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
        },
        targetProjectId
      );

      if (retainedUnchanged) {
        setPipelineBannerTone('success');
        setPipelineBanner(
          `Paragraph #${mappedLatestIdx + 1}: Existing translation retained — ${data.rationale}`
        );
      } else if (action === 'issue_guided_repair') {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          `Paragraph #${mappedLatestIdx + 1} repaired (${data.rationale}). Re-run Stage 5 when ready to verify the updated chapter.`
        );
      }

      onLogHistory({
        projectId: updatedProj.id,
        projectTitle: updatedProj.title,
        chapterId: targetChapterId,
        chapterTitle: targetChapterTitle,
        actionType: 'paragraph_refinement',
        summary: retainedUnchanged
          ? `Paragraph ${mappedLatestIdx + 1} (${action.replace(/_/g, ' ')} — Retained Existing): ${data.rationale}`
          : `Refined Paragraph ${mappedLatestIdx + 1} (${action.replace(/_/g, ' ')}): ${data.rationale}`,
        paragraphIndex: mappedLatestIdx,
        previousText: latestTargetPair.banglaText,
        newText: retainedUnchanged ? latestTargetPair.banglaText : data.refinedBangla,
      });

      setCustomParagraphNote('');
    } catch (err: unknown) {
      ctx.setActiveRefineRequests(
        ctx.getActiveRefineRequests().filter((r) => r.reqId !== reqId)
      );
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not refine paragraph.'
      );
    } finally {
      if (ctx.getActiveRefineRequests().length === 0) {
        setRefiningParagraphIdx(null);
      }
    }
  };

  // Standalone UI wrappers (shared by top workflow bar buttons and sub-tab panel callbacks)
  const runStandaloneStage1 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const startProj = ctx.getProject() ?? currentProj;
    const pinnedProjId = pinnedTargetProjectId ?? startProj?.id;
    const pinnedChId =
      pinnedTargetChapterId ??
      (startProj ? resolvePinnedOrActiveChapter(startProj)?.id : undefined);
    const expectedExecId =
      (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    try {
      const updated = await executeStage1(startProj, pinnedChId, pinnedProjId);
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        pinnedChId !== undefined &&
        updated?.chapters.some((c) => c.id === pinnedChId)
      ) {
        setPipelineBanner(null);
      }
      return updated;
    } catch (e: unknown) {
      if (isCurrentWorkspaceExecution(expectedExecId, pinnedProjId)) {
        setErrorBanner(e instanceof Error ? e.message : 'Stage 1 error');
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(expectedExecId)) {
        setRunningStage(0);
      }
    }
  };

  const runStandaloneStage2 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const startProj = ctx.getProject() ?? currentProj;
    const pinnedProjId = pinnedTargetProjectId ?? startProj?.id;
    const pinnedChId =
      pinnedTargetChapterId ??
      (startProj ? resolvePinnedOrActiveChapter(startProj)?.id : undefined);
    const expectedExecId =
      (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    try {
      const updated = await executeStage2(startProj, pinnedChId, pinnedProjId);
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        pinnedChId !== undefined &&
        updated?.chapters.some((c) => c.id === pinnedChId)
      ) {
        setPipelineBanner(null);
      }
      return updated;
    } catch (e: unknown) {
      if (isCurrentWorkspaceExecution(expectedExecId, pinnedProjId)) {
        setErrorBanner(e instanceof Error ? e.message : 'Stage 2 error');
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(expectedExecId)) {
        setRunningStage(0);
      }
    }
  };

  const runStandaloneStage3 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const startProj = ctx.getProject() ?? currentProj;
    const pinnedProjId = pinnedTargetProjectId ?? startProj?.id;
    const pinnedChId =
      pinnedTargetChapterId ??
      (startProj ? resolvePinnedOrActiveChapter(startProj)?.id : undefined);
    const seqKey = `${pinnedProjId ?? ''}:${pinnedChId ?? ''}`;
    const expectedSeq = (getStage3SeqMap()[seqKey] ?? 0) + 1;
    const expectedExecId =
      (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    try {
      const updated = await executeStage3(startProj, pinnedChId, pinnedProjId);
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        getStage3SeqMap()[seqKey] === expectedSeq
      ) {
        const chAfter = updated?.chapters.find((c) => c.id === pinnedChId);
        if (chAfter?.stageCompleted.translation) {
          setPipelineBanner(null);
        }
      }
      return updated;
    } catch (e: unknown) {
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        getStage3SeqMap()[seqKey] === expectedSeq
      ) {
        setErrorBanner(e instanceof Error ? e.message : 'Stage 3 error');
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(expectedExecId)) {
        setRunningStage(0);
      }
    }
  };

  const runStandaloneStage4 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const startProj = ctx.getProject() ?? currentProj;
    const pinnedProjId = pinnedTargetProjectId ?? startProj?.id;
    const pinnedChId =
      pinnedTargetChapterId ??
      (startProj ? resolvePinnedOrActiveChapter(startProj)?.id : undefined);
    const stage4SeqKey = `__stage4_seq__:${pinnedProjId ?? ''}:${pinnedChId ?? ''}`;
    const expectedStage4Seq = (getStage3SeqMap()[stage4SeqKey] ?? 0) + 1;
    const expectedExecId =
      (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    try {
      const updated = await executeStage4(startProj, pinnedChId, pinnedProjId);
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        getStage3SeqMap()[stage4SeqKey] === expectedStage4Seq &&
        pinnedChId !== undefined
      ) {
        const chAfter = updated?.chapters.find((c) => c.id === pinnedChId);
        if (chAfter?.stageCompleted.editing) {
          setPipelineBanner(null);
        }
      }
      return updated;
    } catch (e: unknown) {
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        getStage3SeqMap()[stage4SeqKey] === expectedStage4Seq
      ) {
        setErrorBanner(e instanceof Error ? e.message : 'Stage 4 error');
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(expectedExecId)) {
        setRunningStage(0);
      }
    }
  };

  const runStandaloneStage5 = async (
    currentProj = ctx.getProject(),
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ): Promise<TranslationProject> => {
    const startProj = ctx.getProject() ?? currentProj;
    const pinnedProjId = pinnedTargetProjectId ?? startProj?.id;
    const pinnedChId =
      pinnedTargetChapterId ??
      (startProj ? resolvePinnedOrActiveChapter(startProj)?.id : undefined);
    const seqKey = `${pinnedProjId ?? ''}:${pinnedChId ?? ''}`;
    const expectedStage5Seq = (ctx.getStage5SeqMap()[seqKey] ?? 0) + 1;
    const expectedExecId =
      (getStage3SeqMap()[WORKSPACE_EXEC_SEQ_KEY] ?? 0) + 1;
    try {
      const updated = await executeStage5(startProj, pinnedChId, pinnedProjId);
      if (
        !isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) ||
        ctx.getStage5SeqMap()[seqKey] !== expectedStage5Seq
      ) {
        return updated;
      }
      const finalCh = updated?.chapters.find((c) => c.id === pinnedChId);
      if (!finalCh) return updated;
      if (!finalCh.stageCompleted.verification) {
        setPipelineBannerTone('warning');
        setPipelineBanner(
          'Stage 5 verification reconciled with concurrent chapter edits. Some paragraphs remain unverified—please re-run Stage 5 to complete full-chapter verification.'
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
      return updated;
    } catch (e: unknown) {
      if (
        isCurrentWorkspaceExecution(expectedExecId, pinnedProjId) &&
        ctx.getStage5SeqMap()[seqKey] === expectedStage5Seq
      ) {
        setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
        setPipelineBanner(null);
      }
      return ctx.getProject();
    } finally {
      if (isCurrentWorkspaceExecution(expectedExecId)) {
        setRunningStage(0);
      }
    }
  };

  return {
    updateChapterInProject,
    applyChapterLocalEditWithReconciliation,
    executeStage1,
    executeStage2,
    executeStage3,
    executeStage4,
    executeStage5,
    runStandaloneStage1,
    runStandaloneStage2,
    runStandaloneStage3,
    runStandaloneStage4,
    runStandaloneStage5,
    handleRunFullPipeline,
    handleRefineParagraph,
  };
}

const PARAGRAPH_REFINEMENT_OPTIONS: Array<{
  id: ParagraphRefinementAction;
  label: string;
  banglaHint: string;
}> = [
  { id: 'issue_guided_repair', label: 'Surgical Factual Repair', banglaHint: 'নির্দিষ্ট ত্রুটি সংশোধন' },
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

  // Keep latest activeChapterId, maxWordsPerChunk, and customParagraphNote refs for async stage executors
  const activeChapterIdRef = useRef<string>(activeChapter.id);
  useEffect(() => {
    activeChapterIdRef.current = activeChapter.id;
  }, [activeChapter.id]);

  const maxWordsPerChunkRef = useRef<number>(settings.maxWordsPerChunk || 500);
  useEffect(() => {
    maxWordsPerChunkRef.current = settings.maxWordsPerChunk || 500;
  }, [settings.maxWordsPerChunk]);

  const customParagraphNoteRef = useRef<string>(customParagraphNote);
  useEffect(() => {
    customParagraphNoteRef.current = customParagraphNote;
  }, [customParagraphNote]);

  // Stage 3 and Stage 5 per-chapter request sequence counters (incremented ONLY when a new Stage 3 / Stage 5 request starts)
  const stage3RequestSeqByChapterRef = useRef<Record<string, number>>({});
  const stage5RequestSeqByChapterRef = useRef<Record<string, number>>({});

  // Movement-safe paragraph refinement request registry
  const refineRequestSeqRef = useRef<number>(0);
  const activeRefineRequestsRef = useRef<ActiveParagraphRefinementRequest[]>([]);

  const getStageExecutors = () =>
    createWorkspaceStageExecutors({
      getProject: () => projectRef.current,
      setProject: (nextProj) => {
        projectRef.current = nextProj;
      },
      getStage3SeqMap: () => stage3RequestSeqByChapterRef.current,
      getStage5SeqMap: () => stage5RequestSeqByChapterRef.current,
      nextRefineRequestId: () => ++refineRequestSeqRef.current,
      getActiveRefineRequests: () => activeRefineRequestsRef.current,
      setActiveRefineRequests: (nextReqs) => {
        activeRefineRequestsRef.current = nextReqs;
      },
      getActiveChapterId: () => activeChapterIdRef.current,
      getMaxWordsPerChunk: () => maxWordsPerChunkRef.current,
      getCustomParagraphNote: () => customParagraphNoteRef.current,
      setCustomParagraphNote,
      setRunningStage,
      setPipelineBanner,
      setPipelineBannerTone,
      setErrorBanner,
      setRefiningParagraphIdx,
      onUpdateProject,
      onLogHistory,
    });

  const updateChapterInProject = (
    baseProject: TranslationProject,
    chapterId: string,
    updater: (ch: Chapter) => Chapter
  ) =>
    getStageExecutors().updateChapterInProject(baseProject, chapterId, updater);

  const applyChapterLocalEditWithReconciliation = (
    chapterId: string,
    computeEdit: (existing: Chapter) => {
      nextParagraphs: ParagraphPair[];
      nextTranslatedText: string;
      nextOriginalText?: string;
    },
    expectedProjectId?: string
  ) =>
    getStageExecutors().applyChapterLocalEditWithReconciliation(
      chapterId,
      computeEdit,
      expectedProjectId
    );

  const executeStage1 = (
    currentProj?: TranslationProject,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().executeStage1(
      currentProj,
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const executeStage2 = (
    currentProj?: TranslationProject,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().executeStage2(
      currentProj,
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const executeStage3 = (
    currentProj?: TranslationProject,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().executeStage3(
      currentProj,
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const executeStage4 = (
    currentProj?: TranslationProject,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().executeStage4(
      currentProj,
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const executeStage5 = (
    currentProj?: TranslationProject,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().executeStage5(
      currentProj,
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const handleRunFullPipeline = (
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string
  ) =>
    getStageExecutors().handleRunFullPipeline(
      pinnedTargetChapterId,
      pinnedTargetProjectId
    );

  const handleRefineParagraph = (
    paragraphIndex: number,
    action: ParagraphRefinementAction,
    pinnedTargetChapterId?: string,
    pinnedTargetProjectId?: string,
    repairIssue?: VerificationIssue | null
  ) =>
    getStageExecutors().handleRefineParagraph(
      paragraphIndex,
      action,
      pinnedTargetChapterId,
      pinnedTargetProjectId,
      repairIssue
    );

  // Trigger auto-pipeline if requested upon project creation
  useEffect(() => {
    if (
      autoRunPipelineTrigger > 0 &&
      autoRunPipelineTrigger !== lastTriggerRef.current
    ) {
      lastTriggerRef.current = autoRunPipelineTrigger;
      handleRunFullPipeline(activeChapter.id, project.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunPipelineTrigger]);

  // Manual edit of a single Bangla paragraph
  const handleManualParagraphChange = (paragraphIndex: number, newBangla: string) => {
    const latestProj = projectRef.current;
    if (!latestProj || latestProj.id !== project.id) return;
    applyChapterLocalEditWithReconciliation(
      activeChapter.id,
      (existing) => {
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
      },
      project.id
    );
  };

  // Revert a single paragraph to its previous version
  const handleRevertParagraph = (paragraphIndex: number) => {
    const latestProj = projectRef.current;
    if (!latestProj || latestProj.id !== project.id) return;
    const currentCh =
      latestProj.chapters.find((c) => c.id === activeChapter.id) ||
      latestProj.chapters[0];
    const pair = currentCh?.paragraphs[paragraphIndex];
    if (
      !currentCh ||
      !pair ||
      pair.previousBanglaText === undefined ||
      pair.previousBanglaText === null
    ) {
      return;
    }

    applyChapterLocalEditWithReconciliation(
      currentCh.id,
      (existing) => {
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
      },
      project.id
    );
  };

  // Continuous source or target text change
  const handleContinuousSourceChange = (newEnglish: string) => {
    const latestProj = projectRef.current;
    if (!latestProj || latestProj.id !== project.id) return;
    applyChapterLocalEditWithReconciliation(
      activeChapter.id,
      (existing) => {
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
      },
      project.id
    );
  };

  const handleContinuousBanglaChange = (newBangla: string) => {
    const latestProj = projectRef.current;
    if (!latestProj || latestProj.id !== project.id) return;
    const currentCh =
      latestProj.chapters.find((c) => c.id === activeChapter.id) ||
      latestProj.chapters[0];
    if (!currentCh) return;
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
    applyChapterLocalEditWithReconciliation(
      currentCh.id,
      () => ({
        nextParagraphs: result.paragraphs,
        nextTranslatedText: result.translatedText,
      }),
      project.id
    );
  };

  // Add New Chapter to Project (reads latest projectRef.current and verifies project identity)
  const handleCreateChapter = (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = createChapterInLatestProject({
      intendedProjectId: project.id,
      latestProject: projectRef.current,
      newChTitle,
      newChText,
      maxWordsPerChunk: settings.maxWordsPerChunk || 500,
    });
    if (!outcome.applied || !outcome.createdChapter) {
      return;
    }

    projectRef.current = outcome.project;
    onUpdateProject(outcome.project);
    onSelectChapter(outcome.createdChapter.id);
    setNewChTitle('');
    setNewChText('');
    setShowAddChapter(false);
  };

  // Manual Save (reads latest projectRef.current and verifies project identity)
  const handleManualSaveClick = () => {
    const outcome = buildManualSaveFromLatestProject({
      intendedProjectId: project.id,
      activeChapterId: activeChapter.id,
      latestProject: projectRef.current,
    });
    if (!outcome.applied || !outcome.historyEntry) {
      return;
    }

    projectRef.current = outcome.project;
    onUpdateProject(outcome.project);
    onLogHistory(outcome.historyEntry);
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
                const pinnedChId = activeChapter.id;
                const pinnedProjId = project.id;
                const expectedExecId =
                  (stage3RequestSeqByChapterRef.current[
                    WORKSPACE_EXEC_SEQ_KEY
                  ] ?? 0) + 1;
                try {
                  await executeStage1(
                    projectRef.current,
                    pinnedChId,
                    pinnedProjId
                  );
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setPipelineBanner(null);
                  }
                } catch (e: unknown) {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setErrorBanner(
                      e instanceof Error ? e.message : 'Stage 1 error'
                    );
                  }
                } finally {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId
                  ) {
                    setRunningStage(0);
                  }
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
                const pinnedChId = activeChapter.id;
                const pinnedProjId = project.id;
                const expectedExecId =
                  (stage3RequestSeqByChapterRef.current[
                    WORKSPACE_EXEC_SEQ_KEY
                  ] ?? 0) + 1;
                try {
                  await executeStage2(
                    projectRef.current,
                    pinnedChId,
                    pinnedProjId
                  );
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    projectRef.current.id === pinnedProjId &&
                    projectRef.current.chapters.some((c) => c.id === pinnedChId)
                  ) {
                    setPipelineBanner(null);
                  }
                } catch (e: unknown) {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setErrorBanner(
                      e instanceof Error ? e.message : 'Stage 2 error'
                    );
                  }
                } finally {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId
                  ) {
                    setRunningStage(0);
                  }
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
                const pinnedChId = activeChapter.id;
                const pinnedProjId = project.id;
                const seqKey = `${pinnedProjId}:${pinnedChId}`;
                const expectedSeq =
                  (stage3RequestSeqByChapterRef.current[seqKey] ?? 0) + 1;
                const expectedExecId =
                  (stage3RequestSeqByChapterRef.current[
                    WORKSPACE_EXEC_SEQ_KEY
                  ] ?? 0) + 1;
                try {
                  await executeStage3(
                    projectRef.current,
                    pinnedChId,
                    pinnedProjId
                  );
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    stage3RequestSeqByChapterRef.current[seqKey] ===
                      expectedSeq &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    const chAfter = projectRef.current.chapters.find(
                      (c) => c.id === pinnedChId
                    );
                    if (chAfter?.stageCompleted.translation) {
                      setPipelineBanner(null);
                    }
                  }
                } catch (e: unknown) {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    stage3RequestSeqByChapterRef.current[seqKey] ===
                      expectedSeq &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setErrorBanner(
                      e instanceof Error ? e.message : 'Stage 3 error'
                    );
                  }
                } finally {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    stage3RequestSeqByChapterRef.current[seqKey] === expectedSeq
                  ) {
                    setRunningStage(0);
                  }
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
                const pinnedChId = activeChapter.id;
                const pinnedProjId = project.id;
                const stage4SeqKey = `__stage4_seq__:${pinnedProjId}:${pinnedChId}`;
                const expectedStage4Seq =
                  (stage3RequestSeqByChapterRef.current[stage4SeqKey] ?? 0) + 1;
                const expectedExecId =
                  (stage3RequestSeqByChapterRef.current[
                    WORKSPACE_EXEC_SEQ_KEY
                  ] ?? 0) + 1;
                try {
                  const res = await executeStage4(
                    projectRef.current,
                    pinnedChId,
                    pinnedProjId
                  );
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    stage3RequestSeqByChapterRef.current[stage4SeqKey] ===
                      expectedStage4Seq &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    const chAfter = res.chapters.find(
                      (c) => c.id === pinnedChId
                    );
                    if (chAfter?.stageCompleted.editing) {
                      setPipelineBanner(null);
                    }
                  }
                } catch (e: unknown) {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    stage3RequestSeqByChapterRef.current[stage4SeqKey] ===
                      expectedStage4Seq &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setErrorBanner(
                      e instanceof Error ? e.message : 'Stage 4 error'
                    );
                    setPipelineBanner(null);
                  }
                } finally {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId
                  ) {
                    setRunningStage(0);
                  }
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
                const pinnedChId = activeChapter.id;
                const pinnedProjId = project.id;
                const expectedExecId =
                  (stage3RequestSeqByChapterRef.current[
                    WORKSPACE_EXEC_SEQ_KEY
                  ] ?? 0) + 1;
                try {
                  const updated = await executeStage5(
                    projectRef.current,
                    pinnedChId,
                    pinnedProjId
                  );
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] !== expectedExecId ||
                    projectRef.current.id !== pinnedProjId
                  ) {
                    return;
                  }
                  const finalCh = updated.chapters.find(
                    (c) => c.id === pinnedChId
                  );
                  if (!finalCh) return;
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
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId &&
                    projectRef.current.id === pinnedProjId
                  ) {
                    setErrorBanner(
                      e instanceof Error ? e.message : 'Stage 5 error'
                    );
                  }
                } finally {
                  if (
                    stage3RequestSeqByChapterRef.current[
                      WORKSPACE_EXEC_SEQ_KEY
                    ] === expectedExecId
                  ) {
                    setRunningStage(0);
                  }
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
            onClick={() => handleRunFullPipeline(activeChapter.id, project.id)}
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

                        {/* Stage 5 Issue-Guided Repair Controls for this paragraph */}
                        {(() => {
                          const paragraphIssues = (
                            activeChapter.verificationReport?.issues ?? []
                          ).filter(
                            (iss) => !iss.resolved && iss.paragraphIndex === idx
                          );
                          if (paragraphIssues.length === 0) return null;
                          return (
                            <div className="p-3 bg-[#FFFBEB] border border-[#F59E0B]/60 rounded-lg space-y-2">
                              <div className="text-xs font-semibold text-[#92400E]">
                                Stage 5 Flagged Findings for Paragraph {idx + 1} ({paragraphIssues.length})
                              </div>
                              <div className="space-y-2">
                                {paragraphIssues.map((iss) => (
                                  <div
                                    key={iss.id}
                                    className="flex flex-wrap items-start justify-between gap-2 p-2.5 bg-white border border-[#E5E0D8] rounded-md text-xs"
                                  >
                                    <div className="space-y-1 flex-1 min-w-[220px]">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-semibold text-[#9A3412] uppercase text-[10px]">
                                          {iss.severity} · {iss.type.replace(/_/g, ' ')}
                                        </span>
                                      </div>
                                      <p className="text-[#1C1917]">{iss.description}</p>
                                      {(iss.englishExcerpt || iss.banglaExcerpt) && (
                                        <div className="text-[11px] text-[#57534E] font-bangla">
                                          {iss.englishExcerpt ? `EN: "${iss.englishExcerpt}"` : ''}
                                          {iss.englishExcerpt && iss.banglaExcerpt ? ' · ' : ''}
                                          {iss.banglaExcerpt ? `BN: "${iss.banglaExcerpt}"` : ''}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isRefiningThis || runningStage !== 0}
                                      onClick={() =>
                                        handleRefineParagraph(
                                          idx,
                                          'issue_guided_repair',
                                          activeChapter.id,
                                          project.id,
                                          iss
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#9A3412] rounded-md hover:bg-[#7C2D12] disabled:opacity-50 cursor-pointer shrink-0"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      <span>
                                        {isRefiningThis
                                          ? 'Repairing...'
                                          : 'Repair This Issue'}
                                      </span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

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
            const pinnedChId = activeChapter.id;
            const pinnedProjId = project.id;
            const expectedExecId =
              (stage3RequestSeqByChapterRef.current[
                WORKSPACE_EXEC_SEQ_KEY
              ] ?? 0) + 1;
            try {
              const res = await executeStage2(
                projectRef.current,
                pinnedChId,
                pinnedProjId
              );
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                projectRef.current.id === pinnedProjId &&
                res.chapters.some((c) => c.id === pinnedChId)
              ) {
                setPipelineBanner(null);
              }
            } catch (e: unknown) {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                projectRef.current.id === pinnedProjId
              ) {
                setErrorBanner(e instanceof Error ? e.message : 'Stage 2 error');
                setPipelineBanner(null);
              }
            } finally {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId
              ) {
                setRunningStage(0);
              }
            }
          }}
          onUpdateStyleProfile={(updatedProfile) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
            const nextProj: TranslationProject = {
              ...projectRef.current,
              styleProfile: updatedProfile,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateStyleControls={(updatedControls) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
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
            const pinnedChId = activeChapter.id;
            const pinnedProjId = project.id;
            const expectedExecId =
              (stage3RequestSeqByChapterRef.current[
                WORKSPACE_EXEC_SEQ_KEY
              ] ?? 0) + 1;
            try {
              const res = await executeStage1(
                projectRef.current,
                pinnedChId,
                pinnedProjId
              );
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                projectRef.current.id === pinnedProjId &&
                res.chapters.some((c) => c.id === pinnedChId)
              ) {
                setPipelineBanner(null);
              }
            } catch (e: unknown) {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                projectRef.current.id === pinnedProjId
              ) {
                setErrorBanner(e instanceof Error ? e.message : 'Stage 1 error');
                setPipelineBanner(null);
              }
            } finally {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId
              ) {
                setRunningStage(0);
              }
            }
          }}
          onUpdateStoryContext={(ctx) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
            const nextProj: TranslationProject = {
              ...projectRef.current,
              storyContext: ctx,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateCharacters={(chars) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
            const nextProj: TranslationProject = {
              ...projectRef.current,
              characterMemory: chars,
              updatedAt: new Date().toISOString(),
            };
            projectRef.current = nextProj;
            onUpdateProject(nextProj);
          }}
          onUpdateTerminology={(terms) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
            const nextProj = applyTerminologyUpdateToProject(
              projectRef.current,
              terms
            );
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
          refiningParagraphIndex={refiningParagraphIdx}
          onRepairParagraphWithIssue={(issue) => {
            if (
              typeof issue.paragraphIndex !== 'number' ||
              !Number.isFinite(issue.paragraphIndex) ||
              !Number.isInteger(issue.paragraphIndex) ||
              issue.paragraphIndex < 0
            ) {
              return;
            }
            handleRefineParagraph(
              issue.paragraphIndex,
              'issue_guided_repair',
              activeChapter.id,
              project.id,
              issue
            );
          }}
          onRunStage4={async () => {
            const pinnedChId = activeChapter.id;
            const pinnedProjId = project.id;
            const stage4SeqKey = `__stage4_seq__:${pinnedProjId}:${pinnedChId}`;
            const expectedStage4Seq =
              (stage3RequestSeqByChapterRef.current[stage4SeqKey] ?? 0) + 1;
            const expectedExecId =
              (stage3RequestSeqByChapterRef.current[
                WORKSPACE_EXEC_SEQ_KEY
              ] ?? 0) + 1;
            try {
              const res = await executeStage4(
                projectRef.current,
                pinnedChId,
                pinnedProjId
              );
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                stage3RequestSeqByChapterRef.current[stage4SeqKey] ===
                  expectedStage4Seq &&
                projectRef.current.id === pinnedProjId
              ) {
                const chAfter = res.chapters.find((c) => c.id === pinnedChId);
                if (chAfter?.stageCompleted.editing) {
                  setPipelineBanner(null);
                }
              }
            } catch (e: unknown) {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                stage3RequestSeqByChapterRef.current[stage4SeqKey] ===
                  expectedStage4Seq &&
                projectRef.current.id === pinnedProjId
              ) {
                setErrorBanner(e instanceof Error ? e.message : 'Stage 4 error');
                setPipelineBanner(null);
              }
            } finally {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId
              ) {
                setRunningStage(0);
              }
            }
          }}
          onRunStage5={async () => {
            const pinnedChId = activeChapter.id;
            const pinnedProjId = project.id;
            const seqKey = `${pinnedProjId}:${pinnedChId}`;
            const expectedStage5Seq =
              (stage5RequestSeqByChapterRef.current[seqKey] ?? 0) + 1;
            const expectedExecId =
              (stage3RequestSeqByChapterRef.current[
                WORKSPACE_EXEC_SEQ_KEY
              ] ?? 0) + 1;
            try {
              const updated = await executeStage5(
                projectRef.current,
                pinnedChId,
                pinnedProjId
              );
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] !== expectedExecId ||
                stage5RequestSeqByChapterRef.current[seqKey] !==
                  expectedStage5Seq ||
                projectRef.current.id !== pinnedProjId
              ) {
                return;
              }
              const finalCh = updated.chapters.find((c) => c.id === pinnedChId);
              if (!finalCh) return;
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
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId &&
                stage5RequestSeqByChapterRef.current[seqKey] ===
                  expectedStage5Seq &&
                projectRef.current.id === pinnedProjId
              ) {
                setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
                setPipelineBanner(null);
              }
            } finally {
              if (
                stage3RequestSeqByChapterRef.current[
                  WORKSPACE_EXEC_SEQ_KEY
                ] === expectedExecId
              ) {
                setRunningStage(0);
              }
            }
          }}
          onApplySuggestedFix={(issue) => {
            if (!projectRef.current || projectRef.current.id !== project.id) return;
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
            if (!projectRef.current || projectRef.current.id !== project.id) return;
            if (!activeChapter.verificationReport) return;
            updateChapterInProject(projectRef.current, activeChapter.id, (existing) => {
              const currentIssues = existing.verificationReport?.issues || [];
              const isTrulyCompleteVerification = Boolean(
                existing.stageCompleted.verification &&
                  existing.verificationReport &&
                  existing.verificationReport.isComplete !== false &&
                  !PARTIAL_OR_DET_SUMMARY_PREFIX_RE.test(
                    existing.verificationReport.fidelitySummary || ''
                  )
              );
              const resolved = resolveVerificationIssue(
                existing.paragraphs,
                currentIssues,
                issueId,
                { isVerificationAuditComplete: isTrulyCompleteVerification }
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
                  ? {
                      ...existing.verificationReport,
                      isComplete:
                        existing.verificationReport.isComplete &&
                        resolved.completion.isComplete,
                      issues: resolved.updatedIssues,
                    }
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

