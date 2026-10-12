---
type: Todo
title: "Verify repository hygiene, ESM __dirname compatibility, and unit test coverage"
timestamp: 2026-10-12 10:12:35
status: done
source: pi-spai
tags: [repo, hygiene, tests, esm, ci]
facets:
  priority: low
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-028: Verify repository hygiene, ESM __dirname compatibility, and unit test coverage

x Verify repository hygiene, ESM __dirname compatibility, and unit test coverage @pi-uma !low :repo:hygiene:tests:esm:ci:

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

## Outcome (2026-10-12, v0.8.10)

**CI added** (`.github/workflows/ci.yml`) — the headline gap. Two jobs on every push/PR:
- Rust: `cargo clippy --all-targets -- -D warnings`, `cargo test --all`, `cargo build --release`, with `@ast-grep/cli` installed (required by the fail-closed architecture-invariants test).
- TypeScript: `npm ci`, `npm run typecheck`, `npm test`.
Least-privilege `permissions: contents: read` and `persist-credentials: false` on both checkouts.

**Clippy driven to a clean `-D warnings` gate** (it was failing before, so a clippy gate would have been impossible):
- 3 `clippy::approx_constant` deny-level errors in `embeddings.rs` fixed by using `std::f64::consts::FRAC_1_SQRT_2`.
- `empty line after doc comment` (`secrets/mod.rs`): removed an orphaned doc block that documented nothing.
- `items after a test module` (`doctor/checks.rs`): `stale_finding` moved before the test module.
- `needless_borrow` (two integration tests): `Indexer::open(dir.path().join("index.db"))`.

**Repo hygiene:**
- `.gitignore` now ignores `.uma/.staging/`, so shadow-worker drafts (local, unapproved, machine-specific) can never be committed again. The two files that were committed earlier were already removed in SPAI-025.
- Deleted `core/uma-core/examples/test_store.rs`: a dev scaffold whose `main` wrote a fact into the **real global store** — running it would have polluted live memory.

**Test quality:**
- `muscle_perf.rs`: the 10 ms wall-clock SLA flaked on loaded runners; raised to a generous 100 ms **regression bound** (still catches a dry-run that blocks on I/O) and the doc now says so.
- `test_cycle_does_not_hang` (`timeline.rs`) was vacuous (`chains.iter().all(..)` over an empty vec). It now asserts the real semantics: a rootless cycle produces **zero** chains and the walk terminates.

**Already resolved earlier / verified:**
- ESM `__dirname`: none remains in the plugin — `findUmaBinary` uses `fileURLToPath(import.meta.url)` (SPAI-023).
- Fail-closed architecture invariants ("test passes when anything is missing"): fixed in SPAI-025.
- Committed binary: intentional — the shipped-binary distribution model (AGENTS §4); CI now builds it and the version discipline keeps provenance.

**Accepted, recorded:**
- The roundtrip `since` test sets the value it asserts, but the sentinel is written earlier than `now`, so a silent rewrite by the store would still fail it — it is weak but not vacuous.
- GitHub Action references use version tags (not SHA pins). Pinning to SHAs without verified hashes risks running the wrong commit; tag use is the deliberate trade-off and is flagged by the CI security scanner as advisory only.
