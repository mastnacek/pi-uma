---
type: Todo
title: "P03a.2 CLI uma contracts: generate .uma/contracts/ rules, architecture_invariants.rs and uma contracts check"
timestamp: 2026-10-09 20:15:54
status: done
source: pi-spai
tags: [roadmap, p03a, contracts, cli, ast-grep]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-008: P03a.2 CLI uma contracts: generate .uma/contracts/ rules, architecture_invariants.rs and uma contracts check

x P03a.2 CLI uma contracts: generate .uma/contracts/ rules, architecture_invariants.rs and uma contracts check @pi-uma !medium :roadmap:p03a:contracts:cli:ast-grep:

## Goal
Implement the contract generation, compilation, and checking subsystem in the Rust engine and CLI.

## Technical Specifications
1. **Engine Module (`core/uma-core/src/contracts/`)**:
   - `export_contracts(store: &Store, target_dir: &Path)`:
     - Scans all active facts with `contract` blocks.
     - Writes `.uma/contracts/sgconfig.yml`: ast-grep rule config.
     - Writes `.uma/contracts/<fact_id>.yml`: individual ast-grep rule files with metadata (id, language, rule pattern, message, severity).
     - Generates/updates `tests/architecture_invariants.rs` test harness.
   - `check_contracts(store: &Store, path_filter: Option<&Path>) -> Result<Vec<ContractViolation>>`:
     - Discovers `ast-grep` binary (checking system PATH, local `.pi/agent/npm/node_modules/`, or npm global).
     - Executes `ast-grep scan` against the codebase using `.uma/contracts/`.
     - Returns typed structured findings (`fact_id`, `file`, `line`, `rule_message`, `severity`).
2. **CLI Slice (`core/uma-cli/src/slices/contracts/`)**:
   - Add command `uma contracts`:
     - `uma contracts export [--out <dir>]`: exports yaml rules and integration test.
     - `uma contracts check [--json] [--path <file>]`: runs the deterministic check and reports results (or exits non-zero if `severity == deny`).
3. **Dependencies**: Requires `SPAI-007`. Unlocks `SPAI-009` and `SPAI-010`.
