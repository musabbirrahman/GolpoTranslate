# GolpoTranslate — Translation Quality Acceleration Blueprint
## Phase 2B.9: Quality-First Assessment & Improvement Blueprint

**Date:** November 7, 2026  
**Scope:** Read-Only Architectural & Literary Quality Assessment + Actionable Engineering Blueprint  
**Core Objective:** Make GolpoTranslate produce exceptionally accurate, natural, expressive, and publication-quality Bangla literary translations for real Bangla readers as quickly as realistically possible.

---

## 1. Executive Assessment

### Where GolpoTranslate Stands Today
GolpoTranslate has a well-structured five-stage literary translation pipeline (Stage 1 Literary Understanding, Stage 2 Author Voice Profiling, Stage 3 Chunked Literary Translation, Stage 4 Chief Literary Editor Pass, Stage 5 Accuracy Verification) backed by strong state-reconciliation, paragraph-alignment, and deterministic terminology/number checks.

However, **the system's engineering maturity currently exceeds its actual generative translation quality on unseen literary texts.**

A close inspection of the codebase (`/lib/gemini-service.ts`, `/lib/chunker.ts`, `/lib/terminology.ts`, `/components/WorkspaceView.tsx`) and existing benchmark outputs (*The Owing Book* V1 & V2, *The Quiet Key* V1, and *The Clockmaker of Old Calcutta*) reveals three critical truths:

1. **The Auditor Is Currently Smarter Than the Translator and Editor:**  
   In Milestone 2B.8d, Stage 5 (`verifyTranslationAccuracy`) was upgraded to use `gemini-3-flash-preview` (`STAGE5_MODELS` at `lib/gemini-service.ts:62–67`). Meanwhile, **Stages 1, 2, 3, 4, and single-paragraph refinement still default to `gemini-3.1-flash-lite`** (`DEFAULT_MODEL` at `lib/gemini-service.ts:56`). A lightweight model is being asked to perform deep literary comprehension, metaphor adaptation, and Bengali syntactic restructuring—tasks that require front-loaded reasoning capacity.
2. **Previous Quality Gains Relied Heavily on Story-Specific Prompt Patching Rather Than Generalizable Literary Intelligence:**  
   In `lib/gemini-service.ts` (`lines 1483–1509` in Stage 3 and `lines 1747–1759` in Stage 4), dozens of rules are hardcoded around specific phrases from *The Owing Book* and *The Quiet Key* (e.g., `"ten to seven"`, `"too hot to hold"`, `"(Fine.)"`, `"(Not fine. Paid.)"`, `"hemp in a chandlery"`, `"black and bearded pilings"`, `"Water under the bridge"`, `"not a mile and not slow"`, `"ফ্ল্যাট নোট"`). While this made *The Owing Book* V2 read well, it does **not** generalize to new stories—as proven by *The Quiet Key* V1, which suffered severe semantic hallucinations (`"tea towel"` → `"লেমন ড্রিজল মোছার কাপড়"`), factual/numerical corruptions (`88` → `আটত্রিশ/38`, house `number eleven` → `নয় নম্বর বাড়ি`), wrong Bangla proverbs (`"Don't beat about the bush"` → `"না আঁচালে বিশ্বাস নেই"`), antonymic mistranslations (`"unravelling"` → `"জট পাকানো"`), and jarring pronoun switching (`তুই` ↔ `তুমি` ↔ `আপনি`).
3. **Stage 4 (Literary Editing) Is Structurally Underpowered for Long Chapters and Disconnected from Deterministic Checks:**  
   Stage 4 processes the entire chapter in a single monolithic JSON call (`runLiteraryEditingPass`, `lib/gemini-service.ts:1669–1856`) without receiving `storyContext`, without windowed attention, and without pre-feeding deterministic lint findings (such as number mismatches, glossary violations, or pronoun drift) that are already computable in <15ms before Stage 4 runs.

### How Close We Are to Publication-Quality Bangla
- **On patched benchmarks (*The Owing Book* V2):** ~85–88% of publication quality (accurate facts and strong atmosphere, though minor English calques and literal participial chains remain).
- **On unpatched unseen literary fiction (*The Quiet Key* V1):** ~62–68% of publication quality (readable sentence-by-sentence in parts, but disqualified from publication by semantic hallucinations, factual drift, broken idioms, and unstable character address registers).
- **Time/Work Required to Reach True Publication Quality:** Within **2 focused implementation milestones** (starting with **Milestone 2B.9a** specified in Section 11), we can achieve a transformative leap in unseen literary translation quality without adding UI complexity or verification bloat.

---

## 2. Verified Current Translation Architecture

Every stage below is verified directly against the current repository implementation:

| Pipeline Component | Implementation Location | Current Model & Config | Inputs Provided | Outputs Produced | Architectural Strengths | Quality-Limiting Weaknesses |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pre-Processing & Chunking** | `lib/chunker.ts:74–304` (`parseParagraphsWithSceneBreaks`, `chunkTextByParagraphs`) | Deterministic TypeScript | Raw chapter text, `maxWordsPerChunk = 500`, `contextWindow = 2` | `TextChunk[]` preserving paragraph bounds and ornamental/blank scene breaks | Never splits mid-paragraph; preserves `***` / blank-line scene breaks reliably | `maxWordsPerChunk = 500` (~8–14 paragraphs) is good for Stage 3, but `contextWindow = 2` only looks back 2 paragraphs |
| **Stage 1: Literary Understanding** | `lib/gemini-service.ts:1224–1423` (`extractLiteraryUnderstanding`) | `DEFAULT_MODEL = 'gemini-3.1-flash-lite'` (JSON schema mode); slices up to 24,000 chars (`MAX_STAGE1_ANALYSIS_CHARS = 24000`) | Chapter text, `projectTitle`, `genre`, existing `storyContext`, `characters`, `terminology` | `storyContext`, `extractedCharacters` (up to 15), `extractedTerminology` (up to 20), `stage1Coverage` | Reconciles with user locks (`lib/terminology.ts`); extracts characters, places, and recurring objects | 1. Uses `flash-lite` to build the foundational semantic map.<br>2. Does **not** extract a **Speaker-to-Addressee Pronoun/Honorific Matrix** (`তুই`/`তুমি`/`আপনি`).<br>3. Does not extract recurring **symbolic motifs or understated emotional subtext cues**. |
| **Stage 2: Author Voice & Style Profile** | `lib/gemini-service.ts:819–897` (`analyzeAuthorVoice`) | `DEFAULT_MODEL = 'gemini-3.1-flash-lite'` (JSON schema mode); slices first `8,000` chars (`text.slice(0, 8000)`) | First 8,000 chars of chapter, `projectTitle`, `authorName`, `genre`, `customNotes` | 11-field `StyleProfile` (`overallVoice`, `sentenceStructure`, `dialogueStyle`, `banglaAdaptationStrategy`, etc.) | Captures macro-level descriptors; supports user-locked fields | 1. **Generic output:** Produces abstract English prose descriptions (e.g., *"Use evocative Bangla"*) rather than concrete **Bangla syntactic, verb-cadence, and lexical register exemplars**.<br>2. Samples only the first 8,000 characters, missing late-chapter tonal shifts. |
| **Stage 3: Faithful Literary Translation** | `lib/gemini-service.ts:1429–1663` (`translateChunkFaithfully`), orchestrated in `components/WorkspaceView.tsx:1113–2132` | `DEFAULT_MODEL = 'gemini-3.1-flash-lite'` (JSON schema mode) | `paragraphs` (chunk), `previousContextParagraphs` (2 preceding En+Bn pairs), `styleProfile`, partial `storyContext`, `characters`, `terminology`, `styleControls` | `translatedParagraphs: string[]` (1:1 aligned), `discoveredTerms` | Strict 1:1 paragraph alignment; preserves Markdown `*italics*`; grounds discovered glossary terms | 1. Runs on `flash-lite`.<br>2. Drops `storyContext.narrativeTimeline`, `importantEvents`, and `locations` (`lines 1459–1461`).<br>3. Only 2 paragraphs of prior Bangla context → loses speaker pronoun consistency across longer gaps.<br>4. Cluttered with 30+ lines of story-specific patches (`lines 1483–1509`) instead of generalizable literary translation principles. |
| **Stage 4: Literary Editing Pass** | `lib/gemini-service.ts:1669–1856` (`runLiteraryEditingPass`), orchestrated in `components/WorkspaceView.tsx:2135–2462` | `DEFAULT_MODEL = 'gemini-3.1-flash-lite'` (JSON schema mode) | Full-chapter `englishParagraphs[]`, `banglaParagraphs[]`, `styleProfile`, `characters`, `terminology`, `styleControls` | Full-chapter `editedParagraphs[]`, `editorialNotes[]`, `editorialChanges[]` | Preserves 1:1 paragraph count; records before/after rationale | 1. **Full-chapter single-shot bottleneck:** Sends all 40–60 En+Bn paragraph pairs in one call to `flash-lite`, causing attention dilution and shallow edits in mid/late paragraphs.<br>2. **Missing `storyContext`:** `runLiteraryEditingPass` does not receive `storyContext` at all.<br>3. **No pre-Stage-4 deterministic lint injection:** Does not receive deterministic number/glossary/pronoun warnings to fix automatically during editing. |
| **Stage 5: Accuracy Verification** | `lib/gemini-service.ts:2285–2698` (`verifyTranslationAccuracy`) + `lib/terminology.ts` (`lintParagraphsAgainstGlossary`, `lintParagraphsForNumericalFidelity`) | `STAGE5_MODELS = ['gemini-3-flash-preview', ...]` + 12-paragraph windowed auditing | Full-chapter `englishParagraphs[]`, `banglaParagraphs[]`, `characters`, `terminology` | `VerificationReport` (`overallScore`, `isComplete`, `issues[]`) | Uses stronger model (`gemini-3-flash-preview`), 12-paragraph windows, and deterministic number/glossary lint | Purely diagnostic post-hoc check; does not feed back into Stage 4 automatically, and evaluates accuracy rather than native Bangla literary flow. |
| **Paragraph Studio Refinement** | `lib/gemini-service.ts:2703–2791` (`refineSingleParagraph`) | `DEFAULT_MODEL = 'gemini-3.1-flash-lite'` | Target En+Bn paragraph, 1 preceding En paragraph, 1 following En paragraph, `styleProfile`, `characters`, `terminology`, `styleControls` | `refinedBangla`, `rationale` | 6 targeted editorial actions (`more_natural`, `improve_literary`, `conversational_dialogue`, etc.) | Does **not** pass preceding/following **Bangla** paragraphs (`lines 2750–2752` pass only English surrounding context), risking register/pronoun mismatch with neighboring Bangla sentences. |

---

## 3. Translation Quality Weaknesses Ranked by Impact

Based on direct inspection of the benchmark translations and prompt architecture, here are the core weaknesses ranked by their impact on a real Bangla literary reader:

| Rank | Weakness Category | Impact on Real Bangla Readers | Severity | Frequency in Unpatched Runs |
| :---: | :--- | :--- | :---: | :---: |
| **1** | **Cross-Paragraph Context Contamination & Concrete Object/Number Hallucination** | Destroys reader trust and narrative logic (e.g., a plain tea towel inside a piano becomes a "lemon-drizzle wiping cloth" three paragraphs before the neighbour with the lemon-drizzle cake even knocks on the door; ages and house numbers flip). | **Critical** | High on `flash-lite` |
| **2** | **Idiom, Metaphor, and Irony Distortion (False Equivalences & Literal Calques)** | Turns sharp literary wit or poignant sensory imagery into baffling or opposite Bangla meanings (e.g., *"Don't beat about the bush"* → *"না আঁচালে বিশ্বাস নেই"*; *"dry unravelling"* → *"শুকনো, জট পাকানো"* [tangled]; *"wet through to the bones of the week"* → abstract *"সারা সপ্তাহের ক্লান্তি"*). | **Critical** | High |
| **3** | **Unstable Speaker-to-Addressee Pronoun & Honorific Register (`তুই` / `তুমি` / `আপনি`)** | Immediately breaks character authenticity for native Bangla readers when a grandmother switches from `তুই` (P2, P9) to `তুমি` (P12, P14, P24, P45) with the same grandson, or a grandson switches from `আপনি` (P3, P10) to `তুমি` (P27) with his grandmother. | **High** | Very High |
| **4** | **English-Transferred Syntax & Participial Clause Chains ("অনুবাদ-গন্ধ" / Translationese)** | Makes prose feel translated rather than composed in Bangla—specifically: overuse of passive-like estructuras, awkward relative clauses (`যেটি কিনা`, `যেখানে সে জানত ওটা আছে, যদিও সে জানত না যে সে আসলে জানত`), and stiff English-ordered adverbials. | **High** | Moderate–High |
| **5** | **Flattening of Authorial Subtext, Restraint, and Interiority** | Over-explains or flattens understated literary moments (e.g., turning Odile's quiet grief *"I wasn't having that note going about the house saying supper to an empty garden"* into a flat literal statement, or losing the dry coastal cadence of Ostley Reach). | **Medium–High** | Moderate |
| **6** | **Mid-to-Late Chapter Editorial Fatigue in Stage 4** | Because Stage 4 edits 45–55 paragraphs in a single prompt call on `flash-lite`, paragraphs 1–10 receive active stylistic polish while paragraphs 25–54 often pass through nearly unchanged or retain awkward Stage 3 phrasing. | **Medium** | High on chapters >25 paragraphs |

---

## 4. Concrete Evidence from Existing Benchmark Materials

Every example below is taken directly from the repository's benchmark artifacts (`the-owing-book-bilingual_c26528f8.txt`, `the-owing-book-bilingual-v2.txt`, `the-quiet-key-bilingual_b6d8786f.txt`, and `lib/storage.ts`).

### 4.1 Semantic Fidelity, Numbers, and Concrete Detail Errors

| Benchmark & Location | Original English | Actual GolpoTranslate Bangla Output | Why It Fails for a Bangla Reader |
| :--- | :--- | :--- | :--- |
| ***The Quiet Key* V1 — P14, P18, P23, P31** (`the-quiet-key-bilingual_b6d8786f.txt:138, 146, 156, 168`) | *"wrapped around the shank in a neat, ancient spiral, was a strip of linen torn from an old tea towel."* | *"হাতলের চারপাশে নিখুঁত, প্রাচীন প্যাঁচে জড়ানো ছিল পুরনো **লেমন ড্রিজল মোছার কাপড়** থেকে ছেঁড়া লিনেনের একটি ফালি।"* | **Severe cross-paragraph hallucination:** Pru Lindqvist brings a *"lemon drizzle"* cake in P17 (`line 47`). Stage 3/4 contaminated `"tea towel"` (একটি পুরনো চা-তোয়ালে / বাসন মোছার সুতির কাপড়) with `"লেমন ড্রিজল মোছার কাপড়"` across four separate paragraphs! |
| ***The Quiet Key* V1 — P2** (`line 108`) | *"Odile had lived in the house for **eighty-eight** years..."* | *"ওডিল এই বাড়িতে **আটত্রিশ** বছরে বসবাস করছেন..."* | **Factual/numerical corruption + grammar defect:** `88` (আটাশি) became `38` (আটত্রিশ), destroying the central parallel between Odile's 88 years and the piano's 88 keys. Also `"আটত্রিশ বছরে বসবাস করছেন"` is ungrammatical for duration (`আটাশি বছর ধরে বসবাস করছেন`). |
| ***The Quiet Key* V1 — P17** (`line 144`) | *"It was Pru Lindqvist from **number eleven**, carrying a tin"* | *"তিনি ছিলেন **নয় নম্বর বাড়ি** থেকে আসা প্রু লিন্ডকভিস্ট, হাতে একটা টিনের কৌটো"* | **Spatial/factual confusion:** Odile lives at number 9 (P7); Pru is the neighbour from number 11. The model conflated the two addresses. |
| ***The Quiet Key* V1 — P35** (`line 176`) | *"it came away in one dry **unravelling**"* | *"কাপড়টা এক টানে বেরিয়ে এল, শুকনো, **জট পাকানো**"* | **Antonymic mistranslation:** `"unravelling"` means unwinding/coming undone (`প্যাঁচ খুলে বেরিয়ে এল`), whereas `"জট পাকানো"` means knotted/tangled—the exact opposite physical action. |
| ***The Owing Book* V1 — P15** (`the-owing-book-bilingual_c26528f8.txt:143`) | *"`Mrs. Pell: one umbrella, black, lent the fourteenth of October. Returned: no.` And beside it... `(Fine.)`"* | *"`...ফেরত: না।` আর তার পাশে... `(জরিমানা।)`"* | **Polysemy error:** Translated `"(Fine.)"` (meaning *Alright / No problem / থাক, ঠিক আছে*) as `"(জরিমানা।)"` (financial penalty), contradicting the very thesis of the story (`"It did not hold money"`). (Patched via hardcoded prompt rule in V2). |
| ***The Owing Book* V1 — P46** (`line 209`) | *"hammered out over the water again and again, with all the **tact** of a fist on a table"* | *"টেবিলের ওপর ঘুষি মারার মতো **বেকুবী** নিয়ে বারবার জলের ওপর আছড়ে পড়ছে"* | **Irony/Register distortion:** `"with all the tact of a fist on a table"` is dry British irony (`টেবিলে ঘুষি মারার মতোই রূঢ় ও রাখঢাকহীনভাবে`), not `"বেকুবী"` (stupidity/idiocy). |

### 4.2 Idioms, Metaphors, and Sensory Imagery

| Benchmark & Location | Original English | Actual GolpoTranslate Bangla Output | Better Literary Bangla Direction |
| :--- | :--- | :--- | :--- |
| ***The Quiet Key* V1 — P24** (`line 158`) | *"**Don't beat about the bush**, boy. Your face is doing the thing it did when you broke the greenhouse."* | *"**না আঁচালে বিশ্বাস নেই**, ছেলে। তোমার মুখটা ঠিক তেমনই দেখাচ্ছে যেমনটা গ্রিনহাউস ভাঙার পর দেখিয়েছিল।"* | **Wrong Bangla proverb:** `"না আঁচালে বিশ্বাস নেই"` means *don't count your chickens before they hatch*. For `"Don't beat about the bush"`, natural spoken Bangla is `"ভণিতা ছাড়ো তো, বাছা"` or `"কথা ঘোরাস না তো, খোকা"`. |
| ***The Quiet Key* V1 — P2** (`line 108`) | *"who had taken the train down from London with his canvas roll of tools and his cuffs **wet through to the bones of the week**."* | *"...যার হাতার কাফগুলো ভিজে গিয়েছিল, যখন **সারা সপ্তাহের ক্লান্তি হাড়ে হাড়ে অনুভূত হচ্ছে**।"* | **Lost sensory metaphor:** The original is acompressed poetic image of cold March rain soaking so deep into his coat cuffs that the whole week feels chilled to the bone (`মার্চের হিম বৃষ্টির ভেজা ভাব যেন তার আস্তিন পেরিয়ে গোটা সপ্তাহের হাড়ের মজ্জায় ঢুকে পড়েছে`), not generic work fatigue. |
| ***The Quiet Key* V1 — P11** (`line 126`) | *"Beyond the glass the garden was **streaming, grey on grey**."* | *"কাঁচের ওপাশে বাগানটা **ঝাপসা হয়ে মিশে যাচ্ছিল ধূসর রঙের সাথে**।"` | **Sensory erasure:** `"streaming"` depicts rainwater coursing down the windowpane and garden (`কাঁচের ওপাশে অঝোর জলে ভেসে যাচ্ছে বাগান—ধূসরের ওপর কেবলই ধূসর`), whereas `"ঝাপসা"` reduces rain-drenched movement to static blurriness. |
| ***The Owing Book* V1 — P12** (`line 137`) & **V2 — P12** (`line 139`) | *"She **bit the bullet** and opened it."* | V1: *"সে **দাঁতে দাঁত চেপে** খাতাটা খুলল।"*<br>V2: *"ইনেস **দীর্ঘশ্বাস ফেলে সাহস সঞ্চয় করল** এবং খাতাটা খুলল।"* | V1's `"দাঁতে দাঁত চেপে"` (gritting one's teeth in physical pain/endurance) is too melodramatic for opening a ledger; V2's `"দীর্ঘশ্বাস ফেলে সাহস সঞ্চয় করল"` adds an invented sigh (`দীর্ঘশ্বাস`) and reads slightly explanatory. Better understated Bangla: `"শেষমেশ দ্বিধা ঝেড়ে সে খাতাটা খুলল"` or `"মনটাকে শক্ত করে সে খাতাটা খুলল"`. |

### 4.3 Pronoun, Honorific, and Character Voice Consistency (`তুই` / `তুমি` / `আপনি`)

In Bangla literature, interpersonal relationships are anchored in the 2nd-person pronoun system (`তুই` + `-ইস/-আস/-বি`, `তুমি` + `-ও/-বে/-ছ`, `আপনি` + `-ন/-বেন/-ছেন`). Switching between them mid-scene between the same two speakers—without a dramatic plot trigger—immediately signals machine translation to a native reader.

**Verified Failure in *The Quiet Key* V1 (`the-quiet-key-bilingual_b6d8786f.txt`):**
- **Odile (Grandmother) speaking to Corin (Grandson):**
  - **P2 (`line 108`):** `"যদি এই মার্চে আসিস, তবে পিয়ানোটা টিউন করে দিয়ে যাস।"` → Uses **`তুই`** (`আসিস`, `যাস`).
  - **P9 (`line 122`):** `"তুই রোগা হয়ে গেছিস,"* → Uses **`তুই`** (`তুই`, `গেছিস`).
  - **P12 (`line 128`):** `"ওটা সরাও না, নইলে এক্ষুনি ভেঙে পড়বে।"` → Suddenly switches to **`তুমি`** (`সরাও`)!
  - **P14 (`line 138`):** `"এই নোটটা বাদ দিয়ে বাকিগুলো টিউন করো,"` → Uses **`তুমি`** (`করো`)!
  - **P24 (`line 158`):** `"বলে ফেলো... তোমার মুখটা"` → Uses **`তুমি`** (`ফেলো`, `তোমার`)!
  - **P26 (`line 160`):** `"এটা তোমার দাদুর কীর্তি"` → Uses **`তুমি`** (`তোমার`)!
  - **P45 (`line 196`):** `"নরম মনের হয়ো না, করিন। কেকটা কাটো।"` → Uses **`তুমি`** (`হয়ো না`, `কাটো`)!
- **Corin (Grandson) speaking to Odile (Grandmother):**
  - **P3 (`line 110`):** `"আপনিই তো বলেছিলেন ওটা করে দিতে"` → Uses **`আপনি`** (`আপনিই`, `বলেছিলেন`).
  - **P10 (`line 124`):** `"আপনি তো বড়দিনের সময়ও একই কথা বলেছিলেন।"` → Uses **`আপনি`** (`আপনি`, `বলেছিলেন`).
  - **P27 (`line 162`):** `"আর তুমি চলে আসতে।"` → Suddenly switches to **`তুমি`** (`তুমি`, `আসতে`)! (And in Bengali family culture, a grandson who is addressed as `তুই/তুমি` by his grandmother almost universally addresses her as affectionate `তুমি`, not formal `আপনি`, unless the family is explicitly aristocratic—and even then, never switches randomly between `আপনি` and `তুমি`).

**Verified Failure in *The Owing Book* V1 (`the-owing-book-bilingual_c26528f8.txt`):**
- **Tobiah Quill speaking to Ines:**
  - **P4 (`line 121`):** `"তুমি নিশ্চয়ই সেই খাতাটা খুঁজছ।"` → Uses **`তুমি`**.
  - **P9 (`line 131`):** `"কেউ আপনাকে বাধা দিচ্ছে না, মিস ইনেস।"` → Switches to **`আপনি`** five paragraphs later!

### 4.4 English Syntax Residue ("Translationese") vs. Natural Bangla Cadence

Even in *The Owing Book* V2 (`the-owing-book-bilingual-v2.txt`), where factual errors were patched, English clause structure still leaks into Bangla:
- **P11 (`line 137`):**  
  *English:* `"It was under the counter, where she had known it would be without having known she knew"`  
  *V2 Bangla:* `"খাতাটা কাউন্টারের নিচে ছিল, ঠিক যেখানে সে জানত ওটা আছে, যদিও সে জানত না যে সে আসলে জানত।"`  
  *Critique:* Triple nested `যেখানে সে জানত... যদিও সে জানত না যে সে আসলে জানত` is a word-for-word syntactic mirror of English auxiliary verb ellipsis. In natural literary Bangla: `"কাউন্টারের নিচেই ছিল খাতাটা—এখানেই যে ওটা থাকবে, তা যেন নিজের অজান্তেই তার জানা ছিল।"`
- **P2 (`line 117`):**  
  *English:* `"Coils of rope hung from the beams like the sleeping bodies of enormous bats."`  
  *V2 Bangla:* `"বিশাল বাদুড়ের মতো ঝুলে থাকা দড়ির কুণ্ডলীগুলো বিম থেকে ঝুলে ছিল।"`  
  *Critique:* Redundant `"ঝুলে থাকা ... ঝুলে ছিল"` and omission of `"sleeping bodies"` (`ঘুমন্ত দেহের মতো`). Natural literary Bangla: `"কড়িকাঠ থেকে দড়ির কুণ্ডলীগুলো বিশাল সব ঘুমন্ত বাদুড়ের মতো ঝুলছিল।"`
- **P26 (`line 165`):**  
  *English:* `"and the door, which liked him, let him out without a fight."`  
  *V2 Bangla:* `"আর দরজাটি, যে কিনা তাকে পছন্দই করত, কোনো বাধা ছাড়াই তাকে বেরিয়ে যেতে দিল।"`  
  *Critique:* `"যে কিনা"` for non-restrictive relative clauses personifying objects sounds clunky and calqued in modern literary Bangla. Better: `"আর দরজাটাও—টোবিয়াকে সে বরাবরই পছন্দ করত—বিনা বাধায় তাকে বেরিয়ে যেতে দিল।"`

---

## 5. Root-Cause Analysis

Why do these specific defects happen in the current pipeline? Every symptom maps to a verifiable architectural or prompt-level root cause:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 1: Model Tier Asymmetry (`gemini-3.1-flash-lite` in Stages 1–4) │
│   lib/gemini-service.ts:56 (`DEFAULT_MODEL = 'gemini-3.1-flash-lite'`)     │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
  • Shallow metaphor/idiom decoding ("Don't beat about the bush" → wrong proverb;
    "unravelling" → "জট পাকানো").
  • Cross-paragraph token bleeding ("tea towel" + later "lemon drizzle" →
    "লেমন ড্রিজল মোছার কাপড়").
  • Factual/number slips during generation ("eighty-eight" → "আটত্রিশ").

┌────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 2: Missing Relational Pronoun Matrix in Stage 1 & Memory Block  │
│   lib/gemini-service.ts:1330–1356 & lib/chunker.ts:1263–1288               │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        ▼
  • `CharacterMemoryItem.pronouns` stores a single string per character
    (e.g., "তিনি" or "তুমি/তুই"), NOT directed speaker-pair rules (A → B vs B → A).
  • Stage 3 only sees 2 preceding paragraphs of Bangla context (`contextWindow = 2`),
    so when a dialogue resumes 6 paragraphs later, the model guesses the pronoun
    afresh (`তুই` in P9 → `তুমি` in P12).

┌────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 3: Overfitted Story Micro-Patches in Stage 3 & Stage 4 Prompts  │
│   lib/gemini-service.ts:1483–1509 & 1747–1759                              │
└───────────────────────────────────────┬────────────────────────────────────┘
  • 35+ lines of Stage 3/4 prompt budget are consumed by examples from
    *The Owing Book* ("ten to seven", "chandlery", "Water under the bridge")
    rather than generalizable Bengali syntax restructuring rules (how to break
    English relative clauses, how to avoid "যে কিনা", how to render English
    understatement, how to handle English idioms not in Bangla).

┌────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 4: Monolithic Unwindowed Stage 4 Pass Without Lint Pre-Feed     │
│   lib/gemini-service.ts:1669–1856 (`runLiteraryEditingPass`)               │
└───────────────────────────────────────┬────────────────────────────────────┘
  • Sends all 50+ paragraphs of a chapter in one prompt without `storyContext`.
  • Model attention degrades after ~15 paragraphs.
  • Deterministic number/glossary checks (`lintParagraphsForNumericalFidelity`,
    `lintParagraphsAgainstGlossary`) only run in Stage 5 *after* Stage 4 is done,
    missing the opportunity for Stage 4 to self-correct deterministic slips!
```

---

## 6. Proposed Quality Evaluation Framework

To prevent the trap where a translation passes Stage 5 (`overallScore: 95+`) while reading like awkward translationese, we propose a **7-Dimension Non-Compensatory Quality Evaluation Framework**.

### 6.1 The 7 Quality Dimensions

| # | Dimension | What It Evaluates | Evaluation Mechanism | Minimum Publication Threshold |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Semantic Fidelity** | Zero fabricated objects, zero inverted meanings, accurate concrete actions, spatial relationships, numbers, ages, and dates. | **Deterministic** (`lintParagraphsForNumericalFidelity` + glossary lint) + **Stage 5 Windowed AI Audit** | **Hard Gate:** `0` unresolved High-severity semantic/numerical issues. |
| **2** | **Completeness** | 1:1 paragraph alignment, zero omitted sentences or dropped clauses/dialogue turns, preserved scene breaks and italics. | **Deterministic** (`getPipelineCompletionState`, paragraph/sentence ratio check, scene-break parity) + **Stage 5** | **Hard Gate:** `100%` paragraph coverage; `0` omitted sentences. |
| **3** | **Naturalness of Bangla** | Native Bangla clause ordering, absence of English calques (`যে কিনা`, `একটি` overuse, doubled verbs like `ঝুলে থাকা... ঝুলে ছিল`), smooth postpositional flow. | **Deterministic Heuristic Signals** (calque/redundancy regex flags) + **Targeted Literary Rubric Check** | **Hard Gate:** `>= 4.2 / 5.0` on Naturalness Rubric; zero severe calques. |
| **4** | **Literary Quality** | Rhythm, cadence, sensory precision, figurative power, and emotional resonance appropriate to the genre. | **Targeted Literary Rubric Check + Human Side-by-Side Review on Benchmark Passages** | `>= 4.0 / 5.0` on Literary Expression Rubric. |
| **5** | **Author-Voice Preservation** | Preservation of the author's sentence-length contrast (e.g., short dry sentences vs. long atmospheric sentences), irony, restraint, and POV distance. | **Sentence-Cadence Variance Check + Literary Rubric Check** | `>= 4.0 / 5.0` on Author Voice Rubric; short punchy source paragraphs (`<= 8` words) must not be inflated into verbose 20-word explanations. |
| **6** | **Contextual Consistency** | Locked speaker-pair pronouns (`তুই`/`তুমি`/`আপনি` + matching verb inflections), consistent character names, and recurring motif terms across chunks. | **Deterministic Pronoun/Verb Agreement & Glossary Linter** + **Cross-Window Check** | **Hard Gate:** `0` unmotivated pronoun/honorific switches within any speaker dyad; `0` locked glossary violations. |
| **7** | **Language Correctness** | Accurate Bangla spelling, matra/conjunct orthography (NFC normalized), punctuation (`।` vs `.`), case markers (`-কে`, `-র`, `-তে`), and verb conjugation. | **Deterministic Bangla Orthography & Punctuation Check** (`normalizeBanglaUnicode`, ASCII period check, verb-pronoun agreement) | **Hard Gate:** `0` grammatical/conjugation errors or stray English punctuation in Bangla prose. |

### 6.2 Non-Compensatory Policy
- **Fluency Never Excuses Inaccuracy:** A poetic Bangla sentence that changes `88 years` to `38 years` or invents `"লেমন ড্রিজল মোছার কাপড়"` **automatically fails** (Dimension 1 Hard Gate).
- **Accuracy Never Excuses Mechanical Bangla:** A 100% factually accurate translation that translates `"where she had known it would be without having known she knew"` as `"যেখানে সে জানত ওটা আছে, যদিও সে জানত না যে সে আসলে জানত"` or switches a grandmother between `তুই` and `তুমি` **cannot be rated Publication-Ready** (Dimensions 3 & 6 Hard Gates).

---

## 7. Recommended Benchmark Set

We should evaluate every pipeline improvement against a **fixed, diverse 5-text benchmark suite** already present in the repository so we measure real generalization rather than overfitting to one story:

| Benchmark ID | Title & Source Location | Length | Literary Genre & Style | Primary Stress-Test Dimensions |
| :--- | :--- | :--- | :--- | :--- |
| **BM-1 (Primary Long Benchmark A)** | ***The Owing Book*** (`/public/assets/aistudio/the-owing-book-bilingual_c26528f8.txt` source) | 54 paragraphs (~2,150 words; 5 chunks) | Coastal contemporary literary fiction; dry understatement, ledger fragments, idioms (*bit the bullet*, *water under the bridge*, *trim his lamp*), polysemy (*(Fine.)*, *tact*). | Understatement preservation, polysemy, ledger formatting, multi-chunk continuity, environmental imagery. |
| **BM-2 (Primary Long Benchmark B — Unpatched Generalization Test)** | ***The Quiet Key*** (`/public/assets/aistudio/the-quiet-key-bilingual_b6d8786f.txt` source) | 47 paragraphs (~1,650 words; 4 chunks) | Intimate domestic literary fiction; grandmother–grandson–neighbour triangle, dense numerical/spatial facts (`88 years`, `number nine`, `number eleven`, `87/88 notes`, `flat F`), British idioms (*beat about the bush*, *wet through to the bones of the week*). | **Cross-paragraph hallucination prevention**, **interpersonal pronoun stability (`তুই`/`তুমি`/`আপনি`)**, numerical fidelity, acoustic/musical terminology, emotional restraint. |
| **BM-3 (Historical/Atmospheric Benchmark)** | ***The Clockmaker of Old Calcutta — Ch. 1 & Ch. 2*** (`lib/storage.ts:52–96` & `lib/sample-passages.ts:13–36`) | Ch 1: 5 paragraphs; Ch 2: 4 paragraphs | Historical literary fiction set in 19th-century Chitpur/Hooghly; sensory horological imagery, rain, memory, classical Bengali cultural resonance. | Rich evocative literary diction (`সাহিত্যিক মাধুর্য`), sensory cadence, cross-chapter character & glossary continuity (`হরিপদ বাবু`, `পদ্মাপ্রহর`). |
| **BM-4 (Suspense/Atmospheric Benchmark)** | ***Signal in the Pine Barrens*** (`lib/sample-passages.ts:39–63`) | 6 paragraphs (~380 words) | Atmospheric thriller / mystery; technical radio terms (*carrier wave*, *vacuum tubes*), tense pacing, terse dialogue. | Pacing preservation, suspense cadence, technical-in-literary terminology adaptation without awkward transliteration. |
| **BM-5 (Intimate Epistolary / Contemporary Romance)** | ***Letters Left in the Bookshop*** (`lib/sample-passages.ts:91–114`) | 6 paragraphs (~390 words) | Contemporary emotional fiction set in College Street; handwritten marginalia, unspoken affection, warm conversational dialogue. | Subtle emotional interiority, natural spoken Kolkata/standard literary dialogue, italicized letter fragments. |

---

## 8. Prioritized Improvement Opportunities

Every opportunity below is evaluated strictly by our decision principle:  
> *"Will this make the Bangla translation noticeably more accurate, natural, expressive, and faithful to the original for a real Bangla reader?"*

### Priority 1 (P0 — Highest Immediate Quality Gain): Upgrade Stage 1–4 & Refinement Default Model Tier to `gemini-3-flash-preview`
- **Problem:** Stages 1, 2, 3, 4, and Paragraph Refinement currently run on `gemini-3.1-flash-lite` (`lib/gemini-service.ts:56`), while only Stage 5 uses `gemini-3-flash-preview`.
- **Why It Matters for Real Bangla Readers:** `gemini-3.1-flash-lite` is the primary source of cross-paragraph token bleeding (`"লেমন ড্রিজল মোছার কাপড়"`), literal English syntax calques, and wrong Bangla idioms (`"না আঁচালে বিশ্বাস নেই"`). Upgrading the generative stages (especially Stages 3 and 4, and ideally 1–4) to `gemini-3-flash-preview` immediately elevates lexical richness, syntactic restructuring, and contextual reasoning.
- **Pipeline Component Affected:** `lib/gemini-service.ts` (`DEFAULT_MODEL` / stage model arrays).
- **Expected Quality Gain:** **Very High (+20–30% reduction in semantic/idiom errors and immediate improvement in native Bangla sentence flow).**
- **Implementation Complexity:** **Very Low** (config constant update + fallback preservation).
- **Regression Risk:** **Low** (existing schema validation, retry logic, and fallback array remain intact).
- **How Improvement Will Be Measured:** Zero hallucinations on *The Quiet Key* (`tea towel`, `88 years`, `number eleven`) and side-by-side comparison of raw Stage 3/4 output on BM-1 and BM-2.

### Priority 2 (P0 — High Impact on Character Voice): Dyadic Pronoun & Honorific Lock across Stage 1 → Stage 3 → Stage 4
- **Problem:** Characters switch randomly between `তুই`, `তুমি`, and `আপনি` across paragraphs and chunks (e.g., Odile → Corin switching `তুই` to `তুমি` in P12 of *The Quiet Key*; Corin → Odile switching `আপনি` to `তুমি` in P27; Tobiah → Ines switching `তুমি` to `আপনি` in P9 of *The Owing Book* V1).
- **Why It Matters for Real Bangla Readers:** Nothing destroys the illusion of authentic Bangla fiction faster than a grandmother or colleague changing their address pronoun mid-conversation.
- **Pipeline Component Affected:**
  1. **Stage 1 (`extractLiteraryUnderstanding`):** Require `CharacterMemoryItem.pronouns` and `relationships` (or a structured section in `speakingStyle`) to explicitly state:
     - Third-person narrative pronoun (`সে` vs honorific `তিনি` + verb agreement), AND
     - **Directed 2nd-person address rules** for every key conversational pair in the story (e.g., `Odile → Corin: তুই (বা ঘনিষ্ঠ তুমি — পুরো গল্পে অপরিবর্তনীয়); Corin → Odile: তুমি`).
  2. **Stage 3 (`translateChunkFaithfully`):** Increase `contextWindow` from `2` to `4` paragraphs in `WorkspaceView.tsx` / `chunker.ts`, AND include a compact **Dialogue Address & Pronoun Continuity Rule** in the prompt.
  3. **Stage 4 (`runLiteraryEditingPass`):** Explicitly task the Chief Editor with auditing and normalizing 2nd-person pronouns (`তুই/তুমি/আপনি`) and their corresponding verb endings across all dialogue turns between the same two speakers.
- **Expected Quality Gain:** **Very High** (eliminates the #1 dialogue naturalness defect in Bangla fiction).
- **Implementation Complexity:** **Low–Medium** (prompt & context-window refinement; no breaking schema changes required if encoded in existing `CharacterMemoryItem` fields + prompt formatter).
- **Regression Risk:** **Low** (fully backward-compatible with existing stored projects).
- **How Improvement Will Be Measured:** 100% pronoun consistency across all dialogue turns in *The Quiet Key* (Odile↔Corin, Odile↔Pru) and *The Owing Book* (Ines↔Tobiah, Ines↔Dessa).

### Priority 3 (P0 — High Impact on Prose Naturalness & Generalization): Replace Story-Specific Prompt Patches with Generalizable Bengali Literary Craft Directives in Stages 3 & 4
- **Problem:** Stage 3 (`lines 1483–1509`) and Stage 4 (`lines 1747–1759`) contain 35+ lines of hardcoded micro-instructions for phrases from *The Owing Book* (`"ten to seven"`, `"chandlery"`, `"Water under the bridge"`, etc.), while lacking systematic rules for Bengali syntactic transformation and figurative adaptation on unseen stories.
- **Why It Matters for Real Bangla Readers:** Prompt bloat dilutes model attention on general craft rules. Replacing story-specific patches with **concrete structural transformation principles** teaches the model *how* to write natural literary Bangla on any manuscript:
  1. **Clause Restructuring over Calquing:** Break English post-nominal relative clauses (`"the door, which liked him"` / `"where she had known it would be without having known she knew"`) into natural Bangla participial, em-dash, or pre-nominal clauses—never calqued `"যে কিনা"` or triple `"যেখানে সে জানত... যে সে জানত"`.
  2. **Idiom & Proverb Discipline:** Never substitute a famous Bangla proverb with a different logical meaning (e.g., never use `"না আঁচালে বিশ্বাস নেই"` for `"Don't beat about the bush"`). Translate idioms by capturing their exact pragmatic intent in idiomatic spoken Bangla (`"ভণিতা ছাড়ো"` / `"কথা ঘোরাস না"`).
  3. **Zero Cross-Paragraph Contamination:** Translate every physical object strictly from the current sentence's nouns (`"tea towel"` = `"চা-তোয়ালে / বাসন মোছার সুতির তোয়ালে"`), never borrowing modifiers from nearby paragraphs (`"লেমন ড্রিজল"`).
  4. **Verb Echo & Redundancy Elimination:** Avoid repeating the same participle and finite verb root in one sentence (`"ঝুলে থাকা... ঝুলে ছিল"` → `"ঝুলছিল"`), and avoid translating English indefinite `"a/an"` as `"একটি/একজন"` unless singularity is emphasized.
  5. **Rhythmic & Length Fidelity for Understatement:** When the author writes a 4-word paragraph (`"It did not hold money."` / `"And then the sea did nothing."`), keep the Bangla equally terse and resonant (`"ওতে টাকার কোনো হিসেব ছিল না।"` / `"তারপর সমুদ্র আর কিছুই করল না।"`).
- **Pipeline Component Affected:** `lib/gemini-service.ts` (Stage 3 and Stage 4 prompts).
- **Expected Quality Gain:** **Very High** (transforms unseen story translation quality while keeping *The Owing Book* at or above V2 quality).
- **Implementation Complexity:** **Low** (prompt engineering in `lib/gemini-service.ts`).
- **Regression Risk:** **Low–Medium** (must verify that *The Owing Book* and *The Quiet Key* both pass all semantic checks without hardcoded phrase crutches).
- **How Improvement Will Be Measured:** Re-running BM-1 (*The Owing Book*) and BM-2 (*The Quiet Key*) without story-specific phrase crutches and verifying both semantic accuracy and natural Bangla prose.

### Priority 4 (P1 — High Impact on Long Chapters): Windowed Stage 4 Literary Editing with Pre-Injected Deterministic Lint & Story Context
- **Problem:**
  1. `runLiteraryEditingPass` (`lib/gemini-service.ts:1669`) sends all paragraphs of a chapter (e.g., 54 En+Bn pairs in *The Owing Book*) in one giant prompt and does not receive `storyContext`.
  2. Deterministic lint (`lintParagraphsAgainstGlossary` and `lintParagraphsForNumericalFidelity`) is currently only run in Stage 5 *after* Stage 4 completes—meaning Stage 4 never gets told *"Warning: Paragraph 2 has a number mismatch (`eighty-eight` vs `আটত্রিশ`) and Paragraph 17 has (`eleven` vs `নয়`); fix these while editing!"*
- **Why It Matters for Real Bangla Readers:**
  - Windowing Stage 4 into **12–15 paragraph editorial windows** (with 2 preceding edited Bangla paragraphs passed as read-only continuity context) gives the Chief Editor focused attention on every single paragraph from P1 to P54.
  - Running the existing fast (<10ms) deterministic number and glossary linters *before* each Stage 4 window and injecting any detected discrepancies directly into the Stage 4 prompt allows **Stage 4 to automatically heal deterministic number/glossary slips during the editing pass**, before the user ever reaches Stage 5!
- **Pipeline Component Affected:** `lib/gemini-service.ts` (`runLiteraryEditingPass`), `app/api/translate/route.ts`, `components/WorkspaceView.tsx` (`executeStage4`).
- **Expected Quality Gain:** **High** (uniform editorial polish across long chapters + automatic self-healing of numerical and glossary slips during Stage 4).
- **Implementation Complexity:** **Medium** (windowing loop inside `runLiteraryEditingPass` similar to Stage 5's existing `splitParagraphsIntoStage5Windows` + passing `storyContext` and deterministic lint hints).
- **Regression Risk:** **Low** (`runLiteraryEditingPass` return signature `{ editedParagraphs, editorialNotes, editorialChanges }` stays 100% identical to callers).
- **How Improvement Will Be Measured:** Compare edit density and prose quality in paragraphs 25–54 of *The Owing Book* and *The Quiet Key*, plus zero surviving number/glossary errors exiting Stage 4.

### Priority 5 (P1 — Medium–High Impact on Author Voice): Concrete Bangla Exemplars in Stage 2 Style Profile & Bilingual Context in Paragraph Refinement
- **Problem:**
  1. Stage 2 (`analyzeAuthorVoice`, `lib/gemini-service.ts:819–897`) outputs abstract English descriptions rather than concrete Bangla lexical/syntactic guidance, and only inspects the first 8,000 characters.
  2. `refineSingleParagraph` (`lib/gemini-service.ts:2750–2752`) passes only surrounding **English** paragraphs (`previousEnglishParagraph`, `nextEnglishParagraph`), omitting surrounding **Bangla** paragraphs.
- **Why It Matters for Real Bangla Readers:**
  - When Stage 2's `banglaAdaptationStrategy` includes concrete Bangla register targets (e.g., *"Use crisp चलित (Cholit) verbs, preserve dry ironic restraint without melodramatic adjectives, use তুমি for Tobiah→Ines"*), Stages 3 and 4 follow a specific stylistic blueprint.
  - Passing surrounding Bangla paragraphs into `refineSingleParagraph` ensures single-paragraph refinements seamlessly match the tense, pronoun register, and cadence of adjacent translated paragraphs.
- **Pipeline Component Affected:** `lib/gemini-service.ts` (`analyzeAuthorVoice`, `refineSingleParagraph`), `components/WorkspaceView.tsx`.
- **Expected Quality Gain:** **Medium–High**.
- **Implementation Complexity:** **Low**.
- **Regression Risk:** **Very Low**.
- **How Improvement Will Be Measured:** Consistency of refined paragraphs with adjacent Bangla sentences and sharper author-voice differentiation between BM-1 (*The Owing Book*), BM-3 (*The Clockmaker of Old Calcutta*), and BM-4 (*Signal in the Pine Barrens*).

---

## 9. Expected Gains, Costs, and Regression Risks

| Improvement | Primary Quality Dimensions Improved | Latency / Token Impact | Regression Risk & Mitigation |
| :--- | :--- | :--- | :--- |
| **1. Model Upgrade (`gemini-3-flash-preview` for Stages 1–4 & Refine)** | Semantic Fidelity, Naturalness, Literary Quality, Idiom Accuracy | Slight latency increase (~1.2x–1.5x per call vs `flash-lite`), well within interactive studio tolerances | **Low:** Keep `gemini-3.1-flash-lite` and `gemini-flash-latest` in fallback array so availability never regresses. |
| **2. Dyadic Pronoun & Honorific Lock (Stage 1 → 3 → 4) + 4-Paragraph Context** | Contextual Consistency, Dialogue Naturalness, Character Voice | Negligible (+150–250 input tokens per Stage 3 chunk) | **Low:** Uses existing `CharacterMemoryItem` fields (`pronouns`, `relationships`, `speakingStyle`) so zero storage migration is needed. |
| **3. Generalizable Bengali Literary Craft Prompting (Replacing Story Crutches)** | Naturalness of Bangla, Literary Quality, Author Voice, Semantic Fidelity | **Reduces** prompt token clutter while sharpening instruction adherence | **Low–Medium:** Mitigate by testing both *The Owing Book* and *The Quiet Key* end-to-end to confirm zero regression on previously patched cases. |
| **4. Windowed Stage 4 (15-para windows) + Pre-Stage-4 Deterministic Lint Injection** | Completeness of Polish on Long Chapters, Semantic/Numerical Self-Correction | For <=15-paragraph chapters: **0 extra calls** (single window). For 50-paragraph chapters: 3–4 smaller calls (can run sequentially with 2-para Bangla continuity) | **Low:** Keep `runLiteraryEditingPass` public API identical so `WorkspaceView.tsx` and existing unit tests require minimal or zero structural changes. |
| **5. Stage 2 Concrete Bangla Strategy + Bilingual Context in `refineSingleParagraph`** | Author Voice Preservation, Local Refinement Continuity | Negligible (+100 tokens) | **Very Low:** Optional parameters on `refineSingleParagraph` preserve full backward compatibility. |

---

## 10. Recommended Implementation Sequence

To deliver the fastest, safest, and most visible improvement in Bangla translation quality, we recommend a **two-milestone execution sequence**:

### Milestone 2B.9a — Core Generative Quality, Voice & Continuity Upgrade (Immediate First Milestone)
1. **Upgrade Generative Model Tier:** Promote `DEFAULT_MODEL` / Stage 1–4 & Refinement primary model to `gemini-3-flash-preview` (with resilient fallback chain).
2. **Dyadic Pronoun & Honorific Continuity System:**
   - Enhance Stage 1 (`extractLiteraryUnderstanding`) to explicitly determine and record each character's 3rd-person narrative pronoun (`সে`/`তিনি`) AND directed 2nd-person address register (`তুই`/`তুমি`/`আপনি`) toward other characters.
   - Expand Stage 3 continuity context window from `2` to `4` preceding bilingual paragraph pairs.
   - Enforce strict speaker-dyad pronoun and verb-ending consistency in Stage 3 and Stage 4.
3. **Generalizable Literary Bangla Craft Prompts (De-overfitting Stage 3 & Stage 4):**
   - Replace hardcoded story-specific phrase rules in Stage 3 & Stage 4 with systematic Bengali literary craft principles (clause restructuring, anti-calque rules, strict noun-modifier grounding to prevent cross-paragraph hallucination, idiom pragmatic equivalence, and rhythmic restraint).
4. **Windowed Stage 4 with Pre-Editing Deterministic Lint Self-Correction:**
   - Upgrade `runLiteraryEditingPass` to process long chapters in focused 15-paragraph windows (preserving 2 preceding edited Bangla paragraphs for continuity) and inject `storyContext` plus deterministic number/glossary lint warnings (`lintParagraphsForNumericalFidelity`, `lintParagraphsAgainstGlossary`) so Stage 4 actively fixes any factual/numerical/glossary slips while polishing the prose.
5. **Benchmark Verification:** Run live Stage 1–5 verification on *The Quiet Key* and *The Owing Book* to prove that unpatched general intelligence solves the *Quiet Key* defects (`tea towel`, `88 years`, `number eleven`, `Don't beat about the bush`, `unravelling`, pronoun consistency) while preserving or surpassing *The Owing Book* V2 quality.

### Milestone 2B.9b — Fine-Grained Author Voice Calibration & Interactive Studio Polish (Second Milestone)
1. Enhance Stage 2 (`analyzeAuthorVoice`) to sample representative beginning, middle, and ending passages of long chapters (up to 18,000 chars) and output concrete Bangla syntactic/lexical adaptation rules in `banglaAdaptationStrategy`.
2. Pass preceding and following **Bangla** paragraphs into `refineSingleParagraph` so single-paragraph refinements in Paragraph Studio maintain seamless pronoun and cadence continuity with neighboring Bangla paragraphs.
3. Add a lightweight deterministic **Bangla Naturalness & Pronoun-Shift Heuristic Check** to flag mid-chapter speaker-pronoun drift or stray ASCII punctuation (`"."` instead of `"।"`) during editing.

---

## 11. Exact Specification for First Implementation Milestone (Milestone 2B.9a)

### Milestone Title
**Milestone 2B.9a — Generative Translation Quality, Pronoun Continuity & Self-Correcting Literary Editor**

### Files to Modify (Strictly Scoped)
1. `/lib/gemini-service.ts`
   - **Model Configuration (`lines 56–68`):** Update `DEFAULT_MODEL` to `'gemini-3-flash-preview'` and align `FALLBACK_MODELS` with `STAGE5_MODELS` (`['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest']`).
   - **Stage 1 Prompt (`extractLiteraryUnderstanding`, `lines 1244–1356`):** Instruct Stage 1 to record both 3rd-person narrative pronouns (`সে`/`তিনি`) and explicit **Speaker → Addressee 2nd-person pronoun locks (`তুই`/`তুমি`/`আপনি`)** in `extractedCharacters` (`pronouns` and `speakingStyle`).
   - **Stage 3 Prompt (`translateChunkFaithfully`, `lines 1429–1560`):**
     - Include full `storyContext` fields (`narrativeTimeline`, `importantEvents`, `locations`) in `storyBlock`.
     - Replace the hardcoded story-specific phrase list (`lines 1483–1509`) with generalizable, high-precision rules for:
       1. Strict noun-phrase grounding (zero cross-paragraph object/modifier contamination).
       2. Bengali syntactic restructuring (breaking nested English relative clauses, avoiding `"যে কিনা"` and redundant verb roots).
       3. Idiom and proverb pragmatic adaptation (never substituting unrelated Bangla proverbs).
       4. Speaker-dyad pronoun and verb-conjugation lock (`তুই`/`তুমি`/`আপনি`).
       5. Rhythmic fidelity for short understated sentences.
   - **Stage 4 Architecture & Prompt (`runLiteraryEditingPass`, `lines 1669–1856`):**
     - Accept optional `storyContext?: StoryContextProfile | null` and `windowSize?: number` (default `15`).
     - Run `lintParagraphsAgainstGlossary` and `lintParagraphsForNumericalFidelity` on each window before calling the model; if any deterministic discrepancies exist in the window, inject a concise `DETERMINISTIC ACCURACY FIXES REQUIRED IN THIS WINDOW` block into the Stage 4 prompt so the Chief Editor fixes them automatically.
     - Process chapters >15 paragraphs in sequential 15-paragraph windows, passing the last 2 edited Bangla paragraphs from window `W-1` as read-only continuity context into window `W`, then reassembling `editedParagraphs`, `editorialNotes`, and `editorialChanges` seamlessly.
2. `/components/WorkspaceView.tsx` & `/app/api/translate/route.ts`
   - Pass `storyContext` in the `stage4_editing` request payload (`WorkspaceView.tsx:2302–2310` and `app/api/translate/route.ts:62–72`).
   - Increase `contextWindow` from `2` to `4` in Stage 3 chunk execution (`WorkspaceView.tsx:1195`) so cross-paragraph dialogue continuity spans 4 preceding bilingual paragraphs.
3. `/tests/` (Targeted Unit Test Updates)
   - Add/update unit tests verifying:
     - Windowed Stage 4 execution and reassembly for multi-window chapters while preserving 1:1 paragraph alignment.
     - Pre-Stage-4 deterministic number/glossary lint injection into Stage 4 prompts.
     - Full `storyContext` inclusion in Stage 3 and Stage 4 prompts.

### Acceptance Criteria for Milestone 2B.9a
1. **Zero Hardcoded Story Crutches:** All *Owing Book*-specific and *Quiet Key*-specific example strings are removed from Stage 3 and Stage 4 prompts.
2. **Live Benchmark Validation on *The Quiet Key* (BM-2):**
   - `"eighty-eight years"` (P2) translates accurately as `আটাশি বছর` (never `আটত্রিশ`).
   - `"Pru Lindqvist from number eleven"` (P17) translates accurately as `এগারো নম্বর বাড়ি` (never `নয় নম্বর`).
   - `"tea towel"` (P14, P18, P23, P31) translates as a tea towel / cloth (never `"লেমন ড্রিজল মোছার কাপড়"`).
   - `"Don't beat about the bush"` (P24) and `"one dry unravelling"` (P35) translate idiomatically and accurately (never `"না আঁচালে বিশ্বাস নেই"` or `"জট পাকানো"`).
   - Odile↔Corin and Odile↔Pru maintain 100% consistent 2nd-person pronouns (`তুই`/`তুমি`/`আপনি`) across all 47 paragraphs.
3. **Live Benchmark Validation on *The Owing Book* (BM-1):**
   - Retains 100% semantic accuracy on `(Fine.)`, `(Not fine. Paid.)`, `ten to seven`, `eleven days`, `forty years`, `thirteen years`, `twelve years`, and `tact of a fist on a table` using generalizable literary intelligence alone, while improving Bangla syntactic naturalness on previously calqued sentences (such as P2, P11, P26).
4. **Build & Test Health:** All existing unit tests, new unit tests, `npx eslint .`, and `npx next build` pass with zero errors.

---

## 12. Explicit List of What Should NOT Be Changed Yet

To maintain laser focus on translation output quality and avoid wasted engineering cycles, the following areas **must NOT be modified** in Milestone 2B.9a:

1. **Do NOT redesign or expand Stage 5 (`verifyTranslationAccuracy`) or its UI panel (`VerificationAndEditorialPanel`):** Stage 5 and Milestone 2B.8d-F closure semantics are already verified and working. Do not spend time tweaking minor non-blocking UI status edge cases recorded in 2B.8d-F.
2. **Do NOT alter paragraph alignment, scene-break parsing, or in-flight concurrency/reconciliation state machines** (`alignParagraphs`, `parseParagraphsWithSceneBreaks`, `reconcileStage3ChunkWithLatestState`, `reconcileStage4ResultWithLatestState`, `reconcileStage5ResultWithLatestState`). These are rock-solid and covered by 196 passing tests.
3. **Do NOT add new UI modals, sliders, or configuration knobs to the workspace:** Users do not need more toggles; they need the default pipeline to produce exceptional literary Bangla out of the box.
4. **Do NOT change LocalStorage persistence schemas (`TranslationProject`, `Chapter`, `ParagraphPair` required fields):** Keep all data structures 100% backward-compatible with existing saved projects.
5. **Do NOT produce another external review dossier or documentation-only milestone:** All effort in the next turn should go directly into implementing Milestone 2B.9a and verifying real Bangla translation output on the benchmarks.
