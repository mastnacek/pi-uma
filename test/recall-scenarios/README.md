# Recall scenarios

Measures what the recall gate would inject for real prompts, against the
operator's real memory, from inside each real project. It is not a unit test:
expectations reference live fact IDs, so it runs on the operator's machine,
not in CI, and it is read-only (`uma recall check` never mutates the store).

```bash
npm run scenarios                        # judge jev, English prompts
npm run scenarios -- --repeat 3          # judge stability across runs
npm run scenarios -- --lang cs           # Czech prompts (prompt-translate off)
npm run scenarios -- --only LEAK --json report.json
```

## What a case checks

| kind | passes when |
|------|-------------|
| `hit` | every `must_include` fact is recalled |
| `negative` | nothing is recalled |
| `trap` | generic-word prompts pull no fact from the `must_exclude` groups |
| `leak` | a fact scoped to another project, or test junk, stays out |

`prompt` is the English text UMA receives after `pi-prompt-translate`;
`prompt_cs` is the operator's original wording. Each project case runs with
its project root as cwd, because recall scopes to the cwd's git root.

## Reading a failure

- `missing (judge did not search)` — the fastbrain judge declined; retrieval never ran.
- `missing (searched but not found)` — a retrieval miss (wording, language, threshold).
- `forbidden: …` — a leak or junk fact was injected; usually a **data** defect
  (a project fact stored as global), sometimes a ranking one.
- `stale expectation ids` — the fact was superseded; update the ID in `scenarios.json`.

Expectations carry a title fallback, so a superseded fact still matches and is
flagged instead of silently failing. Facts are referenced by ID only; no fact
bodies live in this public repository.
