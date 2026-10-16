---
type: Todo
title: "Decide whether search ranking consumes effective_weight"
timestamp: 2026-10-15 20:26:01
status: done
source: pi-spai
tags: [search, plasticity, review]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-051: Decide whether search ranking consumes effective_weight

. Decide whether search ranking consumes effective_weight @pi-uma !medium :search:plasticity:review:
Fact.effective_weight is computed for display only (list, read, doctor); search ranking is pure BM25 and RRF (core/uma-core/src/search). Either blend the decayed and saliency-boosted weight into ranking, or stop presenting it as a retrieval-priority number. Depends on the reinforce wiring decision.
