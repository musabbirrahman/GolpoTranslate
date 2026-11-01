import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitIntoParagraphs,
  parseParagraphsWithSceneBreaks,
  isOrnamentalSceneBreak,
  joinParagraphsWithSceneBreaks,
  chunkTextByParagraphs,
  assembleTranslatedChunks,
  alignParagraphs,
  updateParagraphTranslation,
  applyStage4EditsToParagraphs,
  splitManuscriptIntoChapters,
  formatMemoryPromptBlock,
  formatChapterExport,
  formatFullStoryExport,
  formatBilingualExport,
  mergeStage3ChunkProgress,
  canEditContinuousBangla,
  applyContinuousBanglaEdit,
  getPipelineCompletionState,
  revertParagraphTranslation,
  resolveVerificationIssue,
} from './chunker';
import type {
  CharacterMemoryItem,
  TerminologyMemoryItem,
  Chapter,
  TranslationProject,
  VerificationIssue,
} from './types';

test('1. Standard paragraph separation preserves paragraph order and single blank line boundaries without false scene breaks', () => {
  const input =
    'First paragraph of the story.\n\nSecond paragraph with "dialogue inside it."\r\n\r\nThird paragraph.';
  const paras = splitIntoParagraphs(input);
  assert.equal(paras.length, 3);
  assert.equal(paras[0], 'First paragraph of the story.');
  assert.equal(paras[1], 'Second paragraph with "dialogue inside it."');
  assert.equal(paras[2], 'Third paragraph.');

  const parsed = parseParagraphsWithSceneBreaks(input);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].sceneBreakAfter, undefined);
  assert.equal(parsed[1].sceneBreakAfter, undefined);
  assert.equal(parsed[2].sceneBreakAfter, undefined);
});

test('2. Multiple consecutive blank lines represent an intentional scene break', () => {
  const input =
    'Scene one closing line.\n\n\nScene two opening line after two blank lines.\r\n\r\n\r\n\r\nScene three opening line.';
  const parsed = parseParagraphsWithSceneBreaks(input);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].text, 'Scene one closing line.');
  assert.equal(parsed[0].sceneBreakAfter, true);
  assert.equal(parsed[0].sceneBreakMarker, '');

  assert.equal(parsed[1].text, 'Scene two opening line after two blank lines.');
  assert.equal(parsed[1].sceneBreakAfter, true);
  assert.equal(parsed[1].sceneBreakMarker, '');

  assert.equal(parsed[2].text, 'Scene three opening line.');
  assert.equal(parsed[2].sceneBreakAfter, undefined);

  const translatable = splitIntoParagraphs(input);
  assert.equal(translatable.length, 3);
});

test('3. Ornamental scene separators (***, * * *, ---) are detected and never become translatable paragraphs', () => {
  assert.equal(isOrnamentalSceneBreak('***'), true);
  assert.equal(isOrnamentalSceneBreak('* * *'), true);
  assert.equal(isOrnamentalSceneBreak('---'), true);
  assert.equal(isOrnamentalSceneBreak('Normal dialogue line.'), false);

  const input = [
    'Paragraph before triple asterisk.',
    '',
    '***',
    '',
    'Paragraph after triple asterisk.',
    '',
    '* * *',
    '',
    'Paragraph after spaced asterisks.',
    '',
    '---',
    '',
    'Final paragraph after dashes.',
  ].join('\n');

  const translatable = splitIntoParagraphs(input);
  assert.equal(translatable.length, 4);
  assert.deepEqual(translatable, [
    'Paragraph before triple asterisk.',
    'Paragraph after triple asterisk.',
    'Paragraph after spaced asterisks.',
    'Final paragraph after dashes.',
  ]);

  const parsed = parseParagraphsWithSceneBreaks(input);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].sceneBreakAfter, true);
  assert.equal(parsed[0].sceneBreakMarker, '***');
  assert.equal(parsed[1].sceneBreakAfter, true);
  assert.equal(parsed[1].sceneBreakMarker, '* * *');
  assert.equal(parsed[2].sceneBreakAfter, true);
  assert.equal(parsed[2].sceneBreakMarker, '---');
  assert.equal(parsed[3].sceneBreakAfter, undefined);
});

test('4. Scene breaks immediately before and after a chunk boundary survive chunking and translation assembly', () => {
  const p1 = Array(55).fill('morning').join(' ');
  const p2 = Array(55).fill('lantern').join(' ');
  const p3 = Array(55).fill('midnight').join(' ');
  const p4 = Array(55).fill('harbor').join(' ');

  // Scene break immediately BEFORE the chunk boundary (after p1), AT the chunk boundary (after p2),
  // and immediately AFTER the chunk boundary (after p3).
  const manuscript = `${p1}\n\n---\n\n${p2}\n\n* * *\n\n${p3}\n\n\n${p4}`;

  const chunks = chunkTextByParagraphs(manuscript, 115, 1);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].startParagraphIndex, 0);
  assert.equal(chunks[0].endParagraphIndex, 1);
  assert.equal(chunks[1].startParagraphIndex, 2);
  assert.equal(chunks[1].endParagraphIndex, 3);

  const englishParagraphs = splitIntoParagraphs(manuscript);
  assert.equal(englishParagraphs.length, 4);

  const translatedChunks = [
    ['সকালের অনুচ্ছেদ।', 'লণ্ঠনের অনুচ্ছেদ।'],
    ['মধ্যরাতের অনুচ্ছেদ।', 'বন্দরের অনুচ্ছেদ।'],
  ];

  const { pairs, fullBanglaText, missingIndices } = assembleTranslatedChunks(
    englishParagraphs,
    translatedChunks,
    chunks
  );

  assert.equal(missingIndices.length, 0);
  assert.equal(pairs.length, 4);
  assert.equal(pairs[0].sceneBreakAfter, true);
  assert.equal(pairs[0].sceneBreakMarker, '---');
  assert.equal(pairs[1].sceneBreakAfter, true);
  assert.equal(pairs[1].sceneBreakMarker, '* * *');
  assert.equal(pairs[2].sceneBreakAfter, true);
  assert.equal(pairs[2].sceneBreakMarker, '');
  assert.equal(pairs[3].sceneBreakAfter, undefined);

  assert.equal(
    fullBanglaText,
    'সকালের অনুচ্ছেদ।\n\n---\n\nলণ্ঠনের অনুচ্ছেদ।\n\n* * *\n\nমধ্যরাতের অনুচ্ছেদ।\n\n\nবন্দরের অনুচ্ছেদ।'
  );
});

test('5. Scene-break preservation during assembly and TXT exports (chapter, full-story, and bilingual)', () => {
  const source =
    'First scene ends here.\n\n***\n\nSecond scene begins.\n\n\nThird scene after blank-line break.';
  const englishParagraphs = splitIntoParagraphs(source);
  const chunks = chunkTextByParagraphs(source, 500, 2);

  const { pairs, fullBanglaText } = assembleTranslatedChunks(
    englishParagraphs,
    [['প্রথম দৃশ্যের সমাপ্তি।', 'দ্বিতীয় দৃশ্যের সূচনা।', 'তৃতীয় দৃশ্যের সূচনা।']],
    chunks
  );

  const chapter: Chapter = {
    id: 'ch-1',
    number: 1,
    title: 'Chapter 1: The Watchtower',
    originalText: source,
    translatedText: fullBanglaText,
    paragraphs: pairs,
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

  const chapterExport = formatChapterExport('আলোর প্রহরী', chapter);
  assert.ok(
    chapterExport.includes(
      'প্রথম দৃশ্যের সমাপ্তি।\n\n***\n\nদ্বিতীয় দৃশ্যের সূচনা।\n\n\nতৃতীয় দৃশ্যের সূচনা।'
    )
  );

  const project: TranslationProject = {
    id: 'proj-1',
    title: 'আলোর প্রহরী',
    authorName: 'Test Author',
    genre: 'Literary Fiction',
    sourceLanguage: 'English',
    targetLanguage: 'Bangla (বাংলা)',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    styleProfile: null,
    storyContext: null,
    characterMemory: [],
    terminologyMemory: [],
    styleControls: {
      preserveAuthorStyle: true,
      naturalness: 'highly_natural',
      literaryExpression: 'rich',
      languageComplexity: 'medium',
      dialogueStyle: 'more_conversational',
      translationApproach: 'faithful',
    },
    chapters: [chapter],
  };

  const fullStoryExport = formatFullStoryExport(project);
  assert.ok(
    fullStoryExport.includes(
      'প্রথম দৃশ্যের সমাপ্তি।\n\n***\n\nদ্বিতীয় দৃশ্যের সূচনা।\n\n\nতৃতীয় দৃশ্যের সূচনা।'
    )
  );

  const bilingualExport = formatBilingualExport(project);
  assert.ok(
    bilingualExport.includes(
      'First scene ends here.\n\n***\n\nSecond scene begins.\n\n\nThird scene after blank-line break.'
    )
  );
  assert.ok(
    bilingualExport.includes(
      'প্রথম দৃশ্যের সমাপ্তি।\n\n***\n\nদ্বিতীয় দৃশ্যের সূচনা।\n\n\nতৃতীয় দৃশ্যের সূচনা।'
    )
  );
});

test('6. Single-chapter heading extraction strips the heading from body paragraphs and preserves it in chapter metadata', () => {
  const singleChapterManuscript = [
    'Chapter 1: The Lighthouse Keeper',
    '',
    'The fog rolled in from the bay at twilight.',
    '',
    'He struck a match and lit the brass wick.',
  ].join('\n');

  const chapters = splitManuscriptIntoChapters(singleChapterManuscript, 'Fallback Title');
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, 'Chapter 1: The Lighthouse Keeper');
  assert.equal(
    chapters[0].content,
    'The fog rolled in from the bay at twilight.\n\nHe struck a match and lit the brass wick.'
  );

  const bodyParagraphs = splitIntoParagraphs(chapters[0].content);
  assert.equal(bodyParagraphs.length, 2);
  assert.equal(bodyParagraphs[0], 'The fog rolled in from the bay at twilight.');
  assert.equal(bodyParagraphs[1], 'He struck a match and lit the brass wick.');

  const headlessManuscript =
    'The fog rolled in from the bay at twilight.\n\nHe struck a match and lit the brass wick.';
  const headlessChapters = splitManuscriptIntoChapters(headlessManuscript, 'Chapter 1');
  assert.equal(headlessChapters.length, 1);
  assert.equal(headlessChapters[0].title, 'Chapter 1');
  assert.equal(headlessChapters[0].content, headlessManuscript);
});

test('7. Multi-chapter heading extraction remains accurate', () => {
  const raw = `Chapter 1: The Monsoon Arrives\nThe rain began at dusk.\n\nChapter 2: The Lantern on the Ghat\nShe held the brass lamp steady.`;
  const chapters = splitManuscriptIntoChapters(raw);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter 1: The Monsoon Arrives');
  assert.equal(chapters[0].content, 'The rain began at dusk.');
  assert.equal(chapters[1].title, 'Chapter 2: The Lantern on the Ghat');
  assert.equal(chapters[1].content, 'She held the brass lamp steady.');
});

test('8. Empty translation output in the middle of a chunk preserves original slot indices and flags missingTranslation', () => {
  const english = ['Paragraph one.', 'Paragraph two.', 'Paragraph three.'];
  const translatedChunks = [['বাংলা অনুচ্ছেদ ১।', '', 'বাংলা অনুচ্ছেদ ৩।']];

  const { pairs, missingIndices } = assembleTranslatedChunks(english, translatedChunks);

  assert.equal(pairs.length, 3);
  assert.deepEqual(missingIndices, [1]);

  assert.equal(pairs[0].index, 0);
  assert.equal(pairs[0].englishText, 'Paragraph one.');
  assert.equal(pairs[0].banglaText, 'বাংলা অনুচ্ছেদ ১।');
  assert.equal(pairs[0].missingTranslation, undefined);

  assert.equal(pairs[1].index, 1);
  assert.equal(pairs[1].englishText, 'Paragraph two.');
  assert.equal(pairs[1].banglaText, '');
  assert.equal(pairs[1].missingTranslation, true);

  assert.equal(pairs[2].index, 2);
  assert.equal(pairs[2].englishText, 'Paragraph three.');
  assert.equal(pairs[2].banglaText, 'বাংলা অনুচ্ছেদ ৩।');
  assert.equal(pairs[2].missingTranslation, undefined);
});

test('9. Duplicate translation text in two legitimate neighboring paragraphs is preserved within a chunk, across chunk boundaries, and on opposite sides of a scene break', () => {
  const manuscript = '"Yes."\n\n"Yes."\n\n***\n\n"Wait."\n\n"Wait."';
  const english = splitIntoParagraphs(manuscript);
  const chunks = [
    {
      chunkIndex: 0,
      paragraphs: ['"Yes."', '"Yes."', '"Wait."'],
      paragraphMeta: [
        { index: 0, text: '"Yes."' },
        { index: 1, text: '"Yes."', sceneBreakAfter: true, sceneBreakMarker: '***' },
        { index: 2, text: '"Wait."' },
      ],
      previousContextParagraphs: [],
      startParagraphIndex: 0,
      endParagraphIndex: 2,
      wordCount: 3,
    },
    {
      chunkIndex: 1,
      paragraphs: ['"Wait."'],
      paragraphMeta: [{ index: 3, text: '"Wait."' }],
      previousContextParagraphs: ['"Yes."', '"Wait."'],
      startParagraphIndex: 3,
      endParagraphIndex: 3,
      wordCount: 1,
    },
  ];

  // Also test identical repeated paragraphs directly on opposite sides of a scene break ("হ্যাঁ।" *** "হ্যাঁ।")
  const translatedChunks = [
    ['"হ্যাঁ।"', '"হ্যাঁ।"', '"হ্যাঁ।"'],
    ['"হ্যাঁ।"'],
  ];

  const { pairs, fullBanglaText, missingIndices } = assembleTranslatedChunks(
    english,
    translatedChunks,
    chunks
  );

  assert.equal(missingIndices.length, 0);
  assert.equal(pairs.length, 4);
  assert.equal(pairs[0].banglaText, '"হ্যাঁ।"');
  assert.equal(pairs[1].banglaText, '"হ্যাঁ।"');
  assert.equal(pairs[1].sceneBreakAfter, true);
  assert.equal(pairs[1].sceneBreakMarker, '***');
  assert.equal(pairs[2].banglaText, '"হ্যাঁ।"');
  assert.equal(pairs[3].banglaText, '"হ্যাঁ।"');
  assert.equal(
    fullBanglaText,
    '"হ্যাঁ।"\n\n"হ্যাঁ।"\n\n***\n\n"হ্যাঁ।"\n\n"হ্যাঁ।"'
  );
});

test('10. Missing or duplicate chunk-boundary output never shifts downstream chunk paragraph indices', () => {
  const english = [
    'Chunk1 P0.',
    'Chunk1 P1.',
    'Chunk1 P2 (missing from model response).',
    'Chunk2 P3.',
    'Chunk2 P4.',
  ];

  const chunks = [
    {
      chunkIndex: 0,
      paragraphs: [english[0], english[1], english[2]],
      previousContextParagraphs: [],
      startParagraphIndex: 0,
      endParagraphIndex: 2,
      wordCount: 10,
    },
    {
      chunkIndex: 1,
      paragraphs: [english[3], english[4]],
      previousContextParagraphs: [english[1], english[2]],
      startParagraphIndex: 3,
      endParagraphIndex: 4,
      wordCount: 6,
    },
  ];

  const missingBoundaryResult = assembleTranslatedChunks(
    english,
    [
      ['অনুবাদ ০।', 'অনুবাদ ১।'],
      ['অনুবাদ ৩।', 'অনুবাদ ৪।'],
    ],
    chunks
  );

  assert.equal(missingBoundaryResult.pairs.length, 5);
  assert.deepEqual(missingBoundaryResult.missingIndices, [2]);
  assert.equal(missingBoundaryResult.pairs[0].banglaText, 'অনুবাদ ০।');
  assert.equal(missingBoundaryResult.pairs[1].banglaText, 'অনুবাদ ১।');
  assert.equal(missingBoundaryResult.pairs[2].banglaText, '');
  assert.equal(missingBoundaryResult.pairs[2].missingTranslation, true);
  assert.equal(missingBoundaryResult.pairs[3].banglaText, 'অনুবাদ ৩।');
  assert.equal(missingBoundaryResult.pairs[4].banglaText, 'অনুবাদ ৪।');

  const duplicateBoundaryResult = assembleTranslatedChunks(
    english,
    [
      ['অনুবাদ ০।', 'অনুবাদ ১।', 'অনুবাদ ২।'],
      ['অনুবাদ ২।', 'অনুবাদ ৩।', 'অনুবাদ ৪।'],
    ],
    chunks
  );

  assert.equal(duplicateBoundaryResult.missingIndices.length, 0);
  assert.equal(duplicateBoundaryResult.pairs[2].banglaText, 'অনুবাদ ২।');
  assert.equal(duplicateBoundaryResult.pairs[3].banglaText, 'অনুবাদ ৩।');
  assert.equal(duplicateBoundaryResult.pairs[4].banglaText, 'অনুবাদ ৪।');
});

test('11. Multiple consecutive scene breaks and scene breaks at the beginning or end of a chapter', () => {
  // Leading ornamental/blank breaks before first paragraph, consecutive ornamental breaks in the middle,
  // and trailing ornamental/blank breaks after the final paragraph.
  const manuscript = [
    '',
    '***',
    '',
    '',
    'Opening paragraph of the chapter.',
    '',
    '***',
    '',
    '---',
    '',
    'Second paragraph after two consecutive ornamental breaks.',
    '',
    '* * *',
    '',
    '',
  ].join('\n');

  const parsed = parseParagraphsWithSceneBreaks(manuscript);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].text, 'Opening paragraph of the chapter.');
  assert.equal(parsed[0].sceneBreakAfter, true);
  assert.equal(parsed[0].sceneBreakMarker, '***\n\n---');

  // Trailing scene break at the end of the chapter does not attach a dangling separator
  assert.equal(parsed[1].text, 'Second paragraph after two consecutive ornamental breaks.');
  assert.equal(parsed[1].sceneBreakAfter, undefined);

  const pairs = alignParagraphs(
    manuscript,
    'অধ্যায়ের প্রথম অনুচ্ছেদ।\n\n***\n\n---\n\nদ্বিতীয় অনুচ্ছেদ।'
  );
  const joined = joinParagraphsWithSceneBreaks(pairs, {
    field: 'banglaText',
    omitEmpty: true,
  });
  assert.equal(joined, 'অধ্যায়ের প্রথম অনুচ্ছেদ।\n\n***\n\n---\n\nদ্বিতীয় অনুচ্ছেদ।');
});

test('12. Adding, removing, and moving scene breaks and inserting/deleting paragraphs through alignParagraphs()', () => {
  // Initial state: 3 paragraphs with a scene break after Paragraph 0
  const initialEng = 'Para 1.\n\n***\n\nPara 2.\n\nPara 3.';
  const initialBn = 'অনুবাদ ১।\n\n***\n\nঅনুবাদ ২।\n\nঅনুবাদ ৩।';
  const initialPairs = alignParagraphs(initialEng, initialBn);
  initialPairs[0].previousBanglaText = 'পুরাতন অনুবাদ ১।';
  initialPairs[0].lastRefinementAction = 'more_natural';
  initialPairs[1].lastRefinementAction = 'improve_literary';

  assert.equal(initialPairs[0].sceneBreakAfter, true);
  assert.equal(initialPairs[0].sceneBreakMarker, '***');
  assert.equal(initialPairs[1].sceneBreakAfter, undefined);

  // Case A: Remove the scene break in English editor -> must actually be removed
  const removedBreakEng = 'Para 1.\n\nPara 2.\n\nPara 3.';
  const afterRemove = alignParagraphs(removedBreakEng, initialBn, initialPairs);
  assert.equal(afterRemove[0].sceneBreakAfter, undefined);
  assert.equal(afterRemove[0].sceneBreakMarker, undefined);
  assert.equal(afterRemove[0].previousBanglaText, 'পুরাতন অনুবাদ ১।');
  assert.equal(afterRemove[0].lastRefinementAction, 'more_natural');

  // Case B: Move the scene break from after Para 1 to after Para 2
  const movedBreakEng = 'Para 1.\n\nPara 2.\n\n---\n\nPara 3.';
  const afterMove = alignParagraphs(movedBreakEng, initialBn, initialPairs);
  assert.equal(afterMove[0].sceneBreakAfter, undefined);
  assert.equal(afterMove[1].sceneBreakAfter, true);
  assert.equal(afterMove[1].sceneBreakMarker, '---');
  assert.equal(afterMove[1].lastRefinementAction, 'improve_literary');

  // Case C: Insert a new paragraph at the top -> old scene break on Para 1 stays on Para 1 (now index 1),
  // and is NOT copied onto the newly inserted index 0
  const insertedEng = 'Inserted Intro.\n\nPara 1.\n\n***\n\nPara 2.\n\nPara 3.';
  const afterInsert = alignParagraphs(insertedEng, '', initialPairs);
  assert.equal(afterInsert.length, 4);
  assert.equal(afterInsert[0].englishText, 'Inserted Intro.');
  assert.equal(afterInsert[0].sceneBreakAfter, undefined);
  assert.equal(afterInsert[0].banglaText, '');
  assert.equal(afterInsert[0].lastRefinementAction, undefined);

  assert.equal(afterInsert[1].englishText, 'Para 1.');
  assert.equal(afterInsert[1].sceneBreakAfter, true);
  assert.equal(afterInsert[1].sceneBreakMarker, '***');
  assert.equal(afterInsert[1].banglaText, 'অনুবাদ ১।');
  assert.equal(afterInsert[1].lastRefinementAction, 'more_natural');
});

test('13. Missing translations around scene breaks preserve the scene break between surrounding translated paragraphs without leading/trailing separators', () => {
  // Case A: Missing translation on the paragraph immediately BEFORE a scene break (P1 is missing, has '***')
  const pairsBeforeBreak = [
    { index: 0, englishText: 'P0', banglaText: 'অনুবাদ ০।' },
    {
      index: 1,
      englishText: 'P1',
      banglaText: '',
      missingTranslation: true,
      sceneBreakAfter: true,
      sceneBreakMarker: '***',
    },
    { index: 2, englishText: 'P2', banglaText: 'অনুবাদ ২।' },
  ];
  const joinedBefore = joinParagraphsWithSceneBreaks(pairsBeforeBreak, {
    field: 'banglaText',
    omitEmpty: true,
  });
  assert.equal(joinedBefore, 'অনুবাদ ০।\n\n***\n\nঅনুবাদ ২।');

  // Case B: Missing translation on the paragraph immediately AFTER a scene break (P0 has '***', P1 is missing)
  const pairsAfterBreak = [
    {
      index: 0,
      englishText: 'P0',
      banglaText: 'অনুবাদ ০।',
      sceneBreakAfter: true,
      sceneBreakMarker: '***',
    },
    { index: 1, englishText: 'P1', banglaText: '', missingTranslation: true },
    { index: 2, englishText: 'P2', banglaText: 'অনুবাদ ২।' },
  ];
  const joinedAfter = joinParagraphsWithSceneBreaks(pairsAfterBreak, {
    field: 'banglaText',
    omitEmpty: true,
  });
  assert.equal(joinedAfter, 'অনুবাদ ০।\n\n***\n\nঅনুবাদ ২।');

  // Case C: Missing translation at start of chapter (P0 missing with '***') and end of chapter (P2 missing after '---')
  // Must NOT create leading or trailing separators when omitted
  const pairsLeadingTrailingMissing = [
    {
      index: 0,
      englishText: 'P0',
      banglaText: '',
      missingTranslation: true,
      sceneBreakAfter: true,
      sceneBreakMarker: '***',
    },
    {
      index: 1,
      englishText: 'P1',
      banglaText: 'একমাত্র অনূদিত অনুচ্ছেদ।',
      sceneBreakAfter: true,
      sceneBreakMarker: '---',
    },
    { index: 2, englishText: 'P2', banglaText: '', missingTranslation: true },
  ];
  const joinedEdge = joinParagraphsWithSceneBreaks(pairsLeadingTrailingMissing, {
    field: 'banglaText',
    omitEmpty: true,
  });
  assert.equal(joinedEdge, 'একমাত্র অনূদিত অনুচ্ছেদ।');
});

test('14. Missing-translation status lifecycle: initial untranslated vs Stage 3 missing vs Stage 3 translated vs Stage 4, manual edit, and refinement', () => {
  // 1. New project / untranslated chapter: must NOT mark paragraphs as missingTranslation
  const initialPairs = alignParagraphs('First paragraph.\n\nSecond paragraph.', '');
  assert.equal(initialPairs.length, 2);
  assert.equal(initialPairs[0].missingTranslation, undefined);
  assert.equal(initialPairs[1].missingTranslation, undefined);

  // 2. Stage 3 attempt where P0 succeeds and P1 is missing
  const stage3Attempt = assembleTranslatedChunks(
    ['First paragraph.', 'Second paragraph.'],
    [['প্রথম অনুচ্ছেদ।', '']]
  );
  assert.equal(stage3Attempt.pairs[0].missingTranslation, undefined);
  assert.equal(stage3Attempt.pairs[1].missingTranslation, true);
  assert.deepEqual(stage3Attempt.missingIndices, [1]);

  // 3. Re-running Stage 3 with all paragraphs translated clears missingTranslation
  const stage3Success = assembleTranslatedChunks(
    ['First paragraph.', 'Second paragraph.'],
    [['প্রথম অনুচ্ছেদ।', 'দ্বিতীয় অনুচ্ছেদ।']]
  );
  assert.equal(stage3Success.pairs[0].missingTranslation, undefined);
  assert.equal(stage3Success.pairs[1].missingTranslation, undefined);
  assert.deepEqual(stage3Success.missingIndices, []);

  // 4. Stage 4 editing clears missingTranslation when non-empty Bangla is provided,
  //    but keeps missingTranslation: true if a paragraph remains empty
  const afterStage4Partial = applyStage4EditsToParagraphs(stage3Attempt.pairs, [
    'সম্পাদিত প্রথম অনুচ্ছেদ।',
    '',
  ]);
  assert.equal(afterStage4Partial[0].missingTranslation, undefined);
  assert.equal(afterStage4Partial[1].missingTranslation, true);

  const afterStage4Complete = applyStage4EditsToParagraphs(stage3Attempt.pairs, [
    'সম্পাদিত প্রথম অনুচ্ছেদ।',
    'সম্পাদিত দ্বিতীয় অনুচ্ছেদ।',
  ]);
  assert.equal(afterStage4Complete[1].missingTranslation, undefined);
  assert.equal(afterStage4Complete[1].banglaText, 'সম্পাদিত দ্বিতীয় অনুচ্ছেদ।');

  // 5. Manual editing and AI refinement clear missingTranslation when non-empty,
  //    and mark as missing if cleared back to empty
  const manuallyFixed = updateParagraphTranslation(
    stage3Attempt.pairs[1],
    'মানব সম্পাদিত অনুবাদ।',
    { lastRefinementAction: 'manual_edit' }
  );
  assert.equal(manuallyFixed.missingTranslation, undefined);
  assert.equal(manuallyFixed.banglaText, 'মানব সম্পাদিত অনুবাদ।');

  const clearedByUser = updateParagraphTranslation(manuallyFixed, '   ', {
    lastRefinementAction: 'manual_edit',
  });
  assert.equal(clearedByUser.missingTranslation, true);

  const refinedFixed = updateParagraphTranslation(
    stage3Attempt.pairs[1],
    'শৈলীকৃত অনুবাদ।',
    {
      previousBanglaText: '',
      lastRefinementAction: 'match_author_style',
      refinementRationale: 'Recovered missing translation',
      markEmptyAsMissing: true,
    }
  );
  assert.equal(refinedFixed.missingTranslation, undefined);
  assert.equal(refinedFixed.banglaText, 'শৈলীকৃত অনুবাদ।');
});

test('15. Cache isolation: identical paragraph text with different scene-break structures and different chunk sizes never collide', () => {
  const textWithoutBreaks = 'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.';
  const textWithOrnamentalBreaks =
    'Alpha paragraph.\n\n***\n\nBeta paragraph.\n\n---\n\nGamma paragraph.';

  // Parse both before assembling either to verify no global string-key collision occurs
  const parasNoBreak = splitIntoParagraphs(textWithoutBreaks);
  const parasWithBreak = splitIntoParagraphs(textWithOrnamentalBreaks);

  const assembledNoBreak = assembleTranslatedChunks(parasNoBreak, [
    ['আলফা।', 'বিটা।', 'গামা।'],
  ]);
  const assembledWithBreak = assembleTranslatedChunks(parasWithBreak, [
    ['আলফা।', 'বিটা।', 'গামা।'],
  ]);

  assert.equal(assembledNoBreak.pairs[0].sceneBreakAfter, undefined);
  assert.equal(assembledNoBreak.pairs[1].sceneBreakAfter, undefined);
  assert.equal(assembledNoBreak.fullBanglaText, 'আলফা।\n\nবিটা।\n\nগামা।');

  assert.equal(assembledWithBreak.pairs[0].sceneBreakAfter, true);
  assert.equal(assembledWithBreak.pairs[0].sceneBreakMarker, '***');
  assert.equal(assembledWithBreak.pairs[1].sceneBreakAfter, true);
  assert.equal(assembledWithBreak.pairs[1].sceneBreakMarker, '---');
  assert.equal(
    assembledWithBreak.fullBanglaText,
    'আলফা।\n\n***\n\nবিটা।\n\n---\n\nগামা।'
  );

  // Also test chunking the same manuscript with two different chunk sizes
  const longP1 = Array(60).fill('river').join(' ');
  const longP2 = Array(60).fill('lantern').join(' ');
  const longP3 = Array(60).fill('bridge').join(' ');
  const sameManuscript = `${longP1}\n\n${longP2}\n\n${longP3}`;

  const smallChunks = chunkTextByParagraphs(sameManuscript, 100, 1); // 3 chunks of 1 paragraph (60 words) each
  const largeChunks = chunkTextByParagraphs(sameManuscript, 150, 1); // 2 chunks (2 paragraphs = 120 words, then 1 paragraph = 60 words)

  assert.equal(smallChunks.length, 3);
  assert.equal(largeChunks.length, 2);

  const paras = splitIntoParagraphs(sameManuscript);
  const resSmall = assembleTranslatedChunks(
    paras,
    [['নদী।'], ['লণ্ঠন।'], ['সেতু।']],
    smallChunks
  );
  const resLarge = assembleTranslatedChunks(
    paras,
    [['নদী।', 'লণ্ঠন।'], ['সেতু।']],
    largeChunks
  );

  assert.equal(resSmall.fullBanglaText, 'নদী।\n\nলণ্ঠন।\n\nসেতু।');
  assert.equal(resLarge.fullBanglaText, 'নদী।\n\nলণ্ঠন।\n\nসেতু।');
});

test('16. Unsafe fallback assembly fails safely when explicit chunk boundaries are missing or invalid for multi-chunk input', () => {
  const english = ['P1.', 'P2.', 'P3.', 'P4.'];
  const multiChunks = [
    ['অনুবাদ ১।', 'অনুবাদ ২।'],
    ['অনুবাদ ৩।', 'অনুবাদ ৪।'],
  ];

  // Calling assembleTranslatedChunks with multiple chunks but without explicit `chunks` metadata must throw
  assert.throws(
    () => assembleTranslatedChunks(english, multiChunks),
    /Missing explicit chunk boundary metadata/
  );

  // Calling with mismatched or non-contiguous chunk boundaries must also fail safely
  assert.throws(
    () =>
      assembleTranslatedChunks(english, multiChunks, [
        { startParagraphIndex: 0, endParagraphIndex: 1 },
        { startParagraphIndex: 3, endParagraphIndex: 3 }, // gap at index 2
      ]),
    /Invalid or non-contiguous chunk boundary metadata/
  );
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

test('18. Identical English paragraphs on opposite sides of a scene break through parsing, assembly, and alignment', () => {
  const manuscript = '"Hold the line."\n\n***\n\n"Hold the line."';

  // 1. Parsing
  const parsed = parseParagraphsWithSceneBreaks(manuscript);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].text, '"Hold the line."');
  assert.equal(parsed[0].sceneBreakAfter, true);
  assert.equal(parsed[0].sceneBreakMarker, '***');
  assert.equal(parsed[1].text, '"Hold the line."');
  assert.equal(parsed[1].sceneBreakAfter, undefined);

  // 2. Assembly
  const englishParagraphs = splitIntoParagraphs(manuscript);
  const assembled = assembleTranslatedChunks(englishParagraphs, [
    ['"সারি ধরে দাঁড়াও।" (দৃশ্য ১)', '"সারি ধরে দাঁড়াও।" (দৃশ্য ২)'],
  ]);
  assert.equal(assembled.pairs.length, 2);
  assert.equal(assembled.pairs[0].banglaText, '"সারি ধরে দাঁড়াও।" (দৃশ্য ১)');
  assert.equal(assembled.pairs[0].sceneBreakAfter, true);
  assert.equal(assembled.pairs[0].sceneBreakMarker, '***');
  assert.equal(assembled.pairs[1].banglaText, '"সারি ধরে দাঁড়াও।" (দৃশ্য ২)');
  assert.equal(assembled.pairs[1].sceneBreakAfter, undefined);
  assert.equal(
    assembled.fullBanglaText,
    '"সারি ধরে দাঁড়াও।" (দৃশ্য ১)\n\n***\n\n"সারি ধরে দাঁড়াও।" (দৃশ্য ২)'
  );

  // 3. Alignment with existingPairs preserves distinct translations on each side of the scene break
  assembled.pairs[0].lastRefinementAction = 'conversational_dialogue';
  assembled.pairs[1].lastRefinementAction = 'more_expressive';

  const aligned = alignParagraphs(manuscript, '', assembled.pairs);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].banglaText, '"সারি ধরে দাঁড়াও।" (দৃশ্য ১)');
  assert.equal(aligned[0].lastRefinementAction, 'conversational_dialogue');
  assert.equal(aligned[0].sceneBreakAfter, true);
  assert.equal(aligned[0].sceneBreakMarker, '***');

  assert.equal(aligned[1].banglaText, '"সারি ধরে দাঁড়াও।" (দৃশ্য ২)');
  assert.equal(aligned[1].lastRefinementAction, 'more_expressive');
  assert.equal(aligned[1].sceneBreakAfter, undefined);
});

test('19. Adding a scene break to a manuscript that originally had none', () => {
  const originalEng = 'The rain stopped at midnight.\n\nDawn broke over the river.';
  const originalBn = 'মধ্যরাতে বৃষ্টি থামল।\n\nনদীর ওপর ভোরের আলো ফুটল।';
  const initialPairs = alignParagraphs(originalEng, originalBn);
  initialPairs[0].lastRefinementAction = 'improve_literary';
  initialPairs[1].lastRefinementAction = 'more_natural';

  assert.equal(initialPairs[0].sceneBreakAfter, undefined);
  assert.equal(initialPairs[1].sceneBreakAfter, undefined);

  // User adds an ornamental scene break '***' between the two paragraphs
  const updatedEngOrnamental =
    'The rain stopped at midnight.\n\n***\n\nDawn broke over the river.';
  const alignedOrnamental = alignParagraphs(updatedEngOrnamental, '', initialPairs);
  assert.equal(alignedOrnamental.length, 2);
  assert.equal(alignedOrnamental[0].sceneBreakAfter, true);
  assert.equal(alignedOrnamental[0].sceneBreakMarker, '***');
  assert.equal(alignedOrnamental[0].banglaText, 'মধ্যরাতে বৃষ্টি থামল।');
  assert.equal(alignedOrnamental[0].lastRefinementAction, 'improve_literary');
  assert.equal(alignedOrnamental[1].sceneBreakAfter, undefined);
  assert.equal(alignedOrnamental[1].banglaText, 'নদীর ওপর ভোরের আলো ফুটল।');
  assert.equal(alignedOrnamental[1].lastRefinementAction, 'more_natural');

  const joinedOrnamental = joinParagraphsWithSceneBreaks(alignedOrnamental, {
    field: 'banglaText',
    omitEmpty: true,
  });
  assert.equal(
    joinedOrnamental,
    'মধ্যরাতে বৃষ্টি থামল।\n\n***\n\nনদীর ওপর ভোরের আলো ফুটল।'
  );

  // User adds an intentional blank-line scene break (\n\n\n) to a manuscript that originally had none
  const updatedEngBlankLine =
    'The rain stopped at midnight.\n\n\nDawn broke over the river.';
  const alignedBlankLine = alignParagraphs(updatedEngBlankLine, '', initialPairs);
  assert.equal(alignedBlankLine[0].sceneBreakAfter, true);
  assert.equal(alignedBlankLine[0].sceneBreakMarker, '');
  assert.equal(
    joinParagraphsWithSceneBreaks(alignedBlankLine, {
      field: 'banglaText',
      omitEmpty: true,
    }),
    'মধ্যরাতে বৃষ্টি থামল।\n\n\nনদীর ওপর ভোরের আলো ফুটল।'
  );
});

test('20. Revert using previousBanglaText and the missing-translation lifecycle', () => {
  // Case A: Paragraph had a non-empty translation, was refined, and then reverted to previousBanglaText
  const initialPair = {
    index: 0,
    englishText: 'He closed the heavy oak door.',
    banglaText: 'সে ভারী ওক কাঠের দরজাটি বন্ধ করল।',
    sceneBreakAfter: true,
    sceneBreakMarker: '***',
  };

  const refinedPair = updateParagraphTranslation(
    initialPair,
    'ভারী ওক কাঠের কপাটটি সে নিঃশব্দে ভেজিয়ে দিল।',
    {
      previousBanglaText: initialPair.banglaText,
      lastRefinementAction: 'improve_literary',
      refinementRationale: 'Elevated literary tone',
    }
  );
  assert.equal(refinedPair.previousBanglaText, 'সে ভারী ওক কাঠের দরজাটি বন্ধ করল।');
  assert.equal(refinedPair.missingTranslation, undefined);

  const revertedPair = updateParagraphTranslation(
    refinedPair,
    refinedPair.previousBanglaText!,
    {
      previousBanglaText: undefined,
      lastRefinementAction: undefined,
      refinementRationale: undefined,
      markEmptyAsMissing: true,
    }
  );
  assert.equal(revertedPair.banglaText, 'সে ভারী ওক কাঠের দরজাটি বন্ধ করল।');
  assert.equal(revertedPair.previousBanglaText, undefined);
  assert.equal(revertedPair.lastRefinementAction, undefined);
  assert.equal(revertedPair.missingTranslation, undefined);
  assert.equal(revertedPair.sceneBreakAfter, true);
  assert.equal(revertedPair.sceneBreakMarker, '***');

  // Case B: Paragraph was originally missing (banglaText: '', missingTranslation: true),
  // refined with AI (recording previousBanglaText: ''), and then reverted back to '' -> must restore missingTranslation: true
  const missingPair = {
    index: 1,
    englishText: 'A distant bell rang.',
    banglaText: '',
    missingTranslation: true,
  };
  const recoveredViaRefine = updateParagraphTranslation(
    missingPair,
    'দূরে একটি ঘণ্টা বেজে উঠল।',
    {
      previousBanglaText: missingPair.banglaText,
      lastRefinementAction: 'more_natural',
      markEmptyAsMissing: true,
    }
  );
  assert.equal(recoveredViaRefine.missingTranslation, undefined);
  assert.equal(recoveredViaRefine.previousBanglaText, '');

  const revertedToEmpty = updateParagraphTranslation(
    recoveredViaRefine,
    recoveredViaRefine.previousBanglaText!,
    {
      previousBanglaText: undefined,
      lastRefinementAction: undefined,
      refinementRationale: undefined,
      markEmptyAsMissing: true,
    }
  );
  assert.equal(revertedToEmpty.banglaText, '');
  assert.equal(revertedToEmpty.missingTranslation, true);
});

test('21. An earlier edited paragraph matching a later unchanged paragraph must not steal its translation', () => {
  // Original manuscript: P0 = 'A', P1 = 'B', P2 = 'C'
  const initialPairs = alignParagraphs(
    'Alpha line.\n\nBeta line.\n\nCharlie line.',
    'আলফা অনুবাদ।\n\nবিটা অনুবাদ।\n\nচার্লি অনুবাদ।'
  );
  initialPairs[0].lastRefinementAction = 'more_natural';
  initialPairs[2].lastRefinementAction = 'improve_literary';

  // User edits P0 so its English text becomes 'Charlie line.' while P2 remains 'Charlie line.' at index 2.
  // Pass 1 reserves P1 ('Beta line.' at index 1) and P2 ('Charlie line.' at index 2).
  // P0 (index 0) must NOT steal P2's translation ('চার্লি অনুবাদ।'), and P2 must retain its own translation and metadata!
  const editedEng = 'Charlie line.\n\nBeta line.\n\nCharlie line.';
  const aligned = alignParagraphs(editedEng, '', initialPairs);

  assert.equal(aligned.length, 3);
  // P2 at index 2 is unchanged and keeps its exact translation and metadata
  assert.equal(aligned[2].englishText, 'Charlie line.');
  assert.equal(aligned[2].banglaText, 'চার্লি অনুবাদ।');
  assert.equal(aligned[2].lastRefinementAction, 'improve_literary');

  // P1 at index 1 is unchanged and keeps its exact translation
  assert.equal(aligned[1].englishText, 'Beta line.');
  assert.equal(aligned[1].banglaText, 'বিটা অনুবাদ।');

  // P0 at index 0 was edited to duplicate P2's text; it must NOT steal P2's translation.
  // Because P0 now duplicates P2's text, it is left unmatched ('') for review rather than guessing.
  assert.equal(aligned[0].englishText, 'Charlie line.');
  assert.equal(aligned[0].banglaText, '');
});

test('22. Inserting a duplicate paragraph must not silently inherit an ambiguous translation', () => {
  // Case A: Original has [A, B]. User inserts a duplicate B at index 0 -> [B, A, B].
  // Index 0 ('B') is newly inserted, while index 2 ('B') is the original shifted from index 1.
  // Because 'B' now appears twice in the new manuscript and neither is at exact old index 1,
  // it is ambiguous which 'B' is old vs new -> both 'B's must be left unmatched ('') for review, while 'A' (unique) keeps its translation.
  const initialAB = alignParagraphs('Alpha.\n\nBravo.', 'আলফা।\n\nব্রাভো।');
  const afterInsertDuplicateAtTop = alignParagraphs(
    'Bravo.\n\nAlpha.\n\nBravo.',
    '',
    initialAB
  );
  assert.equal(afterInsertDuplicateAtTop.length, 3);
  assert.equal(afterInsertDuplicateAtTop[0].banglaText, '');
  assert.equal(afterInsertDuplicateAtTop[1].banglaText, 'আলফা।');
  assert.equal(afterInsertDuplicateAtTop[2].banglaText, '');

  // Case B: Original has two identical paragraphs '"Yes."' at index 0 and index 1 with different Bangla translations,
  // and user inserts a new paragraph at index 0 so both shift to index 1 and index 2 ->
  // Pass 1 matches index 1 ('"Yes."') with old index 1, and index 2 ('"Yes."') is not matched by Pass 2 because '"Yes."' is not unique.
  const initialDup = [
    { index: 0, englishText: '"Yes."', banglaText: '"হ্যাঁ, প্রথমবার।"' },
    { index: 1, englishText: '"Yes."', banglaText: '"হ্যাঁ, দ্বিতীয়বার।"' },
  ];
  const afterShiftAmbiguous = alignParagraphs(
    'Intro.\n\n"Yes."\n\n"Yes."',
    '',
    initialDup
  );
  assert.equal(afterShiftAmbiguous.length, 3);
  assert.equal(afterShiftAmbiguous[0].banglaText, '');
  // Index 2 is left empty for review rather than guessing between duplicate '"Yes."' paragraphs
  assert.equal(afterShiftAmbiguous[2].banglaText, '');
});

test('23. Paragraph identity behavior when insertion/deletion and wording edits occur together', () => {
  // Original has 3 paragraphs: [A, B, C]
  const initialPairs = alignParagraphs(
    'Paragraph A.\n\nParagraph B.\n\nParagraph C.',
    'অনুবাদ ক।\n\nঅনুবাদ খ।\n\nঅনুবাদ গ।'
  );
  initialPairs[0].lastRefinementAction = 'more_natural';
  initialPairs[1].lastRefinementAction = 'improve_literary';
  initialPairs[2].lastRefinementAction = 'more_expressive';

  // Scenario 1: Same paragraph count (3 -> 3), unique wording edit on middle paragraph [A, B_edited, C]
  // Pass 1 matches A (index 0) and C (index 2). Pass 3 preserves B's slot at index 1 because count is unchanged and B_edited is unique.
  const wordingEditSameCount = alignParagraphs(
    'Paragraph A.\n\nParagraph B (revised wording).\n\nParagraph C.',
    '',
    initialPairs
  );
  assert.equal(wordingEditSameCount.length, 3);
  assert.equal(wordingEditSameCount[0].banglaText, 'অনুবাদ ক।');
  assert.equal(wordingEditSameCount[1].banglaText, 'অনুবাদ খ।');
  assert.equal(wordingEditSameCount[1].lastRefinementAction, 'improve_literary');
  assert.equal(wordingEditSameCount[2].banglaText, 'অনুবাদ গ।');

  // Scenario 2: Insertion + wording edit together (3 -> 4 paragraphs: [Intro, A, B_edited, C])
  // Pass 1: none match at same index.
  // Pass 2: A (unique) matches old index 0 -> new index 1; C (unique) matches old index 2 -> new index 3.
  // Pass 3 does NOT run because paragraph count changed (3 !== 4).
  // Therefore, neither 'Intro' (index 0) nor 'B_edited' (index 2) steals old B's translation! Both are left unmatched ('') for review.
  const insertPlusWordingEdit = alignParagraphs(
    'New Intro.\n\nParagraph A.\n\nParagraph B (revised wording).\n\nParagraph C.',
    '',
    initialPairs
  );
  assert.equal(insertPlusWordingEdit.length, 4);
  assert.equal(insertPlusWordingEdit[0].englishText, 'New Intro.');
  assert.equal(insertPlusWordingEdit[0].banglaText, '');
  assert.equal(insertPlusWordingEdit[1].englishText, 'Paragraph A.');
  assert.equal(insertPlusWordingEdit[1].banglaText, 'অনুবাদ ক।');
  assert.equal(insertPlusWordingEdit[1].lastRefinementAction, 'more_natural');
  assert.equal(insertPlusWordingEdit[2].englishText, 'Paragraph B (revised wording).');
  assert.equal(insertPlusWordingEdit[2].banglaText, '');
  assert.equal(insertPlusWordingEdit[3].englishText, 'Paragraph C.');
  assert.equal(insertPlusWordingEdit[3].banglaText, 'অনুবাদ গ।');
  assert.equal(insertPlusWordingEdit[3].lastRefinementAction, 'more_expressive');
});

test('24. Continuous Bangla Editor safety when translations are missing', () => {
  // English has 5 paragraphs; Bangla has only 3 because paragraphs index 1 and 3 (1-based #2 and #4) are missing.
  const englishManuscript = 'P1.\n\nP2.\n\nP3.\n\nP4.\n\nP5.';
  const assembled = assembleTranslatedChunks(
    splitIntoParagraphs(englishManuscript),
    [['অনুবাদ ১।', '', 'অনুবাদ ৩।', '', 'অনুবাদ ৫।']]
  );

  // 1. Guard reports that Continuous Bangla Editor must be disabled and identifies missing indices [1, 3]
  const guardWhenMissing = canEditContinuousBangla(assembled.pairs);
  assert.equal(guardWhenMissing.allowed, false);
  assert.deepEqual(guardWhenMissing.missingIndices, [1, 3]);
  assert.ok(guardWhenMissing.reason?.includes('#2, #4'));

  // 2. Attempting to apply a Continuous Bangla Edit while translations are missing is rejected without mutating state
  const rejectedEdit = applyContinuousBanglaEdit(
    englishManuscript,
    'অনুবাদ ১।\n\nঅনুবাদ ৩ সম্পাদিত।\n\nঅনুবাদ ৫।',
    assembled.pairs
  );
  assert.equal(rejectedEdit.applied, false);
  assert.equal(rejectedEdit.paragraphs, assembled.pairs);
  assert.equal(
    rejectedEdit.translatedText,
    'অনুবাদ ১।\n\nঅনুবাদ ৩।\n\nঅনুবাদ ৫।'
  );

  // 3. Once the user fills in missing paragraphs #2 and #4 in Paragraph Studio, Continuous Bangla Editor becomes enabled
  const filledPairs = assembled.pairs.map((p) => {
    if (p.index === 1) return updateParagraphTranslation(p, 'অনুবাদ ২।');
    if (p.index === 3) return updateParagraphTranslation(p, 'অনুবাদ ৪।');
    return p;
  });
  const guardWhenComplete = canEditContinuousBangla(filledPairs);
  assert.equal(guardWhenComplete.allowed, true);
  assert.deepEqual(guardWhenComplete.missingIndices, []);

  // 4. Editing paragraph 3 in the Continuous Bangla Editor now applies cleanly, keeps translatedText and paragraphs 100% in sync,
  //    and records previousBanglaText + manual_edit on the modified paragraph only.
  const validEdit = applyContinuousBanglaEdit(
    englishManuscript,
    'অনুবাদ ১।\n\nঅনুবাদ ২।\n\nঅনুবাদ ৩ (সম্পাদিত)।\n\nঅনুবাদ ৪।\n\nঅনুবাদ ৫।',
    filledPairs
  );
  assert.equal(validEdit.applied, true);
  assert.equal(validEdit.paragraphs[2].banglaText, 'অনুবাদ ৩ (সম্পাদিত)।');
  assert.equal(validEdit.paragraphs[2].previousBanglaText, 'অনুবাদ ৩।');
  assert.equal(validEdit.paragraphs[2].lastRefinementAction, 'manual_edit');
  assert.equal(validEdit.paragraphs[0].lastRefinementAction, undefined);
  assert.equal(
    validEdit.translatedText,
    joinParagraphsWithSceneBreaks(validEdit.paragraphs, {
      field: 'banglaText',
      omitEmpty: true,
    })
  );
});

test('25. Partial Stage 3 progress preserves existing refinement metadata and translations outside the active chunk', () => {
  const manuscript = 'P0.\n\n***\n\nP1.\n\nP2.\n\n---\n\nP3.';
  const englishParagraphs = splitIntoParagraphs(manuscript);
  const chunks = [
    {
      chunkIndex: 0,
      paragraphs: ['P0.', 'P1.'],
      paragraphMeta: [
        { index: 0, text: 'P0.', sceneBreakAfter: true, sceneBreakMarker: '***' },
        { index: 1, text: 'P1.' },
      ],
      previousContextParagraphs: [],
      startParagraphIndex: 0,
      endParagraphIndex: 1,
      wordCount: 2,
    },
    {
      chunkIndex: 1,
      paragraphs: ['P2.', 'P3.'],
      paragraphMeta: [
        { index: 2, text: 'P2.', sceneBreakAfter: true, sceneBreakMarker: '---' },
        { index: 3, text: 'P3.' },
      ],
      previousContextParagraphs: ['P0.', 'P1.'],
      startParagraphIndex: 2,
      endParagraphIndex: 3,
      wordCount: 2,
    },
  ];

  // Suppose all 4 paragraphs already had translations and refinement metadata before re-running Stage 3
  const existingPairs = [
    {
      index: 0,
      englishText: 'P0.',
      banglaText: 'পুরাতন ০।',
      previousBanglaText: 'আদি ০।',
      lastRefinementAction: 'more_natural' as const,
      refinementRationale: 'Flow fix',
      sceneBreakAfter: true,
      sceneBreakMarker: '***',
    },
    {
      index: 1,
      englishText: 'P1.',
      banglaText: 'পুরাতন ১।',
      lastRefinementAction: 'improve_literary' as const,
    },
    {
      index: 2,
      englishText: 'P2.',
      banglaText: 'বিদ্যমান ২।',
      previousBanglaText: 'আদি ২।',
      lastRefinementAction: 'more_expressive' as const,
      refinementRationale: 'Kept on chunk 2',
      sceneBreakAfter: true,
      sceneBreakMarker: '---',
    },
    {
      index: 3,
      englishText: 'P3.',
      banglaText: 'বিদ্যমান ৩।',
      lastRefinementAction: 'conversational_dialogue' as const,
    },
  ];

  // Step A: Chunk 0 finishes with ['নতুন ০।', 'নতুন ১।'].
  // Chunk 1 (indices 2..3) has not run yet and must keep its existing translations and refinement metadata!
  const afterChunk0 = mergeStage3ChunkProgress(
    englishParagraphs,
    existingPairs,
    chunks[0],
    ['নতুন ০।', 'নতুন ১।']
  );

  // Active chunk 0 updated and saved old banglaText into previousBanglaText
  assert.equal(afterChunk0.pairs[0].banglaText, 'নতুন ০।');
  assert.equal(afterChunk0.pairs[0].previousBanglaText, 'পুরাতন ০।');
  assert.equal(afterChunk0.pairs[0].lastRefinementAction, undefined);
  assert.equal(afterChunk0.pairs[0].sceneBreakAfter, true);
  assert.equal(afterChunk0.pairs[0].sceneBreakMarker, '***');

  assert.equal(afterChunk0.pairs[1].banglaText, 'নতুন ১।');
  assert.equal(afterChunk0.pairs[1].previousBanglaText, 'পুরাতন ১।');

  // Outside active chunk (indices 2 and 3) untouched!
  assert.equal(afterChunk0.pairs[2].banglaText, 'বিদ্যমান ২।');
  assert.equal(afterChunk0.pairs[2].previousBanglaText, 'আদি ২।');
  assert.equal(afterChunk0.pairs[2].lastRefinementAction, 'more_expressive');
  assert.equal(afterChunk0.pairs[2].refinementRationale, 'Kept on chunk 2');
  assert.equal(afterChunk0.pairs[3].banglaText, 'বিদ্যমান ৩।');
  assert.equal(afterChunk0.pairs[3].lastRefinementAction, 'conversational_dialogue');

  // fullBanglaText includes both the newly translated chunk 0 AND the preserved chunk 1 translations
  assert.equal(
    afterChunk0.fullBanglaText,
    'নতুন ০।\n\n***\n\nনতুন ১।\n\nবিদ্যমান ২।\n\n---\n\nবিদ্যমান ৩।'
  );

  // Step B: Chunk 1 finishes with ['নতুন ২।', ''].
  // Chunk 0 (indices 0..1) must remain untouched!
  // Let's also simulate user/existing refinement metadata on index 0 before chunk 1 finishes.
  afterChunk0.pairs[0].lastRefinementAction = 'manual_edit';
  const afterChunk1 = mergeStage3ChunkProgress(
    englishParagraphs,
    afterChunk0.pairs,
    chunks[1],
    ['নতুন ২।', '']
  );

  assert.equal(afterChunk1.pairs[0].banglaText, 'নতুন ০।');
  assert.equal(afterChunk1.pairs[0].previousBanglaText, 'পুরাতন ০।');
  assert.equal(afterChunk1.pairs[0].lastRefinementAction, 'manual_edit');

  assert.equal(afterChunk1.pairs[2].banglaText, 'নতুন ২।');
  assert.equal(afterChunk1.pairs[2].previousBanglaText, 'বিদ্যমান ২।');
  assert.equal(afterChunk1.pairs[3].banglaText, '');
  assert.equal(afterChunk1.pairs[3].missingTranslation, true);
  assert.equal(afterChunk1.pairs[3].previousBanglaText, 'বিদ্যমান ৩।');
});

test('26. Pipeline completion messaging is consistent with missing-translation state', () => {
  // Case 1: Chapter with a missing translation -> never marked completed, returns warning tone and review-required message
  const incompletePairs = [
    { index: 0, englishText: 'P1.', banglaText: 'অনুবাদ ১।' },
    { index: 1, englishText: 'P2.', banglaText: '', missingTranslation: true },
  ];
  const incompleteState = getPipelineCompletionState(incompletePairs, false);
  assert.equal(incompleteState.isComplete, false);
  assert.equal(incompleteState.chapterStatus, 'needs_review');
  assert.equal(incompleteState.bannerTone, 'warning');
  assert.deepEqual(incompleteState.missingIndices, [1]);
  assert.ok(incompleteState.bannerMessage.includes('Paragraph #2'));
  assert.ok(incompleteState.bannerMessage.includes('review required'));

  // Case 2: Chapter with all paragraphs translated but unresolved high verification issue -> needs_review & warning tone
  const completePairs = [
    { index: 0, englishText: 'P1.', banglaText: 'অনুবাদ ১।' },
    { index: 1, englishText: 'P2.', banglaText: 'অনুবাদ ২।' },
  ];
  const highIssueState = getPipelineCompletionState(completePairs, true);
  assert.equal(highIssueState.isComplete, false);
  assert.equal(highIssueState.chapterStatus, 'needs_review');
  assert.equal(highIssueState.bannerTone, 'warning');

  // Case 3: All paragraphs translated and no unresolved high verification issues -> completed & success tone
  const successState = getPipelineCompletionState(completePairs, false);
  assert.equal(successState.isComplete, true);
  assert.equal(successState.chapterStatus, 'completed');
  assert.equal(successState.bannerTone, 'success');
  assert.equal(
    successState.bannerMessage,
    'All 5 stages of the Adaptive Literary Translation Pipeline completed.'
  );
});

test('27. Dismissing one verification issue while another high-severity issue remains keeps chapter in needs_review', () => {
  const translatedPairs = [
    { index: 0, englishText: 'P1.', banglaText: 'অনুবাদ ১।' },
    { index: 1, englishText: 'P2.', banglaText: 'অনুবাদ ২।' },
  ];
  const issues: VerificationIssue[] = [
    {
      id: 'issue-1',
      type: 'missing_sentence',
      severity: 'high',
      paragraphIndex: 0,
      description: 'First high severity issue',
      resolved: false,
    },
    {
      id: 'issue-2',
      type: 'changed_meaning',
      severity: 'high',
      paragraphIndex: 1,
      description: 'Second high severity issue',
      resolved: false,
    },
  ];

  // Dismissing issue-1 while issue-2 (high severity) remains unresolved must NOT mark chapter completed
  const afterFirstDismiss = resolveVerificationIssue(
    translatedPairs,
    issues,
    'issue-1'
  );
  assert.equal(afterFirstDismiss.updatedIssues[0].resolved, true);
  assert.equal(afterFirstDismiss.updatedIssues[1].resolved, false);
  assert.equal(afterFirstDismiss.completion.isComplete, false);
  assert.equal(afterFirstDismiss.chapterStatus, 'needs_review');
  assert.equal(afterFirstDismiss.completion.bannerTone, 'warning');

  // Dismissing issue-2 as well (when all paragraphs are translated) now completes the chapter
  const afterSecondDismiss = resolveVerificationIssue(
    translatedPairs,
    afterFirstDismiss.updatedIssues,
    'issue-2'
  );
  assert.equal(afterSecondDismiss.completion.isComplete, true);
  assert.equal(afterSecondDismiss.chapterStatus, 'completed');
  assert.equal(afterSecondDismiss.completion.bannerTone, 'success');
});

test('28. Dismissing a verification issue while translations are missing keeps chapter in needs_review', () => {
  const incompletePairs = [
    { index: 0, englishText: 'P1.', banglaText: 'অনুবাদ ১।' },
    { index: 1, englishText: 'P2.', banglaText: '', missingTranslation: true },
  ];
  const issues: VerificationIssue[] = [
    {
      id: 'issue-only',
      type: 'character_inconsistency',
      severity: 'high',
      paragraphIndex: 0,
      description: 'High severity issue on P1',
      resolved: false,
    },
  ];

  const afterDismiss = resolveVerificationIssue(
    incompletePairs,
    issues,
    'issue-only'
  );
  assert.equal(afterDismiss.updatedIssues[0].resolved, true);
  assert.equal(afterDismiss.completion.hasUnresolvedHighIssues, false);
  assert.equal(afterDismiss.completion.hasMissingTranslations, true);
  assert.equal(afterDismiss.completion.isComplete, false);
  assert.equal(afterDismiss.chapterStatus, 'needs_review');
  assert.equal(afterDismiss.completion.bannerTone, 'warning');
  assert.deepEqual(afterDismiss.completion.missingIndices, [1]);
});

test('29. Reverting to a non-empty previous translation clears stale refinement metadata and preserves undo history', () => {
  const initialPair = {
    index: 0,
    englishText: 'She opened the brass lantern.',
    banglaText: 'সে পিতলের লণ্ঠনটি খুলল।',
    sceneBreakAfter: true,
    sceneBreakMarker: '***',
  };

  const refinedPair = updateParagraphTranslation(
    initialPair,
    'পিতলের লণ্ঠনখানি সে ধীর হাতে উন্মোচন করল।',
    {
      previousBanglaText: initialPair.banglaText,
      lastRefinementAction: 'improve_literary',
      refinementRationale: 'Enhanced literary cadence',
    }
  );
  assert.equal(refinedPair.lastRefinementAction, 'improve_literary');
  assert.equal(refinedPair.refinementRationale, 'Enhanced literary cadence');

  const reverted = revertParagraphTranslation(refinedPair);
  assert.equal(reverted.banglaText, 'সে পিতলের লণ্ঠনটি খুলল।');
  // Current revised translation is preserved in previousBanglaText so undo never loses work
  assert.equal(
    reverted.previousBanglaText,
    'পিতলের লণ্ঠনখানি সে ধীর হাতে উন্মোচন করল।'
  );
  assert.equal(reverted.lastRefinementAction, undefined);
  assert.equal(reverted.refinementRationale, undefined);
  assert.equal(reverted.missingTranslation, undefined);
  assert.equal(reverted.sceneBreakAfter, true);
  assert.equal(reverted.sceneBreakMarker, '***');
});

test('30. Reverting to an empty previous translation works via explicit undefined/null check and marks missingTranslation: true', () => {
  // Paragraph was originally missing (banglaText: '', missingTranslation: true), then refined by AI
  const originallyMissing = {
    index: 2,
    englishText: 'Footsteps echoed in the corridor.',
    banglaText: '',
    missingTranslation: true,
  };

  const refinedFromEmpty = updateParagraphTranslation(
    originallyMissing,
    'বারান্দায় পদধ্বনি প্রতিধ্বনিত হলো।',
    {
      previousBanglaText: originallyMissing.banglaText, // '' (empty string!)
      lastRefinementAction: 'match_author_style',
      refinementRationale: 'Translated missing paragraph',
      markEmptyAsMissing: true,
    }
  );
  assert.equal(refinedFromEmpty.banglaText, 'বারান্দায় পদধ্বনি প্রতিধ্বনিত হলো।');
  assert.equal(refinedFromEmpty.previousBanglaText, '');
  assert.equal(refinedFromEmpty.missingTranslation, undefined);

  // Revert back to the empty previous translation ''
  const revertedToEmpty = revertParagraphTranslation(refinedFromEmpty);
  assert.equal(revertedToEmpty.banglaText, '');
  assert.equal(revertedToEmpty.missingTranslation, true);
  assert.equal(revertedToEmpty.lastRefinementAction, undefined);
  assert.equal(revertedToEmpty.refinementRationale, undefined);
  // Preserves the translation in previousBanglaText so clicking Revert again restores it without loss
  assert.equal(
    revertedToEmpty.previousBanglaText,
    'বারান্দায় পদধ্বনি প্রতিধ্বনিত হলো।'
  );

  // Reverting a second time restores the non-empty translation and clears missingTranslation
  const redoFromEmpty = revertParagraphTranslation(revertedToEmpty);
  assert.equal(redoFromEmpty.banglaText, 'বারান্দায় পদধ্বনি প্রতিধ্বনিত হলো।');
  assert.equal(redoFromEmpty.previousBanglaText, '');
  assert.equal(redoFromEmpty.missingTranslation, undefined);
});

test('31. Later-chunk partial progress with an echoed previous boundary paragraph strips the duplicate in intermediate progress and matches final assembly', () => {
  const manuscript = 'Para 0.\n\nPara 1.\n\nPara 2.\n\nPara 3.';
  const englishParagraphs = splitIntoParagraphs(manuscript);
  const chunks = [
    {
      chunkIndex: 0,
      paragraphs: ['Para 0.', 'Para 1.'],
      paragraphMeta: [
        { index: 0, text: 'Para 0.' },
        { index: 1, text: 'Para 1.' },
      ],
      previousContextParagraphs: [],
      startParagraphIndex: 0,
      endParagraphIndex: 1,
      wordCount: 4,
    },
    {
      chunkIndex: 1,
      paragraphs: ['Para 2.', 'Para 3.'],
      paragraphMeta: [
        { index: 2, text: 'Para 2.' },
        { index: 3, text: 'Para 3.' },
      ],
      previousContextParagraphs: ['Para 0.', 'Para 1.'],
      startParagraphIndex: 2,
      endParagraphIndex: 3,
      wordCount: 4,
    },
  ];

  const initialPairs = alignParagraphs(manuscript, '');

  // Chunk 0 returns ['অনুবাদ ০।', 'অনুবাদ ১।']
  const chunk0Out = ['অনুবাদ ০।', 'অনুবাদ ১।'];
  const partial0 = mergeStage3ChunkProgress(
    englishParagraphs,
    initialPairs,
    chunks[0],
    chunk0Out,
    ''
  );
  assert.equal(partial0.lastNonEmptyBangla, 'অনুবাদ ১।');
  assert.equal(partial0.pairs[0].banglaText, 'অনুবাদ ০।');
  assert.equal(partial0.pairs[1].banglaText, 'অনুবাদ ১।');

  // Chunk 1 echoes Chunk 0's final paragraph 'অনুবাদ ১।' at index 0: ['অনুবাদ ১।', 'অনুবাদ ২।', 'অনুবাদ ৩।']
  const chunk1EchoedOut = ['অনুবাদ ১।', 'অনুবাদ ২।', 'অনুবাদ ৩।'];
  const partial1 = mergeStage3ChunkProgress(
    englishParagraphs,
    partial0.pairs,
    chunks[1],
    chunk1EchoedOut,
    partial0.lastNonEmptyBangla
  );

  // Verify intermediate partial progress stripped the echoed boundary paragraph and aligned P2 and P3 accurately
  assert.equal(partial1.pairs[0].banglaText, 'অনুবাদ ০।');
  assert.equal(partial1.pairs[1].banglaText, 'অনুবাদ ১।');
  assert.equal(partial1.pairs[2].banglaText, 'অনুবাদ ২।');
  assert.equal(partial1.pairs[3].banglaText, 'অনুবাদ ৩।');
  assert.equal(
    partial1.fullBanglaText,
    'অনুবাদ ০।\n\nঅনুবাদ ১।\n\nঅনুবাদ ২।\n\nঅনুবাদ ৩।'
  );

  // Verify final assembled result matches intermediate partial progress identically
  const finalAssembled = assembleTranslatedChunks(
    englishParagraphs,
    [chunk0Out, chunk1EchoedOut],
    chunks,
    initialPairs
  );
  assert.equal(finalAssembled.fullBanglaText, partial1.fullBanglaText);
  assert.deepEqual(finalAssembled.pairs, partial1.pairs);
});

test('32. Inserting a new English paragraph into a translated chapter marks the new paragraph as missingTranslation: true', () => {
  const originalEng = 'Opening paragraph.\n\nClosing paragraph.';
  const originalBn = 'প্রথম অনুচ্ছেদ।\n\nশেষ অনুচ্ছেদ।';
  const translatedPairs = alignParagraphs(originalEng, originalBn);

  assert.equal(translatedPairs.length, 2);
  assert.equal(translatedPairs[0].missingTranslation, undefined);
  assert.equal(translatedPairs[1].missingTranslation, undefined);

  // User inserts a new English paragraph in the middle via Continuous English Editor
  const editedEng =
    'Opening paragraph.\n\nNewly inserted middle paragraph.\n\nClosing paragraph.';
  const alignedAfterInsert = alignParagraphs(editedEng, '', translatedPairs);

  assert.equal(alignedAfterInsert.length, 3);
  assert.equal(alignedAfterInsert[0].banglaText, 'প্রথম অনুচ্ছেদ।');
  assert.equal(alignedAfterInsert[0].missingTranslation, undefined);

  // Newly inserted paragraph at index 1 (Paragraph #2) is flagged with missingTranslation: true
  assert.equal(
    alignedAfterInsert[1].englishText,
    'Newly inserted middle paragraph.'
  );
  assert.equal(alignedAfterInsert[1].banglaText, '');
  assert.equal(alignedAfterInsert[1].missingTranslation, true);

  assert.equal(alignedAfterInsert[2].banglaText, 'শেষ অনুচ্ছেদ।');
  assert.equal(alignedAfterInsert[2].missingTranslation, undefined);

  // Missing-paragraph warning filter and Continuous Bangla Editor guard both list Paragraph #2 (index 1)
  const missingIndices = alignedAfterInsert
    .filter((p) => Boolean(p.missingTranslation))
    .map((p) => p.index);
  assert.deepEqual(missingIndices, [1]);

  const guard = canEditContinuousBangla(alignedAfterInsert);
  assert.equal(guard.allowed, false);
  assert.deepEqual(guard.missingIndices, [1]);
  assert.ok(guard.reason?.includes('#2'));
});

test('33. Resolving a newly inserted paragraph missing translation in Paragraph Studio clears missingTranslation and unlocks Continuous Bangla Editor', () => {
  const translatedPairs = alignParagraphs(
    'Opening paragraph.\n\nClosing paragraph.',
    'প্রথম অনুচ্ছেদ।\n\nশেষ অনুচ্ছেদ।'
  );
  const alignedAfterInsert = alignParagraphs(
    'Opening paragraph.\n\nNewly inserted middle paragraph.\n\nClosing paragraph.',
    '',
    translatedPairs
  );
  assert.equal(alignedAfterInsert[1].missingTranslation, true);

  // User translates Paragraph #2 (index 1) in Paragraph Studio
  const resolvedPairs = alignedAfterInsert.map((item, idx) =>
    idx === 1
      ? updateParagraphTranslation(item, 'নতুন মধ্যবর্তী অনুচ্ছেদ।', {
          lastRefinementAction: 'manual_edit',
        })
      : item
  );

  assert.equal(resolvedPairs[1].banglaText, 'নতুন মধ্যবর্তী অনুচ্ছেদ।');
  assert.equal(resolvedPairs[1].missingTranslation, undefined);

  const missingIndices = resolvedPairs
    .filter((p) => Boolean(p.missingTranslation))
    .map((p) => p.index);
  assert.deepEqual(missingIndices, []);

  const guard = canEditContinuousBangla(resolvedPairs);
  assert.equal(guard.allowed, true);
  assert.deepEqual(guard.missingIndices, []);

  const completion = getPipelineCompletionState(resolvedPairs, []);
  assert.equal(completion.isComplete, true);
  assert.equal(completion.chapterStatus, 'completed');
});

test('34. A brand-new untranslated chapter does not incorrectly show a missing-translation warning even after English source edits', () => {
  // Initial creation of an untranslated chapter
  const initialUntranslated = alignParagraphs(
    'First untranslated paragraph.\n\nSecond untranslated paragraph.',
    ''
  );
  assert.equal(initialUntranslated.length, 2);
  assert.equal(initialUntranslated[0].missingTranslation, undefined);
  assert.equal(initialUntranslated[1].missingTranslation, undefined);

  // Editing or inserting paragraphs in the English editor BEFORE any translation has been attempted
  const editedUntranslated = alignParagraphs(
    'First untranslated paragraph.\n\nInserted untranslated paragraph.\n\nSecond untranslated paragraph.',
    '',
    initialUntranslated
  );
  assert.equal(editedUntranslated.length, 3);
  assert.equal(editedUntranslated[0].missingTranslation, undefined);
  assert.equal(editedUntranslated[1].missingTranslation, undefined);
  assert.equal(editedUntranslated[2].missingTranslation, undefined);

  const missingWarningIndices = editedUntranslated
    .filter((p) => Boolean(p.missingTranslation))
    .map((p) => p.index);
  assert.deepEqual(missingWarningIndices, []);
});


