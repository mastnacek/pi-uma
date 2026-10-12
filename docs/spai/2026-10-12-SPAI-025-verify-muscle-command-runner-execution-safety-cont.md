---
type: Todo
title: "Verify muscle command runner execution safety, contract code injection, and immune ReDoS"
timestamp: 2026-10-12 10:12:23
status: todo
source: pi-spai
tags: [muscle, contracts, immune, safety]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-025: Verify muscle command runner execution safety, contract code injection, and immune ReDoS

. Verify muscle command runner execution safety, contract code injection, and immune ReDoS @pi-uma !medium :muscle:contracts:immune:safety:

## Context & Details
Review flagged command execution, code generation, and regex risks:

### Locations to Verify:
1. Muscle Command Runner:
   - `src/slices/muscle/policy.ts:114`: Command synthesis splits bash commands purely on whitespace without shell invocation, breaking pipes (`|`), redirections, and quoted arguments.
   - `src/shared/muscle_dialog.ts:17`: Consent dialog displays only the routine title, not the actual commands to be run.
   - The stored routine instructs the agent to run `uma muscle run <name> --confirm` directly via the bash tool, allowing self-service execution without interactive prompt.
   - `find_routine` matches any skill fact by title, even if missing the `muscle` tag.
   - Missing execution timeout and sandbox; `--json` exits 0 on step failures.
2. Architecture Contracts:
   - `core/uma-cli/src/slices/contracts/ops.rs:96`: Injects unescaped fact title into `// Memory Decision: {title}` in `tests/architecture_invariants.rs`. A newline in the title can inject arbitrary Rust code into `cargo test`.
   - Fails open: missing `ast-grep` results in `clean: true`; exit status ignored.
   - PATH fallback to `sg` can invoke shadow-utils `sg` on Linux.
   - Invariant rule targets `src/slices/**` as Rust, but TypeScript slices live there and Rust slices are in `core/uma-cli/src/slices`.
3. Immune ReDoS:
   - `src/slices/immune/index.ts:170`: Synchronously constructs `RegExp` from unsanitized glob patterns from memory on every write/edit.

### Verification & Action:
- Require shell execution with strict validation for muscle routines, display full command list in dialog, and enforce `muscle` tag.
- Sanitize fact titles before writing to test files, fix slice paths in contract rules, and fail closed if tools are missing.
- Escape regex special characters or use a safe glob matcher in immune.
