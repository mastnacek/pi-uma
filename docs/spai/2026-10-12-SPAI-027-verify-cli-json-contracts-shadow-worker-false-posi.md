---
type: Todo
title: "Verify CLI JSON contracts, shadow worker false positives, and modal display desync"
timestamp: 2026-10-12 10:12:29
status: done
source: pi-spai
tags: [cli, json, shadow-worker, i18n]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-027: Verify CLI JSON contracts, shadow worker false positives, and modal display desync

x Verify CLI JSON contracts, shadow worker false positives, and modal display desync @pi-uma !medium :cli:json:shadow-worker:i18n:

## Context & Details
Review flagged protocol and integration inconsistencies between the Rust CLI and the TypeScript extension:

### Locations to Verify:
1. CLI JSON Output Contract:
   - `skill list --json` emits plain text when the list is empty instead of `[]`.
   - `search` command lacks `--json` output format.
   - `doctor --json` can emit multiple concatenated JSON documents instead of a single object.
   - `sessions list --json` ignores the `--limit` flag.
   - `migrate` exits 0 even after failures.
2. Shadow Worker:
   - Correction detector fires on every agent turn without deduplicating repeated prompts.
   - Regex treats `"0 failed"` in test command output as a test failure.
3. Modal UI Display & i18n:
   - `src/shared/modal.ts:68`: In `lang: "cs"`, shows an LLM translation of the body for display while storing the untranslated text.
   - `modal_renderer.ts:94-96`: Scope label displays current project for any non-global scope, even when an explicit foreign scope is selected.
   - Hardcoded Czech strings (such as `"AKTIVNÍ"`) displayed even when `lang: "en"`.

### Verification & Action:
- Ensure all CLI `--json` outputs conform to strict JSON schemas under all conditions (empty, error, multi-part).
- Fix shadow worker test failure parsing and deduplicate turn-end checks.
- Resolve translation desync and modal scope labels.

## Outcome (2026-10-12, v0.8.9)

**CLI JSON contracts — all fixed and verified end-to-end:**
- `skill list --json`: the JSON branch now runs *before* the empty check, so an empty scope emits `[]`, never the sentence "No skills found".
- `search`: gained `--json`; the whole result is ONE object `{degraded, note, hits:[...]}`. Status chatter (`--reindex`/`--vectorize`) is redirected to stderr in JSON mode, and an empty query emits `{"hits":[],"note":"empty query"}`. Verified: parsed a single document.
- `doctor --json`: previously emitted up to three concatenated documents (prune + dream + report). `prune_zombies` and `dream_over_roots` no longer print JSON; they return their data, which `report()` folds into a single object `{failed, warnings, archived, zombies, dream, findings}`. Verified: one parseable document with `--zombies --dream`.
- `sessions list --json`: `--limit` is now applied to the JSON payload (`0` = unlimited). Verified: `--limit 1` returned 1 record.
- `migrate`: now `bail!`s when any file failed, so the exit code reflects partial data loss.

**Shadow worker:**
- `"0 failed"` no longer counts as a failure. The logic moved to a pure, tested `src/slices/shadow/policy.ts::isCommandFailure`, which requires a non-zero count, a compiler marker (`error[`, `err!`, `error:`), or the tool's own error flag. Tests added.
- Turn-end correction detection now skips an identical repeat of the last distilled prompt, so one prompt cannot keep firing the judge and staging duplicate drafts.

**Modal UI / i18n:**
- Scope label (`modal_renderer.ts`) now shows the ACTUAL scope: an explicit foreign project is displayed by name instead of being relabelled with the current repository.
- The hardcoded Czech `" · ● AKTIVNÍ"` in `complete_params.ts` (14 occurrences) was replaced by the locale-aware `h.selectedMarker` (cs `· ● AKTIVNÍ` / en `· ● ACTIVE`), added to both help tables. No Czech literal remains outside the string tables.

**Recorded as intended, not a defect:**
- The Czech display translation of the proposal body is labelled in the modal (`🌐 display translation — the ORIGINAL is saved`, with a `c: original` toggle). Storing the untranslated original is the documented "translation is display-only" invariant; the modal does not misrepresent it.
