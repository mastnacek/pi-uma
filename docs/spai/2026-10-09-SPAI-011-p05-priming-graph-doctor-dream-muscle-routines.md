---
type: Todo
title: "P05 deferred tail: priming graph (spreading activation) + uma doctor --dream (retrieval practice) + uma_muscle (operator-curated only)"
timestamp: 2026-10-09 22:30:00
status: done
source: pi-spai
tags: [roadmap, p05, priming, dreaming, muscle]
facets:
  priority: low
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-011: P05 deferred tail: priming graph (spreading activation) + uma doctor --dream (retrieval practice) + uma_muscle (operator-curated only)

x P05 deferred tail: priming graph (spreading activation) + uma doctor --dream (retrieval practice) + uma_muscle (operator-curated only) @pi-uma !low :roadmap:p05:priming:dreaming:muscle:

## Scope (proposal order)
1. **Priming graph** — association graph over facts (links, tags, co-mentions); pre-activate related facts into the recall path when the agent touches a file. Pure kernel work + fastbrain recall gate hook.
2. **`uma doctor --dream`** — retrieval practice for facts nearing decay: synthetic question (Jev), small-model answer; correct → reset plasticity weight; wrong → flag as blurred and propose for review (never auto-archives).
3. **`uma_muscle`** — compiled action chunks; operator-curated ONLY, execution proposed through the modal. Requires amending the "skills expand, never execute" decision (recorded in memory) via the approval modal.

## Note
Split from SPAI-006: the P04 half (skeptic, debt ledger, humility) shipped in v0.3.0–v0.5.0.
