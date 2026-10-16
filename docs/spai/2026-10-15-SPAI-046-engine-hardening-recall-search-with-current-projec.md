---
type: Todo
title: "Engine hardening: recall search with current_project=None (cwd outside any git repo) must degrade to global-only instead of dropping the project filter — all projects' facts became recallable and leaked across sessions (observed in OpenMes). Plugin side already fixed by passing ctx.cwd (534c932); engine fix belongs in Store::search_all scope=None branch"
timestamp: 2026-10-15 10:29:08
status: done
source: pi-spai
tags: [recall, scope, leak]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-046: Engine hardening: recall search with current_project=None (cwd outside any git repo) must degrade to global-only instead of dropping the project filter — all projects' facts became recallable and leaked across sessions (observed in OpenMes). Plugin side already fixed by passing ctx.cwd (534c932); engine fix belongs in Store::search_all scope=None branch

. Engine hardening: recall search with current_project=None (cwd outside any git repo) must degrade to global-only instead of dropping the project filter — all projects' facts became recallable and leaked across sessions (observed in OpenMes). Plugin side already fixed by passing ctx.cwd (534c932); engine fix belongs in Store::search_all scope=None branch @pi-uma !medium :recall:scope:leak:
