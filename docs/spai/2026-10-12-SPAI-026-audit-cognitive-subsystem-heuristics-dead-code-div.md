---
type: Todo
title: "Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping"
timestamp: 2026-10-12 10:12:26
status: todo
source: pi-spai
tags: [cognitive, heuristics, provenance, dead-code]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-026: Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping

. Audit cognitive subsystem heuristics, dead code, divergence, and provenance stamping @pi-uma !medium :cognitive:heuristics:provenance:dead-code:

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
