---
type: Todo
title: "Verify CLI JSON contracts, shadow worker false positives, and modal display desync"
timestamp: 2026-10-12 10:12:29
status: todo
source: pi-spai
tags: [cli, json, shadow-worker, i18n]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-027: Verify CLI JSON contracts, shadow worker false positives, and modal display desync

. Verify CLI JSON contracts, shadow worker false positives, and modal display desync @pi-uma !medium :cli:json:shadow-worker:i18n:

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
