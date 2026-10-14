---
id: 01M4WZFH57WM1DDTPAG2W6XG5P
scope: "project:pi-uma"
type: pattern
title: bin/uma.exe (committed) shadows core/target/release — the engine binary must be refreshed in every engine commit
tags:
  - invariant
  - build
  - distribution
  - trap
status: stable
generated:
  by: pi-agent/1.1
  at: "2026-10-14T10:31:41.479460500+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-14T10:31:41.479463900+00:00"
since: "2026-10-14T10:31:41.479463700+00:00"
---
### Invariant
`findUmaBinary` (src/shared/client.ts) resolves the engine from the package's `bin/` directory BEFORE `core/target/release/`, and `bin/uma.exe` is a **committed tracked binary**. Therefore the committed binary silently shadows every freshly built core change: `cd core && cargo build --release` while developing has no effect on the Pi plugin, and `pi update` ships whatever stale `bin/uma.exe` was last committed.

### Evidence (2026-10-14)
After the `--spai` flag was added to `write`/`supersede`, `uma_supersede` forwarded `--spai` (new plugin code) but the engine errored `unexpected argument '--spai'` with an old usage string, even after rebuilding and replacing `core/target/release/uma.exe`. The actual resolver winner was the Oct-12 `bin/uma.exe`; replacing it fixed the call immediately.

### Consequences
- Every engine change that reaches users MUST include a refreshed `bin/uma.exe` in the same commit; `core/target/release` alone is not enough.
- AGENTS §4 documents only the `core/target/release` lookup path — the documented dev loop is incomplete (recorded as a task).
- The failure mode is silent: the plugin and the engine disagree, with no version check.