'use client';

import React from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Feather,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  EditorialChange,
  VerificationIssue,
  VerificationReport,
} from '@/lib/types';

interface VerificationAndEditorialPanelProps {
  editorialNotes: string[];
  editorialChanges: EditorialChange[];
  verificationReport: VerificationReport | null;
  isRunningStage4: boolean;
  isRunningStage5: boolean;
  onRunStage4: () => void;
  onRunStage5: () => void;
  onApplySuggestedFix: (issue: VerificationIssue) => void;
  onMarkIssueResolved: (issueId: string) => void;
}

export default function VerificationAndEditorialPanel({
  editorialNotes,
  editorialChanges,
  verificationReport,
  isRunningStage4,
  isRunningStage5,
  onRunStage4,
  onRunStage5,
  onApplySuggestedFix,
  onMarkIssueResolved,
}: VerificationAndEditorialPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Stage 5 Accuracy Verification (7 Cols) */}
      <div className="lg:col-span-7 bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#9A3412]" />
              <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
                Stage 5 · Accuracy & Fidelity Verification
              </h3>
            </div>
            <p className="text-xs text-[#57534E] mt-0.5">
              Audits English source against Bangla output for missing sentences, omitted dialogue, changed meaning, or character discrepancies
            </p>
          </div>

          <button
            type="button"
            onClick={onRunStage5}
            disabled={isRunningStage5}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>
              {isRunningStage5 ? 'Running Accuracy Audit...' : 'Run Accuracy Verification (Stage 5)'}
            </span>
          </button>
        </div>

        {verificationReport ? (
          <div className="space-y-5">
            {/* Summary Banner */}
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8] flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#1C1917]">
                  <span>Fidelity Verification Summary</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#16A34A]">
                    {verificationReport.isComplete ? '100% Paragraphs Present' : 'Review Needed'}
                  </span>
                </div>
                <p className="text-xs text-[#57534E] leading-relaxed">
                  {verificationReport.fidelitySummary}
                </p>
              </div>

              <div className="text-right shrink-0">
                <div className="text-[11px] text-[#78716C]">Fidelity Rating</div>
                <div className="font-display text-3xl font-semibold text-[#1C1917] font-mono-num">
                  {verificationReport.overallScore}%
                </div>
              </div>
            </div>

            {/* Issues List */}
            {verificationReport.issues.length === 0 ? (
              <div className="p-6 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8] text-center space-y-2">
                <CheckCircle2 className="w-6 h-6 text-[#16A34A] mx-auto" />
                <div className="text-sm font-semibold text-[#1C1917]">
                  Zero Discrepancies Detected
                </div>
                <p className="text-xs text-[#57534E]">
                  No missing sentences, omitted dialogues, or altered character meanings were found.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-[#1C1917]">
                  Flagged Items for Human Review ({verificationReport.issues.length})
                </div>
                {verificationReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-4 rounded-xl border space-y-3 ${
                      issue.resolved
                        ? 'bg-[#FAF8F5] border-[#E5E0D8] opacity-70'
                        : 'bg-white border-[#D97706]/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertTriangle className="w-4 h-4 text-[#D97706]" />
                        <span className="font-semibold text-[#1C1917] capitalize">
                          {issue.type.replace(/_/g, ' ')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#57534E] font-mono-num">
                          Paragraph {(issue.paragraphIndex ?? 0) + 1}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#9A3412] uppercase text-[11px] font-semibold">
                          {issue.severity} severity
                        </span>
                      </div>

                      {issue.resolved ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#16A34A]">
                          <Check className="w-3.5 h-3.5" />
                          <span>Resolved</span>
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {issue.suggestedFix && (
                            <button
                              type="button"
                              onClick={() => onApplySuggestedFix(issue)}
                              className="px-3 py-1 text-xs font-semibold text-white bg-[#9A3412] rounded-md hover:bg-[#7C2D12] cursor-pointer"
                            >
                              Apply Suggested Fix
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onMarkIssueResolved(issue.id)}
                            className="px-3 py-1 text-xs font-medium text-[#57534E] bg-[#F3EFEA] rounded-md hover:text-[#1C1917] cursor-pointer"
                          >
                            Dismiss / Resolved
                          </button>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-[#1C1917]">{issue.description}</p>

                    {issue.suggestedFix && (
                      <div className="p-3 bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg">
                        <div className="text-[11px] text-[#78716C] mb-1">
                          Suggested Bangla Paragraph Revision:
                        </div>
                        <p className="font-bangla text-sm text-[#1C1917]">
                          {issue.suggestedFix}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center bg-[#FAF8F5] rounded-xl border border-[#E5E0D8] text-xs text-[#57534E]">
            Run Stage 5 Accuracy Verification after translating to compare the original English manuscript against your Bangla translation.
          </div>
        )}
      </div>

      {/* Stage 4 Literary Editing Report (5 Cols) */}
      <div className="lg:col-span-5 bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Feather className="w-4 h-4 text-[#9A3412]" />
              <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
                Stage 4 · Literary Editing Log
              </h3>
            </div>
            <p className="text-xs text-[#57534E] mt-0.5">
              Refines sentence flow, rhythm, dialogue quality, and Bangla word choice
            </p>
          </div>

          <button
            type="button"
            onClick={onRunStage4}
            disabled={isRunningStage4}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1C1917] bg-[#F3EFEA] border border-[#D6CFC5] rounded-lg hover:bg-[#EAE4DC] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#9A3412]" />
            <span>{isRunningStage4 ? 'Polishing Prose...' : 'Run Literary Edit (Stage 4)'}</span>
          </button>
        </div>

        {editorialNotes.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#1C1917]">
              Chief Editor Notes
            </div>
            <ul className="space-y-1.5 text-xs text-[#57534E] list-disc pl-4">
              {editorialNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {editorialChanges.length > 0 ? (
          <div className="space-y-3 pt-2">
            <div className="text-xs font-semibold text-[#1C1917]">
              Key Stylistic Refinements ({editorialChanges.length})
            </div>
            {editorialChanges.map((change, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#9A3412]">{change.aspect}</span>
                  <span className="text-[#78716C] font-mono-num">
                    Paragraph {change.paragraphIndex + 1}
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="text-[#78716C] line-through font-bangla">
                    {change.beforeSnippet}
                  </div>
                  <div className="text-[#1C1917] font-medium font-bangla">
                    {change.afterSnippet}
                  </div>
                </div>
                <p className="text-[11px] text-[#57534E]">{change.rationale}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center bg-[#FAF8F5] rounded-xl border border-[#E5E0D8] text-xs text-[#57534E]">
            Run Stage 4 Literary Editing to elevate Bangla sentence cadence and dialogue naturalness after initial translation.
          </div>
        )}
      </div>
    </div>
  );
}
