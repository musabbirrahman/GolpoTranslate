'use client';

import React from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import type { TranslationProject } from '@/lib/types';
import { SAMPLE_LITERARY_PASSAGES, type SamplePassage } from '@/lib/sample-passages';
import { countWords } from '@/lib/chunker';

interface DashboardViewProps {
  projects: TranslationProject[];
  onOpenProject: (projectId: string, chapterId?: string) => void;
  onNewTranslation: () => void;
  onQuickCreateFromSample: (sample: SamplePassage) => void;
}

export default function DashboardView({
  projects,
  onOpenProject,
  onNewTranslation,
  onQuickCreateFromSample,
}: DashboardViewProps) {
  const totalChapters = projects.reduce((acc, p) => acc + p.chapters.length, 0);
  const completedChapters = projects.reduce(
    (acc, p) => acc + p.chapters.filter((c) => c.status === 'completed').length,
    0
  );
  const unfinishedChapters = projects.flatMap((p) =>
    p.chapters
      .filter((c) => c.status !== 'completed')
      .map((c) => ({ project: p, chapter: c }))
  );

  const totalCharacters = projects.reduce((acc, p) => acc + p.characterMemory.length, 0);
  const totalTerms = projects.reduce((acc, p) => acc + p.terminologyMemory.length, 0);

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 space-y-12">
      {/* Split Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch bg-[#F3EFEA] border border-[#E5E0D8] rounded-2xl p-8 lg:p-10">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="text-xs font-medium text-[#9A3412] tracking-wide">
              Adaptive AI Literary Translation Studio · গল্পট্রান্সলেট সাহিত্য স্টুডিও
            </div>
            <h1
              className="font-display text-4xl sm:text-5xl font-semibold text-[#1C1917] leading-[1.12] tracking-tight"
              style={{ textWrap: 'balance' }}
            >
              Translate English Literature into Living, Expressive Bangla.
            </h1>
            <p className="text-base text-[#57534E] leading-relaxed max-w-2xl">
              GolpoTranslate analyzes an author&apos;s unique literary voice, sentence rhythm,
              emotional subtext, and character speech patterns before translating—so every
              Bangla chapter reads as if originally composed by a gifted Bengali novelist.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onNewTranslation}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Translation</span>
            </button>
            {projects[0] && (
              <button
                type="button"
                onClick={() => onOpenProject(projects[0].id)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#1C1917] bg-white border border-[#D6CFC5] rounded-lg hover:bg-[#FAF8F5] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-4 h-4 text-[#9A3412]" />
                <span>Open Active Manuscript</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Live Literary Voice Specimen */}
        <div className="lg:col-span-5 flex flex-col justify-between bg-[#FAF8F5] border border-[#E5E0D8] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-[#57534E] border-b border-[#E5E0D8] pb-3">
            <span className="font-semibold text-[#1C1917]">Adaptive Voice Specimen</span>
            <span>English Source → সাহিত্যিক বাংলা</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-[#78716C] mb-1">
                Original English · Julian Vance (Lyrical Realism)
              </div>
              <p className="text-xs text-[#57534E] italic leading-relaxed">
                &ldquo;Brass does not lie, Aparajita. When a gear slips, it admits its fatigue.
                People, on the other hand, keep ticking long after the mainspring has
                snapped.&rdquo;
              </p>
            </div>

            <div className="pt-2 border-t border-[#E5E0D8]/70">
              <div className="text-[11px] text-[#9A3412] mb-1">
                GolpoTranslate Adaptive Bangla Output · প্রমিত সাহিত্যিক ধারা
              </div>
              <p className="font-bangla text-base text-[#1C1917] leading-relaxed">
                &ldquo;পিতল কখনো মিথ্যে বলে না, অপরাজিতা। কোনো চাকা ক্ষয়ে গেলে সে নিজের ক্লান্তির
                কথা স্বীকার করে নেয়। অথচ মানুষগুলোকে দেখুন—মূল স্প্রিংটা ছিঁড়ে যাওয়ার পরও কেমন
                বছরের পর বছর টিকটিক করে চলতে থাকে।&rdquo;
              </p>
            </div>
          </div>

          <div className="text-[11px] text-[#57534E] pt-2 border-t border-[#E5E0D8] flex items-center justify-between">
            <span>5-Stage Pipeline: Context · Voice · Translation · Editing · Audit</span>
          </div>
        </div>
      </section>

      {/* Studio Metrics Strip (Full-Width Row Below Hero Split) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-5">
          <div className="text-xs text-[#57534E]">Translation Projects</div>
          <div className="font-display text-3xl font-semibold text-[#1C1917] font-mono-num mt-1">
            {projects.length}
          </div>
          <div className="text-xs text-[#78716C] mt-1">
            Stored locally in IndexedDB
          </div>
        </div>

        <div className="bg-white border border-[#E5E0D8] rounded-xl p-5">
          <div className="text-xs text-[#57534E]">Chapter Completion</div>
          <div className="font-display text-3xl font-semibold text-[#1C1917] font-mono-num mt-1">
            {completedChapters} / {totalChapters}
          </div>
          <div className="text-xs text-[#78716C] mt-1">
            {unfinishedChapters.length} pending or awaiting review
          </div>
        </div>

        <div className="bg-white border border-[#E5E0D8] rounded-xl p-5">
          <div className="text-xs text-[#57534E]">Character Memory Vault</div>
          <div className="font-display text-3xl font-semibold text-[#1C1917] font-mono-num mt-1">
            {totalCharacters}
          </div>
          <div className="text-xs text-[#78716C] mt-1">
            Voice, pronouns & Bangla names tracked
          </div>
        </div>

        <div className="bg-white border border-[#E5E0D8] rounded-xl p-5">
          <div className="text-xs text-[#57534E]">Terminology Glossary</div>
          <div className="font-display text-3xl font-semibold text-[#1C1917] font-mono-num mt-1">
            {totalTerms}
          </div>
          <div className="text-xs text-[#78716C] mt-1">
            Recurring places, objects & idioms
          </div>
        </div>
      </section>

      {/* Recent Projects & Unfinished Translations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Recent Projects (7 cols) */}
        <section className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                Recent Translation Projects
              </h2>
              <p className="text-xs text-[#57534E]">
                Continue translating chapters with persistent Style Profiles and Character Memory
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {projects.map((project) => {
              const doneCount = project.chapters.filter(
                (c) => c.status === 'completed'
              ).length;
              const totalCount = project.chapters.length;
              const progressPct =
                totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
              const totalWords = project.chapters.reduce(
                (sum, ch) => sum + countWords(ch.originalText),
                0
              );

              return (
                <div
                  key={project.id}
                  className="bg-white border border-[#E5E0D8] rounded-xl p-5 hover:border-[#9A3412]/50 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="font-display text-xl font-semibold text-[#1C1917]">
                        {project.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
                        <span>{project.authorName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{project.genre}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">{totalWords} words</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">
                          {doneCount}/{totalCount} chapters completed
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#9A3412] bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>Open Workspace</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Progress & Memory Summary */}
                  <div className="mt-4 pt-3 border-t border-[#E5E0D8]/70 flex flex-wrap items-center justify-between gap-4 text-xs text-[#57534E]">
                    <div className="flex items-center gap-4">
                      <span>
                        Style Profile:{' '}
                        <strong className="text-[#1C1917]">
                          {project.styleProfile ? 'Calibrated' : 'Pending Analysis'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">
                        {project.characterMemory.length} Characters
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">
                        {project.terminologyMemory.length} Glossary Terms
                      </span>
                    </div>

                    <div className="flex items-center gap-2 w-40">
                      <div className="flex-1 h-1.5 bg-[#F3EFEA] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#9A3412] transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="font-mono-num text-[11px]">{progressPct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick Access to Unfinished Chapters & Genre Voices (5 cols) */}
        <section className="lg:col-span-5 space-y-6">
          <div className="space-y-3">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                Unfinished Chapters Queue
              </h2>
              <p className="text-xs text-[#57534E]">
                Jump directly into chapters awaiting translation or accuracy review
              </p>
            </div>

            {unfinishedChapters.length === 0 ? (
              <div className="bg-white border border-[#E5E0D8] rounded-xl p-6 text-center space-y-2">
                <CheckCircle2 className="w-6 h-6 text-[#16A34A] mx-auto" />
                <div className="text-sm font-semibold text-[#1C1917]">
                  All Chapters Completed
                </div>
                <p className="text-xs text-[#57534E]">
                  Every chapter in your current projects has completed the 5-stage pipeline.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {unfinishedChapters.map(({ project, chapter }) => (
                  <div
                    key={chapter.id}
                    className="bg-white border border-[#E5E0D8] rounded-xl p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#1C1917] truncate">
                        {chapter.title}
                      </div>
                      <div className="text-xs text-[#57534E] truncate mt-0.5">
                        {project.title} ·{' '}
                        {chapter.status === 'needs_review'
                          ? 'Needs Human Review'
                          : chapter.status === 'in_progress'
                            ? `Stage ${chapter.currentStage}/5 In Progress`
                            : 'Pending Translation'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id, chapter.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Translate Chapter
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Explore Adaptive Literary Voices */}
          <div className="space-y-3 pt-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
                Test Adaptive Voice Profiles
              </h2>
              <p className="text-xs text-[#57534E]">
                Launch a new project pre-loaded with a distinct literary genre to inspect how the
                Style Profile adapts Bangla diction
              </p>
            </div>

            <div className="space-y-2.5">
              {SAMPLE_LITERARY_PASSAGES.slice(1).map((sample) => (
                <div
                  key={sample.id}
                  className="bg-[#F3EFEA] border border-[#E5E0D8] rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#1C1917]">
                      {sample.title}{' '}
                      <span className="font-normal text-[#57534E]">
                        · {sample.genre}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#57534E] mt-0.5 truncate">
                      {sample.voiceTagline}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onQuickCreateFromSample(sample)}
                    className="px-3 py-1.5 text-xs font-semibold text-[#1C1917] bg-white border border-[#D6CFC5] rounded-lg hover:bg-[#FAF8F5] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Try Passage
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
