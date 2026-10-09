---
type: Todo
title: "P03a.3 Immune Interceptor Block-Mode: evaluate deterministic contracts on tool_call and enforce hard blocking in auto/block modes"
timestamp: 2026-10-09 20:15:57
status: done
source: pi-spai
tags: [roadmap, p03a, immune, interceptor, block-mode]
facets:
  priority: high
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-009: P03a.3 Immune Interceptor Block-Mode: evaluate deterministic contracts on tool_call and enforce hard blocking in auto/block modes

x P03a.3 Immune Interceptor Block-Mode: evaluate deterministic contracts on tool_call and enforce hard blocking in auto/block modes @pi-uma !high :roadmap:p03a:immune:interceptor:block-mode:

## Goal
Implement deterministic block-mode in the cognitive immune interceptor, enabling automatic fail-closed blocking ONLY when an edited file violates a deterministic AST contract.

## Technical Specifications
1. **Immune Policy Decision (`src/slices/immune/index.ts`)**:
   - Update `RuleL1` to include `contract?: ContractDefinition`.
   - Update `assessEdit`:
     - Distinguish between **heuristic warnings** (vocabulary containment, pain score) and **contract violations** (ast-grep match with `severity: "deny"`).
     - Heuristic warnings remain advisory strings.
     - Contract violations produce structured `ContractBreach` results.
   - Update `decideImmuneAction`:
     - In `mode === "auto"` or `mode === "block"`:
       - If `contractBreaches.length > 0`: return `{ kind: "block", reason: ... }`.
       - If only heuristic warnings are present: return `{ kind: "confirm", message: ... }` (in `auto` mode) or `{ kind: "notify", message: ... }` (in `warn` mode).
       - Never block silently on heuristic or model-predicted violations (satisfies `01M4EP264QYX1FA23JQKT3GFQM`).
2. **Hook Execution (`src/hooks/immune_interceptor.ts`)**:
   - When extracting edit, check contract rules against the candidate diff/file using `uma contracts check --path <path>` or in-memory AST pattern matcher.
   - For `{ kind: "block" }`, return `{ block: true, reason: action.reason }`.
   - The agent receives synthetic feedback: `[UMA Immune System Block]: Your proposed change in '<path>' violates active memory contract [<id>] "<title>". Rule: <message>. Revise your implementation.`
3. **Dependencies**: Requires `SPAI-007` and `SPAI-008`. Unlocks `SPAI-010`.
