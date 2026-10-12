---
type: Todo
title: "Verify approval gate regex bypasses, path traversal via type, and secret scanner gaps"
timestamp: 2026-10-12 10:12:21
status: working
source: pi-spai
tags: [security, approval, traversal, secrets]
facets:
  priority: high
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: '/'
---

# SPAI-024: Verify approval gate regex bypasses, path traversal via type, and secret scanner gaps

/ Verify approval gate regex bypasses, path traversal via type, and secret scanner gaps @pi-uma !high :security:approval:traversal:secrets:

## Context & Details
Review identified security gaps across the approval gate, argument validation, and secret scanning:

### Locations to Verify:
1. `src/hooks/approval_gate.ts:30`:
   - Single regex only intercepts `write` and `edit` tools and simple CLI patterns.
   - Bypasses: shell redirection (`echo ... > .uma/...`), `cp`, `sed -i`, python scripts, symlinks (`ln -s .uma m`), quoted CLI execution (`".../uma.exe" write`), `uma-cli write`, `uma staging approve`, `uma muscle run --confirm`, `uma mcp serve --allow-writes`.
   - Global-store path check only matches Windows paths; macOS/Linux paths unguarded.
   - Subagent sessions in `index.ts:26` return early, bypassing all approval hooks.
2. `core/uma-core/src/domain/types.rs:121` (`FactType::from_str`) & `store/mod.rs:172-176`:
   - Unknown types map to `FactType::Custom(other)` without path validation.
   - `uma write --type ../../x` can write markdown files outside `.uma/`.
3. `core/uma-core/src/secrets/patterns.rs:70` & write paths:
   - Regex `\b(api[_-]?key|secret|token|password|passwd)\b` uses `\b` after `_`, failing to match `DB_PASSWORD=`, `GITHUB_TOKEN=`, `AWS_SECRET_ACCESS_KEY=`.
   - Only first match checked per pattern, masking real keys behind false-positive placeholders.
   - Secret scan missing on MCP write/supersede (`mcp/tools.rs`), `staging create`/`approve`, `skill new`, and tags.
   - `src/shared/secrets_client.ts` passes text via argv (hitting Windows 32KB limits and failing open).
   - `core/uma-cli/src/slices/sync/ops.rs:41` runs `git add -A .` without pre-push secret scan.

### Verification & Action:
- Validate `FactType::Custom` characters strictly (`[a-zA-Z0-9_-]+`).
- Fix secret scanner regex boundaries, check all occurrences, and move gate directly into `Store::write`.
- Harden approval gate hooks and path normalization.
