---
id: 01M4ZG8YQ2FGZQPDR5SN7F7QTP
scope: "project:pi-uma"
type: decision
title: "Anti-echo backfill refills from the same search, never re-searches"
tags:
  - recall
  - anti-echo
  - design
  - fastbrain
status: deprecated
generated:
  by: pi-agent/1.1
  at: "2026-10-15T10:03:40.642346+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-15T10:03:40.642348+00:00"
since: "2026-10-15T10:03:40.642346900+00:00"
until: "2026-10-15T12:09:42.908614700+00:00"
---
### Context
SPAI-048 anti-echo: the recall gate deduplicates injected facts per session, which raised the design question — when recalled facts are duplicates, refill by re-searching or from the same search?

### Decision
Refill from the SAME search. The recall window is widened up front (`recall check --max 6`, roughly twice the injection budget), the anti-echo filter drops already-injected IDs, and the injection budget (MAX_INJECTED=3 per turn) fills with the next-best NEW facts in rank order. Never re-search after dedup: the duplicates ARE the top of the ranking, so a second BM25 call pays latency to relearn what the first call already ordered.

### Consequences
- A turn that used to under-deliver (3 recalled, 2 dupes → 1 injected) now delivers its full budget (2 next-best injected).
- Weaker rank-4+ facts are bounded by the 3-per-turn budget — deeper recall never grows the per-turn context footprint.
- Engine-side `--exclude <id>` ranking would be equivalent in result; the plugin-side window avoids an engine change and stays coherent with the shipped binary.
- `buildRecallMessage(verdict, lang, exclude?)` is the contract point; injected IDs ride in message details so session_start can rebuild the exclusion set from the transcript.