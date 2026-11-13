# GolpoTranslate — PPH-4.4 Implementation Plan (Compound-Noun Boundary Enforcement)

**Prepared by:** Muse (project lead)
**Date:** 13 November 2026
**Milestone:** PPH-4.4 — Compound-Noun Boundary Enforcement (Defect D-03)
**Governing documents:** `PPH-4-Engineering-Specification.md` §5; `PPH-4-Final-Readiness-Verification.md` (test registry, Step 2 of the implementation order); `PPH-4-Generalization-Gate.md` (B-SPEC cases)
**Status:** PLAN ONLY — implementation is NOT authorized. The owner authorizes implementation separately.

---

## 1. Scope — D-03 only

PPH-4.4 fixes exactly one defect class: **compound-noun glossary bleed** (D-03, story-02 [P11, P41]).

- **[P11] (Stage 4 corruption):** English `"...two cancelled promissory notes from the Sylhet timber lease..."` — Stage 3 accurately rendered `"সিলেটের কাঠের ইজারার"`. Stage 4 overwrote it with `"সিলেটের টিম্বার ট্রাস্টের"`.
- **[P41] (Stage 3 corruption, kept in Stage 4):** English `"...over the timber brokerage..."` — rendered with `"টিম্বার ট্রাস্ট"`.
- **Root cause (confirmed):** the glossary item `"timber trust -> টিম্বার ট্রাস্ট"` (discovered in Chunk 2, [P30, P31]) was (a) injected into Stage 3 Chunk 3's prompt where it legitimately belonged ([P48] contains "timber trust") but the model over-applied it to the sibling compound "timber brokerage" in [P41]; and (b) dumped into **every** Stage 4 window — including Window 1 ([P01–P20]), where "timber trust" never occurs — so Stage 4 applied it to "Sylhet timber lease" in [P11]. No target-side check caught either, because the linter only validates glossary terms whose English source occurs in the paragraph.

**Out of scope (explicitly):**
- `deriveBaseMotifFromNumberedTerm` ("seventy cold nights" → "cold nights"). The spec's §8 table lists it next to the PPH-4.4 items, but the Readiness Verification's PPH-4.4 registry (T-4.4-01..03, all D-03) does not include it, and the spec's §7 tier table assigns it to D-08..D-14 — PPH-4.2 continuity work. It belongs to PPH-4.2, not this milestone.
- PPH-4.5, PPH-4.3, PPH-4.2. No Set C access. No Protocol 3A execution. No benchmark expectation changes.
- The deferred `'balanced'` test-type cleanup from PPH-4.1 stays deferred.

## 2. Verified code anchors (current post-PPH-4.1 code — use these, not the spec's numbers)

The spec's line citations for PPH-4.4 are wrong in several places, as they were for PPH-4.1. Verified by Muse against the pushed code (commit `5102b33`):

| Item | Spec says | Verified (current code) |
|---|---|---|
| `findEnglishTermOccurrences` | terminology.ts:1453 | **:1453 — correct** |
| `findBanglaTermOccurrences` | (not cited) | **terminology.ts:1688** |
| `filterGlossaryForChunk` | §8 table: L1834–1876 | **starts :1810** |
| `lintParagraphTerminology` | §5.2: :2345 | **starts :2131** (:2345 is inside the function) |
| `sanitizeStage4EditedParagraph` | §5.2: :2407 | **gemini-service.ts:2363** |
| `runLiteraryEditingPass` | §5.1: :2527 | **gemini-service.ts:2561** |
| `buildStage4WindowLintGuidanceBlock` | §8 table: L2252–2304 | **:2300** (shifted by PPH-4.1) |
| Stage 4 memory block (Layer 1 defect) | "line 2527" | **built once at :2623–2627, before the window loop, from the FULL `hydratedGlossary`** — confirmed by reading the code |

**Signature corrections (the spec's prose gets these wrong):**
- `lintParagraphTerminology` takes `(paragraph: ParagraphPair, glossary, options)` — **not** `(englishParagraph, banglaParagraph, glossary)` as §5.2 writes it.
- `filterGlossaryForChunk` takes `(chunkParagraphs: ReadonlyArray<string>, glossary, options)` — the first argument is a **paragraph array**, not a single text string as §5.2's Layer 1 prose implies. Pass the window's English paragraphs array.

**Fail-before evidence (verified by Muse on the current code):** `lintParagraphTerminology` on the corrupted [P11] pair (English "Sylhet timber lease", Bangla containing "টিম্বার ট্রাস্টের", glossary holding "timber trust -> টিম্বার ট্রাস্ট") returns **0 findings** — the false negative is real. The PPH-4.4 functions (`detectSiblingCompoundCollisions`, `findUngroundedGlossaryInjections`, `compound_headword_bleed`) do not exist anywhere in the code — PPH-4.4 has not started.

## 3. The three layers (spec §5.2, adapted to the verified anchors)

### Layer 1 — Window-scoped glossary filtering for Stage 4
In `runLiteraryEditingPass` (:2561), stop building one memory block from the full glossary at :2623–2627. For each Stage 4 window $W_j$, filter the glossary with `filterGlossaryForChunk(win.englishParagraphs, hydratedGlossary)` and build that window's memory block from the filtered glossary only. Effect: "timber trust" never reaches Window 1 ([P01–P20]), eliminating the [P11] corruption at the source, while windows containing [P30, P31, P48] still receive it. Apply the same window-filtered glossary to the pre-window lint call (`lintChapterTerminology`, :2678) so the lint guidance matches what the window actually sees. **Keep the full glossary** at the `sanitizeStage4EditedParagraph` call (:2862) — Layer 3's ungrounded-injection check needs the full glossary to detect the injection.

### Layer 2 — Sibling compound collision detection + prompt injection
New `detectSiblingCompoundCollisions` in `lib/terminology.ts`: given the active glossary terms and a chunk/window's English text, find multi-word glossary terms $G$ = [modifier $M_1$ … head $H_G$] (e.g. "timber trust") and scan the same text for sibling compounds sharing the leading modifier $M_1$ with a different head noun $H_S \neq H_G$ ("timber lease", "timber brokerage", "timber yard"). When a sibling is detected, inject a `[COMPOUND-NOUN HEADWORD BOUNDARY RULE]` into the Stage 3 and Stage 4 prompts, following the PPH-4.1 pattern: a module-private builder in `lib/gemini-service.ts` next to `buildVerbatimAndMeasurementPromptBlock` (:1942), called from `translateChunkFaithfully` and `runLiteraryEditingPass`. The rule names the exact phrase the glossary entry applies to and the sibling phrases it must NOT be applied to.

### Layer 3 — Target-side ungrounded glossary injection guard + Stage 4 auto-revert
Extend `lintParagraphTerminology` (:2131) with a reverse (target-to-source) check using the existing `findBanglaTermOccurrences` (:1688) and `findEnglishTermOccurrences` (:1453): for every multi-word glossary item, if its Bangla target occurs in the Bangla paragraph, its English source (or an alias) does **not** occur in the English paragraph, **and** the English paragraph contains a sibling phrase sharing a content word with the source — emit a `TerminologyLintIssue` with `code: 'compound_headword_bleed'`. Then extend `sanitizeStage4EditedParagraph` (:2363) following the PPH-4.1 verbatim-restoration pattern: if the Stage 4 candidate triggers `compound_headword_bleed` and the Stage 3 draft does not, reject the substitution and keep Stage 3's rendering.

## 4. Tests and acceptance bar

**Set A (from the Readiness Verification registry — governs over the spec's §9 matrix):**

| Test | Defect | What it proves |
|---|---|---|
| T-4.4-01 | D-03, story-02 [P11, P41] | `detectSiblingCompoundCollisions` detects "Sylhet timber lease" and "timber brokerage" as sibling compounds colliding with "timber trust -> টিম্বার ট্রাস্ট"; `lintParagraphTerminology` flags "টিম্বার ট্রাস্ট" in [P11] and [P41] with `code: 'compound_headword_bleed'` |
| T-4.4-02 | D-03, story-02 [P11] | `sanitizeStage4EditedParagraph` rejects Stage 4's "সিলেটের টিম্বার ট্রাস্টের" and restores Stage 3's "সিলেটের কাঠের ইজারার" |
| T-4.4-03 | D-03, story-02 [P01–P20] vs [P30, P31, P48] | Window-scoped glossary filtering excludes "timber trust -> টিম্বার ট্রাস্ট" from Window 1 while including it in windows containing [P30, P31, P48] |

**Acceptance bar: 219/219** (216 current + 3 new), compile + lint clean.

**B-SPEC (Generalization Gate):** positives B-4.4-P1 ("salt syndicate" bleeding into "salt pans" / "salt tariff") and B-4.4-P2 ("Tea Board" bleeding into "tea auctions") must go 0/2 → 2/2. Negatives B-4.4-N1 (registered alias "Port Commissioners" for "Calcutta Port Commissioners"), B-4.4-N2 ("salt syndicate" in glossary + accurately translated "salt barge -> লবণের বজরা" in the same paragraph), and B-4.4-N3 ("He sprinkled salt on the boiled potatoes" → "সে সেদ্ধ আলুতে লবণ ছিটিয়ে দিল" with "salt syndicate" in the glossary) must stay 3/3 with 0 false positives. The negatives constrain the design: the guard fires only when the multi-word glossary **target actually appears in the Bangla** while its English source is absent **and** a sibling compound is present — a lone shared word ("salt") is never enough.

**Regression guards:** all 212 legacy tests and all 4 PPH-4.1 tests keep passing. The other 24 Set A tests must still fail-before (expected — their milestones are not implemented).

## 5. Sequence

1. `install_applet_dependencies`; confirm **216/216** before any code change.
2. Implement Layer 2's pure function (`detectSiblingCompoundCollisions`) + Layer 3's guard (`findUngroundedGlossaryInjections` inside `lintParagraphTerminology`) + tests T-4.4-01..03 (fail-before first, then pass-after).
3. Implement Layer 1 (per-window glossary filtering in `runLiteraryEditingPass`) + Layer 2's prompt injection + Layer 3's sanitizer auto-revert.
4. Full suite (**219/219**), compile, lint, B-SPEC positive/negative checks.
5. Implementation report (§6 below): files changed, test output, before/after proof on story-02 [P11] and [P41], and any deviations from this plan.

## 6. Implementation report (required contents)

Files changed with pre/post SHA-256 hashes; the frozen PPH-3 archive untouched; 216/216 pre-change baseline; 219/219 post-change; T-4.4-01..03 fail-before (0/3) and pass-after (3/3); B-SPEC P1/P2 and N1/N2/N3 results; before/after on [P11] (Stage 4 corruption reverted) and [P41]; deviations, if any, listed explicitly.

## 7. Risks, stop conditions, rollback

- **Over-matching siblings:** "timber" is a common modifier; a naive shared-word rule would flag legitimate distinct terms. Mitigation: the guard requires all three conditions (target in Bangla + source absent in English + sibling compound present), and the three B-SPEC negatives pin the boundary. If a negative fails, narrow the sibling definition (multi-word compound only, leading-modifier match) rather than weakening the guard.
- **Window filtering dropping needed terms:** a term whose English appears anywhere in the window must stay; T-4.4-03 pins both the exclusion (Window 1) and the inclusion ([P30, P31, P48] windows). Aliases count as occurrences.
- **Structural change risk (Layer 1):** the memory block moves from once-before-the-loop to per-window. If the per-window construction breaks the prompt shape, revert to the pre-change construction and report — do not improvise a different injection point.
- **Stop conditions:** any regression in the 216 baseline tests; any false positive on B-4.4-N1/N2/N3; any deviation from this plan's scope — stop and report instead of improvising.
- **Rollback:** revert the touchpoints (`filterGlossaryForChunk` call site in `runLiteraryEditingPass`, the new Layer 2/3 code, the prompt builder); the frozen PPH-3 archive is never modified.

## 8. Hard boundaries — NOT authorized by this plan

This plan authorizes **planning only**. Implementation requires the owner's separate authorization. When authorized, the implementation itself must not touch: PPH-4.5, PPH-4.3, PPH-4.2; the frozen PPH-3 archive; Set C; Protocol 3A execution; benchmark expectations; or any prompt change beyond the single `[COMPOUND-NOUN HEADWORD BOUNDARY RULE]` injection in §3.
