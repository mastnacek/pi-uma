# pi-uma — UMA Pi Plugin

Pi coding-agent extension for **UMA (Universal Memory Architecture)**, the
local-first long-term memory engine at [mastnacek/ai-memory](https://github.com/mastnacek/ai-memory).

## What it provides

- **Tools**: `uma_write`, `uma_read`, `uma_list`, `uma_search`, `uma_supersede`,
  plus recall/immune helpers — all sharing the same store as the `uma` CLI.
- **Approval modal**: every memory mutation passes a structured, editable
  proposal dialog (fail-closed: no UI, no write). Display translation to Czech
  is presentation-only; what is stored stays byte-identical to the proposal.
- **Fastbrain recall gate** (`before_agent_start`): judges whether memory is
  worth searching for this turn; injects recalled facts as a hidden message and
  reports the decision in the console. Operator toggle, default OFF.
- **Immune interceptor** (`tool_call`): checks memory rules and the pain score
  before file-mutating edits. Modes `off | warn | ask | auto` — `ask` shows a
  🛡️ confirm dialog and a decline blocks the call (consented blocking);
  `auto` asks today and will auto-block only deterministic contract-backed
  rules once contracts land.
- **`/uma` commands**: search, list, read, timeline, doctor, lang, recall,
  immune, judge, auto-approve — with completions and Czech/English i18n.
- **Skill**: `uma-memory-pi` — a single, self-sufficient skill (capture
  triggers, quality contract, lifecycle, plus the Pi tools, approval modal,
  and `/uma` commands), discovered from the conventional `skills/` directory.
  The full harness-agnostic edition lives in the
  [ai-memory repository](https://github.com/mastnacek/ai-memory).

## Install

```bash
pi install git:github.com/mastnacek/pi-uma
# or from a local checkout:
pi install D:/01_programovani/pi/plugins/pi-uma
```

The `uma` CLI (`mastnacek/ai-memory`) must be on PATH — the extension shells
out to it for reads and search.

## Repository layout

This repository contains the **complete UMA system** (consolidated from the
former `mastnacek/ai-memory` monorepo):

- `core/` — the Rust engine and `uma` CLI (`cargo build --release` in `core/`)
- repo root — the Pi plugin (this package)
- `skills/uma-memory-pi/` — the shipped Pi skill
- `docs/` — PRD, proposals, reviews, research, canonical harness-agnostic skill
- `.uma/` — the project's own memory store

## Architecture

Vertical Slice Architecture: `src/slices/<feature>/` (each with a README.md
stating its invariant), shared kernel in `src/shared/`, composition root
`index.ts` (wiring only). Slice-to-slice imports are forbidden; shared
contracts live in `src/shared/` or the `uma` Rust core.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test
```

Every extension change requires a `/reload` in the running pi session before
live use.

## License

MIT
