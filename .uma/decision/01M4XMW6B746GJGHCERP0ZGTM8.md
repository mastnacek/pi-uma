---
id: 01M4XMW6B746GJGHCERP0ZGTM8
scope: "project:pi-uma"
type: decision
title: "SPAI ↔ UMA: keep stores separate, link via read-only source + structural IDs + done-task promotion"
tags:
  - spai
  - architecture
  - decision
  - integration
status: deprecated
supersedes: 01M4XMV8B696P5D74Q6GHBKHRM
generated:
  by: pi-agent/1.1
  at: "2026-10-14T16:45:36.487528+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-14T16:45:36.487528200+00:00"
since: "2026-10-14T09:29:50.011630200+00:00"
until: "2026-10-14T16:46:10.715105400+00:00"
spai:
  - SPAI-034
  - SPAI-035
  - SPAI-036
  - SPAI-037
  - "D:/01_programovani/herdr/plugins/pi-herdr-sidebar/SPAI-012"
---
### Decision
SPAI and UMA remain separate systems with no store-level integration. They are connected only by:

1. **Structural ID cross-references** — OKF frontmatter `spai: [SPAI-NNN]` on facts, qualified when the item belongs to another backlog. The qualifier is a **project name when the engine knows that project** (current repo, the fact's scope, or a project recorded in the central index) and an **absolute path otherwise** — e.g. `D:/01_programovani/herdr/plugins/pi-herdr-sidebar/SPAI-012`. A `Memory: <ULID>` line in SPAI item files is the reverse direction.
2. **A read-only UMA source adapter** — `docs/spai/` searched live via `uma search --source spai`, with no index rows and no embeddings; done/cancelled items decay hard at query time.
3. **One-directional automated promotion** — when a SPAI task transitions to `done`, the shadow worker stages a fact proposal in the staging area (task text as draft body, `spai: [SPAI-NNN]` as provenance, low confidence) and the operator curates it via `/uma review`. Information flows task → knowledge, never knowledge ← task state.

### Rationale
- Upholds the standing invariant "facts describe invariants, not volatile state." SPAI items are a high-churn lifecycle state machine; UMA facts are append-mostly semantic knowledge.
- Skeptic verdict on merging/indexing SPAI as facts: **dangerous, devil objection 0.95, failure mode silent_data_corruption** — recall pollution, reindex churn, consolidation noise.
- The approval-modal gate is correct for memory writes but absurd for status flips; merging would force bypassing the gate or modal fatigue.
- SPAI ids are unique only **per project**: `SPAI-012` in two backlogs are unrelated items, so a cross-project reference must be qualified or the link silently resolves to the wrong backlog. An unresolved qualifier is *reported as unresolved and names where it looked* — it never falls back to a same-numbered item elsewhere.

### Consequences
- Never index SPAI items as memory facts; never let task status enter the fact space.
- The `uma` core stays harness-agnostic; the SPAI link lives in the source-adapter layer, not the domain model.
- Live link resolution (`uma read --resolve-spai` or plugin tool) annotates a cross-project hit with `[via <project>]`.

### Implementation status (2026-10-14) — all four tiers shipped
- **Tier 1a** (SPAI-035): structural `spai` field, CLI/tool write paths, modal chip.
- **Tier 1b** (SPAI-034): `uma read --resolve-spai` resolves the field and body mentions against the live backlog.
- **Tier 2** (SPAI-036): `uma search --source spai` — a live, index-free source with status-weighted decay (`todo` 1.0 … `cancelled` 0.1).
- **Tier 3** (SPAI-037): shadow-worker promotion of completed items into staged drafts; `uma staging create --spai` carries provenance through approval, proven by a Rust test.
- **Qualified references** (SPAI-042): the relation view is the sidebar item `pi-herdr-sidebar/SPAI-012`, resolved via its absolute path because that project has no indexed facts.
- Known limits: promotion triggers on the tool-driven transition only (a sidebar-driven change is invisible to the worker), and a label qualifier needs the engine to know the project.