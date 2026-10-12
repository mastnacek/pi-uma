---
type: Todo
title: "Verify binary execution lookup order from CWD and project config override allowlist"
timestamp: 2026-10-12 10:12:18
status: done
source: pi-spai
tags: [security, binary, config]
facets:
  priority: high
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-023: Verify binary execution lookup order from CWD and project config override allowlist

x Verify binary execution lookup order from CWD and project config override allowlist @pi-uma !high :security:binary:config:

## Context & Details
Review flagged untrusted execution vectors when opening repositories:

### Locations to Verify:
1. `src/shared/client.ts:12-36` (`findUmaBinary`):
   - Only `bin/uma.exe` is committed. On macOS and Linux, candidates look for `uma` and fall back to `path.join(cwd, "bin", "uma")` and `<cwd>/core/target/...`.
   - In `src/slices/detector/index.ts:50, 212`, `session_start` executes `uma --version` without user prompt.
   - If an untrusted cloned repo contains an executable `./bin/uma`, opening Pi would execute it.
2. `src/shared/config.ts:43-51` (`loadConfig`):
   - Project-level `.pi/uma.json` overrides global configuration without an allowlist.
   - A cloned repo can set `autoApprove: true` (skipping the review modal), `immuneMode: "off"`, or `appendPrompt`.
   - Invalid enum values (e.g. `immuneMode: "Block"`) are not validated against schema, causing `undefined` returns and silent failure of the immune protection.

### Verification & Action:
- Restrict `findUmaBinary` to package/installed directory or system PATH; never resolve from arbitrary workspace CWD.
- Implement strict allowlist for project `.pi/uma.json` (disallowing sensitive options like `autoApprove` and `appendPrompt` from project scope).
- Add TypeBox / schema validation for config values with fail-safe defaults.
