'use client';

import React, { useState } from 'react';
import { ArrowRight, Clock, History } from 'lucide-react';
import type { TranslationHistoryEntry } from '@/lib/types';

interface HistoryViewProps {
  history: TranslationHistoryEntry[];
  onOpenProject: (projectId: string, chapterId?: string) => void;
}

const ACTION_LABELS: Record<TranslationHistoryEntry['actionType'], string> = {
  stage_1_understanding: 'Stage 1 · Literary Understanding & Memory',
  stage_2_voice: 'Stage 2 · Author Voice & Style Profile',
  stage_3_translation: 'Stage 3 · Faithful Literary Translation',
  stage_4_editing: 'Stage 4 · Literary Editing Pass',
  stage_5_verification: 'Stage 5 · Accuracy Verification',
  paragraph_refinement: 'Paragraph-Level Refinement',
  manual_save: 'Manual Manuscript Save',
};

export default function HistoryView({ history, onOpenProject }: HistoryViewProps) {
  const [filterType, setFilterType] = useState<string>('all');

  const filtered =
    filterType === 'all'
      ? history
      : history.filter((item) => item.actionType === filterType);

  return (
    <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#1C1917]">
            Translation & Editorial History
          </h1>
          <p className="text-sm text-[#57534E] mt-1">
            Chronological log of multi-stage pipeline runs, voice analyses, and paragraph-level revisions
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F3EFEA] border border-[#E5E0D8] rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              filterType === 'all'
                ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            All Activity ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('stage_3_translation')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              filterType === 'stage_3_translation'
                ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            Translations
          </button>
          <button
            type="button"
            onClick={() => setFilterType('paragraph_refinement')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              filterType === 'paragraph_refinement'
                ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                : 'text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            Paragraph Revisions
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-12 text-center space-y-2">
          <History className="w-8 h-8 text-[#9A3412] mx-auto" />
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
            No History Entries Recorded Yet
          </h2>
          <p className="text-xs text-[#57534E] max-w-md mx-auto">
            As you analyze author voices, translate chapters, or refine paragraphs in the Studio Workspace, every revision will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="bg-white border border-[#E5E0D8] rounded-xl p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[#9A3412]">
                    {ACTION_LABELS[entry.actionType] || entry.actionType}
                  </div>
                  <div className="text-sm font-semibold text-[#1C1917]">
                    {entry.projectTitle} · {entry.chapterTitle}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs text-[#78716C] font-mono-num">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenProject(entry.projectId, entry.chapterId)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#1C1917] bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg hover:bg-[#F3EFEA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span>Open Chapter</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#57534E]">{entry.summary}</p>

              {entry.previousText && entry.newText && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[#E5E0D8]">
                  <div className="bg-[#FAF8F5] p-3 rounded-lg border border-[#E5E0D8]">
                    <div className="text-[11px] text-[#78716C] mb-1">
                      Previous Version {typeof entry.paragraphIndex === 'number' ? `(Paragraph ${entry.paragraphIndex + 1})` : ''}
                    </div>
                    <p className="font-bangla text-sm text-[#57534E]">
                      {entry.previousText}
                    </p>
                  </div>
                  <div className="bg-[#FAF8F5] p-3 rounded-lg border border-[#E5E0D8]">
                    <div className="text-[11px] text-[#9A3412] mb-1">
                      Revised Version
                    </div>
                    <p className="font-bangla text-sm text-[#1C1917]">
                      {entry.newText}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
