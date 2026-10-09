---
id: 01M4GDXTK1RTYJ2WCWQ6R2AH3Y
scope: "project:pi-uma"
type: skill
title: "verify-uma-changes (single-repo, shipped-binary edition)"
template: "cd {{repo}}/uma && cargo test && cargo build --release && cd {{repo}}/uma-pi-extension && npm run typecheck && npm run test"
tags:
  - verification
  - workflow
  - testing
status: stable
supersedes: 01M4G8CPXHZHKPZTVQ2S2ANE4Y
generated:
  by: pi-agent/1.1
  at: "2026-10-09T13:34:02.337208900+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T13:34:02.337209200+00:00"
since: "2026-10-08T10:37:32.205831500+00:00"
---
### Context
UMA lives in a SINGLE repository: `D:/01_programovani/pi/plugins/pi-uma`
= github.com/mastnacek/pi-uma (former mastnacek/ai-memory is archived).
The engine binary ships with the package now (`bin/uma.exe`, win32-x64,
committed), so a plain clone works without a Rust toolchain or PATH.

### Procedure
Run from the repo root after any change:
1. `cd core && cargo test` — must pass with 0 warnings
2. `cargo build --release` — separate gate; warnings outside `cfg(test)`
   show only here
3. `npm run syncbin` — copies the fresh binary into `bin/` (the shipped
   engine); commit it together with the core change
4. repo root: `npm run typecheck && npm test`
5. If plugin code changed: `/reload` in the running pi session
6. One commit + push ships everything (engine, binary, plugin, skill,
   docs, project memory store)

For anything that writes memory, rehearse in a throwaway repo first
(`mktemp -d && git init -q .`) so no test run can touch the real store.

### Consequences
- After `pi install`/`pi update --extensions`, the engine works out of
  the box — findUmaBinary prefers `bin/` inside the package.
- If the engine is ever missing, runUma errors with an actionable
  message for the MODEL (do-not-store-elsewhere + how to restore) —
  never a bare ENOENT that invites improvisation.
- The global store stays in the user profile; this repo carries the
  project:pi-uma store in `.uma/`.