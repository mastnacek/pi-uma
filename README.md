# pi-uma — UMA Pi Plugin

Pi coding-agent extension for **UMA (Universal Memory Architecture)** — the
local-first, neurocognitively-inspired long-term memory engine. The complete
system (Rust kernel + CLI + Pi plugin) lives in this single repository.

## What it provides (v0.5.0)

- **10 tools**: `uma_write`, `uma_read`, `uma_list`, `uma_search`,
  `uma_supersede`, `uma_consolidate`, `uma_skill_invoke`, `uma_skeptic`
  (devil's advocate), `uma_humility` (Familiarity Index), `uma_debt`
  (cognitive-debt ledger) — all sharing the same store as the `uma` CLI.
- **Approval modal**: every memory mutation passes a structured, editable
  proposal dialog (fail-closed: no UI, no write). Display translation to Czech
  is presentation-only; what is stored stays byte-identical to the proposal.
- **Fastbrain recall gate** (`before_agent_start`): an independent System-1
  judge (`typesafe/jev-router` via OpenRouter) decides whether memory is worth
  searching for this turn; injects recalled facts as a hidden message and
  reports the decision in a structured block. Operator toggle, default OFF.
- **Cognitive immune interceptor** (`tool_call`): pain score + rule-overlap
  warnings before file edits, plus **block-mode for deterministic AST
  contracts** (`contract:` frontmatter → ast-grep → `uma contracts check`).
  Modes `off | warn | ask | auto | block`; a probabilistic verdict may never
  silently veto (consented blocking only).
- **Internal Council** (Proposal 04, all four pillars):
  - *Skeptic* (`uma_skeptic`): adversarial devil's advocate before risky work.
  - *Pain score* (`uma risk pain`): file risk from corrections + git history.
  - *Debt ledger* (`uma_debt`, `/uma debt`): session-scoped prospective debts,
    auto-captured from Skeptic contract verdicts, enforced at settle boundaries.
  - *Epistemic humility* (`uma_humility`, `/uma humility on`): Familiarity
    Index; LOW familiarity requires Read-Only Explorative Mode (≥3 reads +
    confirmed hypothesis before the first mutation).
- **Shadow worker** (Proposal 02): background telemetry mining (compiler/test
  recoveries, user corrections, dependency changes) → `.uma/.staging/` drafts
  distilled by Jev → `✦ N drafts` HUD indicator → `/uma review` batch consent
  in an interactive TUI modal.
- **Synaptic plasticity** (Proposal 03b): `plasticity:` + `saliency:` OKF v0.3
  frontmatter (Hebbian weight, reinforcements, half-life decay, decay immunity);
  zombie reaper in `uma doctor` proposes (never auto-archives).
- **Detector HUD**: live status widget (engine version, immune/recall/gate
  modes, fact + draft + debt counts) above the status line; `/uma hud on|off`.
- **`/uma` commands**: search, list, read, reindex, timeline, export, doctor,
  lang, auto-approve, recall, judge, immune, hud, review, staging, debt,
  humility — with lazy multi-level completions, `--global` variants, and
  Czech/English i18n.
- **23 CLI commands** (`uma --help`): write, read, list, search, supersede,
  migrate, contracts, consolidate, skill, mcp, timeline, export, doctor, sync,
  scopes, risk, recall, secrets, sessions, import, staging, skeptic, humility.
- **Skill**: `uma-memory-pi` — a single, self-sufficient skill (capture
  triggers, quality contract, lifecycle, plus the Pi tools, approval modal,
  and `/uma` commands), discovered from the conventional `skills/` directory.
  The full harness-agnostic edition lives in `docs/skills/uma-memory/`.

## Install

```bash
pi install git:github.com/mastnacek/pi-uma
# or from a local checkout:
pi install D:/01_programovani/pi/plugins/pi-uma
```

The engine binary ships with the package (`bin/uma.exe`) — a plain clone works
without a Rust toolchain or PATH entry. To rebuild it:
`cd core && cargo build --release && npm run syncbin`.

## Repository layout

- `core/` — the Rust engine (`uma-core`) and `uma` CLI (`uma-cli`)
- repo root — the Pi plugin (this package)
- `skills/uma-memory-pi/` — the shipped Pi skill
- `docs/` — PRD, proposals 01–07, reviews, research, canonical skill edition
- `.uma/` — the project's own memory store (with live AST contracts in
  `.uma/contracts/`)

## Architecture

Vertical Slice Architecture: `src/slices/<feature>/` (each with a README.md
stating its invariant), shared kernel in `src/shared/`, composition root
`index.ts` (wiring only). Slice-to-slice imports are forbidden; shared
contracts live in `src/shared/` or the Rust core.

Standing invariants: proposal-only mutations through the modal; degradation
belongs in the return value, never a log line; auto-blocking is reserved for
deterministic contracts; skills expand, never execute; Jev via OpenRouter is
the canonical System-1 transport (live-tested, never mocked).

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
