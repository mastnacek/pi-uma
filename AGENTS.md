# AGENTS.md — UMA (Universal Memory Architecture) — consolidated repository

Architectural mandate for AI agents working on **UMA**, now a single repository
containing the full system: the Rust memory engine, the Pi agent plugin, and the
project documentation. Formerly split across `mastnacek/ai-memory` (Rust core,
docs) and this repository (plugin); consolidated 2026-10-09.

## 1. What UMA Is

A local-first, high-performance, agent-controlled memory engine with:

- **Rust core (`core/`)**: the `uma` CLI binary (`core/uma-cli`, binary name
  `uma`) and the engine library (`core/uma-core`) — storage (OKF v0.2 markdown
  files), SQLite FTS5 + vector index, search, consolidation, secrets gate,
  fastbrain (offline/Jev judges), risk scoring, session import.
- **Pi plugin (repo root)**: VSA TypeScript extension — `uma_*` tools, fail-closed
  approval modal, fastbrain recall gate, immune interceptor, `/uma` commands,
  Czech/English i18n, display-only translation. Installed globally via
  `pi install git:github.com/mastnacek/pi-uma`.
- **Skill (`skills/uma-memory-pi/`)**: the single shipped skill (self-sufficient).
  The full harness-agnostic edition lives at `docs/skills/uma-memory/SKILL.md`
  as reference material (not shipped by the package).

## 2. Mandatory Architecture: Vertical Slice Architecture (VSA)

Both the Rust CLI and the TypeScript plugin follow VSA
(`references/vsa-architecture.md` in the pi-plugin-dev skill):

1. **Composition root** (`index.ts` for the plugin, `core/uma-cli/src/main.rs`
   for the CLI): parsing and dispatch only — zero business logic.
2. **Shared kernel**: `core/uma-core/` (Rust) and `src/shared/` (TS). Shared code
   never depends on individual slices.
3. **Feature slices**: `core/uma-cli/src/slices/<feature>/` and
   `src/slices/<feature>/` — each slice owns one user-visible capability
   end-to-end and documents itself with a `README.md` (what + why + invariant).
   **Slices never import each other**; contracts flow through the shared kernel.
4. **File length**: ≤ 400 lines hard, 300 soft.

## 3. Directory Layout

```text
pi-uma/
├── core/                    # Rust workspace (the engine + CLI)
│   ├── Cargo.toml
│   ├── uma-core/            # domain, store, indexer, search, fastbrain, risk, secrets, sources
│   └── uma-cli/             # CLI slices (write, read, list, search, recall, risk, ...)
├── src/                     # Pi plugin slices (TS)
│   ├── shared/              # kernel: client, config, i18n, modal, state, types
│   └── slices/              # commands, fastbrain, immune, modal, tools, translate, ...
├── skills/uma-memory-pi/    # the shipped Pi skill
├── docs/                    # PRD (uma-prd.md), proposals, reviews, alr research,
│                            # canonical harness-agnostic skill (docs/skills/uma-memory)
├── .uma/                    # project-scoped memory store (project:pi-uma)
├── index.ts                 # plugin composition root
└── package.json             # pi manifest: extensions + skills
```

## 4. Development & Verification Workflow

Run from the repo root after any change (see memory fact `verify-uma-changes`):

1. `cd core && cargo test` — must pass with 0 warnings
2. `cargo build --release` — separate gate; warnings outside `cfg(test)` show only here
3. repo root: `npm run typecheck && npm test`
4. If plugin code changed: `/reload` in the running pi session before live use
5. Single repo now: one commit + push ships everything

The plugin locates the engine via `findUmaBinary` (`src/shared/client.ts`):
`core/target/release/uma.exe` relative to the package, then PATH. After moving
or first cloning, build it: `cd core && cargo build --release`.

## 5. Standing Invariants (recorded in memory)

- All memory mutations pass the approval modal (fail-closed; never bypass via CLI).
- Consolidation proposes, never applies; skills expand, never execute; MCP
  read-only unless `--allow-writes`; sync is git-based, global store only.
- Auto-blocking is reserved for deterministic contract-backed rules; probabilistic
  verdicts (Jev) may only warn — immune `auto` mode asks today.
- Degradation belongs in the return value, not a log line.
- Translation is display-only: stored data stays byte-identical to the proposal.
- Facts describe invariants, not volatile state.
