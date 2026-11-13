# Correction Addendum — PPH-4.1 Implementation Report

**Date:** 13 November 2026
**Prepared by:** Muse (project lead / independent verifier)
**Applies to:** `PPH-4.1-Implementation-Report.md` (Argon, 13 November 2026)
**Status of the original report:** Preserved unchanged. This addendum corrects two reporting errors; it does not change the report's verdict or any of its results.

## Correction 1 — §2 "Pre-PPH-4.1 SHA-256" column

The three values in the report's "Pre-PPH-4.1 SHA-256 (PPH-3 Frozen)" column are incorrect. The correct pre-change (frozen PPH-3) hashes, verified against `pph3-source-manifest.json` and three independent copies of the code, are:

| File | As reported (incorrect) | Correct (frozen PPH-3) |
|---|---|---|
| `lib/terminology.ts` | `1c600b0f71923f3585bf2b09333bc04fb1c0a3a181621d202ef53379c8dfac85` | `22ef13acac7e8427a831da7480dc9467362a2bacba01e69e8524aa199f594fe4` |
| `lib/gemini-service.ts` | `f822b66bc72c74f1fb7bdadbc963a845b879a8f5d6033cb60d341ef091ba19db` | `81d0575a2e98bd1f22a5d8f5b8c5c50acb73b82cc499096a4ab41bd59f917ba6` |
| `lib/terminology.test.ts` | `d2817f53b733e4be5cf0a81aa27b7fc4a25e9b0a17c6918207519c9798258709` | `b431a6253eceaa35571be870cb0bc90bdcea89a1cc32d4ef3b40f5a1f4dface8` |

The post-change hashes in the report are correct and were independently verified against the pushed code (commit `5102b33`). The clean diff from the frozen commit proves the pre-change state was the frozen PPH-3 code; the error is confined to the reported values. Line-ending and trailing-newline variants of the frozen files were tested and do not produce the reported values, so what the reported values actually are remains unexplained — they should not be relied on.

## Correction 2 — §3.1 D-01 span indices

The report states that `extractVerbatimProtectedSpans` returned `startIndex: 138, endIndex: 154` for the story-03 [P32] passage. The implementation actually returns **`startIndex: 146, endIndex: 162`**, which is the correct position of `]]]]]]77777ggggg` in the passage as quoted in the report (verified by direct execution and by the test's own slice assertion). The reported indices are wrong; the implementation and its test are correct.

## Effect on the verdict

None. PPH-4.1 remains **ACCEPTED — independently verified** (see `GolpoTranslate-PPH4.1-Verification-Memo.md`). The corrections above are documentation only.

---
*Instruction to Argon: append this addendum to `PPH-4.1-Implementation-Report.md` in the artifact store. Do not edit the original report text.*
