---
type: Todo
title: "Verify indexer schema bump foreign roots loss, atomic writes, and temporal as_of queries"
timestamp: 2026-10-12 10:12:14
status: todo
source: pi-spai
tags: [indexer, sqlite, temporal, atomicity]
facets:
  priority: high
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-022: Verify indexer schema bump foreign roots loss, atomic writes, and temporal as_of queries

. Verify indexer schema bump foreign roots loss, atomic writes, and temporal as_of queries @pi-uma !high :indexer:sqlite:temporal:atomicity:

## Context & Details
Review identified cache/index loss risks, race conditions, and query bugs:

### Relevant Memory Pattern:
- `Reindex merges known roots instead of wiping them` (`01M4DDYZNJ7FPWQDYSDSHH47DH`):
  Before wiping a rebuildable cache, recover the full set of roots already known to it by querying `SELECT DISTINCT file_path` and deriving store roots. Roots that no longer exist are skipped.

### Locations to Verify:
1. `core/uma-core/src/indexer/mod.rs:73-96`:
   - On schema version mismatch or any query error, `facts_fts` table is dropped.
   - If other projects' store roots were only tracked in the dropped table, dropping it causes them to vanish from subsequent reindexing.
   - `DELETE FROM facts_fts` + rebuild is not transactional. Verify whether `doctor` (supposedly read-only) triggers this on `Indexer::open`.
2. File Write Atomicity & Supersede Races:
   - Plain `fs::write` without temp files and atomic rename; concurrent readers can read partial files.
   - In `supersede`, old fact is retired before writing the new one. Check for missing cycle guard (`new.id == old.id`) and fork guards (multiple live successors).
3. Temporal Validity & `as_of` Queries:
   - `search/keyword.rs:67-69` & `semantic.rs:32-34`: Default search ignores `stale_after`, `until`, and future `since`.
   - In `as_of` queries (`keyword.rs:85` vs `129-149`), SQL `LIMIT` is applied before in-memory validity filtering, truncating valid historical records.
   - Check if missing/invalid `since` silently becomes `Utc::now()`.

### Verification & Action:
- Ensure schema migrations preserve known roots or maintain an independent project root registry.
- Implement tempfile + rename atomic writes; add supersede transaction/guards.
- Apply temporal filtering inside SQL query prior to `LIMIT`.
