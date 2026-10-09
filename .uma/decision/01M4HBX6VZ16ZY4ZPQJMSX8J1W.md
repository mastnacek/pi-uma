---
id: 01M4HBX6VZ16ZY4ZPQJMSX8J1W
scope: "project:pi-uma"
type: decision
title: "Skill templates expand, never execute — except operator-curated muscle routines with explicit --confirm consent"
tags:
  - skill
  - s6
  - safety
  - execution
  - muscle
  - consent
status: stable
supersedes: 01M4DGRW9Q85PXXE11G9NA0BWQ
generated:
  by: pi-agent/1.1
  at: "2026-10-09T22:17:59.423890300+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T22:17:59.423890600+00:00"
since: "2026-10-08T10:26:02.679874300+00:00"
---
### Context
Procedural muscle memory (Proposal 05, Pillar I) compiles operator-curated action chunks (`uma muscle run <name>`): native step sequences that run locally without LLM calls. The original expansion-only decision was written before this slice existed; a literal reading ("UMA never runs a command") would forbid the routine executor entirely.

### Rule (amended)
- `uma_skill_invoke` / `uma skill invoke` remain **expansion-only** — unchanged.
- Muscle execution is a **separate, consented path**: routines must be **operator-curated** (`uma muscle new`, a gated memory write through the modal); the shadow worker may only propose candidates via staging, never compile or run one itself.
- `uma muscle run` is a **dry-run by default** — it prints the sequence and executes nothing. Execution requires the explicit `--confirm` flag: the launch-time consent step, mirroring MCP's `--allow-writes`.
- Steps are parsed data (JSON or minimal YAML), validated at curation time, executed sequentially in the repo root, first failure stops the pass, and results are reported as a compressed summary.
- UMA still never runs arbitrary stored templates — only validated step-lists of operator-curated routines.

### Consequences
- The memory store still cannot be used as an arbitrary execution primitive: only curated, modal-approved routines with explicit per-run consent execute.
- Missing placeholders stay visible (expansion rule unchanged); a routine with an unparsable template is refused at curation, not at run time.
- The agent states only the motor intent; routine rounds save ~85% time and ~90% tokens (Proposal 05).