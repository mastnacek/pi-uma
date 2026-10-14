---
type: Todo
title: "Bug: orch_delegate never splits a new pane for an unknown specialist/project name — resolveTarget returns paneId=raw target, so the guard `params.target !== resolved.paneId` is always false and the split branch is skipped (\"agent_not_found\"). Detect explicit pane IDs by pattern (wX:pY) instead of string equality"
timestamp: 2026-10-14 11:57:45
status: todo
source: pi-spai
tags: [bug, delegate]
facets:
  priority: high
  project: pi-orchestrator
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-039: Bug: orch_delegate never splits a new pane for an unknown specialist/project name — resolveTarget returns paneId=raw target, so the guard `params.target !== resolved.paneId` is always false and the split branch is skipped ("agent_not_found"). Detect explicit pane IDs by pattern (wX:pY) instead of string equality

. Bug: orch_delegate never splits a new pane for an unknown specialist/project name — resolveTarget returns paneId=raw target, so the guard `params.target !== resolved.paneId` is always false and the split branch is skipped ("agent_not_found"). Detect explicit pane IDs by pattern (wX:pY) instead of string equality @pi-orchestrator !high :bug:delegate:
