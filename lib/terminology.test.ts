import test from 'node:test';
import assert from 'node:assert/strict';
import type { ParagraphPair, TerminologyMemoryItem } from './types';
import {
  createUserTerminologyItem,
  endsWithBanglaVowel,
  filterGlossaryForChunk,
  findBanglaTermOccurrences,
  findEnglishTermOccurrences,
  generateConservativeEnglishWordForms,
  isAllowedBanglaNominalSuffix,
  lintChapterTerminology,
  lintParagraphTerminology,
  matchGlossaryInEnglishText,
  matchesBanglaTerm,
  mergeGlossaryItems,
  normalizeBanglaUnicode,
  normalizeGlossaryList,
  normalizeTerminologyItem,
  terminologyFindingToVerificationIssue,
  updateUserTerminologyItem,
  validateTerminologyItem,
} from './terminology';

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
  assert.equal(sampleIssue.paragraphIndex, 2);
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


