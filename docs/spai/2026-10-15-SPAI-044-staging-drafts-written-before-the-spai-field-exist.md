---
type: Todo
title: "Staging drafts written before the `spai` field exist are unreadable: StagedDraft requires `spai`, `staging show` fails with \"missing field `spai`\", and list_drafts swallows the error via `if let Ok(...)` so all 21 muscle_synthesis drafts (9 project + 12 global here) never appear in `uma staging list` / the review modal. Fix: `#[serde(default)]` on the field + surface skipped files instead of hiding them."
timestamp: 2026-10-15 09:57:24
status: todo
source: pi-spai
tags: [bug, staging, engine]
facets:
  priority: high
  project: pi-uma
  project_path: D:\01_programovani\pi\plugins\pi-uma
spai_symbol: '.'
---

# SPAI-044: Staging drafts written before the `spai` field exist are unreadable: StagedDraft requires `spai`, `staging show` fails with "missing field `spai`", and list_drafts swallows the error via `if let Ok(...)` so all 21 muscle_synthesis drafts (9 project + 12 global here) never appear in `uma staging list` / the review modal. Fix: `#[serde(default)]` on the field + surface skipped files instead of hiding them.

. Staging drafts written before the `spai` field exist are unreadable: StagedDraft requires `spai`, `staging show` fails with "missing field `spai`", and list_drafts swallows the error via `if let Ok(...)` so all 21 muscle_synthesis drafts (9 project + 12 global here) never appear in `uma staging list` / the review modal. Fix: `#[serde(default)]` on the field + surface skipped files instead of hiding them. @pi-uma !high :bug:staging:engine:
