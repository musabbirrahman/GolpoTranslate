# Authorization: PPH-3 Baseline Hardening — Protocol 3A

**Authorized by:** Musabbir Rahman (owner), 13 November 2026
**Project:** GolpoTranslate
**Scope:** Baseline hardening and documentation ONLY. This authorization does not cover PPH-4 implementation.

**Roles**
- Project leadership and coordination: Muse
- Application implementation: Argon (this instruction is for Argon, in AI Studio)
- Independent technical review: ChatGPT (reviews the final hardening report)
- Final authorization and decisions: the owner

---

## Hard boundaries — NOT authorized by this document

- No PPH-4 implementation (PPH-4.1 through PPH-4.5). No new functions, no changes to existing pipeline functions.
- No modifying translations, manuscripts, glossaries, prompts, or benchmark expectations.
- No access to Set C manuscripts or the Set C blinding key.
- No Protocol 3A execution.
- No unrelated refactoring.
- No silent overwrites of historical records. Every correction to an existing document is a dated addendum that preserves the original (see "Correction addenda" below).

If any step cannot be completed reliably, stop and report the exact blocker instead of improvising.

---

## Source rule

Copy from the LIVE `/app/applet/` files, not from the GitHub export or the public repository. The public repository (github.com/musabbirrahman/GolpoTranslate) is a cross-check only; it does not replace the live files as the hardening source.

Known cross-check (already established, for reference): the public repository matches the manifest 10/10, and Muse independently reproduced the 212-test baseline from it (212/212 passing, tsx v4.23.15, Node v24.22.1, 3,243 ms; the manifest records Node v22.23.2, tsx v4.23.15, 3,013.62 ms).

---

## Step 1 — Freeze the verbatim PPH-3 files

Copy all 10 files, byte-for-byte, from `/app/applet/` into `Pilot-1/PPH-4/baselines/pph3-frozen-files/`. Do not modify them. Verify SHA-256, byte count, and line count of each copied file against the manifest `Pilot-1/PPH-4/baselines/pph3-source-manifest.json` (recorded 2026-11-12T10:54:01Z). Report any mismatch and STOP — do not proceed past a hash failure.

Expected values (from the manifest):

| File | SHA-256 | Bytes | Lines |
|---|---|---|---|
| `lib/types.ts` | `6341e8daadaab90aeb4e669dc9960846807554be0578a8952266144ab015bb23` | 8,104 | 318 |
| `lib/chunker.ts` | `741e899c19474fdaf8bdbd863f88df9c90c0093e432ae10103688d187ef65703` | 49,987 | 1,453 |
| `lib/chunker.test.ts` | `8fc07bc4cecbd423c882282ce0d3d1276907daea3fe32ebc45e21b48c144c31f` | 75,281 | 1,716 |
| `lib/terminology.ts` | `22ef13acac7e8427a831da7480dc9467362a2bacba01e69e8524aa199f594fe4` | 406,007 | 11,681 |
| `lib/gemini-service.ts` | `81d0575a2e98bd1f22a5d8f5b8c5c50acb73b82cc499096a4ab41bd59f917ba6` | 219,178 | 4,518 |
| `lib/terminology.test.ts` | `b431a6253eceaa35571be870cb0bc90bdcea89a1cc32d4ef3b40f5a1f4dface8` | 803,576 | 19,450 |
| `app/api/translate/route.ts` | `317c547e3dc559b3b0ca3855f4a3c0b1dca9e138089e42b2726adfe35bb6fbe8` | 5,225 | 144 |
| `package.json` | `be1a944c0337bc5d06f9c815f7a13911565d502bfe1c64211f4db6dd1b5a88df` | 999 | 40 |
| `tsconfig.json` | `68015f80f40f7f7523e2575b8ddac5f410455a3a9148da9a037df33ed7193c8d` | 658 | 29 |
| `next.config.ts` | `f850c0166355ee9c296bdf04a6c0f2a598b70550e0d62ff3c8f758a17a325e85` | 870 | 36 |

Manifest totals: 39,385 lines, 1,569,885 bytes, 212 legacy tests.

---

## Step 2 — Complete the manifest's missing hashes

Add to `pph3-source-manifest.json`:

1. The SHA-256 of the LIVE `bun.lock`. (Two independent copies — the GitHub export and the public repository — both hash to `90ad43a18985a8fbf6d08fcd6017d021b3134aa8ad6c13d11070880cf9cd0428` at 242,303 bytes. Hash the live file and record whatever it actually is. If it differs from that value, report the difference explicitly and do not overwrite it silently.)
2. The SHA-256 of the Pilot 1 runner `run-pilot-1.ts` (expected: `4a351bdad69a8120b864e9885f89e448ee8b758944391a0695749cfb8ae2c22e`, 717 lines, 25,678 bytes — verify against the live file).
3. The resolved installed version of `@google/genai`. Declared range is `^2.32.0`; the lockfile pins `2.32.0`. Record BOTH the declared range and the resolved installed version.
4. Verify the archived lockfile can restore the dependency environment (a clean install from the archived lockfile must succeed). A matching lockfile hash alone does not prove the environment can be reproduced — record the restore check and its result.

---

## Step 3 — Correct the model configuration (documented correction, not a silent fix)

Correct `pph3-model-config.json` to the parameters actually used by the runner, as established by direct inspection of `run-pilot-1.ts` and the library defaults:

- `maxWordsPerChunk`: **500** (not 600)
- `contextWindow`: **2**
- Stage 3 continuity tail: **3**
- Stage 4 window: **15** (not 20), Stage 4 continuity: **2**
- Stage 5 window: **12** (not 20)

The runner passes NO window overrides — Stage 4 and Stage 5 are called with their library defaults (15 and 12). `verifyTranslationAccuracy` is called once, on the full manuscript after Stage 4; there is no per-chunk Stage 5 call and no auto-heal call in the runner.

Preserve the original config values in the record; the correction is documented alongside them, with evidence, not a silent overwrite.

---

## Step 4 — Protocol 3A fairness rules

Add to Protocol 3A:

1. Interleaved per-story execution (both arms run each story before moving to the next, so no arm benefits from a different model state or time window).
2. A model-parity rule (both arms run under identical model and runtime parameters).

Deliberate divergence from the earlier audit's suggestion: do NOT retry a pair until parity is achieved. If a pair is non-comparable (different models actually served, different parameters, failed run), flag it as non-comparable and report it separately. Retrying until parity can bias results.

---

## Step 5 — Blind review packet rules

Specify the diagnostic-stripping rules for the blind review packet generator: packets must contain ONLY paragraph-aligned source English + Variant A + Variant B. Strip all diagnostics, scores, stage findings, model identifiers, and any other metadata that could unblind the reviewer.

---

## Correction addenda (do not rewrite history)

Three existing documents contain incorrect statements that this hardening must correct by dated addendum. For each, record: the original statement, the corrected finding, the evidence used, and whether the correction changes the document's verdict. Do NOT replace or rewrite the originals.

1. **The reproducibility audit** (`PPH-4-Protocol-3A-Reproducibility-Audit.md`): its verification table is wrong — its hashes and byte counts for the 7 source files match neither the real manifest nor the live files; its byte counts are wrong for all 10 files; its `@google/genai ^1.29.0` citation is wrong (real: `^2.32.0`); its claim of per-chunk Stage 5 execution plus auto-heal in the runner does not appear in the actual runner code. The audit's NOT READY verdict and its blocker (lost `/tmp` snapshot, no git repo) STAND — the correction changes the table, not the verdict.
2. **The Baseline Execution Report** (`PPH-3-Baseline-Execution-Report.md`), §3: this is the ORIGIN of the 600/20 error — it lists `maxWordsPerChunk = 500 (default) / 600 (run-pilot-1.ts)` and Stage 4/5 window overrides of 20. The runner contains no such overrides. Same timestamp as the model config (2026-11-12T07:52:44Z). Correct by addendum.
3. **The Selection Addendum** (`PPH-4-Protocol-3A-Selection-Addendum.md`), §3: repeats the wrong `maxWordsPerChunk = 600`. Correct by addendum.

---

## Evidence labeling (required in all hardening outputs)

Label every finding in one of three ways, and use the labels consistently:

1. **Directly verified** — by inspecting current files.
2. **Independently reproduced** — by executing a test or command.
3. **Reported, not independently reproduced** — stated in an existing document, not re-run or re-measured here.

Example: the 212/212 baseline is "independently reproduced" by Muse from the public repository; the Set A / Set B-SPEC baseline results (0/27, 0/18, 18/18) remain "reported, not independently reproduced" until they are re-run. Matching ten file hashes is "directly verified."

---

## Model execution evidence (fallback distribution)

Distinguish four things, and do not conflate them:

1. The configured primary model (`gemini-3-flash-preview`).
2. The configured fallback order.
3. The model actually used in each API call.
4. Whether the evidence comes from execution logs or merely from configuration.

The claim that Pilot 1 mostly used `gemini-3.1-flash-lite` is currently reported in the model config's observed-runtime record, not proven from execution records. If the execution records (`ModelExecutionRecord` / diagnostics) support it, include the fallback distribution in the historical evaluation record. If they do not support it or are unavailable, state explicitly that the claim is reported-in-config only.

---

## No-implementation verification

Verify that PPH-4 has not started by inspecting the relevant source files for partial implementations, equivalent logic, and changes made without using the proposed function names — NOT only by searching for function names.

The 13 proposed new functions to check (absence is necessary, not sufficient, evidence): `extractVerbatimProtectedSpans`, `detectSiblingCompoundCollisions`, `findUngroundedInlineOrDoublets`, `resolveUngroundedInlineOrDoublets`, `lintParagraphHomophoneAndTypoCollisions`, `lintParagraphContextualVocabulary`, `extractDialogueSecondPersonRegisterSignatures`, `findUngroundedGlossaryInjections`, `deriveBaseMotifFromNumberedTerm`, `lintParagraphDirectedPronouns`, `extractCumulativeContinuityEntries`, `extractRecurringConcreteNounPhrases`, `normalizeCharacterDirectedRegisters`.

Already established by mechanism inspection (verify again, do not take on trust): no `measurement_unit_distortion` mechanism; no deterministic verbatim-span protection (only prompt prose); no `compound_headword_bleed`; no `DirectedAddressRule` / `hasTui` anywhere; no colander or hemp in `KNOWN_EQUIVALENT_CLUSTERS`. One narrow pre-existing exception: the numerical linter has a hardcoded half-unit check ("half a step" / "half an inch") only — not a general fractional system. The conclusion must rest on this mechanism inspection.

---

## Final verification report

Produce a final verification report concluding with exactly one of:

- **READY FOR PPH-4.1**
- **READY WITH DOCUMENTED LIMITATIONS**
- **NOT READY**

The report must include: the frozen-file hash verification table, the completed manifest additions (live `bun.lock` hash, runner hash, resolved `@google/genai` version), the lockfile restore check result, the corrected model configuration, the Protocol 3A fairness additions, the blind-packet stripping rules, the three correction addenda, the evidence labels for every finding, and the fallback-distribution status. Then stop and await further authorization. PPH-4.1 is NOT authorized by this document and needs its own explicit authorization.
