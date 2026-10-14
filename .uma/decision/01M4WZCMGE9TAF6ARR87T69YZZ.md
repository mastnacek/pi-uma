---
id: 01M4WZCMGE9TAF6ARR87T69YZZ
scope: "project:pi-uma"
type: decision
title: "SPAI ↔ UMA: keep stores separate, link via read-only source + structural IDs + done-task promotion"
tags:
  - spai
  - architecture
  - decision
  - integration
status: deprecated
supersedes: 01M4WY0WX6MAY62J6VHC51HV66
generated:
  by: pi-agent/1.1
  at: "2026-10-14T10:30:06.606444600+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-14T10:30:06.606444900+00:00"
since: "2026-10-14T09:29:50.011630200+00:00"
until: "2026-10-14T10:50:05.630861900+00:00"
spai:
  - SPAI-034
  - SPAI-035
  - SPAI-036
  - SPAI-037
---
### Decision
SPAI and UMA remain separate systems with no store-level integration. They are connected only by:

1. **Structural ID cross-references** — OKF frontmatter `spai: [SPAI-NNN]` on facts; a `Memory: <ULID>` line in SPAI item files.
2. **A read-only UMA source adapter** — `docs/spai/` searched live via `uma search --source spai`, with no index rows and no embeddings; done/cancelled items decay hard at query time.
3. **One-directional automated promotion** — when a SPAI task transitions to `done`, the shadow worker stages a fact proposal in `.uma/.staging/` (operator curates via `/uma review`). Information flows task → knowledge, never knowledge ← task state.

### Rationale
- Upholds the standing invariant "facts describe invariants, not volatile state." SPAI items are a high-churn lifecycle state machine; UMA facts are append-mostly semantic knowledge.
- Skeptic verdict on merging/indexing SPAI as facts: **dangerous, devil objection 0.95, failure mode silent_data_corruption** — recall pollution, reindex churn, consolidation noise.
- The approval-modal gate is correct for memory writes but absurd for status flips; merging would force bypassing the gate or modal fatigue.

### Consequences
- Never index SPAI items as memory facts; never let task status enter the fact space.
- The `uma` core stays harness-agnostic; the SPAI link lives in the source-adapter layer, not the domain model.
- Live link resolution (`uma read --resolve-spai` or plugin tool) makes references live instead of decorative.

### Implementation status (2026-10-14)
This fact is itself the first user of the structural `spai` field (SPAI-035); the field is resolved live by `uma read --resolve-spai` (SPAI-034) and the backlog is searched live by `uma search --source spai` (SPAI-036), which ranks open work above done/cancelled. The Herdr sidebar renders these relations in its SPAI detail pane (SPAI-012 in pi-herdr-sidebar). Tier 3 (done-task promotion, SPAI-037) remains an idea.