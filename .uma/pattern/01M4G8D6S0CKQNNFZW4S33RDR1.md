---
id: 01M4G8D6S0CKQNNFZW4S33RDR1
scope: "project:pi-uma"
type: pattern
title: Two-skill layout ships in the pi-uma repository
tags:
  - skills
  - pi
  - layout
  - discovery
status: deprecated
supersedes: 01M4G82QTXXKBD1AK491FE3PWM
generated:
  by: pi-agent/1.1
  at: "2026-10-09T11:57:34.880807+00:00"
verified:
  - by: "human:operator"
    at: "2026-10-09T11:57:34.880808+00:00"
since: "2026-10-08T09:53:57.217427300+00:00"
until: "2026-10-09T12:01:34.193608200+00:00"
---
### Context
The two-skill layout (general vs Pi-specific, distinct names) is
unchanged; the physical home changed twice in one day. Final state:
the UMA Pi plugin is its own repository —
`D:/01_programovani/pi/plugins/pi-uma`, published as
github.com/mastnacek/pi-uma — installed globally by folder path
(pi install, personal settings). The plugin carries both skills in its
conventional `skills/` directory.

### Rule
- Pi-specific skill: `skills/uma-memory-pi/SKILL.md` **in the pi-uma
  repository** (canonical, loads globally with the package).
- General skill: canonical in the **ai-memory repository**
  (github.com/mastnacek/ai-memory, `skills/uma-memory/SKILL.md`),
  harness-agnostic; the pi-uma package ships a synced mirror annotated
  as such. Keep the mirror in sync when the canonical changes.
- The two audiences stay distinct (do not merge).

### Consequences
- Skills load in every project via the global package.
- UMA changes spanning CLI and plugin touch TWO repos (ai-memory +
  pi-uma); push both. The global pi install points at the local folder
  `D:/01_programovani/pi/plugins/pi-uma`, so `pi update --extensions`
  reconciles from that checkout.