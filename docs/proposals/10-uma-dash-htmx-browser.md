# Proposal 10 — `/uma dash`: read-only HTMX browser dashboard for UMA records

**Status:** specification for implementation · **Audience:** a coding model implementing this without making its own design decisions — every choice below is deliberate; follow it, and ask only when reality contradicts the spec.

## 1. Goal

`/uma dash` in pi opens a local web page for browsing and searching UMA memory: fast, mouse **and** keyboard driven, visually a "TUI in a browser" (monospace, dark, box borders, status glyphs — like the herdr plugin panes). Read-only in v1: viewing and searching only, never mutating memory.

## 2. Architecture decision (fixed, do not revisit)

**The dashboard is a plugin-side TypeScript slice, not an engine feature.**

- The engine (`core/`, Rust) stays harness-agnostic and sync; no tokio/axum.
- The plugin already owns every other UMA UI surface (modal, HUD, entries).
- Data flows through the existing `uma` CLI JSON output (`uma list --json`, `uma search --json <q>`), reusing `findUmaBinary` + `runUma` from `src/shared/client.ts`.
- HTTP is `node:http` from the Node standard library. **No new npm dependencies.** HTMX is vendored (§7).
- VSA rules apply: new slice `src/slices/dash/`, slices never import each other, shared code only via `src/shared/`, files ≤ 400 lines hard / 300 soft, `"type": "module"`, imports of local TS files may use the `.ts` specifier (precedent: `modal.ts` imports `./wrap.ts`; `allowImportingTsExtensions` is on and tests run on `node --experimental-strip-types`).

Data flow:

```
browser ──HTTP──> node:http server (plugin slice, 127.0.0.1, random port + token)
                      │  per request
                      ▼
              runUma(bin, ["list","--json",...]) / ["search","--json", q]
                      │
                      ▼
              HTML fragments (server-rendered strings) ──> HTMX swaps
```

## 3. Files to create

```
src/slices/dash/
├── README.md        — what + why + invariant (slice convention)
├── index.ts         — registerDash(pi, state): lifecycle + command glue (≤120 lines)
├── server.ts        — node:http server, routing, token check, static assets (≤250)
├── data.ts          — CLI adapter: listFacts / searchFacts / getFact (≤150)
├── page.ts          — full HTML shell template (≤200)
├── fragments.ts     — HTML fragment renderers: fact card, detail, stats (≤250)
└── assets/
    ├── htmx.min.js  — vendored HTMX 2.x (see §7)
    └── dash.css     — the whole TUI theme (≤300)
```

Touch outside the slice only in two places:

1. `src/slices/commands/index.ts` — add `dash` to the subcommand dispatch (`dash` / `dash stop`), following the existing `else if` chain pattern.
2. `src/slices/commands/complete.ts` — add `dash` completions. **Trailing Space Contract** (AGENTS §3): `dash` itself and `stop` are terminal leaves → **no trailing space** in `item.value`.
3. `index.ts` (composition root) — one line: `track(registerDash(pi, state));` next to the other registrations, so its unsubscribe drains on `session_shutdown`.

## 4. CLI data contract (verified against the engine)

`uma list --json [--type <t>] [--scope <s>]` → JSON array of full records:

```json
[{ "id": "01M4XM…", "title": "…", "body": "…markdown…", "fact_type": "decision",
   "scope": "project:pi-uma" | "global", "tags": ["…"], "effective_weight": 1.0,
   "plasticity": null, "saliency": null, "contract": null }]
```

`uma search --json <query>` →

```json
{ "degraded": false,
  "hits": [{ "id": "…", "title": "…", "fact_type": "pattern", "scope": "…",
             "score": 0.031, "snippet": "…[match]word[/match]…", "status": "stable",
             "supersedes": null, "tags": ["…"], "file_path": "…" }] }
```

Rules for `data.ts`:

- Find the binary with `findUmaBinary(process.cwd())` from `src/shared/client.ts`; run with `runUma`.
- **Strip `[match]` / `[/match]` markers from every string before rendering** (use `stripMatchMarkers` from `../fastbrain/policy.ts`? — NO: slices never import slices. Copy the 3-line regex into `fragments.ts`; it is trivial and the no-cross-import rule wins).
- **HTML-escape every record field** before interpolation (`& < > " '`). Fact bodies are operator-controlled markdown rendered into HTML — escaping is the XSS boundary.
- Body rendering: keep it simple and safe — escape, then apply minimal formatting by string replacement: `### `→`<h4>`, `**x**`→`<strong>`, backtick spans →`<code>`, leading `- `→list items, paragraphs on blank lines. Do NOT pull in a markdown library.
- Non-zero exit or unparseable JSON → render an error fragment (red box, stderr first line), never throw into the HTTP handler uncaught.

## 5. HTTP surface (server.ts)

Bind **127.0.0.1 only**, port **0** (OS-assigned). At startup generate a token (`crypto.randomBytes(16).toString("hex")`); every request must carry `?t=<token>` or header `x-uma-token`; mismatch → 404. The open URL is `http://127.0.0.1:<port>/?t=<token>` and the page propagates the token into every HTMX request via `hx-vals`/`hx-headers` (set `hx-headers='{"x-uma-token":"…"}'` on `<body>`).

| Route | Returns | HTMX use |
|---|---|---|
| `GET /` | full HTML shell (page.ts + assets linked) | initial load |
| `GET /assets/htmx.min.js`, `/assets/dash.css` | static files from `assets/` | shell |
| `GET /frag/facts?q=&type=&scope=&offset=` | fragment: list of fact cards (≤50 per page) + "load more" card when more exist | `hx-get` from search input (`hx-trigger="keyup changed delay:300ms"`), filter chips, and infinite scroll (`hx-trigger="revealed"` on the load-more sentinel) |
| `GET /frag/fact/{id}` | fragment: full detail view of one fact | click / Enter on a card, targets the detail pane |
| `GET /frag/stats` | fragment: header counts (total, by type, by scope) | `hx-trigger="load"` on the header |

- When `q` is empty → `listFacts`; non-empty → `searchFacts`. Filters `type`/`scope` apply in both paths (filter the list results in JS-free server code; for search, filter the returned hits).
- All fragment routes return HTML, never JSON. The page contains no client-side rendering logic beyond HTMX swaps.
- Server must be single-process, no caching of fact data between fragment requests (freshness beats speed; `uma list` is ~70 ms locally). Exception: cache nothing.

## 6. Page design (the "TUI in a browser")

Layout (CSS grid, full viewport, no page scroll — panes scroll internally):

```
┌──────────────────────────────────────────────────────────────┐
│ 🧠 UMA DASH   [🔍 search…              ]  stats: 214 facts   │  header
├──────────────────────────────┬───────────────────────────────┤
│ [all][decision][pattern]…    │                               │  filter chips row
│ ┌──────────────────────────┐ │  ┌─────────────────────────┐  │
│ │ ● [DECISION] title…      │ │  │ [DECISION] Title        │  │
│ │   project:pi-uma · w 1.0 │ │  │ id, scope, tags, weight │  │
│ ├──────────────────────────┤ │  │ ─────────────────────── │  │
│ │ ○ [NOTE] another title…  │ │  │ full body, rendered     │  │
│ │   🌐 global              │ │  │ markdown-lite           │  │
│ │  … (scrolls)             │ │  │ (scrolls)               │  │
│ └──────────────────────────┘ │  └─────────────────────────┘  │
├──────────────────────────────┴───────────────────────────────┤
│ ↑↓/jk move · enter open · / search · esc close · q quit-hint │  status bar
└──────────────────────────────────────────────────────────────┘
```

Fact-card status/type semantics mirror the plugin's existing color language:

- type badge colors: `decision`=accent, `correction`=red, `preference`=green, `pattern`=teal/heading, `skill`=blue, `task`=amber, `note`/`fact`=muted
- scope: `🌐 global` green, `📁 project:<name>` accent
- selected card: accent left-border + slightly raised background
- deprecated facts (`status != "stable"` in search hits): dimmed + strikethrough title

`dash.css` design tokens (herdr-like dark terminal):

```css
:root {
  --bg: #0b0e11; --bg-raise: #12171c; --bg-sel: #1a2229;
  --border: #2a333b; --text: #c9d1d9; --dim: #6e7681; --muted: #8b949e;
  --accent: #58d6eb; --green: #3fb950; --amber: #d29922; --red: #f85149;
  --teal: #39c5cf; --blue: #58a6ff;
  --mono: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
}
```

Box borders are real CSS `1px solid var(--border)` + border-radius 0 (sharp TUI corners), not ASCII art.

## 7. HTMX vendoring (one-time setup step)

1. Download `htmx.min.js` (HTMX 2.x, MIT) once from the official release and commit it to `src/slices/dash/assets/htmx.min.js` with a header comment noting version + license. **No CDN** — UMA is local-first and must work offline.
2. The shell page loads it from `/assets/htmx.min.js`.

## 8. Mouse AND keyboard

- Mouse: native browser behavior — click cards, click chips, scroll panes, click "load more". HTMX covers all of it; no JS needed.
- Keyboard: one small inline `<script>` (≤ 60 lines, the only hand-written JS in the page):
  - `/` focuses search; `Esc` in search blurs it
  - `j`/`k`/`↓`/`↑` move a `selected` class between cards (adds/removes CSS class only)
  - `Enter` triggers a click on the selected card (cards are real `<a>`/`<button>` with `hx-get`, so `.click()` reuses the HTMX path)
  - `Esc` in the detail pane clears it back to the placeholder
  - `g`/`G` jump to first/last card
- Keep focus outlines visible (`:focus-visible` in accent). Never let the keyboard script swallow keys while the search input is focused (except `Esc`).

## 9. Lifecycle (index.ts)

- `registerDash(pi, state)` returns an unsubscribe function; `session_shutdown` drain kills the server (`server.close()`) — a dashboard must never outlive its pi session.
- `/uma dash`: if a server is already running in this session, just re-open the browser URL (store `{server, port, token}` in closure state, not `ExtensionState`). Otherwise start it, then open the browser: on Windows `child_process.exec("start \"\" \"<url>\"")`; macOS `open`; Linux `xdg-open` — pick by `process.platform`.
- `/uma dash stop`: close the server, clear state, notify.
- Notify via `ctx.ui.notify` **guarded by `ctx.hasUI`** (AGENTS invariant 6); in non-UI mode, print the URL to the tool result text instead.
- Missing engine binary: `runUma`/`findUmaBinary` already surface the instructional error; show it in the notify/fragment, do not crash the command.

## 10. Testing

Add `test/dash.test.ts` (node:test + strip-types, like the rest of the suite):

- `fragments.ts` is pure string-in/string-out: test card rendering (badge text, scope icons, escaping — feed it `<script>` in a title and assert it is neutralized), match-marker stripping, deprecated dimming, and the detail fragment.
- `data.ts`: test the JSON-parse/normalize helpers against **recorded fixture strings** (paste real `uma list --json` / `uma search --json` output into the test), not a live binary.
- Do not test the HTTP server over the network; keep server.ts thin enough that the pure parts carry the logic.

## 11. Acceptance criteria (definition of done)

1. `/uma dash` opens the browser on a working dashboard; `/uma dash stop` kills it; session shutdown kills it.
2. Search-as-you-type filters within ~300 ms; type/scope chips filter; "load more" pages.
3. Click **and** keyboard (j/k/Enter/Esc) both fully drive list + detail.
4. No `[match]` markers visible anywhere; injected HTML in a fact body renders inert.
5. No new npm dependencies; `npm run typecheck` clean; `npm test` green (104 + new).
6. Server unreachable without the token and not listening on non-loopback interfaces (verify with a second machine or `netstat`).
7. Commit + push; `/reload` before live testing (operator rule: never test plugin functions without an explicit reload).

## 12. Explicit non-goals (v1)

- No writes/edits/approvals from the browser (consent stays in the TUI modal).
- No WebSocket/live push, no pagination cursor persistence, no themes, no i18n (UI copy is Czech/English-neutral labels; keep strings minimal).
- No engine changes: `core/` and `bin/uma.exe` stay untouched.

---

## 13. Implementation deltas (2026-10-15, committed in `ec0b400` … )

The spec above was implemented as written; the following decisions were added
after the first live review, each with a reason. They supersede the matching
lines above where they differ.

1. **Search filters moved to the CLI (pre-cap).** §5 said to filter the list
   results in server code. For the *search* path that was wrong in a way that
   matters: `uma search` caps its result set (10 by default) before the
   dashboard filtered it, so `type=decision&scope=global` could report "no
   facts match" while matches existed past the cap. Type/scope now go to the
   engine (`--type`, `--scope project|global` — the CLI resolves the literal
   `project` itself), with the code-side filter kept as a safety net. Measured:
   that exact filter went from 0 cards to 2.
2. **`-n 50` for search.** Lifts the engine's 10-hit default so the dashboard
   pages like the browse path. The 10-hit cap is no longer inherited.
3. **Search debounce raised 300 ms → 800 ms.** Hybrid search embeds the query
   live: measured **1246 ms** per call versus **77 ms** for keyword-only, i.e.
   one OpenRouter request per debounced keystroke. The mode is unchanged
   (hybrid by default); the debounce absorbs typing.
4. **Degradation is rendered.** The engine reports `degraded` + `note` when
   hybrid falls back to keyword-only; the dashboard now shows that note as a
   banner above the cards instead of dropping the field. A semantic search that
   silently ranked by BM25 is the failure the engine's own docs call out.
5. **Display translation per card (§12 said "no i18n").** A 🌐 CS control on
   each card translates that card's title and excerpt for display, using the
   same seam as the TUI (`translateTextForDisplay` → `resolveTranslateModel`:
   pi-prompt-translate's configured flash model, else pi's default, else the
   session model — *not* the engine's embedding model). It is a CSS checkbox
   filled once by HTMX: unchecking is free (no request body, no model call, no
   cache), failures keep the original text and show the reason, and stored
   facts stay byte-identical. The detail pane stays untranslated — the browser
   therefore does not mirror the TUI's whole-output translation; that is a
   deliberate scope choice, not an oversight.
6. **`assets/*` is exempt from the token.** §5 required a token on every
   request, but `<link>`/`<script>` cannot send headers and those files carry
   no memory data. All data routes stay token-gated (404 otherwise).

## 14. Record coverage (2026-10-15, second review)

Question asked: "are we displaying all the records UMA has?" No — v1 showed one
slice of the store. Measured on the live store (project + global):

| Record kind | Count then | Now |
| --- | --- | --- |
| Active facts (project 33 + global 20) | 53 | ✅ facts list |
| Deprecated/superseded facts (18 + 8) | 26 | ✅ 🕰 history toggle (dimmed, with status) |
| Supersession chains | 7 chains (up to 7 revisions) | ✅ detail pane, navigable revisions |
| Per-fact metadata (2 contracts, 5 SPAI links, 4 templates, validity, provenance, plasticity/saliency) | all | ✅ detail pane (`read --json` already returned them) |
| Staged drafts, readable | 12 | ✅ 📥 drafts view + draft detail (read-only) |
| Staged drafts written before the `spai` field | 21 (9 project + 12 global) | ✅ **engine fixed** (see below) |
| Muscle routines | 3 | ⚠️ listed as `[SKILL]` facts; routine identity is the title prefix |
| Facts in other project scopes | 11 in 4 stores | ❌ out of scope by decision (`list` refuses non-cwd scopes; only `search --scope` reaches them) |
| Debt ledger, humility flags | session | ❌ not persisted anywhere — no store to read |
| SPAI backlog | 46 items | ❌ deliberately separate (read-only source in the TUI) |

Engine bug found and fixed in the same pass (SPAI-044): `StagedDraft.fact`
required `spai`, so every draft written before that field existed failed to
deserialize, and `list_drafts` swallowed the failure via `if let Ok(...)` — 21
`muscle_synthesis` drafts were invisible to `uma staging list` **and** to the
plugin's review modal. Fix: `#[serde(default)]` on the optional collections
(`spai`, `links`, `verified`) so a schema addition cannot orphan older records,
plus `DraftListing { drafts, skipped }` with a `warning()` — unreadable files are
now reported on stderr (JSON shape unchanged for consumers). Verified: `staging
list` returns 21 drafts (was 12) and `staging show` opens the former orphans.

Also fixed while wiring this up (SPAI-045, recorded): the immune gate refused
read-only inspection commands whenever a store path and any redirect (`2>&1`,
`>`) appeared together.
