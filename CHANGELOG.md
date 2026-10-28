# Changelog

All notable changes to Universal Memory Architecture (UMA) are documented in this file.

## [0.17.4] - 2026-10-28

### Fixed
- `uma sync push`: unreviewed staging drafts are never published. An existing `.gitignore` is extended with `.staging/` (it was only written when missing, so older stores lacked the entry and a live push published 49 drafts), and drafts committed by an older build are untracked while staying on disk.
- `uma migrate`: provenance is backfilled honestly. `verified` is never invented (it used to stamp `human:operator` on facts nobody reviewed) and an unknown author is recorded as `legacy:unknown` instead of `pi-agent/1.1`.
- `uma secrets scan`: injection signatures now catch "ignore all previous instructions" (one to four modifier words) and system-prompt exfiltration requests; both warn without blocking. OpenRouter keys are labelled "OpenRouter API key".
- Recall anti-echo: the injected-facts set is cleared on `session_compact` (a completed compaction) instead of `session_before_compact`, so a compaction another extension cancels no longer re-injects facts the context still holds.
- `/uma immune`, `/uma append`, `/uma auto-approve` without `--global`: operator-only keys are saved to the global config (a project config may not carry them) and the confirmation says so; before, the project save wrote `{}` and the mode reverted on the next reload.

## [0.17.3] - 2026-10-28

### Fixed
- Humility familiarity: fact coverage counted a file stem as a raw substring of every fact in both scopes, so a short stem (`b` of `vendor/rr/b.js`) matched almost every fact. A file with no memory at all reported 71 covering facts and "high" familiarity, and the humility gate never asked (live finding). Stems shorter than 3 characters are no longer search tokens, paths and stems match only as whole words, and matching is case-insensitive.
- Engine and plugin versions are aligned again (the engine reported 0.17.0 while the plugin shipped 0.17.2).

## [0.17.2] - 2026-10-28

### Fixed
- Approval gate: `uma domains set`, `uma migrate` (without `--dry-run`), `uma sync push|pull`, `uma staging discard` and `uma muscle run --confirm` are now blocked when run through bash. Each ran unblocked in the live test: they rewrite or publish memory, destroy unreviewed drafts, or execute a routine without the consent dialog.
- Immune interceptor: preference and correction facts are now rules alongside decisions and patterns. Violating edits against a promoted correction or an operator preference passed without a dialog before.
- Immune interceptor: the rules cache is keyed by cwd, so another project's rules no longer apply for up to 10 minutes after a project switch.
- Proposal modal: the translated body view is tied to the body it was made from. After editing the body the stale translation is dropped and the edited body is translated again; the operator previously approved a body whose translated view still showed the old text. Toggling the translation on with `c` now starts it when it never ran.

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
