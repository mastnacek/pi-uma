---
type: Todo
title: "Verify TS write tool scope resolution bug and staging modal edit drops"
timestamp: 2026-10-12 10:12:11
status: todo
source: pi-spai
tags: [write, modal, staging, scope]
facets:
  priority: high
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-021: Verify TS write tool scope resolution bug and staging modal edit drops

. Verify TS write tool scope resolution bug and staging modal edit drops @pi-uma !high :write:modal:staging:scope:

## Context & Details
Review flagged two client-side bugs in proposal creation and staging review:

### Locations to Verify:
1. `src/slices/write/index.ts:55, 92`:
   - Defaulting `scope: params.scope || "project"` and passing `--scope project` directly to the CLI.
   - In `core/uma-cli/src/shared/scope.rs`, any scope other than `"global"` is parsed as `Scope::Project(name)`. Passing `--scope project` stores facts in a project literally named `"project"` instead of detecting the git root.
   - `scopeArgForCli` exists in `src/shared/client.ts` (mapping `"project"` / `undefined` to `undefined` so the CLI detects git root) but is unused in the write tool.
2. `src/slices/staging/modal.ts:89-99, 266` & `core/uma-cli/src/slices/staging/mod.rs:72-75`:
   - User edits made in the staging review modal to draft title/body are discarded because `uma staging approve` only receives the draft ID and promotes the on-disk file verbatim.
   - CLI exit code is ignored, reporting approval success even if the CLI rejected the draft (e.g. on secret detection).
   - Missing in-flight lock: rapid double-Enter can approve/drop subsequent drafts.

### Verification & Action:
- Fix `write/index.ts` to use `scopeArgForCli`.
- Pass edited title/body to `staging approve` or persist draft edits before calling approve; check CLI exit codes; add modal debounce lock.
