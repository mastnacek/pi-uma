---
type: Todo
title: "Adopt the runUma timeout reaper in immune and humility paths"
timestamp: 2026-10-15 20:26:01
status: done
source: pi-spai
tags: [immune, timeout]
facets:
  priority: medium
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-052: Adopt the runUma timeout reaper in immune and humility paths

x Adopt the runUma timeout reaper in immune and humility paths @pi-uma !medium :immune:timeout:
runUma gained timeoutMs with child reaping (exit 124) in commit 76fe545, but src/hooks/immune_interceptor.ts and the humility path still race bare withTimeout promises, leaving orphaned uma.exe processes for up to the internal engine timeout. Pass CHECK_TIMEOUT_MS through as the runUma timeout argument.
