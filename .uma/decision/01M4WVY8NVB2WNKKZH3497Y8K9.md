---
id: 01M4WVY8NVB2WNKKZH3497Y8K9
scope: "project:pi-uma"
type: decision
title: "SPAI ↔ UMA: keep stores separate, link via read-only source + structural IDs + done-task promotion"
tags:
  - spai
  - architecture
  - decision
  - integration
status: deprecated
generated:
  by: pi-agent/1.1
  at: "2026-10-14T09:29:50.011628400+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-14T09:29:50.011631300+00:00"
since: "2026-10-14T09:29:50.011630200+00:00"
until: "2026-10-14T10:06:14.335539500+00:00"
---
### Decision
SPAI and UMA remain separate systems with no store-level integration. They are connected only by:

1. **Structural ID cross-references** — OKF frontmatter `spai: [SPAI-NNN]` on facts; a `Memory: <ULID>` line in SPAI item files.
2. **A read-only UMA source adapter** — `docs/spai/` indexed as its own collection/source, low recall weight, excluded from default recall and from consolidation; done/cancelled items decay aggressively.
3. **One-directional automated promotion** — when a SPAI task transitions to `done`, the shadow worker stages a fact proposal in `.uma/.staging/` (operator curates via `/uma review`). Information flows task → knowledge, never knowledge ← task state.

### Rationale
- Upholds the standing invariant "facts describe invariants, not volatile state." SPAI items are a high-churn lifecycle state machine; UMA facts are append-mostly semantic knowledge.
- Skeptic verdict on merging/indexing SPAI as facts: **dangerous, devil objection 0.95, failure mode silent_data_corruption** — recall pollution, reindex churn, consolidation noise.
- The approval-modal gate is correct for memory writes but absurd for status flips; merging would force bypassing the gate or modal fatigue.

### Consequences
- Never index SPAI items as memory facts; never let task status enter the fact space.
- The `uma` core stays harness-agnostic; the SPAI link lives in the source-adapter layer, not the domain model.
- Live link resolution (`uma read --resolve-spai` or plugin tool) makes references live instead of decorative.