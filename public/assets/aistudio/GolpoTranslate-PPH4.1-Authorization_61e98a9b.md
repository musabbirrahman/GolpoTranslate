# Authorization: PPH-4.1 Implementation — Literal and Measurement Protection

**Authorized by:** Musabbir Rahman (owner), 13 November 2026
**Project:** GolpoTranslate
**Scope:** PPH-4.1 ONLY, as specified in `GolpoTranslate-PPH4.1-Implementation-Plan.md` (prepared by Muse, 13 November 2026).

**Roles**
- Project leadership and coordination: Muse
- Implementation: Argon, in AI Studio, from the live `/app/applet/` files
- Independent technical review: ChatGPT (reviews the implementation results alongside Muse)
- Final authorization and decisions: the owner

---

## What is authorized

Implement **PPH-4.1 only** — the literal and measurement protections for defects D-01 and D-02:

1. `extractVerbatimProtectedSpans` in `lib/terminology.ts`.
2. Fractional-measurement parsing in `parseEnglishNumericalExpressions` (fractional denominator lexicon + compound measurements + `verbatim_literal` facts).
3. The `measurement_unit_distortion` rule in `lintParagraphNumericalConsistency`.
4. Verbatim-span restoration in `sanitizeStage4EditedParagraph`, plus the two prompt injections (`[VERBATIM LITERAL TOKEN LOCK]`, `[MEASUREMENT & FRACTION PRECISION RULE]`).
5. Tests T-4.1-01 through T-4.1-04 (fail-before on the frozen PPH-3 code, pass-after).

**Use the verified code anchors in §2 of the plan, not the Engineering Specification's line numbers** — the spec cites `parseEnglishNumericalExpressions` at :10885 (real: :10859), `parseSingleOrCompoundEnglishNumberTokens` at :10691 (real: :10673), and a constant `ENGLISH_SMALL_ORDINAL_WORDS` that does not exist (real: `ENGLISH_ORDINAL_UNITS` :9639 / `ENGLISH_ORDINAL_TENS` :9661).

## Sequence

1. `install_applet_dependencies`; confirm **212/212** baseline green **before** any code change.
2. Implement the pure functions and tests (§3.1–3.2 of the plan).
3. Implement the linter rule, sanitizer restoration, and prompt injections (§3.3–3.4).
4. Full suite (**216/216**), compile, lint, negative-guard checks.
5. Produce the implementation report (§5 of the plan): files changed, test output, before/after proof on story-03 [P32] and story-04 [P02], and any deviations from the plan.

## Hard boundaries — NOT authorized

- No PPH-4.4, PPH-4.5, PPH-4.3, or PPH-4.2 work.
- No changes to the frozen PPH-3 archive (`Pilot-1/PPH-4/baselines/pph3-frozen-files/`).
- No Set C access. No Protocol 3A execution. No benchmark expectation changes.
- No prompt changes beyond the two injections in the plan. No scope expansion.

## Stop conditions

- Any regression in the 212 baseline tests.
- Any false positive on legitimate percentages, time expressions, or normal italics.
- Any deviation from the plan's scope — stop and report instead of improvising.

## After implementation

Stop and report. Muse and ChatGPT independently review the implementation report and the changed code before any further milestone is discussed.
