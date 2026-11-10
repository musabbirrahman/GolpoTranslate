import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_STYLE_CONTROLS,
  type AppSettings,
  type TranslationHistoryEntry,
  type TranslationProject,
} from './types';
import { SAMPLE_LITERARY_PASSAGES } from './sample-passages';
import { splitIntoParagraphs } from './chunker';

const DB_NAME = 'golpotranslate_studio_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_HISTORY = 'history';
const STORE_SETTINGS = 'settings';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createStarterProject(): TranslationProject {
  const sample = SAMPLE_LITERARY_PASSAGES[0];
  const engParagraphs = splitIntoParagraphs(sample.text);
  const banglaParagraphs = [
    'বউবাজারে বর্ষা কোনো অতিথির মতো এসে পৌঁছায়নি; বহুদিনের পুরোনো কোনো পাওনা যেন হঠাৎ কড়ায়-গণ্ডায় আদায় করতে খড়খড়ির পাল্লা ভেঙেচুরে ঢুকে পড়েছিল। ট্রামলাইনের ঠিক ওপরের সরু কারখানাঘরটিতে ডান চোখে জহুরির আতশকাচ চেপে বসে ছিলেন ইলিয়াস বোস—শুনছিলেন, বিকেলটা ঠিক কোন সেকেন্ডে শেষ নিঃশ্বাস ত্যাগ করেছে তা নিয়ে সাঁইত্রিশটা ঘড়ির অসমাপ্ত তর্ক।',
    'তাঁর দেবদারু কাঠের টেবিলে পড়ে থাকা প্রতিটি ঘড়ির ভেতরই এমন কারও না কারও হৃৎস্পন্দন জমে ছিল, যার জন্য এখন আর কেউ অপেক্ষা করে না। সেখানে ছিল জাস্টিস হ্যারিংটনের রুপোর পকেট-ক্রোনোমিটার—যেদিন তাঁকে ফেলেই স্টিমার ছেড়ে চলে গেল, সেদিন বিকেল চারটে পনেরোয় যার কাঁটা থেমে গিয়েছিল; আর ছিল অপরাজিতা নামের এক নারীর রেখে যাওয়া সূক্ষ্ম মিনাকারি করা লকেট-ঘড়ি। অপরাজিতা ইলিয়াসকে স্প্রিংটা সারাতে নিষেধ করেছিলেন—শুধু বলেছিলেন কাঁটার ওপর জমে থাকা ধুলোটা যেন মুছে দেওয়া হয়, যাতে ঘড়িটার দিকে তাকালে তাঁর মনে পড়ে মা কীভাবে আঙুল ঘুরিয়ে ওতে দম দিতেন।',
    'দরজার চৌকাঠ থেকে অপরাজিতা বললেন, "আপনি আবার পিতলের দিকে এমনভাবে কান পেতে আছেন, যেন ওটা এক্ষুনি কোনো গোপন পাপের স্বীকারোক্তি দেবে।" ক্ষয়ে যাওয়া লাল মেঝের ওপর ছাতার জল ঝাড়তে ঝাড়তে তিনি দাঁড়িয়ে ছিলেন, ভেজা আঁচলটা জড়িয়ে ছিল তাঁর কবজিতে।',
    'ইলিয়াস সঙ্গে সঙ্গে আতশকাচটা নামালেন না। বড্ড তাড়াতাড়ি চোখ তুললে অপরাজিতার চোখের ওই শান্ত অথচ তীক্ষ্ণ দৃষ্টি তাঁর সাজানো সব অজুহাতের ভাষা এলোমেলো করে দেয়। তিনি বললেন, "পিতল কখনো মিথ্যে বলে না, অপরাজিতা। কোনো চাকা ক্ষয়ে গেলে সে নিজের ক্লান্তির কথা স্বীকার করে নেয়। অথচ মানুষগুলোকে দেখুন—মূল স্প্রিংটা ছিঁড়ে যাওয়ার পরও কেমন বছরের পর বছর টিকটিক করে চলতে থাকে।"',
    'অপরাজিতা ধীর পায়ে কাউন্টারের কাছে এসে ইলিয়াসের তেলের প্রদীপটার পাশে একটি ছোট দেবদারু কাঠের বাক্স রাখলেন। দমকা হাওয়ায় প্রদীপের শিখাটা কেঁপে উঠল, আর দেওয়ালে টাঙানো হুগলি নদীর মানচিত্রের ওপর লম্বাটে হলদেটে ছায়া মেলে ধরল। "তাহলে এই বাক্সটার ভেতর একবার তাকান, ইলিয়াস। কারণ কাল মাঝরাতে ঘড়িটা আবার টিকটিক করে চলতে শুরু করেছে—অথচ গত কুড়ি বছরে আমাদের বাড়ির কেউ ওটার চাবিতে হাতও দেয়নি।"',
  ];

  const now = '2026-01-01T00:00:00.000Z';

  return {
    id: 'proj-clockmaker-calcutta',
    title: sample.title,
    authorName: sample.authorName,
    genre: sample.genre,
    sourceLanguage: 'English',
    targetLanguage: 'Bangla (বাংলা)',
    createdAt: now,
    updatedAt: now,
    styleProfile: {
      overallVoice:
        'Evocative, contemplative, and richly atmospheric literary prose with an undercurrent of quiet nostalgia and unspoken emotional intimacy.',
      sentenceStructure:
        'Layered, cadenced sentences that balance long sensory descriptions with crisp, resonant clauses at the end of paragraphs.',
      vocabularyComplexity:
        'Refined literary diction drawing on horological craftsmanship (loupe, chronometer, mainspring) and tactile urban imagery.',
      narrativePerspective:
        'Close third-person limited anchored in Elias Bose’s interior perception and observant sensibility.',
      dialogueStyle:
        'Subtle, philosophical, and emotionally restrained; characters speak through metaphor and understated irony rather than overt sentimentality.',
      emotionalIntensity:
        'Simmering, tender, and melancholic—grief, memory, and quiet longing expressed through objects and small physical gestures.',
      descriptiveTechniques:
        'Auditory and tactile grounding (rain through slatted shutters, ticking brass, wet anchal on red oxide floor, flickering oil lamp shadows).',
      metaphorsAndImagery:
        'Extended horological metaphors comparing human endurance and memory to clockwork mechanisms, gears, and broken mainsprings.',
      literaryCharacteristics:
        'Lyrical realism blended with a subtle hint of the uncanny at the chapter’s closing hook.',
      languageRegister:
        'Refined contemporary literary style (প্রমিত সাহিত্যিক বাংলা) using respectful "আপনি" in dialogue to preserve old-Calcutta grace and restrained intimacy.',
      banglaAdaptationStrategy:
        'Use flowing, idiomatic Bangla prose reminiscent of classic Calcutta literary fiction without archaic Sadhu-bhasha verbs. Preserve horological metaphors organically and use "আপনি" between Elias and Aparajita to reflect their delicate, respectful distance.',
      customNotes:
        'Keep cultural terms like Bowbazar (বউবাজার), Hooghly River (হুগলি নদী), and anchal (আঁচল) natural in Bangla.',
    },
    storyContext: {
      summary:
        'On a monsoon afternoon in Bowbazar, Calcutta, clockmaker Elias Bose tends to broken timepieces that hold the memories of their owners. Aparajita visits his workshop during the downpour and brings a cedar box containing a clock that mysteriously began ticking at midnight after twenty years of silence.',
      narrativeTimeline:
        'A single rainy monsoon afternoon in old Calcutta, referencing past memories (Justice Harrington’s departure, Aparajita’s mother, and a twenty-year silence).',
      importantEvents: [
        'Monsoon rain breaks over Elias Bose’s clock workshop in Bowbazar.',
        'Elias reflects on the stopped watches of Justice Harrington and Aparajita’s late mother.',
        'Aparajita arrives soaked from the rain and engages Elias in a philosophical exchange about time and human endurance.',
        'Aparajita reveals a clock in a cedar box that started ticking at midnight untouched after twenty years.',
      ],
      emotionalContext:
        'Nostalgic, quietly romantic, and mysterious; unspoken affection between Elias and Aparajita intertwined with grief and wonder.',
      literaryTone: 'Lyrical, contemplative, atmospheric, and subtly mysterious.',
      locations: [
        {
          name: 'Bowbazar Workshop',
          banglaName: 'বউবাজারের ঘড়ির কারখানা',
          description: 'Narrow clockmaker’s workshop above the Calcutta tramlines with cedar tables and Hooghly River wall maps.',
        },
        {
          name: 'Hooghly River',
          banglaName: 'হুগলি নদী',
          description: 'Featured on the vintage wall maps illuminated by Elias’s oil lamp.',
        },
      ],
    },
    characterMemory: [
      {
        id: 'char-elias',
        englishName: 'Elias Bose',
        banglaName: 'ইলিয়াস বোস',
        relationships: 'Clockmaker in Bowbazar; holds deep, unspoken affection for Aparajita',
        pronouns: 'He/Him (তিনি/তাঁর)',
        personality: 'Observant, philosophical, guarded, deeply empathetic toward people’s memories',
        speakingStyle: 'Poetic, measured, uses clockwork metaphors and addresses Aparajita as "আপনি"',
        notes: 'Use respectful honorific pronouns in narration to match the literary tone.',
      },
      {
        id: 'char-aparajita',
        englishName: 'Aparajita',
        banglaName: 'অপরাজিতা',
        relationships: 'Client and quiet confidante of Elias Bose',
        pronouns: 'She/Her (তিনি/তাঁর)',
        personality: 'Perceptive, poised, sentimental about her mother’s memory',
        speakingStyle: 'Gentle sharpness, observant, addresses Elias as "আপনি"',
        notes: 'Brought an enamel pendant watch earlier; now brings a mysterious cedar box.',
      },
      {
        id: 'char-harrington',
        englishName: 'Justice Harrington',
        banglaName: 'জাস্টিস হ্যারিংটন',
        relationships: 'Former owner of the silver pocket chronometer',
        pronouns: 'He/Him (তিনি/তাঁর)',
        personality: 'Mentioned in memory',
        speakingStyle: 'N/A',
        notes: 'His chronometer stopped at 4:15.',
      },
    ],
    terminologyMemory: [
      {
        id: 'term-loupe',
        englishTerm: 'jeweler’s loupe',
        banglaTranslation: 'জহুরির আতশকাচ',
        category: 'object',
        notes: 'Elias’s magnifying glass for clockwork inspection',
      },
      {
        id: 'term-mainspring',
        englishTerm: 'mainspring',
        banglaTranslation: 'মূল স্প্রিং',
        category: 'object',
        notes: 'Central spring of a mechanical watch',
      },
      {
        id: 'term-red-oxide',
        englishTerm: 'red oxide floor',
        banglaTranslation: 'লাল মেঝে',
        category: 'place',
        notes: 'Traditional Calcutta red oxide flooring',
      },
      {
        id: 'term-cedar',
        englishTerm: 'cedar box',
        banglaTranslation: 'দেবদারু কাঠের বাক্স',
        category: 'object',
        notes: 'The box holding the mysterious ticking watch',
      },
    ],
    styleControls: { ...DEFAULT_STYLE_CONTROLS },
    chapters: [
      {
        id: 'ch-1-clockmaker',
        number: 1,
        title: 'Chapter 1: The Brass Pendulum',
        originalText: sample.text,
        translatedText: banglaParagraphs.join('\n\n'),
        paragraphs: engParagraphs.map((eng, idx) => ({
          index: idx,
          englishText: eng,
          banglaText: banglaParagraphs[idx] || '',
          lastRefinementAction: 'stage_4_editorial',
        })),
        status: 'completed',
        currentStage: 5,
        stageCompleted: {
          understanding: true,
          voiceAnalysis: true,
          translation: true,
          editing: true,
          verification: true,
        },
        editorialNotes: [
          'Replaced literal syntax in paragraph 1 ("like an old debt finally demanding payment") with idiomatic Bangla ("বহুদিনের পুরোনো কোনো পাওনা যেন হঠাৎ কড়ায়-গণ্ডায় আদায় করতে").',
          'Maintained respectful "আপনি" dialogue register between Elias and Aparajita to preserve old-Calcutta literary intimacy.',
          'Harmonized horological terms ("জহুরির আতশকাচ", "মূল স্প্রিং") across narration and dialogue.',
        ],
        editorialChanges: [
          {
            paragraphIndex: 0,
            aspect: 'Idiomatic Flow & Metaphor',
            beforeSnippet: 'পুরোনো ঋণের মতো যা অবশেষে পরিশোধ চাইছে',
            afterSnippet: 'বহুদিনের পুরোনো কোনো পাওনা যেন হঠাৎ কড়ায়-গণ্ডায় আদায় করতে',
            rationale: 'Transformed literal English phrasing into vivid, authentic Bangla literary cadence.',
          },
          {
            paragraphIndex: 3,
            aspect: 'Dialogue Rhythm',
            beforeSnippet: 'মানুষ অন্যদিকে টিকটিক করতে থাকে মূল স্প্রিং ভাঙার পরও।',
            afterSnippet: 'অথচ মানুষগুলোকে দেখুন—মূল স্প্রিংটা ছিঁড়ে যাওয়ার পরও কেমন বছরের পর বছর টিকটিক করে চলতে থাকে।',
            rationale: 'Made Elias’s spoken Bangla sound naturally reflective and conversational.',
          },
        ],
        verificationReport: {
          overallScore: 98,
          fidelitySummary:
            'All 5 paragraphs, character references, horological metaphors, and emotional beats are faithfully preserved in natural literary Bangla with zero omitted sentences or added events.',
          isComplete: true,
          checkedAt: now,
          issues: [],
        },
        chunkCount: 1,
        completedChunks: 1,
        updatedAt: now,
      },
      {
        id: 'ch-2-clockmaker',
        number: 2,
        title: 'Chapter 2: The Unwound Key',
        originalText: `Elias lifted the brass latch of the cedar box with the tip of his tweezers. Inside, resting on faded velvet the color of dried hibiscus, lay a silver verge escapement watch engraved with the crest of the Tagore Ghat ferry company.

Its second hand was moving—not forward, as every honest clock since Huygens had been taught to march, but in a slow, deliberate counterclockwise sweep that made the rain outside seem to hesitate against the windowpane.

"My grandfather locked this in his iron safe the night the river flooded the northern warehouses," Aparajita whispered, leaning closer so that the scent of wet jasmine and rain-soaked cotton reached Elias across the workbench. "He told my mother that if the key ever turned by itself, we were to bring it to the man who still knew how to read the river tables."

Elias looked from the counter-rotating dial to Aparajita’s rain-bright eyes. "Your grandfather was a careful man, Aparajita. This watch isn't measuring the hour. Look at the inner ring—those aren't numerals. They are soundings of the Hooghly channel."`,
        translatedText: '',
        paragraphs: splitIntoParagraphs(
          `Elias lifted the brass latch of the cedar box with the tip of his tweezers. Inside, resting on faded velvet the color of dried hibiscus, lay a silver verge escapement watch engraved with the crest of the Tagore Ghat ferry company.

Its second hand was moving—not forward, as every honest clock since Huygens had been taught to march, but in a slow, deliberate counterclockwise sweep that made the rain outside seem to hesitate against the windowpane.

"My grandfather locked this in his iron safe the night the river flooded the northern warehouses," Aparajita whispered, leaning closer so that the scent of wet jasmine and rain-soaked cotton reached Elias across the workbench. "He told my mother that if the key ever turned by itself, we were to bring it to the man who still knew how to read the river tables."

Elias looked from the counter-rotating dial to Aparajita’s rain-bright eyes. "Your grandfather was a careful man, Aparajita. This watch isn't measuring the hour. Look at the inner ring—those aren't numerals. They are soundings of the Hooghly channel."`
        ).map((eng, idx) => ({
          index: idx,
          englishText: eng,
          banglaText: '',
        })),
        status: 'pending',
        currentStage: 0,
        stageCompleted: {
          understanding: true,
          voiceAnalysis: true,
          translation: false,
          editing: false,
          verification: false,
        },
        editorialNotes: [],
        editorialChanges: [],
        verificationReport: null,
        chunkCount: 1,
        completedChunks: 0,
        updatedAt: now,
      },
    ],
  };
}

export async function getAllProjects(): Promise<TranslationProject[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();
      req.onsuccess = async () => {
        const items = (req.result as TranslationProject[]) || [];
        if (items.length === 0) {
          const seeded = createStarterProject();
          await saveProject(seeded);
          resolve([seeded]);
        } else {
          items.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const seeded = createStarterProject();
    return [seeded];
  }
}

export async function saveProject(project: TranslationProject): Promise<void> {
  project.updatedAt = new Date().toISOString();
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.put(project);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Fallback saveProject warning:', err);
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.delete(projectId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Fallback deleteProject warning:', err);
  }
}

export async function getHistoryEntries(): Promise<TranslationHistoryEntry[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as TranslationHistoryEntry[]) || [];
        items.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function addHistoryEntry(entry: TranslationHistoryEntry): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Fallback addHistoryEntry warning:', err);
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.get('user_settings');
      req.onsuccess = () => {
        if (req.result && req.result.settings) {
          resolve({ ...DEFAULT_APP_SETTINGS, ...req.result.settings });
        } else {
          resolve(DEFAULT_APP_SETTINGS);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.put({ id: 'user_settings', settings });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Fallback saveAppSettings warning:', err);
  }
}
