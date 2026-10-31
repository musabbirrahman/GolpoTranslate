'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Download,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { TranslationProject } from '@/lib/types';
import {
  countWords,
  formatBilingualExport,
  formatFullStoryExport,
} from '@/lib/chunker';

interface ProjectsViewProps {
  projects: TranslationProject[];
  onOpenProject: (projectId: string, chapterId?: string) => void;
  onDeleteProject: (projectId: string) => void;
  onNewTranslation: () => void;
}

export default function ProjectsView({
  projects,
  onOpenProject,
  onDeleteProject,
  onNewTranslation,
}: ProjectsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in_progress'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filteredProjects = projects.filter((proj) => {
    const matchesSearch =
      proj.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.authorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.genre.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    const allDone =
      proj.chapters.length > 0 &&
      proj.chapters.every((c) => c.status === 'completed');

    if (statusFilter === 'completed') return allDone;
    if (statusFilter === 'in_progress') return !allDone;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#1C1917]">
            My Literary Translation Projects
          </h1>
          <p className="text-sm text-[#57534E] mt-1">
            Manage multi-chapter manuscripts, reusable Author Style Profiles, and Character & Terminology Memories
          </p>
        </div>

        <button
          type="button"
          onClick={onNewTranslation}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Translation Project</span>
        </button>
      </div>

      {/* Search & Segmented Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#78716C] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, or genre..."
            aria-label="Search translation projects"
            className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F3EFEA] border border-[#E5E0D8] rounded-lg">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              statusFilter === 'all'
                ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            All Projects ({projects.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('in_progress')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              statusFilter === 'in_progress'
                ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            In Progress
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              statusFilter === 'completed'
                ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            Completed
          </button>
        </div>
      </div>

      {/* Project List */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-12 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-[#9A3412] mx-auto" />
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
            No Matching Translation Projects
          </h2>
          <p className="text-xs text-[#57534E] max-w-md mx-auto">
            Create a new translation project or adjust your search filter to view your manuscripts.
          </p>
          <button
            type="button"
            onClick={onNewTranslation}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Translation</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((project) => {
            const completedCh = project.chapters.filter(
              (c) => c.status === 'completed'
            ).length;
            const totalWords = project.chapters.reduce(
              (acc, c) => acc + countWords(c.originalText),
              0
            );

            return (
              <div
                key={project.id}
                className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                      {project.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
                      <span>Author: {project.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.genre}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {project.sourceLanguage} → {project.targetLanguage}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{totalWords} source words</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadTextFile(
                          `${project.title.toLowerCase().replace(/\s+/g, '-')}-bangla.txt`,
                          formatFullStoryExport(project)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5 text-[#9A3412]" />
                      <span>Export Bangla TXT</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadTextFile(
                          `${project.title.toLowerCase().replace(/\s+/g, '-')}-bilingual.txt`,
                          formatBilingualExport(project)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5 text-[#57534E]" />
                      <span>Export Bilingual TXT</span>
                    </button>

                    {confirmDeleteId === project.id ? (
                      <div className="flex items-center gap-1.5 bg-[#FEF2F2] border border-[#FECACA] px-2.5 py-1 rounded-lg">
                        <span className="text-xs text-[#991B1B]">Confirm delete?</span>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteProject(project.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-xs font-semibold text-[#991B1B] underline cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-[#57534E] cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(project.id)}
                        aria-label={`Delete ${project.title}`}
                        className="p-1.5 text-[#78716C] hover:text-[#991B1B] rounded-lg hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>Open Studio</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Author Voice Summary */}
                {project.styleProfile && (
                  <div className="bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg p-3.5 text-xs text-[#57534E]">
                    <span className="font-semibold text-[#1C1917]">
                      Calibrated Author Voice:{' '}
                    </span>
                    {project.styleProfile.overallVoice}
                  </div>
                )}

                {/* Chapter Breakdown Table */}
                <div className="border-t border-[#E5E0D8] pt-4">
                  <div className="flex items-center justify-between text-xs text-[#57534E] mb-2.5">
                    <span className="font-semibold text-[#1C1917]">
                      Chapters ({completedCh}/{project.chapters.length} Completed)
                    </span>
                    <span className="font-mono-num">
                      {project.characterMemory.length} Characters ·{' '}
                      {project.terminologyMemory.length} Glossary Terms
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {project.chapters.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => onOpenProject(project.id, ch.id)}
                        className="text-left p-3 rounded-lg bg-[#FAF8F5] hover:bg-[#F3EFEA] border border-[#E5E0D8] transition-colors cursor-pointer flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#1C1917] truncate">
                            {ch.title}
                          </div>
                          <div className="text-[11px] text-[#57534E] mt-0.5 font-mono-num">
                            {ch.paragraphs.length} paragraphs ·{' '}
                            {ch.status === 'completed'
                              ? 'Completed'
                              : ch.status === 'needs_review'
                                ? 'Needs Review'
                                : 'Pending'}
                          </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-[#9A3412] shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
