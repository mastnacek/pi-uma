# Changelog

All notable changes to Universal Memory Architecture (UMA) are documented in this file.

## [0.17.1] - 2026-10-27

### Fixed
- Approval gate: shell wrappers no longer hide a memory write. `bash -c "uma write …"` (live finding: it created a fact without the approval modal), `sh -lc`, `cmd /c`, `cmd.exe /K`, `powershell -Command`, `pwsh -c` and nested wrappers are unwrapped token by token and their body is judged exactly like a bare command (UMA-binary scan and store-path scan both).
- Approval gate: cmd.exe builtins (`copy`, `move`, `del`, `xcopy`, `robocopy`, …) and PowerShell cmdlets/aliases (`Set-Content`, `Add-Content`, `Out-File`, `Copy-Item`, `Remove-Item`, `New-Item`, …) now count as file-mutating utilities, so `cmd /c copy nul .uma/x.md` and `powershell -Command "Set-Content .uma/x.md y"` are blocked.
- Tests: the `loadConfig` isolation test no longer depends on the operator's real `~/.pi/agent/uma.json` (it failed once `appendPrompt` was enabled globally).

## [0.17.0] - 2026-10-27

### Added
- Extended recall query term capping: `UMA_RECALL_MAX_TERMS` env switch (default 32, 0 = no limit / uncapped).
  - Raised default max terms from 12 to 32 using "head" selection, significantly reducing keyword starvation for longer conversational prompts.
  - Benchmark measurements across 106 scenarios (2 runs, jitter ±1):
    - `head12`: 99/100
    - `head20`: 101/101
    - `head32`: 102/100 (negatives 42/42)
    - `head0`: 102/101 (negatives 42/42)
    - `rare16`: 102/101
    - `rare12`: 100
  - The experimental "rare" IDF mode brought no measurable benefit over "head" and caused regressions on domain queries (lost NSF-H2-p2 twice), so it was dropped in favor of clean 32-term head selection.

### Fixed
- Query builder hyphen handling: replaced internal hyphens with spaces (`fail-closed` -> `fail closed`) so SQLite FTS5 does not interpret hyphens as binary NOT / exclusion operators.

## [0.16.1] - 2026-10-27

### Changed
- Reverted experimental dynamic floor (`UMA_RECALL_DYNAMIC_FLOOR`) and project boost (`UMA_RECALL_PROJECT_BOOST`) after benchmark evaluation on 106 scenarios showed degraded negative recall and spurious hits.
- Maintained bilingual candidate retrieval (`UMA_RECALL_BILINGUAL=1`), achieving 100/106 and 42/42 negatives.

## [0.16.0] - 2026-10-27

### Added
- Bilingual candidate retrieval: `--alt-prompt` in `recall check` pools candidates across English translation and original user prompt.
- Automatic `--alt-prompt` propagation in Pi plugin via `pi-prompt-translate-state`.
