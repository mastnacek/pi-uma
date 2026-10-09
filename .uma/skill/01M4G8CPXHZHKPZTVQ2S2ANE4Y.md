---
id: 01M4G8CPXHZHKPZTVQ2S2ANE4Y
scope: "project:pi-uma"
type: skill
title: verify-uma-changes (two-repo edition)
template: "cd {{repo}}/uma && cargo test && cargo build --release && cd {{repo}}/uma-pi-extension && npm run typecheck && npm run test"
tags:
  - verification
  - workflow
  - testing
status: deprecated
supersedes: 01M4DHDXNDBTKHKNKXY8K21484
generated:
  by: pi-agent/1.1
  at: "2026-10-09T11:57:18.641095600+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T11:57:18.641096500+00:00"
since: "2026-10-08T10:37:32.205831500+00:00"
until: "2026-10-09T13:34:02.345380700+00:00"
---
### Context
The UMA Pi plugin now lives in its own repository
(`D:/01_programovani/pi/plugins/pi-uma`, published as
github.com/mastnacek/pi-uma) instead of the ai-memory monorepo's
`uma-pi-extension/` folder. The verification sequence is unchanged in
spirit; the paths change.

### Procedure
Run after any UMA change:
1. `cd uma && cargo test` — must pass with 0 warnings
2. `cargo build --release` — a *separate* check; warnings that exist
   only outside `cfg(test)` show up here and nowhere else
3. `cd /d/01_programovani/pi/plugins/pi-uma && npm run typecheck && npm test`
4. If extension code changed, `/reload` before exercising tools in Pi —
   a running session keeps the old module graph loaded
5. Commit and push the plugin repo separately from ai-memory — they are
   two repositories now; a push of one does not ship the other

For anything that writes memory, rehearse in a throwaway repo first
(`mktemp -d && git init -q .`) so no test run can touch the real store.

### Consequences
- Template, type, and formatting regressions are caught before they are
  committed.
- Never claim a change is verified from `cargo test` alone — the
  release build is a distinct gate.
- Both repos must be committed/pushed when a change spans the CLI and
  the plugin (e.g. the shared translate-config seam).