# Changelog

All notable changes to Universal Memory Architecture (UMA) are documented in this file.

## [0.17.0] - 2026-10-27

### Added
- Term capping and selection controls for recall queries:
  - `UMA_RECALL_MAX_TERMS`: configurable term limit (default 12; 0 = no limit / all terms).
  - `UMA_RECALL_TERM_PICK`: term selection mode `"head"` (default, first N terms) or `"rare"` (selects N terms with lowest SQLite FTS5 document frequency / highest IDF while preserving original prompt order).
- SQLite FTS5 indexer `term_doc_count` helper for term frequency lookups.

### Fixed
- Query builder hyphen handling: replaced internal hyphens with spaces (`fail-closed` -> `fail closed`) so FTS5 does not treat hyphens as binary NOT operators.

## [0.16.1] - 2026-10-27

### Changed
- Reverted experimental dynamic floor (`UMA_RECALL_DYNAMIC_FLOOR`) and project boost (`UMA_RECALL_PROJECT_BOOST`) after benchmark evaluation on 106 scenarios showed degraded negative recall and spurious hits.
- Maintained bilingual candidate retrieval (`UMA_RECALL_BILINGUAL=1`), achieving 100/106 and 42/42 negatives.

## [0.16.0] - 2026-10-27

### Added
- Bilingual candidate retrieval: `--alt-prompt` in `recall check` pools candidates across English translation and original user prompt.
- Automatic `--alt-prompt` propagation in Pi plugin via `pi-prompt-translate-state`.
