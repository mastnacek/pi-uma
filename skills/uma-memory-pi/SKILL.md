---
name: uma-memory-pi
description: Use UMA memory from the Pi agent — native uma_write/read/list/search/supersede tools, the approval modal, /uma commands, and the prudence + muscle surfaces (uma_skeptic, uma_humility, uma_debt, uma_muscle). Load this whenever you capture or retrieve project decisions and preferences, need an adversarial critique, or want to run a curated routine in Pi.
---

# UMA Memory Skill (Pi agent)

Self-sufficient guide for using **UMA** (Universal Memory Architecture,
[mastnacek/ai-memory](https://github.com/mastnacek/ai-memory)) from the Pi agent:
when to capture memory, the quality contract, and the Pi-specific tools,
approval modal, and `/uma` commands. This is the single skill the pi-uma
package ships; the full harness-agnostic edition remains in the UMA
repository (`skills/uma-memory/SKILL.md`).

---

## 1. Prefer the Pi tools over the CLI

In Pi, call the **tools** — they share the same store as the CLI and add the approval workflow:

| Tool | Purpose |
| :--- | :--- |
| `uma_search` | Hybrid BM25 + semantic search. Args: `query`, `mode` (`keyword`\|`semantic`\|`hybrid`), `scope`, `type`, `includeDeprecated`, `asOf`, `limit`. |
| `uma_write` | Store a new fact. Args: `title`, `body`, `type`, `scope`, `tags`, `description`, `template`. Opens the approval modal. |
| `uma_supersede` | Replace a fact with a revised revision. Args: `oldId`, `title`, `body`, `description`, `type`, `scope`, `tags`, `template`. The predecessor is kept as `status: deprecated` and chained via `supersedes`. |
| `uma_consolidate` | Review memory for near-duplicate facts (proposed merges) and opposing facts (contradiction flags). Read-only, ungated. Apply a proposal with `uma_supersede` or `uma_write`. |
| `uma_skill_invoke` | Expand a stored `skill` template into a concrete command. Args: `name`, `set` (`['tag=v1']`), `scope`. Read-only, ungated. Returns **text only** — run the command yourself. |
| `uma_list` | List memories by `scope` and `type`. |
| `uma_read` | Read one fact by `id` (ULID). |
| `uma_skeptic` | Adversarial critique of a risky intent BEFORE executing it. Args: `intent` (synthetic Intent Statement), `files` (touched paths), `judge` (`jev`\|`off`). Read-only, ungated; the verdict is advisory. |
| `uma_humility` | Familiarity check for unfamiliar/intricate subsystems (macros, FFI, unsafe). `action: check` before touching, `confirm` with a falsifiable hypothesis after the required reads. LOW verdict ⇒ read-only exploration first. |
| `uma_debt` | Session-scoped Prospective Debt Ledger. `add` (requiredAction, blocking), `settle` when the owed work is done, `list`. Blocking debts must be settled before declaring a task finished. |
| `uma_muscle` | Run operator-curated routines. `action: list` (read-only), `action: run` + `name` (DRY-RUN only), `action: run` + `confirm: true` (operator consent dialog; fails closed without an interactive UI). |

The `uma` CLI is still available in `bash` (and is the only path in non-interactive runs), but
inside an interactive Pi session the tools are preferred because they route through approval.

### Skills (procedural memory)

A `skill` fact carries a `template` — a command with `{{placeholder}}` slots. Author one when you
worked out a non-obvious command or sequence you would otherwise re-derive next session: call
`uma_write` with `type: "skill"` plus `template`, and it goes through the normal approval modal
(there is no separate gated tool for this).

**`uma_skill_invoke` expands a template and returns text. It never executes anything.** Run the
returned command yourself with `bash`, so your own command approval still applies. Never treat
UMA as an execution primitive. If the expansion reports missing placeholders, supply them — they
are left visible rather than silently blanked.

To revise a skill, use `uma_supersede`; the template is inherited unless you pass a new one.

### Muscle (compiled action chunks — consented execution)

A **muscle routine** is an operator-curated skill fact titled `muscle:<name>`, tagged `muscle`,
whose `template` is a JSON array of steps `[{"command":"...","args":[...],"label":"..."}]`.
It is the execution counterpart of `uma_skill_invoke` (which only expands):

- `uma_muscle {action:"list"}` — catalog of curated routines (read-only).
- `uma_muscle {action:"run", name}` — **dry-run only**: prints what would execute, runs nothing.
- `uma_muscle {action:"run", name, confirm:true}` — opens the operator consent dialog; in a
  non-interactive mode there is no consent surface, so execution is **refused (fail-closed)**.
  A decline also returns only the dry-run path — never retry.

The shadow worker detects repeated command sequences (≥2× the same 3-command shape, hazardous
commands excluded) and stages a routine PROPOSAL into `.uma/.staging/` — it never curates or runs
itself. The operator promotes proposals through `/uma review` ([a]pprove → curated skill fact).
Do not stage muscle proposals by hand unless the operator asks; the hook owns that path.

### Prudence council (consult before risky work)

- **Skeptic** — call `uma_skeptic` with a one-paragraph intent BEFORE architecturally sensitive
  changes (locking, serialization, public APIs, migrations). Treat the verdict as advisory;
  surface the concrete advice instead of silently ignoring it.
- **Humility** — before touching a subsystem with no memory coverage or intricate constructs,
  run `uma_humility {action:"check", intent, files}`. A LOW verdict demands read-only
  exploration (≥3 related files) then `action:"confirm"` with a falsifiable hypothesis before
  the first mutation.
- **Debt Ledger** — when your action creates an obligation ("must verify X later"), record it
  with `uma_debt {action:"add", requiredAction, blocking, sourceAction}` and settle it with
  `settle` once done. Blocking debts are enforced at `agent_before_settle` (session end).

### Contracts, doctor and dreaming

- `uma contracts check` validates executable AST invariants (`.uma/contracts/*.yml`); the immune
  interceptor may auto-block violating writes in `block` mode.
- `uma doctor --strict` is the health gate; `--dream` runs retrieval practice over the store and
  proposes REINFORCE/BLURRED only (never mutates without consent).

---

## 2. Approval modal (what the operator sees)

Unless auto-approval is on, `uma_write`/`uma_supersede` open a review window first. The operator can:

- **[Enter]** approve and save,
- **[e]** edit the title, **[b]** edit the body, **[t]** edit the tags,
- **[s]** toggle scope (`project` ⇄ `global`),
- **[Esc]** reject — nothing is written.

If the operator edits the proposal, the edited version is what gets stored. If they reject, the
tool returns `details.rejected = true` and **you must not retry the write** — treat it as a
deliberate decision and move on.

---

## 3. Approval gate (fail-closed)

A `tool_call` hook (`src/hooks/approval_gate.ts`) guards every memory-mutating tool
(`uma_write`, `uma_supersede`, `uma_consolidate`):

- **Interactive TUI** + auto-approve off → allowed, modal opens.
- **Interactive TUI** + auto-approve on → allowed, writes directly.
- **No interactive UI** (`pi -p`, RPC, JSON, or a nested `codemode` call) + auto-approve off →
  **blocked** with an actionable reason.

Consequences for you:

- You **cannot** write memory from a non-interactive or scripted context unless the operator has
  enabled auto-approval. Do not attempt workarounds; surface the block reason instead.
- When a write is blocked, tell the operator to run interactively, or to enable
  `/uma auto-approve on`.
- Do not call the `uma` CLI to deliberately bypass the gate — that defeats the operator's consent
  and writes without review.

---

## 4. Slash commands

```text
/uma search <query>
/uma list [global]
/uma read <id>
/uma reindex
/uma lang cs|en [--global]
/uma auto-approve on|off [--global]
/uma recall on|off [--global]      # fastbrain recall gate
/uma judge jev|off [--global]      # recall judge transport
/uma immune off|warn|ask|auto|block [--global]
/uma hud on|off
/uma review                        # staged-draft review modal (approve/edit/discard)
/uma staging list|approve|discard
/uma debt list|settle <id>|clear
/uma humility on|off [--global]    # epistemic-humility gate
/uma muscle list | run <name> [--confirm]
/uma skeptic <intent> [--files a.rs,b.rs] [--off]
```

`auto-approve on` skips the modal for trusted bulk work; `off` (default) keeps operator review.
Settings use the normal cascade: without `--global` they are written to `<cwd>/.pi/uma.json`;
with it, to `~/.pi/agent/uma.json`.

---

## 5. Reload rule

**After modifying any UMA Pi extension code or resources, the operator must run `/reload` before
the new behaviour is exercised.** Never invoke a freshly modified plugin tool autonomously without
that reload — the running session still has the old module graph. When unsure whether a reload
happened, say so and wait rather than triggering the tool.

---

## 6. Working with the operator

- **Propose, do not impose.** For anything worth remembering, call `uma_write` so the operator can
  approve, edit, or reject it. Do not pre-approve on their behalf.
- **Check before writing** with `uma_search` to avoid duplicating an existing fact; prefer
  `uma_supersede` when revising one.
- **Search on demand.** Do not assume memories were injected into your context; retrieve
  explicitly when a task depends on prior decisions or preferences.

---

## 7. Portable essentials (from the harness-agnostic edition)

### When to capture

| Trigger | Type | Scope |
| :--- | :--- | :--- |
| Architectural choice made | `decision` | project |
| User states a preference | `preference` | global |
| Repeated codebase convention observed | `pattern` | project |
| Wrong assumption corrected | `correction` | project / global |
| Environmental fact (URL, port, build req.) | `fact` | project |
| Non-obvious command worked out | `skill` (+ `template`) | project / global |

Do NOT store: chat chatter, throwaway code dumps, things already fully documented in standard files.

### Quality contract

1. **Atomic** — one concept per fact.
2. **Actionable title** — "Adopt VSA for CLI modules", not "Architecture notes".
3. **Structured body** — Context / Rule / Consequences.
4. **One-line description** — search snippet.
5. **Tags** — lowercase ASCII keywords.
6. **Invariants, not volatile state** — state the rule that stays true, not a count that was true when written.

### Lifecycle

- A fact that changed is **superseded**, never duplicated: the predecessor
  is deprecated and chained via `supersedes`; default search stays clean.
- Facts are OKF v0.2 documents: frontmatter keys `type`, `title`,
  `description`, `tags`, `status`, `generated`, `verified`, `since`/`until`/
  `stale_after`, plus UMA's `id`, `scope`, `supersedes`, `template`.
- Retrieval modes: `keyword` (exact terms), `semantic` (meaning), `hybrid`
  (default, RRF of both). Prefer search on demand over auto-injection.

### CLI quick reference (the tools cover most of this)

```bash
uma search "query" --mode hybrid [--as-of DATE] [--include-deprecated]
uma write --type decision --title "..." --tags a,b      # or via the uma_write tool
uma read <ULID> ; uma list --scope global ; uma timeline --id <ULID>
uma supersede <old-id> --title "..."                    # inherits template unless --template
uma skill invoke <name> --set k=v                        # expands, NEVER executes
```

`skill` facts need a `template` with `{{placeholder}}` slots; UMA never
runs the expansion — the caller does, under its own approval.
