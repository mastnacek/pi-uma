---
id: 01M4G8MGFCJDTBGDKNYZNDF0MX
scope: "project:pi-uma"
type: pattern
title: pi-uma ships one self-sufficient skill; installed from GitHub
tags:
  - skills
  - pi
  - layout
  - discovery
status: stable
supersedes: 01M4G8D6S0CKQNNFZW4S33RDR1
generated:
  by: pi-agent/1.1
  at: "2026-10-09T12:01:34.188020+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T12:01:34.188021+00:00"
since: "2026-10-08T09:53:57.217427300+00:00"
---
### Context
Final simplification, operator-decided: the globally installed UMA Pi
package (git:github.com/mastnacek/pi-uma, cloned to
~/.pi/agent/git/github.com/mastnacek/pi-uma) ships exactly ONE skill —
`uma-memory-pi`, self-sufficient: Pi tools, approval modal, /uma
commands, plus the folded-in portable essentials (capture triggers,
quality contract, lifecycle, CLI quick reference). The harness-agnostic
mirror was removed; the operator does not want to maintain two skills.

### Rule
- The pi-uma package carries only `skills/uma-memory-pi/SKILL.md`.
- The full harness-agnostic edition stays in the ai-memory repository
  (`skills/uma-memory/SKILL.md`) as reference material for non-Pi
  harnesses — it is NOT shipped and NOT kept in sync; it is a document,
  not a dependency.
- The earlier "do not merge the two skills" rule is retired by operator
  decision: one skill for Pi agents.

### Consequences
- Installing pi-uma from GitHub gives agent + skill in one step; no
  mirror-sync duty.
- If the portable material changes materially, update the essentials
  section in uma-memory-pi (and optionally the ai-memory edition).
- Dev loop note: the global install is now a GIT source (pinned clone),
  not the working folder — changes to the pi-uma repo require commit +
  push + `pi update --extensions` (+ reload) to reach the agent.