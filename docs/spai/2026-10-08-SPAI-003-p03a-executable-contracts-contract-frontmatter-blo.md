---
type: Todo
title: "P03a Executable Contracts & Immune Interceptor Block-Mode (Epic)"
timestamp: 2026-10-08 23:15:05
status: done
source: pi-spai
tags: [roadmap, p03, contracts, ast-grep]
facets:
  priority: medium
  project: ai-memory
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-003: P03a Executable Contracts & Immune Interceptor Block-Mode (Epic)

x P03a executable contracts: contract: frontmatter block → ast-grep rule export (.uma/contracts/sgconfig.yml) → generated architecture_invariants.rs + `uma contracts check`; block-mode for the immune interceptor ONLY for contract-backed rules @pi-uma !medium :roadmap:p03:contracts:ast-grep:

## Context & Vision
Governed by decision `01M4EP264QYX1FA23JQKT3GFQM`: auto-blocking in the cognitive immune interceptor is strictly reserved for deterministic AST contracts, while heuristic / probabilistic model verdicts may only warn or prompt.

This epic unlocks the deterministic block-mode of Proposal 01 by implementing Proposal 03a executable contracts.

## Connected Subtasks
- **SPAI-007**: P03a.1 OKF Contract Schema: add `contract` struct to `domain.rs`, `serialization.rs`, and TS types.
- **SPAI-008**: P03a.2 Engine & CLI `uma contracts`: generate `.uma/contracts/` rules, `tests/architecture_invariants.rs`, and implement `uma contracts check`.
- **SPAI-009**: P03a.3 Immune Interceptor Block-Mode: evaluate deterministic contracts on `tool_call` and enforce hard blocking in `auto`/`block` mode.
- **SPAI-010**: P03a.4 Live VSA Invariant & End-to-End Tests: attach contract to `01M4D7S5`, wire `cargo test` invariant and unit tests for block vs ask.
