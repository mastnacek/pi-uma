# `read` slice

**Command:** `uma read <id> [--json] [--resolve-spai]`
**Depends on:** `uma-core::{store::find_by_id, serialization}`

## What it does
Resolves a ULID to a fact, searching every known scope root, then prints it as a human-readable block or as JSON (`--json`).

`--resolve-spai` (SPAI-034) appends a live SPAI links section: every ID in the fact's structural `spai` frontmatter field plus any `SPAI-NNN` body mentions is resolved against the current `docs/spai` backlog (current repo first, then the fact's own project root via the read-only central-index lookup). Output shows `[status] title` per item, or `[unresolved]` when no item file exists. With `--json` the same data lands in `spai_resolved` (including `via`).

A `spai` field entry may be **project-qualified** (`pi-herdr-sidebar/SPAI-012`, or an absolute path), which resolves in that backlog (SPAI-042). Ids are unique only per project — `SPAI-012` in two backlogs are unrelated items — so a cross-project reference must name its project. A reference found in a project other than the current repository is annotated `[via <project>]`, and an unresolved qualified one names where it looked (`[unresolved] … in pi-herdr-sidebar`).

## Why it exists
Retrieval for when the identifier is already known. Search is for discovering an id; read is for acting on one deterministically — no ranking, no ambiguity.

`--json` exists for machine consumers: it is how the Pi `uma_supersede` tool fetches a predecessor's real type, scope and tags to prefill its approval modal.

`--resolve-spai` makes cross-references LIVE instead of decorative: SPAI stays the volatile work ledger, UMA the durable knowledge base, and the reader always sees the task's current status from the item's own file, never a cached copy.

## Invariant
- Never mutates anything, including the index — `--resolve-spai` deliberately avoids `Store::project` (which creates directories) and only reads `docs/spai` files.
- A missing id is an error, not an empty result.
