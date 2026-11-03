import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CharacterMemoryItem,
  ParagraphPair,
  StoryContextProfile,
  TerminologyMemoryItem,
  TranslationProject,
  VerificationReport,
} from './types';
import {
  COMMON_ENGLISH_STOP_WORDS,
  STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS,
  STAGE3_GEO_PREFIX_MARKERS,
  STAGE3_PREFIX_TITLE_MARKERS,
  STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST,
  STAGE3_SUFFIX_HONORIFIC_MARKERS,
  computeFindingSignature,
  computeParagraphContentFingerprint,
  computeStage1Coverage,
  createUserTerminologyItem,
  doesCandidateMatchSuppressionDescriptor,
  endsWithBanglaVowel,
  extractContextualSenseKey,
  extractEnglishSurfaceAndSense,
  filterGlossaryForChunk,
  findBanglaTermOccurrences,
  findEnglishTermOccurrences,
  formatGlossaryForPrompt,
  generateConservativeEnglishWordForms,
  getTerminologyDedupeKey,
  getTerminologySurfaceSenseKey,
  hasGlossaryEntryChangedInFlight,
  hydrateLegacyProjectState,
  hydrateProjectGlossary,
  isAllowedBanglaNominalSuffix,
  isValidGlossaryCandidate,
  lintChapterTerminology,
  lintParagraphTerminology,
  matchGlossaryInEnglishText,
  matchesBanglaTerm,
  mergeGlossaryItems,
  mergeStage1WindowResults,
  mergeVerificationReportWithTerminologyLint,
  normalizeBanglaUnicode,
  normalizeGlossaryList,
  normalizeTerminologyItem,
  reconcileInFlightCharacterMemory,
  reconcileInFlightGlossaryWithLatestState,
  reconcileInFlightStoryContext,
  reconcileStage1ResultWithLatestState,
  reconcileStage3ChunkGlossaryWithLatestState,
  reconcileStage4ResultWithLatestState,
  reconcileStage5ResultWithLatestState,
  reconcileVerificationReportAfterLocalEdit,
  mapSnapshotParagraphsToLatest,
  splitTextIntoStage1Windows,
  syncLocationsToGlossary,
  terminologyFindingToVerificationIssue,
  updateUserTerminologyItem,
  validateStage3DiscoveredTerms,
  validateTerminologyItem,
} from './terminology';
import {
  alignParagraphs,
  assembleTranslatedChunks,
  chunkTextByParagraphs,
  mergeStage3ChunkProgress,
  parseParagraphsWithSceneBreaks,
  splitIntoParagraphs,
} from './chunker';
import {
  STAGE3_RESPONSE_SCHEMA,
  STAGE4_RESPONSE_SCHEMA,
  STAGE5_RESPONSE_SCHEMA,
  analyzeStoryUnderstanding,
  extractRawStage3DiscoveredCandidates,
  reconcileSamePassStage1Terminology,
  runLiteraryEditingPass,
  sanitizeStage1NoteForNonContextualAI,
  sanitizeStage1WindowTerminology,
  translateChunkFaithfully,
  verifyTranslationAccuracy,
} from './gemini-service';

test('1. Glossary normalization, validation, and user-lock defaults', () => {
  // Legacy item with only Step 1 fields
  const legacyItem = normalizeTerminologyItem({
    id: 'legacy-1',
    englishTerm: '  lantern   room ',
    banglaTranslation: ' দীপকক্ষ ',
    category: 'place',
    notes: 'Top chamber of the lighthouse',
  });

  assert.equal(legacyItem.id, 'legacy-1');
  assert.equal(legacyItem.englishTerm, 'lantern room');
  assert.equal(legacyItem.banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(legacyItem.acceptedAlternatives, []);
  assert.deepEqual(legacyItem.avoidTranslations, []);
  assert.equal(legacyItem.caseSensitive, false);
  assert.equal(legacyItem.isContextSensitive, false);
  assert.equal(legacyItem.allowInflections, true);
  assert.equal(legacyItem.source, 'stage1_ai');
  assert.equal(legacyItem.lockedByUser, false);

  // Deduplication and conflict exclusion between preferred, acceptedAlternatives, and avoidTranslations
  const deduplicated = normalizeTerminologyItem({
    id: 'term-boats',
    englishTerm: 'boats',
    banglaTranslation: 'নৌকা',
    acceptedAlternatives: ['নৌকা', 'নৌকো', 'নৌকো', 'তরী'],
    avoidTranslations: ['নৌকা', 'নৌকো', 'জাহাজ', 'জলযান', 'জাহাজ'],
    category: 'nautical',
    notes: 'Small wooden river boats',
  });

  assert.deepEqual(deduplicated.acceptedAlternatives, ['নৌকো', 'তরী']);
  assert.deepEqual(deduplicated.avoidTranslations, ['জাহাজ', 'জলযান']);

  // Validation helper catches missing fields and self-contradictory avoid lists
  const invalidCheck = validateTerminologyItem({
    englishTerm: '',
    banglaTranslation: 'দীপকক্ষ',
  });
  assert.equal(invalidCheck.valid, false);
  assert.ok(invalidCheck.errors.some((e) => e.includes('English term')));

  const conflictCheck = validateTerminologyItem({
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['দীপকক্ষ'],
  });
  assert.equal(conflictCheck.valid, false);

  // User creation & edit helpers automatically set lockedByUser: true and source: 'user'
  const userCreated = createUserTerminologyItem({
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    category: 'place',
    notes: 'User preferred rendering',
  });
  assert.equal(userCreated.lockedByUser, true);
  assert.equal(userCreated.source, 'user');

  // Editing an unlocked AI entry via user edit helper locks it automatically
  const userEdited = updateUserTerminologyItem(legacyItem, {
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
  });
  assert.equal(userEdited.lockedByUser, true);
  assert.equal(userEdited.source, 'user');

  // User can explicitly unlock an entry if desired
  const userUnlocked = updateUserTerminologyItem(userEdited, {
    lockedByUser: false,
  });
  assert.equal(userUnlocked.lockedByUser, false);
});

test('2. Unicode normalization handles decomposed Bangla nukta characters and zero-width joiners', () => {
  // Decomposed য় (\u09AF\u09BC) vs precomposed য় (\u09DF) and decomposed ড় (\u09A1\u09BC) vs precomposed ড় (\u09DC)
  const decomposed = 'আ\u09AF\u09BCনা এবং ঘ\u09A1\u09BCি\u200C';
  const precomposed = 'আ\u09DFনা এবং ঘ\u09DCি';

  assert.equal(normalizeBanglaUnicode(decomposed), normalizeBanglaUnicode(precomposed));
  assert.equal(matchesBanglaTerm(decomposed, 'আয়না'), true);
  assert.equal(matchesBanglaTerm(decomposed, 'ঘড়ি'), true);
});

test('3. Conservative English plural and possessive matching without false-positive substring or verb matches', () => {
  const boatForms = generateConservativeEnglishWordForms('boat');
  assert.ok(boatForms.includes('boat'));
  assert.ok(boatForms.includes('boats'));
  assert.ok(boatForms.includes("boat's"));
  assert.ok(boatForms.includes("boats'"));

  const ferryForms = generateConservativeEnglishWordForms('ferry');
  assert.ok(ferryForms.includes('ferry'));
  assert.ok(ferryForms.includes('ferries'));

  const boatItem = normalizeTerminologyItem({
    id: 't-boat',
    englishTerm: 'boat',
    banglaTranslation: 'নৌকা',
    category: 'nautical',
  });

  // Positive matches: singular, plural, possessive
  const positiveMatches = findEnglishTermOccurrences(
    "The boat drifted near the other boats, and the boat's lantern gleamed.",
    boatItem
  );
  assert.equal(positiveMatches.length, 3);
  assert.deepEqual(
    positiveMatches.map((m) => m.matchedText),
    ['boat', 'boats', "boat's"]
  );

  // False-positive prevention: must NOT match inside "steamboat", "houseboat", "motor-boat", "boast", "boating"
  const falsePositiveText =
    'A steamboat passed the houseboat while motor-boat crews were boating and began to boast.';
  const falseMatches = findEnglishTermOccurrences(falsePositiveText, boatItem);
  assert.equal(falseMatches.length, 0);

  // Verb forms ("mirrored", "mirroring", "schooled", "schooling") must NOT match noun entries
  const mirrorItem = normalizeTerminologyItem({
    id: 't-mirror',
    englishTerm: 'mirror',
    banglaTranslation: 'আয়না',
    category: 'object',
  });
  const schoolItem = normalizeTerminologyItem({
    id: 't-school',
    englishTerm: 'school',
    banglaTranslation: 'পাঠশালা',
    category: 'cultural',
  });

  assert.equal(
    findEnglishTermOccurrences(
      'The calm bay mirrored the clouds, mirroring the sky where he was schooled in navigation and schooling.',
      mirrorItem
    ).length,
    0
  );
  assert.equal(
    findEnglishTermOccurrences(
      'The calm bay mirrored the clouds, mirroring the sky where he was schooled in navigation and schooling.',
      schoolItem
    ).length,
    0
  );

  // Case-sensitive matching for proper titles ("Keeper" vs "keeper")
  const keeperTitle = normalizeTerminologyItem({
    id: 't-keeper',
    englishTerm: 'Keeper',
    banglaTranslation: 'প্রহরী',
    category: 'title',
    caseSensitive: true,
  });
  const keeperSpans = findEnglishTermOccurrences(
    'The old Keeper stood silent; he was his brother’s keeper no more.',
    keeperTitle
  );
  assert.equal(keeperSpans.length, 1);
  assert.equal(keeperSpans[0].matchedText, 'Keeper');
});

test('4. Phrase-first English matching masks sub-terms inside phrases WITHOUT suppressing independent occurrences', () => {
  const glossary = normalizeGlossaryList([
    {
      id: 't-lantern',
      englishTerm: 'lantern',
      banglaTranslation: 'লণ্ঠন',
      category: 'object',
    },
    {
      id: 't-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
    },
  ]);

  // Case A: Only "lantern room" appears -> "lantern" must NOT match separately
  const onlyPhraseMatches = matchGlossaryInEnglishText(
    'He climbed the spiral stairs into the lantern room before dusk.',
    glossary
  );
  assert.equal(onlyPhraseMatches.length, 1);
  assert.equal(onlyPhraseMatches[0].item.id, 't-lantern-room');
  assert.equal(onlyPhraseMatches[0].occurrences.length, 1);

  // Case B: Both "lantern room" AND an independent "lantern" appear in the same sentence
  const bothMatches = matchGlossaryInEnglishText(
    'He entered the lantern room and lifted the brass lantern from the table.',
    glossary
  );
  assert.equal(bothMatches.length, 2);
  assert.equal(bothMatches[0].item.id, 't-lantern-room');
  assert.equal(bothMatches[0].occurrences.length, 1);
  assert.equal(bothMatches[0].occurrences[0].matchedText, 'lantern room');

  assert.equal(bothMatches[1].item.id, 't-lantern');
  assert.equal(bothMatches[1].occurrences.length, 1);
  assert.equal(bothMatches[1].occurrences[0].matchedText, 'lantern');
  // Verify the matched span for "lantern" is the second occurrence ("brass lantern"), not the one inside "lantern room"
  assert.ok(bothMatches[1].occurrences[0].start > bothMatches[0].occurrences[0].end);
});

test('5. Carefully bounded Bangla inflection matching and false-positive rejection', () => {
  // Vowel-ending vs consonant-ending phonological check
  assert.equal(endsWithBanglaVowel('নৌকা'), true);
  assert.equal(endsWithBanglaVowel('নৌকো'), true);
  assert.equal(endsWithBanglaVowel('আয়না'), true);
  assert.equal(endsWithBanglaVowel('পাঠশালা'), true);
  assert.equal(endsWithBanglaVowel('দীপকক্ষ'), false);
  assert.equal(endsWithBanglaVowel('দর্পণ'), false);
  assert.equal(endsWithBanglaVowel('স্কুল'), false);

  // Valid inflections for consonant-ending "দীপকক্ষ"
  for (const form of ['দীপকক্ষ', 'দীপকক্ষে', 'দীপকক্ষের', 'দীপকক্ষটি', 'দীপকক্ষটিতে', 'দীপকক্ষগুলো']) {
    assert.equal(
      matchesBanglaTerm(`তারা ${form} দাঁড়িয়ে ছিল।`, 'দীপকক্ষ'),
      true,
      `Expected "${form}" to match "দীপকক্ষ"`
    );
  }

  // Valid inflections for vowel-ending "নৌকা"
  for (const form of ['নৌকা', 'নৌকার', 'নৌকায়', 'নৌকাতে', 'নৌকাটি', 'নৌকাটির', 'নৌকাগুলো', 'নৌকাগুলোর']) {
    assert.equal(
      matchesBanglaTerm(`নদীর ঘাটে ${form} দেখা গেল।`, 'নৌকা'),
      true,
      `Expected "${form}" to match "নৌকা"`
    );
  }

  // Multi-word Bangla phrase inflections ("লণ্ঠন কক্ষ")
  for (const form of ['লণ্ঠন কক্ষ', 'লণ্ঠন কক্ষে', 'লণ্ঠন কক্ষের', 'লণ্ঠন-কক্ষে', 'লণ্ঠনকক্ষে']) {
    assert.equal(
      matchesBanglaTerm(`সে ${form} প্রবেশ করল।`, 'লণ্ঠন কক্ষ'),
      true,
      `Expected "${form}" to match "লণ্ঠন কক্ষ"`
    );
  }

  // False-positive rejection: arbitrary compounds or derivational suffixes must NOT match
  assert.equal(matchesBanglaTerm('নৌকাডুবি হয়েছিল।', 'নৌকা'), false);
  assert.equal(matchesBanglaTerm('নৌকাবাইচ দেখতে সবাই গেল।', 'নৌকা'), false);
  assert.equal(matchesBanglaTerm('ঘরোয়া পরিবেশে কথা হলো।', 'ঘর'), false);
  assert.equal(matchesBanglaTerm('ঘরণী প্রদীপ জ্বালালেন।', 'ঘর'), false);
  assert.equal(matchesBanglaTerm('সে দীপকক্ষে প্রবেশ করল।', 'দীপ'), false);
  assert.equal(matchesBanglaTerm('দূরের দ্বীপে আলো জ্বলছে।', 'দীপ'), false);
  assert.equal( isAllowedBanglaNominalSuffix('ঘর', 'র'), false); // consonant stem cannot take bare -র
  assert.equal(isAllowedBanglaNominalSuffix('নৌকা', 'ের'), false); // vowel stem cannot take -ের
});

test('6. Chunk-relevant glossary filtering prevents prompt bloat while preserving locked & core global terms', () => {
  const bulkGlossary: TerminologyMemoryItem[] = [];
  for (let i = 1; i <= 50; i++) {
    bulkGlossary.push(
      normalizeTerminologyItem({
        id: `bulk-obj-${i}`,
        englishTerm: `artifact${i}`,
        banglaTranslation: `নিদর্শন${i}`,
        category: 'object',
      })
    );
  }

  const coreTerms = normalizeGlossaryList([
    {
      id: 'char-elen',
      englishTerm: 'Elen',
      banglaTranslation: 'এলেন',
      category: 'name',
    },
    {
      id: 'place-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
      lockedByUser: true,
    },
    {
      id: 'obj-mirror',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      category: 'object',
    },
    {
      id: 'obj-lantern',
      englishTerm: 'lantern',
      banglaTranslation: 'লণ্ঠন',
      category: 'object',
    },
  ]);

  const fullGlossary = [...bulkGlossary, ...coreTerms];

  const chunkParagraphs = [
    'Inside the lantern room, the concave mirror caught the first pale beam.',
  ];

  const filtered = filterGlossaryForChunk(chunkParagraphs, fullGlossary, {
    maxGlobalTerms: 5,
  });

  // Only "lantern room" and "mirror" appear in the chunk ("lantern" is masked inside "lantern room")
  assert.deepEqual(
    filtered.matchedTerms.map((t) => t.id),
    ['place-lantern-room', 'obj-mirror']
  );

  // "Elen" (character name) is kept in supplementalGlobalTerms, while the 50 unrelated object terms are excluded
  assert.deepEqual(
    filtered.supplementalGlobalTerms.map((t) => t.id),
    ['char-elen']
  );
  assert.equal(filtered.activeTerms.length, 3);
});

test('7. Glossary merging strictly protects user-locked entries and persists chunk_ai discoveries', () => {
  const initialGlossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'term-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
      notes: 'User locked preference',
    }),
    {
      id: 'term-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      acceptedAlternatives: ['নৌকো'],
      category: 'nautical',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'River fishing boats',
    },
  ]);

  // Incoming AI merge tries to overwrite locked "lantern room" with "লণ্ঠন কক্ষ"
  // and adds a Stage 3 chunk discovery "wick" -> "সলতে"
  const afterAiMerge = mergeGlossaryItems(
    initialGlossary,
    [
      {
        englishTerm: 'Lantern Room',
        banglaTranslation: 'লণ্ঠন কক্ষ',
        category: 'place',
        source: 'stage1_ai',
        notes: 'AI re-extraction attempt',
      },
      {
        englishTerm: 'boats',
        banglaTranslation: 'জলযান',
        acceptedAlternatives: ['তরী'],
        avoidTranslations: ['জাহাজ'],
        category: 'nautical',
        source: 'stage1_ai',
      },
      {
        englishTerm: 'wick',
        banglaTranslation: 'সলতে',
        category: 'object',
        source: 'chunk_ai',
        notes: 'Discovered in Chunk 1',
      },
    ],
    { defaultSource: 'stage1_ai' }
  );

  assert.equal(afterAiMerge.length, 3);

  const lanternRoom = afterAiMerge.find((t) => t.englishTerm.toLowerCase() === 'lantern room')!;
  assert.equal(lanternRoom.banglaTranslation, 'দীপকক্ষ'); // User lock protected!
  assert.equal(lanternRoom.lockedByUser, true);
  assert.equal(lanternRoom.notes, 'User locked preference');

  const boats = afterAiMerge.find((t) => t.englishTerm.toLowerCase() === 'boats')!;
  // Unlocked AI entry preserves its established primary translation "নৌকা" while merging new alternatives/avoids
  assert.equal(boats.banglaTranslation, 'নৌকা');
  assert.deepEqual(boats.acceptedAlternatives, ['নৌকো', 'তরী']);
  assert.deepEqual(boats.avoidTranslations, ['জাহাজ']);
  assert.equal(boats.lockedByUser, false);

  const wick = afterAiMerge.find((t) => t.englishTerm.toLowerCase() === 'wick')!;
  assert.equal(wick.banglaTranslation, 'সলতে');
  assert.equal(wick.source, 'chunk_ai');
  assert.equal(wick.lockedByUser, false);

  // Distinct contextual homonyms (both context-sensitive with different contextMeaning) can coexist
  const withHomonyms = mergeGlossaryItems(afterAiMerge, [
    {
      englishTerm: 'vessel',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
      isContextSensitive: true,
      contextMeaning: 'Watercraft or river boat',
      source: 'stage1_ai',
    },
    {
      englishTerm: 'vessel',
      banglaTranslation: 'পাত্র',
      category: 'object',
      isContextSensitive: true,
      contextMeaning: 'Brass oil container for the lamp',
      source: 'stage1_ai',
    },
  ]);

  const vessels = withHomonyms.filter((t) => t.englishTerm === 'vessel');
  assert.equal(vessels.length, 2);
});

test('8. Lantern Keeper baseline chapter linting: severities, accepted variants, contextual review, and paraphrase safety', () => {
  const lanternKeeperGlossary = normalizeGlossaryList([
    // 1. User-locked architectural room with explicit avoid list
    createUserTerminologyItem({
      id: 'term-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
      notes: 'Top chamber housing the beacon lens',
    }),
    // 2. Unlocked AI-extracted nautical term with accepted alternatives and explicit avoid list
    {
      id: 'term-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      acceptedAlternatives: ['নৌকো', 'তরী'],
      avoidTranslations: ['জাহাজ', 'জলযান'],
      category: 'nautical',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Small wooden fishing craft in the estuary',
    },
    // 3. Unlocked AI-extracted object term (no explicit avoid list; tests cross-paragraph & doublet drift)
    {
      id: 'term-mirror',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Silvered reflector behind the flame',
    },
    // 4. Unlocked AI-extracted title term
    {
      id: 'term-chapter',
      englishTerm: 'chapter',
      banglaTranslation: 'অধ্যায়',
      category: 'title',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Structural manuscript division',
    },
    // 5. Context-sensitive cultural term
    {
      id: 'term-school',
      englishTerm: 'school',
      banglaTranslation: 'পাঠশালা',
      acceptedAlternatives: ['স্কুল'],
      category: 'cultural',
      isContextSensitive: true,
      contextMeaning: 'Village primary schoolhouse vs modern school',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Use পাঠশালা for rural nostalgia, স্কুল when modern',
    },
  ]);

  const chapterParagraphs: ParagraphPair[] = [
    {
      // P0 (Paragraph 1): Clean preferred and accepted usage with Bangla inflections
      index: 0,
      englishText:
        'Chapter One. In the lantern room, Elen wiped the curved mirror while the fishing boats gathered below near the old village school.',
      banglaText:
        'প্রথম অধ্যায়। দীপকক্ষে দাঁড়িয়ে এলেন বাঁকানো আয়নাটি মুছে নিল, আর নিচে পুরোনো গ্রামের পাঠশালাটির কাছে মাছ ধরার নৌকোগুলো জড়ো হলো।',
    },
    {
      // P1 (Paragraph 2): Drift across chunk boundary!
      // - "lantern room" translated as "লণ্ঠন কক্ষে" (explicit avoid + user-locked -> HIGH)
      // - "boats" translated as "জলযানগুলো" (explicit avoid -> HIGH)
      // - "mirror" translated as "দর্পণে" (unlocked AI doublet drift -> MEDIUM)
      // - "chapter" translated as "পরিচ্ছেদে" (unlocked AI drift -> MEDIUM)
      // - "school" translated as "বিদ্যালয়ে" (context-sensitive unapproved variant -> LOW)
      index: 1,
      englishText:
        'By the end of the chapter, the wind rattled the lantern room, the mirror trembled, and the boats sought shelter behind the school.',
      banglaText:
        'এই পরিচ্ছেদের শেষে বাতাসে লণ্ঠন কক্ষে কাঁপন ধরল, দর্পণে আলো কেঁপে উঠল, আর জলযানগুলো গ্রামের বিদ্যালয়ের পেছনে আশ্রয় নিল।',
    },
    {
      // P2 (Paragraph 3): Legitimate literary paraphrasing / pronoun ellipsis for unlocked "boats" & "mirror"
      // Must NOT trigger false-positive definite violations!
      index: 2,
      englishText:
        'From the lantern room, he watched the boats vanish into the fog until nothing remained on the mirror of the water.',
      banglaText:
        'দীপকক্ষের জানালা দিয়ে সে কুয়াশার ভেতর সেগুলোর মিলিয়ে যাওয়া দেখল, যতক্ষণ না জলের বুকে আর কোনো ছায়াই অবশিষ্ট রইল।',
    },
  ];

  // Snapshot original Bangla texts to verify non-mutation
  const originalBanglaSnapshot = chapterParagraphs.map((p) => p.banglaText);

  const lintResult = lintChapterTerminology(chapterParagraphs, lanternKeeperGlossary);

  // Requirement 1: Never automatically rewrite Bangla translation text
  assert.deepEqual(
    chapterParagraphs.map((p) => p.banglaText),
    originalBanglaSnapshot
  );

  // Paragraph 1 (index 0) must have 0 findings
  assert.equal(lintResult.paragraphResults[0].findings.length, 0);
  assert.equal(lintResult.paragraphResults[0].satisfiedTermIds.length, 4); // chapter, lantern room, mirror, school
  assert.equal(lintResult.paragraphResults[0].acceptedVariantTermIds.length, 1); // boats -> নৌকোগুলো

  // Paragraph 3 (index 2) must have 0 findings:
  // "lantern room" matched "দীপকক্ষের", while unlocked "boats" and "mirror" were paraphrased without avoid/competing nouns
  assert.equal(lintResult.paragraphResults[2].findings.length, 0);
  assert.deepEqual(lintResult.paragraphResults[2].satisfiedTermIds, ['term-lantern-room']);
  assert.equal(lintResult.paragraphResults[2].paraphrasedOrOmittedTermIds.length, 2);

  // Paragraph 2 (index 1) must have exactly 5 structured findings with exact severities
  const p2Findings = lintResult.paragraphResults[1].findings;
  assert.equal(p2Findings.length, 5);

  const lanternRoomFinding = p2Findings.find((f) => f.termId === 'term-lantern-room')!;
  assert.equal(lanternRoomFinding.severity, 'high');
  assert.equal(lanternRoomFinding.classification, 'definite_violation');
  assert.equal(lanternRoomFinding.reason, 'avoid_term_used');
  assert.equal(lanternRoomFinding.detectedBanglaVariant, 'লণ্ঠন কক্ষে');
  assert.equal(lanternRoomFinding.displayParagraphNumber, 2);

  const boatsFinding = p2Findings.find((f) => f.termId === 'term-boats')!;
  assert.equal(boatsFinding.severity, 'high');
  assert.equal(boatsFinding.classification, 'definite_violation');
  assert.equal(boatsFinding.reason, 'avoid_term_used');
  assert.equal(boatsFinding.detectedBanglaVariant, 'জলযানগুলো');

  const mirrorFinding = p2Findings.find((f) => f.termId === 'term-mirror')!;
  assert.equal(mirrorFinding.severity, 'medium');
  assert.equal(mirrorFinding.classification, 'definite_violation');
  assert.equal(mirrorFinding.reason, 'cross_paragraph_drift');
  assert.equal(mirrorFinding.detectedBanglaVariant, 'দর্পণে');

  const chapterFinding = p2Findings.find((f) => f.termId === 'term-chapter')!;
  assert.equal(chapterFinding.severity, 'medium');
  assert.equal(chapterFinding.classification, 'definite_violation');
  assert.equal(chapterFinding.reason, 'cross_paragraph_drift');
  assert.equal(chapterFinding.detectedBanglaVariant, 'পরিচ্ছেদের');

  const schoolFinding = p2Findings.find((f) => f.termId === 'term-school')!;
  assert.equal(schoolFinding.severity, 'low');
  assert.equal(schoolFinding.classification, 'contextual_review');
  assert.equal(schoolFinding.reason, 'contextual_review_needed');
  assert.equal(schoolFinding.detectedBanglaVariant, 'বিদ্যালয়ের');

  // Verify summary counts and VerificationIssue conversion
  assert.equal(lintResult.summary.highSeverityCount, 2);
  assert.equal(lintResult.summary.mediumSeverityCount, 2);
  assert.equal(lintResult.summary.lowSeverityCount, 1);
  assert.equal(lintResult.summary.definiteViolationCount, 4);
  assert.equal(lintResult.summary.contextualReviewCount, 1);
  assert.equal(lintResult.issues.length, 5);

  const sampleIssue = terminologyFindingToVerificationIssue(lanternRoomFinding);
  assert.equal(sampleIssue.type, 'terminology');
  assert.equal(sampleIssue.severity, 'high');
  assert.equal(sampleIssue.paragraphIndex, 1);
  assert.equal(lanternRoomFinding.paragraphIndex, 1);
  assert.equal(lanternRoomFinding.displayParagraphNumber, 2);
  assert.equal(sampleIssue.resolved, false);
});

test('9. Phrase-level Bangla consumption prevents "লণ্ঠন" inside "লণ্ঠন কক্ষে" from satisfying an independent "lantern" occurrence', () => {
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'term-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
    }),
    createUserTerminologyItem({
      id: 'term-lantern',
      englishTerm: 'lantern',
      banglaTranslation: 'লণ্ঠন',
      category: 'object',
    }),
  ]);

  // English has BOTH "lantern room" AND an independent "lantern".
  // Bangla uses "লণ্ঠন কক্ষে" for "lantern room" and completely omits the second "lantern".
  const paragraph: ParagraphPair = {
    index: 0,
    englishText: 'He entered the lantern room and lit the small brass lantern.',
    banglaText: 'সে লণ্ঠন কক্ষে প্রবেশ করল এবং আগুন জ্বালাল।',
  };

  const res = lintParagraphTerminology(paragraph, glossary);
  assert.equal(res.findings.length, 2);

  const roomFinding = res.findings.find((f) => f.termId === 'term-lantern-room')!;
  assert.equal(roomFinding.reason, 'avoid_term_used');
  assert.equal(roomFinding.severity, 'high');

  const lanternFinding = res.findings.find((f) => f.termId === 'term-lantern')!;
  assert.equal(lanternFinding.reason, 'locked_term_missing');
  assert.equal(lanternFinding.severity, 'high');
});

test('10. Phase 2A.1 Regression: Singular words ending in -s and -ies (lens, lenses, Charles, James, series, species)', () => {
  const lensForms = generateConservativeEnglishWordForms('lens');
  const lensesForms = generateConservativeEnglishWordForms('lenses');

  // Must generate lens and lenses and possessives, without bogus "len" or "lense"
  assert.ok(lensForms.includes('lens'));
  assert.ok(lensForms.includes('lenses'));
  assert.ok(lensForms.includes("lens's"));
  assert.ok(lensForms.includes('lens’s'));
  assert.equal(lensForms.includes('len'), false);
  assert.equal(lensForms.includes('lense'), false);

  assert.ok(lensesForms.includes('lens'));
  assert.ok(lensesForms.includes('lenses'));
  assert.equal(lensesForms.includes('len'), false);
  assert.equal(lensesForms.includes('lense'), false);

  // Proper names ending in -s must not have -s stripped into bogus stems
  const charlesForms = generateConservativeEnglishWordForms('Charles');
  assert.ok(charlesForms.includes('Charles'));
  assert.ok(charlesForms.includes("Charles's"));
  assert.ok(charlesForms.includes("Charles'"));
  assert.equal(charlesForms.includes('Charle'), false);

  const jamesForms = generateConservativeEnglishWordForms('James');
  assert.ok(jamesForms.includes('James'));
  assert.equal(jamesForms.includes('Jame'), false);

  // Invariant -ies nouns must not strip -ies to -y
  const seriesForms = generateConservativeEnglishWordForms('series');
  assert.ok(seriesForms.includes('series'));
  assert.equal(seriesForms.includes('sery'), false);

  const speciesForms = generateConservativeEnglishWordForms('species');
  assert.ok(speciesForms.includes('species'));
  assert.equal(speciesForms.includes('specy'), false);

  // End-to-end occurrence matching between "lens" entry and "lenses" in text (and vice versa)
  const lensItem = normalizeTerminologyItem({
    id: 't-lens',
    englishTerm: 'lens',
    banglaTranslation: 'লেন্স',
    category: 'object',
  });
  const lensSpans = findEnglishTermOccurrences(
    "The main lens and the auxiliary lenses reflected the lens's glow, while Len watched.",
    lensItem
  );
  assert.deepEqual(
    lensSpans.map((s) => s.matchedText),
    ['lens', 'lenses', "lens's"]
  );
});

test("11. Phase 2A.1 Regression: Curly and straight apostrophes in non-final phrase tokens (keeper's log / keeper’s log)", () => {
  const straightItem = normalizeTerminologyItem({
    id: 't-keepers-log',
    englishTerm: "keeper's log",
    banglaTranslation: 'প্রহরীর রোজনামচা',
    category: 'object',
  });

  const curlyItem = normalizeTerminologyItem({
    id: 't-keepers-log-curly',
    englishTerm: 'keeper’s log',
    banglaTranslation: 'প্রহরীর রোজনামচা',
    category: 'object',
  });

  const textWithBoth =
    "He opened the keeper’s log at midnight and compared it with the earlier keeper's logs.";

  const matchesFromStraight = findEnglishTermOccurrences(textWithBoth, straightItem);
  assert.equal(matchesFromStraight.length, 2);
  assert.deepEqual(
    matchesFromStraight.map((m) => m.matchedText),
    ['keeper’s log', "keeper's logs"]
  );

  const matchesFromCurly = findEnglishTermOccurrences(textWithBoth, curlyItem);
  assert.equal(matchesFromCurly.length, 2);
});

test('12. Phase 2A.1 Regression: Unrelated Bangla words sharing compound-head endings must not trigger false positives', () => {
  const glossary = normalizeGlossaryList([
    {
      id: 't-watercraft',
      englishTerm: 'watercraft',
      banglaTranslation: 'জলযান',
      category: 'nautical',
      lockedByUser: false,
    },
    {
      id: 't-lighthouse',
      englishTerm: 'lighthouse',
      banglaTranslation: 'বাতিঘর',
      category: 'object',
      lockedByUser: false,
    },
  ]);

  // "জলযান" is paraphrased as "সেটি", while the sentence contains unrelated "অভিযান" (expedition) and "চলে যান" (go away)
  const p1: ParagraphPair = {
    index: 0,
    englishText: 'The watercraft vanished as the captain launched his expedition and told them to leave.',
    banglaText: 'ক্যাপ্টেন তার অভিযান শুরু করতেই সেটি অদৃশ্য হয়ে গেল এবং তিনি সবাইকে চলে যান বললেন।',
  };
  const res1 = lintParagraphTerminology(p1, glossary);
  assert.equal(res1.findings.length, 0);

  // "বাতিঘর" is paraphrased as "সুউচ্চ মিনার", while the sentence contains unrelated "রান্নাঘর" (kitchen) and "শোবার ঘর" (bedroom)
  const p2: ParagraphPair = {
    index: 1,
    englishText: 'From the lighthouse, the beam reached the kitchen and bedroom windows.',
    banglaText: 'সুউচ্চ মিনার থেকে আলোর রেখা রান্নাঘর এবং শোবার ঘরের জানালায় এসে পড়ল।',
  };
  const res2 = lintParagraphTerminology(p2, glossary);
  assert.equal(res2.findings.length, 0);
});

test('13. Phase 2A.1 Regression: Correct boats and ship translations coexisting with an avoid-list entry', () => {
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 't-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      avoidTranslations: ['জাহাজ', 'জলযান'],
      category: 'nautical',
    }),
    createUserTerminologyItem({
      id: 't-ship',
      englishTerm: 'ship',
      banglaTranslation: 'জাহাজ',
      category: 'nautical',
    }),
  ]);

  // Both "boats" (নৌকাগুলো) and "ship" (জাহাজটির) are translated accurately
  const validCoexistence: ParagraphPair = {
    index: 0,
    englishText: 'The fishing boats passed the cargo ship.',
    banglaText: 'মাছ ধরার নৌকাগুলো মালবাহী জাহাজটির পাশ দিয়ে গেল।',
  };

  const cleanResult = lintParagraphTerminology(validCoexistence, glossary);
  assert.equal(cleanResult.findings.length, 0);
  assert.deepEqual(cleanResult.satisfiedTermIds.sort(), ['t-boats', 't-ship']);

  // Repeated "boats" where one occurrence is "নৌকাগুলো" and the second occurrence genuinely drifts to "জলযানগুলো"
  // must STILL be caught as an avoid-list violation!
  const repeatedWithDrift: ParagraphPair = {
    index: 1,
    englishText: 'The fishing boats passed the cargo ship while smaller boats followed behind.',
    banglaText: 'মাছ ধরার নৌকাগুলো মালবাহী জাহাজটির পাশ দিয়ে গেল আর পেছনে ছোট জলযানগুলো আসতে লাগল।',
  };

  const driftResult = lintParagraphTerminology(repeatedWithDrift, glossary);
  assert.equal(driftResult.findings.length, 1);
  assert.equal(driftResult.findings[0].termId, 't-boats');
  assert.equal(driftResult.findings[0].reason, 'avoid_term_used');
  assert.equal(driftResult.findings[0].detectedBanglaVariant, 'জলযানগুলো');
  assert.equal(driftResult.findings[0].severity, 'high');
});

test('14. Phase 2A.1 Regression: Contextual vessel homonyms where one sense is translated', () => {
  const glossary = normalizeGlossaryList([
    {
      id: 'v-boat',
      englishTerm: 'vessel',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
      isContextSensitive: true,
      contextMeaning: 'boat',
    },
    {
      id: 'v-container',
      englishTerm: 'vessel',
      banglaTranslation: 'পাত্র',
      category: 'object',
      isContextSensitive: true,
      contextMeaning: 'container',
    },
  ]);

  // Single occurrence of "vessel" translated in its boat sense ("নৌকাটি")
  const pBoat: ParagraphPair = {
    index: 0,
    englishText: 'The vessel rocked on the river.',
    banglaText: 'নদীর বুকে নৌকাটি দুলছিল।',
  };

  const boatRes = lintParagraphTerminology(pBoat, glossary);
  assert.equal(boatRes.findings.length, 0);
  assert.deepEqual(boatRes.satisfiedTermIds, ['v-boat']);

  // Single occurrence of "vessel" translated in its container sense ("পাত্রটি")
  const pContainer: ParagraphPair = {
    index: 1,
    englishText: 'He filled the brass vessel with oil.',
    banglaText: 'সে পিতলের পাত্রটি তেল দিয়ে পূর্ণ করল।',
  };

  const containerRes = lintParagraphTerminology(pContainer, glossary);
  assert.equal(containerRes.findings.length, 0);
  assert.deepEqual(containerRes.satisfiedTermIds, ['v-container']);

  // Differing caseSensitive flags on homonyms must not suppress each other when matching capitalized "Vessel"
  const mixedCaseGlossary = normalizeGlossaryList([
    {
      id: 'v-cap',
      englishTerm: 'Vessel',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
      caseSensitive: true,
      isContextSensitive: true,
      contextMeaning: 'boat',
    },
    {
      id: 'v-lower',
      englishTerm: 'vessel',
      banglaTranslation: 'পাত্র',
      category: 'object',
      caseSensitive: false,
      isContextSensitive: true,
      contextMeaning: 'container',
    },
  ]);

  const englishMatches = matchGlossaryInEnglishText(
    'Vessel of brass stood on the table.',
    mixedCaseGlossary
  );
  assert.equal(englishMatches.length, 2);

  const mixedLint = lintParagraphTerminology(
    {
      index: 2,
      englishText: 'Vessel of brass stood on the table.',
      banglaText: 'টেবিলের ওপর পিতলের পাত্রটি রাখা ছিল।',
    },
    mixedCaseGlossary
  );
  assert.equal(mixedLint.findings.length, 0);
  assert.deepEqual(mixedLint.satisfiedTermIds, ['v-lower']);
});

test('15. Phase 2A.1 Regression: Explicit user unlock and updated translation survive merge and respect unlocked state', () => {
  const lockedMirror = createUserTerminologyItem({
    id: 'term-mirror',
    englishTerm: 'mirror',
    banglaTranslation: 'আয়না',
    category: 'object',
    notes: 'Initial locked choice',
  });
  assert.equal(lockedMirror.lockedByUser, true);

  // User updates translation to "দর্পণ" and explicitly unlocks the entry
  const unlockedMirror = updateUserTerminologyItem(lockedMirror, {
    banglaTranslation: 'দর্পণ',
    lockedByUser: false,
  });
  assert.equal(unlockedMirror.banglaTranslation, 'দর্পণ');
  assert.equal(unlockedMirror.lockedByUser, false);
  assert.equal(unlockedMirror.source, 'user');

  // Merging that user update into [lockedMirror] must preserve "দর্পণ" and lockedByUser: false
  const mergedAfterUnlock = mergeGlossaryItems([lockedMirror], [unlockedMirror]);
  assert.equal(mergedAfterUnlock.length, 1);
  assert.equal(mergedAfterUnlock[0].id, 'term-mirror');
  assert.equal(mergedAfterUnlock[0].banglaTranslation, 'দর্পণ');
  assert.equal(mergedAfterUnlock[0].lockedByUser, false);

  // Subsequent AI merge respects the resulting unlocked state (enriches alternatives/avoid while keeping lockedByUser: false)
  const afterSubsequentAiMerge = mergeGlossaryItems(mergedAfterUnlock, [
    {
      englishTerm: 'mirror',
      banglaTranslation: 'দর্পণ',
      acceptedAlternatives: ['মুকুর'],
      avoidTranslations: ['আরশি'],
      source: 'stage1_ai',
    },
  ]);
  assert.equal(afterSubsequentAiMerge[0].banglaTranslation, 'দর্পণ');
  assert.deepEqual(afterSubsequentAiMerge[0].acceptedAlternatives, ['মুকুর']);
  assert.deepEqual(afterSubsequentAiMerge[0].avoidTranslations, ['আরশি']);
  assert.equal(afterSubsequentAiMerge[0].lockedByUser, false);
});

test('16. Phase 2A.1 Regression: Deduplicate identical glossary keys and disambiguate conflicting IDs without altering valid IDs', () => {
  // Two duplicate entries for "lantern room" with different IDs + two distinct entries sharing a colliding ID "shared-id"
  const rawList: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'lr-1',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
      lockedByUser: true,
    },
    {
      id: 'lr-2',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      acceptedAlternatives: ['আলোককক্ষ'],
      category: 'place',
      lockedByUser: true,
    },
    {
      id: 'shared-id',
      englishTerm: 'compass',
      banglaTranslation: 'কম্পাস',
      category: 'object',
    },
    {
      id: 'shared-id',
      englishTerm: 'anchor',
      banglaTranslation: 'নোঙর',
      category: 'nautical',
    },
  ];

  const normalized = normalizeGlossaryList(rawList);
  // 2 duplicate "lantern room" entries merged into 1, plus "compass" and "anchor" = 3 entries total
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].id, 'lr-1'); // Existing valid ID preserved!
  assert.deepEqual(normalized[0].acceptedAlternatives, ['আলোককক্ষ']);

  assert.equal(normalized[1].id, 'shared-id'); // First occurrence keeps its original ID
  assert.equal(normalized[2].id, 'shared-id-2'); // Colliding ID on distinct term disambiguated deterministically

  // Linting a valid paragraph against the raw duplicate glossary must produce 0 false positives
  const lintRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'He entered the lantern room with a compass and an anchor.',
      banglaText: 'সে কম্পাস ও নোঙর নিয়ে দীপকক্ষে প্রবেশ করল।',
    },
    rawList as TerminologyMemoryItem[]
  );
  assert.equal(lintRes.findings.length, 0);
  assert.equal(lintRes.satisfiedTermIds.length, 3);
});

test('17. Phase 2A.2 Regression: Occurrence-bounded Bangla span consumption (repeated boats + ship and shared preferred translations)', () => {
  const boatsAndShipGlossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 't-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      avoidTranslations: ['জাহাজ'],
      category: 'nautical',
    }),
    createUserTerminologyItem({
      id: 't-ship',
      englishTerm: 'ship',
      banglaTranslation: 'জাহাজ',
      category: 'nautical',
    }),
  ]);

  // "ship" occurs once ("জাহাজটির"), while "boats" occurs twice ("নৌকাগুলো" and avoided "জাহাজগুলো").
  // "ship" must consume only 1 "জাহাজ" span ("জাহাজটির"), leaving "জাহাজগুলো" to be caught as an avoid-list violation for "boats".
  const repeatedBoatsParagraph: ParagraphPair = {
    index: 0,
    englishText: 'The boats passed the ship. The boats returned.',
    banglaText: 'নৌকাগুলো জাহাজটির পাশ দিয়ে গেল। জাহাজগুলো ফিরে এল।',
  };

  const repeatedRes = lintParagraphTerminology(repeatedBoatsParagraph, boatsAndShipGlossary);
  assert.equal(repeatedRes.findings.length, 1);
  assert.equal(repeatedRes.findings[0].termId, 't-boats');
  assert.equal(repeatedRes.findings[0].reason, 'avoid_term_used');
  assert.equal(repeatedRes.findings[0].detectedBanglaVariant, 'জাহাজগুলো');
  assert.equal(repeatedRes.findings[0].severity, 'high');
  assert.ok(repeatedRes.satisfiedTermIds.includes('t-ship'));

  // Two distinct English terms sharing the same preferred Bangla translation ("boat" -> "নৌকা", "skiff" -> "নৌকা")
  const sharedPreferredGlossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 't-boat',
      englishTerm: 'boat',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
    }),
    createUserTerminologyItem({
      id: 't-skiff',
      englishTerm: 'skiff',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
    }),
  ]);

  const sharedPreferredParagraph: ParagraphPair = {
    index: 1,
    englishText: 'The boat passed the skiff.',
    banglaText: 'নৌকাটি ছোট নৌকাটির পাশ দিয়ে গেল।',
  };

  const sharedRes = lintParagraphTerminology(sharedPreferredParagraph, sharedPreferredGlossary);
  assert.equal(sharedRes.findings.length, 0);
  assert.deepEqual(sharedRes.satisfiedTermIds.sort(), ['t-boat', 't-skiff']);
});

test('18. Phase 2A.2 Regression: Multi-word compound reservation for unapproved variants (spaced, hyphenated, and joined)', () => {
  // Glossary without explicit avoidTranslations on "lantern room" (relying on semantic compound matcher)
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'term-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
    }),
    createUserTerminologyItem({
      id: 'term-lantern',
      englishTerm: 'lantern',
      banglaTranslation: 'লণ্ঠন',
      category: 'object',
    }),
  ]);

  for (const compoundForm of ['লণ্ঠন কক্ষে', 'লণ্ঠন-কক্ষে', 'লণ্ঠনকক্ষে']) {
    const res = lintParagraphTerminology(
      {
        index: 0,
        englishText: 'He entered the lantern room and lit the small brass lantern.',
        banglaText: `সে ${compoundForm} প্রবেশ করল এবং আগুন জ্বালাল।`,
      },
      glossary
    );

    assert.equal(
      res.findings.length,
      2,
      `Expected 2 findings for compound form "${compoundForm}"`
    );

    const roomFinding = res.findings.find((f) => f.termId === 'term-lantern-room')!;
    assert.equal(roomFinding.reason, 'unapproved_variant_used');
    assert.equal(roomFinding.detectedBanglaVariant, compoundForm);
    assert.equal(roomFinding.severity, 'high');

    const lanternFinding = res.findings.find((f) => f.termId === 'term-lantern')!;
    assert.equal(lanternFinding.reason, 'locked_term_missing');
    assert.equal(lanternFinding.severity, 'high');
  }
});

test('19. Phase 2A.2 Regression: Duplicate normalization preserves avoidTranslations and respects explicit user unlocks', () => {
  // Regression Case A — avoid-list preservation when normalizing user-locked entry alongside conflicting AI duplicate
  const normalizedCaseA = normalizeGlossaryList([
    {
      id: 'lr-user',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
      lockedByUser: true,
    },
    {
      id: 'lr-ai',
      englishTerm: 'lantern room',
      banglaTranslation: 'লণ্ঠন কক্ষ',
      category: 'place',
      source: 'stage1_ai',
      lockedByUser: false,
    },
  ]);

  assert.equal(normalizedCaseA.length, 1);
  assert.equal(normalizedCaseA[0].id, 'lr-user');
  assert.equal(normalizedCaseA[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(normalizedCaseA[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(normalizedCaseA[0].acceptedAlternatives, []);
  assert.equal(normalizedCaseA[0].lockedByUser, true);

  // Also verify reverse order (AI entry first, user-locked entry second)
  const normalizedCaseAReverse = normalizeGlossaryList([
    {
      id: 'lr-ai',
      englishTerm: 'lantern room',
      banglaTranslation: 'লণ্ঠন কক্ষ',
      category: 'place',
      source: 'stage1_ai',
      lockedByUser: false,
    },
    {
      id: 'lr-user',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
      lockedByUser: true,
    },
  ]);

  assert.equal(normalizedCaseAReverse.length, 1);
  assert.equal(normalizedCaseAReverse[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(normalizedCaseAReverse[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(normalizedCaseAReverse[0].acceptedAlternatives, []);
  assert.equal(normalizedCaseAReverse[0].lockedByUser, true);

  // Regression Case B — user unlock without explicit source: 'user' in both normalizeGlossaryList and mergeGlossaryItems
  const existingLockedMirror: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'term-mirror',
    englishTerm: 'mirror',
    banglaTranslation: 'আয়না',
    category: 'object',
    lockedByUser: true,
  });

  const rawUnlockUpdate: Partial<TerminologyMemoryItem> = {
    englishTerm: 'mirror',
    banglaTranslation: 'দর্পণ',
    lockedByUser: false,
  };

  const mergedCaseB = mergeGlossaryItems([existingLockedMirror], [rawUnlockUpdate], {
    defaultSource: 'user',
  });
  assert.equal(mergedCaseB.length, 1);
  assert.equal(mergedCaseB[0].id, 'term-mirror');
  assert.equal(mergedCaseB[0].banglaTranslation, 'দর্পণ');
  assert.equal(mergedCaseB[0].lockedByUser, false);
  assert.deepEqual(mergedCaseB[0].acceptedAlternatives, []);

  const normalizedCaseB = normalizeGlossaryList([existingLockedMirror, rawUnlockUpdate]);
  assert.equal(normalizedCaseB.length, 1);
  assert.equal(normalizedCaseB[0].id, 'term-mirror');
  assert.equal(normalizedCaseB[0].banglaTranslation, 'দর্পণ');
  assert.equal(normalizedCaseB[0].lockedByUser, false);
  assert.deepEqual(normalizedCaseB[0].acceptedAlternatives, []);
});

test('20. Phase 2A.2 Regression: Mixed-case contextual homonym grouping and non-duplicate contextual review warnings', () => {
  const glossary = normalizeGlossaryList([
    {
      id: 'v-cap',
      englishTerm: 'Vessel',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
      caseSensitive: true,
      contextMeaning: 'boat',
    },
    {
      id: 'v-lower',
      englishTerm: 'vessel',
      banglaTranslation: 'পাত্র',
      category: 'object',
      caseSensitive: false,
      contextMeaning: 'container',
    },
  ]);

  // Capitalized "Vessel" is satisfied by "নৌকাটি" and lowercase "vessel" is satisfied by "পাত্র"
  const satisfiedBothRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'The Vessel carried a brass vessel.',
      banglaText: 'নৌকাটি একটি পিতলের পাত্র বহন করছিল।',
    },
    glossary
  );

  assert.equal(satisfiedBothRes.findings.length, 0);
  assert.deepEqual(satisfiedBothRes.satisfiedTermIds.sort(), ['v-cap', 'v-lower']);

  // When neither sense is translated appropriately for an occurrence, emit exactly 1 contextual review finding (no duplicate warning)
  const neitherSatisfiedSingle = lintParagraphTerminology(
    {
      index: 1,
      englishText: 'The Vessel rocked gently.',
      banglaText: 'নদীর বুকে ভেলাটি দুলছিল।',
    },
    glossary
  );

  assert.equal(neitherSatisfiedSingle.findings.length, 1);
  assert.equal(neitherSatisfiedSingle.findings[0].classification, 'contextual_review');
  assert.equal(neitherSatisfiedSingle.findings[0].reason, 'contextual_review_needed');
  assert.equal(neitherSatisfiedSingle.findings[0].severity, 'low');
});

test('21. Phase 2A.2 Regression: Proper-name morphology preserves final -s on Holmes, Dickens, Brooks, Lucas, Thomas, and category: name', () => {
  for (const name of ['Holmes', 'Dickens', 'Brooks', 'Lucas', 'Thomas']) {
    const stripped = name.slice(0, -1);
    const forms = generateConservativeEnglishWordForms(name);
    assert.ok(forms.includes(name), `Expected forms for "${name}" to include "${name}"`);
    assert.equal(
      forms.includes(stripped),
      false,
      `Expected "${name}" not to generate stripped form "${stripped}"`
    );
  }

  // Any glossary item with category: 'name' ending in -s (even an unlisted surname like "Baggins" or "Hawkins") must not strip -s
  const nameGlossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'n-holmes',
      englishTerm: 'Holmes',
      banglaTranslation: 'হোমস',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-dickens',
      englishTerm: 'Dickens',
      banglaTranslation: 'ডিকেন্স',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-brooks',
      englishTerm: 'Brooks',
      banglaTranslation: 'ব্রুকস',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-lucas',
      englishTerm: 'Lucas',
      banglaTranslation: 'লুকাস',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-thomas',
      englishTerm: 'Thomas',
      banglaTranslation: 'থমাস',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-hawkins',
      englishTerm: 'Hawkins',
      banglaTranslation: 'হকিন্স',
      category: 'name',
    }),
    createUserTerminologyItem({
      id: 'n-boat',
      englishTerm: 'boat',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
    }),
  ]);

  // "Holme", "Dicken", "Brook", "Luca", "Thoma", and "Hawkin" must NOT trigger false matches for the -s names,
  // while sentence-initial capitalized "Boats" (common noun) still matches "boat"
  const falseStemParagraph: ParagraphPair = {
    index: 0,
    englishText:
      'Boats waited near the brook and the holme while Luca and Hawkin spoke with Holmes and Thomas.',
    banglaText: 'নৌকাগুলো অপেক্ষা করছিল যখন হোমস এবং থমাস কথা বলছিলেন।',
  };

  const res = lintParagraphTerminology(falseStemParagraph, nameGlossary);
  assert.equal(res.findings.length, 0);
  assert.deepEqual(res.matchedTermIds.sort(), ['n-boat', 'n-holmes', 'n-thomas']);
  assert.deepEqual(res.satisfiedTermIds.sort(), ['n-boat', 'n-holmes', 'n-thomas']);
});

test('22. Phase 2A.3 Regression (Finding 3.1): AI items with lockedByUser: false and omitted source never masquerade as user unlocks', () => {
  const lockedUserEntry: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'u-lr',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
    category: 'place',
    source: 'user',
    lockedByUser: true,
  });

  // 1. Locked user entry + AI duplicate with omitted source and lockedByUser: false, defaultSource: 'stage1_ai'
  const case1 = mergeGlossaryItems(
    [lockedUserEntry],
    [{ englishTerm: 'lantern room', banglaTranslation: 'লণ্ঠন কক্ষ', lockedByUser: false }],
    { defaultSource: 'stage1_ai' }
  );
  assert.equal(case1.length, 1);
  assert.equal(case1[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(case1[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(case1[0].acceptedAlternatives, []);
  assert.equal(case1[0].lockedByUser, true);
  assert.equal(case1[0].source, 'user');

  // 2. Same case with defaultSource: 'chunk_ai'
  const case2 = mergeGlossaryItems(
    [lockedUserEntry],
    [{ englishTerm: 'lantern room', banglaTranslation: 'লণ্ঠন কক্ষ', lockedByUser: false }],
    { defaultSource: 'chunk_ai' }
  );
  assert.equal(case2.length, 1);
  assert.equal(case2[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(case2[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(case2[0].acceptedAlternatives, []);
  assert.equal(case2[0].lockedByUser, true);
  assert.equal(case2[0].source, 'user');

  // 3. Same case with explicit source: 'stage1_ai'
  const case3 = mergeGlossaryItems(
    [lockedUserEntry],
    [
      {
        englishTerm: 'lantern room',
        banglaTranslation: 'লণ্ঠন কক্ষ',
        source: 'stage1_ai',
        lockedByUser: false,
      },
    ]
  );
  assert.equal(case3.length, 1);
  assert.equal(case3[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(case3[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(case3[0].acceptedAlternatives, []);
  assert.equal(case3[0].lockedByUser, true);
  assert.equal(case3[0].source, 'user');

  // 4. Same case with explicit source: 'chunk_ai'
  const case4 = mergeGlossaryItems(
    [lockedUserEntry],
    [
      {
        englishTerm: 'lantern room',
        banglaTranslation: 'লণ্ঠন কক্ষ',
        source: 'chunk_ai',
        lockedByUser: false,
      },
    ]
  );
  assert.equal(case4.length, 1);
  assert.equal(case4[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(case4[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.deepEqual(case4[0].acceptedAlternatives, []);
  assert.equal(case4[0].lockedByUser, true);
  assert.equal(case4[0].source, 'user');

  // 5. Genuine user update with omitted source and lockedByUser: false, defaultSource: 'user'
  const case5 = mergeGlossaryItems(
    [lockedUserEntry],
    [{ englishTerm: 'lantern room', banglaTranslation: 'বাতিঘর কক্ষ', lockedByUser: false }],
    { defaultSource: 'user' }
  );
  assert.equal(case5.length, 1);
  assert.equal(case5[0].banglaTranslation, 'বাতিঘর কক্ষ');
  assert.equal(case5[0].lockedByUser, false);
  assert.equal(case5[0].source, 'user');

  // 6. Genuine user update with explicit source: 'user' (even with default stage1_ai options)
  const case6 = mergeGlossaryItems(
    [lockedUserEntry],
    [
      {
        englishTerm: 'lantern room',
        banglaTranslation: 'বাতিঘর কক্ষ',
        source: 'user',
        lockedByUser: false,
      },
    ],
    { defaultSource: 'stage1_ai' }
  );
  assert.equal(case6.length, 1);
  assert.equal(case6[0].banglaTranslation, 'বাতিঘর কক্ষ');
  assert.equal(case6[0].lockedByUser, false);
  assert.equal(case6[0].source, 'user');

  // 7. Reverse merge order & AI-to-AI merge must not silently convert AI entries into source: 'user'
  const aiExisting: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'ai-lr',
    englishTerm: 'lantern room',
    banglaTranslation: 'লণ্ঠন কক্ষ',
    category: 'place',
    source: 'stage1_ai',
    lockedByUser: false,
  });

  const reverseLockedMerge = mergeGlossaryItems([aiExisting], [lockedUserEntry], {
    defaultSource: 'stage1_ai',
  });
  assert.equal(reverseLockedMerge.length, 1);
  assert.equal(reverseLockedMerge[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(reverseLockedMerge[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.equal(reverseLockedMerge[0].lockedByUser, true);
  assert.equal(reverseLockedMerge[0].source, 'user');

  const aiToAiMerge = mergeGlossaryItems(
    [aiExisting],
    [{ englishTerm: 'lantern room', banglaTranslation: 'দীপকক্ষ', lockedByUser: false }],
    { defaultSource: 'chunk_ai' }
  );
  assert.equal(aiToAiMerge.length, 1);
  assert.equal(aiToAiMerge[0].banglaTranslation, 'লণ্ঠন কক্ষ');
  assert.equal(aiToAiMerge[0].lockedByUser, false);
  assert.equal(aiToAiMerge[0].source, 'stage1_ai');

  // 8. Repeated normalization and merge idempotence
  const idempotent1 = normalizeGlossaryList(normalizeGlossaryList(case5));
  const idempotent2 = mergeGlossaryItems(
    idempotent1,
    [{ englishTerm: 'lantern room', banglaTranslation: 'লণ্ঠন কক্ষ', lockedByUser: false }],
    { defaultSource: 'stage1_ai' }
  );
  assert.equal(idempotent2.length, 1);
  assert.equal(idempotent2[0].banglaTranslation, 'বাতিঘর কক্ষ');
  assert.equal(idempotent2[0].lockedByUser, false);
  assert.equal(idempotent2[0].source, 'user');
});

test('23. Phase 2A.3 Regression (Finding 2.1): Compound reservations never steal another entrys approved translation across spaced, hyphenated, and joined forms', () => {
  const lanternRoomEntry = createUserTerminologyItem({
    id: 'g-lantern-room',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    category: 'place',
  });

  for (const approvedForm of ['লণ্ঠন কক্ষ', 'লণ্ঠন-কক্ষ', 'লণ্ঠনকক্ষ']) {
    const lampRoomEntry = createUserTerminologyItem({
      id: 'g-lamp-room',
      englishTerm: 'lamp room',
      banglaTranslation: approvedForm,
      category: 'place',
    });

    for (const textSurface of ['লণ্ঠন কক্ষে', 'লণ্ঠন-কক্ষে', 'লণ্ঠনকক্ষে']) {
      const paragraph: ParagraphPair = {
        index: 0,
        englishText: 'The lamp room was beside the lantern room.',
        banglaText: `${textSurface} আলো জ্বলছিল।`,
      };

      // Order 1: [lamp room, lantern room]
      const resOrder1 = lintParagraphTerminology(paragraph, [
        lampRoomEntry,
        lanternRoomEntry,
      ]);
      assert.ok(
        resOrder1.satisfiedTermIds.includes('g-lamp-room'),
        `Order 1: Expected lamp room (${approvedForm}) to be satisfied by "${textSurface}"`
      );
      assert.equal(resOrder1.findings.length, 1);
      assert.equal(resOrder1.findings[0].termId, 'g-lantern-room');
      assert.equal(resOrder1.findings[0].reason, 'locked_term_missing');

      // Order 2: [lantern room, lamp room]
      const resOrder2 = lintParagraphTerminology(paragraph, [
        lanternRoomEntry,
        lampRoomEntry,
      ]);
      assert.ok(
        resOrder2.satisfiedTermIds.includes('g-lamp-room'),
        `Order 2: Expected lamp room (${approvedForm}) to be satisfied by "${textSurface}"`
      );
      assert.equal(resOrder2.findings.length, 1);
      assert.equal(resOrder2.findings[0].termId, 'g-lantern-room');
      assert.equal(resOrder2.findings[0].reason, 'locked_term_missing');
    }
  }
});

test('24. Phase 2A.3 Regression (Finding 2.2): Repeated compound occurrences reserve up to remainingNeeded spans without hiding missing standalone constituent terms', () => {
  const lanternRoomEntry = createUserTerminologyItem({
    id: 'g-lr',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    category: 'place',
  });
  const lanternEntry = createUserTerminologyItem({
    id: 'g-l',
    englishTerm: 'lantern',
    banglaTranslation: 'লণ্ঠন',
    category: 'object',
  });

  // 1. Two "lantern room" occurrences translated using two unapproved compounds + 1 missing standalone "lantern"
  const twoUnapprovedParagraph: ParagraphPair = {
    index: 0,
    englishText: 'The lantern room was above the old lantern room, holding a lantern.',
    banglaText: 'লণ্ঠন কক্ষে এবং পুরনো লণ্ঠন কক্ষে আলো জ্বলছিল।',
  };

  for (const glossaryOrder of [
    [lanternRoomEntry, lanternEntry],
    [lanternEntry, lanternRoomEntry],
  ]) {
    const res = lintParagraphTerminology(twoUnapprovedParagraph, glossaryOrder);
    assert.equal(res.findings.length, 2);
    const lrFinding = res.findings.find((f) => f.termId === 'g-lr')!;
    const lFinding = res.findings.find((f) => f.termId === 'g-l')!;
    assert.equal(lrFinding.reason, 'unapproved_variant_used');
    assert.equal(lrFinding.detectedBanglaVariant, 'লণ্ঠন কক্ষে');
    assert.equal(lFinding.reason, 'locked_term_missing');
    assert.equal(res.satisfiedTermIds.includes('g-l'), false);
  }

  // 2. Two avoid-list compound occurrences + 1 missing standalone "lantern"
  const lanternRoomAvoidEntry = createUserTerminologyItem({
    id: 'g-lr-avoid',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
    category: 'place',
  });

  for (const glossaryOrder of [
    [lanternRoomAvoidEntry, lanternEntry],
    [lanternEntry, lanternRoomAvoidEntry],
  ]) {
    const res = lintParagraphTerminology(twoUnapprovedParagraph, glossaryOrder);
    assert.equal(res.findings.length, 2);
    const lrFinding = res.findings.find((f) => f.termId === 'g-lr-avoid')!;
    const lFinding = res.findings.find((f) => f.termId === 'g-l')!;
    assert.equal(lrFinding.reason, 'avoid_term_used');
    assert.equal(lrFinding.detectedBanglaVariant, 'লণ্ঠন কক্ষে');
    assert.equal(lFinding.reason, 'locked_term_missing');
  }

  // 3. A third extra compound beyond two English occurrences (occurrence bound = 2)
  //    "lantern room" occurs twice in English, so it must reserve at most 2 compound spans,
  //    leaving any standalone "লণ্ঠন" (or 3rd occurrence) unreserved by the 2-occurrence phrase.
  const twoCompoundsPlusStandaloneParagraph: ParagraphPair = {
    index: 1,
    englishText: 'The lantern room was above the old lantern room, holding a lantern.',
    banglaText: 'লণ্ঠন কক্ষে এবং পুরনো লণ্ঠন কক্ষে একটি পিতলের লণ্ঠন জ্বলছিল।',
  };
  const boundedRes = lintParagraphTerminology(twoCompoundsPlusStandaloneParagraph, [
    lanternRoomEntry,
    lanternEntry,
  ]);
  assert.equal(boundedRes.findings.length, 1);
  assert.equal(boundedRes.findings[0].termId, 'g-lr');
  assert.equal(boundedRes.findings[0].reason, 'unapproved_variant_used');
  assert.ok(boundedRes.satisfiedTermIds.includes('g-l'));

  const threeCompoundsParagraph: ParagraphPair = {
    index: 2,
    englishText: 'The lantern room was above the old lantern room, holding a lantern.',
    banglaText: 'লণ্ঠন কক্ষে, পুরনো লণ্ঠন কক্ষে এবং আরেকটি লণ্ঠন কক্ষে আলো জ্বলছিল।',
  };
  const thirdCompoundRes = lintParagraphTerminology(threeCompoundsParagraph, [
    lanternRoomEntry,
    lanternEntry,
  ]);
  // "lantern room" reserves only 2 of the 3 "লণ্ঠন কক্ষে" spans (bounded by its 2 English occurrences)
  assert.equal(thirdCompoundRes.findings.length, 1);
  assert.equal(thirdCompoundRes.findings[0].termId, 'g-lr');
});

test('25. Phase 2A.3 Regression (Finding 4.1): Case-sensitive homonym occurrences require individual sense satisfaction', () => {
  const vCap: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'v-cap',
    englishTerm: 'Vessel',
    banglaTranslation: 'নৌকা',
    category: 'nautical',
    caseSensitive: true,
    contextMeaning: 'boat',
    isContextSensitive: true,
    lockedByUser: true,
  });
  const vLower: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'v-lower',
    englishTerm: 'vessel',
    banglaTranslation: 'পাত্র',
    category: 'object',
    caseSensitive: false,
    contextMeaning: 'container',
    isContextSensitive: true,
    lockedByUser: true,
  });

  for (const glossaryOrder of [
    [vCap, vLower],
    [vLower, vCap],
  ]) {
    // 1. Both senses correctly translated
    const bothRes = lintParagraphTerminology(
      {
        index: 0,
        englishText: 'The Vessel carried a brass vessel.',
        banglaText: 'নৌকাটি একটি পিতলের পাত্র বহন করছিল।',
      },
      glossaryOrder
    );
    assert.equal(bothRes.findings.length, 0);
    assert.deepEqual(bothRes.satisfiedTermIds.slice().sort(), ['v-cap', 'v-lower']);

    // 2. Both occurrences translated using the lowercase sense only ("পাত্র")
    const lowercaseOnlyRes = lintParagraphTerminology(
      {
        index: 1,
        englishText: 'The Vessel carried a brass vessel.',
        banglaText: 'পাত্রটি একটি পিতলের পাত্র বহন করছিল।',
      },
      glossaryOrder
    );
    assert.equal(lowercaseOnlyRes.findings.length, 1);
    assert.equal(lowercaseOnlyRes.findings[0].termId, 'v-cap');
    assert.equal(lowercaseOnlyRes.findings[0].matchedEnglishText, 'Vessel');
    assert.equal(lowercaseOnlyRes.findings[0].classification, 'contextual_review');
    assert.equal(lowercaseOnlyRes.findings[0].reason, 'contextual_review_needed');
    assert.equal(lowercaseOnlyRes.findings[0].severity, 'low');

    // 3. Only capitalized sense translated ("নৌকা")
    const capOnlyRes = lintParagraphTerminology(
      {
        index: 2,
        englishText: 'The Vessel carried a brass vessel.',
        banglaText: 'নৌকাটি একটি পিতলের কলসি বহন করছিল।',
      },
      glossaryOrder
    );
    assert.equal(capOnlyRes.findings.length, 1);
    assert.equal(capOnlyRes.findings[0].termId, 'v-lower');
    assert.equal(capOnlyRes.findings[0].matchedEnglishText, 'vessel');
    assert.equal(capOnlyRes.findings[0].classification, 'contextual_review');
    assert.equal(capOnlyRes.findings[0].reason, 'contextual_review_needed');

    // 4. Neither sense translated -> single consolidated contextual review finding (no duplicate)
    const neitherRes = lintParagraphTerminology(
      {
        index: 3,
        englishText: 'The Vessel carried a brass vessel.',
        banglaText: 'তরণীটি একটি পিতলের কলসি বহন করছিল।',
      },
      glossaryOrder
    );
    assert.equal(neitherRes.findings.length, 1);
    assert.equal(neitherRes.findings[0].classification, 'contextual_review');
    assert.equal(neitherRes.findings[0].reason, 'contextual_review_needed');

    // 5. Repeated capitalized and lowercase occurrences (2 Vessel, 2 vessel)
    const repeatedBothSatisfied = lintParagraphTerminology(
      {
        index: 4,
        englishText: 'The Vessel passed another Vessel carrying a brass vessel and a clay vessel.',
        banglaText: 'নৌকাটি আরেকটি নৌকার পাশ দিয়ে গেল যেখানে পিতলের পাত্র ও মাটির পাত্র ছিল।',
      },
      glossaryOrder
    );
    assert.equal(repeatedBothSatisfied.findings.length, 0);
    assert.deepEqual(repeatedBothSatisfied.satisfiedTermIds.slice().sort(), ['v-cap', 'v-lower']);

    const repeatedCapShortfall = lintParagraphTerminology(
      {
        index: 5,
        englishText: 'The Vessel passed another Vessel carrying a brass vessel and a clay vessel.',
        banglaText: 'নৌকাটি আরেকটি পাত্রের পাশ দিয়ে গেল যেখানে পিতলের পাত্র ও মাটির পাত্র ছিল।',
      },
      glossaryOrder
    );
    assert.equal(repeatedCapShortfall.findings.length, 1);
    assert.equal(repeatedCapShortfall.findings[0].termId, 'v-cap');
    assert.equal(repeatedCapShortfall.findings[0].reason, 'contextual_review_needed');
  }
});

test('26. Phase 2B.1 (Clarification 1): Same-category contextual homonym preservation without weakening Phase 2A safeguards', () => {
  // 1. Same English term + same category ("cultural") with distinct contextMeaning
  const sameCategoryWithContextMeaning = mergeGlossaryItems(
    [
      {
        id: 'school-inst',
        englishTerm: 'school',
        banglaTranslation: 'পাঠশালা',
        acceptedAlternatives: ['বিদ্যালয়'],
        avoidTranslations: ['ঝাঁক'],
        category: 'cultural',
        contextMeaning: 'village educational institution',
        isContextSensitive: true,
        source: 'stage1_ai',
      },
    ],
    [
      {
        id: 'school-fish',
        englishTerm: 'school',
        banglaTranslation: 'ঝাঁক',
        avoidTranslations: ['পাঠশালা', 'বিদ্যালয়'],
        category: 'cultural',
        contextMeaning: 'shoal or group of fish swimming together',
        isContextSensitive: true,
        source: 'chunk_ai',
      },
    ],
    { defaultSource: 'chunk_ai' }
  );

  assert.equal(sameCategoryWithContextMeaning.length, 2);
  assert.ok(sameCategoryWithContextMeaning.some((t) => t.id === 'school-inst' && t.banglaTranslation === 'পাঠশালা'));
  assert.ok(sameCategoryWithContextMeaning.some((t) => t.id === 'school-fish' && t.banglaTranslation === 'ঝাঁক'));

  // Verify linting when "school" is used in the fish sense ("ঝাঁক") or institution sense ("পাঠশালা")
  const fishSenseParagraph: ParagraphPair = {
    index: 0,
    englishText: 'A silver school of herring darted beneath the hull.',
    banglaText: 'হেরিং মাছের এক রূপালি ঝাঁক নৌকার তলদেশ দিয়ে ছুটে গেল।',
  };
  const fishLint = lintParagraphTerminology(fishSenseParagraph, sameCategoryWithContextMeaning);
  assert.equal(fishLint.findings.length, 0);
  assert.deepEqual(fishLint.satisfiedTermIds, ['school-fish']);

  // 2. Parenthetical sense qualifiers in englishTerm ("bank (river)" vs "bank (finance)") with identical category 'place'
  const parentheticalHomonyms = normalizeGlossaryList([
    {
      id: 'bank-river',
      englishTerm: 'bank (river)',
      banglaTranslation: 'তীর',
      category: 'place',
    },
    {
      id: 'bank-finance',
      englishTerm: 'bank (finance)',
      banglaTranslation: 'ব্যাংক',
      category: 'place',
    },
  ]);

  assert.equal(parentheticalHomonyms.length, 2);
  assert.equal(extractEnglishSurfaceAndSense('bank (river)').surfaceTerm, 'bank');
  assert.equal(extractContextualSenseKey(parentheticalHomonyms[0]), 'river');
  assert.equal(extractContextualSenseKey(parentheticalHomonyms[1]), 'finance');

  // Bare "bank" in English text matches both homonym entries and satisfies when both senses are rendered
  const dualBankParagraph: ParagraphPair = {
    index: 1,
    englishText: 'He left the town bank and walked down to the muddy river bank.',
    banglaText: 'সে শহরের ব্যাংক থেকে বেরিয়ে কর্দমাক্ত নদীর তীরে নেমে গেল।',
  };
  const dualBankLint = lintParagraphTerminology(dualBankParagraph, parentheticalHomonyms);
  assert.equal(dualBankLint.findings.length, 0);
  assert.deepEqual(dualBankLint.satisfiedTermIds.slice().sort(), ['bank-finance', 'bank-river']);

  // 3. Explicit sense prefix in `notes` ("Context: ..." / "Sense: ...") with same category
  const notesSenseHomonyms = mergeGlossaryItems(
    [
      {
        id: 'post-military',
        englishTerm: 'post',
        banglaTranslation: 'ঘাঁটি',
        category: 'place',
        notes: 'Context: military border outpost',
      },
    ],
    [
      {
        id: 'post-mail',
        englishTerm: 'post',
        banglaTranslation: 'ডাকঘর',
        category: 'place',
        notes: 'Context: village mail office',
      },
    ]
  );
  assert.equal(notesSenseHomonyms.length, 2);

  // 4. Safeguard: AI synonym drift or avoided variant on a non-contextual user-locked entry MUST NOT split into a homonym
  const lockedLanternRoom = createUserTerminologyItem({
    id: 'locked-lr',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
    category: 'place',
    notes: 'Primary beacon chamber',
  });

  const attemptedAiBypass = mergeGlossaryItems(
    [lockedLanternRoom],
    [
      {
        englishTerm: 'lantern room',
        banglaTranslation: 'লণ্ঠন কক্ষ',
        category: 'place',
        contextMeaning: 'upper chamber of lighthouse',
        notes: 'Context: lighthouse top room',
        source: 'chunk_ai',
        lockedByUser: false,
      },
    ],
    { defaultSource: 'chunk_ai' }
  );

  // Must remain a single locked entry with "দীপকক্ষ" and never create a second drifted entry
  assert.equal(attemptedAiBypass.length, 1);
  assert.equal(attemptedAiBypass[0].id, 'locked-lr');
  assert.equal(attemptedAiBypass[0].banglaTranslation, 'দীপকক্ষ');
  assert.equal(attemptedAiBypass[0].lockedByUser, true);
});

test('27. Phase 2B.1 (Safeguard 1 & Clarification 3): suggestedFix type contract and Stage 5 reconciliation separation', () => {
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 't-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
    }),
    {
      id: 't-mirror',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    },
  ]);

  const paragraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'In the lantern room, the mirror gleamed.',
      banglaText: 'দীপকক্ষে আয়নাটি ঝলমল করছিল।',
    },
    {
      index: 1,
      englishText: 'He returned to the lantern room and checked the mirror.',
      banglaText: 'সে লণ্ঠন কক্ষে ফিরে এল এবং দর্পণটি পরীক্ষা করল।',
    },
  ];

  const lintResult = lintChapterTerminology(paragraphs, glossary);
  assert.equal(lintResult.findings.length, 2);

  // Safeguard 1: Deterministic findings and converted issues MUST have suggestedFix === undefined
  // and provide human-readable remediation in editorialGuidance / description.
  for (const finding of lintResult.findings) {
    assert.equal(finding.suggestedFix, undefined);
    assert.ok(finding.editorialGuidance && finding.editorialGuidance.length > 0);
  }
  for (const issue of lintResult.issues) {
    assert.equal(issue.suggestedFix, undefined);
    assert.equal(issue.source, 'deterministic_lint');
    assert.ok(issue.findingSignature?.startsWith('deterministic_lint::'));
  }

  // Merge with an AI Stage 5 VerificationReport containing:
  // - An AI `omitted_dialogue` issue on paragraph 1 (index 1) with an AI Bangla paragraph `suggestedFix`
  // - A duplicate AI `terminology` issue on paragraph 1 (index 1) mentioning "lantern room"
  const aiReport: VerificationReport = {
    overallScore: 92,
    fidelitySummary: 'Strong literary voice with minor terminology drift in paragraph 2.',
    isComplete: true,
    checkedAt: '2026-11-01T08:00:00.000Z',
    issues: [
      {
        id: 'ai-issue-dialogue',
        severity: 'medium',
        type: 'omitted_dialogue',
        paragraphIndex: 1,
        description: 'A whispered clause was softened.',
        suggestedFix: 'সে নিঃশব্দে দীপকক্ষে ফিরে এল এবং আয়নাটি পরীক্ষা করল।',
        resolved: true, // Previously resolved AI issue
      },
      {
        id: 'ai-issue-dup-term',
        severity: 'medium',
        type: 'terminology',
        paragraphIndex: 1,
        description: 'The term "lantern room" used "লণ্ঠন কক্ষে" instead of "দীপকক্ষ".',
        suggestedFix: 'সে দীপকক্ষে ফিরে এল।',
        resolved: true, // Even if resolved on the AI side, deterministic lint finding must NOT inherit this resolved state!
      },
    ],
  };

  const mergedInitial = mergeVerificationReportWithTerminologyLint({
    aiReport,
    lintResult,
    paragraphs,
  });

  // 1. Overlapping AI terminology issue on paragraph 1 is deduplicated; non-terminology AI issue is kept with its suggestedFix
  const aiDialogueIssue = mergedInitial.issues.find((i) => i.id === 'ai-issue-dialogue')!;
  assert.ok(aiDialogueIssue);
  assert.equal(aiDialogueIssue.source, 'ai_stage5');
  assert.equal(
    aiDialogueIssue.suggestedFix,
    'সে নিঃশব্দে দীপকক্ষে ফিরে এল এবং আয়নাটি পরীক্ষা করল।'
  );
  assert.equal(aiDialogueIssue.resolved, true);

  // 2. Deterministic terminology issues use 0-based paragraphIndex (1 for Paragraph 2), have suggestedFix: undefined,
  //    and did NOT inherit resolved: true from the overlapping AI issue!
  const detIssues = mergedInitial.issues.filter((i) => i.source === 'deterministic_lint');
  assert.equal(detIssues.length, 2);
  for (const detIss of detIssues) {
    assert.equal(detIss.paragraphIndex, 1); // 0-based index for Paragraph 2!
    assert.equal(detIss.suggestedFix, undefined);
    assert.equal(detIss.resolved, false);
    assert.ok(detIss.paragraphContentFingerprint);
    assert.ok(detIss.findingSignature?.startsWith('deterministic_lint::'));
  }

  // Scenario A: User marks the deterministic "mirror" issue as resolved: true, and Stage 5 re-runs on UNCHANGED paragraph text
  const reportWithResolvedMirror: VerificationReport = {
    ...mergedInitial,
    issues: mergedInitial.issues.map((iss) =>
      iss.termId === 't-mirror' ? { ...iss, resolved: true } : iss
    ),
  };

  const remergedUnchanged = mergeVerificationReportWithTerminologyLint({
    aiReport,
    lintResult,
    paragraphs,
    previousReport: reportWithResolvedMirror,
  });
  const mirrorAfterUnchanged = remergedUnchanged.issues.find((i) => i.termId === 't-mirror')!;
  const lrAfterUnchanged = remergedUnchanged.issues.find((i) => i.termId === 't-lantern-room')!;
  assert.equal(mirrorAfterUnchanged.resolved, true); // Preserved because paragraph + finding signature are identical!
  assert.equal(lrAfterUnchanged.resolved, false);

  // Scenario B: User edits Paragraph 2's Bangla text (fixing "লণ্ঠন কক্ষে" -> "দীপকক্ষে", while leaving "দর্পণটি" and changing verb)
  // Because Paragraph 2's Bangla text changed, paragraphContentFingerprint changed, so "t-mirror" must be re-evaluated as unresolved!
  const editedParagraphs: ParagraphPair[] = [
    paragraphs[0],
    {
      ...paragraphs[1],
      banglaText: 'সে দ্রুত দীপকক্ষে ফিরে এল এবং দর্পণটি ভালো করে দেখল।',
    },
  ];
  const editedLintResult = lintChapterTerminology(editedParagraphs, glossary);
  assert.equal(editedLintResult.findings.length, 1); // "lantern room" violation disappeared! Only "mirror" remains.

  const remergedAfterEdit = mergeVerificationReportWithTerminologyLint({
    aiReport: null,
    lintResult: editedLintResult,
    paragraphs: editedParagraphs,
    previousReport: reportWithResolvedMirror,
    mode: 'local_relint',
  });

  // Disappeared "lantern room" finding is removed; remaining "mirror" finding is reset to resolved: false because Bangla text changed;
  // unrelated AI issue ('ai-issue-dialogue') is preserved untouched during local_relint!
  assert.equal(
    remergedAfterEdit.issues.some((i) => i.termId === 't-lantern-room'),
    false
  );
  const mirrorAfterEdit = remergedAfterEdit.issues.find((i) => i.termId === 't-mirror')!;
  assert.equal(mirrorAfterEdit.resolved, false);
  const preservedAiIssue = remergedAfterEdit.issues.find((i) => i.id === 'ai-issue-dialogue')!;
  assert.equal(preservedAiIssue.resolved, true);

  // Scenario C: Issue is completely fixed (0 deterministic findings), then later reintroduced in a subsequent edit -> must be unresolved!
  const fullyFixedParagraphs: ParagraphPair[] = [
    paragraphs[0],
    {
      ...paragraphs[1],
      banglaText: 'সে দীপকক্ষে ফিরে এল এবং আয়নাটি পরীক্ষা করল।',
    },
  ];
  const fixedLintResult = lintChapterTerminology(fullyFixedParagraphs, glossary);
  assert.equal(fixedLintResult.findings.length, 0);
  const reportWhenFixed = mergeVerificationReportWithTerminologyLint({
    aiReport: null,
    lintResult: fixedLintResult,
    paragraphs: fullyFixedParagraphs,
    previousReport: reportWithResolvedMirror,
    mode: 'local_relint',
  });
  assert.equal(
    reportWhenFixed.issues.filter((i) => i.source === 'deterministic_lint').length,
    0
  );

  // Reintroduce the exact original Paragraph 2 text after it had been fixed
  const reintroducedReport = mergeVerificationReportWithTerminologyLint({
    aiReport: null,
    lintResult,
    paragraphs,
    previousReport: reportWhenFixed,
    mode: 'local_relint',
  });
  for (const detIss of reintroducedReport.issues.filter((i) => i.source === 'deterministic_lint')) {
    assert.equal(detIss.resolved, false);
  }
});

test('28. Phase 2B.1 (Safeguard 2): Conservative legacy glossary provenance handling in hydrateProjectGlossary()', () => {
  // 1. Legacy 5-field entries with missing source and missing lockedByUser default conservatively to source: 'stage1_ai', lockedByUser: false
  const legacyRaw: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'term-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'আতশ কাচ',
      category: 'object',
      notes: 'Small magnifying glass used by watchmakers.',
    },
  ];

  const hydratedLegacy = hydrateProjectGlossary(legacyRaw);
  assert.equal(hydratedLegacy.length, 1);
  assert.equal(hydratedLegacy[0].id, 'term-loupe');
  assert.equal(hydratedLegacy[0].source, 'stage1_ai');
  assert.equal(hydratedLegacy[0].lockedByUser, false);
  assert.deepEqual(hydratedLegacy[0].acceptedAlternatives, []);
  assert.deepEqual(hydratedLegacy[0].avoidTranslations, []);

  // 2. Missing source metadata with `lockedByUser: false` must NEVER unlock or overwrite a `lockedByUser: true` entry in either array order!
  const lockedItem: Partial<TerminologyMemoryItem> = {
    id: 'lr-locked',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
    category: 'place',
    lockedByUser: true,
    // source omitted on legacy locked item
  };
  const unlockedLegacyDuplicate: Partial<TerminologyMemoryItem> = {
    id: 'lr-unlocked-dup',
    englishTerm: 'lantern room',
    banglaTranslation: 'লণ্ঠন কক্ষ',
    category: 'place',
    lockedByUser: false,
    // source omitted! In normalizeGlossaryList this would look like an explicit user unlock,
    // but in hydrateProjectGlossary it MUST be treated conservatively as AI provenance and blocked!
  };

  const hydratedOrder1 = hydrateProjectGlossary([lockedItem, unlockedLegacyDuplicate]);
  assert.equal(hydratedOrder1.length, 1);
  assert.equal(hydratedOrder1[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(hydratedOrder1[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.equal(hydratedOrder1[0].lockedByUser, true);
  assert.equal(hydratedOrder1[0].source, 'user');

  const hydratedOrder2 = hydrateProjectGlossary([unlockedLegacyDuplicate, lockedItem]);
  assert.equal(hydratedOrder2.length, 1);
  assert.equal(hydratedOrder2[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(hydratedOrder2[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.equal(hydratedOrder2[0].lockedByUser, true);
  assert.equal(hydratedOrder2[0].source, 'user');
});

test('29. Phase 2B.1 (Clarification 2): Stage 1 multi-window splitting, failed/skipped window coverage accuracy, and 3-tier priority merging', () => {
  // Build a 4-window synthetic chapter (each paragraph ~1000 chars, maxWindowChars = 1500, maxWindows = 3)
  const p0 = `Paragraph One start. ${'A'.repeat(1100)} Paragraph One end.`;
  const p1 = `Paragraph Two start. ${'B'.repeat(1100)} Paragraph Two end.`;
  const p2 = `Paragraph Three start. ${'C'.repeat(1100)} Paragraph Three end.`;
  const p3 = `Paragraph Four start. ${'D'.repeat(1100)} Paragraph Four end.`;
  const longChapterText = [p0, p1, p2, p3].join('\n\n');

  const plan = splitTextIntoStage1Windows(longChapterText, {
    maxWindowChars: 1500,
    maxWindows: 3,
  });

  assert.equal(plan.allWindows.length, 4);
  assert.equal(plan.scheduledWindows.length, 3);
  assert.deepEqual(plan.skippedWindowIndices, [3]);

  // Case A: Window 0 succeeds, Window 1 FAILS, Window 2 succeeds, Window 3 was skipped by budget
  const partialMerged = mergeStage1WindowResults({
    existingGlossary: [
      createUserTerminologyItem({
        id: 'user-locked-term',
        englishTerm: 'lantern room',
        banglaTranslation: 'দীপকক্ষ',
        avoidTranslations: ['লণ্ঠন কক্ষ'],
        category: 'place',
      }),
      {
        id: 'prior-chunk-term',
        englishTerm: 'trawler',
        banglaTranslation: 'মাছ ধরার জাহাজ',
        category: 'nautical',
        source: 'chunk_ai',
        lockedByUser: false,
      },
    ],
    windowPlan: plan,
    windowOutcomes: [
      {
        windowIndex: 0,
        success: true,
        payload: {
          storyContext: {
            summary: 'Primary Window 1 summary.',
            narrativeTimeline: 'Evening at Marrow Bay.',
            importantEvents: ['Beacon lit'],
            emotionalContext: 'Tense',
            literaryTone: 'Atmospheric maritime',
            locations: [{ name: 'Marrow Bay', banglaName: 'ম্যারো উপসাগর', description: 'Harbor' }],
          },
          terminology: [
            {
              englishTerm: 'lantern room',
              banglaTranslation: 'লণ্ঠন কক্ষ', // Attempts to overwrite Tier 1 user-locked entry
              category: 'place',
            },
            {
              englishTerm: 'trawler',
              banglaTranslation: 'ট্রলার', // Tier 2 stage1_ai superseding Tier 3 chunk_ai!
              category: 'nautical',
            },
            {
              englishTerm: 'baker',
              banglaTranslation: 'রুটিওয়ালা',
              category: 'title',
            },
          ],
        },
      },
      {
        windowIndex: 1,
        success: false,
        errorMessage: 'Simulated network timeout on Window 2',
      },
      {
        windowIndex: 2,
        success: true,
        payload: {
          storyContext: {
            summary: 'Continuation Window 3 summary that must NOT overwrite Window 1.',
            literaryTone: 'Different tone that must NOT overwrite Window 1.',
            importantEvents: ['Storm arrived'],
            locations: [{ name: 'Old Jetty', banglaName: 'পুরোনো জেটি', description: 'Pier' }],
          },
          terminology: [
            {
              englishTerm: 'baker',
              banglaTranslation: 'পাচক', // Later window conflicting translation must NOT overwrite Window 1 or enter acceptedAlternatives
              category: 'title',
            },
          ],
        },
      },
    ],
  });

  // 1. Coverage accuracy: 2 successful windows (0 and 2), 1 failed (1), 1 skipped (3)
  assert.equal(partialMerged.coverage.totalWindows, 4);
  assert.equal(partialMerged.coverage.successfulWindows, 2);
  assert.deepEqual(partialMerged.coverage.failedWindowIndices, [1]);
  assert.deepEqual(partialMerged.coverage.skippedWindowIndices, [3]);
  assert.equal(
    partialMerged.coverage.analyzedChars,
    plan.allWindows[0].charCount + plan.allWindows[2].charCount
  );
  assert.equal(partialMerged.coverage.isComplete, false);
  assert.equal(partialMerged.coverage.isPartial, true);
  assert.ok(partialMerged.coverage.warningMessage?.includes('1 window(s) failed (#2)'));
  assert.ok(partialMerged.coverage.warningMessage?.includes('1 window(s) skipped'));

  // 2. StoryContext preservation: Window 1 primary fields preserved, continuation events/locations merged, NO system warnings injected into storyContext
  assert.equal(partialMerged.storyContext.summary, 'Primary Window 1 summary.');
  assert.equal(partialMerged.storyContext.literaryTone, 'Atmospheric maritime');
  assert.deepEqual(partialMerged.storyContext.importantEvents, ['Beacon lit', 'Storm arrived']);
  assert.equal(partialMerged.storyContext.locations.length, 2);
  assert.equal(
    JSON.stringify(partialMerged.storyContext).includes('Stage 1 pre-analysis coverage'),
    false
  );

  // 3. 3-Tier Terminology Authority verification:
  // - Tier 1 user-locked 'lantern room' -> 'দীপকক্ষ' preserved
  const lr = partialMerged.terminologyMemory.find((t) => t.englishTerm === 'lantern room')!;
  assert.equal(lr.banglaTranslation, 'দীপকক্ষ');
  assert.equal(lr.lockedByUser, true);

  // - Tier 2 'stage1_ai' ('ট্রলার') superseded Tier 3 'chunk_ai' ('মাছ ধরার জাহাজ') without adding 'মাছ ধরার জাহাজ' to acceptedAlternatives
  const trawler = partialMerged.terminologyMemory.find((t) => t.englishTerm === 'trawler')!;
  assert.equal(trawler.banglaTranslation, 'ট্রলার');
  assert.equal(trawler.source, 'stage1_ai');
  assert.deepEqual(trawler.acceptedAlternatives, []);

  // - First Stage 1 window 'baker' -> 'রুটিওয়ালা' preserved over later window 'পাচক'
  const baker = partialMerged.terminologyMemory.find((t) => t.englishTerm === 'baker')!;
  assert.equal(baker.banglaTranslation, 'রুটিওয়ালা');
  assert.deepEqual(baker.acceptedAlternatives, []);
});

test('30. Phase 2B.1: Prompt formatting separates Tier 1, Tier 2, Tier 3 and includes Stage 4 5-part terminology protection rules', () => {
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 't1',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
    }),
    {
      id: 't2',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      acceptedAlternatives: ['দর্পণ'],
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    },
    {
      id: 't3',
      englishTerm: 'trawler',
      banglaTranslation: 'ট্রলার',
      category: 'nautical',
      source: 'chunk_ai',
      lockedByUser: false,
    },
  ]);

  const stage3Prompt = formatGlossaryForPrompt(glossary, { stage: 'stage3' });
  assert.ok(stage3Prompt.includes('[TIER 1 — MANDATORY USER-LOCKED TERMINOLOGY'));
  assert.ok(stage3Prompt.includes('[TIER 2 — ESTABLISHED STORY TERMINOLOGY'));
  assert.ok(stage3Prompt.includes('[TIER 3 — PROVISIONAL CHUNK-DISCOVERED TERMINOLOGY'));
  assert.equal(stage3Prompt.includes('[STAGE 4 TERMINOLOGY PROTECTION'), false);

  const stage4Prompt = formatGlossaryForPrompt(glossary, { stage: 'stage4' });
  assert.ok(stage4Prompt.includes('[STAGE 4 TERMINOLOGY PROTECTION & LITERARY POLISH RULES]'));
  assert.ok(stage4Prompt.includes('Natural Bangla Grammatical Inflections (ALLOWED)'));
  assert.ok(stage4Prompt.includes('Contextual Paraphrasing & Pronoun Cohesion (ALLOWED)'));
});

test('31. Phase 2B.1 (Clarification 4A): Authentic "The Clockmaker of Bowbazar / Old Calcutta" starter project regression suite', () => {
  // Exact starter project terminologyMemory and Chapter 1 paragraphs from /lib/storage.ts createStarterProject()
  const clockmakerLegacyGlossary: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'term-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'আতশ কাচ',
      category: 'object',
      notes: 'Small magnifying glass used by watchmakers.',
    },
    {
      id: 'term-mainspring',
      englishTerm: 'mainspring',
      banglaTranslation: 'মূল স্প্রিং',
      category: 'object',
      notes: 'The primary torsion spring inside a mechanical timepiece.',
    },
    {
      id: 'term-red-oxide',
      englishTerm: 'red-oxide floor',
      banglaTranslation: 'লাল মেঝে',
      category: 'place',
      notes: 'Traditional smooth red-oxide flooring common in old Calcutta homes.',
    },
    {
      id: 'term-cedar',
      englishTerm: 'cedar workbench',
      banglaTranslation: 'সিডার কাঠের টেবিল',
      category: 'object',
      notes: 'Debendranath’s work table.',
    },
  ];

  const clockmakerParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText:
        'The monsoon arrived in Bowbazar not as a gentle curtain of mist, but as a sudden, drum-roll percussion against the corrugated tin roofs of the watchmaker’s lane. Inside his narrow shop, Debendranath Mullick adjusted the brass loupe over his right eye and leaned closer to the open heart of a nineteenth-century silver pocket watch. Around him, a hundred pendulums swung in stubbornly independent rhythms, each refusing to surrender its private measure of time to the storm outside. The scent of wet earth—petrichor rising from the cracked red-oxide floor—mingled with machine oil and old cedarwood.',
      banglaText:
        'বউবাজারে বর্ষা নামল কোনো মৃদু কুয়াশার পর্দার মতো নয়, বরং ঘড়িওয়ালাদের গলির ঢেউটিনের চালে হঠাৎ শুরু হওয়া একটানা মাদলের তালের মতো। তাঁর সরু দোকানঘরের ভেতর দেবেন্দ্রনাথ মল্লিক ডান চোখে পিতলের আতশ কাচটা ঠিক করে বসিয়ে উনিশ শতকের এক রুপোর পকেট-ঘড়ির খোলা হৃদয়ের আরও কাছে ঝুঁকে পড়লেন। তাঁর চারপাশে শতখানেক পেন্ডুলাম নিজস্ব একগুঁয়ে ছন্দে দুলছিল—বাইরের ঝড়ের কাছে নিজের সময়ের ব্যক্তিগত মাপকাঠি সমর্পণ করতে যেন কেউই রাজি নয়। ফাটল-ধরা লাল মেঝের বুক থেকে ওঠা ভেজা মাটির সোঁদা গন্ধ মিশে যাচ্ছিল মেশিনের তেল আর পুরোনো সিডার কাঠের গন্ধের সঙ্গে।',
    },
    {
      index: 1,
      englishText:
        'For forty-two years, Debendranath had listened to the metallic breathing of damaged clocks. People brought him heirlooms rescued from damp ancestral cupboards, railway watches that had stopped on the night of a forgotten departure, and marriage clocks whose chimes had grown hoarse with rust. He rarely asked his customers why a particular timepiece mattered. He knew by the way their fingers lingered on the glass bezel before letting go.',
      banglaText:
        'বিয়াল্লিশ বছর ধরে দেবেন্দ্রনাথ নষ্ট হয়ে যাওয়া ঘড়িগুলোর ধাতব নিঃশ্বাস শুনে আসছেন। মানুষ তাঁর কাছে নিয়ে আসত স্যাঁতসেঁতে পৈতৃক আলমারি থেকে উদ্ধার করা উত্তরাধিকারী স্মৃতিচিহ্ন, ভুলে যাওয়া কোনো বিদায়ের রাতে থেমে যাওয়া রেলওয়ের ঘড়ি, আর মরচে পড়ে গলা ভেঙে যাওয়া বিয়ের ঘড়ি। কোনো বিশেষ ঘড়ি কেন এত গুরুত্বপূর্ণ, তা তিনি খদ্দেরদের খুব একটা জিজ্ঞেস করতেন না। হাত ছাড়ার আগে তাঁদের আঙুলগুলো যেভাবে কাচের বেজেলের ওপর কিছুক্ষণ থমকে থাকত, তা দেখেই তিনি সব বুঝে নিতেন।',
    },
    {
      index: 2,
      englishText:
        'When the shop door creaked open and a young woman stepped inside shaking rain from a blue cotton sari, the chimes seemed to hush for half a heartbeat. She placed a small, salt-tarnished brass chronometer on the cedar workbench. "My grandfather said only you would remember the sound of its mainspring," she said softly, her voice barely rising above the rain.',
      banglaText:
        'দোকানের দরজাটা ক্যাঁচ করে খুলে যখন নীল সুতির শাড়ি থেকে বৃষ্টির জল ঝাড়তে ঝাড়তে এক তরুণী ভেতরে পা রাখল, তখন ঘড়ির টিকটিক শব্দগুলো যেন আধ-নিমেষের জন্য থমকে গেল। সে সিডার কাঠের টেবিলের ওপর নোনা ধরা ছোট্ট একটি পিতলের ক্রনোমিটার রাখল। বৃষ্টির শব্দের চেয়েও মৃদু স্বরে সে আলতো করে বলল, "দাদু বলেছিলেন, এর মূল স্প্রিংয়ের আওয়াজ কেবল আপনারই মনে থাকবে।"',
    },
  ];

  const hydratedGlossary = hydrateProjectGlossary(clockmakerLegacyGlossary);
  assert.equal(hydratedGlossary.length, 4);
  for (const item of hydratedGlossary) {
    assert.equal(item.source, 'stage1_ai');
    assert.equal(item.lockedByUser, false);
  }

  // Authentic Clockmaker chapter must lint with ZERO false positives (including -টা, -ের, -য়ের inflections)
  const lintReport = lintChapterTerminology(clockmakerParagraphs, hydratedGlossary);
  assert.equal(lintReport.findings.length, 0);
  assert.equal(lintReport.issues.length, 0);
  assert.deepEqual(lintReport.paragraphResults[0].satisfiedTermIds.slice().sort(), [
    'term-loupe',
    'term-red-oxide',
  ]);
  assert.deepEqual(lintReport.paragraphResults[2].satisfiedTermIds.slice().sort(), [
    'term-cedar',
    'term-mainspring',
  ]);
});

test('32. Phase 2B.1 (Clarification 4B): Clearly labelled SYNTHETIC_LANTERN_KEEPER_EXTENDED_FIXTURE covering lantern room, baker/bakery, boats/trawler, mirror, chapter, and school', () => {
  // Explicitly labelled synthetic automated fixture (the original Lantern Keeper passage is reserved for human literary review).
  const SYNTHETIC_LANTERN_KEEPER_EXTENDED_GLOSSARY = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'lk-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ', 'বাতিঘর কক্ষ'],
      category: 'place',
      notes: 'Upper glass chamber of the lighthouse',
    }),
    {
      id: 'lk-baker',
      englishTerm: 'baker',
      banglaTranslation: 'রুটিওয়ালা',
      avoidTranslations: ['পাচক'],
      category: 'title',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Village bread maker',
    },
    {
      id: 'lk-bakery',
      englishTerm: 'bakery',
      banglaTranslation: 'বেকারি',
      acceptedAlternatives: ['রুটিঘর'],
      category: 'place',
      source: 'stage1_ai',
      lockedByUser: false,
      notes: 'Village bakehouse on the quay',
    },
    createUserTerminologyItem({
      id: 'lk-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      acceptedAlternatives: ['নৌকো'],
      avoidTranslations: ['জাহাজ'],
      category: 'nautical',
      notes: 'Small wooden oar and sail craft',
    }),
    {
      id: 'lk-trawler',
      englishTerm: 'trawler',
      banglaTranslation: 'ট্রলার',
      avoidTranslations: ['নৌকা'],
      category: 'nautical',
      source: 'chunk_ai',
      lockedByUser: false,
      notes: 'Heavy diesel fishing vessel discovered in Stage 3',
    },
    {
      id: 'lk-mirror',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      acceptedAlternatives: ['দর্পণ'],
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    },
    {
      id: 'lk-chapter',
      englishTerm: 'chapter',
      banglaTranslation: 'অধ্যায়',
      category: 'expression',
      source: 'stage1_ai',
      lockedByUser: false,
    },
    {
      id: 'lk-school',
      englishTerm: 'school',
      banglaTranslation: 'বিদ্যালয়',
      acceptedAlternatives: ['পাঠশালা'],
      category: 'cultural',
      isContextSensitive: true,
      contextMeaning: 'Educational institution only; use ঝাঁক for a school of fish',
      source: 'stage1_ai',
      lockedByUser: false,
    },
  ]);

  const SYNTHETIC_LANTERN_KEEPER_PARAGRAPHS: ParagraphPair[] = [
    {
      // P0: Clean usage of lantern room, baker's, bakery, boats, trawler, and mirror (via accepted alternative দর্পণে)
      index: 0,
      englishText:
        "From the lantern room, he saw the baker's lantern outside the bakery while the wooden boats steered clear of the rusted trawler reflected in the mirror.",
      banglaText:
        'দীপকক্ষ থেকে সে বেকারির বাইরে রুটিওয়ালার লণ্ঠন দেখতে পেল, যখন কাঠের নৌকাগুলো দর্পণে প্রতিফলিত মরচে-ধরা ট্রলারটির পাশ কাটিয়ে যাচ্ছিল।',
    },
    {
      // P1: Metaphorical "chapter of his life" (idiomatically paraphrased without any competing literal noun) + polysemous "school of fish" ("মাছের ঝাঁক")
      index: 1,
      englishText:
        'Closing that chapter of his life, he watched a silver school of fish shimmer beneath the waves.',
      banglaText:
        'অতীতের সেই দিনগুলো পেছনে ফেলে সে ঢেউয়ের নিচে রূপালি মাছের এক ঝাঁক ঝলমল করতে দেখল।',
    },
    {
      // P2: Intentional synthetic violations to verify detection across baker, boats, and lantern room
      index: 2,
      englishText:
        'In the lantern room, the baker watched the boats pass the trawler before the boats returned.',
      banglaText:
        'লণ্ঠন কক্ষে দাঁড়িয়ে পাচক দেখল নৌকাগুলো ট্রলারটির পাশ দিয়ে গেল এবং পরে জাহাজগুলো ফিরে এল।',
    },
  ];

  const report = lintChapterTerminology(
    SYNTHETIC_LANTERN_KEEPER_PARAGRAPHS,
    SYNTHETIC_LANTERN_KEEPER_EXTENDED_GLOSSARY
  );

  // P0: All 6 matched terms satisfied (5 preferred + 1 accepted alternative দর্পণে) -> 0 findings
  assert.equal(report.paragraphResults[0].findings.length, 0);
  assert.equal(report.paragraphResults[0].satisfiedTermIds.length, 5);
  assert.deepEqual(report.paragraphResults[0].acceptedVariantTermIds, ['lk-mirror']);

  // P1: "chapter" paraphrased without avoid term (no definite violation) and "school" emits at most 1 low-severity contextual review note
  const p1Findings = report.paragraphResults[1].findings;
  assert.equal(
    p1Findings.some((f) => f.classification === 'definite_violation'),
    false
  );
  assert.equal(p1Findings.length, 1);
  assert.equal(p1Findings[0].termId, 'lk-school');
  assert.equal(p1Findings[0].severity, 'low');
  assert.equal(p1Findings[0].classification, 'contextual_review');

  // P2: Detects avoid_term_used on "lantern room" (লণ্ঠন কক্ষে), "baker" (পাচক), and second occurrence of "boats" (জাহাজগুলো)
  const p2Findings = report.paragraphResults[2].findings;
  assert.equal(p2Findings.length, 3);
  assert.ok(p2Findings.some((f) => f.termId === 'lk-lantern-room' && f.severity === 'high'));
  assert.ok(p2Findings.some((f) => f.termId === 'lk-baker' && f.severity === 'high'));
  assert.ok(
    p2Findings.some(
      (f) =>
        f.termId === 'lk-boats' &&
        f.severity === 'high' &&
        f.detectedBanglaVariant === 'জাহাজগুলো'
    )
  );
});

test('33. Phase 2B.1 (Clarification 5): All six Phase 1 invariants preserved across chunking, assembly, linting, and legacy project hydration', () => {
  const sourceChapterWithSceneBreak = [
    'First paragraph in the lantern room.',
    '***',
    'Second paragraph where the boats waited.',
    'Third paragraph by the old mirror.',
  ].join('\n\n');

  // 1. Split & build chunks preserving scene-break metadata on paragraph index 0
  const parsedUnits = parseParagraphsWithSceneBreaks(sourceChapterWithSceneBreak);
  assert.equal(parsedUnits.length, 3);
  assert.equal(parsedUnits[0].sceneBreakAfter, true);
  assert.equal(parsedUnits[0].sceneBreakMarker, '***');

  const englishParagraphs = splitIntoParagraphs(sourceChapterWithSceneBreak);
  const chunks = chunkTextByParagraphs(sourceChapterWithSceneBreak, 500);

  // Simulate a chunk translation where Paragraph 2 (index 1) was omitted/empty by the model,
  // while Paragraph 1 (index 0) and Paragraph 3 (index 2) were translated in their fixed slots.
  const assembled = assembleTranslatedChunks(
    englishParagraphs,
    [
      [
        'দীপকক্ষের ভেতর প্রথম অনুচ্ছেদ।',
        '', // index 1 missing!
        'পুরোনো আয়নার পাশে তৃতীয় অনুচ্ছেদ।',
      ],
    ],
    chunks
  );

  // Invariant 1 & 4: Paragraph slot alignment preserved; index 2 is NEVER shifted into index 1!
  assert.equal(assembled.pairs.length, 3);
  assert.equal(assembled.pairs[0].index, 0);
  assert.equal(assembled.pairs[1].index, 1);
  assert.equal(assembled.pairs[2].index, 2);
  assert.equal(assembled.pairs[2].banglaText, 'পুরোনো আয়নার পাশে তৃতীয় অনুচ্ছেদ।');

  // Invariant 2: Missing-paragraph detection preserved
  assert.equal(assembled.pairs[1].missingTranslation, true);
  assert.deepEqual(assembled.missingIndices, [1]);

  // Invariant 3: Scene-break metadata preserved on slot 0 and in joined fullBanglaText
  assert.equal(assembled.pairs[0].sceneBreakAfter, true);
  assert.equal(assembled.pairs[0].sceneBreakMarker, '***');
  assert.ok(assembled.fullBanglaText.includes('***'));

  // Run terminology linting and Stage 5 report merging on the assembled paragraphs
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'inv-lr',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
    }),
    createUserTerminologyItem({
      id: 'inv-boats',
      englishTerm: 'boats',
      banglaTranslation: 'নৌকা',
      category: 'nautical',
    }),
    createUserTerminologyItem({
      id: 'inv-mirror',
      englishTerm: 'mirror',
      banglaTranslation: 'আয়না',
      category: 'object',
    }),
  ]);

  const lintResult = lintChapterTerminology(assembled.pairs, glossary);

  // Invariant 5: Paragraph order and slot indices are never mutated by linting
  assert.deepEqual(
    assembled.pairs.map((p) => p.index),
    [0, 1, 2]
  );
  assert.equal(assembled.pairs[1].missingTranslation, true);

  // Missing paragraph (index 1) is NOT masked as a terminology issue, while Stage 5 merged report keeps isComplete: false
  const mergedReport = mergeVerificationReportWithTerminologyLint({
    aiReport: {
      overallScore: 85,
      fidelitySummary: 'Paragraph 2 is untranslated.',
      isComplete: true, // Even if AI erroneously claimed isComplete: true, missingTranslation forces isComplete: false!
      issues: [],
      checkedAt: '2026-11-01T08:00:00.000Z',
    },
    lintResult,
    paragraphs: assembled.pairs,
  });
  assert.equal(mergedReport.isComplete, false);

  // Invariant 6: Never reprocess completed translations during legacy project hydration
  const legacyCompletedProject: TranslationProject = {
    id: 'proj-completed-1',
    title: 'Completed Legacy Project',
    authorName: 'Author',
    genre: 'Literary Fiction',
    sourceLanguage: 'English',
    targetLanguage: 'Bangla (বাংলা)',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    styleProfile: null,
    storyContext: null,
    characterMemory: [],
    terminologyMemory: [
      {
        id: 'legacy-t1',
        englishTerm: 'lantern room',
        banglaTranslation: 'দীপকক্ষ',
        category: 'place',
        notes: 'Legacy item',
      } as TerminologyMemoryItem,
    ],
    styleControls: {
      preserveAuthorStyle: true,
      naturalness: 'highly_natural',
      literaryExpression: 'rich',
      languageComplexity: 'moderate',
      dialogueStyle: 'more_conversational',
      translationApproach: 'faithful_literary',
    },
    chapters: [
      {
        id: 'ch-completed-1',
        number: 1,
        title: 'Chapter 1',
        originalText: sourceChapterWithSceneBreak,
        translatedText: 'দীপকক্ষের ভেতর প্রথম অনুচ্ছেদ।\n\n***\n\nনৌকাগুলো অপেক্ষা করছিল।\n\nপুরোনো আয়নার পাশে তৃতীয় অনুচ্ছেদ।',
        paragraphs: [
          {
            index: 0,
            englishText: 'First paragraph in the lantern room.',
            banglaText: 'দীপকক্ষের ভেতর প্রথম অনুচ্ছেদ।',
            sceneBreakAfter: true,
            sceneBreakMarker: '***',
          },
          {
            index: 1,
            englishText: 'Second paragraph where the boats waited.',
            banglaText: 'নৌকাগুলো অপেক্ষা করছিল।',
          },
          {
            index: 2,
            englishText: 'Third paragraph by the old mirror.',
            banglaText: 'পুরোনো আয়নার পাশে তৃতীয় অনুচ্ছেদ।',
          },
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
        editorialNotes: ['Completed prior to Phase 2'],
        editorialChanges: [],
        verificationReport: {
          overallScore: 98,
          fidelitySummary: 'Complete',
          isComplete: true,
          issues: [],
          checkedAt: '2026-10-01T00:00:00.000Z',
        },
        chunkCount: 1,
        completedChunks: 1,
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  };

  const hydratedProject = hydrateLegacyProjectState(legacyCompletedProject);
  assert.equal(hydratedProject.terminologyMemory[0].source, 'stage1_ai');
  assert.equal(hydratedProject.terminologyMemory[0].lockedByUser, false);
  assert.equal(hydratedProject.chapters[0].status, 'completed');
  assert.equal(hydratedProject.chapters[0].currentStage, 5);
  assert.equal(
    hydratedProject.chapters[0].translatedText,
    legacyCompletedProject.chapters[0].translatedText
  );
  assert.deepEqual(
    hydratedProject.chapters[0].paragraphs,
    legacyCompletedProject.chapters[0].paragraphs
  );
});

test('34. Step 2B.1.1 Regression (Corrections 1 & 2): Prevent contextual metadata from bypassing user locks, splitting ordinary AI entries, or flipping locked isContextSensitive', () => {
  // 1. User-locked "lantern room" with descriptive contextMeaning vs AI chunk entry with different contextMeaning + avoided translation
  const lockedLanternRoomWithContext = createUserTerminologyItem({
    id: 'u-lr-ctx',
    englishTerm: 'lantern room',
    banglaTranslation: 'দীপকক্ষ',
    avoidTranslations: ['লণ্ঠন কক্ষ'],
    category: 'place',
    contextMeaning: 'beacon chamber',
    isContextSensitive: false,
  });

  const mergedLanternRoom = mergeGlossaryItems(
    [lockedLanternRoomWithContext],
    [
      {
        id: 'ai-lr-ctx',
        englishTerm: 'lantern room',
        banglaTranslation: 'লণ্ঠন কক্ষ',
        category: 'place',
        contextMeaning: 'upper tower room',
        notes: 'Context: upper tower room',
        isContextSensitive: true,
        source: 'chunk_ai',
        lockedByUser: false,
      },
    ],
    { defaultSource: 'chunk_ai' }
  );

  assert.equal(mergedLanternRoom.length, 1);
  assert.equal(mergedLanternRoom[0].id, 'u-lr-ctx');
  assert.equal(mergedLanternRoom[0].banglaTranslation, 'দীপকক্ষ');
  assert.deepEqual(mergedLanternRoom[0].avoidTranslations, ['লণ্ঠন কক্ষ']);
  assert.equal(mergedLanternRoom[0].lockedByUser, true);
  assert.equal(mergedLanternRoom[0].isContextSensitive, false);
  assert.equal(mergedLanternRoom[0].contextMeaning, 'beacon chamber');

  // Linting must still enforce high-severity avoid_term_used / locked_term_missing
  const lrAvoidRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'He entered the lantern room.',
      banglaText: 'সে লণ্ঠন কক্ষে প্রবেশ করল।',
    },
    mergedLanternRoom
  );
  assert.equal(lrAvoidRes.findings.length, 1);
  assert.equal(lrAvoidRes.findings[0].severity, 'high');
  assert.equal(lrAvoidRes.findings[0].classification, 'definite_violation');
  assert.equal(lrAvoidRes.findings[0].reason, 'avoid_term_used');

  // 2. Ordinary unqualified AI "mirror" must NOT split into a second homonym when a later AI chunk supplies a descriptive contextMeaning
  const existingStage1Mirror: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 's1-mirror',
    englishTerm: 'mirror',
    banglaTranslation: 'আয়না',
    category: 'object',
    source: 'stage1_ai',
    lockedByUser: false,
    isContextSensitive: false,
  });

  const mergedMirror = mergeGlossaryItems(
    [existingStage1Mirror],
    [
      {
        id: 'c3-mirror',
        englishTerm: 'mirror',
        banglaTranslation: 'দর্পণ',
        category: 'object',
        contextMeaning: 'looking glass in the room',
        source: 'chunk_ai',
        lockedByUser: false,
      },
    ],
    { defaultSource: 'chunk_ai' }
  );

  assert.equal(mergedMirror.length, 1);
  assert.equal(mergedMirror[0].id, 's1-mirror');
  assert.equal(mergedMirror[0].banglaTranslation, 'আয়না');
  assert.deepEqual(mergedMirror[0].acceptedAlternatives, []);
  assert.equal(mergedMirror[0].isContextSensitive, false);

  // Linting against mergedMirror must still flag "দর্পণ" as definite_violation (unapproved_variant_used), not silently satisfy it!
  const mirrorDriftRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'He looked into the mirror.',
      banglaText: 'সে দর্পণে তাকাল।',
    },
    mergedMirror
  );
  assert.equal(mirrorDriftRes.findings.length, 1);
  assert.equal(mirrorDriftRes.findings[0].severity, 'medium');
  assert.equal(mirrorDriftRes.findings[0].classification, 'definite_violation');
  assert.equal(mirrorDriftRes.findings[0].reason, 'unapproved_variant_used');
  assert.equal(mirrorDriftRes.findings[0].detectedBanglaVariant, 'দর্পণে');

  // 3. User-locked non-contextual "bank" must not have isContextSensitive flipped to true by an AI candidate
  const lockedBank = createUserTerminologyItem({
    id: 'u-bank',
    englishTerm: 'bank',
    banglaTranslation: 'তীর',
    avoidTranslations: ['ব্যাংক'],
    category: 'place',
    isContextSensitive: false,
  });

  const mergedBank = mergeGlossaryItems(
    [lockedBank],
    [
      {
        id: 'ai-bank',
        englishTerm: 'bank',
        banglaTranslation: 'তীর',
        category: 'place',
        isContextSensitive: true,
        contextMeaning: 'river edge or shore',
        source: 'stage1_ai',
        lockedByUser: false,
      },
    ],
    { defaultSource: 'stage1_ai' }
  );

  assert.equal(mergedBank.length, 1);
  assert.equal(mergedBank[0].isContextSensitive, false);
  assert.equal(mergedBank[0].lockedByUser, true);
  assert.equal(mergedBank[0].banglaTranslation, 'তীর');

  const missingLockedBankRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'He stood on the bank.',
      banglaText: 'সে পাড়ে দাঁড়িয়ে ছিল।',
    },
    mergedBank
  );
  assert.equal(missingLockedBankRes.findings.length, 1);
  assert.equal(missingLockedBankRes.findings[0].severity, 'high');
  assert.equal(missingLockedBankRes.findings[0].classification, 'definite_violation');
  assert.equal(missingLockedBankRes.findings[0].reason, 'locked_term_missing');
});

test('35. Step 2B.1.1 Regression (Correction 3): Same-case multi-occurrence contextual homonym over-claiming detection and single-sense controls', () => {
  // 1. Adversarial "charge" homonyms (electrical "আধান" vs financial "মাশুল")
  const chargeHomonyms = normalizeGlossaryList([
    {
      id: 'charge-elec',
      englishTerm: 'charge',
      banglaTranslation: 'আধান',
      category: 'object',
      contextMeaning: 'electrical',
      isContextSensitive: true,
    },
    {
      id: 'charge-fin',
      englishTerm: 'charge',
      banglaTranslation: 'মাশুল',
      category: 'object',
      contextMeaning: 'financial',
      isContextSensitive: true,
    },
  ]);
  assert.equal(chargeHomonyms.length, 2);

  // Over-claiming failure case: both occurrences translated as "আধান" when paragraph has "electrical charge" and "service charge"
  const overclaimedChargeRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'The electrical charge exceeded the service charge.',
      banglaText: 'বৈদ্যুতিক আধান এবং পরিষেবা আধান অনেক বেশি ছিল।',
    },
    chargeHomonyms
  );
  assert.equal(overclaimedChargeRes.findings.length, 1);
  assert.equal(overclaimedChargeRes.findings[0].termId, 'charge-fin');
  assert.equal(overclaimedChargeRes.findings[0].severity, 'low');
  assert.equal(overclaimedChargeRes.findings[0].classification, 'contextual_review');
  assert.equal(overclaimedChargeRes.findings[0].reason, 'contextual_review_needed');

  // Valid dual-sense control: both "আধান" and "মাশুল" used -> 0 findings
  const bothChargeSensesRes = lintParagraphTerminology(
    {
      index: 1,
      englishText: 'The electrical charge exceeded the service charge.',
      banglaText: 'বৈদ্যুতিক আধান পরিষেবা মাশুলের চেয়ে অনেক বেশি ছিল।',
    },
    chargeHomonyms
  );
  assert.equal(bothChargeSensesRes.findings.length, 0);
  assert.deepEqual(
    bothChargeSensesRes.satisfiedTermIds.slice().sort(),
    ['charge-elec', 'charge-fin']
  );

  // Legitimate single-sense controls (single occurrence AND multi-occurrence explicitly electrical): 0 false positives
  const singleOccurrenceChargeRes = lintParagraphTerminology(
    {
      index: 2,
      englishText: 'The electrical charge surged through the copper wire.',
      banglaText: 'তামার তারের ভেতর দিয়ে বৈদ্যুতিক আধান প্রবাহিত হলো।',
    },
    chargeHomonyms
  );
  assert.equal(singleOccurrenceChargeRes.findings.length, 0);
  assert.deepEqual(singleOccurrenceChargeRes.satisfiedTermIds, ['charge-elec']);

  const multiOccurrenceSameSenseChargeRes = lintParagraphTerminology(
    {
      index: 3,
      englishText:
        'The electrical charge in the first plate matched the electrical charge in the second plate.',
      banglaText: 'প্রথম পাতের বৈদ্যুতিক আধান দ্বিতীয় পাতের বৈদ্যুতিক আধানের সমান ছিল।',
    },
    chargeHomonyms
  );
  assert.equal(multiOccurrenceSameSenseChargeRes.findings.length, 0);
  assert.deepEqual(multiOccurrenceSameSenseChargeRes.satisfiedTermIds, ['charge-elec']);

  // 2. Adversarial locked "bank" homonyms ("bank (river)" -> "তীর", "bank (finance)" -> "ব্যাংক")
  const lockedBankHomonyms = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'bank-river',
      englishTerm: 'bank (river)',
      banglaTranslation: 'তীর',
      category: 'place',
    }),
    createUserTerminologyItem({
      id: 'bank-fin',
      englishTerm: 'bank (finance)',
      banglaTranslation: 'ব্যাংক',
      category: 'place',
    }),
  ]);
  assert.equal(lockedBankHomonyms.length, 2);

  // Over-claiming failure case: both occurrences translated as "তীর" ("নদীর তীর থেকে শহরের তীরে")
  // Must emit a low-severity contextual_review finding (never silently pass, and never invent a definite violation)
  const overclaimedLockedBankRes = lintParagraphTerminology(
    {
      index: 0,
      englishText: 'He walked from the river bank to the town bank.',
      banglaText: 'সে নদীর তীর থেকে শহরের তীরে হাঁটল।',
    },
    lockedBankHomonyms
  );
  assert.equal(overclaimedLockedBankRes.findings.length, 1);
  assert.equal(overclaimedLockedBankRes.findings[0].termId, 'bank-fin');
  assert.equal(overclaimedLockedBankRes.findings[0].severity, 'low');
  assert.equal(overclaimedLockedBankRes.findings[0].classification, 'contextual_review');
  assert.equal(overclaimedLockedBankRes.findings[0].reason, 'contextual_review_needed');

  // Legitimate single-sense paragraph control for locked "bank"
  const singleRiverBankRes = lintParagraphTerminology(
    {
      index: 1,
      englishText: 'He rested quietly on the muddy river bank.',
      banglaText: 'সে কর্দমাক্ত নদীর তীরে নীরবে বিশ্রাম নিল।',
    },
    lockedBankHomonyms
  );
  assert.equal(singleRiverBankRes.findings.length, 0);
  assert.deepEqual(singleRiverBankRes.satisfiedTermIds, ['bank-river']);
});

test('36. Step 2B.1.1 Regression (Corrections 4, 5, & 6): Unified 0-based VerificationIssue paragraphIndex, Stage 1 location_sync priority, and Stage 1 coverage warning classification', () => {
  // 1. Unified 0-based VerificationIssue.paragraphIndex across first (0), middle (1), and final (2) paragraphs
  const glossary = normalizeGlossaryList([
    createUserTerminologyItem({
      id: 'u-lantern-room',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      avoidTranslations: ['লণ্ঠন কক্ষ'],
      category: 'place',
    }),
  ]);

  const threeParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'First paragraph in the lantern room.',
      banglaText: 'প্রথম অনুচ্ছেদে লণ্ঠন কক্ষে আলো জ্বলল।',
    },
    {
      index: 1,
      englishText: 'Middle paragraph in the lantern room.',
      banglaText: 'মাঝের অনুচ্ছেদে লণ্ঠন কক্ষে বাতাস বইল।',
    },
    {
      index: 2,
      englishText: 'Final paragraph in the lantern room.',
      banglaText: 'শেষ অনুচ্ছেদে লণ্ঠন কক্ষে দরজা বন্ধ হলো।',
    },
  ];

  const chapterLint = lintChapterTerminology(threeParagraphs, glossary);
  assert.equal(chapterLint.findings.length, 3);
  assert.equal(chapterLint.issues.length, 3);

  for (let idx = 0; idx < threeParagraphs.length; idx++) {
    const finding = chapterLint.findings[idx];
    const issue = chapterLint.issues[idx];
    const directIssue = terminologyFindingToVerificationIssue(finding);

    assert.equal(finding.paragraphIndex, idx);
    assert.equal(finding.displayParagraphNumber, idx + 1);
    assert.equal(issue.paragraphIndex, idx);
    assert.equal(directIssue.paragraphIndex, idx);
    assert.ok(
      issue.paragraphIndex >= 0 && issue.paragraphIndex < threeParagraphs.length,
      `Expected 0 <= issue.paragraphIndex (${issue.paragraphIndex}) < ${threeParagraphs.length}`
    );
    assert.ok(threeParagraphs[issue.paragraphIndex] !== undefined);
  }

  const reconciled = mergeVerificationReportWithTerminologyLint({
    aiReport: {
      overallScore: 90,
      fidelitySummary: 'AI check',
      isComplete: true,
      issues: [],
      checkedAt: '2026-11-01T00:00:00.000Z',
    },
    lintResult: chapterLint,
    paragraphs: threeParagraphs,
  });

  assert.deepEqual(
    reconciled.issues.map((i) => i.paragraphIndex),
    [0, 1, 2]
  );

  // 2. Stage 1 location_sync supersedes provisional chunk_ai ("Marrow Bay"), while never overwriting stage1_ai or user locks
  const provisionalChunkMarrowBay: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'chunk-mb',
    englishTerm: 'Marrow Bay',
    banglaTranslation: 'ম্যারো খাঁড়ি',
    category: 'place',
    source: 'chunk_ai',
    lockedByUser: false,
  });

  const syncedFromChunk = syncLocationsToGlossary([provisionalChunkMarrowBay], [
    {
      name: 'Marrow Bay',
      banglaName: 'ম্যারো উপসাগর',
      description: 'Sheltered coastal bay below the lighthouse',
    },
  ]);

  assert.equal(syncedFromChunk.length, 1);
  assert.equal(syncedFromChunk[0].englishTerm, 'Marrow Bay');
  assert.equal(syncedFromChunk[0].banglaTranslation, 'ম্যারো উপসাগর');
  assert.equal(syncedFromChunk[0].source, 'location_sync');
  assert.deepEqual(syncedFromChunk[0].acceptedAlternatives, []);

  // location_sync must NOT overwrite an already-established stage1_ai entry or user-locked entry
  const establishedStage1MarrowBay: TerminologyMemoryItem = normalizeTerminologyItem({
    id: 'stage1-mb',
    englishTerm: 'Marrow Bay',
    banglaTranslation: 'ম্যারো উপসাগর',
    category: 'place',
    source: 'stage1_ai',
    lockedByUser: false,
  });

  const syncedOverStage1 = syncLocationsToGlossary([establishedStage1MarrowBay], [
    {
      name: 'Marrow Bay',
      banglaName: 'ম্যারো খাঁড়ি',
      description: 'Conflicting location sync name',
    },
  ]);
  assert.equal(syncedOverStage1.length, 1);
  assert.equal(syncedOverStage1[0].banglaTranslation, 'ম্যারো উপসাগর');
  assert.equal(syncedOverStage1[0].source, 'stage1_ai');

  // 3. Stage 1 coverage warning classification distinguishes failed, budget-skipped, and unexecuted scheduled windows
  const p1 = 'A'.repeat(5000);
  const p2 = 'B'.repeat(5000);
  const p3 = 'C'.repeat(5000);
  const fourWindowText = `${p1}\n\n${p2}\n\n${p3}\n\n${p1}`;

  // Plan with maxWindows: 3 on a 4-window chapter -> windows #0, #1, #2 scheduled; window #3 skipped due to window budget
  const planWithBudgetCap = splitTextIntoStage1Windows(fourWindowText, {
    maxWindowChars: 6000,
    maxWindows: 3,
  });
  assert.equal(planWithBudgetCap.allWindows.length, 4);
  assert.deepEqual(planWithBudgetCap.skippedWindowIndices, [3]);

  // Suppose window #0 succeeded, window #1 failed, window #2 had no recorded outcome, and window #3 was budget-skipped
  const coverageMixed = computeStage1Coverage(planWithBudgetCap, [
    { windowIndex: 0, success: true },
    { windowIndex: 1, success: false, errorMessage: 'HTTP 503' },
  ]);

  assert.equal(coverageMixed.isComplete, false);
  assert.equal(coverageMixed.isPartial, true);
  assert.equal(coverageMixed.successfulWindows, 1);
  assert.deepEqual(coverageMixed.failedWindowIndices, [1]);
  assert.deepEqual(coverageMixed.skippedWindowIndices, [2, 3]);
  assert.ok(coverageMixed.warningMessage?.includes('1 window(s) failed (#2)'));
  assert.ok(
    coverageMixed.warningMessage?.includes('1 window(s) skipped due to window budget (#4)')
  );
  assert.ok(
    coverageMixed.warningMessage?.includes(
      '1 scheduled window(s) had no recorded outcome (#3)'
    )
  );

  // When all windows were within budget (no budget cap) and window #1 had no recorded outcome,
  // warningMessage must NEVER say "skipped due to window budget"
  const twoWindowPlan = splitTextIntoStage1Windows(`${p1}\n\n${p2}`, {
    maxWindowChars: 6000,
  });
  const coverageMissingOutcomeOnly = computeStage1Coverage(twoWindowPlan, [
    { windowIndex: 0, success: true },
  ]);
  assert.equal(coverageMissingOutcomeOnly.isComplete, false);
  assert.ok(
    coverageMissingOutcomeOnly.warningMessage?.includes(
      '1 scheduled window(s) had no recorded outcome (#2)'
    )
  );
  assert.equal(
    coverageMissingOutcomeOnly.warningMessage?.includes('skipped due to window budget'),
    false
  );
});

// ============================================================================
// STEP 2B.2.1 — STAGE 1 BACKEND INTEGRATION DETERMINISTIC TESTS
// ============================================================================

test('Step 2B.2.1 (1): Single-window Stage 1 execution returns complete coverage and merged entities', async () => {
  const sampleText =
    'Amina walked into the lantern room at dusk.\n\nShe polished the brass lens while the storm gathered over Marrow Bay.';

  const result = await analyzeStoryUnderstanding({
    text: sampleText,
    projectTitle: 'The Lighthouse Keeper',
    genre: 'Literary Fiction',
    existingCharacters: [],
    existingTerminology: [],
    windowExecutor: async ({ windowSlice, isContinuationWindow }) => {
      assert.equal(windowSlice.windowIndex, 0);
      assert.equal(isContinuationWindow, false);
      return {
        storyContext: {
          summary: 'Amina prepares the lighthouse lantern before a coastal storm.',
          narrativeTimeline: 'Evening at dusk before the storm.',
          importantEvents: ['Amina enters the lantern room', 'Storm gathers over Marrow Bay'],
          emotionalContext: 'Quiet resolve and anticipation.',
          literaryTone: 'Lyrical and atmospheric.',
          locations: [
            {
              name: 'Marrow Bay',
              banglaName: 'ম্যারো উপসাগর',
              description: 'Stormy coastal bay below the lighthouse',
            },
          ],
        },
        characters: [
          {
            englishName: 'Amina',
            banglaName: 'আমিনা',
            relationships: 'Lighthouse keeper',
            pronouns: 'she/her',
            personality: 'Diligent and observant',
            speakingStyle: 'Measured',
            notes: 'Protagonist',
          },
        ],
        terminology: [
          {
            englishTerm: 'lantern room',
            banglaTranslation: 'দীপকক্ষ',
            category: 'place',
            notes: 'Top chamber housing the lamp',
          },
          {
            englishTerm: 'brass lens',
            banglaTranslation: 'পিতলের লেন্স',
            category: 'object',
            notes: 'Optical assembly',
          },
        ],
      };
    },
  });

  assert.equal(result.stage1Coverage.isComplete, true);
  assert.equal(result.stage1Coverage.isPartial, false);
  assert.equal(result.stage1Coverage.totalWindows, 1);
  assert.equal(result.stage1Coverage.successfulWindows, 1);
  assert.deepEqual(result.stage1Coverage.failedWindowIndices, []);
  assert.deepEqual(result.stage1Coverage.skippedWindowIndices, []);
  assert.equal(result.stage1Coverage.analyzedChars, result.stage1Coverage.totalChars);
  assert.equal(result.stage1Coverage.warningMessage, undefined);

  assert.equal(result.extractedCharacters.length, 1);
  assert.equal(result.extractedCharacters[0].banglaName, 'আমিনা');
  assert.equal(result.extractedTerminology.length, 3); // lantern room, brass lens, Marrow Bay (location_sync)
});

test('Step 2B.2.1 (2): Multi-window chapter (>12,000 chars) executes all scheduled windows and aggregates storyContext, extractedCharacters, and extractedTerminology', async () => {
  const window0Para = `Arjun stood on the Iron Bridge watching the river.\n\n${'The monsoon wind swept across the stone arches of the Iron Bridge. '.repeat(190)}`;
  const window1Para = `Meera arrived at the Clock Tower with the ancient ledger.\n\n${'Rain drummed against the stained glass of the Clock Tower all night. '.repeat(190)}`;
  const longText = `${window0Para}\n\n${window1Para}`;
  assert.ok(longText.length > 24000);

  const executedWindowIndices: number[] = [];

  const result = await analyzeStoryUnderstanding({
    text: longText,
    projectTitle: 'Monsoon Chronicles',
    genre: 'Historical Fiction',
    existingCharacters: [],
    existingTerminology: [],
    windowExecutor: async ({ windowSlice }) => {
      executedWindowIndices.push(windowSlice.windowIndex);
      if (windowSlice.windowIndex === 0) {
        return {
          storyContext: {
            summary: 'Arjun stands watch at the Iron Bridge during the monsoon.',
            narrativeTimeline: 'Late monsoon evening.',
            importantEvents: ['Arjun watches the river'],
            emotionalContext: 'Somber anticipation.',
            literaryTone: 'Elegiac.',
            locations: [
              {
                name: 'Iron Bridge',
                banglaName: 'লোহার সেতু',
                description: 'Old bridge across the river',
              },
            ],
          },
          characters: [
            {
              englishName: 'Arjun',
              banglaName: 'অর্জুন',
              relationships: 'Archivist',
              pronouns: 'he/him',
              personality: 'Stoic',
              speakingStyle: 'Quiet',
              notes: 'Waits on the bridge',
            },
          ],
          terminology: [
            {
              englishTerm: 'Iron Bridge',
              banglaTranslation: 'লোহার সেতু',
              category: 'place',
              notes: 'River crossing',
            },
          ],
        };
      }
      return {
        storyContext: {
          summary: 'Meera reaches the Clock Tower.',
          narrativeTimeline: 'Midnight.',
          importantEvents: ['Meera brings the ancient ledger'],
          emotionalContext: 'Urgent.',
          literaryTone: 'Tense.',
          locations: [
            {
              name: 'Clock Tower',
              banglaName: 'ঘড়িঘর',
              description: 'Tower in the square',
            },
          ],
        },
        characters: [
          {
            englishName: 'Meera',
            banglaName: 'মীরা',
            relationships: 'Historian',
            pronouns: 'she/her',
            personality: 'Resolute',
            speakingStyle: 'Direct',
            notes: 'Carries the ledger',
          },
        ],
        terminology: [
          {
            englishTerm: 'ancient ledger',
            banglaTranslation: 'প্রাচীন খতিয়ান',
            category: 'object',
            notes: 'Historical record book',
          },
        ],
      };
    },
  });

  assert.ok(executedWindowIndices.length >= 2);
  assert.equal(result.stage1Coverage.isComplete, true);
  assert.equal(result.stage1Coverage.successfulWindows, result.stage1Coverage.totalWindows);
  assert.equal(result.extractedCharacters.length, 2);
  const termsByEnglish = new Map(
    result.extractedTerminology.map((t) => [t.englishTerm.toLowerCase(), t])
  );
  assert.equal(termsByEnglish.get('iron bridge')?.banglaTranslation, 'লোহার সেতু');
  assert.equal(termsByEnglish.get('ancient ledger')?.banglaTranslation, 'প্রাচীন খতিয়ান');
  assert.equal(termsByEnglish.get('clock tower')?.banglaTranslation, 'ঘড়িঘর');
});

test('Step 2B.2.1 (3): Window 1 summary, narrativeTimeline, emotionalContext, and literaryTone are preserved while importantEvents and locations are deduplicated across windows', async () => {
  const window0Para = `Arjun stood on the Iron Bridge watching the river.\n\n${'The monsoon wind swept across the stone arches of the Iron Bridge. '.repeat(60)}`;
  const window1Para = `Meera arrived at the Clock Tower with the ancient ledger.\n\n${'Rain drummed against the stained glass of the Clock Tower all night. '.repeat(60)}`;
  const longText = `${window0Para}\n\n${window1Para}`;

  const observedFraming: boolean[] = [];

  const result = await analyzeStoryUnderstanding({
    text: longText,
    projectTitle: 'Monsoon Chronicles',
    genre: 'Historical Fiction',
    existingCharacters: [],
    existingTerminology: [],
    maxWindowChars: 7000,
    windowExecutor: async ({ windowSlice, isContinuationWindow, prompt }) => {
      observedFraming.push(isContinuationWindow);
      if (windowSlice.windowIndex === 0) {
        return {
          storyContext: {
            summary: 'Window 1 primary summary of the monsoon vigil.',
            narrativeTimeline: 'Window 1 primary timeline: late monsoon dusk.',
            importantEvents: ['Arjun watches the river', 'Shared monsoon event'],
            emotionalContext: 'Window 1 somber reflection.',
            literaryTone: 'Window 1 elegiac tone.',
            locations: [
              {
                name: 'Iron Bridge',
                banglaName: 'লোহার সেতু',
                description: 'Old bridge across the river',
              },
            ],
          },
          characters: [
            {
              englishName: 'Arjun',
              banglaName: 'অর্জুন',
              relationships: 'Archivist',
              pronouns: 'he/him',
              personality: 'Stoic',
              speakingStyle: 'Quiet',
              notes: 'Waits on the bridge',
            },
          ],
          terminology: [
            {
              englishTerm: 'Iron Bridge',
              banglaTranslation: 'লোহার সেতু',
              category: 'place',
              notes: 'River crossing',
            },
          ],
        };
      }

      // Verify Window 1 prompt includes Window 0's discovered memory and continuation context
      assert.ok(prompt.includes('ESTABLISHED STORY CONTEXT FROM PRIOR ANALYSIS'));
      assert.ok(prompt.includes('Arjun'));
      assert.ok(prompt.includes('লোহার সেতু'));

      return {
        storyContext: {
          summary: 'Window 2 continuation summary that must not overwrite Window 1.',
          narrativeTimeline: 'Window 2 timeline that must not overwrite Window 1.',
          importantEvents: ['Shared monsoon event', 'Meera brings the ancient ledger'],
          emotionalContext: 'Window 2 urgent mood.',
          literaryTone: 'Window 2 tense tone.',
          locations: [
            {
              name: 'Iron Bridge',
              banglaName: 'ভিন্ন সেতু',
              description: 'Duplicate location that should keep Window 1 banglaName',
            },
            {
              name: 'Clock Tower',
              banglaName: 'ঘড়িঘর',
              description: 'Tower in the square',
            },
          ],
        },
        characters: [],
        terminology: [],
      };
    },
  });

  assert.deepEqual(observedFraming, [false, true]);
  assert.equal(result.storyContext.summary, 'Window 1 primary summary of the monsoon vigil.');
  assert.equal(
    result.storyContext.narrativeTimeline,
    'Window 1 primary timeline: late monsoon dusk.'
  );
  assert.equal(result.storyContext.emotionalContext, 'Window 1 somber reflection.');
  assert.equal(result.storyContext.literaryTone, 'Window 1 elegiac tone.');

  assert.deepEqual(result.storyContext.importantEvents, [
    'Arjun watches the river',
    'Shared monsoon event',
    'Meera brings the ancient ledger',
  ]);
  assert.equal(result.storyContext.locations.length, 2);
  assert.equal(result.storyContext.locations[0].banglaName, 'লোহার সেতু');
  assert.equal(result.storyContext.locations[1].banglaName, 'ঘড়িঘর');
});

test('Step 2B.2.1 (4): storyContext.locations are synced into extractedTerminology as place/location_sync without overwriting higher-priority entries', async () => {
  const userLockedHarbor = createUserTerminologyItem({
    englishTerm: 'Old Harbor',
    banglaTranslation: 'পুরানো বন্দর',
    category: 'place',
    lockedByUser: true,
  });

  const result = await analyzeStoryUnderstanding({
    text: 'Ships gathered at Old Harbor before sailing toward Coral Reef.',
    projectTitle: 'Sea Voyage',
    genre: 'Adventure',
    existingCharacters: [],
    existingTerminology: [userLockedHarbor],
    windowExecutor: async () => ({
      storyContext: {
        summary: 'Voyage begins at Old Harbor.',
        narrativeTimeline: 'Dawn.',
        importantEvents: ['Departure'],
        emotionalContext: 'Hopeful',
        literaryTone: 'Crisp',
        locations: [
          {
            name: 'Old Harbor',
            banglaName: 'প্রাচীন পোতাশ্রয়',
            description: 'Should not overwrite user-locked Old Harbor',
          },
          {
            name: 'Coral Reef',
            banglaName: 'প্রবাল প্রাচীর',
            description: 'Synced location entry',
          },
        ],
      },
      characters: [],
      terminology: [],
    }),
  });

  const harborTerm = result.extractedTerminology.find(
    (t) => t.englishTerm.toLowerCase() === 'old harbor'
  );
  const reefTerm = result.extractedTerminology.find(
    (t) => t.englishTerm.toLowerCase() === 'coral reef'
  );

  assert.ok(harborTerm);
  assert.equal(harborTerm.banglaTranslation, 'পুরানো বন্দর');
  assert.equal(harborTerm.source, 'user');
  assert.equal(harborTerm.lockedByUser, true);

  assert.ok(reefTerm);
  assert.equal(reefTerm.banglaTranslation, 'প্রবাল প্রাচীর');
  assert.equal(reefTerm.category, 'place');
  assert.equal(reefTerm.source, 'location_sync');
  assert.equal(reefTerm.lockedByUser, false);
});

test('Step 2B.2.1 (5): Same-pass conflicting Stage 1 AI translations keep Window 1 primary, keep acceptedAlternatives empty, and record secondary candidate only in notes', async () => {
  const w0 = `He looked into the mirror in the hallway.\n\n${'The mirror reflected the candle flame. '.repeat(90)}`;
  const w1 = `She cleaned the mirror in the parlor.\n\n${'The mirror gleamed in the morning sun. '.repeat(90)}`;

  const result = await analyzeStoryUnderstanding({
    text: `${w0}\n\n${w1}`,
    projectTitle: 'The Glass House',
    genre: 'Literary Fiction',
    existingCharacters: [],
    existingTerminology: [],
    maxWindowChars: 3000,
    windowExecutor: async ({ windowSlice }) => {
      if (windowSlice.windowIndex === 0) {
        return {
          storyContext: {
            summary: 'Hallway reflection.',
            narrativeTimeline: 'Night.',
            importantEvents: [],
            emotionalContext: 'Quiet',
            literaryTone: 'Reflective',
            locations: [],
          },
          characters: [],
          terminology: [
            {
              englishTerm: 'mirror',
              banglaTranslation: 'আয়না',
              category: 'object',
              notes: 'hallway glass',
            },
          ],
        };
      }
      return {
        storyContext: {
          summary: 'Parlor scene.',
          narrativeTimeline: 'Morning.',
          importantEvents: [],
          emotionalContext: 'Bright',
          literaryTone: 'Calm',
          locations: [],
        },
        characters: [],
        terminology: [
          {
            englishTerm: 'mirror',
            banglaTranslation: 'দর্পণ',
            category: 'object',
            notes: 'formal parlor rendering',
          },
        ],
      };
    },
  });

  const mirrorTerms = result.extractedTerminology.filter(
    (t) => t.englishTerm.toLowerCase() === 'mirror'
  );
  assert.equal(mirrorTerms.length, 1);
  const mirror = mirrorTerms[0];
  assert.equal(mirror.banglaTranslation, 'আয়না');
  assert.deepEqual(mirror.acceptedAlternatives, []);
  assert.ok(mirror.notes.includes('hallway glass'));
  assert.ok(
    mirror.notes.includes('Alternate Stage 1 candidate: দর্পণ (formal parlor rendering)')
  );
});

test('Step 2B.2.1 (6): Conflicting Stage 1 AI translation does not overwrite a user-locked entry, does not enter acceptedAlternatives, and does not append an AI conflict note', async () => {
  const userLockedMirror = createUserTerminologyItem({
    englishTerm: 'mirror',
    banglaTranslation: 'দর্পণ',
    category: 'object',
    notes: 'User canonical choice',
    lockedByUser: true,
  });

  const result = await analyzeStoryUnderstanding({
    text: 'The mirror hung above the hearth.',
    projectTitle: 'Hearthside',
    genre: 'Drama',
    existingCharacters: [],
    existingTerminology: [userLockedMirror],
    windowExecutor: async () => ({
      storyContext: {
        summary: 'A room with a mirror.',
        narrativeTimeline: 'Evening.',
        importantEvents: [],
        emotionalContext: 'Warm',
        literaryTone: 'Intimate',
        locations: [],
      },
      characters: [],
      terminology: [
        {
          englishTerm: 'mirror',
          banglaTranslation: 'আয়না',
          category: 'object',
          notes: 'Stage 1 AI alternative suggestion',
        },
      ],
    }),
  });

  const mirror = result.extractedTerminology.find(
    (t) => t.englishTerm.toLowerCase() === 'mirror'
  );
  assert.ok(mirror);
  assert.equal(mirror.banglaTranslation, 'দর্পণ');
  assert.deepEqual(mirror.acceptedAlternatives, []);
  assert.equal(mirror.notes, 'User canonical choice');
  assert.equal(mirror.notes.includes('Alternate Stage 1 candidate'), false);
  assert.equal(mirror.lockedByUser, true);
  assert.equal(mirror.source, 'user');
});

test('Step 2B.2.1 (7): Conflicting Stage 1 AI translation matching avoidTranslations is neither added to acceptedAlternatives nor recorded as an advisory note', async () => {
  const existingStage1WithAvoid = normalizeTerminologyItem({
    id: 'term-estate',
    englishTerm: 'estate',
    banglaTranslation: 'জমিদারি',
    avoidTranslations: ['এস্টেট'],
    category: 'place',
    notes: 'Ancestral property',
    source: 'stage1_ai',
    lockedByUser: false,
  });

  const result = await analyzeStoryUnderstanding({
    text: 'They returned to the old estate before winter.',
    projectTitle: 'Winter Return',
    genre: 'Literary Fiction',
    existingCharacters: [],
    existingTerminology: [existingStage1WithAvoid],
    windowExecutor: async () => ({
      storyContext: {
        summary: 'Returning to the estate.',
        narrativeTimeline: 'Late autumn.',
        importantEvents: [],
        emotionalContext: 'Nostalgic',
        literaryTone: 'Measured',
        locations: [],
      },
      characters: [],
      terminology: [
        {
          englishTerm: 'estate',
          banglaTranslation: 'এস্টেট',
          category: 'place',
          notes: 'Transliterated form',
        },
      ],
    }),
  });

  const estate = result.extractedTerminology.find(
    (t) => t.englishTerm.toLowerCase() === 'estate'
  );
  assert.ok(estate);
  assert.equal(estate.banglaTranslation, 'জমিদারি');
  assert.deepEqual(estate.acceptedAlternatives, []);
  assert.deepEqual(estate.avoidTranslations, ['এস্টেট']);
  assert.equal(estate.notes, 'Ancestral property');
  assert.equal(estate.notes.includes('এস্টেট'), false);
});

test('Step 2B.2.1 (8): Parenthetical sanitization strips single, chained, and mid-string/nested parentheticals while preserving isContextSensitive: false', () => {
  const windowText =
    'He checked his watch before climbing the bank wall near the sanctuary.';

  const sanitized = sanitizeStage1WindowTerminology(
    [
      {
        englishTerm: 'watch (silver) (pocket)',
        banglaTranslation: 'ঘড়ি',
        category: 'object',
        notes: 'Heirloom timepiece',
      },
      {
        englishTerm: 'bank (river (eastern)) wall',
        banglaTranslation: 'তীরের প্রাচীর',
        category: 'place',
        notes: 'Stone embankment',
      },
      {
        englishTerm: 'sanctuary (inner)',
        banglaTranslation: 'গর্ভগৃহ',
        category: 'place',
        notes: '',
      },
    ],
    windowText
  );

  assert.equal(sanitized.length, 3);

  assert.equal(sanitized[0].englishTerm, 'watch');
  assert.equal(sanitized[0].isContextSensitive, false);
  assert.equal(sanitized[0].contextMeaning, undefined);
  assert.ok(sanitized[0].notes?.includes('silver'));
  assert.ok(sanitized[0].notes?.includes('pocket'));
  assert.equal(extractContextualSenseKey(sanitized[0]), '');

  assert.equal(sanitized[1].englishTerm, 'bank wall');
  assert.equal(sanitized[1].isContextSensitive, false);
  assert.equal(sanitized[1].contextMeaning, undefined);
  assert.ok(sanitized[1].notes?.includes('eastern'));
  assert.ok(sanitized[1].notes?.includes('river'));
  assert.equal(extractContextualSenseKey(sanitized[1]), '');

  assert.equal(sanitized[2].englishTerm, 'sanctuary');
  assert.equal(sanitized[2].isContextSensitive, false);
  assert.equal(sanitized[2].contextMeaning, undefined);
  assert.equal(sanitized[2].notes, 'inner');
  assert.equal(extractContextualSenseKey(sanitized[2]), '');
});

test('Step 2B.2.1 (9): Note sanitization strips repeated prefixes and neutralizes embedded trigger phrases so extractContextualSenseKey === ""', () => {
  const rawNote =
    'Context:Sense: Meaning: Usage: Domain: when referring to the royal seal; in the sense of authority when used as a decree specifically for the court';
  const cleaned = sanitizeStage1NoteForNonContextualAI(rawNote, 'seal');

  assert.equal(/^(?:context|sense|meaning|domain|usage)\s*:/i.test(cleaned), false);
  assert.equal(
    /\b(?:when referring to|in the sense of|when used as|specifically for)\b/i.test(cleaned),
    false
  );
  assert.equal(
    extractContextualSenseKey({
      englishTerm: 'seal',
      notes: cleaned,
      isContextSensitive: false,
    }),
    ''
  );

  // Also verify combined parenthetical + raw.notes trigger neutralization
  const sanitizedTerms = sanitizeStage1WindowTerminology(
    [
      {
        englishTerm: 'crown (Context: royal insignia)',
        banglaTranslation: 'মুকুট',
        category: 'object',
        notes: 'Sense: when referring to sovereignty',
      },
    ],
    'The ancient crown rested on the velvet cushion.'
  );

  assert.equal(sanitizedTerms.length, 1);
  assert.equal(sanitizedTerms[0].englishTerm, 'crown');
  assert.equal(extractContextualSenseKey(sanitizedTerms[0]), '');
});

test('Step 2B.2.1 (10): Ungrounded Stage 1 AI terms absent from windowText are rejected', () => {
  const windowText = 'The carriage stopped beside the banyan tree at noon.';
  const sanitized = sanitizeStage1WindowTerminology(
    [
      {
        englishTerm: 'banyan tree',
        banglaTranslation: 'বটগাছ',
        category: 'object',
        notes: 'Present in text',
      },
      {
        englishTerm: 'obsidian throne',
        banglaTranslation: 'অবসিডিয়ান সিংহাসন',
        category: 'object',
        notes: 'Hallucinated term absent from text',
      },
    ],
    windowText
  );

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].englishTerm, 'banyan tree');
});

test('Step 2B.2.1 (11): Stage 1 AI terms supersede provisional chunk_ai entries without promoting old chunk_ai translation into acceptedAlternatives', async () => {
  const provisionalChunkTerm = normalizeTerminologyItem({
    id: 'chunk-lantern',
    englishTerm: 'lantern',
    banglaTranslation: 'লণ্ঠন',
    category: 'object',
    source: 'chunk_ai',
    lockedByUser: false,
  });

  const result = await analyzeStoryUnderstanding({
    text: 'He raised the lantern in the corridor.',
    projectTitle: 'Corridor Watch',
    genre: 'Mystery',
    existingCharacters: [],
    existingTerminology: [provisionalChunkTerm],
    windowExecutor: async () => ({
      storyContext: {
        summary: 'Searching the corridor.',
        narrativeTimeline: 'Midnight.',
        importantEvents: [],
        emotionalContext: 'Suspenseful',
        literaryTone: 'Taut',
        locations: [],
      },
      characters: [],
      terminology: [
        {
          englishTerm: 'lantern',
          banglaTranslation: 'প্রদীপ-লণ্ঠন',
          category: 'object',
          notes: 'Stage 1 curated rendering',
        },
      ],
    }),
  });

  const lantern = result.extractedTerminology.find(
    (t) => t.englishTerm.toLowerCase() === 'lantern'
  );
  assert.ok(lantern);
  assert.equal(lantern.banglaTranslation, 'প্রদীপ-লণ্ঠন');
  assert.equal(lantern.source, 'stage1_ai');
  assert.deepEqual(lantern.acceptedAlternatives, []);
  assert.equal(lantern.notes.includes('Alternate Stage 1 candidate'), false);
});

test('Step 2B.2.1 (12): Mid-pass window failure produces isComplete: false, isPartial: true, accurate failedWindowIndices, accurate analyzedChars, and clean storyContext', async () => {
  const w0 = 'The magistrate reviewed the petition carefully. '.repeat(40).trim();
  const w1 = 'The courier rode through the canyon at midnight. '.repeat(40).trim();

  const result = await analyzeStoryUnderstanding({
    text: `${w0}\n\n${w1}`,
    projectTitle: 'The Petition',
    genre: 'Historical Drama',
    existingCharacters: [],
    existingTerminology: [],
    maxWindowChars: 3000,
    maxRetries: 1,
    windowExecutor: async ({ windowSlice }) => {
      if (windowSlice.windowIndex === 1) {
        throw new Error('Upstream 503 Service Unavailable');
      }
      return {
        storyContext: {
          summary: 'The magistrate reviews a village petition.',
          narrativeTimeline: 'Morning session.',
          importantEvents: ['Petition presented'],
          emotionalContext: 'Solemn',
          literaryTone: 'Formal',
          locations: [],
        },
        characters: [],
        terminology: [
          {
            englishTerm: 'magistrate',
            banglaTranslation: 'ম্যাজিস্ট্রেট',
            category: 'title',
            notes: 'District official',
          },
        ],
      };
    },
  });

  assert.equal(result.stage1Coverage.isComplete, false);
  assert.equal(result.stage1Coverage.isPartial, true);
  assert.equal(result.stage1Coverage.totalWindows, 2);
  assert.equal(result.stage1Coverage.successfulWindows, 1);
  assert.deepEqual(result.stage1Coverage.failedWindowIndices, [1]);
  assert.deepEqual(result.stage1Coverage.skippedWindowIndices, []);
  assert.equal(result.stage1Coverage.analyzedChars, w0.length);
  assert.ok(result.stage1Coverage.warningMessage?.includes('1 window(s) failed (#2)'));

  // storyContext must remain completely clean of coverage warning text
  assert.equal(result.storyContext.summary, 'The magistrate reviews a village petition.');
  assert.equal(result.storyContext.summary.includes('coverage'), false);
});

test('Step 2B.2.1 (13): Window-budget overflow (maxWindows exceeded) produces accurate skippedWindowIndices and budget-skip warningMessage', async () => {
  const seg1 = `Paragraph one in window one.\n\n${'The caravan crossed the northern ridge. '.repeat(35)}`;
  const seg2 = `Paragraph two in window two.\n\n${'The caravan rested by the oasis. '.repeat(40)}`;
  const seg3 = `Paragraph three in window three.\n\n${'The caravan reached the walled city. '.repeat(35)}`;

  const result = await analyzeStoryUnderstanding({
    text: `${seg1}\n\n${seg2}\n\n${seg3}`,
    projectTitle: 'Desert Caravan',
    genre: 'Adventure',
    existingCharacters: [],
    existingTerminology: [],
    maxWindowChars: 2000,
    maxWindows: 2,
    windowExecutor: async ({ windowSlice }) => ({
      storyContext: {
        summary: `Summary from window ${windowSlice.windowIndex + 1}`,
        narrativeTimeline: 'Daytime trek',
        importantEvents: [`Event ${windowSlice.windowIndex + 1}`],
        emotionalContext: 'Enduring',
        literaryTone: 'Epic',
        locations: [],
      },
      characters: [],
      terminology: [
        {
          englishTerm: 'caravan',
          banglaTranslation: 'কাফেলা',
          category: 'object',
          notes: 'Traveling merchants',
        },
      ],
    }),
  });

  assert.equal(result.stage1Coverage.totalWindows, 3);
  assert.equal(result.stage1Coverage.successfulWindows, 2);
  assert.equal(result.stage1Coverage.isComplete, false);
  assert.equal(result.stage1Coverage.isPartial, true);
  assert.deepEqual(result.stage1Coverage.failedWindowIndices, []);
  assert.deepEqual(result.stage1Coverage.skippedWindowIndices, [2]);
  assert.ok(
    result.stage1Coverage.warningMessage?.includes(
      '1 window(s) skipped due to window budget (#3)'
    )
  );
});

test('Step 2B.2.1 (14): Malformed JSON returned by a window triggers withRetry() and succeeds when a retry returns valid JSON', async () => {
  let attempts = 0;

  const result = await analyzeStoryUnderstanding({
    text: 'The compass pointed toward the northern glacier.',
    projectTitle: 'Polar Expedition',
    genre: 'Adventure',
    existingCharacters: [],
    existingTerminology: [],
    maxRetries: 2,
    windowExecutor: async () => {
      attempts++;
      if (attempts === 1) {
        return '{ malformed json: [unclosed ';
      }
      return JSON.stringify({
        storyContext: {
          summary: 'Expedition follows the compass north.',
          narrativeTimeline: 'Winter solstice.',
          importantEvents: ['Compass reading taken'],
          emotionalContext: 'Focused',
          literaryTone: 'Sparse',
          locations: [],
        },
        characters: [],
        terminology: [
          {
            englishTerm: 'compass',
            banglaTranslation: 'কম্পাস',
            category: 'object',
            notes: 'Navigation instrument',
          },
        ],
      });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.stage1Coverage.isComplete, true);
  assert.equal(result.extractedTerminology.length, 1);
  assert.equal(result.extractedTerminology[0].banglaTranslation, 'কম্পাস');
});

test('Step 2B.2.1 (15): If Window 0 fails and no existingStoryContext is present, Window 1 receives primary-analysis prompt framing rather than continuation framing', async () => {
  const w0 = `Window zero text.\n\n${'The watchman patrolled the outer gate. '.repeat(40)}`;
  const w1 = `Window one text.\n\n${'The herald sounded the silver horn at dawn. '.repeat(40)}`;
  const framingByWindow: Array<{ windowIndex: number; isContinuationWindow: boolean }> = [];

  const result = await analyzeStoryUnderstanding({
    text: `${w0}\n\n${w1}`,
    projectTitle: 'Dawn Herald',
    genre: 'Historical Fiction',
    existingCharacters: [],
    existingTerminology: [],
    existingStoryContext: null,
    maxWindowChars: 2200,
    maxRetries: 0,
    windowExecutor: async ({ windowSlice, isContinuationWindow }) => {
      framingByWindow.push({
        windowIndex: windowSlice.windowIndex,
        isContinuationWindow,
      });
      if (windowSlice.windowIndex === 0) {
        throw new Error('Window 0 transient timeout');
      }
      return {
        storyContext: {
          summary: 'Primary summary established by Window 1 after Window 0 failed.',
          narrativeTimeline: 'Dawn.',
          importantEvents: ['Herald sounds the silver horn'],
          emotionalContext: 'Expectant',
          literaryTone: 'Resonant',
          locations: [],
        },
        characters: [],
        terminology: [
          {
            englishTerm: 'silver horn',
            banglaTranslation: 'রুপালি শিঙা',
            category: 'object',
            notes: 'Signal horn',
          },
        ],
      };
    },
  });

  assert.deepEqual(framingByWindow, [
    { windowIndex: 0, isContinuationWindow: false },
    { windowIndex: 1, isContinuationWindow: false },
  ]);
  assert.equal(
    result.storyContext.summary,
    'Primary summary established by Window 1 after Window 0 failed.'
  );
  assert.deepEqual(result.stage1Coverage.failedWindowIndices, [0]);
  assert.equal(result.stage1Coverage.successfulWindows, 1);
});

test('Step 2B.2.1 (16): Total window failure throws a clear error instead of returning an empty Stage 1 payload', async () => {
  await assert.rejects(
    async () => {
      await analyzeStoryUnderstanding({
        text: 'The bell tolled across the valley.',
        projectTitle: 'Valley Bell',
        genre: 'Literary Fiction',
        existingCharacters: [],
        existingTerminology: [],
        maxRetries: 0,
        windowExecutor: async () => {
          throw new Error('Quota exhausted');
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Stage 1 analysis failed across all 1 scheduled window(s)'));
      assert.ok(err.message.includes('Quota exhausted'));
      return true;
    }
  );
});

test('Step 2B.2.1 (17): Legacy existingTerminology items missing source are conservatively hydrated before merging so user-locked entries remain intact', async () => {
  const legacyItems: TerminologyMemoryItem[] = [
    {
      id: 'legacy-locked',
      englishTerm: 'sanctum',
      banglaTranslation: 'গর্ভগৃহ',
      category: 'place',
      notes: 'Locked user entry from legacy storage',
      lockedByUser: true,
    },
    {
      id: 'legacy-unlocked-dup',
      englishTerm: 'sanctum',
      banglaTranslation: 'পবিত্র কক্ষ',
      category: 'place',
      notes: 'Unlocked legacy duplicate without source',
      lockedByUser: false,
    },
  ];

  const result = await analyzeStoryUnderstanding({
    text: 'The priest entered the sanctum at sunrise.',
    projectTitle: 'Temple Dawn',
    genre: 'Literary Fiction',
    existingCharacters: [],
    existingTerminology: legacyItems,
    windowExecutor: async () => ({
      storyContext: {
        summary: 'Sunrise ritual in the sanctum.',
        narrativeTimeline: 'Sunrise.',
        importantEvents: [],
        emotionalContext: 'Reverent',
        literaryTone: 'Serene',
        locations: [],
      },
      characters: [],
      terminology: [
        {
          englishTerm: 'sanctum',
          banglaTranslation: 'অন্তঃপুর',
          category: 'place',
          notes: 'Stage 1 AI suggestion',
        },
      ],
    }),
  });

  const sanctumEntries = result.extractedTerminology.filter(
    (t) => t.englishTerm.toLowerCase() === 'sanctum'
  );
  assert.equal(sanctumEntries.length, 1);
  assert.equal(sanctumEntries[0].banglaTranslation, 'গর্ভগৃহ');
  assert.equal(sanctumEntries[0].lockedByUser, true);
  assert.equal(sanctumEntries[0].source, 'user');
  assert.deepEqual(sanctumEntries[0].acceptedAlternatives, []);
  assert.equal(sanctumEntries[0].notes, 'Locked user entry from legacy storage');
});

// ============================================================================
// STEP 2B.2.2a — IN-FLIGHT RECONCILIATION, STAGE 3 DISCOVERY & HOMONYM SCOPING
// ============================================================================

test('Step 2B.2.2a (1): Concurrent deletion protection suppresses deleted entries across all sources (stage1_ai, chunk_ai, location_sync, user)', () => {
  const snapshotGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'del-stage1',
      englishTerm: 'spyglass',
      banglaTranslation: 'দূরবীন',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'del-chunk',
      englishTerm: 'halyard',
      banglaTranslation: 'পাল তোলার দড়ি',
      category: 'nautical',
      source: 'chunk_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'del-loc',
      englishTerm: 'North Quay',
      banglaTranslation: 'উত্তর জেটি',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
    createUserTerminologyItem({
      id: 'del-user',
      englishTerm: 'lantern room',
      banglaTranslation: 'দীপকক্ষ',
      category: 'place',
    }),
    normalizeTerminologyItem({
      id: 'keep-compass',
      englishTerm: 'compass',
      banglaTranslation: 'কম্পাস',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
  ];

  // User deletes spyglass, halyard, North Quay, and lantern room while AI request is in flight
  const latestGlossary: TerminologyMemoryItem[] = [snapshotGlossary[4]];

  // AI returns all 5 terms plus 1 genuinely new term ('chronometer')
  const aiReturned: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'ai-temp-1',
      englishTerm: 'spyglass',
      banglaTranslation: 'দূরবীন',
      category: 'object',
      source: 'stage1_ai',
    },
    {
      id: 'ai-temp-2',
      englishTerm: 'halyard',
      banglaTranslation: 'পাল তোলার দড়ি',
      category: 'nautical',
      source: 'chunk_ai',
    },
    {
      id: 'ai-temp-3',
      englishTerm: 'North Quay',
      banglaTranslation: 'উত্তর জেটি',
      category: 'place',
      source: 'location_sync',
    },
    {
      id: 'ai-temp-4',
      englishTerm: 'lantern room',
      banglaTranslation: 'লণ্ঠন কক্ষ',
      category: 'place',
      source: 'stage1_ai',
    },
    {
      id: 'ai-temp-5',
      englishTerm: 'compass',
      banglaTranslation: 'কম্পাস',
      category: 'object',
      source: 'stage1_ai',
    },
    {
      id: 'ai-temp-6',
      englishTerm: 'chronometer',
      banglaTranslation: 'ক্রনোমিটার',
      category: 'object',
      source: 'stage1_ai',
    },
  ];

  const reconciled = reconcileInFlightGlossaryWithLatestState(
    snapshotGlossary,
    latestGlossary,
    aiReturned,
    { defaultSource: 'stage1_ai' }
  );

  assert.deepEqual(
    reconciled.map((t) => t.englishTerm),
    ['compass', 'chronometer']
  );
  assert.equal(reconciled.some((t) => t.englishTerm === 'spyglass'), false);
  assert.equal(reconciled.some((t) => t.englishTerm === 'halyard'), false);
  assert.equal(reconciled.some((t) => t.englishTerm === 'North Quay'), false);
  assert.equal(reconciled.some((t) => t.englishTerm === 'lantern room'), false);
});

test('Step 2B.2.2a (2): Stable-ID semantic edits, category edits, and surface renames suppress old AI senses and preserve user edits verbatim', () => {
  // Case A: Stable-ID contextual sense edit (`bank (river)` -> `bank (financial institution)` retaining ID `term-1`)
  const snapSenseEdit: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'term-1',
      englishTerm: 'bank (river)',
      banglaTranslation: 'তীর',
      category: 'place',
      contextMeaning: 'river',
      isContextSensitive: true,
      source: 'stage1_ai',
    }),
  ];

  const latestSenseEdit: TerminologyMemoryItem[] = [
    updateUserTerminologyItem(snapSenseEdit[0], {
      englishTerm: 'bank (financial institution)',
      banglaTranslation: 'ব্যাংক',
      contextMeaning: 'financial institution',
      isContextSensitive: true,
    }),
  ];

  const aiOldRiverSense: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'ai-river-temp',
      englishTerm: 'bank (river)',
      banglaTranslation: 'তীর',
      category: 'place',
      contextMeaning: 'river',
      isContextSensitive: true,
      source: 'stage1_ai',
    },
    {
      id: 'ai-bare-bank-temp',
      englishTerm: 'bank',
      banglaTranslation: 'তীর',
      category: 'place',
      source: 'stage1_ai',
    },
  ];

  const reconciledSenseEdit = reconcileInFlightGlossaryWithLatestState(
    snapSenseEdit,
    latestSenseEdit,
    aiOldRiverSense
  );

  assert.equal(reconciledSenseEdit.length, 1);
  assert.equal(reconciledSenseEdit[0].id, 'term-1');
  assert.equal(reconciledSenseEdit[0].englishTerm, 'bank (financial institution)');
  assert.equal(reconciledSenseEdit[0].banglaTranslation, 'ব্যাংক');
  assert.equal(reconciledSenseEdit[0].contextMeaning, 'financial institution');
  assert.equal(reconciledSenseEdit[0].lockedByUser, true);
  assert.equal(reconciledSenseEdit[0].source, 'user');

  // Case B: Stable-ID category edit + surface rename (`watch` -> `pocket watch`, category `object`)
  const snapRename: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'term-watch',
      englishTerm: 'watch',
      banglaTranslation: 'ঘড়ি',
      category: 'nautical',
      source: 'stage1_ai',
    }),
  ];

  const latestRename: TerminologyMemoryItem[] = [
    updateUserTerminologyItem(snapRename[0], {
      englishTerm: 'pocket watch',
      banglaTranslation: 'পকেট-ঘড়ি',
      category: 'object',
    }),
  ];

  const reconciledRename = reconcileInFlightGlossaryWithLatestState(
    snapRename,
    latestRename,
    [
      {
        id: 'ai-watch-old',
        englishTerm: 'watch',
        banglaTranslation: 'প্রহরা',
        category: 'nautical',
      },
      {
        id: 'ai-pocket-watch-dup',
        englishTerm: 'pocket watch',
        banglaTranslation: 'হাতঘড়ি',
        category: 'object',
      },
    ]
  );

  assert.equal(reconciledRename.length, 1);
  assert.equal(reconciledRename[0].id, 'term-watch');
  assert.equal(reconciledRename[0].englishTerm, 'pocket watch');
  assert.equal(reconciledRename[0].banglaTranslation, normalizeBanglaUnicode('পকেট-ঘড়ি'));
  assert.equal(reconciledRename[0].category, 'object');
});

test('Step 2B.2.2a (3) [Safeguard 1]: Same-ID translation-only edits, newly created entries, and delete-and-recreate entries are preserved verbatim', () => {
  // 1. Translation-only edit on an existing entry where semantic keys (surface, category, sense) remain identical,
  //    even if the user kept `lockedByUser: false` or `lockedByUser: true`!
  const snapGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'term-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'বিবর্ধক কাচ',
      category: 'object',
      notes: 'Original AI note',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'term-old-del',
      englishTerm: 'mainspring',
      banglaTranslation: 'স্প্রিং',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
  ];

  // User changes ONLY `banglaTranslation` on `term-loupe` (leaving `lockedByUser: false` to test pure verbatim protection),
  // deletes `term-old-del` and recreates `mainspring` under a new ID `term-recreated-main`,
  // and adds a brand-new entry `term-new-cedar` in flight.
  const latestGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'term-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'আতশ কাচ',
      category: 'object',
      notes: 'User refined Bangla translation only',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    createUserTerminologyItem({
      id: 'term-recreated-main',
      englishTerm: 'mainspring',
      banglaTranslation: 'মূল স্প্রিং',
      avoidTranslations: ['স্প্রিং'],
      category: 'object',
      notes: 'Recreated by user with new ID',
    }),
    createUserTerminologyItem({
      id: 'term-new-cedar',
      englishTerm: 'cedar workbench',
      banglaTranslation: 'সিডার কাঠের টেবিল',
      category: 'object',
      notes: 'Added in flight by user',
    }),
  ];

  assert.equal(
    hasGlossaryEntryChangedInFlight(snapGlossary[0], latestGlossary[0]),
    true
  );

  // Stale AI response returns the old translation with a newly generated ID, plus duplicates of mainspring and cedar workbench
  const aiStaleResponse: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'ai-fresh-uuid-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'বিবর্ধক কাচ',
      category: 'object',
      notes: 'Stale AI note that must not overwrite',
      source: 'stage1_ai',
    },
    {
      id: 'ai-fresh-uuid-main',
      englishTerm: 'mainspring',
      banglaTranslation: 'স্প্রিং',
      category: 'object',
      source: 'stage1_ai',
    },
    {
      id: 'ai-fresh-uuid-cedar',
      englishTerm: 'cedar workbench',
      banglaTranslation: 'কাঠের বেঞ্চ',
      category: 'object',
      source: 'stage1_ai',
    },
  ];

  const reconciled = reconcileInFlightGlossaryWithLatestState(
    snapGlossary,
    latestGlossary,
    aiStaleResponse,
    { defaultSource: 'stage1_ai' }
  );

  assert.equal(reconciled.length, 3);
  const loupe = reconciled.find((t) => t.id === 'term-loupe')!;
  assert.deepEqual(loupe, latestGlossary[0]);

  const mainspring = reconciled.find((t) => t.id === 'term-recreated-main')!;
  assert.deepEqual(mainspring, latestGlossary[1]);

  const cedar = reconciled.find((t) => t.id === 'term-new-cedar')!;
  assert.deepEqual(cedar, latestGlossary[2]);
});

test('Step 2B.2.2a (4) [Safeguard 1]: Deleting or editing one contextual homonym never suppresses a distinct coexisting or newly discovered contextual homonym', () => {
  const snapHomonyms: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'bank-river',
      englishTerm: 'bank (river)',
      banglaTranslation: 'পাড়',
      category: 'place',
      contextMeaning: 'river',
      isContextSensitive: true,
      source: 'stage1_ai',
    }),
    normalizeTerminologyItem({
      id: 'bank-finance',
      englishTerm: 'bank (finance)',
      banglaTranslation: 'ব্যাংক',
      category: 'place',
      contextMeaning: 'finance',
      isContextSensitive: true,
      source: 'stage1_ai',
    }),
    normalizeTerminologyItem({
      id: 'school-inst',
      englishTerm: 'school',
      banglaTranslation: 'পাঠশালা',
      category: 'cultural',
      contextMeaning: 'educational institution',
      isContextSensitive: true,
      source: 'stage1_ai',
    }),
  ];

  // User modifies `bank-river` ('পাড়' -> 'তীর'), leaves `bank-finance` untouched, and deletes `school-inst`
  const latestHomonyms: TerminologyMemoryItem[] = [
    updateUserTerminologyItem(snapHomonyms[0], {
      banglaTranslation: 'তীর',
    }),
    snapHomonyms[1],
  ];

  // AI returns:
  // 1) Stale `bank (river)` -> 'পাড়' (must be suppressed)
  // 2) Legitimate distinct homonym `bank (cloud)` -> 'মেঘের স্তূপ' (must be preserved!)
  // 3) Stale `school` (institution) -> 'পাঠশালা' (must be suppressed)
  // 4) Legitimate distinct homonym `school` (group of fish) -> 'ঝাঁক' (must be preserved!)
  const aiCandidates: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'ai-bank-river',
      englishTerm: 'bank (river)',
      banglaTranslation: 'পাড়',
      category: 'place',
      contextMeaning: 'river',
      isContextSensitive: true,
    },
    {
      id: 'ai-bank-cloud',
      englishTerm: 'bank (cloud)',
      banglaTranslation: 'মেঘের স্তূপ',
      category: 'object',
      contextMeaning: 'mass of clouds on the horizon',
      isContextSensitive: true,
    },
    {
      id: 'ai-school-inst',
      englishTerm: 'school',
      banglaTranslation: 'পাঠশালা',
      category: 'cultural',
      contextMeaning: 'educational institution',
      isContextSensitive: true,
    },
    {
      id: 'ai-school-fish',
      englishTerm: 'school',
      banglaTranslation: 'ঝাঁক',
      category: 'cultural',
      contextMeaning: 'group of fish swimming together',
      isContextSensitive: true,
    },
  ];

  const reconciled = reconcileInFlightGlossaryWithLatestState(
    snapHomonyms,
    latestHomonyms,
    aiCandidates,
    { defaultSource: 'stage1_ai' }
  );

  assert.equal(reconciled.length, 4);
  const river = reconciled.find((t) => t.id === 'bank-river')!;
  assert.equal(river.banglaTranslation, 'তীর');
  assert.equal(river.lockedByUser, true);

  const finance = reconciled.find((t) => t.id === 'bank-finance')!;
  assert.equal(finance.banglaTranslation, 'ব্যাংক');

  const cloud = reconciled.find((t) => t.englishTerm === 'bank (cloud)')!;
  assert.ok(cloud);
  assert.equal(cloud.banglaTranslation, 'মেঘের স্তূপ');

  const fish = reconciled.find((t) => t.englishTerm === 'school')!;
  assert.ok(fish);
  assert.equal(fish.banglaTranslation, 'ঝাঁক');
  assert.equal(fish.contextMeaning, 'group of fish swimming together');
});

test('Step 2B.2.2a (5) [Safeguard 2]: In-flight character reconciliation preserves per-field edits, intentional clears, deletions, and recreations', () => {
  const snapshotCharacters = [
    {
      id: 'char-1',
      englishName: 'Debendranath',
      banglaName: 'দেবেন্দ্র',
      relationships: 'Shopkeeper',
      pronouns: 'he/him',
      personality: 'Stern',
      speakingStyle: 'Formal',
      notes: 'Temporary note to be cleared by user',
      roleAndTone: 'Old watchmaker, quiet dignity',
      pronounStrategy: 'Use তিনি/তাঁর everywhere',
    },
    {
      id: 'char-deleted',
      englishName: 'Phantom Customer',
      banglaName: 'অজ্ঞাত খদ্দের',
      relationships: 'Stranger',
      pronouns: 'they/them',
      personality: '',
      speakingStyle: '',
      notes: '',
    },
    {
      id: 'char-old-id',
      englishName: 'Sudha',
      banglaName: 'সুধা',
      relationships: 'Visitor',
      pronouns: 'she/her',
      personality: '',
      speakingStyle: '',
      notes: 'Old entry before delete-and-recreate',
    },
  ];

  // User in flight:
  // 1) Edits `char-1`: updates `banglaName` ('দেবেন্দ্রনাথ মল্লিক'), `relationships` ('Master Horologist'),
  //    `roleAndTone` ('Revered elder artisan'), `pronounStrategy` ('Honorific তিনি/তাঁর'),
  //    intentionally CLEARS `notes` to `''`, and leaves `personality` ('Stern') & `speakingStyle` ('') untouched.
  //    Wait: let's also set snapshot `speakingStyle: ''` and latest `speakingStyle: ''` so AI can backfill `speakingStyle`!
  snapshotCharacters[0].speakingStyle = '';

  const latestCharacters = [
    {
      ...snapshotCharacters[0],
      banglaName: 'দেবেন্দ্রনাথ মল্লিক',
      relationships: 'Master Horologist',
      notes: '', // Intentionally cleared from 'Temporary note to be cleared by user'!
      roleAndTone: 'Revered elder artisan',
      pronounStrategy: 'Honorific তিনি/তাঁর',
      speakingStyle: '', // Untouched and empty in both snapshot and latest -> eligible for AI backfill
    },
    // `char-deleted` was deleted and NOT recreated
    // `char-old-id` ('Sudha') was deleted and recreated with a new ID `char-new-sudha`
    {
      id: 'char-new-sudha',
      englishName: 'Sudha',
      banglaName: 'সুধা দেবী',
      relationships: 'Granddaughter of the admiral',
      pronouns: 'she/her',
      personality: 'Resolute',
      speakingStyle: 'Soft but firm',
      notes: 'Recreated by user in flight',
    },
  ];

  const aiReturnedCharacters = [
    {
      id: 'char-1',
      englishName: 'Debendranath',
      banglaName: 'দেবেন্দ্র', // Stale AI banglaName
      relationships: 'Shopkeeper', // Stale AI relationship
      pronouns: 'he/him',
      personality: 'Absent-minded', // Stale AI personality vs untouched non-empty 'Stern'
      speakingStyle: 'Measured and philosophical', // Non-empty AI backfill for untouched empty field!
      notes: 'AI note that MUST NOT overwrite intentionally cleared user note',
      roleAndTone: 'Stale AI roleAndTone',
      pronounStrategy: 'Stale AI pronounStrategy',
    },
    {
      id: 'ai-phantom',
      englishName: 'Phantom Customer', // Deleted in flight -> must NOT resurrect!
      banglaName: 'অজ্ঞাত খদ্দের',
      relationships: 'Stranger',
    },
    {
      id: 'char-old-id',
      englishName: 'Sudha', // Recreated under `char-new-sudha` -> must NOT overwrite or duplicate!
      banglaName: 'সুধা',
      relationships: 'Visitor',
      notes: 'Stale AI Sudha note',
    },
    {
      id: 'ai-new-apprentice',
      englishName: 'Ratan',
      banglaName: 'রতন',
      relationships: 'Young apprentice',
      pronouns: 'he/him',
      personality: 'Curious',
      speakingStyle: 'Quick',
      notes: 'New character discovered by Stage 1',
    },
  ];

  const reconciled = reconcileInFlightCharacterMemory(
    snapshotCharacters,
    latestCharacters,
    aiReturnedCharacters
  );

  assert.equal(reconciled.length, 3);

  const debu = reconciled.find((c) => c.id === 'char-1')!;
  assert.equal(debu.banglaName, 'দেবেন্দ্রনাথ মল্লিক');
  assert.equal(debu.relationships, 'Master Horologist');
  assert.equal(debu.roleAndTone, 'Revered elder artisan');
  assert.equal(debu.pronounStrategy, 'Honorific তিনি/তাঁর');
  assert.equal(debu.notes, ''); // Intentionally cleared value preserved!
  assert.equal(debu.personality, 'Stern'); // Untouched non-empty value preserved!
  assert.equal(debu.speakingStyle, 'Measured and philosophical'); // Untouched empty field backfilled by AI!

  const sudha = reconciled.find((c) => c.englishName === 'Sudha')!;
  assert.equal(sudha.id, 'char-new-sudha');
  assert.equal(sudha.banglaName, 'সুধা দেবী');
  assert.equal(sudha.notes, 'Recreated by user in flight');

  const ratan = reconciled.find((c) => c.englishName === 'Ratan')!;
  assert.ok(ratan);
  assert.equal(ratan.banglaName, 'রতন');
  assert.equal(reconciled.some((c) => c.englishName === 'Phantom Customer'), false);
});

test('Step 2B.2.2a (6): In-flight StoryContext reconciliation preserves scalar edits/clears, location deletions/edits, and importantEvents deletions/additions', () => {
  const snapshotContext: StoryContextProfile = {
    summary: 'Initial summary.',
    narrativeTimeline: 'Monsoon evening.',
    importantEvents: ['Rain begins in Bowbazar', 'Stale event to delete', 'Watch stops at midnight'],
    emotionalContext: 'Nostalgic and tense',
    literaryTone: 'Lyrical realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজার গলি',
        description: 'Narrow watchmaker street',
      },
      {
        name: 'Deleted Wharf',
        banglaName: 'পরিত্যক্ত ঘাট',
        description: 'Old river wharf',
      },
    ],
  };

  // User in flight:
  // - Edits `summary`
  // - Intentionally clears `emotionalContext` to `''`
  // - Deletes `'Stale event to delete'` from `importantEvents` and adds `'User added event'`
  // - Deletes `'Deleted Wharf'` from `locations` and edits `'Bowbazar Lane'` banglaName to `'বউবাজারের ঘড়িওয়ালা গলি'`
  const latestContext: StoryContextProfile = {
    summary: 'User-curated summary of Chapter 1.',
    narrativeTimeline: 'Monsoon evening.',
    importantEvents: ['Rain begins in Bowbazar', 'Watch stops at midnight', 'User added event'],
    emotionalContext: '', // Intentionally cleared by user in flight
    literaryTone: 'Lyrical realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজারের ঘড়িওয়ালা গলি',
        description: '', // Intentionally cleared description by user
      },
    ],
  };

  const aiContext: Partial<StoryContextProfile> = {
    summary: 'AI summary that must not overwrite user summary.',
    narrativeTimeline: 'Late monsoon evening in 1924.', // Field was untouched by user -> AI can update
    importantEvents: [
      'Rain begins in Bowbazar',
      'Stale event to delete', // Deleted by user -> must NOT resurrect!
      'Chronometer placed on the workbench', // Genuinely new AI event -> appended!
    ],
    emotionalContext: 'AI emotional context that must not overwrite intentional user clear',
    literaryTone: 'Atmospheric literary realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজার গলি',
        description: 'Stale AI description that must not overwrite user clear',
      },
      {
        name: 'Deleted Wharf', // Deleted by user -> must NOT resurrect!
        banglaName: 'পরিত্যক্ত ঘাট',
        description: 'Old river wharf',
      },
      {
        name: 'College Street', // Genuinely new AI location -> appended!
        banglaName: 'কলেজ স্ট্রিট',
        description: 'Bookstore district',
      },
    ],
  };

  const reconciled = reconcileInFlightStoryContext(snapshotContext, latestContext, aiContext);

  assert.equal(reconciled.summary, 'User-curated summary of Chapter 1.');
  assert.equal(reconciled.emotionalContext, ''); // Intentional clear preserved!
  assert.equal(reconciled.narrativeTimeline, 'Late monsoon evening in 1924.');
  assert.deepEqual(reconciled.importantEvents, [
    'Rain begins in Bowbazar',
    'Watch stops at midnight',
    'User added event',
    'Chronometer placed on the workbench',
  ]);
  assert.equal(reconciled.locations.length, 2);
  assert.deepEqual(reconciled.locations[0], {
    name: 'Bowbazar Lane',
    banglaName: normalizeBanglaUnicode('বউবাজারের ঘড়িওয়ালা গলি'),
    description: '',
  });
  assert.deepEqual(reconciled.locations[1], {
    name: 'College Street',
    banglaName: 'কলেজ স্ট্রিট',
    description: 'Bookstore district',
  });
});

test('Step 2B.2.2a (7) [Safeguard 3]: Stage 3 single-occurrence discovery validation enforces Check A, heuristic Check B, and pruned Check C while rejecting adversarial noise', () => {
  assert.equal(STAGE3_PREFIX_TITLE_MARKERS.has('major'), false);
  assert.equal(STAGE3_PREFIX_TITLE_MARKERS.has('general'), false);
  assert.equal(STAGE3_PREFIX_TITLE_MARKERS.has('inspector'), true);
  assert.equal(STAGE3_SUFFIX_HONORIFIC_MARKERS.has('babu'), true);
  assert.equal(STAGE3_GEO_PREFIX_MARKERS.has('fort'), true);
  assert.equal(STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has('wall'), true);
  assert.equal(STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has('bridge'), true);
  assert.equal(STAGE3_COMMON_ENGLISH_TITLE_CASE_REJECT_WORDS.has('chair'), true);
  assert.equal(COMMON_ENGLISH_STOP_WORDS.has('the'), true);
  assert.equal(isValidGlossaryCandidate({ englishTerm: 'the', banglaTranslation: 'টি' }), false);

  // Verify pruned allowlist excludes common words (`monsoon`, `ghat`, `sari`, `bazaar`, `courtyard`)
  for (const excluded of ['monsoon', 'ghat', 'sari', 'kurta', 'dhoti', 'bazaar', 'verandah', 'courtyard', 'hookah']) {
    assert.equal(
      STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST.has(excluded),
      false,
      `Expected "${excluded}" to be excluded from STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST`
    );
  }
  for (const included of ['kalbaisakhi', 'zamindari', 'baithakkhana', 'chronometer', 'mizzenmast']) {
    assert.equal(
      STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST.has(included),
      true,
      `Expected "${included}" to be included in STAGE3_SINGLE_OCCURRENCE_SPECIALIZED_ALLOWLIST`
    );
  }

  const chunkText = [
    // Valid Check A entities (1 occurrence each):
    'Inspector Barun met Debendranath Babu outside Fort William near Port Canning and Mount Kailash.',
    // Adversarial Title-Case marker phrases (1 occurrence each — MUST BE REJECTED):
    'They walked past the Old Fort Wall, the Port Wooden Bridge, the Mount Stone Tower, the Fort Wall, the Port Bridge, the Major Bridge, the General Store, and the Captain Chair.',
    // Delimited phrases for Check B (1 occurrence each):
    'He whispered "the chair" and "the old courtyard" on the *wooden bridge* in *silence* during the "monsoon", then invoked "bhadrakali" and read *Rupasi Bangla*.',
    // Check C allowlist vs pruned single-occurrence words:
    'A sudden kalbaisakhi rattled the baithakkhana while she adjusted her sari on the ghat.',
    // Multi-occurrence term (2 occurrences in chunk — MUST PASS):
    'The brass pendulum swung left, and the brass pendulum swung right.',
  ].join('\n\n');

  const rawDiscovered: Array<Partial<TerminologyMemoryItem>> = [
    // Valid Check A (1 occurrence):
    { englishTerm: 'Inspector Barun', banglaTranslation: 'ইন্সপেক্টর বরুণ', category: 'name' },
    { englishTerm: 'Debendranath Babu', banglaTranslation: 'দেবেন্দ্রনাথ বাবু', category: 'name' },
    { englishTerm: 'Fort William', banglaTranslation: 'ফোর্ট উইলিয়াম', category: 'place' },
    { englishTerm: 'Port Canning', banglaTranslation: 'পোর্ট ক্যানিং', category: 'place' },
    { englishTerm: 'Mount Kailash', banglaTranslation: 'কৈলাস পর্বত', category: 'place' },
    // Adversarial Check A noise (1 occurrence — must all be rejected):
    { englishTerm: 'Old Fort Wall', banglaTranslation: 'পুরোনো দুর্গের প্রাচীর', category: 'place' },
    { englishTerm: 'Port Wooden Bridge', banglaTranslation: 'বন্দরের কাঠের সেতু', category: 'place' },
    { englishTerm: 'Mount Stone Tower', banglaTranslation: 'পাহাড়ের পাথরের মিনার', category: 'place' },
    { englishTerm: 'Fort Wall', banglaTranslation: 'দুর্গের দেয়াল', category: 'place' },
    { englishTerm: 'Port Bridge', banglaTranslation: 'বন্দর সেতু', category: 'place' },
    { englishTerm: 'Major Bridge', banglaTranslation: 'প্রধান সেতু', category: 'place' },
    { englishTerm: 'General Store', banglaTranslation: 'সাধারণ দোকান', category: 'place' },
    { englishTerm: 'Captain Chair', banglaTranslation: 'ক্যাপ্টেন চেয়ার', category: 'object' },
    // Adversarial Check B noise (1 occurrence in quotes/italics — must all be rejected):
    { englishTerm: 'the chair', banglaTranslation: 'চেয়ারটি', category: 'object' },
    { englishTerm: 'the old courtyard', banglaTranslation: 'পুরোনো উঠোন', category: 'place' },
    { englishTerm: 'wooden bridge', banglaTranslation: 'কাঠের সেতু', category: 'place' },
    { englishTerm: 'silence', banglaTranslation: 'নীরবতা', category: 'expression' },
    { englishTerm: 'monsoon', banglaTranslation: 'বর্ষা', category: 'cultural' },
    // Valid Check B1 (capitalized proper name in italics) & Check B2 (heuristic romanized loanword in quotes):
    { englishTerm: 'Rupasi Bangla', banglaTranslation: 'রূপসী বাংলা', category: 'cultural' },
    { englishTerm: 'bhadrakali', banglaTranslation: 'ভদ্রকালী', category: 'cultural' },
    // Valid Check C allowlist (1 occurrence):
    { englishTerm: 'kalbaisakhi', banglaTranslation: 'কালবৈশাখী', category: 'cultural' },
    { englishTerm: 'baithakkhana', banglaTranslation: 'বৈঠকখানা', category: 'place' },
    // Pruned common words with only 1 occurrence (must be rejected):
    { englishTerm: 'sari', banglaTranslation: 'শাড়ি', category: 'cultural' },
    { englishTerm: 'ghat', banglaTranslation: 'ঘাট', category: 'place' },
    // Valid multi-occurrence term (2 occurrences):
    { englishTerm: 'brass pendulum', banglaTranslation: 'পিতলের পেন্ডুলাম', category: 'object' },
  ];

  const validated = validateStage3DiscoveredTerms(rawDiscovered, chunkText, []);
  const acceptedTerms = validated.map((t) => t.englishTerm);

  assert.deepEqual(acceptedTerms, [
    'Inspector Barun',
    'Debendranath Babu',
    'Fort William',
    'Port Canning',
    'Mount Kailash',
    'Rupasi Bangla',
    'bhadrakali',
    'kalbaisakhi',
    'baithakkhana',
    'brass pendulum',
  ]);
});

test('Step 2B.2.2a (8): Contextual homonym avoid-list scoping prevents false-positive avoid_term_used on repeated same-sense occurrences while catching genuine forbidden variants', () => {
  const schoolHomonyms = normalizeGlossaryList([
    {
      id: 'school-inst',
      englishTerm: 'school',
      banglaTranslation: 'পাঠশালা',
      acceptedAlternatives: ['বিদ্যালয়'],
      avoidTranslations: ['ঝাঁক', 'স্কুলঘর'],
      category: 'cultural',
      contextMeaning: 'village educational institution',
      isContextSensitive: true,
      source: 'stage1_ai',
    },
    {
      id: 'school-fish',
      englishTerm: 'school',
      banglaTranslation: 'ঝাঁক',
      avoidTranslations: ['পাঠশালা', 'বিদ্যালয়', 'স্কুলঘর'],
      category: 'cultural',
      contextMeaning: 'shoal or group of fish swimming together',
      isContextSensitive: true,
      source: 'chunk_ai',
    },
  ]);

  // 1. Repeated same-sense occurrences ("One school of herring met another school of mackerel")
  //    rendered with two occurrences of "ঝাঁক" must emit ZERO findings (no false-positive avoid_term_used or overclaim)
  const repeatedFishSense: ParagraphPair = {
    index: 0,
    englishText: 'One school of herring met another school of mackerel near the reef.',
    banglaText: 'প্রবাল প্রাচীরের কাছে হেরিংয়ের এক ঝাঁক আর ম্যাকেরেলের আরেক ঝাঁক মুখোমুখি হলো।',
  };
  const res1 = lintParagraphTerminology(repeatedFishSense, schoolHomonyms);
  assert.equal(res1.findings.length, 0);
  assert.deepEqual(res1.satisfiedTermIds, ['school-fish']);

  // 2. Even if an extra "ঝাঁক" appears in the Bangla sentence (3x "ঝাঁক" for 2x "school"),
  //    the sibling sense `school-inst` must NEVER flag "ঝাঁক" as `avoid_term_used`
  const extraSiblingSpan: ParagraphPair = {
    index: 1,
    englishText: 'One school of herring met another school of mackerel near the reef.',
    banglaText:
      'প্রবাল প্রাচীরের কাছে হেরিংয়ের এক ঝাঁক, ম্যাকেরেলের আরেক ঝাঁক এবং রুপালি মাছের ঝাঁক মুখোমুখি হলো।',
  };
  const res2 = lintParagraphTerminology(extraSiblingSpan, schoolHomonyms);
  assert.equal(res2.findings.length, 0);

  // 3. Genuine non-sibling avoid term ('স্কুলঘর') IS still flagged as high-severity `avoid_term_used`
  const genuineAvoidUsed: ParagraphPair = {
    index: 2,
    englishText: 'The children ran toward the village school before the rain.',
    banglaText: 'বৃষ্টির আগে শিশুরা গ্রামের স্কুলঘরের দিকে দৌড়ে গেল।',
  };
  const res3 = lintParagraphTerminology(genuineAvoidUsed, schoolHomonyms);
  assert.equal(res3.findings.length, 1);
  assert.equal(res3.findings[0].severity, 'high');
  assert.equal(res3.findings[0].reason, 'avoid_term_used');
  assert.equal(res3.findings[0].detectedBanglaVariant, 'স্কুলঘরের');
});

// ============================================================================
// STEP 2B.2.2b — STAGE 1 & STAGE 3 ORCHESTRATORS & SERVER DISCOVERY INTEGRATION
// ============================================================================

test('Step 2B.2.2b (1): Stage 1 orchestrator (reconcileStage1ResultWithLatestState) preserves deleted/edited glossary entries, character deletions/field edits, storyContext scalar/event edits, and prevents deleted locations from re-entering via glossary sync', () => {
  const snapshotStoryContext: StoryContextProfile = {
    summary: 'Initial snapshot summary.',
    narrativeTimeline: 'Monsoon evening.',
    importantEvents: ['Rain begins in Bowbazar', 'Stale event deleted in flight'],
    emotionalContext: 'Nostalgic mood to be cleared',
    literaryTone: 'Lyrical realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজার গলি',
        description: 'Watchmaker lane',
      },
      {
        name: 'Deleted Wharf',
        banglaName: 'পরিত্যক্ত ঘাট',
        description: 'Wharf deleted from StoryContext in flight',
      },
      {
        name: 'North Quay',
        banglaName: 'উত্তর জেটি',
        description: 'Quay kept in StoryContext but deleted from Glossary in flight',
      },
    ],
  };

  // User in flight modifies StoryContext:
  // - Updates `summary`, clears `emotionalContext` to `''`
  // - Deletes `'Stale event deleted in flight'` and adds `'User added event in flight'`
  // - Deletes `'Deleted Wharf'` from `locations`, edits `'Bowbazar Lane'` banglaName to `'বউবাজারের ঘড়িওয়ালা গলি'`
  const latestStoryContext: StoryContextProfile = {
    summary: 'User-edited summary in flight.',
    narrativeTimeline: 'Monsoon evening.',
    importantEvents: ['Rain begins in Bowbazar', 'User added event in flight'],
    emotionalContext: '', // Intentionally cleared by user in flight
    literaryTone: 'Lyrical realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজারের ঘড়িওয়ালা গলি',
        description: 'User refined description',
      },
      {
        name: 'North Quay',
        banglaName: 'উত্তর জেটি',
        description: 'Quay kept in StoryContext but deleted from Glossary in flight',
      },
    ],
  };

  const snapshotCharacters = [
    {
      id: 'char-debu',
      englishName: 'Debendranath',
      banglaName: 'দেবেন্দ্র',
      relationships: 'Shopkeeper',
      pronouns: 'he/him',
      personality: 'Stern',
      speakingStyle: '',
      notes: 'Note to be cleared by user',
      roleAndTone: 'Old watchmaker',
      pronounStrategy: 'Use তিনি',
    },
    {
      id: 'char-deleted',
      englishName: 'Phantom Customer',
      banglaName: 'অজ্ঞাত খদ্দের',
      relationships: 'Stranger',
      pronouns: 'they/them',
      personality: '',
      speakingStyle: '',
      notes: '',
    },
  ];

  // User in flight deletes `Phantom Customer`, updates `Debendranath` (`banglaName`, `relationships`, `roleAndTone`),
  // intentionally clears `notes` to `''`, and adds `Sudha`
  const latestCharacters = [
    {
      ...snapshotCharacters[0],
      banglaName: 'দেবেন্দ্রনাথ মল্লিক',
      relationships: 'Master Horologist',
      notes: '',
      roleAndTone: 'Revered elder artisan',
    },
    {
      id: 'char-sudha-user',
      englishName: 'Sudha',
      banglaName: 'সুধা দেবী',
      relationships: 'Customer with the chronometer',
      pronouns: 'she/her',
      personality: 'Calm',
      speakingStyle: 'Soft',
      notes: 'Added in flight by user',
    },
  ];

  const snapshotGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'term-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'বিবর্ধক কাচ',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'term-spyglass-del',
      englishTerm: 'spyglass',
      banglaTranslation: 'দূরবীন',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'loc-bowbazar',
      englishTerm: 'Bowbazar Lane',
      banglaTranslation: 'বউবাজার গলি',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'loc-deleted-wharf',
      englishTerm: 'Deleted Wharf',
      banglaTranslation: 'পরিত্যক্ত ঘাট',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'loc-north-quay-del-glossary',
      englishTerm: 'North Quay',
      banglaTranslation: 'উত্তর জেটি',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
  ];

  // User in flight:
  // - Edits `term-loupe` translation to `'আতশ কাচ'`
  // - Deletes `term-spyglass-del` from glossary
  // - Deletes `loc-north-quay-del-glossary` ('North Quay') from glossary
  // - Leaves `loc-bowbazar` and `loc-deleted-wharf` untouched in the glossary tab (while editing Bowbazar Lane and deleting Deleted Wharf in StoryContext.locations!)
  const latestGlossary: TerminologyMemoryItem[] = [
    updateUserTerminologyItem(snapshotGlossary[0], {
      banglaTranslation: 'আতশ কাচ',
      notes: 'User updated loupe translation in flight',
    }),
    snapshotGlossary[2],
    snapshotGlossary[3],
  ];

  // Stage 1 AI candidate response (arriving after in-flight edits):
  // Includes stale summary/events/locations, deleted character, stale glossary terms, pre-synced deleted location, and 1 new location + 1 new character + 1 new glossary term
  const candidateStoryContext: Partial<StoryContextProfile> = {
    summary: 'Stale AI summary.',
    narrativeTimeline: 'Late monsoon evening, 1924.', // Untouched scalar -> updated by AI
    importantEvents: [
      'Rain begins in Bowbazar',
      'Stale event deleted in flight', // Must stay deleted
      'Chronometer placed on workbench', // New AI event -> appended
    ],
    emotionalContext: 'Stale AI emotional context that must not overwrite user clear',
    literaryTone: 'Lyrical realism',
    locations: [
      {
        name: 'Bowbazar Lane',
        banglaName: 'বউবাজার গলি',
        description: 'Stale AI description',
      },
      {
        name: 'Deleted Wharf', // Deleted in StoryContext -> must NOT resurrect in StoryContext or Glossary!
        banglaName: 'পরিত্যক্ত ঘাট',
        description: 'Wharf deleted from StoryContext in flight',
      },
      {
        name: 'North Quay',
        banglaName: 'উত্তর জেটি',
        description: 'Quay kept in StoryContext',
      },
      {
        name: 'College Street', // New AI location -> added to StoryContext and synced to Glossary!
        banglaName: 'কলেজ স্ট্রিট',
        description: 'Bookstore street',
      },
    ],
  };

  const candidateCharacters = [
    {
      id: 'char-debu',
      englishName: 'Debendranath',
      banglaName: 'দেবেন্দ্র',
      relationships: 'Shopkeeper',
      pronouns: 'he/him',
      personality: 'Stern',
      speakingStyle: 'Measured and philosophical', // Backfills empty untouched speakingStyle!
      notes: 'Stale AI note',
      roleAndTone: 'Stale AI role',
    },
    {
      id: 'ai-phantom',
      englishName: 'Phantom Customer', // Deleted -> must NOT resurrect
      banglaName: 'অজ্ঞাত খদ্দের',
      relationships: 'Stranger',
    },
    {
      id: 'ai-ratan',
      englishName: 'Ratan', // New AI character -> appended
      banglaName: 'রতন',
      relationships: 'Apprentice',
      pronouns: 'he/him',
      personality: 'Eager',
      speakingStyle: 'Quick',
      notes: 'Helps in the shop',
    },
  ];

  const candidateGlossary: Array<Partial<TerminologyMemoryItem>> = [
    {
      id: 'ai-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'বিবর্ধক কাচ', // Stale AI translation -> must not overwrite 'আতশ কাচ'
      category: 'object',
      source: 'stage1_ai',
    },
    {
      id: 'ai-spyglass',
      englishTerm: 'spyglass', // Deleted in glossary -> must NOT resurrect
      banglaTranslation: 'দূরবীন',
      category: 'object',
      source: 'stage1_ai',
    },
    {
      id: 'ai-deleted-wharf-sync',
      englishTerm: 'Deleted Wharf', // Deleted in StoryContext -> must NOT re-enter via candidateGlossary or location sync!
      banglaTranslation: 'পরিত্যক্ত ঘাট',
      category: 'place',
      source: 'location_sync',
    },
    {
      id: 'ai-mainspring',
      englishTerm: 'mainspring', // Genuinely new AI glossary item -> added
      banglaTranslation: 'মূল স্প্রিং',
      category: 'object',
      source: 'stage1_ai',
    },
  ];

  const reconciled = reconcileStage1ResultWithLatestState({
    snapshotStoryContext,
    latestStoryContext,
    candidateStoryContext,
    snapshotCharacters,
    latestCharacters,
    candidateCharacters,
    snapshotGlossary,
    latestGlossary,
    candidateGlossary,
  });

  // 1. StoryContext verification
  assert.equal(reconciled.storyContext.summary, 'User-edited summary in flight.');
  assert.equal(reconciled.storyContext.emotionalContext, '');
  assert.equal(reconciled.storyContext.narrativeTimeline, 'Late monsoon evening, 1924.');
  assert.deepEqual(reconciled.storyContext.importantEvents, [
    'Rain begins in Bowbazar',
    'User added event in flight',
    'Chronometer placed on workbench',
  ]);
  assert.deepEqual(
    reconciled.storyContext.locations.map((l) => l.name),
    ['Bowbazar Lane', 'North Quay', 'College Street']
  );
  assert.equal(
    reconciled.storyContext.locations.find((l) => l.name === 'Bowbazar Lane')?.banglaName,
    normalizeBanglaUnicode('বউবাজারের ঘড়িওয়ালা গলি')
  );

  // 2. CharacterMemory verification
  assert.deepEqual(
    reconciled.characterMemory.map((c) => c.englishName),
    ['Debendranath', 'Sudha', 'Ratan']
  );
  const debu = reconciled.characterMemory.find((c) => c.englishName === 'Debendranath')!;
  assert.equal(debu.banglaName, 'দেবেন্দ্রনাথ মল্লিক');
  assert.equal(debu.relationships, 'Master Horologist');
  assert.equal(debu.roleAndTone, 'Revered elder artisan');
  assert.equal(debu.notes, '');
  assert.equal(debu.speakingStyle, 'Measured and philosophical');

  // 3. Glossary & Location Sync verification
  // - Deleted glossary entry 'spyglass' is NOT resurrected
  assert.equal(
    reconciled.terminologyMemory.some((t) => t.englishTerm.toLowerCase() === 'spyglass'),
    false
  );
  // - Location deleted from StoryContext ('Deleted Wharf') is NOT in glossary
  assert.equal(
    reconciled.terminologyMemory.some((t) => t.englishTerm.toLowerCase() === 'deleted wharf'),
    false
  );
  // - Location deleted from Glossary ('North Quay') is NOT reintroduced through location sync!
  assert.equal(
    reconciled.terminologyMemory.some((t) => t.englishTerm.toLowerCase() === 'north quay'),
    false
  );
  // - Edited glossary entry 'loupe' retains user's latest value 'আতশ কাচ'
  const loupe = reconciled.terminologyMemory.find((t) => t.englishTerm === 'loupe')!;
  assert.equal(loupe.banglaTranslation, 'আতশ কাচ');
  assert.equal(loupe.lockedByUser, true);
  // - Location edited in StoryContext ('Bowbazar Lane') reflects updated Bangla name in glossary
  const bowbazar = reconciled.terminologyMemory.find(
    (t) => t.englishTerm === 'Bowbazar Lane'
  )!;
  assert.equal(
    bowbazar.banglaTranslation,
    normalizeBanglaUnicode('বউবাজারের ঘড়িওয়ালা গলি')
  );
  // - New location ('College Street') and new Stage 1 term ('mainspring') are present
  const collegeSt = reconciled.terminologyMemory.find(
    (t) => t.englishTerm === 'College Street'
  )!;
  assert.equal(collegeSt.banglaTranslation, 'কলেজ স্ট্রিট');
  assert.equal(collegeSt.source, 'location_sync');

  const mainspring = reconciled.terminologyMemory.find(
    (t) => t.englishTerm === 'mainspring'
  )!;
  assert.equal(mainspring.banglaTranslation, 'মূল স্প্রিং');
  assert.equal(mainspring.source, 'stage1_ai');
});

test('Step 2B.2.2b (2): Server-side Stage 3 translateChunkFaithfully integrates optional discoveredTerms, handles omitted/malformed discoveries safely, grounds against English and Bangla chunk text, and deduplicates against snapshot glossary', async () => {
  // Verify STAGE3_RESPONSE_SCHEMA structure: translatedParagraphs is required; discoveredTerms is optional
  assert.deepEqual(STAGE3_RESPONSE_SCHEMA.required, ['translatedParagraphs']);
  assert.ok(STAGE3_RESPONSE_SCHEMA.properties.translatedParagraphs);
  assert.ok(STAGE3_RESPONSE_SCHEMA.properties.discoveredTerms);

  // Verify extractRawStage3DiscoveredCandidates handles undefined, null, non-array, and malformed items safely
  assert.deepEqual(extractRawStage3DiscoveredCandidates(undefined), []);
  assert.deepEqual(extractRawStage3DiscoveredCandidates(null), []);
  assert.deepEqual(extractRawStage3DiscoveredCandidates('not-an-array'), []);
  assert.deepEqual(
    extractRawStage3DiscoveredCandidates([null, 42, {}, { englishTerm: 'only-english' }]),
    []
  );

  const snapshotGlossary: TerminologyMemoryItem[] = [
    createUserTerminologyItem({
      id: 'snap-loupe',
      englishTerm: 'loupe',
      banglaTranslation: 'আতশ কাচ',
      category: 'object',
    }),
  ];

  const chunkParagraphs = [
    'Inspector Barun adjusted the brass pendulum and looked through the loupe at the kalbaisakhi sky.',
    'The brass pendulum swung beside the chronometer.',
  ];

  // Case A: Gemini omits `discoveredTerms` completely -> translation still succeeds with empty `discoveredTerms`
  const omittedResult = await translateChunkFaithfully({
    paragraphs: chunkParagraphs,
    previousContextParagraphs: ['Previous context with ungrounded phantom term.'],
    styleProfile: null,
    storyContext: null,
    characters: [],
    terminology: snapshotGlossary,
    styleControls: {
      preserveAuthorStyle: true,
      naturalness: 'balanced',
      literaryExpression: 'rich',
      languageComplexity: 'moderate',
      dialogueStyle: 'faithful',
      translationApproach: 'faithful_literary',
    },
    chunkExecutor: async () => ({
      translatedParagraphs: [
        'ইন্সপেক্টর বরুণ পিতলের পেন্ডুলামটি ঠিক করলেন এবং আতশ কাচ দিয়ে কালবৈশাখীর আকাশ দেখলেন।',
        'পিতলের পেন্ডুলামটি ক্রনোমিটারের পাশে দুলছিল।',
      ],
      // discoveredTerms intentionally omitted
    }),
  });

  assert.equal(Array.isArray(omittedResult), true);
  assert.equal(omittedResult.length, 2);
  assert.equal(omittedResult.translatedParagraphs.length, 2);
  assert.deepEqual(omittedResult.discoveredTerms, []);

  // Case B: Gemini returns a mix of valid, ungrounded-in-source, ungrounded-in-Bangla, snapshot-duplicate, and malformed candidates
  const validatedResult = await translateChunkFaithfully({
    paragraphs: chunkParagraphs,
    previousContextParagraphs: ['Previous context mentioning Admiral Sen only in context.'],
    styleProfile: null,
    storyContext: null,
    characters: [],
    terminology: snapshotGlossary,
    styleControls: {
      preserveAuthorStyle: true,
      naturalness: 'balanced',
      literaryExpression: 'rich',
      languageComplexity: 'moderate',
      dialogueStyle: 'faithful',
      translationApproach: 'faithful_literary',
    },
    chunkExecutor: async () => ({
      translatedParagraphs: [
        'ইন্সপেক্টর বরুণ পিতলের পেন্ডুলামটি ঠিক করলেন এবং আতশ কাচ দিয়ে কালবৈশাখীর আকাশ দেখলেন।',
        'পিতলের পেন্ডুলামটি ক্রনোমিটারের পাশে দুলছিল।',
      ],
      discoveredTerms: [
        // 1. Valid Check A title + proper name grounded in both English and Bangla:
        {
          englishTerm: 'Inspector Barun',
          banglaTranslation: 'ইন্সপেক্টর বরুণ',
          category: 'name',
          notes: 'Investigating officer',
        },
        // 2. Valid multi-occurrence term (2x in chunk) grounded in both English and Bangla (with -টি inflection):
        {
          englishTerm: 'brass pendulum',
          banglaTranslation: 'পিতলের পেন্ডুলাম',
          category: 'object',
        },
        // 3. Valid specialized allowlist term (1x in chunk) grounded in both English and Bangla (with -র inflection):
        {
          englishTerm: 'kalbaisakhi',
          banglaTranslation: 'কালবৈশাখী',
          category: 'cultural',
        },
        // 4. Invalid: only in previousContextParagraphs, NOT in current chunk's English source:
        {
          englishTerm: 'Admiral Sen',
          banglaTranslation: 'অ্যাডমিরাল সেন',
          category: 'name',
        },
        // 5. Invalid: in English chunk ('chronometer'), but proposed Bangla translation ('সময়মাপক যন্ত্র') is NOT in Bangla chunk:
        {
          englishTerm: 'chronometer',
          banglaTranslation: 'সময়মাপক যন্ত্র',
          category: 'object',
        },
        // 6. Invalid: already in snapshot glossary ('loupe' -> 'আতশ কাচ'):
        {
          englishTerm: 'loupe',
          banglaTranslation: 'আতশ কাচ',
          category: 'object',
        },
        // 7. Malformed entry:
        null,
      ],
    }),
  });

  assert.equal(validatedResult.length, 2);
  assert.deepEqual(
    validatedResult.discoveredTerms.map((t) => t.englishTerm),
    ['Inspector Barun', 'brass pendulum', 'kalbaisakhi']
  );
  for (const item of validatedResult.discoveredTerms) {
    assert.equal(item.source, 'chunk_ai');
    assert.equal(item.lockedByUser, false);
  }
});

test('Step 2B.2.2b (3): Stage 3 orchestrator (reconcileStage3ChunkGlossaryWithLatestState) enforces source/Bangla grounding, triggers Check C on in-flight user additions, preserves in-flight user edits/deletions, and preserves distinct contextual homonyms', () => {
  const chunkSourceText = [
    'Inspector Barun stood on the muddy bank beside the brass pendulum and checked the chronometer.',
    'From that bank of the river, he watched the brass pendulum swing.',
  ].join('\n\n');

  const chunkBanglaText = [
    'ইন্সপেক্টর বরুণ পিতলের পেন্ডুলামের পাশে কর্দমাক্ত তীরে দাঁড়িয়ে ক্রনোমিটারটি পরীক্ষা করলেন।',
    'নদীর সেই তীর থেকে তিনি পিতলের পেন্ডুলামটি দুলতে দেখলেন।',
  ].join('\n\n');

  // Pre-request snapshot glossary before the Stage 3 chunk request started:
  const snapshotGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'snap-deleted-term',
      englishTerm: 'Inspector Barun',
      banglaTranslation: 'ইন্সপেক্টর বরুণ',
      category: 'name',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'snap-edited-pendulum',
      englishTerm: 'brass pendulum',
      banglaTranslation: 'পিতলের দোলক',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'snap-bank-finance',
      englishTerm: 'bank (finance)',
      banglaTranslation: 'ব্যাংক',
      category: 'place',
      contextMeaning: 'financial institution',
      isContextSensitive: true,
      source: 'user',
      lockedByUser: true,
    }),
  ];

  // While the Stage 3 chunk request is in flight, the user:
  // 1) Deletes `'Inspector Barun'` (`snap-deleted-term`)
  // 2) Edits `'brass pendulum'` (`snap-edited-pendulum`) translation to `'পিতলের পেন্ডুলাম'` (with user note)
  // 3) Adds `'chronometer'` (`user-added-chrono`) -> `'কালমাপক ঘড়ি'` in flight!
  // 4) Keeps `'bank (finance)'` -> `'ব্যাংক'`
  const latestGlossary: TerminologyMemoryItem[] = [
    updateUserTerminologyItem(snapshotGlossary[1], {
      banglaTranslation: 'পিতলের পেন্ডুলাম',
      notes: 'User locked preferred Bangla in flight',
    }),
    snapshotGlossary[2],
    createUserTerminologyItem({
      id: 'user-added-chrono',
      englishTerm: 'chronometer',
      banglaTranslation: 'কালমাপক ঘড়ি',
      acceptedAlternatives: ['ক্রনোমিটার'],
      category: 'object',
      notes: 'Added by user while chunk was in flight',
    }),
  ];

  // Candidate discoveries arriving from the Stage 3 chunk response:
  const discoveredCandidates: Array<Partial<TerminologyMemoryItem>> = [
    // 1. Candidate added by user in flight ('chronometer') -> MUST trigger Check C (`already_in_glossary`) against latestGlossary!
    {
      englishTerm: 'chronometer',
      banglaTranslation: 'ক্রনোমিটার',
      category: 'object',
      source: 'chunk_ai',
    },
    // 2. Candidate edited by user in flight ('brass pendulum') -> triggers Check C (`already_in_glossary`) and preserves user edit!
    {
      englishTerm: 'brass pendulum',
      banglaTranslation: 'পিতলের পেন্ডুলাম',
      category: 'object',
      source: 'chunk_ai',
    },
    // 3. Candidate deleted by user in flight ('Inspector Barun') -> passes text validation (since deleted from latestGlossary)
    //    but MUST be suppressed by `reconcileInFlightGlossaryWithLatestState` so the deleted term is not resurrected!
    {
      englishTerm: 'Inspector Barun',
      banglaTranslation: 'ইন্সপেক্টর বরুণ',
      category: 'name',
      source: 'chunk_ai',
    },
    // 4. Candidate with invalid source grounding (not in chunkSourceText) -> rejected with `not_in_source_chunk`
    {
      englishTerm: 'Port Canning',
      banglaTranslation: 'পোর্ট ক্যানিং',
      category: 'place',
      source: 'chunk_ai',
    },
    // 5. Candidate with invalid Bangla grounding (in chunkSourceText, proposed Bangla absent from chunkBanglaText) -> rejected with `not_in_bangla_chunk`
    {
      englishTerm: 'chronometer',
      banglaTranslation: 'সময়যন্ত্র',
      category: 'object',
      source: 'chunk_ai',
    },
    // 6. Distinct contextual homonym `bank (river)` -> `'তীর'` (2 occurrences in chunkSourceText, grounded in chunkBanglaText as `'তীরে'` / `'তীর'`):
    //    Must NOT be suppressed by `bank (finance)` -> `'ব্যাংক'`!
    {
      englishTerm: 'bank (river)',
      banglaTranslation: 'তীর',
      category: 'place',
      contextMeaning: 'river bank',
      isContextSensitive: true,
      source: 'chunk_ai',
    },
  ];

  const result = reconcileStage3ChunkGlossaryWithLatestState({
    snapshotGlossary,
    discoveredCandidates,
    latestGlossary,
    chunkSourceText,
    chunkBanglaText,
  });

  // Verify validation rejection reasons
  const reasonsByTermAndBangla = new Map(
    result.rejectedCandidates.map((r) => [
      `${r.candidate.englishTerm}::${r.candidate.banglaTranslation}`,
      r.reason,
    ])
  );
  assert.equal(
    reasonsByTermAndBangla.get('chronometer::ক্রনোমিটার'),
    'already_in_glossary'
  );
  assert.equal(
    reasonsByTermAndBangla.get('brass pendulum::পিতলের পেন্ডুলাম'),
    'already_in_glossary'
  );
  assert.equal(
    reasonsByTermAndBangla.get('Port Canning::পোর্ট ক্যানিং'),
    'not_in_source_chunk'
  );
  assert.equal(
    reasonsByTermAndBangla.get('chronometer::সময়যন্ত্র'),
    'not_in_bangla_chunk'
  );

  // Verify deleted entry ('Inspector Barun') was suppressed during in-flight reconciliation and NOT resurrected
  assert.equal(
    result.glossary.some((t) => t.englishTerm === 'Inspector Barun'),
    false
  );

  // Verify user's in-flight addition ('chronometer' -> 'কালমাপক ঘড়ি') and in-flight edit ('brass pendulum') are preserved verbatim
  const chrono = result.glossary.find((t) => t.id === 'user-added-chrono')!;
  assert.equal(chrono.banglaTranslation, normalizeBanglaUnicode('কালমাপক ঘড়ি'));
  assert.equal(chrono.source, 'user');
  assert.equal(chrono.lockedByUser, true);

  const pendulum = result.glossary.find((t) => t.id === 'snap-edited-pendulum')!;
  assert.equal(pendulum.banglaTranslation, 'পিতলের পেন্ডুলাম');
  assert.equal(pendulum.notes, 'User locked preferred Bangla in flight');
  assert.equal(pendulum.source, 'user');
  assert.equal(pendulum.lockedByUser, true);

  // Verify both distinct contextual homonyms (`bank (finance)` and `bank (river)`) coexist in the final glossary
  const bankFinance = result.glossary.find((t) => t.id === 'snap-bank-finance')!;
  assert.ok(bankFinance);
  assert.equal(bankFinance.banglaTranslation, 'ব্যাংক');

  const bankRiver = result.glossary.find((t) => t.englishTerm === 'bank (river)')!;
  assert.ok(bankRiver);
  assert.equal(bankRiver.banglaTranslation, 'তীর');
  assert.equal(bankRiver.contextMeaning, 'river bank');
  assert.equal(bankRiver.source, 'chunk_ai');
  assert.equal(bankRiver.lockedByUser, false);
});

// ============================================================================
// STEP 2B.2.2d — FINAL REGRESSION TESTING & MULTI-CHUNK INTEGRATION AUDIT
// ============================================================================

test('Step 2B.2.2d (1): Stage 1 full regression including in-flight user-added locations, deleted location suppression, intentional clears, and server-to-client orchestration', async () => {
  const snapshotStoryContext: StoryContextProfile = {
    summary: 'Snapshot summary before Stage 1.',
    narrativeTimeline: 'Early autumn.',
    importantEvents: ['Initial event kept', 'Event deleted by user in flight'],
    emotionalContext: 'Melancholic mood cleared by user in flight',
    literaryTone: 'Quiet realism',
    locations: [
      {
        name: 'Old Lighthouse',
        banglaName: 'পুরোনো বাতিঘর',
        description: 'Coastal beacon',
      },
      {
        name: 'Abandoned Pier',
        banglaName: 'পরিত্যক্ত জেটি',
        description: 'Deleted in flight from StoryContext',
      },
    ],
  };

  // User in flight:
  // - Edits scalar `summary`
  // - Intentionally clears `emotionalContext` to `''`
  // - Deletes `'Event deleted by user in flight'` and adds `'User added event in flight'`
  // - Deletes `'Abandoned Pier'` from `locations` and adds a brand-new location `'Lantern Courtyard'`
  const latestStoryContext: StoryContextProfile = {
    summary: 'User-edited summary while Stage 1 was in flight.',
    narrativeTimeline: 'Early autumn.',
    importantEvents: ['Initial event kept', 'User added event in flight'],
    emotionalContext: '',
    literaryTone: 'Quiet realism',
    locations: [
      {
        name: 'Old Lighthouse',
        banglaName: 'পুরাতন বাতিঘর',
        description: 'Updated by user in flight',
      },
      {
        name: 'Lantern Courtyard',
        banglaName: 'লণ্ঠন প্রাঙ্গণ',
        description: 'Added by user in flight',
      },
    ],
  };

  const snapshotCharacters: CharacterMemoryItem[] = [
    {
      id: 'char-keeper',
      englishName: 'Amina',
      banglaName: 'আমিনা',
      relationships: 'Keeper',
      pronouns: 'she/her',
      personality: 'Steadfast',
      speakingStyle: '',
      notes: 'Note to clear in flight',
    },
    {
      id: 'char-del',
      englishName: 'Transient Sailor',
      banglaName: 'অস্থায়ী নাবিক',
      relationships: 'Passerby',
      pronouns: 'he/him',
      personality: '',
      speakingStyle: '',
      notes: '',
    },
  ];

  const latestCharacters: CharacterMemoryItem[] = [
    {
      ...snapshotCharacters[0],
      relationships: 'Chief Lighthouse Keeper',
      notes: '', // Intentionally cleared by user
    },
  ];

  const snapshotGlossary: TerminologyMemoryItem[] = [
    normalizeTerminologyItem({
      id: 'loc-lighthouse',
      englishTerm: 'Old Lighthouse',
      banglaTranslation: 'পুরোনো বাতিঘর',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'loc-pier-del',
      englishTerm: 'Abandoned Pier',
      banglaTranslation: 'পরিত্যক্ত জেটি',
      category: 'place',
      source: 'location_sync',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'term-lens',
      englishTerm: 'brass lens',
      banglaTranslation: 'পিতলের লেন্স',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
    normalizeTerminologyItem({
      id: 'term-del-rope',
      englishTerm: 'hemp rope',
      banglaTranslation: 'শনির দড়ি',
      category: 'object',
      source: 'stage1_ai',
      lockedByUser: false,
    }),
  ];

  // User in flight:
  // - Edits `term-lens` translation to `'কাঁচ-পিতলের লেন্স'`
  // - Deletes `term-del-rope` ('hemp rope')
  // - Adds `'storm shutter'` -> `'ঝড়ের ঝাঁপ'`
  const latestGlossary: TerminologyMemoryItem[] = [
    snapshotGlossary[0],
    snapshotGlossary[1],
    updateUserTerminologyItem(snapshotGlossary[2], {
      banglaTranslation: 'কাঁচ-পিতলের লেন্স',
      notes: 'User refined lens translation',
    }),
    createUserTerminologyItem({
      id: 'term-user-shutter',
      englishTerm: 'storm shutter',
      banglaTranslation: 'ঝড়ের ঝাঁপ',
      category: 'object',
      notes: 'User added in flight',
    }),
  ];

  // Run server-side Stage 1 with snapshot state
  const serverStage1Result = await analyzeStoryUnderstanding({
    text: 'Amina climbed the Old Lighthouse past the Abandoned Pier toward Marrow Bay. She cleaned the brass lens, checked the hemp rope, fastened the storm shutter, and lit the oil wick while Tariq watched.',
    projectTitle: 'Beacon on the Coast',
    genre: 'Literary Fiction',
    existingStoryContext: snapshotStoryContext,
    existingCharacters: snapshotCharacters,
    existingTerminology: snapshotGlossary,
    windowExecutor: async () => ({
      storyContext: {
        summary: 'AI summary from server.',
        narrativeTimeline: 'Late autumn evening before the gale.',
        importantEvents: [
          'Initial event kept',
          'Event deleted by user in flight',
          'Amina lights the oil wick',
        ],
        emotionalContext: 'AI emotional context that must not overwrite user clear',
        literaryTone: 'Quiet realism',
        locations: [
          {
            name: 'Old Lighthouse',
            banglaName: 'পুরোনো বাতিঘর',
            description: 'Coastal beacon',
          },
          {
            name: 'Abandoned Pier',
            banglaName: 'পরিত্যক্ত জেটি',
            description: 'Deleted in flight from StoryContext',
          },
          {
            name: 'Marrow Bay',
            banglaName: 'ম্যারো উপসাগর',
            description: 'Bay below the cliff',
          },
        ],
      },
      characters: [
        {
          englishName: 'Amina',
          banglaName: 'আমিনা',
          relationships: 'Keeper',
          pronouns: 'she/him',
          personality: 'Steadfast',
          speakingStyle: 'Calm and measured',
          notes: 'Stale AI note',
        },
        {
          englishName: 'Transient Sailor',
          banglaName: 'অস্থায়ী নাবিক',
          relationships: 'Passerby',
          pronouns: 'he/him',
          personality: 'Brief',
          speakingStyle: 'Rough',
          notes: '',
        },
        {
          englishName: 'Tariq',
          banglaName: 'তারিক',
          relationships: 'Assistant keeper',
          pronouns: 'he/him',
          personality: 'Vigilant',
          speakingStyle: 'Respectful',
          notes: 'New character',
        },
      ],
      terminology: [
        {
          englishTerm: 'brass lens',
          banglaTranslation: 'পিতলের লেন্স',
          category: 'object',
          notes: 'Stale AI lens',
        },
        {
          englishTerm: 'hemp rope',
          banglaTranslation: 'শনির দড়ি',
          category: 'object',
          notes: 'Deleted in flight',
        },
        {
          englishTerm: 'oil wick',
          banglaTranslation: 'তেলের সলতে',
          category: 'object',
          notes: 'New AI term',
        },
      ],
    }),
  });

  // Simulate HTTP JSON serialization boundary (`/api/translate`)
  const serializedStage1 = JSON.parse(JSON.stringify(serverStage1Result));

  // Reconcile on client using `reconcileStage1ResultWithLatestState`
  const reconciled = reconcileStage1ResultWithLatestState({
    snapshotStoryContext,
    latestStoryContext,
    candidateStoryContext: serializedStage1.storyContext,
    snapshotCharacters,
    latestCharacters,
    extractedCharacters: serializedStage1.extractedCharacters,
    snapshotGlossary,
    latestGlossary,
    extractedTerminology: serializedStage1.extractedTerminology,
  });

  // Verify StoryContext scenarios
  assert.equal(
    reconciled.storyContext.summary,
    'User-edited summary while Stage 1 was in flight.'
  );
  assert.equal(reconciled.storyContext.emotionalContext, '');
  assert.equal(
    reconciled.storyContext.narrativeTimeline,
    'Late autumn evening before the gale.'
  );
  assert.deepEqual(reconciled.storyContext.importantEvents, [
    'Initial event kept',
    'User added event in flight',
    'Amina lights the oil wick',
  ]);
  assert.deepEqual(
    reconciled.storyContext.locations.map((l) => l.name),
    ['Old Lighthouse', 'Lantern Courtyard', 'Marrow Bay']
  );

  // Verify user-added location ('Lantern Courtyard') AND AI-added location ('Marrow Bay') are in glossary,
  // while user-deleted location ('Abandoned Pier') is absent from both locations and glossary
  assert.equal(
    reconciled.terminologyMemory.some(
      (t) => t.englishTerm.toLowerCase() === 'abandoned pier'
    ),
    false
  );
  const courtyardTerm = reconciled.terminologyMemory.find(
    (t) => t.englishTerm === 'Lantern Courtyard'
  )!;
  assert.ok(courtyardTerm);
  assert.equal(courtyardTerm.banglaTranslation, normalizeBanglaUnicode('লণ্ঠন প্রাঙ্গণ'));
  assert.equal(courtyardTerm.source, 'location_sync');

  const marrowBayTerm = reconciled.terminologyMemory.find(
    (t) => t.englishTerm === 'Marrow Bay'
  )!;
  assert.ok(marrowBayTerm);
  assert.equal(marrowBayTerm.banglaTranslation, 'ম্যারো উপসাগর');

  // Verify character scenarios
  assert.deepEqual(
    reconciled.characterMemory.map((c) => c.englishName),
    ['Amina', 'Tariq']
  );
  const amina = reconciled.characterMemory.find((c) => c.englishName === 'Amina')!;
  assert.equal(amina.relationships, 'Chief Lighthouse Keeper');
  assert.equal(amina.notes, '');
  assert.equal(amina.speakingStyle, 'Calm and measured');

  // Verify glossary scenarios
  assert.equal(
    reconciled.terminologyMemory.some((t) => t.englishTerm === 'hemp rope'),
    false
  );
  assert.equal(
    reconciled.terminologyMemory.find((t) => t.englishTerm === 'brass lens')
      ?.banglaTranslation,
    normalizeBanglaUnicode('কাঁচ-পিতলের লেন্স')
  );
  assert.equal(
    reconciled.terminologyMemory.find((t) => t.englishTerm === 'storm shutter')
      ?.banglaTranslation,
    normalizeBanglaUnicode('ঝড়ের ঝাঁপ')
  );
  assert.equal(
    reconciled.terminologyMemory.find((t) => t.englishTerm === 'oil wick')
      ?.banglaTranslation,
    'তেলের সলতে'
  );
});

test('Step 2B.2.2d (2): Stage 3 API serialization contract preserves translatedParagraphs: string[] and discoveredTerms: TerminologyMemoryItem[] across JSON boundary', async () => {
  const styleControls = {
    preserveAuthorStyle: true,
    naturalness: 'highly_natural' as const,
    literaryExpression: 'rich' as const,
    languageComplexity: 'moderate' as const,
    dialogueStyle: 'more_conversational' as const,
    translationApproach: 'faithful_literary' as const,
  };

  // 1. With valid discovery + ungrounded discovery
  const rawResultWithDiscovery = await translateChunkFaithfully({
    paragraphs: [
      'Inspector Barun entered the Silent Observatory and examined the brass pendulum.',
      'Inside the Silent Observatory, the brass pendulum gleamed.',
    ],
    previousContextParagraphs: [],
    styleProfile: null,
    storyContext: null,
    characters: [],
    terminology: [],
    styleControls,
    chunkExecutor: async () => ({
      translatedParagraphs: [
        'ইন্সপেক্টর বরুণ নীরব মানমন্দিরে প্রবেশ করলেন এবং পিতলের পেন্ডুলামটি পরীক্ষা করলেন।',
        'নীরব মানমন্দিরের ভেতরে পিতলের পেন্ডুলামটি ঝলমল করছিল।',
      ],
      discoveredTerms: [
        {
          englishTerm: 'Silent Observatory',
          banglaTranslation: 'নীরব মানমন্দির',
          category: 'place',
          notes: 'Recurring setting',
        },
        {
          englishTerm: 'Ungrounded Phantom',
          banglaTranslation: 'অস্তিত্বহীন শব্দ',
          category: 'object',
        },
      ],
    }),
  });

  // Exact route payload shape used in `/app/api/translate/route.ts`
  const apiPayload1 = JSON.parse(
    JSON.stringify({
      translatedParagraphs: rawResultWithDiscovery,
      discoveredTerms: rawResultWithDiscovery.discoveredTerms ?? [],
    })
  );

  assert.equal(Array.isArray(apiPayload1.translatedParagraphs), true);
  assert.equal(apiPayload1.translatedParagraphs.length, 2);
  assert.equal(
    apiPayload1.translatedParagraphs.every((p: unknown) => typeof p === 'string'),
    true
  );
  assert.equal(Array.isArray(apiPayload1.discoveredTerms), true);
  assert.equal(apiPayload1.discoveredTerms.length, 1);
  assert.equal(apiPayload1.discoveredTerms[0].englishTerm, 'Silent Observatory');
  assert.equal(apiPayload1.discoveredTerms[0].banglaTranslation, 'নীরব মানমন্দির');

  // 2. When discoveredTerms is omitted, null, or malformed
  for (const emptyOrMalformed of [undefined, null, 'invalid', [], [null, {}]]) {
    const rawResultEmpty = await translateChunkFaithfully({
      paragraphs: ['The rain fell softly on the river.'],
      previousContextParagraphs: [],
      styleProfile: null,
      storyContext: null,
      characters: [],
      terminology: [],
      styleControls,
      chunkExecutor: async () => ({
        translatedParagraphs: ['নদীর ওপর নরমভাবে বৃষ্টি ঝরছিল।'],
        ...(emptyOrMalformed !== undefined ? { discoveredTerms: emptyOrMalformed } : {}),
      }),
    });

    const apiPayloadEmpty = JSON.parse(
      JSON.stringify({
        translatedParagraphs: rawResultEmpty,
        discoveredTerms: rawResultEmpty.discoveredTerms ?? [],
      })
    );

    assert.deepEqual(apiPayloadEmpty.translatedParagraphs, [
      'নদীর ওপর নরমভাবে বৃষ্টি ঝরছিল।',
    ]);
    assert.deepEqual(apiPayloadEmpty.discoveredTerms, []);
  }
});

test('Step 2B.2.2d (3): Multi-chunk Stage 3 workflow propagates discoveries across chunks, respects between-chunk and in-flight user edits/deletions/homonyms, and preserves paragraph alignment', async () => {
  // Build a 3-chunk manuscript (2 paragraphs per chunk) with an ornamental scene break
  const p0 = `${'Inspector Barun walked toward Fort William through the evening mist. '.repeat(10).trim()}`;
  const p1 = `${'Outside Fort William, the brass pendulum hung beside the gatehouse. '.repeat(10).trim()}`;
  const p2 = `${'Near Fort William, he stood on the muddy bank and checked the chronometer. '.repeat(10).trim()}`;
  const p3 = `${'From that river bank, the brass pendulum was still visible while the kalbaisakhi gathered. '.repeat(10).trim()}`;
  const p4 = `${'Inside the baithakkhana, Debendranath Babu checked the chronometer before the kalbaisakhi. '.repeat(10).trim()}`;
  const p5 = `${'The lantern cast long shadows across the baithakkhana floor. '.repeat(10).trim()}`;

  const manuscript = `${p0}\n\n***\n\n${p1}\n\n${p2}\n\n${p3}\n\n${p4}\n\n${p5}`;
  const englishParagraphs = splitIntoParagraphs(manuscript);
  assert.equal(englishParagraphs.length, 6);

  const chunks = chunkTextByParagraphs(manuscript, 280, 1);
  assert.equal(chunks.length, 3);

  const styleControls = {
    preserveAuthorStyle: true,
    naturalness: 'highly_natural' as const,
    literaryExpression: 'rich' as const,
    languageComplexity: 'moderate' as const,
    dialogueStyle: 'more_conversational' as const,
    translationApproach: 'faithful_literary' as const,
  };

  // Simulated `projectRef.current` holding initial glossary before Chunk 1
  const projectRef: {
    current: {
      terminologyMemory: TerminologyMemoryItem[];
      paragraphs: ParagraphPair[];
      translatedText: string;
    };
  } = {
    current: {
      terminologyMemory: [
        normalizeTerminologyItem({
          id: 'init-bank-finance',
          englishTerm: 'bank (finance)',
          banglaTranslation: 'ব্যাংক',
          category: 'place',
          contextMeaning: 'financial institution',
          isContextSensitive: true,
          source: 'user',
          lockedByUser: true,
        }),
        normalizeTerminologyItem({
          id: 'init-to-delete-in-chunk2',
          englishTerm: 'gatehouse',
          banglaTranslation: 'তোরণঘর',
          category: 'place',
          source: 'stage1_ai',
          lockedByUser: false,
        }),
      ],
      paragraphs: alignParagraphs(manuscript, ''),
      translatedText: '',
    },
  };

  const preStage3Pairs = projectRef.current.paragraphs;
  const translatedChunks: string[][] = [];
  let prevChunkLastBangla = '';
  const promptsByChunk: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Between Chunk 0 and Chunk 1 (before Chunk 1 starts):
    // User edits the newly discovered `'Fort William'` entry to lock a custom translation `'ফোর্ট উইলিয়াম দুর্গ'`!
    if (i === 1) {
      projectRef.current = {
        ...projectRef.current,
        terminologyMemory: projectRef.current.terminologyMemory.map((t) =>
          t.englishTerm === 'Fort William'
            ? updateUserTerminologyItem(t, {
                banglaTranslation: 'ফোর্ট উইলিয়াম দুর্গ',
                notes: 'Edited by user between Chunk 1 and Chunk 2',
              })
            : t
        ),
      };
    }

    // 1. Capture fresh glossary snapshot immediately before chunk request `i`
    const chunkGlossarySnapshot = projectRef.current.terminologyMemory.map((t) => ({
      ...t,
      acceptedAlternatives: t.acceptedAlternatives
        ? [...t.acceptedAlternatives]
        : undefined,
      avoidTranslations: t.avoidTranslations ? [...t.avoidTranslations] : undefined,
    }));

    // 2. Execute server Stage 3 translation + discovery validation
    const serverRes = await translateChunkFaithfully({
      paragraphs: chunk.paragraphs,
      previousContextParagraphs: chunk.previousContextParagraphs,
      styleProfile: null,
      storyContext: null,
      characters: [],
      terminology: chunkGlossarySnapshot,
      styleControls,
      chunkExecutor: async ({ prompt }) => {
        promptsByChunk.push(prompt);

        if (i === 0) {
          return {
            translatedParagraphs: [
              'ইন্সপেক্টর বরুণ সন্ধ্যার কুয়াশার ভেতর দিয়ে ফোর্ট উইলিয়াম অভিমুখে হাঁটছিলেন।',
              'ফোর্ট উইলিয়াম প্রাঙ্গণের বাইরে তোরণঘরের পাশে পিতলের পেন্ডুলামটি ঝুলছিল।',
            ],
            discoveredTerms: [
              {
                englishTerm: 'Fort William',
                banglaTranslation: 'ফোর্ট উইলিয়াম',
                category: 'place',
                notes: 'Discovered in Chunk 1',
              },
              {
                englishTerm: 'Inspector Barun',
                banglaTranslation: 'ইন্সপেক্টর বরুণ',
                category: 'name',
              },
            ],
          };
        }

        if (i === 1) {
          // Simulate in-flight user mutations while Chunk 2 is awaiting server response:
          // - User deletes `'gatehouse'` (`init-to-delete-in-chunk2`)
          // - User adds `'chronometer'` -> `'কালমাপক ঘড়ি'`
          // - User edits `'Inspector Barun'` notes & translation to `'গোয়েন্দা বরুণ'`
          projectRef.current = {
            ...projectRef.current,
            terminologyMemory: [
              ...projectRef.current.terminologyMemory
                .filter((t) => t.id !== 'init-to-delete-in-chunk2')
                .map((t) =>
                  t.englishTerm === 'Inspector Barun'
                    ? updateUserTerminologyItem(t, {
                        banglaTranslation: 'গোয়েন্দা বরুণ',
                        notes: 'User edited Barun in flight during Chunk 2',
                      })
                    : t
                ),
              createUserTerminologyItem({
                id: 'user-in-flight-chrono',
                englishTerm: 'chronometer',
                banglaTranslation: 'কালমাপক ঘড়ি',
                category: 'object',
                notes: 'Added by user while Chunk 2 was in flight',
              }),
            ],
          };

          return {
            translatedParagraphs: [
              'ফোর্ট উইলিয়াম দুর্গের কাছে তিনি কর্দমাক্ত তীরে দাঁড়িয়ে ক্রনোমিটারটি পরীক্ষা করলেন।',
              'নদীর সেই তীর থেকে কালবৈশাখী ঘনিয়ে আসার সময়ও পিতলের পেন্ডুলামটি দেখা যাচ্ছিল।',
            ],
            discoveredTerms: [
              // Already added by user in flight -> rejected by client Check C (`already_in_glossary`)
              {
                englishTerm: 'chronometer',
                banglaTranslation: 'ক্রনোমিটার',
                category: 'object',
              },
              // Distinct contextual homonym `bank (river)` -> `'তীর'` (2x in Chunk 2) -> accepted alongside `bank (finance)`
              {
                englishTerm: 'bank (river)',
                banglaTranslation: 'তীর',
                category: 'place',
                contextMeaning: 'river bank',
                isContextSensitive: true,
              },
              // Specialized allowlist term `kalbaisakhi` -> `'কালবৈশাখী'` -> accepted
              {
                englishTerm: 'kalbaisakhi',
                banglaTranslation: 'কালবৈশাখী',
                category: 'cultural',
              },
            ],
          };
        }

        // Chunk 3 (index 2): Paragraph 5 intentionally returns '' to verify missingTranslation fallback
        return {
          translatedParagraphs: [
            'বৈঠকখানা কক্ষের ভেতরে দেবেন্দ্রনাথ বাবু লণ্ঠনটি জ্বালালেন।',
            '',
          ],
          discoveredTerms: [
            {
              englishTerm: 'baithakkhana',
              banglaTranslation: 'বৈঠকখানা',
              category: 'place',
            },
          ],
        };
      },
    });

    // Simulate `/api/translate` JSON response serialization
    const data = JSON.parse(
      JSON.stringify({
        translatedParagraphs: serverRes,
        discoveredTerms: serverRes.discoveredTerms ?? [],
      })
    );

    const rawChunkOutput: string[] = Array.isArray(data.translatedParagraphs)
      ? data.translatedParagraphs
      : [];
    translatedChunks.push(rawChunkOutput);

    // 3. Read latest state from `projectRef.current` after async boundary
    const latestAfterChunk = projectRef.current;
    const partial = mergeStage3ChunkProgress(
      englishParagraphs,
      latestAfterChunk.paragraphs,
      chunk,
      rawChunkOutput,
      prevChunkLastBangla
    );
    prevChunkLastBangla = partial.lastNonEmptyBangla;

    // 4. Reconcile chunk glossary with latest state
    const chunkSourceText = chunk.paragraphs.join('\n\n');
    const alignedChunkBanglaText = partial.pairs
      .slice(chunk.startParagraphIndex, chunk.endParagraphIndex + 1)
      .map((p) => p.banglaText)
      .join('\n\n');

    const reconciledChunkGlossary = reconcileStage3ChunkGlossaryWithLatestState({
      snapshotGlossary: chunkGlossarySnapshot,
      discoveredCandidates: data.discoveredTerms,
      latestGlossary: latestAfterChunk.terminologyMemory,
      chunkSourceText,
      chunkBanglaText: alignedChunkBanglaText,
    });

    // 5. Persist reconciled glossary and partial progress before starting next chunk
    projectRef.current = {
      terminologyMemory: reconciledChunkGlossary.terminologyMemory,
      paragraphs: partial.pairs,
      translatedText: partial.fullBanglaText,
    };
  }

  // Verify Chunk 1's discovery ('Fort William') AND the between-chunk user edit ('ফোর্ট উইলিয়াম দুর্গ')
  // were included in Chunk 2's prompt memory block!
  assert.ok(promptsByChunk[1].includes(normalizeBanglaUnicode('ফোর্ট উইলিয়াম দুর্গ')));
  // Verify Chunk 2's discoveries ('কালবৈশাখী', 'তীর') AND in-flight user additions ('কালমাপক ঘড়ি')
  // were included in Chunk 3's prompt memory block!
  assert.ok(promptsByChunk[2].includes(normalizeBanglaUnicode('কালবৈশাখী')));
  assert.ok(promptsByChunk[2].includes(normalizeBanglaUnicode('কালমাপক ঘড়ি')));

  // Verify final glossary after all 3 chunks
  const finalGlossary = projectRef.current.terminologyMemory;
  // Deleted `'gatehouse'` did not return
  assert.equal(
    finalGlossary.some((t) => t.englishTerm === 'gatehouse'),
    false
  );
  // In-flight user addition `'chronometer'` kept user's translation (`'কালমাপক ঘড়ি'`)
  assert.equal(
    finalGlossary.find((t) => t.englishTerm === 'chronometer')?.banglaTranslation,
    normalizeBanglaUnicode('কালমাপক ঘড়ি')
  );
  // In-flight user edit `'Inspector Barun'` kept `'গোয়েন্দা বরুণ'`
  assert.equal(
    finalGlossary.find((t) => t.englishTerm === 'Inspector Barun')?.banglaTranslation,
    normalizeBanglaUnicode('গোয়েন্দা বরুণ')
  );
  // Between-chunk user edit `'Fort William'` kept `'ফোর্ট উইলিয়াম দুর্গ'`
  assert.equal(
    finalGlossary.find((t) => t.englishTerm === 'Fort William')?.banglaTranslation,
    normalizeBanglaUnicode('ফোর্ট উইলিয়াম দুর্গ')
  );
  // Both contextual homonyms (`bank (finance)` and `bank (river)`) coexist
  assert.ok(finalGlossary.find((t) => t.englishTerm === 'bank (finance)'));
  assert.ok(finalGlossary.find((t) => t.englishTerm === 'bank (river)'));
  // Chunk 2 & Chunk 3 discoveries (`kalbaisakhi`, `baithakkhana`) are present
  assert.ok(finalGlossary.find((t) => t.englishTerm === 'kalbaisakhi'));
  assert.ok(finalGlossary.find((t) => t.englishTerm === 'baithakkhana'));

  // Verify final paragraph assembly, scene break preservation, and missingTranslation fallback
  const assembled = assembleTranslatedChunks(
    englishParagraphs,
    translatedChunks,
    chunks,
    preStage3Pairs
  );
  assert.equal(assembled.pairs.length, 6);
  assert.equal(assembled.pairs[0].sceneBreakAfter, true);
  assert.equal(assembled.pairs[0].sceneBreakMarker, '***');
  assert.deepEqual(assembled.missingIndices, [5]);
  assert.equal(assembled.pairs[5].missingTranslation, true);
});

// ============================================================================
// Substep 2B.3a — Pure Stage 4 / Stage 5 Reconciliation & Server Integration
// ============================================================================

test('Step 2B.3a (1): mapSnapshotParagraphsToLatest handles exact matches, insertions, deletions, same-length replacements, reorderings, and rejects ambiguous shifted duplicates', () => {
  const mkPairs = (items: Array<[string, string]>): ParagraphPair[] =>
    items.map(([englishText, banglaText], index) => ({
      index,
      englishText,
      banglaText,
    }));

  // 1. Identical paragraphs
  const base = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Paragraph B.', 'অনুচ্ছেদ খ।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
  ]);
  const mapIdentical = mapSnapshotParagraphsToLatest(base, base);
  assert.deepEqual([...mapIdentical.snapToLatestIndex.entries()], [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
  assert.equal(mapIdentical.allParagraphsUnchanged, true);
  assert.equal(mapIdentical.hasStructuralChange, false);
  assert.deepEqual(mapIdentical.unverifiedLatestIndices, []);

  // 2. Paragraph insertion: [A, B, C] -> [A, X, B, C]
  const inserted = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Inserted Paragraph X.', 'নতুন অনুচ্ছেদ এক্স।'],
    ['Paragraph B.', 'অনুচ্ছেদ খ।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
  ]);
  const mapInserted = mapSnapshotParagraphsToLatest(base, inserted);
  assert.equal(mapInserted.snapToLatestIndex.get(0), 0);
  assert.equal(mapInserted.snapToLatestIndex.get(1), 2);
  assert.equal(mapInserted.snapToLatestIndex.get(2), 3);
  assert.equal(mapInserted.allParagraphsUnchanged, false);
  assert.equal(mapInserted.hasStructuralChange, true);
  assert.deepEqual(mapInserted.unverifiedLatestIndices, [1]);

  // 3. Paragraph deletion: [A, B, C] -> [A, C]
  const deleted = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
  ]);
  const mapDeleted = mapSnapshotParagraphsToLatest(base, deleted);
  assert.equal(mapDeleted.snapToLatestIndex.get(0), 0);
  assert.equal(mapDeleted.snapToLatestIndex.get(1), undefined);
  assert.equal(mapDeleted.snapToLatestIndex.get(2), 1);
  assert.deepEqual(mapDeleted.deletedSnapIndices, [1]);
  assert.equal(mapDeleted.hasStructuralChange, true);
  assert.deepEqual(mapDeleted.unverifiedLatestIndices, []);

  // 4. Same-length paragraph replacement: [A, B, C] -> [A, Y, C]
  const sameLenReplaced = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Completely replaced Paragraph Y.', 'সম্পূর্ণ নতুন অনুচ্ছেদ ওয়াই।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
  ]);
  const mapReplaced = mapSnapshotParagraphsToLatest(base, sameLenReplaced);
  assert.equal(mapReplaced.snapToLatestIndex.get(0), 0);
  assert.equal(mapReplaced.snapToLatestIndex.get(1), undefined);
  assert.equal(mapReplaced.snapToLatestIndex.get(2), 2);
  assert.equal(mapReplaced.latestToSnapIndex.get(1), undefined);
  assert.equal(mapReplaced.allParagraphsUnchanged, false);
  assert.equal(mapReplaced.hasStructuralChange, true);
  assert.deepEqual(mapReplaced.unverifiedLatestIndices, [1]);

  // 5. Same-length deletion + insertion: [A, B, C] -> [A, C, Y]
  const sameLenDelIns = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
    ['Newly appended Paragraph Y.', 'শেষে যুক্ত অনুচ্ছেদ ওয়াই।'],
  ]);
  const mapDelIns = mapSnapshotParagraphsToLatest(base, sameLenDelIns);
  assert.equal(mapDelIns.snapToLatestIndex.get(0), 0);
  assert.equal(mapDelIns.snapToLatestIndex.get(1), undefined);
  assert.equal(mapDelIns.snapToLatestIndex.get(2), 1);
  assert.equal(mapDelIns.latestToSnapIndex.get(2), undefined);
  assert.equal(mapDelIns.allParagraphsUnchanged, false);
  assert.equal(mapDelIns.hasStructuralChange, true);
  assert.deepEqual(mapDelIns.unverifiedLatestIndices, [2]);

  // 6. Unique paragraph reordering: [A, B, C] -> [A, C, B]
  const reordered = mkPairs([
    ['Paragraph A.', 'অনুচ্ছেদ ক।'],
    ['Paragraph C.', 'অনুচ্ছেদ গ।'],
    ['Paragraph B.', 'অনুচ্ছেদ খ।'],
  ]);
  const mapReordered = mapSnapshotParagraphsToLatest(base, reordered);
  assert.equal(mapReordered.snapToLatestIndex.get(0), 0);
  assert.equal(mapReordered.snapToLatestIndex.get(1), 2);
  assert.equal(mapReordered.snapToLatestIndex.get(2), 1);
  assert.equal(mapReordered.hasStructuralChange, true);
  assert.deepEqual(mapReordered.reorderedLatestIndices, [1, 2]);
  assert.deepEqual(mapReordered.unverifiedLatestIndices, []);

  // 7. Same-length ambiguous duplicate shift: [Dup, B, Dup] -> [Dup, Dup, Y]
  const snapWithDups = mkPairs([
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
    ['Paragraph B.', 'অনুচ্ছেদ খ।'],
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
  ]);
  const latestShiftedDups = mkPairs([
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
    ['Paragraph Y.', 'অনুচ্ছেদ ওয়াই।'],
  ]);
  const mapShiftedDups = mapSnapshotParagraphsToLatest(snapWithDups, latestShiftedDups);
  assert.equal(mapShiftedDups.snapToLatestIndex.get(0), undefined);
  assert.equal(mapShiftedDups.snapToLatestIndex.get(1), undefined);
  assert.equal(mapShiftedDups.snapToLatestIndex.get(2), undefined);
  assert.equal(mapShiftedDups.allParagraphsUnchanged, false);
  assert.deepEqual(mapShiftedDups.ambiguousDuplicateLatestIndices, [0, 1]);
  assert.deepEqual(mapShiftedDups.unverifiedLatestIndices, [0, 1, 2]);

  // 8. Unshifted identical duplicate positions: [Dup, B, Dup] -> [Dup, Y, Dup]
  const latestUnshiftedDups = mkPairs([
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
    ['Paragraph Y.', 'অনুচ্ছেদ ওয়াই।'],
    ['Yes, he whispered.', 'হ্যাঁ, সে ফিসফিস করে বলল।'],
  ]);
  const mapUnshiftedDups = mapSnapshotParagraphsToLatest(snapWithDups, latestUnshiftedDups);
  assert.equal(mapUnshiftedDups.snapToLatestIndex.get(0), 0);
  assert.equal(mapUnshiftedDups.snapToLatestIndex.get(1), undefined);
  assert.equal(mapUnshiftedDups.snapToLatestIndex.get(2), 2);
  assert.equal(mapUnshiftedDups.allParagraphsUnchanged, false);
  assert.deepEqual(mapUnshiftedDups.unverifiedLatestIndices, [1]);
});

test('Step 2B.3a (2): formatGlossaryForPrompt supports stage5 audit instructions alongside tiered glossary hierarchy', () => {
  const glossary: TerminologyMemoryItem[] = [
    createUserTerminologyItem({
      englishTerm: 'Grand Harbor',
      banglaTranslation: 'মহাবন্দর',
      acceptedAlternatives: ['বড় বন্দর'],
      avoidTranslations: ['গ্র্যান্ড হারবার'],
      category: 'place',
    }),
    normalizeTerminologyItem({
      englishTerm: 'bank (river)',
      banglaTranslation: 'নদীর তীর',
      category: 'place',
      source: 'stage1_ai',
      lockedByUser: false,
      isContextSensitive: true,
      contextMeaning: 'river',
    }),
  ];

  const promptBlock = formatGlossaryForPrompt(glossary, { stage: 'stage5' });
  assert.ok(
    promptBlock.includes(
      '[TIER 1 — MANDATORY USER-LOCKED TERMINOLOGY (HIGHEST AUTHORITY — MUST OBEY)]'
    )
  );
  assert.ok(promptBlock.includes('[STAGE 5 TERMINOLOGY AUDIT RULES]'));
  assert.ok(
    promptBlock.includes(
      'Do NOT flag a terminology issue when the Bangla translation uses either the Preferred Bangla or any listed Accepted Alternatives'
    )
  );
  assert.ok(
    promptBlock.includes(
      'ALWAYS flag a terminology issue if any FORBIDDEN / AVOID translation is used'
    )
  );
});

test('Step 2B.3a (3): runLiteraryEditingPass uses Stage 4 tiered glossary prompt and filters invalid editorialChanges indices', async () => {
  let capturedPrompt = '';
  const lockedTerm = createUserTerminologyItem({
    englishTerm: 'High Court',
    banglaTranslation: 'উচ্চ আদালত',
    avoidTranslations: ['হাইকোর্ট'],
    category: 'title',
  });

  const result = await runLiteraryEditingPass({
    englishParagraphs: [
      'The petition reached the High Court.',
      'The clerk sealed the envelope.',
    ],
    banglaParagraphs: [
      'আবেদনটি উচ্চ আদালতে পৌঁছাল।',
      'কেরানি খামটি সিলগালা করল।',
    ],
    styleProfile: null,
    characters: [],
    terminology: [lockedTerm],
    styleControls: {
      preserveAuthorStyle: true,
      naturalness: 'highly_natural',
      literaryExpression: 'rich',
      languageComplexity: 'moderate',
      dialogueStyle: 'faithful',
      translationApproach: 'faithful_literary',
    },
    stage4Executor: async ({ prompt }) => {
      capturedPrompt = prompt;
      return {
        editedParagraphs: [
          'আবেদনপত্রখানি অবশেষে উচ্চ আদালতে গিয়ে পৌঁছাল।',
          'কেরানি যত্নসহকারে খামটি সিলগালা করল।',
        ],
        editorialNotes: ['Elevated rhythm and literary diction.'],
        editorialChanges: [
          {
            paragraphIndex: 0,
            aspect: 'Rhythm',
            beforeSnippet: 'আবেদনটি উচ্চ আদালতে পৌঁছাল।',
            afterSnippet: 'আবেদনপত্রখানি অবশেষে উচ্চ আদালতে গিয়ে পৌঁছাল।',
            rationale: 'Improved cadence.',
          },
          {
            paragraphIndex: -1,
            aspect: 'Invalid negative index',
            beforeSnippet: 'ক',
            afterSnippet: 'খ',
            rationale: 'Should be filtered out.',
          },
          {
            paragraphIndex: 99,
            aspect: 'Invalid out-of-range index',
            beforeSnippet: 'ক',
            afterSnippet: 'খ',
            rationale: 'Should be filtered out.',
          },
        ],
      };
    },
  });

  assert.ok(
    capturedPrompt.includes('[STAGE 4 TERMINOLOGY PROTECTION & LITERARY POLISH RULES]')
  );
  assert.ok(capturedPrompt.includes(normalizeBanglaUnicode('উচ্চ আদালত')));
  assert.equal(result.editedParagraphs.length, 2);
  assert.equal(result.editorialChanges.length, 1);
  assert.equal(result.editorialChanges[0].paragraphIndex, 0);
});

test('Step 2B.3a (4): reconcileStage4ResultWithLatestState protects in-flight user Bangla edits, rejects stale edits on same-length replaced English paragraphs, and runs deterministic terminology lint', () => {
  const lockedTerm = createUserTerminologyItem({
    englishTerm: 'Clocktower',
    banglaTranslation: 'ঘড়িঘর',
    avoidTranslations: ['ক্লকটাওয়ার'],
    category: 'place',
  });

  const snapshotParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'He stood beneath the Clocktower.',
      banglaText: 'সে ঘড়িঘরের নিচে দাঁড়িয়ে ছিল।',
    },
    {
      index: 1,
      englishText: 'The rain fell softly on the cobblestones.',
      banglaText: 'পাথুরে রাস্তায় ঝিরঝির করে বৃষ্টি পড়ছিল।',
    },
    {
      index: 2,
      englishText: 'She opened the brass gate.',
      banglaText: 'সে পিতলের ফটকটি খুলল।',
    },
  ];

  // While Stage 4 is in flight:
  // - User manually edits Bangla of paragraph 0
  // - Paragraph 1's English text is replaced with a different English paragraph (same total length = 3!)
  // - Paragraph 2 is untouched
  const latestParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'He stood beneath the Clocktower.',
      banglaText: 'সে নীরবে ঘড়িঘরের ছায়ায় দাঁড়িয়ে রইল।', // User manual Bangla edit in flight
    },
    {
      index: 1,
      englishText: 'A distant train whistle echoed across the valley.', // Same-length English replacement Y!
      banglaText: 'দূরবর্তী ট্রেনের বাঁশি উপত্যকায় প্রতিধ্বনিত হলো।',
    },
    {
      index: 2,
      englishText: 'She opened the brass gate.',
      banglaText: 'সে পিতলের ফটকটি খুলল।',
    },
  ];

  // Stage 4 returns polished text for snapshot [0, 1, 2]
  const stage4Output = {
    editedParagraphs: [
      'সে ক্লকটাওয়ারের নিচে দাঁড়িয়ে ছিল।', // Would violate glossary if applied, but user edited p0!
      'ভেজা পাথুরে পথে মৃদু ছন্দে বৃষ্টি ঝরছিল।', // Stale edit for old snapshot p1 ('The rain fell...')
      'সে ধীরে পিতলের ফটকখানি মেলে ধরল।', // Valid polish for untouched p2
    ],
    editorialNotes: ['Polished prose rhythm.'],
    editorialChanges: [
      {
        paragraphIndex: 0,
        aspect: 'Flow',
        beforeSnippet: 'সে ঘড়িঘরের নিচে দাঁড়িয়ে ছিল।',
        afterSnippet: 'সে ক্লকটাওয়ারের নিচে দাঁড়িয়ে ছিল।',
        rationale: 'Changed p0',
      },
      {
        paragraphIndex: 1,
        aspect: 'Cadence',
        beforeSnippet: 'পাথুরে রাস্তায় ঝিরঝির করে বৃষ্টি পড়ছিল।',
        afterSnippet: 'ভেজা পাথুরে পথে মৃদু ছন্দে বৃষ্টি ঝরছিল।',
        rationale: 'Changed old p1',
      },
      {
        paragraphIndex: 2,
        aspect: 'Diction',
        beforeSnippet: 'সে পিতলের ফটকটি খুলল।',
        afterSnippet: 'সে ধীরে পিতলের ফটকখানি মেলে ধরল।',
        rationale: 'Polished p2',
      },
    ],
  };

  // Case A: latestVerificationReport is null and reconciled paragraphs have 0 terminology violations
  const reconciledClean = reconcileStage4ResultWithLatestState({
    snapshotParagraphs,
    latestParagraphs,
    editedParagraphs: stage4Output.editedParagraphs,
    editorialNotes: stage4Output.editorialNotes,
    editorialChanges: stage4Output.editorialChanges,
    latestGlossary: [lockedTerm],
    latestVerificationReport: null,
    wasVerificationCompleted: false,
  });

  // 1. User's in-flight Bangla edit on p0 is preserved
  assert.equal(
    reconciledClean.paragraphs[0].banglaText,
    'সে নীরবে ঘড়িঘরের ছায়ায় দাঁড়িয়ে রইল।'
  );
  // 2. Replaced paragraph Y at index 1 NEVER receives old B's Stage 4 edit
  assert.equal(
    reconciledClean.paragraphs[1].banglaText,
    'দূরবর্তী ট্রেনের বাঁশি উপত্যকায় প্রতিধ্বনিত হলো।'
  );
  // 3. Untouched paragraph 2 receives Stage 4 literary polish
  assert.equal(
    reconciledClean.paragraphs[2].banglaText,
    'সে ধীরে পিতলের ফটকখানি মেলে ধরল।'
  );
  // 4. Only p2's editorialChange survives
  assert.equal(reconciledClean.editorialChanges.length, 1);
  assert.equal(reconciledClean.editorialChanges[0].paragraphIndex, 2);
  // 5. Coverage tracks that p0 and p1 were preserved in flight and only p2 was applied & changed by Stage 4
  assert.deepEqual(reconciledClean.appliedParagraphIndices, [2]);
  assert.deepEqual(reconciledClean.preservedInFlightParagraphIndices, [0, 1]);
  assert.deepEqual(reconciledClean.changedByStage4ParagraphIndices, [2]);
  // 6. Because latestVerificationReport was null and 0 deterministic lint violations exist,
  // verificationReport stays null and stageCompletedVerification stays false
  assert.equal(reconciledClean.verificationReport, null);
  assert.equal(reconciledClean.stageCompletedVerification, false);

  // Case B: Stage 4 introduces a forbidden term on an untouched paragraph when latestVerificationReport is null
  const stage4WithViolation = {
    editedParagraphs: [
      'সে ক্লকটাওয়ারের নিচে দাঁড়িয়ে ছিল।', // Applied to p0 when p0 is untouched
      'পাথুরে রাস্তায় ঝিরঝির করে বৃষ্টি পড়ছিল।',
      'সে পিতলের ফটকটি খুলল।',
    ],
    editorialNotes: ['Edited p0'],
    editorialChanges: [],
  };

  const reconciledViolation = reconcileStage4ResultWithLatestState({
    snapshotParagraphs,
    latestParagraphs: snapshotParagraphs, // No in-flight edits; p0 receives forbidden 'ক্লকটাওয়ার'
    editedParagraphs: stage4WithViolation.editedParagraphs,
    editorialNotes: stage4WithViolation.editorialNotes,
    editorialChanges: stage4WithViolation.editorialChanges,
    latestGlossary: [lockedTerm],
    latestVerificationReport: null,
    wasVerificationCompleted: false,
  });

  assert.ok(reconciledViolation.verificationReport !== null);
  assert.equal(reconciledViolation.verificationReport?.isComplete, false);
  assert.equal(reconciledViolation.stageCompletedVerification, false);
  assert.equal(reconciledViolation.chapterStatus, 'needs_review');
  assert.ok(
    reconciledViolation.verificationReport!.issues.some(
      (i) => i.source === 'deterministic_lint' && i.paragraphIndex === 0
    )
  );
});

test('Step 2B.3a (5): verifyTranslationAccuracy schema and normalization handle chapter-level issues (missing/null paragraphIndex) and reject invalid/out-of-range paragraphIndex values', async () => {
  // Confirm STAGE5_RESPONSE_SCHEMA does not require paragraphIndex or suggestedFix
  const issueRequired =
    STAGE5_RESPONSE_SCHEMA.properties.issues.items.required;
  assert.deepEqual(issueRequired, [
    'severity',
    'type',
    'description',
    'englishExcerpt',
    'banglaExcerpt',
  ]);

  const report = await verifyTranslationAccuracy({
    englishParagraphs: [
      'Paragraph zero in English.',
      'Paragraph one in English.',
    ],
    banglaParagraphs: [
      'বাংলা অনুচ্ছেদ শূন্য।',
      'বাংলা অনুচ্ছেদ এক।',
    ],
    characters: [],
    terminology: [],
    stage5Executor: async () => ({
      overallScore: 88,
      fidelitySummary: 'Mostly faithful with one chapter-level tone drift and one p1 issue.',
      isComplete: true,
      issues: [
        // 1. Legitimate chapter-level issue (paragraphIndex omitted)
        {
          severity: 'medium',
          type: 'emotional_intent',
          description: 'Chapter-wide narrative tone shifts from formal to casual.',
          englishExcerpt: 'Overall chapter tone',
          banglaExcerpt: 'সমগ্র অধ্যায়ের সুর',
          suggestedFix: 'বাংলা অনুচ্ছেদ শূন্য সংশোধিত।', // Must be stripped for chapter-level issue!
        },
        // 2. Legitimate chapter-level issue (paragraphIndex: null)
        {
          severity: 'low',
          type: 'chronology',
          paragraphIndex: null,
          description: 'Timeline transition across scenes feels abrupt.',
          englishExcerpt: 'Scene transition',
          banglaExcerpt: 'দৃশ্যান্তর',
        },
        // 3. Valid paragraph-level issue (paragraphIndex: 1)
        {
          severity: 'high',
          type: 'missing_content',
          paragraphIndex: 1,
          description: 'Missing adjective in paragraph 1.',
          englishExcerpt: 'Paragraph one in English.',
          banglaExcerpt: 'বাংলা অনুচ্ছেদ এক।',
          suggestedFix: 'সম্পূর্ণ বাংলা অনুচ্ছেদ এক।',
        },
        // 4. Invalid negative paragraphIndex (-1) -> must be rejected, NEVER coerced to 0
        {
          severity: 'high',
          type: 'changed_meaning',
          paragraphIndex: -1,
          description: 'Negative index hallucination.',
          englishExcerpt: 'x',
          banglaExcerpt: 'ক',
        },
        // 5. Invalid float paragraphIndex (0.5) -> must be rejected
        {
          severity: 'high',
          type: 'changed_meaning',
          paragraphIndex: 0.5,
          description: 'Float index hallucination.',
          englishExcerpt: 'x',
          banglaExcerpt: 'ক',
        },
        // 6. Invalid out-of-range paragraphIndex (2 when length is 2) -> must be rejected
        {
          severity: 'high',
          type: 'changed_meaning',
          paragraphIndex: 2,
          description: 'Out-of-range index hallucination.',
          englishExcerpt: 'x',
          banglaExcerpt: 'ক',
        },
        // 7. Invalid string paragraphIndex ("0") -> must be rejected
        {
          severity: 'high',
          type: 'changed_meaning',
          paragraphIndex: '0',
          description: 'String index hallucination.',
          englishExcerpt: 'x',
          banglaExcerpt: 'ক',
        },
      ],
    }),
  });

  // Only the 2 chapter-level issues and 1 valid paragraph-level issue should remain
  assert.equal(report.issues.length, 3);

  const chapterIssues = report.issues.filter((i) => i.paragraphIndex === undefined);
  assert.equal(chapterIssues.length, 2);
  assert.equal(chapterIssues[0].suggestedFix, undefined);
  assert.equal(chapterIssues[1].suggestedFix, undefined);

  const paraIssues = report.issues.filter((i) => i.paragraphIndex !== undefined);
  assert.equal(paraIssues.length, 1);
  assert.equal(paraIssues[0].paragraphIndex, 1);
  assert.equal(paraIssues[0].suggestedFix, 'সম্পূর্ণ বাংলা অনুচ্ছেদ এক।');
});

test('Step 2B.3a (6): reconcileStage5ResultWithLatestState prevents misattaching issues on same-length replacement, marks partial verification honestly, and enforces strict resolved-issue preservation', () => {
  const snapshotParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'The detective examined the silver key.',
      banglaText: 'গোয়েন্দা রুপার চাবিটি পরীক্ষা করলেন।',
    },
    {
      index: 1,
      englishText: 'He locked the heavy oak door.',
      banglaText: 'সে ভারী ওক কাঠের দরজাটি বন্ধ করল।',
    },
    {
      index: 2,
      englishText: 'Footsteps echoed on the stairs.',
      banglaText: 'সিঁড়িতে পদধ্বনি প্রতিধ্বনিত হলো।',
    },
  ];

  // Existing verification report has a resolved AI issue on paragraph 0 and an unresolved AI issue on paragraph 2
  const p0Fingerprint = computeParagraphContentFingerprint(
    snapshotParagraphs[0].englishText,
    snapshotParagraphs[0].banglaText
  );
  const p2Fingerprint = computeParagraphContentFingerprint(
    snapshotParagraphs[2].englishText,
    snapshotParagraphs[2].banglaText
  );

  const previousReport: VerificationReport = {
    overallScore: 90,
    fidelitySummary: 'Previous report.',
    isComplete: true,
    checkedAt: '2026-01-01T00:00:00.000Z',
    issues: [
      {
        id: 'prev-ai-p0-resolved',
        severity: 'low',
        type: 'character_reference',
        paragraphIndex: 0,
        description: 'Honorific pronoun check on detective.',
        englishExcerpt: 'The detective examined',
        banglaExcerpt: 'গোয়েন্দা রুপার চাবিটি',
        resolved: true,
        source: 'ai_stage5',
        paragraphContentFingerprint: p0Fingerprint,
      },
      {
        id: 'prev-ai-p2-resolved-same-desc-only',
        severity: 'medium',
        type: 'changed_meaning',
        paragraphIndex: 2,
        description: 'Nuance in footsteps description.',
        englishExcerpt: 'Old excerpt on stairs',
        banglaExcerpt: 'পুরোনো সিঁড়ির অংশ',
        resolved: true,
        source: 'ai_stage5',
        paragraphContentFingerprint: p2Fingerprint,
      },
    ],
  };

  // Same-length replacement at index 1: [A, B, C] -> [A, Y, C]
  const latestParagraphs: ParagraphPair[] = [
    snapshotParagraphs[0],
    {
      index: 1,
      englishText: 'A sudden lightning bolt lit the courtyard.', // Replacement Y at index 1!
      banglaText: 'হঠাৎ বজ্রপাতের আলোয় উঠান আলোকিত হয়ে উঠল।',
    },
    snapshotParagraphs[2],
  ];

  // Stage 5 (which ran on snapshot [A, B, C]) returns:
  // - Issue on snapshot p0 with identical type, severity, and excerpts -> should preserve `resolved: true`
  // - Issue on snapshot p1 ('He locked the heavy oak door') -> MUST BE DISCARDED because p1 in latest is Y!
  // - Issue on snapshot p2 with same description ('Nuance in footsteps description.') but different excerpts -> MUST NOT preserve `resolved: true`!
  const incomingStage5Report: VerificationReport = {
    overallScore: 92,
    fidelitySummary: 'High translation fidelity.',
    isComplete: true,
    checkedAt: '2026-01-02T00:00:00.000Z',
    issues: [
      {
        id: 'new-ai-p0',
        severity: 'low',
        type: 'character_reference',
        paragraphIndex: 0,
        description: 'Updated phrasing of detective pronoun note.',
        englishExcerpt: 'The detective examined',
        banglaExcerpt: 'গোয়েন্দা রুপার চাবিটি',
        resolved: false,
        source: 'ai_stage5',
      },
      {
        id: 'new-ai-p1-stale',
        severity: 'high',
        type: 'omitted_dialogue',
        paragraphIndex: 1,
        description: 'Issue belonging to old paragraph B.',
        englishExcerpt: 'He locked the heavy oak door.',
        banglaExcerpt: 'সে ভারী ওক কাঠের দরজাটি বন্ধ করল।',
        suggestedFix: 'তেঁতুল কাঠের দরজাটি বন্ধ করলেন তিনি।',
        resolved: false,
        source: 'ai_stage5',
      },
      {
        id: 'new-ai-p2-diff-excerpts',
        severity: 'medium',
        type: 'changed_meaning',
        paragraphIndex: 2,
        description: 'Nuance in footsteps description.', // Identical description!
        englishExcerpt: 'Footsteps echoed on the stairs.', // Different excerpt!
        banglaExcerpt: 'সিঁড়িতে পদধ্বনি প্রতিধ্বনিত হলো।',
        resolved: false,
        source: 'ai_stage5',
      },
    ],
  };

  const reconciled = reconcileStage5ResultWithLatestState({
    snapshotParagraphs,
    latestParagraphs,
    aiReport: incomingStage5Report,
    latestGlossary: [],
    previousVerificationReport: previousReport,
  });

  // 1. Stale issue for old paragraph B at index 1 was discarded, never attached to replacement Y
  assert.equal(
    reconciled.verificationReport.issues.some((i) => i.paragraphIndex === 1),
    false
  );
  assert.equal(reconciled.discardedStaleIssueCount, 1);

  // 2. Paragraph 0 issue preserved `resolved: true` because paragraph 0 is unchanged and type/severity/excerpts match
  const p0Issue = reconciled.verificationReport.issues.find(
    (i) => i.paragraphIndex === 0
  );
  assert.ok(p0Issue);
  assert.equal(p0Issue.resolved, true);

  // 3. Paragraph 2 issue did NOT preserve `resolved: true` because excerpts differed despite identical description
  const p2Issue = reconciled.verificationReport.issues.find(
    (i) => i.paragraphIndex === 2
  );
  assert.ok(p2Issue);
  assert.equal(p2Issue.resolved, false);

  // 4. Partial verification status is accurately reported (never synthetic score, isComplete: false, stageCompletedVerification: false)
  assert.equal(reconciled.allParagraphsVerified, false);
  assert.deepEqual(reconciled.unverifiedParagraphIndices, [1]);
  assert.equal(reconciled.verificationReport.isComplete, false);
  assert.equal(reconciled.stageCompletedVerification, false);
  assert.equal(reconciled.chapterStatus, 'needs_review');
  assert.ok(
    reconciled.verificationReport.fidelitySummary.startsWith(
      '[Partial Verification — Verified 2 of 3 paragraph(s); Paragraph #2 changed or remained unverified and requires a Stage 5 re-run.]'
    )
  );
});

test('Step 2B.3a (7): reconcileVerificationReportAfterLocalEdit invalidates AI issues only on edited paragraphs while preserving untouched paragraph AI issues and re-linting glossary rules', () => {
  const lockedTerm = createUserTerminologyItem({
    englishTerm: 'Sanctuary',
    banglaTranslation: 'অভয়ারণ্য',
    avoidTranslations: ['স্যাঙ্কচুয়ারি'],
    category: 'place',
  });

  const beforeEditParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'They entered the Sanctuary at dawn.',
      banglaText: 'তারা ভোরে অভয়ারণ্যে প্রবেশ করল।',
    },
    {
      index: 1,
      englishText: 'The watchman nodded silently.',
      banglaText: 'প্রহরী নীরবে মাথা নাড়ল।',
    },
  ];

  const p0Fp = computeParagraphContentFingerprint(
    beforeEditParagraphs[0].englishText,
    beforeEditParagraphs[0].banglaText
  );
  const p1Fp = computeParagraphContentFingerprint(
    beforeEditParagraphs[1].englishText,
    beforeEditParagraphs[1].banglaText
  );

  const initialReport: VerificationReport = {
    overallScore: 91,
    fidelitySummary: 'Verified all paragraphs.',
    isComplete: true,
    checkedAt: '2026-01-01T00:00:00.000Z',
    issues: [
      {
        id: 'ai-p0',
        severity: 'low',
        type: 'emotional_intent',
        paragraphIndex: 0,
        description: 'Slight tone note on p0.',
        englishExcerpt: 'They entered the Sanctuary',
        banglaExcerpt: 'তারা ভোরে অভয়ারণ্যে',
        resolved: false,
        source: 'ai_stage5',
        paragraphContentFingerprint: p0Fp,
      },
      {
        id: 'ai-p1',
        severity: 'medium',
        type: 'character_reference',
        paragraphIndex: 1,
        description: 'Watchman register note on p1.',
        englishExcerpt: 'The watchman nodded',
        banglaExcerpt: 'প্রহরী নীরবে মাথা নাড়ল',
        resolved: false,
        source: 'ai_stage5',
        paragraphContentFingerprint: p1Fp,
      },
    ],
  };

  // User edits paragraph 0 in Bangla (introducing forbidden 'স্যাঙ্কচুয়ারি') while leaving paragraph 1 untouched
  const afterEditParagraphs: ParagraphPair[] = [
    {
      index: 0,
      englishText: 'They entered the Sanctuary at dawn.',
      banglaText: 'তারা ভোরে স্যাঙ্কচুয়ারিতে প্রবেশ করল।',
    },
    beforeEditParagraphs[1],
  ];

  const reconciledReport = reconcileVerificationReportAfterLocalEdit({
    previousParagraphs: beforeEditParagraphs,
    latestParagraphs: afterEditParagraphs,
    previousReport: initialReport,
    latestGlossary: [lockedTerm],
  });

  assert.ok(reconciledReport !== null);
  // 1. Stale AI issue on edited paragraph 0 was invalidated
  assert.equal(
    reconciledReport!.issues.some(
      (i) => i.source === 'ai_stage5' && i.paragraphIndex === 0
    ),
    false
  );
  // 2. AI issue on untouched paragraph 1 was preserved
  assert.equal(
    reconciledReport!.issues.some(
      (i) => i.source === 'ai_stage5' && i.paragraphIndex === 1
    ),
    true
  );
  // 3. Deterministic glossary lint caught the new forbidden term on paragraph 0
  assert.equal(
    reconciledReport!.issues.some(
      (i) => i.source === 'deterministic_lint' && i.paragraphIndex === 0
    ),
    true
  );
  // 4. Paragraph 0 is now unverified by AI, so verification report is marked partial (isComplete: false)
  assert.equal(reconciledReport!.isComplete, false);
  assert.ok(
    reconciledReport!.fidelitySummary.startsWith(
      '[Partial Verification — Verified 1 of 2 paragraph(s); Paragraph #1 changed or remained unverified and requires a Stage 5 re-run.]'
    )
  );
});



