/**
 * Shared fixtures for the /uma dash slice tests.
 *
 * Not a `*.test.ts` file, so `node --test test/*.test.ts` does not run it —
 * it only supplies the recorded CLI shapes and the two tiny builders used by
 * both the data and the rendering test files.
 */

import type { DashFact, DashQuery } from "../src/slices/dash/data.ts";
import { normalizeRecord, tryParseJson } from "../src/slices/dash/record.ts";
import { normalizeDrafts } from "../src/slices/dash/drafts.ts";

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
    links: [],
    spai: [],
    validity: {},
    verified: [],
    ...over,
  };
}

/** Recorded `uma read --json` shape: a deprecated fact carrying every optional
 *  metadata block (contract, spai links, validity window, provenance,
 *  plasticity, saliency, description, template). */
export const READ_RECORD_JSON = `{
  "body": "### Context\\nVSA keeps slices independent.\\n\\n### Decision\\nAdopt **VSA**. Note the old rule was retired: see 01M4QW0BW1WWJRGPE7FZTPBBMN.",
  "contract": {
    "engine": "ast-grep",
    "rule": {
      "inside": "src/slices/**",
      "language": "rust",
      "message": "Inviolable VSA Rule: slices must NEVER import each other!",
      "pattern": "use crate::slices::$$$REST;"
    },
    "severity": "deny"
  },
  "description": "Superseded by the 2026-10 revision.",
  "fact_type": "Decision",
  "generated": { "at": "2026-10-08T07:48:55.370316300Z", "by": "pi-agent/1.1" },
  "id": "01M4D7S5YART7AGWN7RDSRNRM1",
  "links": ["01M4DGCX9C5TDXFVMMTHT6TAE7"],
  "plasticity": { "frustrations": 1, "half_life_days": 30, "last_activated": "2026-10-12T10:00:00Z", "reinforcements": 4, "weight": 0.85 },
  "saliency": { "immune_to_decay": true, "multiplier": 1.5, "shock_level": 0.8 },
  "scope": { "Project": "pi-uma" },
  "spai": ["SPAI-007", "SPAI-041"],
  "status": "Deprecated",
  "supersedes": null,
  "tags": ["vsa", "architecture"],
  "template": null,
  "title": "Adopt Vertical Slice Architecture (VSA) for UMA",
  "validity": { "since": "2026-10-08T07:48:55.370316300Z", "stale_after": "2026-12-31", "until": "2026-10-12T10:54:47.195736Z" },
  "verified": [{ "at": "2026-10-08T07:48:55.370316300Z", "by": "human:operator" }]
}`;

/** The fixture above, normalized the way the detail route normalizes it. */
export function readFact(): DashFact {
  return normalizeRecord(tryParseJson(READ_RECORD_JSON) as Record<string, never>);
}

/** Recorded `uma timeline --json --id` shape: a two-revision chain. */
export const TIMELINE_JSON = `[
  {
    "current": "01M4QW0BW1WWJRGPE7FZTPBBMN",
    "has_history": true,
    "length": 2,
    "revisions": [
      {
        "id": "01M4D7S5YART7AGWN7RDSRNRM1",
        "revised_at": "2026-10-08T07:48:55.370316300+00:00",
        "since": "2026-10-08T07:48:55.370316300+00:00",
        "status": "deprecated",
        "title": "Adopt Vertical Slice Architecture (VSA) for UMA",
        "until": "2026-10-12T10:54:47.195736+00:00"
      },
      {
        "id": "01M4QW0BW1WWJRGPE7FZTPBBMN",
        "revised_at": "2026-10-12T10:54:46.657725600+00:00",
        "since": "2026-10-08T07:48:55.370316300+00:00",
        "status": "stable",
        "title": "Adopt Vertical Slice Architecture (VSA) for UMA",
        "until": null
      }
    ]
  }
]`;

/** Recorded `uma staging list --json` shape: one SPAI promo, one muscle routine. */
export const DRAFTS_JSON = `[
  {
    "id": "01M4Z77HCC4J3FBBFS3S4YFZMS",
    "status": "draft",
    "confidence": 0.7,
    "provenance": {
      "session_id": null,
      "trigger_type": "spai_done",
      "context": null
    },
    "fact": {
      "body": "Done: SPAI-042 promoted.",
      "contract": null,
      "description": null,
      "fact_type": "Note",
      "generated": { "at": "2026-10-15T06:00:00Z", "by": "pi-agent/1.1" },
      "id": "01M4Z77HCC4J3FBBFS3S4YFZMS",
      "links": [],
      "plasticity": null,
      "saliency": null,
      "scope": { "Project": "pi-uma" },
      "spai": ["SPAI-042"],
      "status": "Stable",
      "supersedes": null,
      "tags": ["spai"],
      "template": null,
      "title": "SPAI-042 finished: project-qualified SPAI references",
      "validity": { "since": "2026-10-15T06:00:00Z", "stale_after": null, "until": null },
      "verified": []
    }
  },
  {
    "id": "01M4RMTNN90RWZQF5XWXFDPTKB",
    "status": "draft",
    "confidence": 0.8,
    "provenance": {
      "session_id": "session-abc",
      "trigger_type": "muscle_synthesis",
      "context": "seen 4x in this session"
    },
    "fact": {
      "body": "1. list the directory",
      "contract": null,
      "description": null,
      "fact_type": "Skill",
      "generated": { "at": "2026-10-12T10:00:00Z", "by": "pi-agent/1.1" },
      "id": "01M4RMTNN90RWZQF5XWXFDPTKB",
      "links": [],
      "plasticity": null,
      "saliency": null,
      "scope": { "Project": "pi-uma" },
      "spai": [],
      "status": "Stable",
      "supersedes": null,
      "tags": ["muscle"],
      "template": "[{\\\"command\\\":\\\"ls\\\",\\\"args\\\":[\\\"-la\\\"]}]",
      "title": "muscle:ls--la-cd",
      "validity": { "since": "2026-10-12T10:00:00Z", "stale_after": null, "until": null },
      "verified": []
    }
  }
]`;

/** The drafts fixture above, normalized the way the drafts route normalizes it. */
export function draftsFixture() {
  return normalizeDrafts(DRAFTS_JSON);
}

/** A minimal dashboard query; every field can be overridden per test. */
export function query(over: Partial<DashQuery> = {}): DashQuery {
  return { q: "", type: "", scope: "", offset: 0, history: false, ...over };
}
