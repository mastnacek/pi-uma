---
type: Todo
title: "P03a.4 Live VSA Invariant & End-to-End Tests: add contract to 01M4D7S5, wire cargo test and unit tests for block vs ask"
timestamp: 2026-10-09 20:16:00
status: done
source: pi-spai
tags: [roadmap, p03a, contracts, testing, vsa]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-010: P03a.4 Live VSA Invariant & End-to-End Tests: add contract to 01M4D7S5, wire cargo test and unit tests for block vs ask

x P03a.4 Live VSA Invariant & End-to-End Tests: add contract to 01M4D7S5, wire cargo test and unit tests for block vs ask @pi-uma !medium :roadmap:p03a:contracts:testing:vsa:

## Goal
Verify the end-to-end integration by equipping real architectural decision `01M4D7S5YART7AGWN7RDSRNRM1` (Strict VSA) with a live contract, compiling invariants into `cargo test`, and validating immune block-mode in TypeScript tests.

## Technical Specifications
1. **Live Memory Contract**:
   - Update `.uma/decision/01M4D7S5YART7AGWN7RDSRNRM1.md` (Strict Vertical Slice Architecture) with:
     ```yaml
     contract:
       engine: "ast-grep"
       severity: "deny"
       rule:
         pattern: "use crate::slices::$$$REST;"
         inside: "src/slices/**"
         message: "Inviolable VSA Rule: Slices must NEVER import each other directly! Use uma-core or src/shared."
     ```
2. **Cargo Integration Test**:
   - Add `tests/architecture_invariants.rs` to `core/uma-cli/` or workspace tests:
     - Automatically verifies all exported `.uma/contracts/` against the codebase during `cargo test`.
3. **TypeScript Unit Tests (`test/immune.test.ts`)**:
   - Test case: contract breach with `severity: deny` triggers `{ kind: "block" }` in `auto` and `block` modes.
   - Test case: heuristic warning without contract triggers `{ kind: "confirm" }` in `auto` mode and `{ kind: "notify" }` in `warn` mode.
   - Test case: clean edit touching no rules allows cleanly (`{ kind: "allow" }`).
4. **Dependencies**: Requires `SPAI-007`, `SPAI-008`, `SPAI-009`. Final gate of P03a epic (`SPAI-003`).
