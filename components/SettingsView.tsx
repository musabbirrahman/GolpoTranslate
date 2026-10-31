'use client';

import React, { useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from '@/lib/types';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
}

export default function SettingsView({
  settings,
  onSaveSettings,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleReset = () => {
    setDraft(DEFAULT_APP_SETTINGS);
    onSaveSettings(DEFAULT_APP_SETTINGS);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 lg:px-10 py-10 space-y-8">
      <div className="border-b border-[#E5E0D8] pb-6">
        <h1 className="font-display text-3xl font-semibold text-[#1C1917]">
          Studio Preferences & Translation Defaults
        </h1>
        <p className="text-sm text-[#57534E] mt-1">
          Configure default literary translation controls, long-chapter chunking thresholds, and Bangla manuscript typography
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Default Literary Style Controls */}
        <section className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
              Default Adaptive Translation Controls
            </h2>
            <p className="text-xs text-[#57534E]">
              Applied automatically to newly created translation projects (can also be customized per project)
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="flex items-start gap-3 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={draft.defaultStyleControls.preserveAuthorStyle}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      preserveAuthorStyle: e.target.checked,
                    },
                  })
                }
                className="mt-1 accent-[#9A3412]"
              />
              <div>
                <div className="text-xs font-semibold text-[#1C1917]">
                  Preserve Original Author&apos;s Style (Default ON)
                </div>
                <div className="text-xs text-[#57534E] mt-0.5">
                  Instructs the translation engine to mirror the source author&apos;s sentence cadence, emotional tone, and narrative voice in Bangla.
                </div>
              </div>
            </label>

            <div>
              <label
                htmlFor="setting-naturalness"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Bangla Naturalness
              </label>
              <select
                id="setting-naturalness"
                value={draft.defaultStyleControls.naturalness}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      naturalness: e.target.value as 'balanced' | 'highly_natural',
                    },
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
              >
                <option value="highly_natural">Highly Natural (Idiomatic native Bangla flow)</option>
                <option value="balanced">Balanced (Close to source clause structure)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="setting-expression"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Literary Expression
              </label>
              <select
                id="setting-expression"
                value={draft.defaultStyleControls.literaryExpression}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      literaryExpression: e.target.value as 'subtle' | 'rich',
                    },
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
              >
                <option value="rich">Rich & Evocative</option>
                <option value="subtle">Subtle & Restrained</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="setting-complexity"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Language Complexity
              </label>
              <select
                id="setting-complexity"
                value={draft.defaultStyleControls.languageComplexity}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      languageComplexity: e.target.value as 'simple' | 'moderate' | 'advanced',
                    },
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
              >
                <option value="simple">Simple & Accessible</option>
                <option value="moderate">Moderate Literary Standard</option>
                <option value="advanced">Advanced / Classic Literary Diction</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="setting-dialogue"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Dialogue Style
              </label>
              <select
                id="setting-dialogue"
                value={draft.defaultStyleControls.dialogueStyle}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      dialogueStyle: e.target.value as 'faithful' | 'more_conversational',
                    },
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
              >
                <option value="more_conversational">More Conversational (Natural spoken Bangla)</option>
                <option value="faithful">Faithful to Source Register</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="setting-approach"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Translation Approach
              </label>
              <select
                id="setting-approach"
                value={draft.defaultStyleControls.translationApproach}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultStyleControls: {
                      ...draft.defaultStyleControls,
                      translationApproach: e.target.value as
                        | 'faithful_literary'
                        | 'expressive_adaptation',
                    },
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg"
              >
                <option value="faithful_literary">
                  Faithful Literary Translation (Creative yet strictly anchored to original phrasing)
                </option>
                <option value="expressive_adaptation">
                  More Expressive Adaptation (Adapts idioms naturally while preserving 100% meaning)
                </option>
              </select>
            </div>
          </div>
        </section>

        {/* Long-Form Chunking & Typography */}
        <section className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
              Long-Form Chunking & Manuscript Typography
            </h2>
            <p className="text-xs text-[#57534E]">
              Control how long chapters are split at paragraph boundaries and how Bangla text is displayed
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label
                htmlFor="chunk-words-input"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Target Words per Chunk
              </label>
              <input
                id="chunk-words-input"
                type="number"
                min={150}
                max={1500}
                step={50}
                value={draft.maxWordsPerChunk}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxWordsPerChunk: Number(e.target.value) || 500,
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg font-mono-num"
              />
              <span className="text-[11px] text-[#78716C] mt-1 block">
                Splits safely at paragraph boundaries
              </span>
            </div>

            <div>
              <label
                htmlFor="bangla-font-size"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Bangla Font Size (px)
              </label>
              <input
                id="bangla-font-size"
                type="number"
                min={14}
                max={26}
                value={draft.banglaFontSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    banglaFontSize: Number(e.target.value) || 18,
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg font-mono-num"
              />
            </div>

            <div>
              <label
                htmlFor="english-font-size"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                English Font Size (px)
              </label>
              <input
                id="english-font-size"
                type="number"
                min={13}
                max={24}
                value={draft.englishFontSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    englishFontSize: Number(e.target.value) || 16,
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-white border border-[#D6CFC5] rounded-lg font-mono-num"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-[#1C1917] cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={draft.autoSave}
              onChange={(e) => setDraft({ ...draft, autoSave: e.target.checked })}
              className="accent-[#9A3412]"
            />
            <span>Automatically save manuscript edits and stage outputs to IndexedDB</span>
          </label>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] bg-[#F3EFEA] border border-[#D6CFC5] rounded-lg cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#16A34A]">
                <Check className="w-4 h-4" />
                <span>Preferences Saved</span>
              </span>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
