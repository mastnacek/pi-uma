---
type: Todo
title: "Immune/approval gate blocks read-only store inspection: a command that mentions a store path (.uma/... or the global data dir) together with any redirect (2>&1, >) is refused with \"You MUST call uma_write\" — e.g. `find .uma -maxdepth 2 | ... > /tmp/x`. Any redirect counts as a mutation token. Fix: require an actual mutation (write verb or a redirect targeting the store) and let read-only verbs (find/ls/head/grep/cat/stat) through."
timestamp: 2026-10-15 09:57:24
status: todo
source: pi-spai
tags: [bug, immune, gate]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-045: Immune/approval gate blocks read-only store inspection: a command that mentions a store path (.uma/... or the global data dir) together with any redirect (2>&1, >) is refused with "You MUST call uma_write" — e.g. `find .uma -maxdepth 2 | ... > /tmp/x`. Any redirect counts as a mutation token. Fix: require an actual mutation (write verb or a redirect targeting the store) and let read-only verbs (find/ls/head/grep/cat/stat) through.

. Immune/approval gate blocks read-only store inspection: a command that mentions a store path (.uma/... or the global data dir) together with any redirect (2>&1, >) is refused with "You MUST call uma_write" — e.g. `find .uma -maxdepth 2 | ... > /tmp/x`. Any redirect counts as a mutation token. Fix: require an actual mutation (write verb or a redirect targeting the store) and let read-only verbs (find/ls/head/grep/cat/stat) through. @pi-uma !medium :bug:immune:gate:
