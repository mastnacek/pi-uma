# dash — read-only HTMX browser dashboard

**What.** `/uma dash` starts a loopback-only `node:http` server that renders UMA
as a "TUI in a browser": monospace, dark, box borders, mouse **and** keyboard
driven. `/uma dash stop` closes it. A dashboard never outlives its pi session
(`session_shutdown` drains the unsubscribe returned by `registerDash`).

**Why a plugin slice, not an engine feature.** The Rust core stays
harness-agnostic and sync (no tokio/axum); the plugin already owns every other
UMA UI surface. Data flows through the existing `uma` CLI JSON output, so the
engine gains no HTTP dependency. HTTP is `node:http` from the standard library —
**no new npm dependencies** (HTMX is vendored in `assets/`).

## Record coverage

Every record kind UMA can store, and where it appears:

| Record kind | Read via | In the dash |
| --- | --- | --- |
| Active facts (cwd project + global) | `list --json` | facts list |
| Deprecated / superseded facts | `list --include-deprecated` | 🕰 history toggle, dimmed |
| Supersession chains | `timeline --json --id` | detail pane ("🕰 history") |
| Full fact metadata: status, validity (since/stale_after/until), provenance (generated/verified), SPAI + fact links, AST contract, skill template, plasticity, saliency | `read --json` | detail pane |
| Staged drafts (shadow worker + muscle synthesiser), with confidence and provenance | `staging list --json` / `staging show --json` | 📥 **section of the list pane**, above the facts + draft detail |
| Muscle routines | skill facts tagged `muscle` (surfaced by `uma muscle list`) | as `[SKILL]` in the facts list |
| Facts in other project scopes | `search --scope <name>` (the engine refuses `list` outside cwd) | ❌ out of scope by decision |
| Debt ledger, humility flags | plugin session state only — **never persisted** | ❌ impossible (no store to read) |
| SPAI backlog | separate store, `search --source spai` | ❌ deliberately separate |

Not stored records (nothing to show): risk pain score, secrets scan, recall/route
verdicts, skeptic/humility verdicts, consolidation proposals, doctor/export/scopes,
session browsing and import (import *produces* drafts).

## Files

| File | Role |
| --- | --- |
| `index.ts` | Lifecycle + browser glue; exposes start/stop on `state.dash` |
| `server.ts` | `node:http` routing, token gate, static assets, bounded `POST /frag/translate` |
| `record.ts` | The record model + pure normalization (list/read/search shapes → `DashFact`) |
| `data.ts` | Fact queries: list/search/read abstractions, history diffing, chains, counts |
| `drafts.ts` | Staging adapter (`staging list`/`show --json`) |
| `fragments.ts` | Fact cards, stats, errors, the shared 🌐 toggle, escaping boundary |
| `detail.ts` | Detail pane: metadata, contract, template, chain, body |
| `draft_fragments.ts` | Draft card (same toggle as a fact) + draft detail (read-only) |
| `listing.ts` | Composes the pane: pending drafts first, then the stored-facts page |
| `page.ts` | Full HTML shell (grid layout, chips, history toggle, keyboard script) |
| `assets/htmx.min.js` | Vendored HTMX 2.0.6 (MIT) — no CDN, works offline |
| `assets/dash.css` | The whole TUI theme (design tokens) |

## Invariants

1. **Read-only.** Only `list`/`search`/`read`/`timeline`/`staging list|show` are
   invoked, always with `--json`. Nothing here writes or promotes anything;
   mutations and draft approval stay in the TUI modal.
2. **Loopback + token.** Bound to `127.0.0.1`, port 0 (OS-assigned), with a
   16-byte hex token required as `?t=` or `x-uma-token`; mismatches get a bare
   404. `/assets/*` is exempt (link/script tags cannot send headers, and those
   files carry no memory data).
3. **Escaping is the XSS boundary.** `fragments.ts` escapes every record field
   before interpolation; fact bodies are markdown-lite rendered *after*
   escaping. The engine's `[match]` markers never reach the browser.
4. **Degradation is data and is visible.** A non-zero CLI exit or unparseable
   JSON becomes an error fragment; an engine search that falls back from hybrid
   to keyword-only is shown as a banner; unreadable staging files are surfaced
   as a warning instead of being hidden — a draft the operator cannot see is a
   draft they cannot review.
5. **Retired facts never look current.** The default list is active-only; the
   🕰 history toggle asks the engine for `--include-deprecated` and dims them.
   The list JSON has no status field, so inactivity is derived by diffing the
   active and full listings (two cheap calls, no per-fact `read`).
6. **No caching.** Every fragment request re-runs the CLI (~70 ms locally) so
   the dashboard always reflects the live store. The only exception is derived
   display data: a per-card translation is fetched once and kept in the DOM, and
   unchecking the toggle sends no body at all.
7. **No slice-to-slice imports.** The commands slice dispatches
   `/uma dash [stop]` through `state.dash`, wired by the composition root.
8. **Scope chips are real CLI scopes.** `uma list` defaults to the current
   project, so the "all" chip merges `list` + `list --scope global` (deduped by
   id). Type/scope also go to the CLI **before** the result cap (`--type`,
   `--scope project|global`) — filtering the returned top-N in code could report
   "no facts match" while matches exist past the cap.
9. **Search is the engine's own hybrid mode.** `-n 50` lifts the engine's
   10-hit default so the list can page; no `--mode` is passed, so hybrid
   (BM25 + stored vectors, RRF) runs. That means one live OpenRouter embedding
   call per search (~1.2 s measured, vs 77 ms keyword-only), which is why the
   search box debounces at 800 ms.
10. **Display translation is per card, display-only, optional.** The 🌐 CS
    toggle is a CSS checkbox: HTMX fills `.trans` once, unchecking is free (no
    request body, no model call, no cache), and a failure keeps the original
    text plus the reason. It uses the TUI's own model seam
    (`translateTextForDisplay` → the flash model), never the engine's embedder.
    `renderTranslationToggle` is shared, so a **draft card is translatable
    exactly like a fact card** — the queue reads in Czech while the TUI review
    keeps the English original. Stored facts and draft files stay byte-identical.
11. **Drafts are list elements, never a mode.** Pending proposals appear in the
    same pane as the facts — above them, under a `📥 pending review` heading with
    their count — and are filtered by the same chips and search box (type/scope
    match the *proposed* record; a search term matches title, body, tags or
    trigger). They use the same selection keys and the same detail pane. There is
    no separate drafts view, no button, and no approve/discard control by
    construction: `uma staging` remains the only promotion path, and its
    unreadable-file warnings are carried into the pane as a banner.
