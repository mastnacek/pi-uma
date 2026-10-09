---
type: Todo
title: "P03a.1 OKF Contract Schema: add contract struct to domain.rs, serialization.rs and TS types"
timestamp: 2026-10-09 20:15:44
status: done
source: pi-spai
tags: [roadmap, p03a, contracts, schema]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-007: P03a.1 OKF Contract Schema: add contract struct to domain.rs, serialization.rs and TS types

x P03a.1 OKF Contract Schema: add contract struct to domain.rs, serialization.rs and TS types @pi-uma !medium :roadmap:p03a:contracts:schema:

## Goal
Extend the OKF v0.2 frontmatter schema so that facts can optionally carry machine-executable AST contracts.

## Technical Specifications
1. **Rust Domain (`core/uma-core/src/domain.rs`)**:
   - Define `Contract` struct:
     ```rust
     #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
     pub struct Contract {
         pub engine: String, // e.g. "ast-grep"
         pub severity: ContractSeverity, // Deny | Warn
         pub rule: ContractRule,
     }

     #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
     pub struct ContractRule {
         pub pattern: String,
         pub inside: Option<String>,
         pub message: String,
         pub language: Option<String>,
     }

     #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
     #[serde(rename_all = "lowercase")]
     pub enum ContractSeverity {
         Deny,
         Warn,
     }
     ```
   - Add `pub contract: Option<Contract>` to `Fact`.
2. **YAML Serialization (`core/uma-core/src/serialization.rs`)**:
   - Serialize `contract` block into YAML frontmatter when present.
   - Deserialize `contract` block from YAML in `markdown_to_fact`.
   - Add unit tests verifying serialization round-trip with and without contract blocks.
3. **TypeScript Plugin Types (`src/shared/types.ts`)**:
   - Add `contract?: ContractDefinition` to `MemoryProposal` and `RuleL1`.
   - Ensure the proposal modal preserves the contract block on round-trip review.
4. **Dependencies**: None. First step in P03a epic (`SPAI-003`). Unlocks `SPAI-008`.
