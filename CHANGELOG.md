# Changelog

All notable changes to Universal Memory Architecture (UMA) are documented in this file.

## [0.16.1] - 2026-10-27

### Changed
- Reverted experimental dynamic floor (`UMA_RECALL_DYNAMIC_FLOOR`) and project boost (`UMA_RECALL_PROJECT_BOOST`) after benchmark evaluation on 106 scenarios showed degraded negative recall and spurious hits.
- Maintained bilingual candidate retrieval (`UMA_RECALL_BILINGUAL=1`), achieving 100/106 and 42/42 negatives.

## [0.16.0] - 2026-10-27

### Added
- Bilingual candidate retrieval: `--alt-prompt` in `recall check` pools candidates across English translation and original user prompt.
- Automatic `--alt-prompt` propagation in Pi plugin via `pi-prompt-translate-state`.
