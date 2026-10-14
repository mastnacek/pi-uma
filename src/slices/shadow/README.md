# `shadow` slice

**What it is:** the zero-latency background worker (Proposal 02) that mines the
session for memory candidates and stages them in `.uma/.staging/<ULID>.json`.

## What it does

Two independent paths, both non-blocking and both *proposal-only*:

1. **Telemetry distillation** — `compiler_recovery` (a failing test/build command
   followed by a green one), `dependency_change` (Cargo.toml / package.json
   edits) and `user_correction` (a correction-style user message). These go
   through `uma staging distill` and a judge (`fastbrainJudge`), which decides
   whether the telemetry is durable enough to stage.
2. **SPAI task promotion** (SPAI-037, Tier 3) — when a SPAI item transitions to
   `done`, a fact proposal is staged with the task text as the draft body and the
   item id as provenance (`spai: [SPAI-NNN]`, `trigger: spai_done`). No judge
   call: a completed task is *never* treated as knowledge on its own, so the draft
   is staged at a deliberately low confidence and left to the operator.

`src/slices/shadow/policy.ts`, `spai_promotion.ts` and `staging_args.ts` are pure
(no pi imports) so `node --test` covers them; `index.ts` only wires events to
those policies.

**Why `staging_args.ts` exists as its own module:** the promotion's provenance
crosses a process boundary, and the first version dropped it there — the inline
argv construction typed its parameter without `spai`, so TypeScript accepted a
draft carrying provenance while the flag was never sent (`spai: []` in the staged
JSON; found only by inspecting a real draft, not by the policy tests). The argv is
now built by a tested pure function, so a silent drop at the seam cannot recur.

## Why it exists

Memory should be earned, not accumulated. Recovering from a failure, changing a
dependency, being corrected, or finishing a task are the moments when a durable
lesson is most likely — and also when the agent is least able to judge it. Staging
separates *capture* from *commitment*: the operator reviews the batch in
`/uma review` and approves, edits or discards each draft.

## Invariants

- **Proposals only.** Nothing in this slice writes a fact. A draft that is never
  approved leaves no trace in the store or the search index.
- **One draft per completed SPAI item per session** (`PromotionLedger`): re-marking
  an item `done` must not stage a duplicate.
- **Provenance is preserved**, not decorative: the `spai` ids ride through
  `.uma/.staging/` into the promoted fact (Rust-side guarantee, `staging` tests).
- **Never interrupts a turn**: all work is fired asynchronously and failures are
  swallowed — the worker must not be able to break the operator's session.
- **The status HUD refreshes** after a successful staging so `✦ N drafts` reflects
  reality.
