---
type: Todo
title: "Wire plasticity reinforce and frustrate to observable outcomes, or remove the machinery"
timestamp: 2026-10-15 20:26:01
status: done
source: pi-spai
tags: [plasticity, review]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-050: Wire plasticity reinforce and frustrate to observable outcomes, or remove the machinery

. Wire plasticity reinforce and frustrate to observable outcomes, or remove the machinery @pi-uma !medium :plasticity:review:
Plasticity.reinforce and frustrate (core/uma-core/src/domain/cognitive.rs) have zero call sites outside domain and tests. Candidate triggers: a recalled fact actually used in the answer reinforces, a modal rejection frustrates. If no honest signal exists, delete the counters and keep pure decay.
