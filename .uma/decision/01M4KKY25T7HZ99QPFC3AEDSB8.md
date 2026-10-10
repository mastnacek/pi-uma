---
id: 01M4KKY25T7HZ99QPFC3AEDSB8
scope: "project:pi-uma"
type: decision
title: "Memory orchestrator: pi instance in a herdr pane, tiered routing, herdr-pane delegates (never subagents)"
tags:
  - orchestrator
  - architecture
  - herdr
  - decision
status: stable
generated:
  by: pi-agent/1.1
  at: "2026-10-10T19:16:44.858363700+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-10T19:16:44.858365600+00:00"
since: "2026-10-10T19:16:44.858365600+00:00"
---
### Context
User confirmed the design direction for the memory orchestrator (SPAI-017, proposal 09) on 2026-10-10.

### Decision
1. **Runtime:** a dedicated pi session running in a herdr pane — its own defined model, reduced thinking level (native pi setting), tuned system prompt, and the uma-memory-pi skill. Its only job is memory management and routing.
2. **Routing brain:** tiered — offline markers / ready-made slash commands first, Jev (cheap classifier) second, and the orchestrator's own large-context model as the escalation floor.
3. **Delegation target:** NOT pi subagents. New pi instances in herdr panes/tabs, so the operator can watch every delegate live and jump into the pane to redirect it.

### Consequences
- Routing core belongs in uma-core (VSA Rust, per standalone-core preference); the pane plugin stays thin.
- herdr CLI/socket API (`agent prompt`, `agent wait`, `tab create`) is the delegation fabric.
- Recursion guard must be re-thought: PI_SUBAGENT does not apply since delegates are full pi instances, not subagents.