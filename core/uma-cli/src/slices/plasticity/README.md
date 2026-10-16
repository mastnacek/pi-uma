# Plasticity slice — synaptic fitness bookkeeping (SPAI-050)

**What:** `uma plasticity reinforce <ID>...` and `uma plasticity frustrate <ID>...` — apply one observable outcome event to the named facts' synaptic fitness (decay baked in first, then +0.05 / −0.25).

**Why:** `Plasticity.reinforce`/`.frustrate` existed with zero call sites: counters that are computed and displayed but never driven are decoration. This slice makes the counters honest by naming their real triggers:

- **reinforce** — the outcome *confirmed* the fact: the operator upheld a contract rule in the immune consent dialog, or the recall gate activated the fact into a live session (once per session, bounded by the anti-echo exclusion).
- **frustrate** — the outcome *contradicted* the fact: the operator overrode a rule and proceeded with the edit it warned about.

Both triggers fire from the pi plugin after an operator-visible event; the CLI is the shared mutation point so any future client (MCP with writes, other harnesses) drives the same path.

**Invariant — telemetry, not content:** this slice changes only plasticity counters and `last_activated`; no title/body/rule the operator reads as a memory claim is touched, so these writes are deliberately exempt from the approval modal (which guards semantic content). Everything else about a store mutation still holds: the secrets gate runs on every write, and the plugin's bash-bypass guard treats `plasticity reinforce|frustrate` as a mutating subcommand.

**Invariant — ranking stays plasticity-blind (SPAI-051):** search ranking deliberately does NOT consume `effective_weight`. Blending decayed fitness into BM25/RRF while reinforcement follows recall would create a recall→reinforce→rank→recall feedback loop (used facts get richer, unused facts sink below retrieval and rot invisibly — defeating zombie detection, whose purpose is to *surface* stale facts for review). The weight drives `doctor`/`dream` retention review instead, where decay is advice, never suppression.

**Depends on:** `uma-core::{store::find_by_id, store::write, domain::Plasticity}`
