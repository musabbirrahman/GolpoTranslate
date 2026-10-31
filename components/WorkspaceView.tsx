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
} from '@/lib/types';
import {
  alignParagraphs,
  assembleTranslatedChunks,
  chunkTextByParagraphs,
  countWords,
  formatBilingualExport,
  formatChapterExport,
  formatFullStoryExport,
  splitIntoParagraphs,
} from '@/lib/chunker';
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
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState(false);

  // Add Chapter Modal state
  const [showAddChapter, setShowAddChapter] = useState(false);
  const [newChTitle, setNewChTitle] = useState('');
  const [newChText, setNewChText] = useState('');

  const lastTriggerRef = useRef<number>(0);

  // Keep latest project ref for sequential pipeline steps
  const projectRef = useRef<TranslationProject>(project);
  projectRef.current = project;

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

  // Stage 1: Literary Understanding & Character/Terminology Extraction
  const executeStage1 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const ch =
      currentProj.chapters.find((c) => c.id === activeChapter.id) || currentProj.chapters[0];
    if (!ch.originalText.trim()) {
      throw new Error('Original English text is empty. Please add English text first.');
    }

    setErrorBanner(null);
    setRunningStage(1);
    setPipelineBanner('Stage 1/5: Analyzing literary context, characters, and recurring terminology...');

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'stage1_understanding',
        text: ch.originalText,
        projectTitle: currentProj.title,
        genre: currentProj.genre,
        existingCharacters: currentProj.characterMemory,
        existingTerminology: currentProj.terminologyMemory,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 1 Literary Understanding failed');
    }

    // Merge newly extracted characters and terminology without duplicating existing entries
    const existingCharNames = new Set(
      currentProj.characterMemory.map((c) => c.englishName.toLowerCase())
    );
    const mergedCharacters: CharacterMemoryItem[] = [
      ...currentProj.characterMemory,
      ...(data.extractedCharacters || []).filter(
        (c: CharacterMemoryItem) =>
          c.englishName && !existingCharNames.has(c.englishName.toLowerCase())
      ),
    ];

    const existingTerms = new Set(
      currentProj.terminologyMemory.map((t) => t.englishTerm.toLowerCase())
    );
    const mergedTerminology: TerminologyMemoryItem[] = [
      ...currentProj.terminologyMemory,
      ...(data.extractedTerminology || []).filter(
        (t: TerminologyMemoryItem) =>
          t.englishTerm && !existingTerms.has(t.englishTerm.toLowerCase())
      ),
    ];

    const updatedProj: TranslationProject = {
      ...currentProj,
      storyContext: data.storyContext || currentProj.storyContext,
      characterMemory: mergedCharacters,
      terminologyMemory: mergedTerminology,
      updatedAt: new Date().toISOString(),
      chapters: currentProj.chapters.map((item) =>
        item.id === ch.id
          ? {
              ...item,
              currentStage: 1,
              stageCompleted: { ...item.stageCompleted, understanding: true },
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
      actionType: 'stage_1_understanding',
      summary: `Extracted story context, ${mergedCharacters.length} characters, and ${mergedTerminology.length} glossary terms.`,
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
    const ch =
      currentProj.chapters.find((c) => c.id === activeChapter.id) || currentProj.chapters[0];
    const englishParagraphs = splitIntoParagraphs(ch.originalText);
    if (englishParagraphs.length === 0) {
      throw new Error('Original English text has no paragraphs to translate.');
    }

    setErrorBanner(null);
    setRunningStage(3);

    const chunks = chunkTextByParagraphs(
      ch.originalText,
      settings.maxWordsPerChunk || 500,
      2
    );

    const translatedChunks: string[][] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setPipelineBanner(
        `Stage 3/5: Translating chunk ${i + 1} of ${chunks.length} (${chunk.paragraphs.length} paragraphs) using Author Style Profile & Memory...`
      );

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'stage3_translate_chunk',
          paragraphs: chunk.paragraphs,
          previousContextParagraphs: chunk.previousContextParagraphs,
          styleProfile: currentProj.styleProfile,
          storyContext: currentProj.storyContext,
          characters: currentProj.characterMemory,
          terminology: currentProj.terminologyMemory,
          styleControls: currentProj.styleControls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed on chunk ${i + 1} of ${chunks.length}`);
      }

      translatedChunks.push(data.translatedParagraphs || []);

      // Update partial chunk progress so partial progress is always recoverable
      const partial = assembleTranslatedChunks(
        englishParagraphs.slice(0, chunk.endParagraphIndex + 1),
        translatedChunks
      );
      updateChapterInProject(currentProj, ch.id, (existing) => ({
        ...existing,
        status: 'in_progress',
        currentStage: 3,
        chunkCount: chunks.length,
        completedChunks: i + 1,
        translatedText: partial.fullBanglaText,
        paragraphs: englishParagraphs.map((eng, pIdx) => ({
          index: pIdx,
          englishText: eng,
          banglaText: partial.pairs[pIdx]?.banglaText || existing.paragraphs[pIdx]?.banglaText || '',
        })),
        updatedAt: new Date().toISOString(),
      }));
    }

    const { pairs, fullBanglaText } = assembleTranslatedChunks(
      englishParagraphs,
      translatedChunks
    );

    const updatedProj = updateChapterInProject(projectRef.current, ch.id, (existing) => ({
      ...existing,
      translatedText: fullBanglaText,
      draftTranslatedText: fullBanglaText,
      paragraphs: pairs,
      status: 'needs_review',
      currentStage: 3,
      chunkCount: chunks.length,
      completedChunks: chunks.length,
      stageCompleted: { ...existing.stageCompleted, translation: true },
      updatedAt: new Date().toISOString(),
    }));

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_3_translation',
      summary: `Translated ${englishParagraphs.length} paragraphs across ${chunks.length} chunk(s) into literary Bangla.`,
    });

    return updatedProj;
  };

  // Stage 4: Literary Editing Pass
  const executeStage4 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const ch =
      currentProj.chapters.find((c) => c.id === activeChapter.id) || currentProj.chapters[0];
    const engParagraphs = ch.paragraphs.map((p) => p.englishText);
    const bnParagraphs = ch.paragraphs.map((p) => p.banglaText);

    if (bnParagraphs.every((b) => !b.trim())) {
      throw new Error('Please run Stage 3 Translation before running Stage 4 Literary Editing.');
    }

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
        styleProfile: currentProj.styleProfile,
        characters: currentProj.characterMemory,
        terminology: currentProj.terminologyMemory,
        styleControls: currentProj.styleControls,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 4 Literary Editing failed');
    }

    const editedList: string[] = data.editedParagraphs || bnParagraphs;
    const newPairs: ParagraphPair[] = ch.paragraphs.map((pair, idx) => ({
      ...pair,
      previousBanglaText: pair.banglaText,
      banglaText: editedList[idx] || pair.banglaText,
      lastRefinementAction: 'stage_4_editorial',
    }));

    const fullBangla = newPairs.map((p) => p.banglaText).join('\n\n');

    const updatedProj = updateChapterInProject(currentProj, ch.id, (existing) => ({
      ...existing,
      translatedText: fullBangla,
      paragraphs: newPairs,
      currentStage: 4,
      editorialNotes: data.editorialNotes || [],
      editorialChanges: data.editorialChanges || [],
      stageCompleted: { ...existing.stageCompleted, editing: true },
      updatedAt: new Date().toISOString(),
    }));

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_4_editing',
      summary: `Completed Stage 4 Literary Editing with ${(data.editorialChanges || []).length} stylistic improvements.`,
    });

    return updatedProj;
  };

  // Stage 5: Accuracy Verification
  const executeStage5 = async (currentProj = projectRef.current): Promise<TranslationProject> => {
    const ch =
      currentProj.chapters.find((c) => c.id === activeChapter.id) || currentProj.chapters[0];
    const engParagraphs = ch.paragraphs.map((p) => p.englishText);
    const bnParagraphs = ch.paragraphs.map((p) => p.banglaText);

    if (bnParagraphs.every((b) => !b.trim())) {
      throw new Error('Please translate the chapter before running Accuracy Verification.');
    }

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
        characters: currentProj.characterMemory,
        terminology: currentProj.terminologyMemory,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Stage 5 Accuracy Verification failed');
    }

    const report = data.report;
    const hasUnresolvedHighIssues = (report?.issues || []).some(
      (i: VerificationIssue) => i.severity === 'high' && !i.resolved
    );

    const updatedProj = updateChapterInProject(currentProj, ch.id, (existing) => ({
      ...existing,
      currentStage: 5,
      verificationReport: report,
      status: hasUnresolvedHighIssues ? 'needs_review' : 'completed',
      stageCompleted: { ...existing.stageCompleted, verification: true },
      updatedAt: new Date().toISOString(),
    }));

    onLogHistory({
      projectId: updatedProj.id,
      projectTitle: updatedProj.title,
      chapterId: ch.id,
      chapterTitle: ch.title,
      actionType: 'stage_5_verification',
      summary: `Accuracy Verification Score: ${report?.overallScore ?? 96}% (${(report?.issues || []).length} items flagged).`,
    });

    return updatedProj;
  };

  // Full 5-Stage Automated Adaptive Pipeline
  const handleRunFullPipeline = async () => {
    try {
      setErrorBanner(null);
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
      await executeStage5(cur);

      setPipelineBanner('All 5 stages of the Adaptive Literary Translation Pipeline completed.');
      setTimeout(() => setPipelineBanner(null), 5000);
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

  // Individual Paragraph Refinement Handler
  const handleRefineParagraph = async (
    paragraphIndex: number,
    action: ParagraphRefinementAction
  ) => {
    const pair = activeChapter.paragraphs[paragraphIndex];
    if (!pair) return;

    setErrorBanner(null);
    setRefiningParagraphIdx(paragraphIndex);

    try {
      const prevEng = activeChapter.paragraphs[paragraphIndex - 1]?.englishText;
      const nextEng = activeChapter.paragraphs[paragraphIndex + 1]?.englishText;

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
          styleProfile: project.styleProfile,
          characters: project.characterMemory,
          terminology: project.terminologyMemory,
          styleControls: project.styleControls,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Paragraph refinement failed');
      }

      const newPairs = activeChapter.paragraphs.map((item, idx) =>
        idx === paragraphIndex
          ? {
              ...item,
              previousBanglaText: item.banglaText,
              banglaText: data.refinedBangla,
              lastRefinementAction: action,
              refinementRationale: data.rationale,
            }
          : item
      );

      const fullBangla = newPairs.map((p) => p.banglaText).join('\n\n');

      updateChapterInProject(project, activeChapter.id, (existing) => ({
        ...existing,
        translatedText: fullBangla,
        paragraphs: newPairs,
        updatedAt: new Date().toISOString(),
      }));

      onLogHistory({
        projectId: project.id,
        projectTitle: project.title,
        chapterId: activeChapter.id,
        chapterTitle: activeChapter.title,
        actionType: 'paragraph_refinement',
        summary: `Refined Paragraph ${paragraphIndex + 1} (${action.replace(/_/g, ' ')}): ${data.rationale}`,
        paragraphIndex,
        previousText: pair.banglaText,
        newText: data.refinedBangla,
      });

      setCustomParagraphNote('');
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not refine paragraph.'
      );
    } finally {
      setRefiningParagraphIdx(null);
    }
  };

  // Manual edit of a single Bangla paragraph
  const handleManualParagraphChange = (paragraphIndex: number, newBangla: string) => {
    const newPairs = activeChapter.paragraphs.map((item, idx) =>
      idx === paragraphIndex
        ? {
            ...item,
            banglaText: newBangla,
            lastRefinementAction: 'manual_edit' as const,
          }
        : item
    );
    const fullBangla = newPairs.map((p) => p.banglaText).join('\n\n');

    updateChapterInProject(project, activeChapter.id, (existing) => ({
      ...existing,
      translatedText: fullBangla,
      paragraphs: newPairs,
      updatedAt: new Date().toISOString(),
    }));
  };

  // Revert a single paragraph to its previous version
  const handleRevertParagraph = (paragraphIndex: number) => {
    const pair = activeChapter.paragraphs[paragraphIndex];
    if (!pair || !pair.previousBanglaText) return;

    const newPairs = activeChapter.paragraphs.map((item, idx) =>
      idx === paragraphIndex
        ? {
            ...item,
            banglaText: pair.previousBanglaText!,
            previousBanglaText: item.banglaText,
          }
        : item
    );
    const fullBangla = newPairs.map((p) => p.banglaText).join('\n\n');

    updateChapterInProject(project, activeChapter.id, (existing) => ({
      ...existing,
      translatedText: fullBangla,
      paragraphs: newPairs,
      updatedAt: new Date().toISOString(),
    }));
  };

  // Continuous source or target text change
  const handleContinuousSourceChange = (newEnglish: string) => {
    const aligned = alignParagraphs(
      newEnglish,
      activeChapter.translatedText,
      activeChapter.paragraphs
    );
    updateChapterInProject(project, activeChapter.id, (existing) => ({
      ...existing,
      originalText: newEnglish,
      paragraphs: aligned,
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleContinuousBanglaChange = (newBangla: string) => {
    const aligned = alignParagraphs(
      activeChapter.originalText,
      newBangla,
      activeChapter.paragraphs
    );
    updateChapterInProject(project, activeChapter.id, (existing) => ({
      ...existing,
      translatedText: newBangla,
      paragraphs: aligned,
      updatedAt: new Date().toISOString(),
    }));
  };

  // Add New Chapter to Project
  const handleCreateChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChText.trim()) return;

    const nextNum = project.chapters.length + 1;
    const chTitle = newChTitle.trim() || `Chapter ${nextNum}`;
    const paras = splitIntoParagraphs(newChText);
    const chunks = chunkTextByParagraphs(newChText, settings.maxWordsPerChunk || 500);
    const now = new Date().toISOString();

    const created: Chapter = {
      id: `ch-${Date.now()}`,
      number: nextNum,
      title: chTitle,
      originalText: newChText.trim(),
      translatedText: '',
      paragraphs: paras.map((eng, idx) => ({
        index: idx,
        englishText: eng,
        banglaText: '',
      })),
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
              disabled={runningStage !== 0}
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
              disabled={runningStage !== 0}
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
              disabled={runningStage !== 0}
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.translation
                  ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                  : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 3 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
              ) : activeChapter.stageCompleted.translation ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <span className="font-mono-num text-[11px] text-[#78716C]">03.</span>
              )}
              <span>Faithful Translation</span>
            </button>

            {/* Stage 4 */}
            <button
              type="button"
              disabled={runningStage !== 0}
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
              disabled={runningStage !== 0}
              onClick={async () => {
                try {
                  await executeStage5();
                  setPipelineBanner(null);
                } catch (e: unknown) {
                  setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
                } finally {
                  setRunningStage(0);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeChapter.stageCompleted.verification
                  ? 'bg-white border-[#D6CFC5] text-[#1C1917]'
                  : 'bg-[#FAF8F5] border-[#E5E0D8] text-[#57534E]'
              }`}
            >
              {runningStage === 5 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9A3412]" />
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
            disabled={runningStage !== 0}
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
          <div className="p-3 bg-white border border-[#D6CFC5] rounded-lg flex items-center gap-2.5 text-xs text-[#1C1917]">
            {runningStage !== 0 ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#9A3412] shrink-0" />
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
              {activeChapter.verificationReport
                ? ` (${activeChapter.verificationReport.overallScore}%)`
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

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedParagraphIdx(idx)}
                    className={`rounded-xl border transition-colors p-5 space-y-4 ${
                      isSelected
                        ? 'bg-white border-[#9A3412] shadow-xs'
                        : 'bg-white border-[#E5E0D8] hover:border-[#D6CFC5]'
                    }`}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Left: English Paragraph */}
                      <div className="lg:col-span-6 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-[#78716C] font-mono-num">
                          <span>Paragraph {idx + 1} · English Source</span>
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
                        <div className="flex items-center justify-between text-[11px] text-[#78716C]">
                          <span className="font-mono-num">
                            অনুচ্ছেদ {idx + 1} · বাংলা অনুবাদ
                          </span>
                          {pair.lastRefinementAction && (
                            <span className="text-[#9A3412]">
                              Refined ({pair.lastRefinementAction.replace(/_/g, ' ')})
                            </span>
                          )}
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
                          placeholder="এই অনুচ্ছেদের বাংলা অনুবাদ এখানে প্রদর্শিত হবে..."
                          aria-label={`Bangla translation for paragraph ${idx + 1}`}
                          style={{ fontSize: `${settings.banglaFontSize}px` }}
                          className="w-full p-3 font-bangla text-[#1C1917] bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg focus:outline-none focus:border-[#9A3412] focus:bg-white transition-colors"
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
                          {pair.previousBanglaText && (
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
                              disabled={isRefiningThis}
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
                        {pair.previousBanglaText &&
                          pair.previousBanglaText !== pair.banglaText && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg">
                              <div>
                                <div className="text-[11px] font-semibold text-[#78716C] mb-1">
                                  Previous Paragraph Version
                                </div>
                                <p className="font-bangla text-sm text-[#57534E]">
                                  {pair.previousBanglaText}
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
                                  {pair.banglaText}
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
                <textarea
                  rows={22}
                  value={activeChapter.translatedText}
                  onChange={(e) => handleContinuousBanglaChange(e.target.value)}
                  placeholder="বাংলা অনুবাদ এখানে সম্পাদনা করুন..."
                  aria-label="Translated Bangla Chapter Editor"
                  style={{ fontSize: `${settings.banglaFontSize}px` }}
                  className="w-full p-3 font-bangla leading-relaxed bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg focus:outline-none focus:border-[#9A3412]"
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
            onUpdateProject({
              ...project,
              styleProfile: updatedProfile,
              updatedAt: new Date().toISOString(),
            });
          }}
          onUpdateStyleControls={(updatedControls) => {
            onUpdateProject({
              ...project,
              styleControls: updatedControls,
              updatedAt: new Date().toISOString(),
            });
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
            onUpdateProject({
              ...project,
              storyContext: ctx,
              updatedAt: new Date().toISOString(),
            });
          }}
          onUpdateCharacters={(chars) => {
            onUpdateProject({
              ...project,
              characterMemory: chars,
              updatedAt: new Date().toISOString(),
            });
          }}
          onUpdateTerminology={(terms) => {
            onUpdateProject({
              ...project,
              terminologyMemory: terms,
              updatedAt: new Date().toISOString(),
            });
          }}
        />
      )}

      {/* Sub-Tab 4: Editorial & Accuracy Verification */}
      {subTab === 'verification' && (
        <VerificationAndEditorialPanel
          editorialNotes={activeChapter.editorialNotes}
          editorialChanges={activeChapter.editorialChanges}
          verificationReport={activeChapter.verificationReport}
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
              await executeStage5();
              setPipelineBanner(null);
            } catch (e: unknown) {
              setErrorBanner(e instanceof Error ? e.message : 'Stage 5 error');
            } finally {
              setRunningStage(0);
            }
          }}
          onApplySuggestedFix={(issue) => {
            const pIdx = issue.paragraphIndex ?? 0;
            if (!issue.suggestedFix) return;
            handleManualParagraphChange(pIdx, issue.suggestedFix);

            if (activeChapter.verificationReport) {
              const updatedIssues = activeChapter.verificationReport.issues.map((i) =>
                i.id === issue.id ? { ...i, resolved: true } : i
              );
              updateChapterInProject(project, activeChapter.id, (existing) => ({
                ...existing,
                verificationReport: existing.verificationReport
                  ? { ...existing.verificationReport, issues: updatedIssues }
                  : null,
              }));
            }
          }}
          onMarkIssueResolved={(issueId) => {
            if (!activeChapter.verificationReport) return;
            const updatedIssues = activeChapter.verificationReport.issues.map((i) =>
              i.id === issueId ? { ...i, resolved: true } : i
            );
            updateChapterInProject(project, activeChapter.id, (existing) => ({
              ...existing,
              status: 'completed',
              verificationReport: existing.verificationReport
                ? { ...existing.verificationReport, issues: updatedIssues }
                : null,
            }));
          }}
        />
      )}
    </div>
  );
}
