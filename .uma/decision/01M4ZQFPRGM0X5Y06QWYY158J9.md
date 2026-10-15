---
id: 01M4ZQFPRGM0X5Y06QWYY158J9
scope: "project:pi-uma"
type: decision
title: "Anti-echo exclusion lives in the engine: recall check --exclude (refill from the same search)"
tags:
  - recall
  - anti-echo
  - design
  - fastbrain
status: stable
supersedes: 01M4ZG8YQ2FGZQPDR5SN7F7QTP
generated:
  by: pi-agent/1.1
  at: "2026-10-15T12:09:41.904787400+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-15T12:09:41.904787600+00:00"
since: "2026-10-15T10:03:40.642346900+00:00"
---
### Context
SPAI-048 anti-echo: the recall gate deduplicates injected facts per session. Originally implemented plugin-side (wider window + post-hoc filter) to avoid engine churn; migrated to the engine (2026-10-15) once the tree was quiet.

### Decision
Refill from the SAME search, never re-search after dedup — the duplicates ARE the top of the ranking, so a second BM25 call pays latency to relearn what the first call already ordered.

The exclusion now lives in the ENGINE: `recall check --exclude <ID>` (repeatable) removes IDs from the ranking competition BEFORE the limit is applied (`SearchOptions.exclude_ids`, enforced in the keyword SQL path; priming skips excluded candidates too). The gate passes its session's injected IDs (capped at the 100 most recent) and keeps `--max 3`. BM25 scores are per-fact independent, so exclusion never reorders the survivors — behavior is unchanged from the plugin-side era; only who filters moved.

The plugin keeps the session bookkeeping (`injectedFactIds`, rebuilt from the branch's uma-recall entries on session_start, cleared on compaction) and a defense-in-depth filter in `buildRecallMessage`.

### Consequences
- Every harness (MCP, CLI, orchestrator) gets anti-echo recall for free via the query parameter.
- The exclusion list is capped at 100 most-recent IDs (CLI argv ceiling on Windows); a dropped old exclusion only lets a long-scrolled fact reappear.
- If the engine ever adds result diversification (non-independent scoring), engine-side exclusion is already the correct filtering point.
- Engine changes must keep `bin/uma.exe` refreshed and advance the version: shipped as 0.10.0.