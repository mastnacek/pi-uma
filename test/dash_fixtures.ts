/**
 * Shared fixtures for the /uma dash slice tests.
 *
 * Not a `*.test.ts` file, so `node --test test/*.test.ts` does not run it —
 * it only supplies the recorded CLI shapes and the two tiny builders used by
 * both the data and the rendering test files.
 */

import type { DashFact, DashQuery } from "../src/slices/dash/data.ts";

/** Recorded `uma list --json` shape (two facts, project + global scope). */
export const LIST_JSON = `[
  {
    "body": "### Invariant\\nUse VSA for every slice.\\n\\n- one slice per capability\\n- no cross imports\\n\\n**Bold** and \`code\`.",
    "effective_weight": 1.0,
    "fact_type": "decision",
    "id": "01M4D6K8J6QGDFC0Y11FW45R87",
    "scope": "project:pi-uma",
    "tags": ["vsa", "architecture"],
    "title": "Use VSA Architecture"
  },
  {
    "body": "Prefer Rust for standalone cores.",
    "effective_weight": 0.5,
    "fact_type": "preference",
    "id": "01M4D7SF7CH3SSFKRAY48YC20P",
    "scope": "global",
    "tags": [],
    "title": "Prefer Standalone VSA Rust Core"
  }
]`;

/** Recorded `uma search --json` shape, including BM25 markers and a deprecated hit. */
export const SEARCH_JSON = `{
  "degraded": false,
  "note": null,
  "hits": [
    {
      "fact_type": "decision",
      "file_path": "C:\\\\Users\\\\x\\\\decision\\\\01M4.md",
      "id": "01M4D6K8J6QGDFC0Y11FW45R87",
      "scope": "global",
      "score": 0.03278688524590164,
      "snippet": "...structured with Vertical Slice Architecture ([match]VSA[/match]).",
      "status": "stable",
      "supersedes": null,
      "tags": ["vsa"],
      "title": "Use VSA Architecture"
    },
    {
      "fact_type": "note",
      "id": "01MOLDDEPRECATEDXXXXXXXX",
      "scope": "global",
      "score": 0.01,
      "snippet": "an old note",
      "status": "deprecated",
      "supersedes": null,
      "tags": [],
      "title": "Old Note"
    }
  ]
}`;

/** A minimal fact; every field can be overridden per test. */
export function fact(over: Partial<DashFact> = {}): DashFact {
  return {
    id: "01TESTFACT000000000000000",
    title: "Test fact",
    factType: "note",
    scope: "global",
    tags: [],
    weight: null,
    deprecated: false,
    ...over,
  };
}

/** A minimal dashboard query; every field can be overridden per test. */
export function query(over: Partial<DashQuery> = {}): DashQuery {
  return { q: "", type: "", scope: "", offset: 0, ...over };
}
