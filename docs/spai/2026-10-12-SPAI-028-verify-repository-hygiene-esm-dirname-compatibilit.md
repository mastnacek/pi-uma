---
type: Todo
title: "Verify repository hygiene, ESM __dirname compatibility, and unit test coverage"
timestamp: 2026-10-12 10:12:35
status: todo
source: pi-spai
tags: [repo, hygiene, tests, esm, ci]
facets:
  priority: low
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-028: Verify repository hygiene, ESM __dirname compatibility, and unit test coverage

. Verify repository hygiene, ESM __dirname compatibility, and unit test coverage @pi-uma !low :repo:hygiene:tests:esm:ci:

## Context & Details
Review highlighted repository maintenance, packaging, and test suite concerns:

### Locations to Verify:
1. Committed Binaries & Artifacts:
   - `bin/uma.exe` (~9.4 MB) committed in git, causing repository churn and bloat without CI provenance.
   - Private local data committed in `.uma/.staging/*.json` with local author paths (`D:/01_programovani/...`).
2. Packaging & ESM:
   - Use of `__dirname` in an ESM package (`"type": "module"`) only works under Pi's runtime (jiti) and breaks standard Node ESM imports.
3. Test Suite Integrity:
   - TS tests only cover pure functions; zero coverage for hooks, tools, modals, detector, and shadow worker.
   - CLI tests only verify Clap argument parsing (`try_parse_from`), not binary execution or JSON schema output.
   - Vacuous tests flagged: `test_cycle_does_not_hang` asserting over empty chains; architecture invariants passing on missing tools; flaky 10ms timing tests in `tests/muscle_perf.rs`.
   - Tests touching the real user central index or global store (`lib.rs:344`, `examples/test_store.rs`).
4. CI Automation:
   - Add GitHub Actions CI workflow to run `cargo test`, `cargo clippy`, and `tsc --noEmit`.

### Verification & Action:
- Clean up git history / untracked staging artifacts.
- Replace `__dirname` with `import.meta.url` or safe module path resolution.
- Strengthen integration tests and setup automated CI.
