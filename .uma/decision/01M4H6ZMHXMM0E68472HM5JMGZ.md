---
id: 01M4H6ZMHXMM0E68472HM5JMGZ
scope: "project:pi-uma"
type: decision
title: "Version discipline: every shipped phase bumps the UMA version"
tags:
  - versioning
  - release
  - workflow
status: stable
generated:
  by: pi-agent/1.1
  at: "2026-10-09T20:51:56.093157200+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T20:51:56.093157500+00:00"
since: "2026-10-09T20:51:56.093157500+00:00"
---
### Context
UMA shipped four roadmap phases (P04 pain score, P03a contracts, P03b+P05a plasticity/saliency, P02 shadow worker) while `uma.exe` remained at version 0.1.0 — the binary gave no signal about which capability set it contained.

### Rule
Every shipped phase or user-visible capability set must advance the version. Bump `core/Cargo.toml` `[workspace.package].version` and `package.json` `version` together (both crates use `version.workspace = true`), then rebuild, `npm run syncbin`, and verify with `uma --version` before commit.

### Consequences
- P03a+P03b+P02+Jev-distill shipped as **0.2.0**.
- The operator can verify what is installed with one command instead of diffing commit hashes.
- Binary provenance stays auditable: version ↔ commit ↔ shipped phase.