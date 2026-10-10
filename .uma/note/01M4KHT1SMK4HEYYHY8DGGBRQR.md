---
id: 01M4KHT1SMK4HEYYHY8DGGBRQR
scope: "project:pi-uma"
type: note
title: "UMA-Eval session 1 results: live functional verification (2026-10-10)"
tags:
  - uma-eval
  - testing
  - proposal-08
status: stable
generated:
  by: pi-agent/1.1
  at: "2026-10-10T18:39:36.244200500+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-10T18:39:36.244202300+00:00"
since: "2026-10-10T18:39:36.244202400+00:00"
---
Proposal 08 baseline executed against the live system. All PASS unless noted.

**Passed:** cargo test (117 unit + 4 integration), npm test (61/61), write/read/list/search (keyword+semantic+hybrid RRF — semantic found a paraphrase at 0.61), supersede chain (deprecated hidden by default, `includeDeprecated` surfaces them, `timeline --id` reconstructs the 3-revision chain), consolidate (deprecated excluded from scan), skeptic (Jev, devil_objection 0.95 on singleton-cache bait), humility check (medium → explorative-mode gate text), debt add/list/settle, muscle list/dry-run/**confirm-run** (3 steps executed OK), skill_invoke (template expansion, executed:false, unused-placeholder reporting), doctor (health report), secrets scan (blocks credentials), risk pain, contracts check (ast-grep), scopes, staging list, engine pin 1.1.0 == npm latest.

**Findings:**
1. `uma recall check` offline judge is phrasing-sensitive: "how did we solve the WAL locking issue last time?" and "which transport should Jev use?" were skipped; only "remember what we decided…" triggered. Offline recall gate is too conservative — real recall phrasings slip through without Jev.
2. `doctor` index-coverage warning persisted after `--reindex` (65 indexed vs 60 files) — the reconcile hint loops; the check likely counts deprecated rows vs active files. Needs a smarter comparison or hint.
3. Write to an unknown/unindexed scope fails with a confusing central-index error instead of offering to create the scope.
4. `secrets scan` double-labels an Anthropic key as both OpenAI and Anthropic (cosmetic).
5. My own codemode regex misparsed the supersede output (matched the OLD ulid first) — supersede output should print the NEW id first or as `new_id:` field for machine parsing.

**Not yet tested (next sessions):** L0 WAL concurrency stress, `--as-of` time simulation (missing), zombie pruning (missing), immune interceptor live L2 behavior, shadow worker staging pipeline, Ori harness eval, token/KV-cache metrics.