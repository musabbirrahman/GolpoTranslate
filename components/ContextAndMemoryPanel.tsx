'use client';

import React, { useState } from 'react';
import { BookMarked, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import type {
  CharacterMemoryItem,
  StoryContextProfile,
  TerminologyCategory,
  TerminologyMemoryItem,
} from '@/lib/types';

interface ContextAndMemoryPanelProps {
  storyContext: StoryContextProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  isRunningStage1: boolean;
  onRunStage1: () => void;
  onUpdateStoryContext: (ctx: StoryContextProfile) => void;
  onUpdateCharacters: (chars: CharacterMemoryItem[]) => void;
  onUpdateTerminology: (terms: TerminologyMemoryItem[]) => void;
}

export default function ContextAndMemoryPanel({
  storyContext,
  characters,
  terminology,
  isRunningStage1,
  onRunStage1,
  onUpdateStoryContext,
  onUpdateCharacters,
  onUpdateTerminology,
}: ContextAndMemoryPanelProps) {
  // New Character Form State
  const [newCharEng, setNewCharEng] = useState('');
  const [newCharBn, setNewCharBn] = useState('');
  const [newCharPronouns, setNewCharPronouns] = useState('He/Him (সে/তার)');
  const [newCharRel, setNewCharRel] = useState('');
  const [newCharStyle, setNewCharStyle] = useState('');

  // New Terminology Form State
  const [newTermEng, setNewTermEng] = useState('');
  const [newTermBn, setNewTermBn] = useState('');
  const [newTermCat, setNewTermCat] = useState<TerminologyCategory>('place');
  const [newTermNotes, setNewTermNotes] = useState('');

  const handleAddCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharEng.trim() || !newCharBn.trim()) return;

    const item: CharacterMemoryItem = {
      id: `char-${Date.now()}`,
      englishName: newCharEng.trim(),
      banglaName: newCharBn.trim(),
      pronouns: newCharPronouns.trim(),
      relationships: newCharRel.trim(),
      personality: 'Established in project memory',
      speakingStyle: newCharStyle.trim() || 'Natural conversational Bangla',
      notes: '',
    };

    onUpdateCharacters([...characters, item]);
    setNewCharEng('');
    setNewCharBn('');
    setNewCharRel('');
    setNewCharStyle('');
  };

  const handleAddTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTermEng.trim() || !newTermBn.trim()) return;

    const item: TerminologyMemoryItem = {
      id: `term-${Date.now()}`,
      englishTerm: newTermEng.trim(),
      banglaTranslation: newTermBn.trim(),
      category: newTermCat,
      notes: newTermNotes.trim(),
    };

    onUpdateTerminology([...terminology, item]);
    setNewTermEng('');
    setNewTermBn('');
    setNewTermNotes('');
  };

  return (
    <div className="space-y-8">
      {/* Stage 1 Story Context Section */}
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-4">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
              Story Context Profile (Stage 1 Literary Understanding)
            </h3>
            <p className="text-xs text-[#57534E]">
              Tracks narrative timeline, emotional context, settings, and plot events across chapters
            </p>
          </div>

          <button
            type="button"
            onClick={onRunStage1}
            disabled={isRunningStage1}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isRunningStage1
                ? 'Analyzing Story & Extracting Memory...'
                : 'Analyze Story & Extract Memory (Stage 1)'}
            </span>
          </button>
        </div>

        {storyContext ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                Narrative Summary
              </label>
              <textarea
                rows={3}
                value={storyContext.summary}
                onChange={(e) =>
                  onUpdateStoryContext({ ...storyContext, summary: e.target.value })
                }
                className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                Emotional Context
              </label>
              <textarea
                rows={3}
                value={storyContext.emotionalContext}
                onChange={(e) =>
                  onUpdateStoryContext({
                    ...storyContext,
                    emotionalContext: e.target.value,
                  })
                }
                className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                Literary Tone & Timeline
              </label>
              <textarea
                rows={3}
                value={`${storyContext.literaryTone} — ${storyContext.narrativeTimeline}`}
                onChange={(e) =>
                  onUpdateStoryContext({
                    ...storyContext,
                    literaryTone: e.target.value,
                  })
                }
                className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg"
              />
            </div>
          </div>
        ) : (
          <div className="p-6 text-center bg-[#FAF8F5] rounded-lg border border-[#E5E0D8] text-xs text-[#57534E]">
            Click &ldquo;Analyze Story & Extract Memory (Stage 1)&rdquo; to automatically extract characters, relationships, settings, and recurring terminology from the current chapter.
          </div>
        )}
      </div>

      {/* Character Memory & Terminology Memory Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Character Memory */}
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#E5E0D8] pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#9A3412]" />
              <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
                Character Memory ({characters.length})
              </h3>
            </div>
            <span className="text-xs text-[#57534E]">
              Enforced across all chapters
            </span>
          </div>

          {/* Add Character Form */}
          <form
            onSubmit={handleAddCharacter}
            className="p-3.5 bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg space-y-3"
          >
            <div className="text-xs font-semibold text-[#1C1917]">
              Add Character to Project Memory
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={newCharEng}
                onChange={(e) => setNewCharEng(e.target.value)}
                placeholder="English Name (e.g., Elias Bose)"
                aria-label="Character English Name"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
              <input
                type="text"
                value={newCharBn}
                onChange={(e) => setNewCharBn(e.target.value)}
                placeholder="Preferred Bangla Name (e.g., ইলিয়াস বোস)"
                aria-label="Character Preferred Bangla Name"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md font-bangla"
              />
              <input
                type="text"
                value={newCharPronouns}
                onChange={(e) => setNewCharPronouns(e.target.value)}
                placeholder="Pronouns (e.g., তিনি/তাঁর or সে/তার)"
                aria-label="Character Pronouns"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
              <input
                type="text"
                value={newCharStyle}
                onChange={(e) => setNewCharStyle(e.target.value)}
                placeholder="Speaking style & register (আপনি/তুমি)"
                aria-label="Character Speaking Style"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={newCharRel}
                onChange={(e) => setNewCharRel(e.target.value)}
                placeholder="Relationships & role..."
                aria-label="Character Relationships"
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#9A3412] rounded-md hover:bg-[#7C2D12] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Character</span>
              </button>
            </div>
          </form>

          {/* Character List */}
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {characters.map((char, idx) => (
              <div
                key={char.id}
                className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-[#1C1917]">
                      {char.englishName}
                    </span>
                    <span className="text-xs text-[#78716C]">→</span>
                    <input
                      type="text"
                      value={char.banglaName}
                      aria-label={`Preferred Bangla name for ${char.englishName}`}
                      onChange={(e) => {
                        const next = [...characters];
                        next[idx] = { ...char, banglaName: e.target.value };
                        onUpdateCharacters(next);
                      }}
                      className="px-2 py-0.5 text-sm font-bangla font-semibold text-[#9A3412] bg-white border border-[#D6CFC5] rounded"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCharacters(characters.filter((c) => c.id !== char.id))
                    }
                    aria-label={`Remove ${char.englishName}`}
                    className="p-1 text-[#78716C] hover:text-[#991B1B] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[11px] text-[#78716C] block">
                      Pronouns / Honorific
                    </span>
                    <input
                      type="text"
                      value={char.pronouns}
                      onChange={(e) => {
                        const next = [...characters];
                        next[idx] = { ...char, pronouns: e.target.value };
                        onUpdateCharacters(next);
                      }}
                      className="w-full px-2 py-1 text-xs bg-white border border-[#E5E0D8] rounded mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-[#78716C] block">
                      Speaking Style
                    </span>
                    <input
                      type="text"
                      value={char.speakingStyle}
                      onChange={(e) => {
                        const next = [...characters];
                        next[idx] = { ...char, speakingStyle: e.target.value };
                        onUpdateCharacters(next);
                      }}
                      className="w-full px-2 py-1 text-xs bg-white border border-[#E5E0D8] rounded mt-0.5"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Terminology Memory */}
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#E5E0D8] pb-3">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-[#9A3412]" />
              <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
                Terminology & Glossary Memory ({terminology.length})
              </h3>
            </div>
            <span className="text-xs text-[#57534E]">
              Places, objects, fantasy terms & idioms
            </span>
          </div>

          {/* Add Term Form */}
          <form
            onSubmit={handleAddTerm}
            className="p-3.5 bg-[#FAF8F5] border border-[#E5E0D8] rounded-lg space-y-3"
          >
            <div className="text-xs font-semibold text-[#1C1917]">
              Add Preferred Bangla Term to Glossary
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={newTermEng}
                onChange={(e) => setNewTermEng(e.target.value)}
                placeholder="English Term (e.g., Glass Citadel)"
                aria-label="English Term"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
              <input
                type="text"
                value={newTermBn}
                onChange={(e) => setNewTermBn(e.target.value)}
                placeholder="Preferred Bangla (e.g., কাঁচদুর্গ)"
                aria-label="Preferred Bangla Translation"
                className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md font-bangla"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={newTermCat}
                onChange={(e) => setNewTermCat(e.target.value as TerminologyCategory)}
                aria-label="Terminology Category"
                className="px-2.5 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              >
                <option value="place">Place / Location</option>
                <option value="object">Special Object</option>
                <option value="fantasy">Fantasy / World-Building</option>
                <option value="title">Title / Honorific</option>
                <option value="expression">Repeated Expression</option>
                <option value="name">Proper Name</option>
              </select>
              <input
                type="text"
                value={newTermNotes}
                onChange={(e) => setNewTermNotes(e.target.value)}
                placeholder="Optional context note..."
                aria-label="Terminology Context Note"
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-md"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#9A3412] rounded-md hover:bg-[#7C2D12] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Term</span>
              </button>
            </div>
          </form>

          {/* Terminology List */}
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {terminology.map((term, idx) => (
              <div
                key={term.id}
                className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#1C1917]">
                      {term.englishTerm}
                    </span>
                    <span className="text-xs text-[#78716C]">→</span>
                    <input
                      type="text"
                      value={term.banglaTranslation}
                      aria-label={`Preferred Bangla translation for ${term.englishTerm}`}
                      onChange={(e) => {
                        const next = [...terminology];
                        next[idx] = { ...term, banglaTranslation: e.target.value };
                        onUpdateTerminology(next);
                      }}
                      className="px-2 py-0.5 text-sm font-bangla font-semibold text-[#9A3412] bg-white border border-[#D6CFC5] rounded"
                    />
                    <span className="text-[11px] text-[#78716C]">
                      · {term.category}
                    </span>
                  </div>
                  {term.notes && (
                    <div className="text-[11px] text-[#57534E]">{term.notes}</div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateTerminology(terminology.filter((t) => t.id !== term.id))
                  }
                  aria-label={`Remove ${term.englishTerm}`}
                  className="p-1 text-[#78716C] hover:text-[#991B1B] cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
