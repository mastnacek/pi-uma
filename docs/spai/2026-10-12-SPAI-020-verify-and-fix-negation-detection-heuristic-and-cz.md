---
type: Todo
title: "Verify and fix negation detection heuristic and Czech diacritic keyword matching"
timestamp: 2026-10-12 10:12:07
status: done
source: pi-spai
tags: [heuristics, negation, czech]
facets:
  priority: high
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-020: Verify and fix negation detection heuristic and Czech diacritic keyword matching

x Verify and fix negation detection heuristic and Czech diacritic keyword matching @pi-uma !high :heuristics:negation:czech:

## Context & Details
Review identified linguistic heuristic bugs in relationship judgment, offline recall, and extraction:

### Locations to Verify:
1. `core/uma-core/src/similarity.rs:100-102`:
   ```rust
   lower.split(|c: char| !c.is_alphanumeric())
        .any(|word| word.len() >= 5 && word.starts_with("ne"))
   ```
   Intended to catch Czech negation prefixes like `"nepoužívat"`, but falsely flags common English words: `"network"`, `"needs"`, `"nested"`, `"neural"`, `"next"`. Causes false contradictions in consolidation and relationship judging.
2. `core/uma-core/src/fastbrain/offline.rs` & `sources/extract.rs`:
   Recall gate and extraction keywords use ASCII-only stems ("pamatujes", "vzdycky", "resili jsme") and fail to match real user prompts typed with proper Czech diacritics ("pamatuješ", "vždycky", "řešili jsme").

### Verification & Action:
- Scope Czech "ne" detection only to Czech text contexts or match against known verb patterns / stemmers, or strip ASCII prefixes only after language classification.
- Normalize/fold diacritics in recall matching so both ASCII and diacritic inputs match.
- Add unit tests for English words starting with "ne" and Czech diacritic recall queries.
