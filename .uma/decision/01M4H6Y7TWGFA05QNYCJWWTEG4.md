---
id: 01M4H6Y7TWGFA05QNYCJWWTEG4
scope: "project:pi-uma"
type: decision
title: Jev via OpenRouter is the canonical System-1 transport (SPAI-001 cancelled)
tags:
  - fastbrain
  - jev
  - openrouter
  - architecture
  - decision
status: stable
generated:
  by: pi-agent/1.1
  at: "2026-10-09T20:51:10.300683700+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T20:51:10.300684+00:00"
since: "2026-10-09T20:51:10.300684+00:00"
---
### Context
The Jev transport in `core/uma-core/src/fastbrain/jev.rs` calls `typesafe/jev-router` through OpenRouter chat completions with a JSON-schema response format. It was originally framed as a temporary emulation awaiting a native TypeSafe System One API key (SPAI-001).

### Decision
The OpenRouter `typesafe/jev-router` transport **is** the canonical System-1 transport — production, not a placeholder. SPAI-001 (native transport swap) is cancelled. The OpenRouter API key resolution path (`OPENROUTER_API_KEY` or `~/.pi/agent/auth.json`) is the only credential surface required.

### Consequences
- Live transport verification is mandatory: `fastbrain::jev::tests::test_live_jev_transport_endpoints` runs real calls whenever credentials resolve; it skips loudly without them instead of mocking.
- The deterministic offline heuristics (`fastbrain/offline.rs`) remain the degradation floor — a fallback path, not a mock.
- If TypeSafe ever exposes a native System One key, a swap can be reconsidered as a new proposal, not assumed debt.