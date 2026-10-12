---
type: Todo
title: "Verify and fix UTF-8 byte slicing and truncation panics on Czech diacritics"
timestamp: 2026-10-12 10:12:02
status: done
source: pi-spai
tags: [utf8, crash, search, serialization]
facets:
  priority: high
  project: pi-uma
  project_path: D:/01_programovani/pi/plugins/pi-uma
spai_symbol: 'x'
---

# SPAI-019: Verify and fix UTF-8 byte slicing and truncation panics on Czech diacritics

x Verify and fix UTF-8 byte slicing and truncation panics on Czech diacritics @pi-uma !high :utf8:crash:search:serialization:

## Context & Details
Static review flagged multiple locations where string byte indexing or `String::truncate` is used instead of character boundary-aware operations. In Rust, slicing or truncating at an arbitrary byte index that splits a multi-byte UTF-8 code point panics with `byte index ... is not a char boundary`.

### Locations to Verify:
1. `core/uma-core/src/search/semantic.rs:123`: `&body[..140]` byte slicing for snippets.
2. `core/uma-core/src/sources/reader.rs:217`: `text.truncate(500)` in session message parsing.
3. `core/uma-core/src/sources/extract.rs:175`: `title.truncate(80)` in title extraction.
4. `core/uma-core/src/serialization/mod.rs:172`: `&rest[abs_pos-2..abs_pos]` byte slicing before inner `---`.

### Verification & Action:
- Replace raw byte slices and `truncate` with char-boundary-safe slicing (e.g. `floor_char_boundary` or char iterator).
- Add unit tests with Czech diacritics (`příliš žluťoučký kůň úpěl ďábelské ódy`) across store, serialization, search, and extract.
