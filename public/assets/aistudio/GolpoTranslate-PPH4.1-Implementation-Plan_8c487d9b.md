# PPH-4.1 Implementation Plan — Literal and Measurement Protection

**Prepared by:** Muse (project lead)
**Date:** 13 November 2026
**Status:** PLAN ONLY — implementation requires the owner's separate, explicit authorization. No code has been written.
**Review:** ChatGPT independently reviews the implementation results alongside Muse.
**Implementer (after authorization):** Argon, in AI Studio, working from the live `/app/applet/` files and the frozen PPH-3 archive.

---

## 1. Goal and scope

Fix the two highest-severity Pilot 1.5 defects, both Major:

- **D-01** — Stage 4 corrupted a verbatim keyboard-mash string (`*]]]]]]77777ggggg*` → `*]]]]]]৪০০ggggg*`, story-03 [P32]) and the numerical linter approved it, because `77777ggggg` is a mixed alphanumeric token, not a standalone number.
- **D-02** — A fractional engineering measurement (`"seven inches and ninety-two hundredths"`, story-04 [P02]) was rendered as `"সাত ইঞ্চি এবং ৯২ শতাংশ"` (percent), and the linter approved it because `92` matched `৯২` while `hundredths` was unrecognized and `শতাংশ` was never checked against fractional source expressions.

**In scope:** the four mechanisms in §2 of the Engineering Specification (verbatim spans, fractional lexicon, `measurement_unit_distortion` rule, Stage 4 restoration) and the four tests T-4.1-01..04.

**Out of scope:** everything else — PPH-4.4, PPH-4.5, PPH-4.3, PPH-4.2; any change to prompts beyond the two specified injections; any change to the frozen PPH-3 archive; any Set C access; any Protocol 3A execution.

---

## 2. Verified code anchors (these govern; the spec's citations differ in places)

All line numbers below were verified by direct inspection of the frozen code (manifest 10/10). Where the Engineering Specification cites a different line, the spec is wrong and the value below governs.

| Anchor | Verified location | Spec's citation (for reference) |
|---|---|---|
| `parseEnglishNumericalExpressions` | `lib/terminology.ts:10859` | Spec §1.2 / §8.2 say :10885 — wrong |
| `parseSingleOrCompoundEnglishNumberTokens` | `lib/terminology.ts:10673` | Spec §1.2 says :10691 — wrong |
| Ordinal lexicon | `ENGLISH_ORDINAL_UNITS` :9639, `ENGLISH_ORDINAL_TENS` :9661, `hundredth: 100` at :9670 | Spec §1.2 cites `ENGLISH_SMALL_ORDINAL_WORDS` — that constant does not exist |
| `lintParagraphNumericalConsistency` | `lib/terminology.ts:11223` (half-unit check :11262–11288) | Spec §2.3 says :11200+ — approximately right |
| `sanitizeStage4EditedParagraph` | `lib/gemini-service.ts:2315` | Spec also cites :2407 and :2390–2402 elsewhere — :2315 is the definition |
| `buildStage4WindowLintGuidanceBlock` | `lib/gemini-service.ts:2252` | Agrees with spec |
| `filterGlossaryForChunk` | `lib/terminology.ts:1810` | Spec §7.2 says :1834 — inside the function, not the definition |
| `lintParagraphTerminology` | `lib/terminology.ts:2131` | Spec §5.2 says :2345 / :2383 — inside the function |

---

## 3. What Argon builds

All new logic is pure, deterministic, zero-network TypeScript, following the spec's "smallest safe implementation" principle.

### 3.1 `extractVerbatimProtectedSpans(englishParagraph)` — new, in `lib/terminology.ts`

Classifies a token as a verbatim protected span only on narrow structural signatures:

1. **Keyboard-mash / symbol run** — ≥3 repeated punctuation/bracket/symbol characters adjacent to letters/digits (e.g. `]]]]]]77777ggggg`), or ≥3 identical consecutive digits/letters inside a mixed token.
2. **Alphanumeric identifier code** — fused serial/license/model identifiers (e.g. `INV-2049-B`, `TL/4402/98`).
3. **URL / handle** — explicit URLs, emails, `@handle` tokens.

Whitelist (never locked): standard ordinals (`1st`–`9th`), time tokens (`11am`, `7pm`), decades (`1950s`), tech tokens (`3D`, `4G`, `5G`, `A4`, `MP3`, `PDF`).

### 3.2 Fractional measurement parsing — extend `parseEnglishNumericalExpressions`

- Add `ENGLISH_FRACTIONAL_DENOMINATOR_WORDS`: `tenth/tenths: 10`, `hundredth/hundredths: 100`, `thousandth/thousandths: 1000`, `quarter/quarters: 4`, `third/thirds: 3`, `fifth/fifths: 5`, `eighth/eighths: 8`, `sixteenth/sixteenths: 16`.
- Recognize `[Cardinal A] [Unit] and [Cardinal B] [Fractional Denominator]` (`"seven inches and ninety-two hundredths"` → 7.92 inches), `[Cardinal B] [Fractional Denominator] of an [Unit]`, and numeric decimals (`7.92 inches`).
- Emit embedded digit runs inside mixed alphanumeric tokens as `EnglishNumericalFact` with `kind: 'verbatim_literal'` (e.g. `77777` inside `77777ggggg`).

### 3.3 `measurement_unit_distortion` rule — in `lintParagraphNumericalConsistency`

- **Rule M-1:** if English contains a fractional denominator word and does NOT contain `percent` / `per cent` / `%`, flag Bangla bare `শতাংশ` / `শতাংশের` / `শতকরা` / `%` as `measurement_unit_distortion`.
- A `verbatim_literal` fact is satisfied ONLY if the exact ASCII substring or exact digit sequence is preserved — never by an unrelated number elsewhere in the paragraph (this is what catches `৪০০` standing in for `77777`).

### 3.4 Stage 4 enforcement — `sanitizeStage4EditedParagraph` (`lib/gemini-service.ts:2315`)

- Before accepting a Stage 4 `candidate` over the Stage 3 draft, check every span from `extractVerbatimProtectedSpans`. If the draft contains `span.raw` and the candidate does not, deterministically splice `span.raw` back in (when surrounding delimiters are intact) or revert the paragraph to the Stage 3 draft.
- Prompt injections (only these two): `[VERBATIM LITERAL TOKEN LOCK]` and `[MEASUREMENT & FRACTION PRECISION RULE]` in Stage 3/4 prompts when a chunk/window contains a verbatim span or a fraction/compound-measurement fact.

---

## 4. Tests — T-4.1-01 through T-4.1-04 (fail-before, pass-after)

| Test | Asserts |
|---|---|
| **T-4.1-01** `verbatim_keyboard_mash_preservation` | `extractVerbatimProtectedSpans` extracts `]]]]]]77777ggggg` from story-03 [P32] |
| **T-4.1-02** `stage4_reverts_corrupted_alphanumeric_span` | `lintParagraphNumericalConsistency` flags `*]]]]]]৪০০ggggg*`; `sanitizeStage4EditedParagraph` restores `*]]]]]]77777ggggg*` while keeping `"চারশো শতাংশ"` |
| **T-4.1-03** `fractional_hundredths_rejects_shatangsha` | `"seven inches and ninety-two hundredths"` flags `"সাত ইঞ্চি এবং ৯২ শতাংশের ব্যবধান"` with `measurement_unit_distortion` |
| **T-4.1-04** `compound_measurement_gauge_lint` | Fractional/decimal renderings (`"সাত দশমিক নয় দুই ইঞ্চি"`, `"সাত ইঞ্চি ও এক ইঞ্চির একশো ভাগের বিরানব্বই ভাগ"`) pass cleanly |

**Negative guards (must keep passing):** legitimate percentages (`"four hundred percent"` → `"চারশো শতাংশ"`), time expressions (`"11am"` → `"১১টা"`), normal italicized English sentences (`*Invoice still shows old trade license number.*`), and all 18 B-SPEC negative guards.

**Acceptance bar:** 212 baseline tests still green + 4 new tests green = **216/216**, and `compile_applet` + `lint_applet` succeed with zero errors. The other 23 Set A tests (PPH-4.2–4.5) must still fail-before — that is expected, not a failure. The Set A / B-SPEC baselines are re-checked during PPH-4 verification, not during hardening.

**Authoritative registry:** the Readiness Verification's 275-test inventory (212 + 27 + 36) governs test numbering. Note: the Engineering Specification contradicts itself on later milestones' test IDs (it lists `T-4.2-06` in the §9 matrix and `T-4.3-06/07` in §1.2 D-23, but its own §8.2 counts 5 tests each for PPH-4.2 and PPH-4.3, totalling 27 Set A tests). That contradiction does not affect PPH-4.1's four tests, but it must be resolved against the Verification's registry before PPH-4.2/PPH-4.3 planning.

---

## 5. Sequence of work

1. `install_applet_dependencies`; confirm **212/212** baseline green **before** any code change.
2. Implement §3.1–3.2 (pure functions + tests T-4.1-01, T-4.1-03, T-4.1-04).
3. Implement §3.3–3.4 (linter rule + sanitizer restoration + prompt injections + test T-4.1-02).
4. Run full suite (**216/216**), compile, lint. Run the negative-guard checks.
5. Produce a short implementation report: files changed, test output, before/after proof on story-03 [P32] and story-04 [P02], and any deviations from this plan.
6. Muse and ChatGPT independently review the report and the changed code before any further milestone is discussed.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Verbatim regex over-matches normal prose (e.g. words with digits, hyphenated words) | Narrow signatures + explicit whitelist (ordinals, times, decades, tech tokens); negative-guard tests in §4 |
| `শতাংশ` rule fires on legitimate percentages | Rule M-1 requires a fractional denominator word in English AND absence of `percent` / `%`; legitimate `"four hundred percent"` passes |
| Sanitizer restoration damages valid Stage 4 edits | Splice-back only when delimiters are intact; otherwise revert only the affected paragraph to the Stage 3 draft, never the whole window |
| Prompt injections change unrelated Stage 3/4 behaviour | Injections fire only when a chunk/window actually contains a verbatim span or fraction fact |
| Spec line citations are wrong in places | Argon uses the verified anchors in §2 of this plan, not the spec's numbers |

## 7. Stop conditions

- Any regression in the 212 baseline tests.
- Any false positive on legitimate percentages, time expressions, or normal italics.
- Any deviation from the plan's scope (new functions beyond §3, changes to other milestones' code, glossary/prompt changes beyond the two injections).

## 8. Rollback

Revert the three touchpoints independently: the extractor + lexicon in `lib/terminology.ts`, the `measurement_unit_distortion` rule, and the sanitizer guard in `sanitizeStage4EditedParagraph`. The frozen PPH-3 archive (`Pilot-1/PPH-4/baselines/pph3-frozen-files/`) is never modified and remains the restore point. A repo revert returns the code to the frozen state.
