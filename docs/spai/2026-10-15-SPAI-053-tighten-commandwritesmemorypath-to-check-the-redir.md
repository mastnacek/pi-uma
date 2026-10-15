---
type: Todo
title: "Tighten commandWritesMemoryPath to check the redirection target"
timestamp: 2026-10-15 20:26:01
status: done
source: pi-spai
tags: [approval-gate, false-positive]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-053: Tighten commandWritesMemoryPath to check the redirection target

x Tighten commandWritesMemoryPath to check the redirection target @pi-uma !medium :approval-gate:false-positive:
src/hooks/approval_gate.ts blocks any command that mentions a store path and contains any redirection or file utility, so read-only commands like ls .uma/ 2>/dev/null are blocked (observed live 2026-10-15). Parse the redirection target and block only when it points into a memory store path.
