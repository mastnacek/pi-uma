---
type: Todo
title: "Replace patternToRegex with real ast-grep matching in the immune path"
timestamp: 2026-10-15 20:26:01
status: todo
source: pi-spai
tags: [contracts, immune, review]
facets:
  priority: high
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-049: Replace patternToRegex with real ast-grep matching in the immune path

. Replace patternToRegex with real ast-grep matching in the immune path @pi-uma ! :contracts:immune:review:
The live immune interceptor transliterates ast-grep patterns to regex (src/slices/immune/index.ts patternToRegex): $VAR cannot match string literals with spaces or quotes, $$$VAR cannot cross semicolons or newlines. Deny-severity contracts can silently miss real breaches inline. Either invoke real ast-grep like core/uma-core/src/contracts/ops.rs does, or visibly downgrade inline deny to warn with a note.
