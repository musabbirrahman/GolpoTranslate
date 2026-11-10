'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import Navbar, { type NavTab } from '@/components/Navbar';
import DashboardView from '@/components/DashboardView';
import WorkspaceView from '@/components/WorkspaceView';
import ProjectsView from '@/components/ProjectsView';
import HistoryView from '@/components/HistoryView';
import SettingsView from '@/components/SettingsView';
import NewProjectModal from '@/components/NewProjectModal';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type HistoryActionType,
  type TranslationHistoryEntry,
  type TranslationProject,
} from '@/lib/types';
import {
  addHistoryEntry,
  createStarterProject,
  deleteProject,
  getAllProjects,
  getAppSettings,
  getHistoryEntries,
  saveAppSettings,
  saveProject,
} from '@/lib/storage';
import { alignParagraphs, chunkTextByParagraphs } from '@/lib/chunker';
import type { SamplePassage } from '@/lib/sample-passages';

const emptySubscribe = () => () => {};

export default function GolpoTranslateApp() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [projects, setProjects] = useState<TranslationProject[]>(() => [
    createStarterProject(),
  ]);
  const [activeProjectId, setActiveProjectId] = useState<string>(
    'proj-clockmaker-calcutta'
  );
  const [activeChapterId, setActiveChapterId] = useState<string>('ch-1-clockmaker');
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [autoRunPipelineTrigger, setAutoRunPipelineTrigger] = useState(0);
  const hasMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Load persisted projects, history, and settings from IndexedDB on mount
  useEffect(() => {
    let mounted = true;
    async function loadInitialState() {
      const [loadedProjects, loadedHistory, loadedSettings] = await Promise.all([
        getAllProjects(),
        getHistoryEntries(),
        getAppSettings(),
      ]);
      if (!mounted) return;
      if (loadedProjects.length > 0) {
        setProjects(loadedProjects);
        setActiveProjectId(loadedProjects[0].id);
        if (loadedProjects[0].chapters[0]) {
          setActiveChapterId(loadedProjects[0].chapters[0].id);
        }
      }
      setHistory(loadedHistory);
      setSettings(loadedSettings);
    }
    loadInitialState();
    return () => {
      mounted = false;
    };
  }, []);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0];

  const handleOpenProject = (projectId: string, chapterId?: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;
    setActiveProjectId(target.id);
    setActiveChapterId(chapterId || target.chapters[0]?.id || '');
    setActiveTab('workspace');
  };

  const handleUpdateProject = async (updated: TranslationProject) => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((p) => (p.id === updated.id ? updated : p));
    });
    if (settings.autoSave) {
      await saveProject(updated);
    }
  };

  const handleCreateProject = async (
    newProject: TranslationProject,
    autoStartPipeline: boolean
  ) => {
    await saveProject(newProject);
    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setActiveChapterId(newProject.chapters[0]?.id || '');
    setIsNewModalOpen(false);
    setActiveTab('workspace');

    if (autoStartPipeline) {
      setAutoRunPipelineTrigger((t) => t + 1);
    }
  };

  const handleQuickCreateFromSample = async (sample: SamplePassage) => {
    const now = new Date().toISOString();
    const chunks = chunkTextByParagraphs(sample.text, settings.maxWordsPerChunk);

    const newProject: TranslationProject = {
      id: `proj-${Date.now()}`,
      title: sample.title,
      authorName: sample.authorName,
      genre: sample.genre,
      sourceLanguage: 'English',
      targetLanguage: 'Bangla (বাংলা)',
      createdAt: now,
      updatedAt: now,
      styleProfile: null,
      storyContext: null,
      characterMemory: [],
      terminologyMemory: [],
      styleControls: { ...settings.defaultStyleControls },
      chapters: [
        {
          id: `ch-${Date.now()}-1`,
          number: 1,
          title: sample.chapterTitle,
          originalText: sample.text,
          translatedText: '',
          paragraphs: alignParagraphs(sample.text, ''),
          status: 'pending',
          currentStage: 0,
          stageCompleted: {
            understanding: false,
            voiceAnalysis: false,
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
        },
      ],
    };

    await saveProject(newProject);
    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setActiveChapterId(newProject.chapters[0].id);
    setActiveTab('workspace');
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    const remaining = projects.filter((p) => p.id !== projectId);
    if (remaining.length === 0) {
      const starter = createStarterProject();
      await saveProject(starter);
      setProjects([starter]);
      setActiveProjectId(starter.id);
      setActiveChapterId(starter.chapters[0].id);
    } else {
      setProjects(remaining);
      if (activeProjectId === projectId) {
        setActiveProjectId(remaining[0].id);
        setActiveChapterId(remaining[0].chapters[0]?.id || '');
      }
    }
  };

  const handleLogHistory = async (entryData: {
    projectId: string;
    projectTitle: string;
    chapterId: string;
    chapterTitle: string;
    actionType: HistoryActionType;
    summary: string;
    paragraphIndex?: number;
    previousText?: string;
    newText?: string;
  }) => {
    const entry: TranslationHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entryData,
    };
    setHistory((prev) => [entry, ...prev]);
    await addHistoryEntry(entry);
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    await saveAppSettings(newSettings);
  };

  if (!hasMounted) {
    return (
      <div
        className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1C1917]"
        suppressHydrationWarning
      />
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1C1917]"
      suppressHydrationWarning
    >
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onNewTranslation={() => setIsNewModalOpen(true)}
      />

      <main className="flex-1">
        {activeTab === 'dashboard' && (
          <DashboardView
            projects={projects}
            onOpenProject={handleOpenProject}
            onNewTranslation={() => setIsNewModalOpen(true)}
            onQuickCreateFromSample={handleQuickCreateFromSample}
          />
        )}

        {activeTab === 'workspace' && activeProject && (
          <WorkspaceView
            project={activeProject}
            activeChapterId={activeChapterId}
            settings={settings}
            autoRunPipelineTrigger={autoRunPipelineTrigger}
            onSelectChapter={setActiveChapterId}
            onUpdateProject={handleUpdateProject}
            onLogHistory={handleLogHistory}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsView
            projects={projects}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onNewTranslation={() => setIsNewModalOpen(true)}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView history={history} onOpenProject={handleOpenProject} />
        )}

        {activeTab === 'settings' && (
          <SettingsView settings={settings} onSaveSettings={handleSaveSettings} />
        )}
      </main>

      <footer className="border-t border-[#E5E0D8] py-5 px-6 lg:px-10 text-xs text-[#78716C] flex flex-wrap items-center justify-between gap-4">
        <div>
          GolpoTranslate — Adaptive AI Literary Translation Studio · English to Expressive Bangla (বাংলা)
        </div>
        <div>
          Local IndexedDB Persistence · Multi-Stage Literary Voice & Context Preservation
        </div>
      </footer>

      <NewProjectModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateProject={handleCreateProject}
        defaultStyleControls={settings.defaultStyleControls}
        maxWordsPerChunk={settings.maxWordsPerChunk}
      />
    </div>
  );
}
