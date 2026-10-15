# UMA Concept Review — Do the Principles Work in the Code?

**Date:** 2026-10-15
**Method:** Code-only reading of `core/uma-core` (~11.4k lines Rust), `core/uma-cli` slices, and the Pi plugin (`src/`, `index.ts`, `src/hooks/`). No documentation files were consulted; every claim below is verified against implementation and cited as `file:line`. Security posture and external API surface are out of scope by request.

---

## 1. The Consent Spine — WORKS

The system's central promise is *"the model proposes, the operator consents."* This holds, and it holds through **three independent layers**, which is what makes it robust rather than decorative:

1. **Headless fail-closed gate** — `src/hooks/approval_gate.ts:141-196`. When no interactive approval UI exists (`ctx.mode !== "tui"`) and `autoApprove` is off, `uma_write`/`uma_supersede` are *blocked outright* with an explanatory reason. The modal alone could not provide this — it simply never opens headless.
2. **Interactive modal** — `src/slices/write/index.ts:84`, `src/slices/supersede/index.ts:138`. In TUI mode the proposal round-trips through `showProposalModal`; rejection returns early with `{ rejected: true }` and nothing is persisted.
3. **Modal-internal defense in depth** — `src/shared/modal.ts:40-43` refuses (returns `rejected`) if ever reached without a UI, even though layer 1 makes that unreachable today.

Supporting evidence that the boundary is taken seriously:

- **Subagent path is guarded too** — `index.ts:32-43`: subagent sessions load *only* the approval gate, not the tool surface. A subagent's shell cannot `uma write` unguarded.
- **The escape hatch is operator-only** — `src/shared/config.ts:34-40`: `autoApprove` is excluded from `PROJECT_ALLOWED_KEYS`, so a cloned repo's `.pi/uma.json` cannot turn off consent.
- **Provenance is honest** — `core/uma-core/src/domain/fact.rs:55-63`: `Fact::new` leaves `verified` empty (the old blanket `human:operator` is documented as removed forgery); only consent-path writes stamp it (`core/uma-cli/src/slices/write/mod.rs:73`, `supersede/mod.rs:189`, `staging/mod.rs:194`).

**Verdict: the principle is not just stated, it is structurally enforced.**

### 1a. Caveat — the bash guard has false positives

`commandWritesMemoryPath` (`approval_gate.ts:107-122`) decides "write" by scanning the *whole command* for `>`, `tee`, `cp`, etc. once a `.uma/` path appears anywhere. It cannot distinguish payload redirection into the store from stderr redirection: `ls .uma/ 2>/dev/null` is blocked (observed live during this review session). Fail-closed is the right bias, but the heuristic conflates "mentions a store path" with "targets it."

---

## 2. Consolidation Proposes, Never Applies — WORKS, with a reach gap

`core/uma-core/src/consolidate/mod.rs` contains no store mutation at all — it is a pure `analyze(facts) -> ConsolidationReport` over union-find clusters with Jaccard similarity, plus polarity-based contradiction detection (negation read from *titles only*, `mod.rs:117-121`, a documented defense against false contradictions from comparative asides in bodies). The CLI slice reiterates the rule (`core/uma-cli/src/slices/consolidate/mod.rs:48-50`) and even accepts a `--dry-run` flag purely for workflow parity.

**Reach gap:** the CLI supports semantic refinement (`--judge jev`, `refine_with_judge` at `mod.rs:121`), but the Pi tool `uma_consolidate` never exposes it (`src/slices/consolidate/index.ts:13-32` — no `judge` parameter). Through the plugin, consolidation is always lexical-only. The concept (semantic second opinion on merges) exists but is unreachable from the surface the agent actually uses.

---

## 3. Graceful Degradation as a Return Value — WORKS, exemplary

This is the strongest-realized principle in the codebase.

- **Search**: `core/uma-core/src/search/mod.rs:104-165` — `SearchOutcome` carries an explicit `Degradation { requested, performed, reason }`; BM25 is computed first and kept regardless; a failed semantic half can never discard keyword hits. The "why" is documented: *"a caller who silently received BM25 has been misled, which is the same hazard class as a stale index."* Covered by four dedicated tests including the no-API-key path via an injected client factory.
- **Fastbrain judges**: `core/uma-core/src/fastbrain/mod.rs:106-118` (and the identical pattern in `judge_recall_need`, `judge_distill_telemetry`) — a failed Jev call degrades to the offline verdict with `confidence *= 0.5` and a note naming the failure (`Jev unavailable (...); offline verdict`). The degradation is *visible in the data*, not in a log.

---

## 4. Two-Speed Brain (offline + Jev) — WORKS, now time-coherent

Both transports answer the same typed contracts (`RecallNeed`, `Relationship`, `DistilledDraft`) and every Jev path degrades offline. One practical defect existed and was fixed during this review: the engine's HTTP timeout (30 s) outlived the plugin's recall-gate ceiling (15 s), so a slow judge produced a bare gate timeout instead of a graceful degraded verdict — 19 timeout warnings across 7 sessions of this project. Fixed in commit `76fe545` (engine 10 s < gate 15 s; `runUma` now reaps the timed-out child via `execFile` timeout, exit surfaced as 124).

**Residual gap:** `src/hooks/immune_interceptor.ts:61,80-81` and the humility path still race bare `withTimeout` promises *without* the new reaper — a timed-out `uma risk pain` there still leaves an orphaned `uma.exe` for up to its internal timeout. The mechanism now exists in `client.ts`; the other call sites have not adopted it.

---

## 5. Priming / Spreading Activation — WORKS, and the wiring was non-trivial

`core/uma-core/src/priming/mod.rs` builds a deterministic association graph (links, shared tags, file co-mentions — never model-derived). Crucially it is *actually wired into recall*: `core/uma-cli/src/slices/recall/mod.rs:284-316` spreads activation from search hits across a graph spanning **all known roots**, with an in-code record of why: a graph built from hits only makes spreading a no-op ("an edge that exists only between the hits is already known"). Primed neighbors enter results with `[primed X.XX]` provenance in the snippet.

---

## 6. Synaptic Plasticity (Hebbian LTP/LTD) — DOES NOT WORK IN PRACTICE

The domain model is careful and correct: `core/uma-core/src/domain/cognitive.rs:95-119` implements `reinforce` (+0.05 on decayed weight) and `frustrate` (−0.25), with a documented fix ensuring decay is baked in *before* the delta so frustration can never raise fitness.

But the feedback loop is never closed:

- **Nothing calls them.** `reinforce`/`frustrate` have zero call sites outside `domain/` and tests (grep across `uma-core` + `uma-cli`). No retrieval, no tool outcome, no modal decision ever reinforces or frustrates a fact.
- **Ranking ignores the weight.** `core/uma-core/src/search/` contains no reference to `effective_weight`, `plasticity`, or `saliency`. BM25/RRF scores are the whole ranking; the "retrieval-priority weight" (`domain/fact.rs:100-110`) is computed only for *display* in `list`, `read`, and `doctor` (`uma-cli/src/slices/list/mod.rs:68`, `read/mod.rs:45`, `doctor/checks.rs:100`).

What survives in practice: pure time-based decay (which needs no feedback) and the doctor's zombie report (`doctor/mod.rs:202`). The *learning* half of the concept — the part that justifies the neuroscience vocabulary — is dead code.

## 7. Saliency (emotional weighting) — DORMANT

The math exists and is consumed by `effective_weight` (`cognitive.rs:155-174`, `fact.rs:100-110`), and supersession correctly inherits it (`supersede/mod.rs:197-199`). But **no write path can set it**: neither `uma write` nor the plugin's `uma_write` accepts shock level or multiplier. A fact can only acquire saliency via import, migration, or hand-edited frontmatter. Since search ranking ignores weight anyway (§6), saliency currently changes nothing observable outside `doctor`/`list` output.

## 8. Executable AST Contracts — SPLIT BRAIN

The concept — *deterministic rules may auto-block; probabilistic verdicts may only warn* — is honored, but with two implementations of unequal fidelity:

- **CLI path (real):** `core/uma-core/src/contracts/ops.rs` exports facts-with-contracts as ast-grep YAML and runs actual structural matching.
- **Live immune path (approximate):** `src/slices/immune/index.ts:147-171` (`patternToRegex`) transliterates the ast-grep pattern into a regex. `$VAR` becomes `[a-zA-Z0-9_.:]+(?:\([^)]*\))?` — which cannot match a string literal with spaces or quotes; `$$$VAR` becomes `[^;\n]*?` — which cannot cross a semicolon or newline. So a `deny`-severity contract can silently *not fire* on real breaches in the live editor path, or fire on text that merely looks similar.

The deterministic-blocking claim is therefore weaker in practice than in concept precisely where it matters most (inline, at edit time). The consent wrapper around blocking is correct (`immune_interceptor.ts:165-189` — decline blocks, with the reason in English for the model); the *detection fidelity* is the gap.

## 9. Temporal Model & Supersession Chains — WORKS

- `Fact::is_active_at` (`domain/fact.rs:77-92`) implements `since`/`until`/`stale_after` + status; point-in-time search is threaded end-to-end (`SearchOptions.as_of`, CLI `--as-of` at `slices/search/mod.rs:38-39`, tested: `test_as_of_search_returns_historical_facts_even_when_newer_facts_exist`).
- Supersede retires, never deletes, with rollback if retirement fails (`store/ops.rs:111-148`); self-cycles rejected (tested). `timeline.rs` reconstructs chains read-only, inheriting `since` so a revision never masquerades as new knowledge.

## 10. Smaller Promises — all verified

| Promise | Evidence | Verdict |
|---|---|---|
| Skills expand, never execute | `slices/skill/mod.rs:17-19,129-140`; `domain/fact.rs:14-16` | ✅ |
| Muscle runs are dry-run without consent; fail-closed headless | `src/slices/muscle/index.ts:8-11` + dialog gate | ✅ |
| Shadow worker proposes only (staging, never store) | `src/slices/shadow/index.ts:1-8`; approval via modal `src/slices/staging/index.ts:21-52` | ✅ |
| Translation is display-only | `src/slices/translate/index.ts:3-10`; modal keeps original body `src/shared/modal.ts:58-61` | ✅ |
| Skeptic is advisory, never blocks | `src/slices/skeptic/index.ts:7-8` | ✅ |
| Debt ledger is session-scoped advisory state, nudge-only | `src/slices/debt/ledger.ts:1-12` | ✅ |
| Risk/pain scoring is deterministic, offline, advisory | `core/uma-core/src/risk/mod.rs:1-11` | ✅ |
| Shadow failure detection avoids the "0 failed" false positive | `src/slices/shadow/policy.ts:10-15` | ✅ |

---

## Summary

| Pillar | Verdict |
|---|---|
| Consent spine (modal + headless gate + integrity guard) | **Works** — structurally enforced at 3 layers |
| Degradation in return values | **Works** — best-realized principle, well tested |
| Consolidation propose-only | **Works** — but Jev refinement unreachable from Pi |
| Two-speed brain + recall gate | **Works** — timeout incoherence fixed this session |
| Priming / spreading activation | **Works** — genuinely wired into recall |
| Temporal model, supersession chains, provenance | **Works** |
| Plasticity (LTP/LTD learning) | **Broken loop** — nothing reinforces/frustrates; ranking ignores weight |
| Saliency | **Dormant** — no write path sets it; ranking wouldn't use it anyway |
| AST contracts in the live immune path | **Partial** — regex approximation of structural matching |
| Bash integrity guard | **Works, over-broad** — false positives on read-only commands |

**Overall:** the *governance* concepts (consent, degradation, advisory-vs-blocking, provenance) are implemented with unusual discipline — the code repeatedly documents *why*, including its own past mistakes. The *cognitive* concepts are uneven: priming is real, but the plasticity/saliency learning loop is a well-engineered engine with no drivetrain attached. The honest framing: UMA today is a **consent-governed, temporally-aware knowledge store with retrieval priming** — the Hebbian self-tuning memory it also describes itself as is not yet connected.

**Concrete follow-ups (no work done):**
1. Wire `reinforce`/`frustrate` to observable outcomes (recall hit used in an answer, modal rejection) or delete the machinery.
2. Decide whether search ranking should consume `effective_weight` — currently a display-only number.
3. Expose `--judge jev` on `uma_consolidate` (plugin) or document lexical-only as intended.
4. Replace `patternToRegex` with real ast-grep invocation in the immune path, or downgrade `deny` contracts to `warn` inline with a visible note.
5. Adopt the `runUma` timeout reaper in `immune_interceptor.ts` / humility paths (mechanism exists since `76fe545`).
6. Tighten `commandWritesMemoryPath` to test whether the redirection *target* is the store path, not whether any `>` exists in the command.
