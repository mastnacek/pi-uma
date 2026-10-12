# pi-uma — critical implementation review

- **Repository:** https://github.com/mastnacek/pi-uma
- **Reviewed commit:** `3ca01c0` (v0.8.3, 2026-10-11)
- **Review date:** 2026-10-12
- **Method:** static source reading only. `docs/` and all `*.md` files were deliberately excluded. Nothing was built or executed (building/running the external code was blocked by the auto-mode classifier), so no `cargo test` / `clippy` / `tsc` results are included.
- **Legend:** ✓ = verified directly in code by the lead reviewer; unmarked = reported by one of four parallel read-only reviewers (security, Rust core, CLI + cognitive modules, TS plugin) with file:line evidence, not independently re-verified.

## What it is and how it works

- **TS Pi extension** (`index.ts`, `src/`, ~5.8k lines): registers 11 tools, hooks (`tool_call`, `turn_end`, `session_start`) and TUI modals. Every operation spawns the Rust CLI `uma` via `execFile`.
- **Rust workspace** (`core/`): `uma-core` library (~9.3k lines) + `uma-cli` binary `uma` (~7.7k lines).
- **Storage:** facts are Markdown files with YAML frontmatter in `<repo>/.uma/<type>/<ULID>.md` plus a global store; central SQLite FTS5 index (WAL) + embeddings via OpenRouter; hybrid search with RRF fusion.
- **Additional features:** staging of drafts, supersede chains, as-of (bitemporal) queries, secrets scanner, git sync, MCP server (read-only by default).
- **"Cognitive" layer — what it mechanically does:**
  - `fastbrain`: ~30 hardcoded EN/CZ substrings, optionally an LLM call to `typesafe/jev-router` on OpenRouter.
  - `route`: substring matching of scope-name tokens.
  - `council`/`skeptic`: `corrections × 15 + reverts × 20`, banded thresholds.
  - `humility`: count of facts mentioning the file stem.
  - `muscle`: a plain command runner (`std::process::Command`).
  - `priming`, `plasticity`, `saliency`, `dream`: effectively dead or inert code.

## Verdict

Ambitious, rapidly generated prototype (43 commits in 3 days, v0.1 → v0.8.3). The core design (Markdown as source of truth + rebuildable SQLite index) is sound. However, the security claims in code comments and commit messages do not match the implementation, Czech text can crash search/import, and 3–4k lines of "cognitive" branding are heuristics or dead code. Not suitable for production use or for running inside untrusted repositories.

## Cons — security

1. **Repo-planted binary executes on macOS/Linux ✓** — `src/shared/client.ts:12-36`
   - Only the Windows `bin/uma.exe` is committed, so on macOS/Linux the bundled candidate never exists and `<cwd>/bin/uma` (line 17) wins; further cwd-relative candidates follow (`<cwd>/core/target/...`, `<cwd>/uma/target/...`).
   - The detector runs `uma --version` on `session_start` (`src/slices/detector/index.ts:50,212`) with no interaction.
   - Opening Pi in a malicious clone containing an executable `bin/uma` runs it.

2. **Project `.pi/uma.json` overrides global config with no allowlist ✓** — `src/shared/config.ts:43-51`
   - A cloned repo can set `autoApprove: true` (writes skip the review modal), `immuneMode: "off"`, `appendPrompt` (memory injected into the system prompt as "Strictly follow…", `client.ts:215`), or `recallGate` + `fastbrainJudge: "jev"` (every user prompt sent to OpenRouter).
   - This repository itself commits `.pi/uma.json` with `recallGate: true, fastbrainJudge: "jev"`.
   - The approval gate guards only `.uma/`, so the agent can rewrite `.pi/uma.json` itself; the next `session_start` reloads it.
   - Invalid values are not rejected (e.g. `immuneMode: "Block"` → `decideImmuneAction` returns undefined → TypeError swallowed → protection silently off).

3. **v0.8.3 "strictly enforces" memory guard is a single regex ✓** — `src/hooks/approval_gate.ts:30`
   - Bypasses: `echo > .uma/...`, `cp`, `sed -i`, python, symlink (`ln -s .uma m`), `"…/uma.exe" write` (quote breaks `\s+`), `uma-cli write`, `uma staging approve`, `uma skill new`, `uma muscle run --confirm`, `uma mcp serve --allow-writes`.
   - Global-store path check matches only the Windows layout (line 22); macOS `~/Library/Application Support/com.uma.uma/global` and Linux `~/.local/share/uma/global` are unguarded.
   - Only tools named `write`/`edit` are checked.
   - In subagent sessions the whole extension returns early, so no guards at all (`index.ts:26`).

4. **Silent data egress ✓**
   - Every canonical `Store::write` sends title + body to the OpenRouter embeddings API (`core/uma-core/src/store/ops.rs:24-30`), errors swallowed.
   - The API key is auto-discovered from `OPENROUTER_API_KEY` or `~/.pi/agent/auth.json`; there is no opt-in.
   - Jev judge paths (skeptic, humility, `doctor --dream`, `staging distill`) send intents, file lists, fact bodies and raw telemetry with no secret scan (`fastbrain/jev.rs:46-95`). The in-code invariant "no secret reaches a judge" (`fastbrain/mod.rs:19-22`, `council/mod.rs:12`) is false.

5. **Secret scanning has gaps**
   - Runs only on 3 write paths (CLI write, supersede, muscle new). Missing on MCP `uma_write`/`uma_supersede` (`mcp/tools.rs:218-280`), `staging create`/`approve`, `skill new`; tags are never scanned.
   - `\b(api[_-]?key|secret|token|password|passwd)\b` ✓ (`secrets/patterns.rs:70`) misses `DB_PASSWORD=`, `GITHUB_TOKEN=`, `AWS_SECRET_ACCESS_KEY=` (no word boundary after `_`), JSON keys like `"api_key"`, and values shorter than 16 chars or containing `@!#.$`.
   - Only the first match per pattern is checked; a placeholder earlier in the text hides a real key later.
   - The TS pre-scan passes text in argv and fails open on errors (`secrets_client.ts:37-42`; Windows ~32k argv limit).
   - `sync push` runs `git add -A .` (`sync/ops.rs:41`) with no pre-push scan, so staging drafts with raw telemetry get committed and pushed.

6. **Path traversal via `--type` ✓**
   - `FactType::from_str` maps any unknown string to `FactType::Custom(other)` with no validation (`domain/types.rs:121`), and `fact_path` joins it into the path (`store/mod.rs:172-176`).
   - `uma write --type ../../x` writes `<ULID>.md` outside the store. The type can also come from LLM output (`uma-cli/src/slices/staging/mod.rs:220`) and MCP (`mcp/tools.rs:84`).

7. **Muscle routines = command runner fed from memory ✓**
   - Synthesis splits bash lines on whitespace (`src/slices/muscle/policy.ts:114`), so `|`, `2>/dev/null` and quotes become literal argv for `Command::new` (no shell). The committed `.uma/.staging/01m4ks6kvejyppxjrqbwbvqd75.json` demonstrates it.
   - The consent dialog shows only the routine name, not the steps (`src/shared/muscle_dialog.ts:17`).
   - The stored routine body tells the agent to run `uma muscle run X --confirm` via bash, bypassing the dialog entirely; `--confirm` is self-service.
   - `find_routine` accepts any skill fact whose title matches, without requiring the `muscle` tag; routines can come from a repo-committed `.uma/skill/`.
   - No timeout, no sandbox; `--json` exits 0 on step failure.

8. **Approval dialogs misrepresent what is stored or run**
   - Default `lang: "cs"` shows an LLM translation of the body, while the original is stored (`src/shared/modal.ts:68`); the body can steer the translation into looking harmless.
   - Scope label shows the current project for any non-global scope (`modal_renderer.ts:94-96`) while an explicit foreign scope is kept.
   - Template, title, tags are not wrapped and get truncated; ANSI/control chars are not sanitized; Approve is preselected.
   - Staging modal ✓: title/body edits are discarded on approve because `staging approve` takes only an id (`src/slices/staging/modal.ts:89-99, 266`; `uma-cli/src/slices/staging/mod.rs:72-75`). The exit code is ignored, so "approved" is counted even when the CLI refused (e.g. on a secret). No in-flight lock: double Enter drops the next draft.

9. **Contracts (architecture invariants)**
   - Fact title is written raw as `// Memory Decision: {title}` into `tests/architecture_invariants.rs` (`contracts/ops.rs:96`); a newline in the title injects Rust code executed by `cargo test`.
   - The check fails open: missing ast-grep → `clean: true`; exit status ignored; unparsable output → zero violations (`contracts/ops.rs:141-199`). Falls back to `sg` on PATH (on Linux that is shadow-utils `sg`).
   - The only rule targets `src/slices/**` as Rust, but that path is TypeScript; Rust slices live in `core/uma-cli/src/slices`, so it likely checks nothing.
   - `rule_to_yaml` escapes only `"`, not `\`.

10. **JS ReDoS** — `src/slices/immune/index.ts:170` builds a `RegExp` from a memory-supplied glob without escaping and runs it synchronously on every write/edit.

## Cons — correctness and data integrity

- **UTF-8 panics on Czech text ✓** — byte slicing instead of char slicing:
  - `core/uma-core/src/search/semantic.rs:123` (`&body[..140]`)
  - `core/uma-core/src/sources/reader.rs:217` (`text.truncate(500)`)
  - `core/uma-core/src/sources/extract.rs:175` (`title.truncate(80)`)
  - `serialization/mod.rs:172` (`&rest[abs_pos-2..abs_pos]`) — panics on a multi-byte char before an inner `---`.
  - No test uses diacritics in store, serialization, search or extract.
- **Non-atomic writes, file/index drift**
  - Plain `fs::write`, no locks; concurrent readers see half-written files and parse errors are swallowed.
  - Index and embedding errors swallowed with `let _ =`; reindex only when the index is completely empty; health check never detects files missing from the index.
  - Supersede retires the old fact before writing the new one (not atomic); no guard against self-cycles (`new.id == old_id`) or forks (two live successors).
- **Schema bump loses foreign projects** — `indexer/mod.rs:73-96` drops `facts_fts` on version mismatch (any query error counts as version 0); other projects' roots are recovered from the same dropped table, so they vanish from the index. `DELETE FROM facts_fts` + rebuild is not transactional. `doctor` (supposedly read-only) triggers this via `Indexer::open`.
- **Temporal validity**
  - `stale_after` / `until` / future `since` are ignored by default search (`search/keyword.rs:67-69`, `semantic.rs:32-34`).
  - With `as_of`, SQL `LIMIT` is applied before validity filtering (`keyword.rs:85` vs `129-149`), so the valid revision can be cut; Draft facts are returned.
  - Missing/invalid `since` silently becomes `Utc::now()` and is persisted on next write.
- **Project scope = directory basename** (`store/mod.rs:151-158`): renamed dir, clone, worktree or CI checkout hides facts; two repos named `app` merge into one scope.
- **Search ranking and cost**
  - Inconsistent score scale: BM25 when no semantic hits, RRF (~0.016) otherwise (`search/fusion.rs:13-16`).
  - Ties broken by `HashMap` iteration order (random per run).
  - Semantic search embeds the query over HTTP, loads ALL vectors (f64) and does brute-force cosine on every query; no similarity floor; embedding model not checked per vector.
  - `WHERE id = ?` on an FTS5 `UNINDEXED` column = full scan per write/lookup; reindex O(N²).
- **Network and process handling**
  - Embeddings: 30 s timeout × 4 attempts + 1/2/4 s backoff inline in `Store::write` → ~2 min stall per write without network.
  - `runUma` has no timeout, default 1 MiB `maxBuffer`; hook timeouts only `Promise.race`, so hung children accumulate.
  - Model-controlled values starting with `-` are parsed by clap as flags (e.g. `uma_search query="--reindex"`); no `--` separator.
  - Prompts and bodies are passed via argv → visible in `ps`.
- **Forged provenance ✓** — `Fact::new` stamps every fact `verified: human:operator` and `generated: pi-agent/1.1` (`domain/fact.rs:49-50`), including agent, MCP and LLM-distilled facts.
- **Negation detection ✓** — `similarity.rs:100-102`: any word ≥ 5 bytes starting with "ne" counts as negation ("network", "needs", "nested") → false contradictions in consolidate and offline relationship judging.
- **ASCII-only Czech markers** ("pamatujes", "vzdycky", "resili jsme") in the offline recall gate and extractor → real diacritic input does not match.
- **Scope bug** — TS write tool passes literal `--scope project` (`src/slices/write/index.ts:55,92`); Rust only special-cases "global", so facts land in a project literally named "project". `scopeArgForCli` exists but is unused there.
- **Unstable CLI JSON contract** (parsed by the TS plugin): `skill list --json` prints text when empty, `search` has no `--json`, `doctor --json` can emit up to three concatenated JSON documents, `sessions list --json` ignores `--limit`, `migrate` exits 0 after failures.
- **Shadow worker** fires the correction detector on every agent-loop turn with no dedupe; "0 failed" counts as a failure; user text and build output go to the external judge unscanned.

## Cons — "cognitive" theater

- **priming** is a no-op in its only caller: the graph is built from the 1–3 search hits only, so every neighbor is already seen (`uma-cli/src/slices/recall/mod.rs:239-262`); edge weights are discarded (`connect(.., _weight)`).
- **plasticity / saliency / decay** are never set (`Fact::new` → `None`); `reinforce`/`frustrate` are called only in tests; the math is wrong (frustrating an idle fact raises its effective weight, `domain/cognitive.rs:91-102`); `multiplier` and `shock_level` are never read.
- **dream**: the grading key is placed in the prompt, so the model grades itself with the answer in hand (`fastbrain/dream.rs:59-64`); offline always returns "BLURRED".
- **route / skeptic / humility** rely on substring matching: "uma" in "human", "ffi" in "efficient", "mod" in "model", "api" in "capital". `risk` fixed this with whole-token matching; the copy in `skeptic` did not. The two implementations have diverged and give different bands for the same file.
- Confidence values are hardcoded (0.8 / 0.85 / 0.7 / 0.5).
- `--judge jev` for route is accepted but is a stub.

## Cons — quality and repository hygiene

- **Committed binary:** 9.4 MB Windows `bin/uma.exe`, changed in 27 of 43 commits (`.git` = 33 MB). No CI, checksum or signature → cannot be verified against source; unusable off Windows (which triggers security finding 1).
- **Private data committed:** `.uma/.staging/*.json` with the author's local paths (`D:/01_programovani/...`) and drafts stamped `verified: human:operator` that were never approved.
- **No CI;** `tsc --noEmit` never enforced.
- **Tests are shallow:**
  - 231 Rust `#[test]` + 77 TS tests, but TS covers only pure functions; `client.ts`, `config.ts`, all hooks, all tools, modals, detector and shadow worker are untested.
  - 37 CLI tests only call `try_parse_from`; no binary-level tests of exit codes or JSON shape.
  - Vacuous tests: architecture invariants test passes when anything is missing; `test_cycle_does_not_hang` asserts over zero chains; roundtrip test sets `since` itself then asserts it.
  - Wall-clock 10 ms assertions (`tests/muscle_perf.rs`) will flake.
  - Some tests touch the real user central index / global store (`lib.rs:344`, `examples/test_store.rs`).
  - No negative/bypass tests for the approval gate.
- **Vertical slice architecture is nominal:** slices are thin wrappers over `uma-core`; the "slices never import each other" rule causes copy-paste drift instead of reuse (`resolve_store` 3×, `truncate` 3×, judge parsing 6×, secret-refusal block 3× with different texts).
- **i18n:** 3–4 mechanisms mixed (i18n table, command_help table, inline cs/en ternaries, hardcoded strings); hardcoded Czech "AKTIVNÍ" even in English mode.
- **`__dirname` in an ESM package** (`"type": "module"`) works only under Pi's jiti loader; `node --experimental-strip-types` tests can load only import-free modules.
- Dead code and re-export shims (`readStagedDraftsFromDisk`, unused i18n keys, `plasticity`/`saliency`/`contract` on `MemoryProposal`, `muscle/dialog.ts`, `staging_client.ts`, `translate_client.ts`).

## Pros

- **Markdown as source of truth**, index as a rebuildable cache; human-readable and git-friendly; `is_canonical` guard keeps temp stores out of the production index.
- **No shell anywhere:** `execFile` and `Command` with argv arrays; git invoked with an args array and `GIT_TERMINAL_PROMPT=0`. No `unsafe`, almost no non-test `unwrap` (panics come from byte slicing, not unwrap).
- **SQLite WAL + busy_timeout** with a real multi-process stress test asserting exact counts.
- **Several safe defaults:** MCP read-only enforced server-side (with tests); muscle dry-run by default; `doctor --prune-zombies` dry-run by default and deprecates instead of deleting; sync never force-pushes or auto-resolves conflicts; recall gate offline and off by default.
- **Explicit degradation reporting** (`SearchOutcome`, `judged_by`, notes) instead of silent fallbacks in search; missing-binary error message written for the model.
- **Pure policy functions separated from thin hooks** → well testable in principle.
- Frontmatter parsed and emitted with `yaml_rust2` / `YamlEmitter`; fact IDs validated as ULID; Rust regex engine is linear-time (scanner itself has no ReDoS).

## Fix first

1. Resolve the binary only from the plugin directory, never relative to cwd; ship macOS/Linux builds or build on install.
2. Allowlist project config keys; allow `autoApprove`, `appendPrompt` and `jev` only in the global config.
3. Make embeddings and LLM judges opt-in and run the secret scan before any outbound request.
4. Move the secret gate into `Store::write` (all write paths); validate `FactType::Custom`; use char-safe truncation everywhere.
5. Remove the binary and `.uma/.staging` from git; add CI running `cargo test`, `clippy` and `tsc`.
