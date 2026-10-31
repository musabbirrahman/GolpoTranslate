import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitIntoParagraphs,
  countWords,
  chunkTextByParagraphs,
  assembleTranslatedChunks,
  alignParagraphs,
  splitManuscriptIntoChapters,
  formatMemoryPromptBlock,
  formatChapterExport,
} from './chunker';
import type { CharacterMemoryItem, TerminologyMemoryItem, Chapter } from './types';

test('splitIntoParagraphs preserves paragraph order and ignores blank lines', () => {
  const input = 'First paragraph of the story.\n\n\nSecond paragraph with "dialogue inside it."\r\n\r\nThird paragraph.';
  const paras = splitIntoParagraphs(input);
  assert.equal(paras.length, 3);
  assert.equal(paras[0], 'First paragraph of the story.');
  assert.equal(paras[1], 'Second paragraph with "dialogue inside it."');
  assert.equal(paras[2], 'Third paragraph.');
});

test('chunkTextByParagraphs splits at paragraph boundaries and passes sliding context', () => {
  const p1 = Array(60).fill('word').join(' ');
  const p2 = Array(60).fill('story').join(' ');
  const p3 = Array(60).fill('novel').join(' ');
  const text = `${p1}\n\n${p2}\n\n${p3}`;

  const chunks = chunkTextByParagraphs(text, 120, 1);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].paragraphs.length, 2);
  assert.equal(chunks[0].startParagraphIndex, 0);
  assert.equal(chunks[0].endParagraphIndex, 1);
  assert.equal(chunks[0].previousContextParagraphs.length, 0);

  assert.equal(chunks[1].paragraphs.length, 1);
  assert.equal(chunks[1].startParagraphIndex, 2);
  assert.equal(chunks[1].endParagraphIndex, 2);
  assert.equal(chunks[1].previousContextParagraphs.length, 1);
  assert.equal(chunks[1].previousContextParagraphs[0], p2);
});

test('assembleTranslatedChunks combines chunks and prevents boundary duplication', () => {
  const english = ['English one.', 'English two.', 'English three.'];
  const translatedChunks = [
    ['বাংলা এক।', 'বাংলা দুই।'],
    ['বাংলা দুই।', 'বাংলা তিন।'], // simulated accidental echo of boundary paragraph
  ];

  const { pairs, fullBanglaText } = assembleTranslatedChunks(english, translatedChunks);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].banglaText, 'বাংলা এক।');
  assert.equal(pairs[1].banglaText, 'বাংলা দুই।');
  assert.equal(pairs[2].banglaText, 'বাংলা তিন।');
  assert.equal(fullBanglaText, 'বাংলা এক।\n\nবাংলা দুই।\n\nবাংলা তিন।');
});

test('alignParagraphs preserves refinement metadata when updating paragraphs', () => {
  const eng = 'Para 1.\n\nPara 2.';
  const bn = 'অনুবাদ ১।\n\nঅনুবাদ ২।';
  const initial = alignParagraphs(eng, bn);
  initial[0].previousBanglaText = 'পুরাতন অনুবাদ ১।';
  initial[0].lastRefinementAction = 'more_natural';

  const updated = alignParagraphs(eng, 'নতুন অনুবাদ ১।\n\nঅনুবাদ ২।', initial);
  assert.equal(updated[0].banglaText, 'নতুন অনুবাদ ১।');
  assert.equal(updated[0].previousBanglaText, 'পুরাতন অনুবাদ ১।');
  assert.equal(updated[0].lastRefinementAction, 'more_natural');
});

test('splitManuscriptIntoChapters detects multi-chapter headings cleanly', () => {
  const raw = `Chapter 1: The Monsoon Arrives\nThe rain began at dusk.\n\nChapter 2: The Lantern on the Ghat\nShe held the brass lamp steady.`;
  const chapters = splitManuscriptIntoChapters(raw);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter 1: The Monsoon Arrives');
  assert.equal(chapters[0].content, 'The rain began at dusk.');
  assert.equal(chapters[1].title, 'Chapter 2: The Lantern on the Ghat');
  assert.equal(chapters[1].content, 'She held the brass lamp steady.');
});

test('formatMemoryPromptBlock includes both character and terminology rules', () => {
  const chars: CharacterMemoryItem[] = [
    {
      id: 'c1',
      englishName: 'Eleanor Vance',
      banglaName: 'এলিনর ভ্যান্স',
      relationships: 'Protagonist',
      pronouns: 'She/Her (সে/তার)',
      personality: 'Introspective',
      speakingStyle: 'Soft, hesitant cadence',
      notes: 'Uses তুমির পরিবর্তে আপনি with strangers',
    },
  ];
  const terms: TerminologyMemoryItem[] = [
    {
      id: 't1',
      englishTerm: 'Glass Citadel',
      banglaTranslation: 'কাঁচদুর্গ',
      category: 'fantasy',
      notes: 'Capital fortress',
    },
  ];

  const prompt = formatMemoryPromptBlock(chars, terms);
  assert.ok(prompt.includes('এলিনর ভ্যান্স'));
  assert.ok(prompt.includes('কাঁচদুর্গ'));
});

test('formatChapterExport outputs clean Bangla manuscript text', () => {
  const chapter: Chapter = {
    id: 'ch-1',
    number: 1,
    title: 'প্রথম অধ্যায়: কুয়াশার নদী',
    originalText: 'The river was quiet.',
    translatedText: 'নদীটি ছিল নিস্তব্ধ।',
    paragraphs: [
      { index: 0, englishText: 'The river was quiet.', banglaText: 'নদীটি ছিল নিস্তব্ধ।' },
    ],
    status: 'completed',
    currentStage: 5,
    stageCompleted: {
      understanding: true,
      voiceAnalysis: true,
      translation: true,
      editing: true,
      verification: true,
    },
    editorialNotes: [],
    editorialChanges: [],
    verificationReport: null,
    chunkCount: 1,
    completedChunks: 1,
    updatedAt: new Date().toISOString(),
  };

  const exported = formatChapterExport('কুয়াশার গান', chapter);
  assert.ok(exported.includes('কুয়াশার গান'));
  assert.ok(exported.includes('নদীটি ছিল নিস্তব্ধ।'));
});
