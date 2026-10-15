# dash — read-only HTMX browser dashboard

**What.** `/uma dash` starts a loopback-only `node:http` server that renders
UMA memory as a "TUI in a browser": monospace, dark, box borders, mouse **and**
keyboard driven. `/uma dash stop` closes it. A dashboard never outlives its pi
session (`session_shutdown` drains the unsubscribe returned by `registerDash`).

**Why a plugin slice, not an engine feature.** The Rust core stays
harness-agnostic and sync (no tokio/axum); the plugin already owns every other
UMA UI surface. Data flows through the existing `uma` CLI JSON output
(`list --json`, `search --json`, `read --json`) via `findUmaBinary` + `runUma`,
so the engine gains no HTTP dependency. HTTP is `node:http` from the standard
library — **no new npm dependencies** (HTMX is vendored in `assets/`).

**Files.**

| File | Role |
| --- | --- |
| `index.ts` | Lifecycle + browser glue; exposes start/stop on `state.dash` |
| `server.ts` | `node:http` routing, token gate, static assets, bounded `POST /frag/translate` |
| `data.ts` | CLI adapter + pure normalize/filter/page helpers. Scope chips map onto the CLI (`--scope global|project`, bare `list` = project); the "all" chip merges both stores, because a bare `list` returns the project store only |
| `page.ts` | Full HTML shell (grid layout, chips, keyboard script) |
| `fragments.ts` | Pure HTML fragment renderers + escaping boundary + the per-card translation control and degraded banner |
| `assets/htmx.min.js` | Vendored HTMX 2.0.6 (MIT) — no CDN, works offline |
| `assets/dash.css` | The whole TUI theme (design tokens) |

**Invariants.**

1. **Read-only.** Only `list`/`search`/`read` are invoked. Nothing here writes
   memory; all mutations keep going through the TUI approval modal.
2. **Loopback + token.** Bound to `127.0.0.1`, port 0 (OS-assigned), with a
   16-byte hex token required as `?t=` or `x-uma-token`; mismatches get a bare
   404. `/assets/*` is exempt (link/script tags cannot send headers, and those
   files carry no memory data).
3. **Escaping is the XSS boundary.** `fragments.ts` escapes every record field
   before interpolation; fact bodies are markdown-lite rendered *after*
   escaping. The engine's `[match]` markers never reach the browser.
4. **Degradation is data.** A non-zero CLI exit or unparseable JSON becomes an
   error fragment (`renderError`), never an uncaught throw in the handler.
5. **No caching.** Every fragment request re-runs the CLI (~70 ms locally) so
   the dashboard always reflects the live store.
6. **No slice-to-slice imports.** The commands slice dispatches
   `/uma dash [stop]` through `state.dash`, wired by the composition root.
7. **Scope chips are real CLI scopes.** `uma list` defaults to the current
   project, so the "all" chip merges `list` + `list --scope global` (deduped by
   id); `search` covers both stores by default. Type/scope also go to the CLI
   **before** the result cap (`--type`, `--scope project|global`), because
   filtering the returned top-N in code could report "no facts match" while
   matches exist past the cap. Code-side filtering stays as a safety net.
8. **Search is the engine's own hybrid mode.** `-n 50` lifts the engine's
   10-hit default so the list can page; no `--mode` is passed, so hybrid
   (BM25 + stored vectors, RRF) is what runs. That means one live OpenRouter
   embedding call per search (~1.2 s here, vs 77 ms keyword-only), which is why
   the search box debounces at 800 ms instead of 300 ms.
9. **Degradation is shown, never swallowed.** `uma search` reports
   `degraded` + `note` when hybrid falls back to keyword-only; the note is
   rendered as a banner above the cards. The engine's rule is explicit: a
   caller who asked for hybrid ranking must not silently receive BM25.
10. **Display translation is per card, display-only, and optional.** The 🌐 CS
   toggle on a card is a CSS checkbox: HTMX fills `.trans` once
   (POST `/frag/translate`), and unchecking reveals the original with **no**
   second request and **no** model call (the request carries no `checked`
   field). Two translations per card (title, excerpt) in parallel, because the
   shape of the card must survive translation; text travels in the request
   body so the translation is of exactly what is on screen. Nothing is cached
   and nothing is stored: the original text always remains in the DOM, and a
   failure shows the original plus the reason. Facts stay byte-identical to
   what the engine returned.
