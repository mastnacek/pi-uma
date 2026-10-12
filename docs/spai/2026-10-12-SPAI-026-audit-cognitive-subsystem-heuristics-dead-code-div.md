---
type: Todo
title: "Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping"
timestamp: 2026-10-12 10:12:26
status: done
source: pi-spai
tags: [cognitive, heuristics, provenance, dead-code]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-026: Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping

x Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping @pi-uma !medium :cognitive:heuristics:provenance:dead-code:

## Context & Details
Review characterized several cognitive features as dead code, naive heuristics, or self-fulfilling logic:

### Locations to Verify:
1. Priming Graph:
   - `core/uma-cli/src/slices/recall/mod.rs:239-262`: Graph is built only from the 1–3 initial search hits; every neighbor is already marked as seen, making priming an effective no-op. Edge weights are discarded (`connect(.., _weight)`).
2. Plasticity / Saliency / Decay:
   - Initialized to `None` in `Fact::new` and never set during live execution.
   - `domain/cognitive.rs:91-102`: Check math in `frustrate()`—frustrating an idle fact allegedly increases its effective weight. `multiplier` and `shock_level` are never read.
3. Dream Mode:
   - `core/uma-core/src/fastbrain/dream.rs:59-64`: Prompt includes the grading rubric with the answer key. Offline mode always returns `"BLURRED"`.
4. Route, Skeptic, and Humility Substring Matching:
   - Substring matching matches substrings inside unrelated words ("uma" in "human", "ffi" in "efficient", "mod" in "model", "api" in "capital").
   - `risk` was refactored to whole-token matching while `skeptic` stayed with substring matching, producing conflicting bands.
   - Confidence constants are hardcoded (0.8 / 0.85 / 0.7 / 0.5). `--judge jev` in route is a stub.
5. Provenance Stamping:
   - `domain/fact.rs:49-50`: `Fact::new` stamps `verified: human:operator` and `generated: pi-agent/1.1` across all facts, regardless of whether created by agent, MCP, or distillation.

### Verification & Action:
- Audit each cognitive module: either make the algorithm functional and aligned with design, or prune/simplify dead heuristics.
- Align `skeptic` and `risk` token matching.
- Set accurate provenance based on actual creation source.

## Audit outcome (2026-10-12, v0.8.8)

**Fixed (verified against the code):**
- **`frustrate()` decay bug** (`domain/cognitive.rs`): the old body reset `last_activated` then subtracted, erasing accumulated decay and *raising* an idle fact's effective weight (0.125 → 0.25). `reinforce`/`frustrate` now bake decay in first, so frustration can never increase fitness. Regression test added.
- **Saliency made functional**: `multiplier`/`shock_level` were dead (only serialized). `Saliency::effective_multiplier()` now derives from `shock_level` when `multiplier` is default; `Fact::effective_weight` = decayed fitness × multiplier (retrieval priority). Zombie detection moved to decay-only `Fact::decayed_weight`, so a saliency boost cannot hide rot. Tests added.
- **Forged provenance** (`domain/fact.rs`): `Fact::new` no longer stamps `verified: human:operator` on every fact. The operator-approved slices (CLI `write`, `supersede`, `staging approve`) record `human:operator` explicitly; MCP/agent/distillation paths no longer claim human review.
- **Substring matching → whole-token** (`similarity::contains_word`): applied in `council::humility::complexity_signals`, `council::offline_skeptic` and `fastbrain::route`. Named false positives are gone: `api`/`capital`, `ffi`/`efficient`, `uma`/`human`, `mod`/`model`, `lock`/`block`. This aligns skeptic with `risk`, which already matched whole tokens. Tests added.
- **Dream self-grading** (`fastbrain/dream.rs`): the grading key was in the answering prompt, so the model graded itself with the answer in hand. `dream_answer` now answers from recall *without* the key in one call, then grades in a separate call. Offline no longer reports `BLURRED` (a wrong-answer verdict) — `doctor dream` reports **UNGRADED** when the offline floor could not answer.
- **Priming no-op** (`uma-cli/.../recall/mod.rs`): the association graph was built only from the 1–3 search hits, so every neighbor was already seen and spreading activation surfaced nothing. The graph is now built from all known roots; spreading can reach genuinely new neighbors.

**Deliberately not changed (recorded, not defects):**
- `route --judge jev` is a documented Fáze-D stub that degrades visibly to the offline verdict with an explicit note (an honest unimplemented branch, not a silent lie).
- The hardcoded confidence constants (0.8/0.85/0.7/0.5) are labelled heuristic values, not calibrated probabilities; inventing replacement numbers without calibration data would be less honest, not more.
