import { GoogleGenAI, Type } from '@google/genai';
import type {
  CharacterMemoryItem,
  EditorialChange,
  ParagraphRefinementAction,
  StoryContextProfile,
  StyleProfile,
  TerminologyMemoryItem,
  TranslationStyleControls,
  VerificationReport,
} from './types';
import { formatMemoryPromptBlock, formatStyleDirectiveBlock } from './chunker';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please verify your API key in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const DEFAULT_MODEL = 'gemini-3.8-flash';

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries) {
        const delayMs = 800 * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Stage 1 — Literary Understanding & Memory Extraction
 */
export async function analyzeStoryUnderstanding(params: {
  text: string;
  projectTitle: string;
  genre: string;
  existingCharacters: CharacterMemoryItem[];
  existingTerminology: TerminologyMemoryItem[];
}): Promise<{
  storyContext: StoryContextProfile;
  extractedCharacters: CharacterMemoryItem[];
  extractedTerminology: TerminologyMemoryItem[];
}> {
  const ai = getGeminiClient();
  const existingMem = formatMemoryPromptBlock(
    params.existingCharacters,
    params.existingTerminology
  );

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Analyze the following English literary text from "${params.projectTitle}" (Genre: ${params.genre || 'Literary Fiction'}) for Stage 1 Literary Understanding prior to Bangla (বাংলা) literary translation.

EXISTING PROJECT MEMORY:
${existingMem}

SOURCE PASSAGE:
"""
${params.text.slice(0, 12000)}
"""

Identify:
1. Story summary, narrative timeline, important events, emotional context, literary tone, and key locations (with natural Bangla names).
2. Characters present in the passage, their relationships, pronouns/gender, personality, speaking style, and their natural Bangla name (respecting any existing character memory).
3. Recurring terminology, places, fictional locations, titles, special objects, or repeated expressions, with recommended natural literary Bangla equivalents.`,
      config: {
        systemInstruction:
          'You are a master Bengali literary scholar, novelist, and translator. Analyze English fiction deeply to prepare a faithful, culturally and emotionally resonant Bangla literary translation.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            storyContext: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                narrativeTimeline: { type: Type.STRING },
                importantEvents: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                emotionalContext: { type: Type.STRING },
                literaryTone: { type: Type.STRING },
                locations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      banglaName: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['name', 'banglaName', 'description'],
                  },
                },
              },
              required: [
                'summary',
                'narrativeTimeline',
                'importantEvents',
                'emotionalContext',
                'literaryTone',
                'locations',
              ],
            },
            characters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  englishName: { type: Type.STRING },
                  banglaName: { type: Type.STRING },
                  relationships: { type: Type.STRING },
                  pronouns: { type: Type.STRING },
                  personality: { type: Type.STRING },
                  speakingStyle: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
                required: [
                  'englishName',
                  'banglaName',
                  'relationships',
                  'pronouns',
                  'personality',
                  'speakingStyle',
                  'notes',
                ],
              },
            },
            terminology: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  englishTerm: { type: Type.STRING },
                  banglaTranslation: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    description: 'One of: name, place, title, object, fantasy, expression',
                  },
                  notes: { type: Type.STRING },
                },
                required: ['englishTerm', 'banglaTranslation', 'category', 'notes'],
              },
            },
          },
          required: ['storyContext', 'characters', 'terminology'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const validCategories = new Set(['name', 'place', 'title', 'object', 'fantasy', 'expression']);

  const extractedCharacters: CharacterMemoryItem[] = (parsed.characters || []).map(
    (c: Record<string, string>, idx: number) => ({
      id: `char-${Date.now()}-${idx}`,
      englishName: c.englishName || '',
      banglaName: c.banglaName || '',
      relationships: c.relationships || '',
      pronouns: c.pronouns || '',
      personality: c.personality || '',
      speakingStyle: c.speakingStyle || '',
      notes: c.notes || '',
    })
  );

  const extractedTerminology: TerminologyMemoryItem[] = (parsed.terminology || []).map(
    (t: Record<string, string>, idx: number) => ({
      id: `term-${Date.now()}-${idx}`,
      englishTerm: t.englishTerm || '',
      banglaTranslation: t.banglaTranslation || '',
      category: (validCategories.has(t.category) ? t.category : 'expression') as TerminologyMemoryItem['category'],
      notes: t.notes || '',
    })
  );

  return {
    storyContext: parsed.storyContext,
    extractedCharacters,
    extractedTerminology,
  };
}

/**
 * Stage 2 — Author Voice Analysis & Reusable Style Profile
 */
export async function analyzeAuthorVoice(params: {
  text: string;
  projectTitle: string;
  authorName: string;
  genre: string;
}): Promise<StyleProfile> {
  const ai = getGeminiClient();

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Analyze the original author's literary voice and writing style in the following passage from "${params.projectTitle}" by ${params.authorName || 'the author'} (Genre: ${params.genre || 'Literary'}).

Generate a comprehensive, reusable Style Profile that will guide our Bangla (বাংলা) literary translation so the translated story feels as though the original author wrote it natively in Bangla.

PASSAGE:
"""
${params.text.slice(0, 12000)}
"""`,
      config: {
        systemInstruction:
          'You are a distinguished comparative literature critic and Bangla literary translator. Analyze all ten stylistic dimensions of the English author’s voice and formulate a concrete Bangla adaptation strategy.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallVoice: {
              type: Type.STRING,
              description: 'Overall writing personality and literary voice',
            },
            sentenceStructure: {
              type: Type.STRING,
              description: 'Sentence structure, pacing, and rhythm',
            },
            vocabularyComplexity: {
              type: Type.STRING,
              description: 'Vocabulary complexity and diction choices',
            },
            narrativePerspective: {
              type: Type.STRING,
              description: 'Narrative perspective and point of view',
            },
            dialogueStyle: {
              type: Type.STRING,
              description: 'Dialogue style and character speech patterns',
            },
            emotionalIntensity: {
              type: Type.STRING,
              description: 'Emotional intensity and mode of expression',
            },
            descriptiveTechniques: {
              type: Type.STRING,
              description: 'Descriptive and atmospheric techniques',
            },
            metaphorsAndImagery: {
              type: Type.STRING,
              description: 'Use of metaphors, symbolism, imagery, and idioms',
            },
            literaryCharacteristics: {
              type: Type.STRING,
              description: 'Humor, sarcasm, suspense, romance, or other literary characteristics',
            },
            languageRegister: {
              type: Type.STRING,
              description:
                'Formal, informal, conversational, poetic, or traditional language tendencies (including recommended Bangla pronoun register like আপনি/তুমি/তুই)',
            },
            banglaAdaptationStrategy: {
              type: Type.STRING,
              description:
                'Concrete instructions on how to recreate this specific author’s voice in natural, fluent Bangla prose without sounding like a literal translation',
            },
          },
          required: [
            'overallVoice',
            'sentenceStructure',
            'vocabularyComplexity',
            'narrativePerspective',
            'dialogueStyle',
            'emotionalIntensity',
            'descriptiveTechniques',
            'metaphorsAndImagery',
            'literaryCharacteristics',
            'languageRegister',
            'banglaAdaptationStrategy',
          ],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    overallVoice: parsed.overallVoice || '',
    sentenceStructure: parsed.sentenceStructure || '',
    vocabularyComplexity: parsed.vocabularyComplexity || '',
    narrativePerspective: parsed.narrativePerspective || '',
    dialogueStyle: parsed.dialogueStyle || '',
    emotionalIntensity: parsed.emotionalIntensity || '',
    descriptiveTechniques: parsed.descriptiveTechniques || '',
    metaphorsAndImagery: parsed.metaphorsAndImagery || '',
    literaryCharacteristics: parsed.literaryCharacteristics || '',
    languageRegister: parsed.languageRegister || '',
    banglaAdaptationStrategy: parsed.banglaAdaptationStrategy || '',
    customNotes: '',
  };
}

/**
 * Stage 3 — Faithful Literary Translation (Chunk-Aware & Paragraph-Aligned)
 */
export async function translateChunkFaithfully(params: {
  paragraphs: string[];
  previousContextParagraphs: string[];
  styleProfile: StyleProfile | null;
  storyContext: StoryContextProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
}): Promise<string[]> {
  const ai = getGeminiClient();

  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatMemoryPromptBlock(params.characters, params.terminology);
  const contextSummary = params.storyContext
    ? `STORY CONTEXT:\nSummary: ${params.storyContext.summary}\nTone: ${params.storyContext.literaryTone}\nEmotional Context: ${params.storyContext.emotionalContext}`
    : '';

  const previousChunkSection =
    params.previousContextParagraphs.length > 0
      ? `\nPRECEDING PARAGRAPHS (FOR CONTINUITY ONLY — DO NOT TRANSLATE THESE AGAIN):\n${params.previousContextParagraphs
          .map((p, i) => `[Context ${i + 1}]: ${p}`)
          .join('\n')}\n`
      : '';

  const numberedSource = params.paragraphs
    .map((p, idx) => `[Paragraph ${idx}]:\n${p}`)
    .join('\n\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Translate the following ${params.paragraphs.length} English literary paragraphs into exceptionally natural, fluent, expressive Bangla (বাংলা).

${contextSummary}

${styleBlock}

${memoryBlock}
${previousChunkSection}
MANDATORY LITERARY TRANSLATION RULES:
1. Make the translated Bangla feel as though the story was originally written in Bangla by a gifted Bangla novelist, while preserving the original author's identity, voice, intentions, emotions, and storytelling style.
2. Avoid English sentence structures and awkward word-for-word calques. Reconstruct clauses naturally in idiomatic Bangla syntax.
3. Make dialogues sound like authentic, living Bangla conversations matching each character's personality and relationship register (আপনি / তুমি / তুই).
4. Preserve metaphors and sensory atmosphere, adapting expressions naturally when a literal translation would sound stiff.
5. Avoid unnecessary English words or awkward transliterations when natural Bangla words exist.
6. NEVER summarize, shorten, or omit any sentence, clause, description, or dialogue.
7. NEVER invent or add events, characters, or interpretations not present in the source.
8. Return EXACTLY ${params.paragraphs.length} translated Bangla paragraphs in the JSON array, corresponding 1-to-1 with [Paragraph 0] through [Paragraph ${params.paragraphs.length - 1}].

SOURCE PARAGRAPHS TO TRANSLATE:
${numberedSource}`,
      config: {
        systemInstruction:
          'You are GolpoTranslate’s Stage 3 Faithful Literary Translation Engine—an acclaimed Bengali literary translator who renders English fiction into living, soulful Bangla prose with 100% narrative fidelity.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translatedParagraphs: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                'Array of translated Bangla paragraphs matching the exact count and order of the input English paragraphs.',
            },
          },
          required: ['translatedParagraphs'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const output: string[] = Array.isArray(parsed.translatedParagraphs)
    ? parsed.translatedParagraphs
    : [];

  // Ensure exact 1-to-1 length alignment
  return params.paragraphs.map((_, idx) => (output[idx] ?? '').trim());
}

/**
 * Stage 4 — Literary Editing Pass
 */
export async function runLiteraryEditingPass(params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  styleProfile: StyleProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
}): Promise<{
  editedParagraphs: string[];
  editorialNotes: string[];
  editorialChanges: EditorialChange[];
}> {
  const ai = getGeminiClient();

  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatMemoryPromptBlock(params.characters, params.terminology);

  const pairedInput = params.englishParagraphs
    .map(
      (eng, idx) =>
        `[Paragraph ${idx}]\nORIGINAL ENGLISH: ${eng}\nDRAFT BANGLA: ${params.banglaParagraphs[idx] || ''}`
    )
    .join('\n\n---\n\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Run Stage 4 Literary Editing on the following Bangla translation draft.

${styleBlock}

${memoryBlock}

EDITORIAL OBJECTIVES:
- Elevate sentence flow, reading rhythm (ছন্দ ও প্রবাহ), and naturalness so no trace of clunky translationese ("আক্ষরিক অনুবাদ-গন্ধ") remains.
- Refine word choices (শব্দচয়ন) and paragraph transitions.
- Polish dialogue so it sounds unmistakably like real spoken Bangla matching the characters' relationships.
- Ensure strict consistency with Character Memory, Terminology Memory, and the original author's voice.
- CRITICAL: Do NOT rewrite the story freely. Never alter the author's meaning, omit details, or add unsupported content.
- Return EXACTLY ${params.englishParagraphs.length} polished Bangla paragraphs in order, along with a summary of editorial improvements.

MANUSCRIPT PAIRS:
${pairedInput}`,
      config: {
        systemInstruction:
          'You are GolpoTranslate’s Chief Literary Editor for Bangla Fiction. You polish translated Bangla prose to literary perfection while guarding 100% fidelity to the English source.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            editedParagraphs: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            editorialNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            editorialChanges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  paragraphIndex: { type: Type.INTEGER },
                  aspect: { type: Type.STRING },
                  beforeSnippet: { type: Type.STRING },
                  afterSnippet: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: [
                  'paragraphIndex',
                  'aspect',
                  'beforeSnippet',
                  'afterSnippet',
                  'rationale',
                ],
              },
            },
          },
          required: ['editedParagraphs', 'editorialNotes', 'editorialChanges'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const edited: string[] = Array.isArray(parsed.editedParagraphs)
    ? parsed.editedParagraphs
    : [];

  return {
    editedParagraphs: params.englishParagraphs.map(
      (_, idx) => (edited[idx] || params.banglaParagraphs[idx] || '').trim()
    ),
    editorialNotes: Array.isArray(parsed.editorialNotes) ? parsed.editorialNotes : [],
    editorialChanges: Array.isArray(parsed.editorialChanges) ? parsed.editorialChanges : [],
  };
}

/**
 * Stage 5 — Accuracy Verification
 */
export async function verifyTranslationAccuracy(params: {
  englishParagraphs: string[];
  banglaParagraphs: string[];
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
}): Promise<VerificationReport> {
  const ai = getGeminiClient();
  const memoryBlock = formatMemoryPromptBlock(params.characters, params.terminology);

  const pairedText = params.englishParagraphs
    .map(
      (eng, idx) =>
        `[Paragraph ${idx}]\nENGLISH: ${eng}\nBANGLA: ${params.banglaParagraphs[idx] || '[MISSING]'}`
    )
    .join('\n\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Compare the Original English text against the Final Bangla Translation for Stage 5 Accuracy Verification.

${memoryBlock}

Audit every paragraph for:
1. Missing sentences or paragraphs
2. Omitted dialogue
3. Added or hallucinated information
4. Changed meanings
5. Incorrect character references or pronoun mismatches
6. Inconsistent names or terminology (compared to Established Memory)
7. Changes in emotional intent
8. Inaccurate descriptions or distorted chronology

Present only genuine, significant issues for human review. If the translation is faithful, complete, and accurate, return an empty issues array and a high overallScore (95-100).

MANUSCRIPT COMPARISON:
${pairedText}`,
      config: {
        systemInstruction:
          'You are a meticulous bilingual literary auditor verifying English-to-Bangla translation fidelity.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: {
              type: Type.INTEGER,
              description: 'Fidelity score from 0 to 100',
            },
            fidelitySummary: {
              type: Type.STRING,
              description: 'Concise assessment of translation completeness, voice fidelity, and accuracy',
            },
            isComplete: {
              type: Type.BOOLEAN,
              description: 'True if no paragraphs or sentences are missing',
            },
            issues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: {
                    type: Type.STRING,
                    description: 'high, medium, or low',
                  },
                  type: {
                    type: Type.STRING,
                    description:
                      'One of: missing_content, omitted_dialogue, added_info, changed_meaning, character_reference, terminology, emotional_intent, chronology',
                  },
                  paragraphIndex: { type: Type.INTEGER },
                  description: { type: Type.STRING },
                  englishExcerpt: { type: Type.STRING },
                  banglaExcerpt: { type: Type.STRING },
                  suggestedFix: {
                    type: Type.STRING,
                    description: 'Suggested revised full Bangla paragraph if an issue exists',
                  },
                },
                required: [
                  'severity',
                  'type',
                  'paragraphIndex',
                  'description',
                  'englishExcerpt',
                  'banglaExcerpt',
                  'suggestedFix',
                ],
              },
            },
          },
          required: ['overallScore', 'fidelitySummary', 'isComplete', 'issues'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const validTypes = new Set([
    'missing_content',
    'omitted_dialogue',
    'added_info',
    'changed_meaning',
    'character_reference',
    'terminology',
    'emotional_intent',
    'chronology',
  ]);

  return {
    overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 95,
    fidelitySummary:
      parsed.fidelitySummary || 'Verification completed successfully.',
    isComplete: Boolean(parsed.isComplete ?? true),
    checkedAt: new Date().toISOString(),
    issues: (parsed.issues || []).map(
      (issue: Record<string, unknown>, idx: number) => ({
        id: `issue-${Date.now()}-${idx}`,
        severity:
          issue.severity === 'high' || issue.severity === 'medium' ? issue.severity : 'low',
        type: validTypes.has(String(issue.type))
          ? (String(issue.type) as VerificationReport['issues'][0]['type'])
          : 'changed_meaning',
        paragraphIndex:
          typeof issue.paragraphIndex === 'number' ? issue.paragraphIndex : 0,
        description: String(issue.description || ''),
        englishExcerpt: String(issue.englishExcerpt || ''),
        banglaExcerpt: String(issue.banglaExcerpt || ''),
        suggestedFix: String(issue.suggestedFix || ''),
        resolved: false,
      })
    ),
  };
}

/**
 * Paragraph-Level Targeted Refinement (Never replaces the full chapter; refines strictly the selected paragraph)
 */
export async function refineSingleParagraph(params: {
  englishParagraph: string;
  currentBanglaParagraph: string;
  previousEnglishParagraph?: string;
  nextEnglishParagraph?: string;
  action: ParagraphRefinementAction;
  customInstruction?: string;
  styleProfile: StyleProfile | null;
  characters: CharacterMemoryItem[];
  terminology: TerminologyMemoryItem[];
  styleControls: TranslationStyleControls;
}): Promise<{
  refinedBangla: string;
  rationale: string;
}> {
  const ai = getGeminiClient();
  const styleBlock = formatStyleDirectiveBlock(params.styleProfile, params.styleControls);
  const memoryBlock = formatMemoryPromptBlock(params.characters, params.terminology);

  const actionInstructions: Record<ParagraphRefinementAction, string> = {
    more_natural:
      'Make the Bangla translation read with effortless, idiomatic, native Bangla flow (অত্যন্ত স্বাভাবিক ও সাবলীল বাংলা). Remove any trace of English sentence order while keeping every detail intact.',
    improve_literary:
      'Elevate the literary beauty, cadence, and evocative diction (সাহিত্যিক মাধুর্য ও নান্দনিক প্রকাশভঙ্গি) in Bangla without adding any unstated facts or overwriting the author’s intent.',
    conversational_dialogue:
      'Make the dialogue and character expressions sound like authentic, natural spoken Bangla conversation (জীবন্ত ও স্বাভাবিক কথোপকথন), respecting character relationships and pronouns.',
    simpler_language:
      'Make the Bangla vocabulary simpler, clearer, and more effortlessly readable (সহজ, প্রাঞ্জল ও সুখপাঠ্য ভাষা) while keeping the emotional depth and full meaning.',
    more_expressive:
      'Deepen the emotional resonance, sensory atmosphere, and expressive power (আবেগ ও ভাবের গভীরতা) of the Bangla phrasing while remaining 100% faithful to the original paragraph.',
    match_author_style:
      'Re-translate and align this paragraph closely with the original author’s signature voice, sentence rhythm, and tone defined in the Style Profile.',
  };

  const specificDirective = actionInstructions[params.action];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Refine ONLY the target Bangla paragraph below according to the requested editorial action.

REQUESTED ACTION: ${specificDirective}
${params.customInstruction ? `ADDITIONAL USER NOTE: ${params.customInstruction}` : ''}

${styleBlock}

${memoryBlock}

SURROUNDING CONTEXT (FOR REFERENCE ONLY):
Preceding English Paragraph: ${params.previousEnglishParagraph || '[Start of chapter]'}
Following English Paragraph: ${params.nextEnglishParagraph || '[End of chapter]'}

TARGET PARAGRAPH TO REFINE:
ORIGINAL ENGLISH:
"""
${params.englishParagraph}
"""

CURRENT BANGLA TRANSLATION:
"""
${params.currentBanglaParagraph}
"""

Provide the improved Bangla paragraph and a brief 1-sentence explanation of how the phrasing was improved.`,
      config: {
        systemInstruction:
          'You are a master Bengali literary translator refining a single paragraph in a manuscript. Preserve 100% of the original meaning while fulfilling the specific stylistic directive.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            refinedBangla: {
              type: Type.STRING,
              description: 'The revised Bangla paragraph',
            },
            rationale: {
              type: Type.STRING,
              description: 'Concise explanation of the stylistic and lexical improvements made',
            },
          },
          required: ['refinedBangla', 'rationale'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    refinedBangla: (parsed.refinedBangla || params.currentBanglaParagraph).trim(),
    rationale: parsed.rationale || 'Refined paragraph flow and Bangla literary expression.',
  };
}
