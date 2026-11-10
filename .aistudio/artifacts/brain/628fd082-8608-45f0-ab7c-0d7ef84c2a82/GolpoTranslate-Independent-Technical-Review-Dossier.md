# GolpoTranslate — Independent Technical Review Dossier (Reconciled Revision)
**Prepared for:** External Technical Review by Claude (Argon Handoff)  
**Target Milestone State:** Post-Milestone 2B.8d / 2B.8d-V (Pre-Milestone 2B.8d-F & 2B.9)  
**Inspection Mode:** Strictly Read-Only (Zero Project Modifications)  
**Revision Note:** This revision reconciles benchmark artifact identities, paragraph counts, and SHA-256 hashes against the actual files on disk; bounds benchmark conclusions strictly to observed evidence; separates *Translation Coverage*, *Audit Completion*, and *Editorial Acceptance* semantics; qualifies proposed score/issue thresholds as product policy candidates; and refines deduplication and severity-calibration recommendations to guard against benchmark overfitting.

**Evidence Standard:** Every technical claim is tagged with one of:
- `CONFIRMED IN CODE` — Directly verified by inspecting current repository or artifact files (with exact file path and line range).
- `TEST VERIFIED` — Confirmed by running deterministic unit tests, ESLint, `next build`, or `sha256sum` in the current workspace.
- `BENCHMARK OBSERVED` — Directly verified in accessible benchmark artifacts on disk.
- `REPORTED, NOT REPRODUCED` — Reported in prior milestone/session summaries whose raw background task stdout logs were truncated by conversation compaction and were not re-run during this documentation-only revision.
- `INFERRED` — Logically deduced from code paths or runtime behavior where not explicitly asserted by a test.
- `UNKNOWN / NOT VERIFIED` — Cannot be independently verified from current repository files or accessible artifacts.

---

## 1. Executive Technical Overview

### 1.1 Application Purpose & Architecture (`CONFIRMED IN CODE`)
**GolpoTranslate** (`golpotranslate-studio`) is a Next.js 15 App Router web application designed for long-form literary translation from **English to Bangla (Bengali)**. Unlike single-pass machine translation wrappers, it implements a **5-stage cognitive literary translation pipeline** with chapter-level segmentation, aligned paragraph state tracking, cross-chapter story memory (Character Bible, Terminology Glossary, Recurring Symbols, Voice Drift Notes), and a hybrid **AI + deterministic verification layer (Stage 5)**.

### 1.2 Technology Stack & Runtime (`CONFIRMED IN CODE` — `/package.json:1–41`, `/tsconfig.json:1–30`)
| Layer | Technology / Package | Version | Evidence |
|---|---|---|---|
| Framework | Next.js (App Router) | `^15.4.9` (runtime `15.5.28`) | `/package.json:21` |
| UI Runtime | React / React DOM | `^19.2.1` | `/package.json:22–23` |
| Language | TypeScript (`strict: true`, `moduleResolution: "bundler"`) | `~5.9.3` | `/package.json:37`, `/tsconfig.json:7–21` |
| AI SDK | `@google/genai` (Server-side only via `/api/translate`) | `^2.32.0` | `/package.json:13`, `/app/api/translate/route.ts:1–113` |
| Styling & Motion | Tailwind CSS v4 (`@tailwindcss/postcss`) + `motion` | `^4.1.11` / `^12.23.24` | `/package.json:20, 29` |
| Document Import | `mammoth` (DOCX raw text extraction) | `^1.13.0` | `/package.json:19`, `/components/WorkspaceView.tsx:1808` |
| Persistence | Browser IndexedDB (`golpotranslate_studio_db`, v1) | Native Web API | `/lib/storage.ts:11–42` |
| Test Runner | Node native test runner via `tsx --test` | `node:test` + `node:assert/strict` | `/lib/terminology.test.ts:1–2`, `/lib/chunker.test.ts:1–2` |

### 1.3 Client / Server Boundary (`CONFIRMED IN CODE` — `/app/api/translate/route.ts:1–113`, `/lib/gemini-service.ts:29–54`)
- **Client Layer (`/app/page.tsx`, `/components/*`, `/lib/storage.ts`, `/lib/chunker.ts`, `/lib/terminology.ts`)**:
  - Manages all project state in React state (`activeProject`, `activeChapterId`) and persists full `TranslationProject` snapshots into browser IndexedDB (`projects`, `history`, `settings` object stores in `/lib/storage.ts:11–16`).
  - Runs all deterministic text segmentation (`chunker.ts`), paragraph alignment, deterministic terminology linting (`lintChapterTerminology`), deterministic numerical linting (`lintChapterNumericalConsistency`), and post-edit state reconciliation (`reconcileStage5ResultWithLatestState`) **synchronously on the client**.
- **Server API Layer (`/app/api/translate/route.ts` -> `/lib/gemini-service.ts`)**:
  - Exposes a single `POST /api/translate` endpoint (`/app/api/translate/route.ts:11–112`) that dispatches 6 actions (`stage1`, `stage2`, `stage3`, `stage4`, `stage5`, `refineParagraph`) to server-side functions in `/lib/gemini-service.ts`.
  - Reads `process.env.GEMINI_API_KEY` exclusively on the server (`/lib/gemini-service.ts:43–53`).

### 1.4 Milestone Progression Summary (`CONFIRMED IN CODE` & `REPORTED, NOT REPRODUCED`)
| Milestone | Focus | Key Architectural Outcome | Status |
|---|---|---|---|
| **2B.7** | Literary Fidelity & Voice Rules | Expanded Stage 3 & Stage 4 literary anti-calque rules, dialogue register rules, and metaphor preservation. Verified in `the-owing-book-evaluation-report.md`. | Completed (`CONFIRMED IN CODE`) |
| **2B.8** | Stage 5 Factual Fidelity Audit | Diagnosed why Stage 5 previously gave `100% / complete: true / 0 issues` to *The Quiet Key* despite `88→38`, `11→9`, and `tea towel→লেমন ড্রিজল মোছার কাপড়`. | Completed (Audit) |
| **2B.8b** | Deterministic Numerical Verification | Added English & Bangla number parsers (`parseEnglishNumericalExpressions`, `parseBanglaNumericalTokens`) and paragraph/chapter numerical linters (`lintParagraphNumericalConsistency`, `lintChapterNumericalConsistency`) integrated into `mergeVerificationReportWithTerminologyLint`. | Completed (`TEST VERIFIED`) |
| **2B.8c** | Stage 5 Prompt & Rubric Hardening | Added Categories A–H audit rubric, 6-step audit protocol, `englishExcerpt` & `banglaExcerpt` schema fields, `normalizeStage5IssueType`, `normalizeStage5IssueSeverity`, and `calibrateLiveStage5AiIssue`. | Completed (`TEST VERIFIED`) |
| **2B.8c-L** | Live Stage 5 Benchmark | Benchmarked 2B.8c live against *The Owing Book* and *The Quiet Key*; reported full-chapter prompt dilution on multi-dozen-paragraph chapters. | Completed (`REPORTED, NOT REPRODUCED`) |
| **2B.8d** | Stage 5 Long-Chapter Audit Reliability | Upgraded Stage 5 primary model to `gemini-3-flash-preview` (`STAGE5_MODELS`), implemented 12-paragraph windowing (`splitParagraphsIntoStage5Windows`), global `[Paragraph i]` indexing, 6 per-paragraph check dimensions, cross-window deduplication, and chapter-level score/completion aggregation. | Implemented (`CONFIRMED IN CODE`) |
| **2B.8d-V** | Verification Closure & Repeatability Audit | Executed unit tests (`194/194` pass), ESLint (`0` errors), `next build` (failed at `lib/gemini-service.ts:2586:43`), and live Stage 5 repeatability runs (see Section 10 for artifact identity reconciliation). | **CONDITIONAL PASS** (Blocked by targeted fixes for 2B.8d-F) |

---

## 2. Repository Structure & Key Modules

### 2.1 Complete Repository File Tree (`CONFIRMED IN CODE`)
```text
/
├── app/
│   ├── api/
│   │   └── translate/
│   │       └── route.ts                  (113 lines — Server POST dispatcher for Stages 1–5 & refineParagraph)
│   ├── globals.css                       (Tailwind CSS v4 imports)
│   ├── layout.tsx                        (Root layout, fonts & metadata)
│   └── page.tsx                          (271 lines — Top-level shell, IndexedDB bootstrap, tab & modal routing)
├── components/
│   ├── AnalyticsModal.tsx                (Project-wide progress, issue count & stage statistics modal)
│   ├── ComparisonSlider.tsx              (Landing page interactive before/after showcase)
│   ├── ExportModal.tsx                   (TXT, HTML, Markdown, JSON export modal)
│   ├── HistoryModal.tsx                  (IndexedDB snapshot history viewer & restore UI)
│   ├── LandingHero.tsx                   (Landing page hero & project entry)
│   ├── NewProjectModal.tsx               (Manuscript ingestion, chapter splitting, genre & dialect setup)
│   ├── PipelineVisualizer.tsx            (5-stage interactive pipeline bar & stage output inspector)
│   ├── SettingsModal.tsx                 (Editor font size, auto-save, literary strictness, dialect settings)
│   ├── Sidebar.tsx                       (Project switcher, chapter list, story memory / glossary drawer trigger)
│   ├── VerificationAndEditorialPanel.tsx (356 lines — Stage 4 change log + Stage 5 audit scorecard & issue cards)
│   └── WorkspaceView.tsx                 (2,750 lines — Main translation studio, stage executors, paragraph workbench)
├── lib/
│   ├── chunker.ts                        (1,258 lines — Scene breaks, chunking, alignment, continuous edit, completion state)
│   ├── chunker.test.ts                   (Unit tests for chunker, scene breaks, alignment & continuous editing)
│   ├── gemini-service.ts                 (2,720 lines — Model arrays, fallback/retry, prompts & schemas for Stages 1–5)
│   ├── sample-passages.ts                (85 lines — Built-in literary sample passages including Clockmaker of Old Calcutta)
│   ├── storage.ts                        (412 lines — IndexedDB CRUD for projects, history, settings + Clockmaker starter project)
│   ├── terminology.ts                    (11,155 lines — Terminology linting, numerical verification, Stage 5 reconciliation)
│   ├── terminology.test.ts               (17,307 lines — Comprehensive regression suite across Milestones 2B.1–2B.8d)
│   ├── types.ts                          (303 lines — Core TypeScript interfaces for projects, chapters, pipeline & Stage 5)
│   └── utils.ts                          (Tailwind class merge utility `cn`)
├── public/
│   └── assets/aistudio/
│       ├── the-owing-book-bilingual_c26528f8.txt (Original first-run bilingual baseline for Test A — 54 paragraphs)
│       └── the-quiet-key-bilingual_b6d8786f.txt  (Original first-run bilingual baseline for Test B — 47 paragraphs)
├── metadata.json
├── next.config.ts
├── package.json
└── tsconfig.json
```

### 2.2 Core Type Definitions (`CONFIRMED IN CODE` — `/lib/types.ts:154–235`)
Below are the exact TypeScript interfaces governing pipeline state and Stage 5 verification (`/lib/types.ts:154–235`):

```ts
// /lib/types.ts:154-205
export type VerificationIssueType =
  | 'omission'
  | 'addition'
  | 'mistranslation'
  | 'tone_drift'
  | 'untranslated'
  | 'terminology_inconsistency';

export type VerificationIssueSeverity = 'low' | 'medium' | 'high';

export type VerificationIssueStatus = 'open' | 'resolved' | 'ignored';

export interface VerificationIssue {
  id?: string;
  paragraphIndex: number; // 0-based paragraph index
  type: VerificationIssueType;
  severity: VerificationIssueSeverity;
  description: string;
  suggestion: string;
  status?: VerificationIssueStatus;
  source?: 'ai_audit' | 'deterministic_lint';
  termId?: string;
  englishTerm?: string;
  expectedBangla?: string;
  forbiddenAlternatives?: string[];
  matchedForbiddenTerm?: string;
  /** Optional short English source quote illustrating the discrepancy */
  englishExcerpt?: string;
  /** Optional short Bangla translation quote illustrating the discrepancy */
  banglaExcerpt?: string;
}

export interface VerificationReport {
  overallScore: number;
  fidelitySummary: string;
  isComplete: boolean;
  issues: VerificationIssue[];
  checkedAt: string;
}
```

---

## 3. End-to-End Translation Pipeline Architecture

### 3.1 Five-Stage Execution Sequence (`CONFIRMED IN CODE` — `/components/WorkspaceView.tsx:2492–2552`)
When a user clicks **Run Full 5-Stage Pipeline** (`handleRunFullPipeline`, `/components/WorkspaceView.tsx:2492`), the orchestrator executes Stages 1 through 5 sequentially on the active chapter:
```text
[English Chapter SourceText]
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Story Understanding & World-Building (`executeStage1`)         │
│ • Splits long manuscripts (>12,000 chars) into 10,000-char windows      │
│ • Extracts summary, themes, tone, narrativePOV, characters,             │
│   terminology, and continuityNotes                                      │
│ • Sanitizes non-glossary sentences (`sanitizeStage1WindowTerminology`)  │
│ • Syncs approved terms & characters into project-wide `StoryMemory`     │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Author Voice & Stylistic Blueprint (`executeStage2`)           │
│ • Analyzes up to 15,000 chars of English source + Stage 1 output        │
│ • Produces `AuthorVoiceProfile` (sentenceRhythm, metaphorDensity,       │
│   dialogueRegister, narrationStyle, culturalAdaptationStrategy,         │
│   banglaStylisticTargets, cautionaryNotes)                              │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Faithful Literary Chunk Translation (`executeStage3`)          │
│ • Splits English source into paragraph chunks (~3,200 chars/chunk)      │
│   via `chunkTextByParagraphs(sourceText, 3200)`                         │
│ • Translates each chunk sequentially with 600-char previous-chunk       │
│   tail context + mandatory terminology glossary + numerical guardrails  │
│ • Enforces strict paragraph count & scene-break parity (`* * *`)        │
│ • Saves incremental chunk progress via `mergeStage3ChunkProgress`       │
│ • Applies deterministic glossary auto-normalization on raw output       │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: Literary Rhythm & Voice Polish (`executeStage4`)               │
│ • Chunks aligned paragraphs (max 8 paragraphs / 5,500 chars per batch)  │
│ • Polishes Bangla phrasing for natural literary cadence (`চলিত রীতি`)    │
│ • Runs deterministic terminology & scene-break guardrails on each       │
│   proposed edit (`applyStage4EditsToParagraphs`)                        │
│ • Rejects or auto-corrects any Stage 4 edit that violates locked        │
│   glossary terms or alters scene-break structure                        │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 5: Translation Verification & Fidelity Audit (`executeStage5`)    │
│ • Splits chapter into 12-paragraph windows (`STAGE5_DEFAULT_WINDOW_SIZE`)│
│ • Audits up to 3 windows in parallel using `gemini-3-flash-preview`     │
│ • Normalizes & calibrates AI findings (`calibrateLiveStage5AiIssue`)    │
│ • Merges AI findings with deterministic terminology lint AND            │
│   deterministic numerical lint (`mergeVerificationReportWithTerminologyLint`)│
│ • Reconciles chapter state (`reconcileStage5ResultWithLatestState`)     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stage-by-Stage Technical Contracts (`CONFIRMED IN CODE`)

#### Stage 1: `analyzeStoryUnderstanding` (`/lib/gemini-service.ts:1357–1504`)
- **Input**: `sourceText`, `genre`, `existingMemory` (`StoryMemory`).
- **Windowing**: If `sourceText.length > 12000`, `splitSourceTextIntoAnalysisWindows` (`/lib/gemini-service.ts:1169`) splits on paragraph boundaries into `10,000`-character windows (`maxWindows = 8`) and merges results via `mergeWindowedStoryUnderstandings`.
- **Sanitization**: `sanitizeStage1WindowTerminology` (`/lib/gemini-service.ts:1229–1355`) filters out prose sentences masquerading as glossary terms, verifies substring occurrence in the window text, and forces `status: 'needs_review'` on heuristic/ambiguous terms while allowing clean 1–4 word terms to be `approved`.

#### Stage 2: `analyzeAuthorVoice` (`/lib/gemini-service.ts:1506–1575`)
- **Input**: `sourceText.slice(0, 15000)`, `genre`, `banglaStyle`, `understanding` (`StoryUnderstanding`).
- **Output**: `AuthorVoiceProfile` JSON (`temperature: 0.25`), appending `voiceDriftNotes` into `project.storyMemory`.

#### Stage 3: `translateChunkFaithfully` (`/lib/gemini-service.ts:1577–1764`) & `executeStage3` (`/components/WorkspaceView.tsx:2063–2239`)
- **Input**: `chunkText`, `chunkIndex`, `totalChunks`, `previousTranslatedTail` (last 600 chars of previous chunk's Bangla), `understanding`, `voiceProfile`, `memory`, `banglaStyle`, `literaryStrictness`.
- **Paragraph & Scene-Break Invariants**:
  - `chunkTextByParagraphs(chapter.sourceText, 3200)` (`/lib/chunker.ts:289–366`) splits English paragraphs into chunks without splitting paragraphs across chunks.
  - If the AI merges or splits paragraphs inside a chunk, `translateChunkFaithfully` invokes `repairParagraphAlignment` (`/lib/gemini-service.ts:1710–1752`) to restore exact 1-to-1 paragraph count (`sourceParagraphs.length === translatedParagraphs.length`).
  - Scene breaks (`* * *`, `***`, `---`) are enforced deterministically via `enforceSceneBreakParityOnParagraphs` (`/lib/chunker.ts:174–211`).
- **Incremental Resumability**: After each chunk completes, `mergeStage3ChunkProgress` (`/lib/chunker.ts:440–528`) updates `chapter.paragraphs` and `chapter.stage3Progress` (`completedChunkIndices`, `chunkTranslations`, `totalChunks`, `sourceHash`), allowing interrupted multi-chunk translations to resume without losing completed chunks.

#### Stage 4: `runLiteraryEditingPass` (`/lib/gemini-service.ts:1766–1904`) & `applyStage4EditsToParagraphs` (`/lib/chunker.ts:1148–1217`)
- **Batching**: `executeStage4` (`/components/WorkspaceView.tsx:2241–2399`) groups paragraphs into batches of up to `8` paragraphs or `5,500` characters (`STAGE4_MAX_PARAGRAPHS_PER_CHUNK = 8`, `STAGE4_MAX_CHARS_PER_CHUNK = 5500`).
- **Guardrails**: Before applying any Stage 4 edit to `chapter.paragraphs`, `sanitizeStage4OutputAgainstTerminology` (`/lib/terminology.ts:3520–3695`) checks whether the proposed `afterBangla` breaks an approved glossary rule or alters a scene break. If a proposed edit introduces a terminology violation that cannot be deterministically auto-normalized, that paragraph edit is rejected and the Stage 3 faithful translation is retained.

#### Single-Paragraph Re-Translation / Refinement: `refineSingleParagraph` (`/lib/gemini-service.ts:2695–2720`)
- Allows the user to refine an individual paragraph with a custom instruction (`instruction`, surrounding context `prevParagraph`, `nextParagraph`, `voiceProfile`, `memory`).
- Updates the paragraph via `updateParagraphTranslation` (`/lib/chunker.ts:1044–1089`) and immediately triggers `reconcileStage5ResultWithLatestState` (`/lib/terminology.ts:7751`) to re-lint terminology and numbers on the updated chapter.

---

## 4. Stage 5 Verification Architecture (Deep Dive)

### 4.1 Model Selection, Fallback Chain & Retry Behavior (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:56–128`)
```ts
// /lib/gemini-service.ts:56-68
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

export const STAGE5_PRIMARY_MODEL = 'gemini-3-flash-preview';
export const STAGE5_MODELS = [
  STAGE5_PRIMARY_MODEL,
  DEFAULT_MODEL,
  'gemini-3.8-flash',
  'gemini-flash-latest',
];
```
- **Why Stage 5 has a dedicated model chain**: During Milestone 2B.8c-L and 2B.8d, live testing reported that `gemini-3.1-flash-lite` missed non-numerical semantic substitutions (`door → দোকান`, `steam → ধোঁয়া`, `tea towel → লেমন ড্রিজল মোছার কাপড়`, `Fine → জরিমানা`). Stage 5 was configured to use `gemini-3-flash-preview` as its primary model while retaining `FALLBACK_MODELS` for transient `503/429` resilience (`CONFIRMED IN CODE`).
- **Retry & Fallback Mechanics (`generateJsonWithModelFallback` & `withRetry`, `/lib/gemini-service.ts:70–128`)**:
  - `withRetry` wraps the entire fallback loop (`maxRetries = 2`, `baseDelayMs = 800`, exponential backoff `800ms * 2^attempt`).
  - Inside each attempt, `generateJsonWithModelFallback` iterates through `modelsToTry` (`STAGE5_MODELS` for Stage 5). If a model throws an error matching `/503|429|500|502|504|404|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|high demand|overloaded|deadline|timeout|fetch failed/i`, it logs a warning and immediately tries the next model in `STAGE5_MODELS`.

### 4.2 Stage 5 Response Schema (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:1979–2013`)
```ts
// /lib/gemini-service.ts:1979-2013
export const STAGE5_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.INTEGER, description: '0 to 100 accuracy and literary quality score' },
    isComplete: { type: Type.BOOLEAN, description: 'Whether all source content is completely translated with zero unresolved high-severity factual/semantic errors' },
    summary: { type: Type.STRING, description: 'Executive verification summary' },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          paragraphIndex: { type: Type.INTEGER, description: '0-based paragraph index matching the [Paragraph N] header' },
          type: {
            type: Type.STRING,
            enum: ['omission', 'addition', 'mistranslation', 'tone_drift', 'untranslated', 'terminology_inconsistency'],
          },
          severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
          englishExcerpt: { type: Type.STRING, description: 'Short exact quote from the English source paragraph showing what the original says' },
          banglaExcerpt: { type: Type.STRING, description: 'Short exact quote from the Bangla translation paragraph showing what was rendered (or "[omitted]" if missing)' },
          description: { type: Type.STRING, description: 'Precise explanation of the discrepancy between the English source and Bangla translation' },
          suggestion: { type: Type.STRING, description: 'Concrete corrected Bangla phrasing for the affected span' },
        },
        required: ['paragraphIndex', 'type', 'severity', 'englishExcerpt', 'banglaExcerpt', 'description', 'suggestion'],
      },
    },
  },
  required: ['overallScore', 'isComplete', 'summary', 'strengths', 'issues'],
};
```

### 4.3 System Instruction & Audit Rubric (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:2018–2176`)
- **`STAGE5_SYSTEM_INSTRUCTION` (`/lib/gemini-service.ts:2018–2036`)**:
  - Establishes the core axiom: *"A fluent, poetic, atmospheric Bangla translation is NOT automatically a faithful translation. You must never reward fluency while overlooking factual substitutions, invented details, omitted clauses, or altered imagery."*
  - Enforces a 6-step verification protocol per paragraph (`[Paragraph 0]`, `[Paragraph 1]`, ...) checking: (1) concrete nouns/objects/settings, (2) numbers/ages/ordinals/counts/addresses, (3) sensory/physical details, (4) actions/verbs/causality/idioms, (5) dialogue meaning/pragmatics, and (6) omissions/additions.
- **`buildStage5VerificationPrompt` (`/lib/gemini-service.ts:2043–2176`)**:
  - Injects explicit per-paragraph inspection rules (6 dimensions: Concrete Objects & Nouns, Actions & Physical Events, Numbers/Quantities/Addresses, Spatial & Directional Relationships, Sensory & Physical Details, Contextual & Pragmatic Meaning).
  - Defines **Categories A–H** with concrete literary counter-examples:
    - **Category A (Concrete Object, Location, or Physical Detail Substitution)**: e.g., `door` vs `দোকান` (shop), `steam` vs `ধোঁয়া` (smoke), `tea towel` vs `লেমন ড্রিজল মোছার কাপড়`.
    - **Category B (Unsupported Invented Details / Hallucinated Modifiers)**: `type = "addition"`.
    - **Category C (Omissions of Clauses, Sentences, or Meaningful Modifiers)**: `type = "omission"`.
    - **Category D (Contextual & Pragmatic Mistranslation in Dialogue & Idioms)**: e.g., `"Fine"` as resigned agreement vs `"জরিমানা"` (monetary penalty), `"consulted the book"` vs `"বইটার সাথে পরামর্শ করলেন"`, `"leaving the F flat"` (musical pitch) vs `"ফাটা"` (cracked).
    - **Category E (Altered Imagery, Metaphor, or Physical Causality)**: e.g., `"wet through to the bones of the week"` vs `"সারা সপ্তাহের ক্লান্তিতে ভেজা"`, `"went clean through me"` vs `"পরিষ্কারভাবে আমার ভেতর দিয়ে চলে গেল"`.
    - **Category F (Numerical, Age, Address, Ordinal, and Count Discrepancies)**.
    - **Category G (Terminology & Character Consistency)**.
    - **Category H (Natural Literary Adaptation — DO NOT FLAG AS ERRORS)**: Explicitly protects natural Bangla idioms, syntactic restructuring, and culturally natural phrasing when factual and emotional meaning are preserved.

### 4.4 Post-Processing Sanitization, Calibration & Overfitting Risk (`CONFIRMED IN CODE` — `/lib/terminology.ts:3698–3762`, `/lib/gemini-service.ts:2182–2392`)
Every raw AI issue returned by Gemini passes through three normalization gates:
1. **`normalizeStage5IssueType(rawType, description)` (`/lib/terminology.ts:3698–3729`)**:
   - Coerces non-standard model type strings (`factual_error`, `hallucination`, `semantic_error`, `idiom_error`, etc.) into one of the 6 canonical `VerificationIssueType` values.
2. **`normalizeStage5IssueSeverity(rawSeverity, type, description)` (`/lib/terminology.ts:3735–3762`)**:
   - Coerces unknown severity strings (`critical` -> `high`, `warning` -> `medium`, `minor` -> `low`).
   - Escalates `low` to `medium` if `type` is `mistranslation`, `omission`, or `addition` and `description` matches `/\b(invented|hallucinated|fabricated|substitut|replaced|omitted|missing|wrong number|age|address|factual|meaning changed|distorted|misunderstood|literal translation)\b/i`.
3. **`calibrateLiveStage5AiIssue(issue, englishParagraph, banglaParagraph)` (`/lib/gemini-service.ts:2182–2392`)**:
   - **False-positive filtering (`return null`)**:
     - Filters out "no error / faithful translation" self-contradictory observations.
     - Filters out claims that `eighty-seven` (`87`) was mistranslated as `সাতাশি` (`87` in Bangla), since `সাতাশি = 87` is mathematically exact (`/lib/gemini-service.ts:2204–2216`).
     - Filters out subjective stylistic nitpicks unless backed by a concrete lexical/factual signal.
   - **Severity calibration & Benchmark Overfitting Risk (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:2270–2372`)**:
     - Inspecting `/lib/gemini-service.ts:2270–2372` reveals that `calibrateLiveStage5AiIssue` currently embeds several benchmark-specific regular expressions matching tokens from *The Owing Book* and *The Quiet Key* (e.g., `door/দোকান`, `steam/ধোঁয়া`, `Fine/জরিমানা`, `tea towel/লেমন ড্রিজল`, `wet through to the bones`, `went clean through me`, `consulted`).
     - **Architectural Risk Flagged for External Review (`DEF-04`)**: Expanding hardcoded lexical regexes in `calibrateLiveStage5AiIssue` to force `high` vs. `medium` severity on benchmark targets risks **overfitting the verifier to the two test stories** while failing to generalize to unseen literary manuscripts. See Section 11 (`DEF-04`) and Section 12.3 for the specific review question posed to Claude.

---

## 5. Paragraph-Window Auditing & Chapter Reconciliation

### 5.1 Window Splitting (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:1907–1974`)
```ts
// /lib/gemini-service.ts:1907-1974
export const STAGE5_DEFAULT_WINDOW_SIZE = 12;

export interface Stage5AuditWindow {
  windowIndex: number;
  totalWindows: number;
  startParagraphIndex: number; // inclusive, 0-based global chapter index
  endParagraphIndex: number;   // inclusive, 0-based global chapter index
  englishParagraphs: string[];
  banglaParagraphs: string[];
}
```
- `splitParagraphsIntoStage5Windows(englishParagraphs, banglaParagraphs, windowSize = 12)` slices the aligned chapter into contiguous windows of `12` paragraphs each:
  - A 54-paragraph chapter (*The Owing Book* V1 baseline on disk) splits into **5 windows**: Window 0 (`[0..11]`), Window 1 (`[12..23]`), Window 2 (`[24..35]`), Window 3 (`[36..47]`), and Window 4 (`[48..53]`, 6 paragraphs).
  - A 53-paragraph chapter (*The Owing Book* V2 clean baseline on disk) splits into **5 windows**: Window 0 (`[0..11]`), Window 1 (`[12..23]`), Window 2 (`[24..35]`), Window 3 (`[36..47]`), and Window 4 (`[48..52]`, 5 paragraphs).
  - A 47-paragraph chapter (*The Quiet Key* baseline on disk) splits into **4 windows**: Window 0 (`[0..11]`), Window 1 (`[12..23]`), Window 2 (`[24..35]`), and Window 3 (`[36..46]`, 11 paragraphs).
  - A 5-paragraph chapter (*The Clockmaker of Old Calcutta* starter baseline in `/lib/storage.ts`) forms **1 window**: Window 0 (`[0..4]`).
- **Concurrency (`STAGE5_WINDOW_CONCURRENCY = 3`, `/lib/gemini-service.ts:2434–2439`)**:
  - Windows are audited in parallel batches of up to `3` via `Promise.all`.

### 5.2 Global Paragraph Index Preservation & Remapping (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:2500–2535`)
When `auditSingleWindow(win)` receives raw issues from Gemini for window `win`:
```ts
// /lib/gemini-service.ts:2500-2535
const rawParagraphIndex =
  typeof rawIssue?.paragraphIndex === 'number' && Number.isFinite(rawIssue.paragraphIndex)
    ? Math.trunc(rawIssue.paragraphIndex)
    : -1;

// Accept either global index within [startParagraphIndex..endParagraphIndex]
// or window-relative index [0..windowLength-1] if the model accidentally used relative indexing
let paragraphIndex = rawParagraphIndex;
if (
  paragraphIndex < win.startParagraphIndex ||
  paragraphIndex > win.endParagraphIndex
) {
  if (
    win.startParagraphIndex > 0 &&
    rawParagraphIndex >= 0 &&
    rawParagraphIndex < win.englishParagraphs.length
  ) {
    paragraphIndex = win.startParagraphIndex + rawParagraphIndex;
  }
}

const isValidIndex =
  paragraphIndex >= win.startParagraphIndex &&
  paragraphIndex <= win.endParagraphIndex &&
  paragraphIndex < maxParagraphCount;
if (!isValidIndex) continue;
```
- **Mathematical Disjointness Proof (`CONFIRMED IN CODE`)**:
  - For every window with `win.startParagraphIndex > 0`, `win.startParagraphIndex` is a positive multiple of `effectiveWindowSize` (`12, 24, 36, 48, ...`), whereas `win.englishParagraphs.length <= effectiveWindowSize` (`<= 12`).
  - Therefore, `[0 .. win.englishParagraphs.length - 1]` and `[win.startParagraphIndex .. win.endParagraphIndex]` are **strictly disjoint intervals**. A valid global index is never misclassified as a relative index, and any relative index `[0 .. windowLength - 1]` returned in Window 1+ is deterministically mapped to `win.startParagraphIndex + rawParagraphIndex`. Out-of-bounds indices (`< 0` or `>= maxParagraphCount`) are discarded.

### 5.3 Cross-Window Aggregation & Deduplication (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:2565–2636`)
- After all windows resolve, `verifyTranslationAccuracy` iterates over `windowResults` in ascending window order (`0 .. totalWindows - 1`) and deduplicates issues within the same `paragraphIndex` if they share identical normalized `englishExcerpt` or `banglaExcerpt` (escalating `severity` to the higher of the two if duplicated).
- Merged AI issues are then passed into `mergeVerificationReportWithTerminologyLint` (`/lib/terminology.ts:4165–4298`), which combines AI issues with deterministic terminology issues and deterministic numerical issues.

---

## 6. Deterministic Verification Layers

### 6.1 Deterministic Terminology Verification (`CONFIRMED IN CODE` — `/lib/terminology.ts:1–650, 3800–4360`)
- **Unicode & Lexical Normalization**:
  - `normalizeBanglaUnicode(text: string)` (`/lib/terminology.ts:439–450`) normalizes NFC, strips zero-width joiners/non-joiners (`\u200B-\u200D`, `\uFEFF`), normalizes Nukta composites (`ড়`, `ঢ়`, `য়`), and collapses whitespace.
  - `normalizeEnglishTerm(text: string)` (`/lib/terminology.ts:452–460`) normalizes curly quotes/dashes and whitespace.
- **Inflection-Aware Bangla Matching**:
  - Recognizes standard Bangla nominal case suffixes (`-কে`, `-র`, `-ের`, `-দের`, `-তে`, `-য়`, `-গুলো`, `-টি`, `-টা`, `-খানা`, `-খানি`) so that an approved root term in `StoryMemory.terminology` matches inflected literary occurrences in the Bangla paragraph without false-positive missing-term alerts.
- **Glossary Enforcement (`lintChapterTerminology`, `/lib/terminology.ts:3920–4155`)**:
  - Only `status === 'approved'` terms (or legacy entries without `status` that pass `isEnforceableGlossaryTerm`) are enforced.
  - Emits `VerificationIssue` objects with `source: 'deterministic_lint'`, `type: 'terminology_inconsistency'`, `termId`, `englishTerm`, `expectedBangla`, and `matchedForbiddenTerm`.

### 6.2 Deterministic Numerical Verification (`CONFIRMED IN CODE` — `/lib/terminology.ts:9700–11155`)
Implemented in Milestone 2B.8b to guarantee deterministic detection of explicit numerical discrepancies without relying on LLM attention:
- **English Numerical Parser (`parseEnglishNumericalExpressions`, `/lib/terminology.ts:10060–10480`)**:
  - Extracts Arabic digits (`88`, `1,250`), English number words (`eighty-eight`, `eighty-seven`), compound hyphens, ordinals (`first`, `eleventh`, `88th`), ages (`eighty-eight years`), counts (`eighty-seven notes`), and numbered addresses (`number eleven`, `No. 11`).
  - **Idiom & False-Positive Exclusions**: Skips non-literal English idioms and indeterminate pronouns (`one of`, `one another`, `no one`, `someone`, `anyone`, `everyone`, `at once`, `once upon`, `one day`, `one morning`, `one evening`, `one night`, `a couple of`, `one or two`, `two or three`, `hundreds of`, `thousands of`).
- **Bangla Numerical Parser (`parseBanglaNumericalTokens`, `/lib/terminology.ts:9820–10055`)**:
  - Recognizes Bangla digits (`০`–`৯`), Arabic digits in Bangla text, full Bangla cardinal dictionary (`এক` `1` through `নিরানব্বই` `99`, including compound twenties/thirties/eighties such as `সাতাশি = 87`, `আটত্রিশ = 38`, `আটাশি = 88`), multipliers (`শত/শো = 100`, `হাজার = 1000`, `লক্ষ/লাখ = 100000`, `কোটি = 10000000`), and Bangla ordinals (`প্রথম`–`দশম`).
  - Handles attached Bangla classifiers and case suffixes (`-টি`, `-টা`, `-জন`, `-খানা`, `-খানি`, `-বার`, `-তে`, `-য়`, `-ের`).
- **Paragraph & Chapter Numerical Comparison (`lintParagraphNumericalConsistency` & `lintChapterNumericalConsistency`, `/lib/terminology.ts:10620–11050`)**:
  - Compares extracted English numerical expressions against Bangla numerical tokens in the same aligned paragraph (`paragraphIndex`).
  - Distinguishes `mismatch` (an explicit wrong number appears in Bangla, e.g., `88 → 38 (আটত্রিশ)` or `number 11 → 9 (নয় নম্বর)`) from `missing` (a concrete number in English is omitted in Bangla).
  - Assigns `severity: 'high'` (`numericalFindingToVerificationIssue`, `/lib/terminology.ts:11005–11045`) and sets `termId = "numerical:${finding.kind}:${finding.expectedValue}"`, `source = 'deterministic_lint'`, `type = 'mistranslation'` (or `'omission'` when missing).

### 6.3 Deduplication Between Deterministic & AI Numerical Issues (`CONFIRMED IN CODE` — `/lib/terminology.ts:4165–4250`)
When `mergeVerificationReportWithTerminologyLint` merges `aiReport.issues` with deterministic terminology and numerical issues:
- `mergeVerificationReportWithTerminologyLint` deduplicates AI issues that match `issue.type === 'terminology_inconsistency'` on the same `termId`, **but does NOT currently deduplicate a `deterministic_lint` numerical issue (`termId: "numerical:age:88"`, `type: "mistranslation"`) against an `ai_audit` issue (`type: "mistranslation"`) that flags the same numerical discrepancy**.
- **Important Constraint on Numerical Deduplication (`DEF-05`)**:
  - Two issues must **only** be merged/deduplicated when they refer to the **same actual numerical discrepancy** within that paragraph (i.e., matching `paragraphIndex` AND matching the same expected/detected numerical value or overlapping source/target numerical excerpts), **not** merely because both occur in the same paragraph. A single paragraph can contain multiple distinct numbers (e.g., an age and a street number, or a date and a quantity) or both a numerical error and an unrelated lexical mistranslation (as occurs in Paragraph 2 of *The Quiet Key*, which contains both `eighty-eight years → আটত্রিশ বছরে` and `wet through to the bones of the week → সারা সপ্তাহের ক্লান্তি হাড়ে হাড়ে অনুভূত হচ্ছে`).

---

## 7. Scoring, Severity Calibration & Completion Semantics

### 7.1 Conceptual Separation Required: Coverage vs. Audit Completion vs. Editorial Acceptance
A foundational architectural issue in the current codebase (`CONFIRMED IN CODE`) is that a single boolean field (`VerificationReport.isComplete`) is used across the backend, reconciliation layer, and UI to represent **three distinct domain concepts**:

| Concept | Definition | Current Signal(s) in Code | Why It Must Be Distinct |
|---|---|---|---|
| **1. Translation Coverage** | Whether every non-scene-break English source paragraph in the chapter has non-empty translated Bangla text. | `!hasMissingParagraphs` (`/lib/gemini-service.ts:2422–2426`) / `!hasMissingTranslations` (`/lib/terminology.ts:4249–4251`) | A chapter can be **100% translated** (`54/54` paragraphs have Bangla text) while still containing factual or stylistic errors requiring editorial revision. |
| **2. Audit Completion** | Whether the Stage 5 verification process successfully audited all required windows and returned structurally valid responses without transport/schema failure. | `allWindowsHadValidIssuesArray` (`/lib/gemini-service.ts:2445, 2675`) | Indicates whether the **verification job itself** succeeded across all windows of the chapter, independent of how many translation issues were found. |
| **3. Editorial Acceptance** | Whether the chapter's unresolved verification issues and quality score satisfy the agreed editorial threshold for approval (or whether targeted retranslation / human review is required). | Conflated into `VerificationReport.isComplete` alongside coverage and audit completion | Determines whether a chapter passes quality control or should be routed to Milestone 2B.9 targeted retranslation / human review. |

Because a single `isComplete: boolean` field cannot simultaneously represent all three states without losing information, the current codebase exhibits contradictory behavior across its three completion calculators and its UI panel (detailed in Sections 7.3–7.5 below).

### 7.2 Severity Penalty Formula (`CONFIRMED IN CODE` — `/lib/terminology.ts:3764–3780`)
```ts
// /lib/terminology.ts:3764-3780
export function getVerificationIssueScorePenalty(
  issue: Pick<VerificationIssue, 'severity' | 'status'>
): number {
  if (issue.status === 'resolved' || issue.status === 'ignored') {
    return 0;
  }
  switch (issue.severity) {
    case 'high':
      return 8;
    case 'medium':
      return 4;
    case 'low':
      return 1;
    default:
      return 4;
  }
}
```
- **Score Calculation (`CONFIRMED IN CODE` — `/lib/gemini-service.ts:2638–2666`, `/lib/terminology.ts:4278–4291`)**:
  - `totalIssuePenalty` sums penalties over all open issues (`high = 8`, `medium = 4`, `low = 1`).
  - `maxAllowedScoreByIssues = Math.max(0, 100 - totalIssuePenalty)`.
  - `enforcedScore = Math.max(0, Math.min(rawScore, maxAllowedScoreByIssues))` (and capped at `79` if `unresolvedHighCount > 0`, or `65` if `hasMissingParagraphs`).

### 7.3 The Three Completion Calculators in Current Code (`CONFIRMED IN CODE`)

#### Calculator 1: `verifyTranslationAccuracy` (`/lib/gemini-service.ts:2669–2678`)
```ts
// /lib/gemini-service.ts:2669-2678
const rawIsComplete = allWindowsReportedComplete
  ? true
  : anyWindowOmittedComplete
    ? unresolvedHighCount === 0 && unresolvedMediumCount <= 2
    : false;

const enforcedIsComplete =
  rawIsComplete &&
  allWindowsHadValidIssuesArray &&
  !hasMissingParagraphs &&
  unresolvedHighCount === 0;
```
- **Defect (`DEF-02`, `CONFIRMED IN CODE`)**: Because `isComplete` is a required boolean in `STAGE5_RESPONSE_SCHEMA` (`/lib/gemini-service.ts:2012`), `gemini-3-flash-preview` explicitly returns a boolean on every window. When a window has `0` high-severity issues, the model frequently returns `isComplete: true` even when emitting multiple `medium` issues. Thus `allWindowsReportedComplete` evaluates to `true`, and the fallback branch `anyWindowOmittedComplete ? unresolvedHighCount === 0 && unresolvedMediumCount <= 2 : false` is bypassed during normal schema-constrained execution. Consequently, a chapter with `0` high issues and `11` medium issues (`overallScore = 54%`) evaluates to `enforcedIsComplete = true`.

#### Calculator 2: `mergeVerificationReportWithTerminologyLint` (`/lib/terminology.ts:4255–4276`)
```ts
// /lib/terminology.ts:4255-4276
const baseIsComplete = (() => {
  if (!aiReport) return true;
  if (typeof (aiReport as VerificationReport & { baseIsComplete?: boolean }).baseIsComplete === 'boolean') {
    return Boolean((aiReport as VerificationReport & { baseIsComplete?: boolean }).baseIsComplete);
  }
  const aiHadHighIssues = (aiReport.issues || []).some(
    (issue) => issue.source !== 'deterministic_lint' && issue.severity === 'high'
  );
  return Boolean(aiReport.isComplete ?? true) || aiHadHighIssues;
})();

const isComplete =
  baseIsComplete &&
  !hasUnresolvedHigh &&
  !hasMissingTranslations;
```
- **Defect (`DEF-03a`, `CONFIRMED IN CODE`)**: At line 4270, `return Boolean(aiReport.isComplete ?? true) || aiHadHighIssues;` assumes `aiReport.isComplete` could only be `false` because of `aiHadHighIssues`. If `aiReport.isComplete` was `false` due to **both** a high-severity issue AND another failure (such as `!allWindowsHadValidIssuesArray` or an explicit `isComplete: false` from a window with many medium issues), `aiHadHighIssues === true` forces `baseIsComplete = true`. Once the high issue is resolved or dismissed (`!hasUnresolvedHigh`), `isComplete` flips to `true` even if those other incompleteness conditions remain.

#### Calculator 3: `getPipelineCompletionState` (`/lib/chunker.ts:977–1039`) & `resolveVerificationIssue` (`/lib/chunker.ts:1121–1139`)
```ts
// /lib/chunker.ts:1032-1039
const isComplete =
  paragraphs.length > 0 &&
  !hasMissingTranslations &&
  !hasUnresolvedHighIssues;
```
- **Defect (`DEF-03b`, `CONFIRMED IN CODE`)**: When a user clicks **Mark Resolved** or **Dismiss** on an issue in the UI (`resolveVerificationIssue`, `/lib/chunker.ts:1121–1139`), it calls `getPipelineCompletionState(paragraphs, updatedIssues)` instead of `mergeVerificationReportWithTerminologyLint`. `getPipelineCompletionState` sets `verificationReport.isComplete = paragraphs.length > 0 && !hasMissingTranslations && !hasUnresolvedHighIssues` and **does not recalculate `overallScore`** unless `reconcileStage5ResultWithLatestState` is separately invoked.

### 7.4 Qualification of Proposed Editorial Acceptance Policy (`overallScore >= 80` and `unresolvedMediumCount <= 2`)
In evaluating fixes for `DEF-02` and `DEF-03`, a candidate rule of `unresolvedHighCount === 0 && unresolvedMediumCount <= 2 && overallScore >= 80` was considered (partly inspired by the existing dead-code branch `unresolvedHighCount === 0 && unresolvedMediumCount <= 2` at `/lib/gemini-service.ts:2672`).

- **Important Qualification**: `overallScore >= 80` and `unresolvedMediumCount <= 2` is a **proposed editorial acceptance policy**, **not** an objectively proven or mathematically derived threshold.
- **Product-Level Decision Required**:
  1. **Chapter-Length Sensitivity**: Because penalties (`-8 / -4 / -1`) are additive across the entire chapter rather than normalized by paragraph count, a 100-paragraph chapter with 3 minor `medium` issues (`-12` points) is penalized identically to a 5-paragraph chapter with 3 `medium` issues. Product leadership and the external reviewer should decide whether editorial acceptance thresholds should be flat per chapter (`unresolvedMediumCount <= 2`, `overallScore >= 80`) or scaled by chapter length (e.g., max medium issues per 20 paragraphs).
  2. **Gate for Milestone 2B.9 Controlled Retranslation**: In Milestone 2B.9, does controlled retranslation target *every paragraph with an open `high` or `medium` issue* regardless of chapter-level `isComplete`, or does it only run on chapters that fail the chapter-level editorial acceptance gate? Separating `translationCoverage`, `auditComplete`, and `editorialStatus` (or `requiresRetranslation`) makes this policy explicit and configurable.

### 7.5 UI Status Display Conflation (`CONFIRMED IN CODE` — `/components/VerificationAndEditorialPanel.tsx:47–82, 117–225`)
In `VerificationAndEditorialPanel.tsx`:
1. **Top Status Badge (`/components/VerificationAndEditorialPanel.tsx:66–81`)**:
   - Checks `if (verificationReport.isComplete && highSeverityIssues.length === 0)` and renders a green badge: **`Complete & Verified`**, even if `verificationReport.overallScore === 54` with `11` unresolved `medium` issues.
2. **Completeness Row (`/components/VerificationAndEditorialPanel.tsx:161–169`)**:
   - Renders `verificationReport.isComplete ? '100% Translated (Complete)' : 'Action Required (Incomplete)'`.
   - This directly conflates **Translation Coverage** (`100% Translated`) with **Editorial Acceptance**. When `isComplete` is `false` due to a single `high` factual issue in a fully translated chapter, the UI misleadingly displays `Action Required (Incomplete)` under `Completeness` instead of showing `100% Translated — Editorial Review Required`.
3. **Deterministic Badge Mislabeling (`/components/VerificationAndEditorialPanel.tsx:217–224`)**:
   - Every `deterministic_lint` issue renders the hardcoded badge **`Glossary Rule Check`**, even when `issue.termId?.startsWith('numerical:')` (which is a **Numerical Consistency Check**, not a glossary rule).

---

## 8. Editor, State Synchronization & In-Flight Safety

### 8.1 Paragraph Alignment & Continuous Editing (`CONFIRMED IN CODE` — `/lib/chunker.ts:533–815`)
- **Paragraph Alignment (`alignParagraphs`, `/lib/chunker.ts:533–637`)**:
  - Aligns English and Bangla texts by paragraph index, preserving existing paragraph IDs, status (`pending | translated | edited | verified | flagged`), and `stage3Draft` / `stage4Polished` history when paragraphs are updated.
- **Continuous Bangla Textarea Mode (`canEditContinuousBangla` & `applyContinuousBanglaEdit`, `/lib/chunker.ts:680–815`)**:
  - Users can switch between **Paragraph Workbench Mode** and **Continuous Bangla Editor Mode**.
  - `applyContinuousBanglaEdit` enforces two strict safety invariants before accepting a continuous edit:
    1. **Paragraph count parity**: The edited continuous Bangla text must split into the exact same number of non-empty paragraphs as `chapter.paragraphs.length`.
    2. **Scene-break parity**: Scene-break paragraphs (`* * *`) must remain at their exact paragraph indices.
  - If an edit violates either invariant, `applyContinuousBanglaEdit` returns `{ ok: false, error: ... }` and preserves paragraph alignment.

### 8.2 Post-Edit State Reconciliation (`CONFIRMED IN CODE` — `/lib/terminology.ts:7751–7965`)
Whenever a user edits a paragraph, refines a paragraph via AI, reverts to Stage 3/Stage 4, or updates a glossary term (`applyTerminologyUpdateToProject`, `/components/WorkspaceView.tsx:419–518`), the app runs `reconcileStage5ResultWithLatestState`:
- Re-runs `lintChapterTerminology` and `lintChapterNumericalConsistency` against the latest `chapter.paragraphs` and `project.storyMemory.terminology`.
- Automatically marks previously open AI or deterministic issues on edited paragraphs as `'resolved'` if the offending `banglaExcerpt` / `matchedForbiddenTerm` / numerical mismatch is no longer present in the updated Bangla paragraph (`/lib/terminology.ts:7820–7910`).
- Recalculates `overallScore` and `isComplete` immediately without requiring a new Gemini API call.

### 8.3 Stale Overwrite & In-Flight Concurrency Protection (`CONFIRMED IN CODE` & `TEST VERIFIED` — `/components/WorkspaceView.tsx:1950–2485`, `/lib/terminology.test.ts:10600–11500`)
- Because Stages 3, 4, and 5 make asynchronous network calls lasting several seconds while the user may edit paragraphs or update the glossary in the UI, `WorkspaceView.tsx` uses a live state getter (`getLatestState()`) inside `createWorkspaceStageExecutors` (`/components/WorkspaceView.tsx:1950–2485`).
- When Stage 3, Stage 4, or Stage 5 finishes awaiting an API response, it reads the **latest** `project` and `chapter` state via `getLatestState()` rather than overwriting with a stale closure snapshot, and runs `reconcileStage5ResultWithLatestState` against the latest user edits and glossary approvals (`TEST VERIFIED` in `lib/terminology.test.ts`).

---

## 9. Test Suite, Build Status & Verification Evidence

### 9.1 Commands Executed & Exact Results (`TEST VERIFIED`)
During the read-only verification audit, the following commands were executed against `/app/applet`:

| Check | Command | Exit Status | Result Summary | Evidence Label |
|---|---|---|---|---|
| **Unit & Regression Tests** | `npx --yes tsx --test lib/terminology.test.ts lib/chunker.test.ts` | `0` (PASS) | **194 / 194 tests passed** (`0` failures, `3,753.68ms`) | `TEST VERIFIED` |
| **ESLint** | `npm run lint` (`eslint .`) | `0` (PASS) | **0 lint errors or warnings** | `TEST VERIFIED` |
| **Production Build** | `npm run build` (`next build`) | `1` (FAIL) | **TypeScript compile error at `./lib/gemini-service.ts:2586:43`** | `TEST VERIFIED` |

### 9.2 Exact Production Build Failure Analysis (`CONFIRMED IN CODE` & `TEST VERIFIED`)
Running `npm run build` (`next build`) fails during TypeScript type checking with:
```text
Failed to compile.

./lib/gemini-service.ts:2586:43
Type error: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.

  2584 |         }
  2585 |         const existing = dedupedByKey.get(exactKey)!;
> 2586 |         const exEn = normalizeEnglishTerm(existing.englishExcerpt).toLowerCase();
       |                                           ^
  2587 |         const calEn = normalizeEnglishTerm(calibrated.englishExcerpt).toLowerCase();
  2588 |         const exBn = normalizeBanglaUnicode(existing.banglaExcerpt);
  2589 |         const calBn = normalizeBanglaUnicode(calibrated.banglaExcerpt);
```
- **Root Cause (`CONFIRMED IN CODE` — `/lib/types.ts:182–183`, `/lib/gemini-service.ts:2586–2589`)**:
  - In `VerificationIssue` (`/lib/types.ts:182–183`), `englishExcerpt?: string` and `banglaExcerpt?: string` are typed as optional (`string | undefined`).
  - In `normalizeEnglishTerm(text: string)` (`/lib/terminology.ts:452`) and `normalizeBanglaUnicode(text: string)` (`/lib/terminology.ts:439`), the parameter `text` is typed as non-nullable `string`.
  - Both functions handle empty strings safely at runtime (`if (!text) return '';`), which is why `tsx --test` (which strips types without `tsc --noEmit`) passes all 194 tests, while `next build` (which runs strict TypeScript type-checking) fails on lines `2586–2589`.

---

## 10. Live Stage 5 Benchmark & Artifact Identity Reconciliation

### 10.1 Benchmark Artifact Identity Reconciliation (`CONFIRMED IN CODE` & `TEST VERIFIED`)
An important discrepancy existed between the **historical 2B.8d-V audit description** (which cited `54`, `47`, `5`, and `53` paragraphs) and the **initial draft of this dossier** (which cited `23`, `38`, `23`, and `38` paragraphs).

Direct read-only inspection and `sha256sum` verification of the actual files on disk in `/public/assets/aistudio/`, `/.aistudio/artifacts/brain/628fd082-8608-45f0-ab7c-0d7ef84c2a82/`, `/lib/sample-passages.ts`, and `/lib/storage.ts` confirm that **the historical 2B.8d-V paragraph counts (`54`, `47`, `5`, and `53`) are the exact paragraph counts of the actual files on disk**. The `23`- and `38`-paragraph figures in Draft 1 of the dossier originated from a **post-compaction context summary reconstruction error** after the raw stdout logs of earlier background benchmark tasks (`task-524` and `task-540`) were truncated by context compaction.

Below is the complete reconciliation table for all benchmark artifacts:

| Historical 2B.8d-V Artifact Name & Count | Current Accessible Artifact Path on Disk | Verified Paragraph Count on Disk (English / Bangla) | File Size & SHA-256 Identity | Draft 1 Dossier Claimed Count | Relationship Between Historical 2B.8d-V Artifact, Disk File & Draft 1 Description | Supporting Evidence & Unresolved Questions |
|---|---|---|---|---|---|---|
| **Owing Book V1** (`54` paragraphs) | `/public/assets/aistudio/the-owing-book-bilingual_c26528f8.txt` | **54 English / 54 Bangla** (`5` windows at size 12: `[0..11]`, `[12..23]`, `[24..35]`, `[36..47]`, `[48..53]`). Note: `P0` is the standalone title `"The Owing Book"` / `"ঋণ-খাতা"`; `P1..P53` are the 53 body paragraphs. | `40,125` bytes (`229` lines)<br>SHA-256: `c26528f886ebf8cd4beba1124386eada2794a79e520be878c673da1e4280ffc5` (`TEST VERIFIED`) | `23` paragraphs (`2` windows) | **Historical 2B.8d-V (`54` paras) and the disk file are IDENTICAL (`CONFIRMED IN CODE`).** Draft 1's `23`-paragraph count does not correspond to any file on disk and was a post-compaction summary error. | Line-by-line inspection of `/public/assets/aistudio/the-owing-book-bilingual_c26528f8.txt:11–226` confirms 54 English paragraphs (odd lines 11–117) and 54 Bangla paragraphs (even lines 120–226). **Unresolved:** Whether `task-524`/`task-540` ran on all 54 paragraphs or a 23-paragraph slice cannot be verified from raw logs (`UNKNOWN / NOT VERIFIED`). |
| **Quiet Key Original** (`47` paragraphs) | `/public/assets/aistudio/the-quiet-key-bilingual_b6d8786f.txt` | **47 English / 47 Bangla** (`4` windows at size 12: `[0..11]`, `[12..23]`, `[24..35]`, `[36..46]`). Note: `P0` is the standalone title `"The Quiet Key"` / `"নিস্তব্ধ চাবি"`; `P1..P46` are the 46 body paragraphs. | `35,366` bytes (`199` lines)<br>SHA-256: `b6d8786f82bb52d0be45a4af725aa78791de901ffb32e93e97f7f2f2b5381bfe` (`TEST VERIFIED`) | `38` paragraphs (`4` windows) | **Historical 2B.8d-V (`47` paras) and the disk file are IDENTICAL (`CONFIRMED IN CODE`).** Both 47 and 38 paragraphs produce `4` windows of size 12, but Draft 1's `38`-paragraph count and shifted paragraph indices were a post-compaction summary error. | Line-by-line inspection of `/public/assets/aistudio/the-quiet-key-bilingual_b6d8786f.txt:9–196` confirms 47 English paragraphs (odd lines 9–101) and 47 Bangla paragraphs (even lines 104–196). **Unresolved:** Raw stdout logs from `task-524`/`task-540` are unavailable after compaction (`UNKNOWN / NOT VERIFIED`). |
| **Clockmaker Control** (`5` paragraphs) | Embedded in `/lib/sample-passages.ts:12–28` (English) and `/lib/storage.ts:44–54, 183–236` (`createStarterProject`, Bangla, `ch-1-clockmaker`: *The Clockmaker of Old Calcutta — Chapter 1: The Brass Pendulum*) | **5 English / 5 Bangla** (`1` window at size 12: `[0..4]`) | `/lib/sample-passages.ts`: `7,323` bytes, SHA-256: `fa0505be32b2ea59ec62da410d07f97cee526babe69c1fad57855681a625fabd`<br>`/lib/storage.ts`: `23,526` bytes, SHA-256: `80bf195e2356a0d7fe59b40bf27897b390f538fa824b90359ecc45b9cf58ee3c` (`TEST VERIFIED`) | Omitted in Draft 1 (replaced by a synthetic `"Clean Control 2 — Quiet Key Clean (38 paras)"` entry) | **Historical 2B.8d-V (`5` paras) and the starter project in `/lib/storage.ts` are IDENTICAL (`CONFIRMED IN CODE`).** | **Why Clockmaker was absent in Draft 1:** The post-compaction summary substituted a non-existent `"Quiet Key Clean (38 paras)"` entry in place of the 5-paragraph Clockmaker control. No standalone `"Quiet Key Clean"` file exists anywhere on disk (`CONFIRMED IN CODE`). |
| **Owing Book V2** (`53` paragraphs) | `/.aistudio/artifacts/brain/628fd082-8608-45f0-ab7c-0d7ef84c2a82/the-owing-book-bilingual-v2.txt` | **53 English / 53 Bangla** (`5` windows at size 12: `[0..11]`, `[12..23]`, `[24..35]`, `[36..47]`, `[48..52]`). | `38,708` bytes (`222` lines) (`CONFIRMED IN CODE` via `view_file`).<br>Shell SHA-256: `UNKNOWN / NOT VERIFIED` (virtual artifact store is not mounted in container bash filesystem). | `23` paragraphs (`2` windows) | **Historical 2B.8d-V (`53` paras) and the artifact file are IDENTICAL (`CONFIRMED IN CODE`).** V2 is the Milestone 2B.7 revised translation of V1: V2 has `53` paragraphs instead of `54` because V2 omits the standalone title paragraph (`P0` in V1) and starts directly with `"The first thing Ines Varga did..."`, and adds `"it"` to `"never answered it."` at V2 `P26` (V1 `P27`). | Confirmed by inspecting `the-owing-book-bilingual-v2.txt:1–222` and `the-owing-book-evaluation-report.md:8–18, 34`. Draft 1's `23`-paragraph label was a post-compaction summary error. |

### 10.2 Verified Ground-Truth Target Locations in the Disk Baselines (`CONFIRMED IN CODE`)
To ensure the external reviewer has exact, verifiable ground truth from the actual files on disk, the tables below map every known editorial discrepancy to its **true 0-based paragraph index and window** in `/public/assets/aistudio/the-owing-book-bilingual_c26528f8.txt` (`54` paragraphs) and `/public/assets/aistudio/the-quiet-key-bilingual_b6d8786f.txt` (`47` paragraphs):

#### Ground-Truth Targets in Test A (`/public/assets/aistudio/the-owing-book-bilingual_c26528f8.txt` — 54 Paragraphs, 5 Windows)
| True 0-Based Paragraph Index (in 54-para file) | File Line Numbers (EN / BN) | True 12-Paragraph Window | English Source Excerpt | Original Bangla Translation Excerpt | Discrepancy Category |
|---|---|---|---|---|---|
| **`[Paragraph 1]`** *(P0 is title)* | Lines `13` / `122` | Window 0 (`[0..11]`) | `"It was her father’s door, green once..."` | `"সেটি ছিল তার বাবার দোকান, একসময় সবুজ ছিল..."` | Concrete object substitution (`door → দোকান` / shop) (`CONFIRMED IN CODE`) |
| **`[Paragraph 12]`** | Lines `35` / `144` | Window 1 (`[12..23]`) | `"...a thing that was there, that was consulted, that nobody explained."` | `"...একটা জিনিস যা সেখানে থাকত, যা দেখে পরামর্শ নেওয়া হতো..."` | Contextual verb mistranslation (`consulted a ledger → পরামর্শ নেওয়া হতো` / taking advice) (`CONFIRMED IN CODE`) |
| **`[Paragraph 15]`** | Lines `41` / `150` | Window 1 (`[12..23]`) | `"...a single word in brackets: (Fine.)"` | `"...বন্ধনীর ভেতর একটি মাত্র শব্দ: (জরিমানা।)"` | Contextual polyseme mistranslation (`Fine` as alright/waived vs. `জরিমানা` / monetary penalty) (`CONFIRMED IN CODE`) |
| **`[Paragraph 27]`** | Lines `67` / `176` | Window 2 (`[24..35]`) | `"She tore the loaf in two with the efficiency of a woman who had been doing it since four that morning. Steam rose from it like a small, warm ghost."` | `"সে চারটে থেকে পাউরুটি তৈরির অভিজ্ঞতায় অত্যন্ত দক্ষতার সাথে লোফটি দুই ভাগ করে ছিঁড়ল। ধোঁয়া উড়ছে তা থেকে, যেন একটা ছোট উষ্ণ ভূত।"` | Sensory noun substitution (`Steam → ধোঁয়া` / smoke instead of `ভাপ`) + baking phrasing distortion (`CONFIRMED IN CODE`) |
| **`[Paragraph 31]`** | Lines `75` / `184` | Window 2 (`[24..35]`) | `"...checking whether you were done. 'Water under the bridge,' she said finally. 'If we had a bridge. We’ve got a ditch and a plank.'"` | `"...তুমি পুরোপুরি শেষ হয়ে গেছ কি না। 'জল গড়িয়ে তো অনেক দূর গিয়েছে,' ... 'আমাদের আছে শুধু একটা নর্দমা আর একটা তক্তা।'"` | Idiom & object distortion (`done → পুরোপুরি শেষ`, lost `bridge` setup before joke, `ditch → নর্দমা` / sewer) (`CONFIRMED IN CODE`) |
| **`[Paragraph 39]`** | Lines `89` / `198` | Window 3 (`[36..47]`) | `"...and at the pair of boots by the door, which were his."` | `"...আর দরজার পাশে রাখা জুতোজোড়ার দিকে তাকাল, ওগুলো তারই ছিল।"` | Ambiguous pronoun (`তারই` obscures that the boots were her father's) (`CONFIRMED IN CODE`) |
| **`[Paragraph 48]`** | Lines `107` / `216` | Window 4 (`[48..53]`) | `"...with all the tact of a fist on a table..."` | `"...অনেকটা টেবিলের ওপর মুষ্টির ঘা মারার মতো বেকুবী নিয়ে।"` | Altered meaning (`tact` ironic understatement rendered as `বেকুবী` / foolishness) (`CONFIRMED IN CODE`) |
| **`[Paragraph 51]`** | Lines `113` / `222` | Window 4 (`[48..53]`) | `"...where she had carried it against her ribs like something that might catch cold."` | `"...যেন কোনো ঠান্ডা লেগে যাওয়া রুগ্ন কোনো বস্তু।"` | Altered modality (`might catch cold` -> already sick/cold `ঠান্ডা লেগে যাওয়া রুগ্ন`) (`CONFIRMED IN CODE`) |
| **`[Paragraph 52]`** | Lines `115` / `224` | Window 4 (`[48..53]`) | `"(Not fine. Paid.)"` | `"(ভালো নয়। পরিশোধিত।)"` | Contextual callback mismatch (`Not fine` rendered as `ভালো নয়`) (`CONFIRMED IN CODE`) |

#### Ground-Truth Targets in Test B (`/public/assets/aistudio/the-quiet-key-bilingual_b6d8786f.txt` — 47 Paragraphs, 4 Windows)
| True 0-Based Paragraph Index (in 47-para file) | File Line Numbers (EN / BN) | True 12-Paragraph Window | English Source Excerpt | Original Bangla Translation Excerpt | Discrepancy Category |
|---|---|---|---|---|---|
| **`[Paragraph 0]`** | Lines `9` / `104` | Window 0 (`[0..11]`) | `"The Quiet Key"` | `"নিস্তব্ধ চাবি"` | Piano key vs. door lock key polyseme (`চাবি` vs. `রিড/নোট/চাবি` musical pun) (`CONFIRMED IN CODE`) |
| **`[Paragraph 2]`** | Lines `13` / `108` | Window 0 (`[0..11]`) | `"...wet through to the bones of the week... In eighty-eight years Odile Brandt had saved a great deal of breath..."` | `"...যখন সারা সপ্তাহের ক্লান্তি হাড়ে হাড়ে অনুভূত হচ্ছে... আটত্রিশ বছরে ওডিল ব্র্যান্ডট এভাবেই অনেকটা দম জমিয়ে রেখেছিলেন..."` | **Two distinct errors in one paragraph:**<br>1. Numerical age mismatch: `eighty-eight (88) → আটত্রিশ (38)` (`TEST VERIFIED` by deterministic linter)<br>2. Imagery substitution: `wet through to the bones of the week → সারা সপ্তাহের ক্লান্তি` (fatigue instead of rain/wetness) (`CONFIRMED IN CODE`) |
| **`[Paragraph 17]`** | Lines `43` / `138` | Window 1 (`[12..23]`) | `"'It’s dead, Gran. Somebody’s jammed a tea towel in it.'"` | `"'এটা তো নষ্ট দিদা। কেউ একজন এর ভেতর লেমন ড্রিজল মোছার কাপড় ঢুকিয়ে রেখেছে।'"` | Unsupported object invention (`tea towel → লেমন ড্রিজল মোছার কাপড়` — before Pru even arrives with lemon drizzle cake in P20!) (`CONFIRMED IN CODE`) |
| **`[Paragraph 20]`** | Lines `49` / `144` | Window 1 (`[12..23]`) | `"Pru Lindqvist from number eleven came in sideways..."` | `"নয় নম্বর বাড়ি থেকে আসা প্রু লিন্ডকভিস্ট পাশের দিক দিয়ে ভেতরে ঢুকলেন..."` | Numerical address mismatch: `number eleven (11) → নয় নম্বর বাড়ি (9)` (`TEST VERIFIED` by deterministic linter) |
| **`[Paragraph 21]`** | Lines `51` / `146` | Window 1 (`[12..23]`) | `"...the corner of the tea towel showing between the strings..."` | `"...আর তারের মাঝে উঁকি দেওয়া লেমন ড্রিজল মোছার কাপড়ের কোণাটা।"` | Repeated unsupported object invention (`tea towel → লেমন ড্রিজল মোছার কাপড়`) (`CONFIRMED IN CODE`) |
| **`[Paragraph 26]`** | Lines `61` / `156` | Window 2 (`[24..35]`) | `"Eighty-seven of them, I mean. The eighty-eighth sat in the middle of the keyboard under its strip of tea towel..."` | `"আমি মোট সাতাশিটি নোট ঠিক করলাম। আটআশি নম্বর নোটটি কিবোর্ডের মাঝখানে সেই লেমন ড্রিজল মোছার কাপড়টির নিচে..."` | **1. Valid number (`Eighty-seven → সাতাশিটি = 87`)**: Must **NOT** be flagged as a numerical error (`TEST VERIFIED`).<br>**2. Repeated object invention**: `tea towel → লেমন ড্রিজল মোছার কাপড়` (`CONFIRMED IN CODE`). |
| **`[Paragraph 32]`** | Lines `73` / `168` | Window 2 (`[24..35]`) | `"I looked at the tea towel. 'And then?'"` | `"আমি লেমন ড্রিজল মোছার কাপড়টির দিকে তাকালাম। 'তারপর?'"` | Repeated unsupported object invention (`tea towel → লেমন ড্রিজল মোছার কাপড়`) (`CONFIRMED IN CODE`) |
| **`[Paragraph 38]` & `[Paragraph 40]`** | Lines `85, 89` / `180, 184` | Window 3 (`[36..46]`) | `"It was flat."` / `"Gran. It’s flat."` | `"এটি সুর থেকে বিচ্যুত।"` / `"দিদা। এটা সুর থেকে বিচ্যুত।"` | Musical pitch flattening rendered generically as `"সুর থেকে বিচ্যুত"` (`CONFIRMED IN CODE`) |

### 10.3 Reported Live Benchmark Summary & Properly Bounded Conclusions (`REPORTED, NOT REPRODUCED`)
The table below preserves the reported 2-run benchmark figures from the pre-compaction session, explicitly downgraded from `BENCHMARK OBSERVED` to `REPORTED, NOT REPRODUCED` because the raw background task stdout logs (`task-524` and `task-540`) were lost to context compaction and exhibit the paragraph-count discrepancy documented in Section 10.1:

| Reported Benchmark Case (from Pre-Compaction Summary) | True Disk Paragraph Count vs. Summary Count | Run 1 Score | Run 2 Score | Run 1 `isComplete` | Run 2 `isComplete` | Run 1 Severity (`H / M / L`) | Run 2 Severity (`H / M / L`) | Evidence Label |
|---|---|---|---|---|---|---|---|---|
| **Test A — *The Owing Book* (Original)** | Disk: `54` paras (`5` windows)<br>Summary: `23` paras (`2` windows) | **38%** | **54%** | `false` | `true` *(see DEF-02)* | `3 H / 9 M / 2 L` (14 total) | `0 H / 11 M / 2 L` (13 total) | `REPORTED, NOT REPRODUCED` |
| **Test B — *The Quiet Key* (Original)** | Disk: `47` paras (`4` windows)<br>Summary: `38` paras (`4` windows) | **44%** | **52%** | `false` | `false` | `5 H / 4 M / 0 L` (9 total: 7 AI + 2 det) | `5 H / 2 M / 0 L` (7 total: 5 AI + 2 det) | `REPORTED, NOT REPRODUCED` (Det. lint `2 High` is `TEST VERIFIED`) |
| **Clean Control 1 — *The Owing Book* (V2 Clean)** | Disk: `53` paras (`5` windows)<br>Summary: `23` paras (`2` windows) | **97%** | **96%** | `true` | `true` | `0 H / 0 M / 1 L` (1 total) | `0 H / 0 M / 1 L` (1 total) | `REPORTED, NOT REPRODUCED` |
| **Clean Control 2 (Summary) / Clockmaker Control (Historical 2B.8d-V)** | Clockmaker on disk: `5` paras (`1` window)<br>Summary: `"Quiet Key Clean"` (`38` paras) | **99%** | **99%** | `true` | `true` | `0 H / 0 M / 0 L` (0 total) | `0 H / 0 M / 0 L` (0 total) | `REPORTED, NOT REPRODUCED` / `UNKNOWN / NOT VERIFIED` |

#### Evidence-Bounded Conclusion on Windowed Auditing
- **What the evidence supports**:
  1. **Deterministic numerical verification (`TEST VERIFIED`)**: `lintChapterNumericalConsistency` deterministically catches `eighty-eight → আটত্রিশ` (`P2` of *The Quiet Key*) and `number eleven → নয় নম্বর বাড়ি` (`P20` of *The Quiet Key*) while correctly accepting `eighty-seven → সাতাশিটি` (`P26` of *The Quiet Key*).
  2. **Deterministic windowing & index remapping (`TEST VERIFIED` in `lib/terminology.test.ts:16500–17307`)**: Unit tests verify that `splitParagraphsIntoStage5Windows` partitions chapters into 12-paragraph windows and preserves/remaps global 0-based paragraph indices across multi-window reconciliation.
  3. **Live multi-window detection on tested baselines (`REPORTED, NOT REPRODUCED`)**: In the reported live benchmark runs, selected known semantic and factual targets were detected across the tested windows in the evaluated baselines.
- **What must NOT be overgeneralized**:
  - This evidence **does not prove** that 12-paragraph windowing universally eliminates long-chapter attention drop-off across arbitrary literary manuscripts or untested error types.
  - Furthermore, because the pre-compaction summary recorded conflicting paragraph counts (`23` vs. `54` and `38` vs. `47`) and raw logs from `task-524`/`task-540` are no longer inspectable, a fresh, logged benchmark execution against the verified 54-, 47-, 5-, and 53-paragraph disk artifacts should be run as part of Milestone 2B.8d-F closure.

---

## 11. Known Defects, Risks & Technical Debt Register

Below is the complete, prioritized register of defects and architectural risks identified during the read-only audit:

| ID | Priority | Category | Location (`File:Lines`) | Technical Description & Impact | Evidence | Recommended Fix & Review Guidance (for Milestone 2B.8d-F) |
|---|---|---|---|---|---|---|
| **DEF-01** | **P0 (Blocker)** | Production Build / TypeScript | `/lib/gemini-service.ts:2586–2589`, `/lib/types.ts:182–183` | `existing.englishExcerpt`, `calibrated.englishExcerpt`, `existing.banglaExcerpt`, and `calibrated.banglaExcerpt` are `string \| undefined` in `VerificationIssue`, but passed directly to `normalizeEnglishTerm(text: string)` and `normalizeBanglaUnicode(text: string)`. Breaks `npm run build` (`next build`). | `CONFIRMED IN CODE`, `TEST VERIFIED` | Pass nullish-coalesced strings (`existing.englishExcerpt ?? ''`, etc.) at `/lib/gemini-service.ts:2586–2589` or widen parameter types in `normalizeEnglishTerm` / `normalizeBanglaUnicode` to `string \| undefined \| null`. |
| **DEF-02** | **P1 (High)** | Completion Semantics (`verifyTranslationAccuracy`) | `/lib/gemini-service.ts:2669–2678` | `rawIsComplete` trusts `allWindowsReportedComplete` whenever Gemini returns `isComplete: true` on each window. Because `isComplete` is required by `STAGE5_RESPONSE_SCHEMA`, the model returns `isComplete: true` even when emitting `11` `medium` issues (`54%` score on Test A Run 2), bypassing the `unresolvedMediumCount <= 2` branch and marking a `54%` chapter as `isComplete: true`. | `CONFIRMED IN CODE`, `REPORTED, NOT REPRODUCED` | Separate **Translation Coverage**, **Audit Completion**, and **Editorial Acceptance** (Section 7.1). If a chapter-level acceptance policy (such as the proposed candidate `unresolvedHighCount === 0 && unresolvedMediumCount <= 2 && overallScore >= 80`) is adopted after product agreement, enforce it deterministically rather than trusting the model's per-window `isComplete` boolean. |
| **DEF-03** | **P1 (High)** | Completion Semantics (`baseIsComplete` & Issue Resolution) | `/lib/terminology.ts:4255–4276`, `/lib/chunker.ts:977–1039, 1121–1139` | (1) In `mergeVerificationReportWithTerminologyLint`, `Boolean(aiReport.isComplete ?? true) \|\| aiHadHighIssues` forces `baseIsComplete = true` whenever `aiHadHighIssues` is true, losing other reasons `aiReport.isComplete` was `false`. (2) `resolveVerificationIssue` calls `getPipelineCompletionState`, which ignores `unresolvedMediumCount` and `overallScore`. | `CONFIRMED IN CODE` | Unify completion/acceptance calculation into a single pure helper used across `verifyTranslationAccuracy`, `mergeVerificationReportWithTerminologyLint`, and `resolveVerificationIssue`, with distinct flags for `isFullyTranslated`, `isAuditComplete`, and `isEditoriallyAccepted`. |
| **DEF-04** | **P2 (Medium)** | Severity Calibration Repeatability & Benchmark Overfitting Risk | `/lib/gemini-service.ts:2182–2392` | (1) In Test A Run 2, concrete substitutions (`door → দোকান`, `steam → ধোঁয়া`, `"Fine" → জরিমানা`) were reported as `medium` rather than `high` when model wording varied slightly. (2) Conversely, `calibrateLiveStage5AiIssue` (`/lib/gemini-service.ts:2270–2372`) already contains story-specific regexes matching phrases from *The Owing Book* and *The Quiet Key*. Adding more target-specific regexes risks **overfitting to the benchmark stories**. | `CONFIRMED IN CODE`, `REPORTED, NOT REPRODUCED` | **External Reviewer Question:** Rather than adding story-specific lexical regexes to `calibrateLiveStage5AiIssue`, should GolpoTranslate use a general evidence-based severity rule (e.g., structured schema fields classifying error subtype `concrete_noun_substitution \| numeric_mismatch \| clause_omission \| unsupported_addition \| pragmatic_inversion \| stylistic_calque` that map deterministically to `high`/`medium`/`low`)? |
| **DEF-05** | **P2 (Medium)** | Duplicate Penalty for Same Numerical Discrepancy (Deterministic + AI) | `/lib/terminology.ts:4165–4250` | When a paragraph has an explicit numerical error (e.g., `88 → 38` on `P2` or `11 → 9` on `P20` of *The Quiet Key*), both `lintChapterNumericalConsistency` (`deterministic_lint`) and Gemini (`ai_audit`) can emit a `high` `mistranslation` issue for the same number, deducting `-16` (`2 × -8`) instead of `-8` and rendering duplicate issue cards. | `CONFIRMED IN CODE`, `REPORTED, NOT REPRODUCED` | In `mergeVerificationReportWithTerminologyLint`, merge an `ai_audit` issue into a `deterministic_lint` numerical issue **only when both refer to the same actual numerical discrepancy** (matching `paragraphIndex` AND matching the same expected/detected numerical value or overlapping numerical token span in `englishExcerpt`/`banglaExcerpt` or `description`), **never** merely because they share a `paragraphIndex` (e.g., `P2` of *The Quiet Key* has both `88 → 38` and the unrelated metaphor error `wet through to the bones of the week`, which must remain separate). |
| **DEF-06** | **P2 (Medium)** | UI Status Conflation & Badge Mislabeling | `/components/VerificationAndEditorialPanel.tsx:66–81, 161–169, 217–224` | (1) Top badge shows `Complete & Verified` even when `overallScore` is `54%` with 11 medium issues. (2) Completeness card labels editorial issues as `Action Required (Incomplete)` vs `100% Translated (Complete)`, conflating translation coverage with editorial acceptance. (3) Deterministic numerical issues (`termId: "numerical:..."`) display the purple badge `Glossary Rule Check` instead of `Numerical Fact Check`. | `CONFIRMED IN CODE` | Separate **Translation Coverage** (`N/N Paragraphs Translated`) from **Editorial Acceptance** (`Verified` vs `Needs Editorial Review`), and render `Numerical Fact Check` when `issue.termId?.startsWith('numerical:')`. |
| **DEF-07** | **P3 (Low)** | Monolithic File Size in Core Modules | `/lib/terminology.ts` (11,155 lines), `/lib/gemini-service.ts` (2,720 lines), `/components/WorkspaceView.tsx` (2,750 lines) | High line counts in three core files increase cognitive load and merge conflict surface area, although logic is well-covered by unit tests (`194/194`). | `CONFIRMED IN CODE` | Defer modular extraction until after Milestone 2B.9 so existing line-level regression tests remain stable. |

---

## 12. Readiness Assessment, Open Questions for External Review & Recommended Next Milestone

### 12.1 Readiness Assessment for Milestone 2B.9 (`CONDITIONAL PASS`)
- **What is Verified in Code and Tests (`CONFIRMED IN CODE` & `TEST VERIFIED`)**:
  1. **12-Paragraph Windowed Stage 5 Architecture (`splitParagraphsIntoStage5Windows`)**: Deterministic window partitioning (`STAGE5_DEFAULT_WINDOW_SIZE = 12`) and global 0-based index remapping are implemented and verified by unit tests (`194/194` passing).
  2. **Deterministic Terminology & Numerical Layers**: `lintChapterTerminology` and `lintChapterNumericalConsistency` deterministically detect explicit glossary violations and numerical mismatches (`88 → 38` at `P2` and `number 11 → 9` at `P20` of *The Quiet Key*) while excluding idioms and accepting valid Bangla numbers (`eighty-seven → সাতাশিটি` at `P26` of *The Quiet Key*) (`TEST VERIFIED`).
- **Why Milestone 2B.9 (Controlled Retranslation) Should Wait for Corrective Sub-Milestone 2B.8d-F**:
  1. `npm run build` (`next build`) currently fails with a TypeScript error at `/lib/gemini-service.ts:2586:43` (`DEF-01`).
  2. `VerificationReport.isComplete` currently conflates translation coverage, audit completion, and editorial acceptance (`DEF-02`, `DEF-03`), allowing chapters with `54%` score and `11` medium issues to be marked `isComplete: true`.
  3. Same-discrepancy numerical issues emitted by both `deterministic_lint` and `ai_audit` are not deduplicated (`DEF-05`).
  4. Because pre-compaction benchmark logs had paragraph-count discrepancies (`Section 10.1`), a clean, logged benchmark verification run against the verified `54`-, `47`-, `5`-, and `53`-paragraph artifacts on disk should be recorded after applying the 2B.8d-F fixes.

### 12.2 Specific Questions for Independent External Review (Claude)
1. **Completion & Acceptance Model (`DEF-02`, `DEF-03`, `DEF-06`)**:
   - Should `VerificationReport` replace or supplement `isComplete: boolean` with three explicit fields—`translationCoverageComplete: boolean`, `auditComplete: boolean`, and `editorialAcceptanceStatus: 'accepted' | 'needs_review' | 'rejected'`?
   - For the **proposed editorial acceptance policy** (`unresolvedHighCount === 0 && unresolvedMediumCount <= 2 && overallScore >= 80`), should the medium-issue allowance and score floor be fixed per chapter or normalized by chapter paragraph count (given 5-paragraph vs. 54-paragraph chapters)?
2. **Generalizing Severity Calibration Without Overfitting (`DEF-04`)**:
   - How should `calibrateLiveStage5AiIssue` (`/lib/gemini-service.ts:2182–2392`) be refactored to remove story-specific regexes (e.g., `door/দোকান`, `steam/ধোঁয়া`, `tea towel/লেমন ড্রিজল`) while maintaining consistent `high` vs. `medium` severity calibration? Would adding a required `errorCategory` enum (`concrete_entity_substitution`, `invented_detail`, `clause_omission`, `numeric_factual_mismatch`, `pragmatic_meaning_inversion`, `idiom_calque`, `tone_register_drift`) to `STAGE5_RESPONSE_SCHEMA` allow deterministic severity mapping without story-specific regexes?
3. **Same-Discrepancy Numerical Deduplication (`DEF-05`)**:
   - Is matching on `(paragraphIndex, expectedNumericValue / overlapping Bangla token)` sufficient to merge duplicate deterministic + AI numerical findings without accidentally suppressing co-occurring non-numerical errors in the same paragraph (such as `P2` of *The Quiet Key*)?

### 12.3 Recommended Scope for Corrective Milestone 2B.8d-F (Pre-2B.9 Gate)
1. **Fix `next build` TypeScript compile error (`DEF-01`)** at `/lib/gemini-service.ts:2586–2589` by coalescing optional `englishExcerpt` and `banglaExcerpt` to `''`.
2. **Separate Coverage, Audit Completion, and Editorial Acceptance (`DEF-02`, `DEF-03`, `DEF-06`)** across `/lib/gemini-service.ts`, `/lib/terminology.ts`, `/lib/chunker.ts`, and `/components/VerificationAndEditorialPanel.tsx`, implementing the agreed editorial acceptance policy and fixing `baseIsComplete`.
3. **Deduplicate Same-Discrepancy Numerical Issues (`DEF-05`)** in `mergeVerificationReportWithTerminologyLint` only when both issues refer to the same underlying numerical discrepancy in the same paragraph, and replace benchmark-specific severity regexes with a general evidence-based rule (`DEF-04`).
4. **Re-run and archive raw benchmark logs** on the verified on-disk baselines (`54`-paragraph *Owing Book V1*, `47`-paragraph *Quiet Key*, `5`-paragraph *Clockmaker*, and `53`-paragraph *Owing Book V2*).

---

## Appendix: Self-Contained Reference Material for External Review

### A.1 Critical Source Code Excerpts (`CONFIRMED IN CODE`)

#### Excerpt 1: Window Splitting (`splitParagraphsIntoStage5Windows`, `/lib/gemini-service.ts:1924–1974`)
```ts
// /lib/gemini-service.ts:1924-1974
export function splitParagraphsIntoStage5Windows(
  englishParagraphs: string[],
  banglaParagraphs: string[],
  windowSize: number = STAGE5_DEFAULT_WINDOW_SIZE
): Stage5AuditWindow[] {
  const effectiveWindowSize = Math.max(1, Math.floor(windowSize || STAGE5_DEFAULT_WINDOW_SIZE));
  const maxLen = Math.max(englishParagraphs.length, banglaParagraphs.length);

  if (maxLen === 0) {
    return [
      {
        windowIndex: 0,
        totalWindows: 1,
        startParagraphIndex: 0,
        endParagraphIndex: 0,
        englishParagraphs: [],
        banglaParagraphs: [],
      },
    ];
  }

  const totalWindows = Math.ceil(maxLen / effectiveWindowSize);
  const windows: Stage5AuditWindow[] = [];

  for (let w = 0; w < totalWindows; w++) {
    const startParagraphIndex = w * effectiveWindowSize;
    const endExclusive = Math.min(startParagraphIndex + effectiveWindowSize, maxLen);
    const endParagraphIndex = endExclusive - 1;

    windows.push({
      windowIndex: w,
      totalWindows,
      startParagraphIndex,
      endParagraphIndex,
      englishParagraphs: englishParagraphs.slice(startParagraphIndex, endExclusive),
      banglaParagraphs: banglaParagraphs.slice(startParagraphIndex, endExclusive),
    });
  }

  return windows;
}
```

#### Excerpt 2: Window Execution, Index Remapping & Deduplication (`verifyTranslationAccuracy`, `/lib/gemini-service.ts:2500–2603`)
```ts
// /lib/gemini-service.ts:2500-2603
      for (const rawIssue of rawIssues) {
        const rawParagraphIndex =
          typeof rawIssue?.paragraphIndex === 'number' && Number.isFinite(rawIssue.paragraphIndex)
            ? Math.trunc(rawIssue.paragraphIndex)
            : -1;

        let paragraphIndex = rawParagraphIndex;
        if (
          paragraphIndex < win.startParagraphIndex ||
          paragraphIndex > win.endParagraphIndex
        ) {
          if (
            win.startParagraphIndex > 0 &&
            rawParagraphIndex >= 0 &&
            rawParagraphIndex < win.englishParagraphs.length
          ) {
            paragraphIndex = win.startParagraphIndex + rawParagraphIndex;
          }
        }

        const isValidIndex =
          paragraphIndex >= win.startParagraphIndex &&
          paragraphIndex <= win.endParagraphIndex &&
          paragraphIndex < maxParagraphCount;
        if (!isValidIndex) continue;
        // ...
        const calibrated = calibrateLiveStage5AiIssue(
          candidateIssue,
          englishParagraphs[paragraphIndex] || '',
          banglaParagraphs[paragraphIndex] || ''
        );
        if (!calibrated) continue;

        const normEn = normalizeEnglishTerm(calibrated.englishExcerpt || '').toLowerCase();
        const normBn = normalizeBanglaUnicode(calibrated.banglaExcerpt || '');
        const exactKey = `${calibrated.paragraphIndex}::${calibrated.type}::${normEn || normBn || calibrated.description.slice(0, 48).toLowerCase()}`;

        if (!dedupedByKey.has(exactKey)) {
          dedupedByKey.set(exactKey, calibrated);
          continue;
        }
        const existing = dedupedByKey.get(exactKey)!;
        const exEn = normalizeEnglishTerm(existing.englishExcerpt).toLowerCase(); // <-- Line 2586: TypeScript build error
        const calEn = normalizeEnglishTerm(calibrated.englishExcerpt).toLowerCase();
        const exBn = normalizeBanglaUnicode(existing.banglaExcerpt);
        const calBn = normalizeBanglaUnicode(calibrated.banglaExcerpt);
```

#### Excerpt 3: Chapter-Level Score & Completion Enforcement (`verifyTranslationAccuracy`, `/lib/gemini-service.ts:2644–2678`)
```ts
// /lib/gemini-service.ts:2644-2678
  const totalIssuePenalty = mergedIssues.reduce(
    (sum, issue) => sum + getVerificationIssueScorePenalty(issue),
    0
  );
  const maxAllowedScoreByIssues = Math.max(0, 100 - totalIssuePenalty);

  const rawScore =
    windowScores.length > 0
      ? Math.round(windowScores.reduce((a, b) => a + b, 0) / windowScores.length)
      : maxAllowedScoreByIssues;

  let enforcedScore = Math.max(
    0,
    Math.min(100, Math.min(rawScore, maxAllowedScoreByIssues))
  );

  if (hasMissingParagraphs) {
    enforcedScore = Math.min(enforcedScore, 65);
  } else if (unresolvedHighCount > 0) {
    enforcedScore = Math.min(enforcedScore, 79);
  }

  const rawIsComplete = allWindowsReportedComplete
    ? true
    : anyWindowOmittedComplete
      ? unresolvedHighCount === 0 && unresolvedMediumCount <= 2
      : false;

  const enforcedIsComplete =
    rawIsComplete &&
    allWindowsHadValidIssuesArray &&
    !hasMissingParagraphs &&
    unresolvedHighCount === 0;
```

#### Excerpt 4: Deterministic Merge & `baseIsComplete` (`mergeVerificationReportWithTerminologyLint`, `/lib/terminology.ts:4249–4297`)
```ts
// /lib/terminology.ts:4249-4297
  const hasMissingTranslations = paragraphs.some(
    (p) => p.sourceText.trim().length > 0 && !isSceneBreakParagraph(p.sourceText) && p.translatedText.trim().length === 0
  );

  const baseIsComplete = (() => {
    if (!aiReport) return true;
    if (typeof (aiReport as VerificationReport & { baseIsComplete?: boolean }).baseIsComplete === 'boolean') {
      return Boolean((aiReport as VerificationReport & { baseIsComplete?: boolean }).baseIsComplete);
    }
    const aiHadHighIssues = (aiReport.issues || []).some(
      (issue) => issue.source !== 'deterministic_lint' && issue.severity === 'high'
    );
    return Boolean(aiReport.isComplete ?? true) || aiHadHighIssues;
  })();

  const isComplete =
    baseIsComplete &&
    !hasUnresolvedHigh &&
    !hasMissingTranslations;
```

### A.2 Key Function Index (`CONFIRMED IN CODE`)
| Module | Function Name | Line Range | Responsibility |
|---|---|---|---|
| `/lib/gemini-service.ts` | `generateJsonWithModelFallback` | `70–106` | Iterates model fallback chain (`STAGE5_MODELS` or `FALLBACK_MODELS`) on transient API errors. |
| `/lib/gemini-service.ts` | `analyzeStoryUnderstanding` | `1357–1504` | Stage 1 windowed story understanding, character & glossary extraction. |
| `/lib/gemini-service.ts` | `analyzeAuthorVoice` | `1506–1575` | Stage 2 author voice & Bangla stylistic blueprint analysis. |
| `/lib/gemini-service.ts` | `translateChunkFaithfully` | `1577–1764` | Stage 3 faithful literary chunk translation with paragraph-count repair. |
| `/lib/gemini-service.ts` | `runLiteraryEditingPass` | `1766–1904` | Stage 4 literary rhythm & voice polish pass. |
| `/lib/gemini-service.ts` | `splitParagraphsIntoStage5Windows` | `1924–1974` | Splits aligned chapter paragraphs into 12-paragraph windows with global indices. |
| `/lib/gemini-service.ts` | `buildStage5VerificationPrompt` | `2043–2176` | Builds Stage 5 prompt with `[Paragraph i]` headers, 6 per-paragraph checks, and Categories A–H. |
| `/lib/gemini-service.ts` | `calibrateLiveStage5AiIssue` | `2182–2392` | Filters false positives (e.g., `87 = সাতাশি`) and calibrates live AI issue severity. |
| `/lib/gemini-service.ts` | `verifyTranslationAccuracy` | `2394–2693` | Stage 5 multi-window execution, index normalization, deduplication, and report aggregation. |
| `/lib/gemini-service.ts` | `refineSingleParagraph` | `2695–2720` | Single-paragraph targeted AI retranslation / refinement. |
| `/lib/terminology.ts` | `normalizeBanglaUnicode` | `439–450` | Bangla NFC + Nukta + zero-width normalization. |
| `/lib/terminology.ts` | `normalizeStage5IssueType` | `3698–3729` | Coerces raw AI issue types to the 6 canonical `VerificationIssueType` values. |
| `/lib/terminology.ts` | `normalizeStage5IssueSeverity` | `3735–3762` | Coerces and escalates raw AI issue severities. |
| `/lib/terminology.ts` | `getVerificationIssueScorePenalty` | `3764–3780` | Returns score deduction per open issue (`high: 8`, `medium: 4`, `low: 1`). |
| `/lib/terminology.ts` | `lintChapterTerminology` | `3920–4155` | Deterministic glossary enforcement across aligned paragraphs. |
| `/lib/terminology.ts` | `mergeVerificationReportWithTerminologyLint` | `4165–4298` | Merges AI issues with deterministic terminology & numerical lint issues and computes score/completion. |
| `/lib/terminology.ts` | `reconcileStage5ResultWithLatestState` | `7751–7965` | Re-evaluates open Stage 5 issues and deterministic lints after paragraph or glossary edits. |
| `/lib/terminology.ts` | `parseBanglaNumericalTokens` | `9820–10055` | Extracts cardinal, ordinal, digit, and multiplier numbers from Bangla text. |
| `/lib/terminology.ts` | `parseEnglishNumericalExpressions` | `10060–10480` | Extracts numbers, ages, counts, ordinals, and addresses from English text (with idiom exclusions). |
| `/lib/terminology.ts` | `lintChapterNumericalConsistency` | `10920–11050` | Deterministic chapter-wide English-to-Bangla numerical comparison. |
| `/lib/chunker.ts` | `chunkTextByParagraphs` | `289–366` | Splits chapter text into paragraph-aligned chunks for Stage 3. |
| `/lib/chunker.ts` | `mergeStage3ChunkProgress` | `440–528` | Incrementally merges completed Stage 3 chunks into chapter state. |
| `/lib/chunker.ts` | `applyContinuousBanglaEdit` | `725–815` | Validates paragraph and scene-break parity before applying continuous Bangla text edits. |
| `/lib/chunker.ts` | `getPipelineCompletionState` | `977–1039` | Computes pipeline stage completion flags from chapter state. |
| `/lib/chunker.ts` | `applyStage4EditsToParagraphs` | `1148–1217` | Applies Stage 4 edits with terminology and scene-break guardrails. |
| `/components/WorkspaceView.tsx` | `createWorkspaceStageExecutors` | `1950–2485` | Orchestrates Stages 1–5 with in-flight state reconciliation (`getLatestState`). |
