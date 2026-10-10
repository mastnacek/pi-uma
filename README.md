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
  humility, muscle, skeptic — with lazy multi-level completions, `--global`
  variants, and Czech/English i18n.
- **23 CLI commands** (`uma --help`): write, read, list, search, supersede,
  migrate, contracts, consolidate, skill, mcp, timeline, export, doctor, sync,
  scopes, risk, recall, secrets, sessions, import, staging, skeptic, humility.
- **Skill**: `uma-memory-pi` — a single, self-sufficient skill (capture
  triggers, quality contract, lifecycle, plus the Pi tools, approval modal,
  and `/uma` commands), discovered from the conventional `skills/` directory.
  The full harness-agnostic edition lives in `docs/skills/uma-memory/`.

---

## Modal Windows — Visual Overview

The plugin presents **three distinct modal dialogs** in the Pi TUI. Each is
fail-closed (no UI → no action), keyboard-navigable, and supports Czech/English
display translation (the stored data is never translated).

### 1. Memory Proposal Modal (`uma_write` / `uma_supersede`)

**Triggered by:** `uma_write` tool, `uma_supersede` tool (when `autoApprove: false`)

**Purpose:** Review, edit, and approve a new or revised memory fact before it
is stored. The operator sees the exact content that will be written.

```
╭─ UMA Memory Proposal ────────────────────────────────────────╮
│                                                              │
│   📄 DECISION   📁 Scope: Project (pi-uma)                   │
│   🏷️  Tags: #architecture #vsa #rust                          │
│   ⤴ supersedes: 01JABCD123...                                │
│   ⏱ since: 2026-10-09                                        │
│   ⏳ stale_after: 2026-12-31                                  │
│   ⚙ contract: ast-grep [deny]                                │
│   ⚡ fitness: 0.75 [3✓]                                      │
│   🛡 decay-immune                                             │
│                                                              │
│   📌 Title                                                    │
│   Vertical Slice Architecture Enforcement                    │
│                                                              │
│   📄 Body                                                     │
│   ▐ Rule: Slices never import each other                     │
│     • Contracts flow through shared kernel only              │
│     • Composition root does parsing/dispatch only            │
│     • File length ≤ 400 lines hard, 300 soft                 │
│                                                              │
│   ═════════════════════════════════════════════════════════════════════════════
│   ⚙️  Actions:                                                │
│   ▸  ✅ Approve                                              │
│      ✏️  Edit title                                           │
│      ✏️  Edit body                                            │
│      ✏️  Edit tags                                            │
│      📜 View full body                                        │
│      🔄 Toggle scope → (🌐 global)                            │
│      ❌ Reject                                                │
│                                                              │
│   ↑/↓ Select  ·  Enter Confirm  ·  Esc Cancel                │
╰──────────────────────────────────────────────────────────────╯
```

**Key bindings (menu mode):**
| Key | Action |
|-----|--------|
| `↑/↓` | Navigate actions |
| `Enter` | Execute selected action |
| `e` | Edit title |
| `b` | Edit body |
| `t` | Edit tags |
| `s` | Toggle scope (project ↔ global) |
| `v` | View full body (scrollable) |
| `c` | Toggle Czech/English display translation |
| `Esc` | Reject/cancel |

**Full-body view (press `v`):**
```
╭─ UMA Memory Proposal ────────────────────────────────────────╮
│   📄 Body                                             [3-12/47]│
│   ▐ Rule: Slices never import each other                     │
│     • Contracts flow through shared kernel only              │
│     • Composition root does parsing/dispatch only            │
│     • File length ≤ 400 lines hard, 300 soft                 │
│     ...                                                      │
│   ↕ Full view: ↑/↓ scroll, C translate, Esc back             │
│   Translated to Czech (press C to toggle)                    │
╰──────────────────────────────────────────────────────────────╯
```

**Inline editing (press `e`, `b`, or `t`):**
```
╭─ UMA Memory Proposal ────────────────────────────────────────╮
│   ⚠️  Edit title: Type new title, Enter to save, Esc to cancel│
│   ╭────────────────────────────────────────────────────────╮ │
│   │ Vertical Slice Architecture Enforcement                │ │
│   ╰────────────────────────────────────────────────────────╯ │
╰──────────────────────────────────────────────────────────────╯
```

---

### 2. Staging Review Modal (`/uma review` / `/uma staging review`)

**Triggered by:** `/uma review` command, `/uma staging review`, or clicking the
`✦ N drafts` HUD indicator

**Purpose:** Batch-review shadow-worker drafts (compiler/test recoveries, user
corrections, dependency changes) — approve or discard each with inline editing.

```
╭─ ✦ UMA Staging Review • Draft 1 of 3 ────────────────────────╮
│                                                              │
│   ⚡ Trigger: compiler_recovery  Confidence: 85%             │
│   [DECISION]  🏷️ #rust #build #tests                          │
│                                                              │
│   📌 Fix: Cargo test recovery after dependency upgrade       │
│                                                              │
│   Command `cargo test` initially failed:                     │
│   error[E0599]: no function `foo` found                      │
│   Subsequent command succeeded: `cargo build`.               │
│   +8 more lines...                                           │
│                                                              │
│   ├────────────────────────────────────────────────────────┤ │
│   │  ✅ [Enter/a] Approve   📝 [e] Edit   ❌ [d] Discard   │ │
│   │  ➡️  [Tab/→] Next      ⬅️ [←/p] Prev   🚪 [Esc/q] Close│ │
│   ╰────────────────────────────────────────────────────────╯ │
╰──────────────────────────────────────────────────────────────╯
```

**Key bindings:**
| Key | Action |
|-----|--------|
| `Enter` / `a` | Approve draft (writes to memory) |
| `d` / `Del` / `Backspace` | Discard draft |
| `e` | Edit title (then body) |
| `Tab` / `→` / `n` | Next draft |
| `←` / `p` | Previous draft |
| `Esc` / `q` | Close modal |

**Inline editing in staging review:**
```
╭─ ✦ UMA Staging Review • Draft 1 of 3 ────────────────────────╮
│   Editing title: [Enter to Save, Esc to Cancel]               │
│   ╭────────────────────────────────────────────────────────╮ │
│   │ Fix: Cargo test recovery after dependency upgrade      │ │
│   ╰────────────────────────────────────────────────────────╯ │
╰──────────────────────────────────────────────────────────────╯
```

---

### 3. Muscle Consent Dialog (`/uma muscle run <name> --confirm`)

**Triggered by:** `/uma muscle run <routine> --confirm` or `uma_muscle` tool
with confirmation

**Purpose:** Operator consent before executing a curated muscle routine
(operator-approved, repeatable workflows). Without `--confirm` it runs as a
dry-run only.

```
┌──────────────────────────────────────────────────────────────┐
│  ⚡ UMA Muscle Execution                                      │
│                                                              │
│  Run muscle routine "release-checklist"?                     │
│                                                              │
│  This will execute the stored procedural steps.              │
│  The routine was curated by the operator and tagged          │
│  as muscle memory — it is not generated.                     │
│                                                              │
│  [Confirm]  [Cancel]                                         │
└──────────────────────────────────────────────────────────────┘
```

**Note:** In non-interactive sessions (CI, scripts), the dialog is unavailable
so execution is **refused** (fail-closed) — only dry-run output is shown.

---

## Tools Reference

| Tool | Description | Modal? |
|------|-------------|--------|
| `uma_write` | Store a new fact (decision, preference, skill, note, etc.) | ✅ Proposal |
| `uma_read` | Read a complete fact by ULID | ❌ |
| `uma_list` | List facts by scope/type | ❌ |
| `uma_search` | Hybrid BM25 + vector search | ❌ |
| `uma_supersede` | Replace a fact, chaining to predecessor | ✅ Proposal |
| `uma_consolidate` | Find near-duplicates & contradictions (read-only) | ❌ |
| `uma_skill_invoke` | Expand a skill template to a command (never executes) | ❌ |
| `uma_skeptic` | Adversarial critique before risky work (Jev/offline) | ❌ |
| `uma_humility` | Familiarity Index check / confirm hypothesis | ❌ |
| `uma_debt` | Session debt ledger: add, settle, list | ❌ |
| `uma_muscle` | List/run curated routines (consent dialog on run) | ✅ Consent |

---

## Commands Reference (`/uma`)

| Command | Description | Example |
|---------|-------------|---------|
| `/uma search <query>` | Search memory (hybrid) | `/uma search "vsa architecture"` |
| `/uma list [scope]` | List facts | `/uma list --global` |
| `/uma read <id>` | Read a fact by ULID | `/uma read 01JABCD...` |
| `/uma reindex` | Rebuild search index | `/uma reindex` |
| `/uma timeline [--id] [--all]` | Fact history timeline | `/uma timeline --all` |
| `/uma export --out <path>` | Export OKF bundle | `/uma export --out backup.okf` |
| `/uma doctor` | Health check (zombie reaper, etc.) | `/uma doctor` |
| `/uma lang <cs\|en>` | Set display language | `/uma lang en` |
| `/uma recall <on\|off>` | Toggle fastbrain recall gate | `/uma recall on --global` |
| `/uma judge <jev\|off>` | Set recall judge | `/uma judge jev` |
| `/uma immune <off\|warn\|ask\|auto\|block>` | Set immune mode | `/uma immune ask` |
| `/uma hud <on\|off>` | Toggle detector HUD | `/uma hud on` |
| `/uma auto-approve <on\|off>` | Skip proposal modal | `/uma auto-approve off` |
| `/uma review` | Batch-review staging drafts | `/uma review` |
| `/uma staging <action>` | Staging management | `/uma staging list` |
| `/uma debt [list\|settle <id>\|clear]` | Debt ledger | `/uma debt settle DEBT-001` |
| `/uma humility <on\|off>` | Toggle humility gate | `/uma humility on` |
| `/uma muscle [list\|run <name> [--confirm]]` | Muscle routines | `/uma muscle run release-checklist --confirm` |
| `/uma skeptic <intent> [--files a.rs,b.rs] [--off]` | Skeptic check | `/uma skeptic "refactor auth" --files src/auth.rs` |

All commands support `--global` to persist config to `~/.pi/agent/uma.json`
instead of the project-local `.pi/uma.json`.

---

## Detector HUD (Status Widget)

A live widget above the status line showing:

```
🧠 UMA v0.5.0 [bundled] │ 🛡️ immune:ask (3 contract) │ ⚡ recall:on [jev] │ 🔒 gate:modal │ 📁 project:pi-uma (42 facts) │ 📋 2 debt(s) │ ✦ 3 draft(s) · 💪 5
```

Compact mode (narrow terminals):
```
🧠 UMA v0.5.0 │ 🛡️ ask (3c) │ ⚡ on │ 📁 42 facts
```

**Colors:** `🧠` green when engine online, `⚠️` when missing. Contract count,
draft count, and blocking debt count are live.

---

## Display Translation (Czech/English)

- **Scope:** Only the proposal modal body, `/uma read`, `/uma search`, and
  `/uma list` output.
- **Mechanism:** One model call per display (cheap flash model preferred).
- **Invariant:** The translated text **never** reaches the proposal object or
  the CLI. What is stored is always the original byte-identical body.
- **Failure mode:** If translation fails, the original is shown with a dim
  note: `Translation failed (reason)`. The operator always sees something.

---

## Install

```bash
# From GitHub (recommended — reproducible, versioned)
pi install git:github.com/mastnacek/pi-uma

# Local development checkout (for testing only — use `pi -e` instead)
pi install D:/01_programovani/pi/plugins/pi-uma
```

The engine binary ships with the package (`bin/uma.exe`) — a plain clone works
without a Rust toolchain or PATH entry. To rebuild it:
```bash
cd core && cargo build --release && npm run syncbin
```

---

## Repository Layout

```
pi-uma/
├── core/                    # Rust workspace (engine + CLI)
│   ├── Cargo.toml
│   ├── uma-core/            # domain, store, indexer, search, fastbrain, risk, secrets, sources
│   └── uma-cli/             # CLI slices (write, read, list, search, recall, risk, ...)
├── src/                     # Pi plugin slices (TS)
│   ├── shared/              # kernel: client, config, i18n, modal, state, types
│   └── slices/              # commands, fastbrain, immune, modal, tools, translate, ...
├── skills/uma-memory-pi/    # the shipped Pi skill
├── docs/                    # PRD (uma-prd.md), proposals 01–07, reviews, research,
│                            # canonical harness-agnostic skill (docs/skills/uma-memory)
├── .uma/                    # project-scoped memory store (project:pi-uma)
├── index.ts                 # plugin composition root
└── package.json             # pi manifest: extensions + skills
```

---

## Architecture

**Vertical Slice Architecture:**
- `src/slices/<feature>/` — each owns one user-visible capability end-to-end
  with a `README.md` stating its invariant
- `src/shared/` — kernel code (client, config, i18n, modal, types); never
  depends on slices
- `index.ts` — composition root: parsing and dispatch only, **zero business logic**
- Slice-to-slice imports **forbidden**; contracts flow through `src/shared/`
  or the Rust core

**File length:** ≤ 400 lines hard, 300 soft.

---

## Development Workflow

```bash
# 1. Rust core (must pass with 0 warnings)
cd core && cargo test
cargo build --release

# 2. TypeScript plugin
cd ..  # repo root
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test

# 3. After plugin changes: /reload in the running pi session
```

**Single repo:** one commit + push ships everything (Rust core + TS plugin + skill).

---

## License

MIT