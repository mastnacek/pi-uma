---
id: 01M4X0H6P49MNZDQ2VV3E1W8RD
scope: "project:pi-uma"
type: decision
title: "SPAI ↔ UMA: keep stores separate, link via read-only source + structural IDs + done-task promotion"
tags:
  - spai
  - architecture
  - decision
  - integration
status: stable
supersedes: 01M4WZCMGE9TAF6ARR87T69YZZ
generated:
  by: pi-agent/1.1
  at: "2026-10-14T10:50:04.868432500+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-14T10:50:04.868432700+00:00"
since: "2026-10-14T09:29:50.011630200+00:00"
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
3. **One-directional automated promotion** — when a SPAI task transitions to `done`, the shadow worker stages a fact proposal in the staging area (task text as draft body, `spai: [SPAI-NNN]` as provenance, low confidence) and the operator curates it via `/uma review`. Information flows task → knowledge, never knowledge ← task state.

### Rationale
- Upholds the standing invariant "facts describe invariants, not volatile state." SPAI items are a high-churn lifecycle state machine; UMA facts are append-mostly semantic knowledge.
- Skeptic verdict on merging/indexing SPAI as facts: **dangerous, devil objection 0.95, failure mode silent_data_corruption** — recall pollution, reindex churn, consolidation noise.
- The approval-modal gate is correct for memory writes but absurd for status flips; merging would force bypassing the gate or modal fatigue.

### Consequences
- Never index SPAI items as memory facts; never let task status enter the fact space.
- The `uma` core stays harness-agnostic; the SPAI link lives in the source-adapter layer, not the domain model.
- Live link resolution (`uma read --resolve-spai` or plugin tool) makes references live instead of decorative.
- Promotion is one-way and proposal-only: the worker never writes a fact, and a draft that is never approved leaves no trace.

### Implementation status (2026-10-14) — all four tiers shipped
- **Tier 1a** (SPAI-035): structural `spai` field, CLI/tool write paths, modal chip.
- **Tier 1b** (SPAI-034): `uma read --resolve-spai` resolves the field and body mentions against the live backlog.
- **Tier 2** (SPAI-036): `uma search --source spai` — a live, index-free source with status-weighted decay (`todo` 1.0 … `cancelled` 0.1).
- **Tier 3** (SPAI-037): shadow-worker promotion of completed items into staged drafts; `uma staging create --spai` carries provenance through approval, proven by a Rust test.
- The Herdr sidebar renders these relations in its SPAI detail pane (SPAI-012 in pi-herdr-sidebar).
- Known limits: promotion triggers on the tool-driven transition only (sidebar edits are invisible), and the per-project SPAI id namespaces remain unqualified (SPAI-042).