---
type: Todo
title: "Anti-echo: recall injection deduplicates against facts already injected in the session — buildRecallMessage filters injected IDs (details.ids), session_start rebuilds the set from the branch's uma-recall entries (survives reload/resume), session_before_compact clears it (post-compaction re-injection becomes useful). Turns with nothing new stay out of the transcript"
timestamp: 2026-10-15 11:51:12
status: todo
source: pi-spai
tags: [recall, dedup, tokens]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-048: Anti-echo: recall injection deduplicates against facts already injected in the session — buildRecallMessage filters injected IDs (details.ids), session_start rebuilds the set from the branch's uma-recall entries (survives reload/resume), session_before_compact clears it (post-compaction re-injection becomes useful). Turns with nothing new stay out of the transcript

. Anti-echo: recall injection deduplicates against facts already injected in the session — buildRecallMessage filters injected IDs (details.ids), session_start rebuilds the set from the branch's uma-recall entries (survives reload/resume), session_before_compact clears it (post-compaction re-injection becomes useful). Turns with nothing new stay out of the transcript @pi-uma !medium :recall:dedup:tokens:
