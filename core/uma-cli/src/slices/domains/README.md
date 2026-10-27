# `domains` slice

**Command:** `uma domains set --domain <domain> <id...>`
**Depends on:** `uma-core::{store, serialization, domain}`

## What it does
Sets or appends a domain tag to the frontmatter of one or more existing memory facts without mutating the fact's content, ID, or scope, then rebuilds the index cache so domain filtering takes effect immediately.

## Why it exists
Allows retrofitting domain tags onto existing global facts so they only surface in projects that declare that domain (e.g. Lotus/Domino rules appearing only in Domino-related projects).

## Invariants
- Modifies only frontmatter `domains`, never content, ID, or scope.
- Idempotent: setting a domain that already exists is a clean no-op.
- Always triggers an index rebuild after batch updates so search/recall consistency is preserved.
