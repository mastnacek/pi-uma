# `search` slice

**Command:** `uma search "<query>" [--mode keyword|semantic|hybrid] [--source memory|spai] [--scope] [--type] [--as-of] [--include-deprecated] [--limit] [--reindex] [--vectorize]`
**Depends on:** `uma-core::{search, indexer, embeddings, vector_store, spai}`

## What it does
Three retrieval modes over one fact set:
- `keyword` — BM25 via SQLite FTS5, with weighted `snippet` highlighting.
- `semantic` — cosine similarity over stored embeddings (OpenRouter).
- `hybrid` (default) — Reciprocal Rank Fusion (k=60) of both.

Supports point-in-time queries (`--as-of`) and hides deprecated facts unless asked.

## Why it exists
This is the on-demand recall path. Automatic context injection (slice S3) is deliberately on hold because injecting facts every turn buys noise and hallucination; an explicit query keeps the agent in control of what enters its context.

A `stale_after` date is honoured the same way as `until`: past it, the fact leaves the default result set. That is the point of a validity deadline — an expired claim should not look current just because nothing replaced it.

Two behaviours worth knowing when reading results:

- **Visible degradation.** `hybrid` needs an embedding client, stored vectors, and a working API call. When any is missing it degrades to keyword-only and prints a note *before the results* (`! Hybrid search degraded to Keyword: …`), because a caller who asked for hybrid ranking and silently received BM25 has been misled, not merely served differently. `--mode semantic` fails loudly instead; `--mode keyword` never needs a key.
- **Scope isolation.** Unscoped search sees only the current project plus global. Use `uma scopes` to discover what other scopes exist, then `--scope <name>` to reach them.

## `--source spai` — the live work ledger (SPAI-036)

`uma search --source spai "<query>"` searches a project's `docs/spai` backlog **live from disk**: a separate, read-only query path with no index rows and no embeddings. This is deliberate — SPAI is the volatile work ledger and UMA the durable knowledge base (decision `01M4WY0WX6MAY62J6VHC51HV66`), so task state must never enter the fact index, recall, consolidation or the vector store.

Ranking is **status-weighted**: `todo`/`working` = 1.0, `waiting` = 0.9, `idea`/`note` = 0.8, `done` = 0.3, `cancelled` = 0.1, unknown = 0.7 (an unknown status must never look open). Title matches count 3× body matches. This is the "aggressive decay for done/cancelled items" rule of the integration decision, applied at query time instead of via an expiry date.

Scope semantics follow the backlog's per-project nature: omitting `--scope` uses the current repository; `--scope <project>` resolves that project's store root through the central index; `--scope global` is an explicit error (there is no global backlog). Missing or malformed item files are clean misses, never a failed query.

## Invariant
- The index is a rebuildable cache, never the source of truth — `--reindex` must always reconstruct it from the Markdown files.
- Index writes are gated on store canonicality, so temp/test stores cannot pollute the shared database.
- `--source spai` never writes and never indexes: it is a pure read over `docs/spai`, so a backlog edit can never invalidate or pollute the fact store.
