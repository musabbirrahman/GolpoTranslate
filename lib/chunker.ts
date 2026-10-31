import type {
  CharacterMemoryItem,
  Chapter,
  ParagraphPair,
  StyleProfile,
  TerminologyMemoryItem,
  TranslationProject,
  TranslationStyleControls,
} from './types';

export interface TextChunk {
  chunkIndex: number;
  paragraphs: string[];
  startParagraphIndex: number;
  endParagraphIndex: number;
  wordCount: number;
  previousContextParagraphs: string[];
}

/**
 * Splits raw English manuscript text into clean non-empty paragraphs,
 * preserving paragraph order and never splitting sentences or dialogue mid-paragraph.
 */
export function splitIntoParagraphs(text: string): string[] {
  if (!text || !text.trim()) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Counts words in a string accurately.
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Chunks an array of paragraphs into manageable blocks at paragraph boundaries.
 * Never cuts a paragraph, sentence, or dialogue in half.
 * Passes the last `contextWindow` paragraphs of the preceding chunk for continuity.
 */
export function chunkTextByParagraphs(
  text: string,
  maxWordsPerChunk = 500,
  contextWindow = 2
): TextChunk[] {
  const allParagraphs = splitIntoParagraphs(text);
  if (allParagraphs.length === 0) return [];

  const effectiveMaxWords = Math.max(100, maxWordsPerChunk);
  const chunks: TextChunk[] = [];

  let currentParagraphs: string[] = [];
  let currentWordCount = 0;
  let chunkStartIdx = 0;

  for (let i = 0; i < allParagraphs.length; i++) {
    const para = allParagraphs[i];
    const paraWords = countWords(para);

    if (
      currentParagraphs.length > 0 &&
      currentWordCount + paraWords > effectiveMaxWords
    ) {
      const prevStart = Math.max(0, chunkStartIdx - contextWindow);
      const previousContextParagraphs = allParagraphs.slice(prevStart, chunkStartIdx);

      chunks.push({
        chunkIndex: chunks.length,
        paragraphs: currentParagraphs,
        startParagraphIndex: chunkStartIdx,
        endParagraphIndex: i - 1,
        wordCount: currentWordCount,
        previousContextParagraphs,
      });

      currentParagraphs = [para];
      currentWordCount = paraWords;
      chunkStartIdx = i;
    } else {
      currentParagraphs.push(para);
      currentWordCount += paraWords;
    }
  }

  if (currentParagraphs.length > 0) {
    const prevStart = Math.max(0, chunkStartIdx - contextWindow);
    const previousContextParagraphs = allParagraphs.slice(prevStart, chunkStartIdx);

    chunks.push({
      chunkIndex: chunks.length,
      paragraphs: currentParagraphs,
      startParagraphIndex: chunkStartIdx,
      endParagraphIndex: allParagraphs.length - 1,
      wordCount: currentWordCount,
      previousContextParagraphs,
    });
  }

  return chunks;
}

/**
 * Safely assembles translated chunks into a complete paragraph list and full Bangla manuscript,
 * preventing boundary duplication if the model accidentally echoed a context paragraph.
 */
export function assembleTranslatedChunks(
  englishParagraphs: string[],
  translatedChunkParagraphs: string[][]
): { pairs: ParagraphPair[]; fullBanglaText: string } {
  const flatBangla: string[] = [];

  for (let c = 0; c < translatedChunkParagraphs.length; c++) {
    const chunkParas = translatedChunkParagraphs[c] || [];
    for (let p = 0; p < chunkParas.length; p++) {
      const cleaned = chunkParas[p].trim();
      if (!cleaned) continue;
      // Duplicate prevention at chunk boundary
      if (
        p === 0 &&
        flatBangla.length > 0 &&
        flatBangla[flatBangla.length - 1] === cleaned
      ) {
        continue;
      }
      flatBangla.push(cleaned);
    }
  }

  const pairs: ParagraphPair[] = englishParagraphs.map((eng, idx) => ({
    index: idx,
    englishText: eng,
    banglaText: flatBangla[idx] ?? '',
  }));

  const fullBanglaText = pairs
    .map((p) => p.banglaText)
    .filter((t) => t.length > 0)
    .join('\n\n');

  return { pairs, fullBanglaText };
}

/**
 * Aligns raw English text and raw Bangla text into ParagraphPair items.
 */
export function alignParagraphs(
  englishText: string,
  banglaText: string,
  existingPairs?: ParagraphPair[]
): ParagraphPair[] {
  const engParas = splitIntoParagraphs(englishText);
  const bnParas = splitIntoParagraphs(banglaText);

  return engParas.map((eng, index) => {
    const existing = existingPairs?.[index];
    return {
      index,
      englishText: eng,
      banglaText: bnParas[index] ?? existing?.banglaText ?? '',
      previousBanglaText: existing?.previousBanglaText,
      lastRefinementAction: existing?.lastRefinementAction,
      refinementRationale: existing?.refinementRationale,
    };
  });
}

/**
 * Automatically detects chapter headings in a long manuscript ("Chapter 1", "CHAPTER I", etc.)
 * or returns a single chapter if no explicit chapter markers exist.
 */
export function splitManuscriptIntoChapters(
  rawText: string,
  defaultTitle = 'Chapter 1'
): Array<{ title: string; content: string }> {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chapterRegex = /^(?:CHAPTER|Chapter|অধ্যায়)\s+(?:[0-9]+|[IVXLCDM]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)(?:[:.\s—–-].*)?$/gm;
  const matches = [...normalized.matchAll(chapterRegex)];

  if (matches.length <= 1) {
    return [{ title: matches[0]?.[0]?.trim() || defaultTitle, content: normalized }];
  }

  const result: Array<{ title: string; content: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const startIdx = currentMatch.index ?? 0;
    const headingLine = currentMatch[0].trim();
    const contentStart = startIdx + currentMatch[0].length;
    const endIdx =
      i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length;

    const body = normalized.slice(contentStart, endIdx).trim();
    if (body.length > 0) {
      result.push({
        title: headingLine,
        content: body,
      });
    }
  }

  return result.length > 0 ? result : [{ title: defaultTitle, content: normalized }];
}

/**
 * Formats Character Memory and Terminology Memory into an authoritative instruction block
 * for Gemini translation and editing calls.
 */
export function formatMemoryPromptBlock(
  characters: CharacterMemoryItem[],
  terminology: TerminologyMemoryItem[]
): string {
  const lines: string[] = [];

  if (characters.length > 0) {
    lines.push('ESTABLISHED CHARACTER MEMORY (MUST RESPECT EXACT BANGLA NAMES & SPEAKING STYLES):');
    for (const c of characters) {
      lines.push(
        `- ${c.englishName} → বাংলা নাম: "${c.banglaName}" | Pronouns/Gender: ${c.pronouns || 'As in context'} | Relationships: ${c.relationships || 'N/A'} | Personality & Speech: ${c.personality}; ${c.speakingStyle}${c.notes ? ` (${c.notes})` : ''}`
      );
    }
  }

  if (terminology.length > 0) {
    lines.push('\nESTABLISHED TERMINOLOGY & GLOSSARY MEMORY (USE THESE EXACT BANGLA TRANSLATIONS):');
    for (const t of terminology) {
      lines.push(
        `- "${t.englishTerm}" (${t.category}) → "${t.banglaTranslation}"${t.notes ? ` — Note: ${t.notes}` : ''}`
      );
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No prior character or terminology overrides established yet.';
}

/**
 * Formats Style Profile and Style Controls into an adaptive literary directive.
 */
export function formatStyleDirectiveBlock(
  styleProfile: StyleProfile | null,
  controls: TranslationStyleControls
): string {
  const directives: string[] = [];

  if (styleProfile && controls.preserveAuthorStyle) {
    directives.push(`AUTHOR VOICE & STYLE PROFILE (ADAPT BANGLA TO MIRROR THIS VOICE):
- Overall Literary Voice: ${styleProfile.overallVoice}
- Sentence Structure & Rhythm: ${styleProfile.sentenceStructure}
- Vocabulary Complexity: ${styleProfile.vocabularyComplexity}
- Narrative Perspective (POV): ${styleProfile.narrativePerspective}
- Dialogue Style & Speech Patterns: ${styleProfile.dialogueStyle}
- Emotional Intensity: ${styleProfile.emotionalIntensity}
- Descriptive & Atmospheric Techniques: ${styleProfile.descriptiveTechniques}
- Metaphors, Symbolism & Imagery: ${styleProfile.metaphorsAndImagery}
- Literary Characteristics: ${styleProfile.literaryCharacteristics}
- Language Register: ${styleProfile.languageRegister}
- Bangla Adaptation Strategy: ${styleProfile.banglaAdaptationStrategy}
${styleProfile.customNotes ? `- Translator Custom Direction: ${styleProfile.customNotes}` : ''}`);
  }

  directives.push(`TRANSLATION STYLE CONTROLS:
- Preserve Original Author's Style: ${controls.preserveAuthorStyle ? 'ON (Strict adherence to authorial voice)' : 'OFF (Standard literary Bangla)'}
- Bangla Naturalness: ${controls.naturalness === 'highly_natural' ? 'Highly Natural (Idiomatic, native-born Bangla flow; zero English syntax residue)' : 'Balanced (Natural Bangla while staying close to source phrasing structure)'}
- Literary Expression: ${controls.literaryExpression === 'rich' ? 'Rich & Evocative (Deep literary resonance and expressive Bangla diction)' : 'Subtle & Restrained (Understated, clean literary prose)'}
- Language Complexity: ${controls.languageComplexity.toUpperCase()}
- Dialogue Treatment: ${controls.dialogueStyle === 'more_conversational' ? 'More Conversational (Authentic spoken Bangla cadence and natural colloquial phrasing in dialogue)' : 'Faithful (Closely mirrors original dialogue register)'}
- Translation Approach: ${controls.translationApproach === 'expressive_adaptation' ? 'More Expressive Adaptation (Adapt idioms and cadence creatively so it reads as originally composed in Bangla, without altering plot or meaning)' : 'Faithful Literary Translation (Creative yet closely anchored to every nuance of the original text)'}`);

  return directives.join('\n\n');
}

/**
 * Exports a single chapter's Bangla translation as clean TXT.
 */
export function formatChapterExport(projectTitle: string, chapter: Chapter): string {
  const header = `${projectTitle}\n${chapter.title}\n${'—'.repeat(40)}\n\n`;
  const body =
    chapter.paragraphs.length > 0
      ? chapter.paragraphs.map((p) => p.banglaText || '[অনুবাদ বাকি]').join('\n\n')
      : chapter.translatedText;
  return `${header}${body.trim()}\n`;
}

/**
 * Exports the entire translated story across all chapters as a unified Bangla TXT manuscript.
 */
export function formatFullStoryExport(project: TranslationProject): string {
  const header = `${project.title}\nমূল লেখক: ${project.authorName || 'অজ্ঞাত'}\nGolpoTranslate সাহিত্য অনুবাদ স্টুডিও\n${'═'.repeat(48)}\n\n`;
  const chaptersText = project.chapters
    .map((ch) => {
      const body =
        ch.paragraphs.length > 0
          ? ch.paragraphs.map((p) => p.banglaText || '').filter(Boolean).join('\n\n')
          : ch.translatedText.trim();
      return `${ch.title}\n${'─'.repeat(30)}\n\n${body || '[এই অধ্যায়টি এখনও অনূদিত হয়নি]'}`;
    })
    .join('\n\n\n');

  return `${header}${chaptersText}\n`;
}

/**
 * Exports a bilingual side-by-side / paragraph-aligned manuscript with Original English and Translated Bangla separated clearly.
 */
export function formatBilingualExport(project: TranslationProject): string {
  const lines: string[] = [
    `PROJECT: ${project.title}`,
    `ORIGINAL AUTHOR: ${project.authorName || 'Unknown'}`,
    `GENRE: ${project.genre || 'Literary Fiction'}`,
    `SOURCE: ${project.sourceLanguage} -> TARGET: ${project.targetLanguage}`,
    '====================================================================',
    '',
  ];

  for (const ch of project.chapters) {
    lines.push(`CHAPTER ${ch.number}: ${ch.title}`);
    lines.push('--------------------------------------------------------------------');
    lines.push('');
    lines.push('--- [ORIGINAL ENGLISH] ---');
    lines.push(ch.originalText.trim());
    lines.push('');
    lines.push('--- [TRANSLATED BANGLA (বাংলা অনুবাদ)] ---');
    const banglaBody =
      ch.paragraphs.length > 0
        ? ch.paragraphs.map((p) => p.banglaText).filter(Boolean).join('\n\n')
        : ch.translatedText.trim();
    lines.push(banglaBody || '[Translation Pending]');
    lines.push('');
    lines.push('====================================================================');
    lines.push('');
  }

  return lines.join('\n');
}
