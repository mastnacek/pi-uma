---
type: Idea
title: "Engine contract patterns are ast-grep-blind for deep scoped paths and metavariables in string literals"
timestamp: 2026-10-15 21:20:02
status: idea
source: pi-spai
tags: [contracts, engine]
facets:
  priority: medium
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '?'
---

# SPAI-055: Engine contract patterns are ast-grep-blind for deep scoped paths and metavariables in string literals

? Engine contract patterns are ast-grep-blind for deep scoped paths and metavariables in string literals @pi-uma !medium :contracts:engine:
Found while executing SPAI-049: the shipped VSA contract patterns (`use crate::slices::$$$REST;`, TS `from "../commands/$$$B"`) match NOTHING under real ast-grep 0.45 — scoped paths are right-nested so a metavariable after '::' binds only one trailing segment, and string contents are atomic tokens so metavariables inside quotes never expand. ops.rs rule_to_yaml emits a bare `pattern:` and both `uma contracts check` and the generated CI harness therefore silently verify nothing for these rules. The plugin inline path now degrades such patterns visibly to warn (patternBlindSpot in src/slices/immune/astgrep.ts). Engine-side fix: detect blind-spot shapes in rule_to_yaml / contracts check and either emit composite rules (kind + has/regex) or fail the report with a per-rule 'unverifiable' note instead of clean:true.
