---
type: Todo
title: "Expose the jev judge on the uma_consolidate tool, or document lexical-only as intended"
timestamp: 2026-10-15 20:26:01
status: todo
source: pi-spai
tags: [consolidate, review]
facets:
  priority: low
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-054: Expose the jev judge on the uma_consolidate tool, or document lexical-only as intended

. Expose the jev judge on the uma_consolidate tool, or document lexical-only as intended @pi-uma !low :consolidate:review:
The CLI consolidate slice supports semantic refinement via the judge flag (refine_with_judge), but src/slices/consolidate/index.ts never passes it, so consolidation through Pi is always lexical-only. Add a judge parameter to the tool or record a decision that the plugin surface stays deterministic.
