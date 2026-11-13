# Authorization: PPH-4.4 Implementation — Compound-Noun Boundary Enforcement

**Authorized by:** Musabbir Rahman (owner), 13 November 2026
**Project:** GolpoTranslate
**Scope:** PPH-4.4 ONLY, as specified in `GolpoTranslate-PPH4.4-Implementation-Plan.md` (Muse, project lead, 13 November 2026).

**Roles**
- Project leadership and coordination: Muse
- Implementation: Argon, in AI Studio, from the live `/app/applet/` files
- Independent technical review: ChatGPT (reviews the implementation results alongside Muse)
- Final authorization and decisions: the owner

---

## What is authorized

Implement **PPH-4.4 only** — the compound-noun boundary enforcement for defect D-03 (story-02 [P11, P41], "timber trust" bleeding into "timber lease" / "timber brokerage"), in the plan's three layers:

1. **Layer 1 — Window-scoped glossary filtering for Stage 4:** in `runLiteraryEditingPass`, filter the glossary per Stage 4 window with `filterGlossaryForChunk(win.englishParagraphs, hydratedGlossary)` and build each window's memory block from the filtered glossary. Apply the same window-filtered glossary to the pre-window lint call. Keep the full glossary at the `sanitizeStage4EditedParagraph` call.
2. **Layer 2 — Sibling compound collision detection:** new `detectSiblingCompoundCollisions` in `lib/terminology.ts`, plus a `[COMPOUND-NOUN HEADWORD BOUNDARY RULE]` prompt injection in Stage 3 and Stage 4, following the PPH-4.1 prompt-builder pattern.
3. **Layer 3 — Target-side ungrounded glossary injection guard:** extend `lintParagraphTerminology` with the reverse check (`findBanglaTermOccurrences` + `findEnglishTermOccurrences`), emitting `code: 'compound_headword_bleed'`; extend `sanitizeStage4EditedParagraph` to auto-revert when Stage 4 triggers the bleed and Stage 3 did not.
4. Tests T-4.4-01 through T-4.4-03 (fail-before on the current code, pass-after).

**Use the verified code anchors in §2 of the plan, not the Engineering Specification's line numbers or signatures** — the spec cites `lintParagraphTerminology` at :2345 (real: :2131) with the wrong signature, `sanitizeStage4EditedParagraph` at :2407 (real: :2363), `runLiteraryEditingPass` at :2527 (real: :2561), and `filterGlossaryForChunk` at L1834–1876 (real: starts :1810, first argument is a paragraph array).

## Sequence

1. `install_applet_dependencies`; confirm **216/216** baseline green **before** any code change.
2. Implement the pure functions and guard (§3, Layers 2–3) and the tests (§4).
3. Implement Layer 1 (per-window glossary filtering), the prompt injection, and the sanitizer auto-revert.
4. Full suite (**219/219**), compile, lint, B-SPEC positive/negative checks.
5. Produce the implementation report (§6 of the plan): files changed, test output, before/after proof on story-02 [P11] and [P41], and any deviations from the plan.

## Hard boundaries — NOT authorized

- No PPH-4.5, PPH-4.3, or PPH-4.2 work — including `deriveBaseMotifFromNumberedTerm`, which belongs to PPH-4.2.
- No changes to the frozen PPH-3 archive (`Pilot-1/PPH-4/baselines/pph3-frozen-files/`).
- No Set C access. No Protocol 3A execution. No benchmark expectation changes.
- No prompt changes beyond the single `[COMPOUND-NOUN HEADWORD BOUNDARY RULE]` injection. No scope expansion.
- The deferred `'balanced'` test-type cleanup stays deferred.

## Stop conditions

- Any regression in the 216 baseline tests.
- Any false positive on B-4.4-N1, B-4.4-N2, or B-4.4-N3.
- Any deviation from the plan's scope — stop and report instead of improvising.

## After implementation

Stop and report. Muse and ChatGPT independently review the implementation report and the changed code before any further milestone is discussed.
