'use client';

import React from 'react';
import { Sparkles, Sliders } from 'lucide-react';
import type {
  StyleProfile,
  TranslationStyleControls,
} from '@/lib/types';

interface VoiceAndControlsPanelProps {
  styleProfile: StyleProfile | null;
  styleControls: TranslationStyleControls;
  isRunningStage2: boolean;
  onRunStage2: () => void;
  onUpdateStyleProfile: (updated: StyleProfile) => void;
  onUpdateStyleControls: (updated: TranslationStyleControls) => void;
}

const EMPTY_STYLE_PROFILE: StyleProfile = {
  overallVoice: '',
  sentenceStructure: '',
  vocabularyComplexity: '',
  narrativePerspective: '',
  dialogueStyle: '',
  emotionalIntensity: '',
  descriptiveTechniques: '',
  metaphorsAndImagery: '',
  literaryCharacteristics: '',
  languageRegister: '',
  banglaAdaptationStrategy: '',
  customNotes: '',
};

export default function VoiceAndControlsPanel({
  styleProfile,
  styleControls,
  isRunningStage2,
  onRunStage2,
  onUpdateStyleProfile,
  onUpdateStyleControls,
}: VoiceAndControlsPanelProps) {
  const currentProfile = styleProfile || EMPTY_STYLE_PROFILE;

  const handleFieldChange = (field: keyof StyleProfile, value: string) => {
    onUpdateStyleProfile({
      ...currentProfile,
      [field]: value,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Left 7 Cols: Author Voice & Reusable Style Profile */}
      <div className="lg:col-span-7 bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D8] pb-4">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
              Author Voice & Style Profile
            </h3>
            <p className="text-xs text-[#57534E]">
              Reusable project-level literary voice analysis that guides all chapter translations and edits
            </p>
          </div>

          <button
            type="button"
            onClick={onRunStage2}
            disabled={isRunningStage2}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isRunningStage2
                ? 'Analyzing Author Voice...'
                : styleProfile
                  ? 'Re-Analyze Author Voice (Stage 2)'
                  : 'Generate Style Profile (Stage 2)'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Overall Writing Personality & Literary Voice
            </label>
            <textarea
              rows={3}
              value={currentProfile.overallVoice}
              onChange={(e) => handleFieldChange('overallVoice', e.target.value)}
              placeholder="Run Stage 2 Analysis or describe the author's literary personality..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Sentence Structure & Rhythm
            </label>
            <textarea
              rows={3}
              value={currentProfile.sentenceStructure}
              onChange={(e) => handleFieldChange('sentenceStructure', e.target.value)}
              placeholder="Pacing, clause cadence, short vs. flowing sentences..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Vocabulary Complexity
            </label>
            <textarea
              rows={3}
              value={currentProfile.vocabularyComplexity}
              onChange={(e) => handleFieldChange('vocabularyComplexity', e.target.value)}
              placeholder="Diction level, specialized or lyrical vocabulary..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Narrative Perspective & Point of View
            </label>
            <textarea
              rows={3}
              value={currentProfile.narrativePerspective}
              onChange={(e) => handleFieldChange('narrativePerspective', e.target.value)}
              placeholder="First-person, close third-person, omniscient..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Dialogue Style & Character Speech Patterns
            </label>
            <textarea
              rows={3}
              value={currentProfile.dialogueStyle}
              onChange={(e) => handleFieldChange('dialogueStyle', e.target.value)}
              placeholder="Subtext, banter, formality, regional cadence..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Emotional Intensity & Expression
            </label>
            <textarea
              rows={3}
              value={currentProfile.emotionalIntensity}
              onChange={(e) => handleFieldChange('emotionalIntensity', e.target.value)}
              placeholder="Restrained, simmering, visceral, intimate..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Descriptive & Atmospheric Techniques
            </label>
            <textarea
              rows={3}
              value={currentProfile.descriptiveTechniques}
              onChange={(e) => handleFieldChange('descriptiveTechniques', e.target.value)}
              placeholder="Sensory grounding, lighting, weather, mood..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Metaphors, Symbolism, Imagery & Idioms
            </label>
            <textarea
              rows={3}
              value={currentProfile.metaphorsAndImagery}
              onChange={(e) => handleFieldChange('metaphorsAndImagery', e.target.value)}
              placeholder="Recurring motifs, figurative language..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Humor, Suspense, Romance & Literary Characteristics
            </label>
            <textarea
              rows={3}
              value={currentProfile.literaryCharacteristics}
              onChange={(e) => handleFieldChange('literaryCharacteristics', e.target.value)}
              placeholder="Irony, tension pacing, romantic warmth..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Language Register & Pronoun Tendencies (প্রমিত / চলিত / কথ্য রীতি)
            </label>
            <textarea
              rows={3}
              value={currentProfile.languageRegister}
              onChange={(e) => handleFieldChange('languageRegister', e.target.value)}
              placeholder="Formal, conversational, poetic, pronoun guidelines (আপনি/তুমি/তুই)..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#9A3412] mb-1">
              Bangla Adaptation Strategy (বাংলা রূপান্তর নির্দেশিকা)
            </label>
            <textarea
              rows={3}
              value={currentProfile.banglaAdaptationStrategy}
              onChange={(e) => handleFieldChange('banglaAdaptationStrategy', e.target.value)}
              placeholder="How the AI should recreate this author's style in natural literary Bangla..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#1C1917] mb-1">
              Custom Translator Instructions (Optional Override)
            </label>
            <input
              type="text"
              value={currentProfile.customNotes}
              onChange={(e) => handleFieldChange('customNotes', e.target.value)}
              placeholder="Add any specific Bangla stylistic rules you want enforced across all chapters..."
              className="w-full p-2.5 text-xs bg-[#FAF8F5] border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
            />
          </div>
        </div>
      </div>

      {/* Right 5 Cols: 6 Translation Style Controls */}
      <div className="lg:col-span-5 bg-white border border-[#E5E0D8] rounded-xl p-6 space-y-5 h-fit">
        <div className="border-b border-[#E5E0D8] pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#9A3412]" />
            <h3 className="font-display text-2xl font-semibold text-[#1C1917]">
              Translation Style Controls
            </h3>
          </div>
          <p className="text-xs text-[#57534E] mt-0.5">
            Fine-tune how the Style Profile is expressed in Bangla without altering the original meaning
          </p>
        </div>

        <div className="space-y-4">
          {/* 1. Preserve original author's style */}
          <label className="flex items-start gap-3 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] cursor-pointer">
            <input
              type="checkbox"
              checked={styleControls.preserveAuthorStyle}
              onChange={(e) =>
                onUpdateStyleControls({
                  ...styleControls,
                  preserveAuthorStyle: e.target.checked,
                })
              }
              className="mt-1 accent-[#9A3412]"
            />
            <div>
              <div className="text-xs font-semibold text-[#1C1917]">
                1. Preserve Original Author&apos;s Style
              </div>
              <div className="text-[11px] text-[#57534E] mt-0.5">
                Default ON. Uses the Author Style Profile to mirror sentence rhythm, tone, and literary personality.
              </div>
            </div>
          </label>

          {/* 2. Naturalness */}
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              2. Naturalness
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#F3EFEA] rounded-lg border border-[#E5E0D8]">
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({ ...styleControls, naturalness: 'balanced' })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.naturalness === 'balanced'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Balanced
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({ ...styleControls, naturalness: 'highly_natural' })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.naturalness === 'highly_natural'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Highly Natural
              </button>
            </div>
          </div>

          {/* 3. Literary Expression */}
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              3. Literary Expression
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#F3EFEA] rounded-lg border border-[#E5E0D8]">
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({ ...styleControls, literaryExpression: 'subtle' })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.literaryExpression === 'subtle'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Subtle
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({ ...styleControls, literaryExpression: 'rich' })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.literaryExpression === 'rich'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Rich
              </button>
            </div>
          </div>

          {/* 4. Language Complexity */}
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              4. Language Complexity
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#F3EFEA] rounded-lg border border-[#E5E0D8]">
              {(['simple', 'moderate', 'advanced'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() =>
                    onUpdateStyleControls({ ...styleControls, languageComplexity: level })
                  }
                  className={`py-1.5 px-2 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                    styleControls.languageComplexity === level
                      ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                      : 'text-[#57534E]'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Dialogue */}
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              5. Dialogue Treatment
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#F3EFEA] rounded-lg border border-[#E5E0D8]">
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({ ...styleControls, dialogueStyle: 'faithful' })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.dialogueStyle === 'faithful'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Faithful
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({
                    ...styleControls,
                    dialogueStyle: 'more_conversational',
                  })
                }
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  styleControls.dialogueStyle === 'more_conversational'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                More Conversational
              </button>
            </div>
          </div>

          {/* 6. Translation Approach */}
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              6. Translation Approach
            </label>
            <div className="grid grid-cols-1 gap-1.5 p-1 bg-[#F3EFEA] rounded-lg border border-[#E5E0D8]">
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({
                    ...styleControls,
                    translationApproach: 'faithful_literary',
                  })
                }
                className={`py-2 px-3 text-xs font-medium rounded-md text-left transition-colors cursor-pointer ${
                  styleControls.translationApproach === 'faithful_literary'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                Faithful Literary Translation
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateStyleControls({
                    ...styleControls,
                    translationApproach: 'expressive_adaptation',
                  })
                }
                className={`py-2 px-3 text-xs font-medium rounded-md text-left transition-colors cursor-pointer ${
                  styleControls.translationApproach === 'expressive_adaptation'
                    ? 'bg-white text-[#1C1917] font-semibold shadow-2xs'
                    : 'text-[#57534E]'
                }`}
              >
                More Expressive Adaptation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
