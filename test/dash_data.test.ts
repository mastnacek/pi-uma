/**
 * /uma dash slice tests — the CLI adapter half (Proposal 10 §10).
 *
 * Everything here is pure: normalize/parse/filter/page helpers and the exact
 * argv the dashboard hands to the engine, checked against recorded
 * `uma list --json` / `uma search --json` fixtures (no live binary).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAGE_SIZE,
  filterFacts,
  normalizeListFacts,
  normalizeScope,
  normalizeSearchHits,
  pageFacts,
  parseChainJson,
  parseSearchJson,
  searchArgs,
} from "../src/slices/dash/data.ts";
import { markInactive, normalizeRecord } from "../src/slices/dash/record.ts";
import { LIST_JSON, SEARCH_JSON, TIMELINE_JSON, fact, query } from "./dash_fixtures.ts";

test("normalizeListFacts: parses recorded list records into unified facts", () => {
  const facts = normalizeListFacts(LIST_JSON);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].id, "01M4D6K8J6QGDFC0Y11FW45R87");
  assert.equal(facts[0].factType, "decision");
  assert.equal(facts[0].scope, "project:pi-uma");
  assert.equal(facts[0].weight, 1);
  assert.deepEqual(facts[0].tags, ["vsa", "architecture"]);
  assert.ok(facts[0].body?.includes("### Invariant"));
  assert.equal(facts[0].deprecated, false);
  assert.equal(facts[1].scope, "global");
  assert.equal(facts[1].weight, 0.5);
});

test("normalizeScope: accepts string, capitalized, prefixed and enum shapes", () => {
  assert.equal(normalizeScope("global"), "global");
  assert.equal(normalizeScope("Global"), "global");
  assert.equal(normalizeScope("project:pi-uma"), "project:pi-uma");
  assert.equal(normalizeScope({ Project: "pi-uma" }), "project:pi-uma");
  assert.equal(normalizeScope("other"), "project:other");
  assert.equal(normalizeScope(undefined), "project");
});

test("normalizeSearchHits: keeps markers, flags non-stable hits as deprecated", () => {
  const hits = normalizeSearchHits(SEARCH_JSON);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].status, "stable");
  assert.equal(hits[0].deprecated, false);
  assert.ok(hits[0].snippet?.includes("[match]VSA[/match]"));
  assert.equal(hits[0].body, undefined);
  assert.equal(hits[1].status, "deprecated");
  assert.equal(hits[1].deprecated, true);
});

test("parseSearchJson: the engine's degradation note is surfaced, never dropped", () => {
  const healthy = parseSearchJson(SEARCH_JSON);
  assert.equal(healthy.note, undefined);
  assert.equal(healthy.hits.length, 2);

  const degraded = parseSearchJson(
    JSON.stringify({
      degraded: true,
      note: "Hybrid search degraded to Keyword: no embeddings are stored.",
      hits: [],
    }),
  );
  assert.ok(degraded.note?.includes("no embeddings are stored"));

  // degraded=true without a note must still produce a visible reason.
  const silent = parseSearchJson(JSON.stringify({ degraded: true, note: null, hits: [] }));
  assert.ok(silent.note && silent.note.length > 0);
});

test("data.ts: unparseable engine output is a controlled error, never a crash", () => {
  assert.throws(() => normalizeListFacts("not json at all"));
  assert.throws(() => normalizeListFacts('{"not":"an array"}'));
  assert.throws(() => parseSearchJson('{"degraded":false}'));
  assert.throws(() => parseSearchJson("[1,2,3]"));
});

test("searchArgs: filters reach the CLI (pre-cap) and -n lifts the 10-hit default", () => {
  assert.deepEqual(searchArgs(query({ q: "vsa" })), [
    "search",
    "--json",
    "-n",
    String(PAGE_SIZE),
    "vsa",
  ]);
  assert.deepEqual(searchArgs(query({ q: "vsa", type: "decision", scope: "global" })), [
    "search",
    "--json",
    "-n",
    String(PAGE_SIZE),
    "--type",
    "decision",
    "--scope",
    "global",
    "vsa",
  ]);
  // The CLI resolves the literal "project" to the current project itself.
  assert.deepEqual(searchArgs(query({ q: "x", scope: "project" })).slice(-3), [
    "--scope",
    "project",
    "x",
  ]);
  assert.ok(!searchArgs(query({ q: "vsa" })).includes("--scope"));
  assert.ok(!searchArgs(query({ q: "vsa" })).includes("--type"));
});

test("searchArgs: the history view asks the engine for retired facts too", () => {
  assert.ok(!searchArgs(query({ q: "vsa" })).includes("--include-deprecated"));
  assert.ok(
    searchArgs(query({ q: "vsa", history: true })).includes("--include-deprecated"),
    "history must reach the engine, not be filtered afterwards",
  );
});

test("parseChainJson: reads statuses, windows and the current revision", () => {
  const chain = parseChainJson(TIMELINE_JSON);
  assert.ok(chain);
  assert.equal(chain.length, 2);
  assert.equal(chain.hasHistory, true);
  assert.equal(chain.current, "01M4QW0BW1WWJRGPE7FZTPBBMN");
  assert.equal(chain.revisions[0].status, "deprecated");
  assert.equal(chain.revisions[0].until, "2026-10-12T10:54:47.195736+00:00");
  assert.equal(chain.revisions[1].status, "stable");
  assert.equal(chain.revisions[1].until, undefined);
  assert.equal(parseChainJson("[]"), undefined);
});

test("markInactive: retired facts are marked, active ones untouched", () => {
  const all = normalizeListFacts(LIST_JSON).map((f) => ({ ...f, deprecated: false }));
  const activeIds = new Set([all[0].id]);
  const marked = markInactive(all, activeIds);
  assert.equal(marked[0].deprecated, false);
  assert.equal(marked[1].deprecated, true);
  assert.equal(marked[1].status, "deprecated");
});

test("normalizeRecord: reads the metadata blocks of a full record", () => {
  const record = normalizeRecord(
    JSON.parse('{"id":"01X","title":"t","fact_type":"Decision"}') as never,
  );
  assert.equal(record.factType, "decision");
  assert.deepEqual(record.spai, []);
  assert.deepEqual(record.links, []);
  assert.deepEqual(record.validity, {});
  assert.equal(record.contract, undefined);
  assert.equal(record.deprecated, false, "a record without a status is active");
});

test("filterFacts: type and scope chips filter both list and search sets", () => {
  const facts = normalizeListFacts(LIST_JSON);
  assert.equal(filterFacts(facts, { type: "decision" }).length, 1);
  assert.equal(filterFacts(facts, { type: "preference" }).length, 1);
  assert.equal(filterFacts(facts, { type: "" }).length, 2);
  assert.equal(filterFacts(facts, { scope: "global" }).length, 1);
  assert.equal(filterFacts(facts, { scope: "project" }).length, 1);
  assert.equal(filterFacts(facts, { scope: "global", type: "decision" }).length, 0);
});

test("pageFacts: pages by PAGE_SIZE and reports hasMore", () => {
  const many = Array.from({ length: PAGE_SIZE + 20 }, (_v, i) => fact({ id: `id-${i}` }));
  const first = pageFacts(many, 0);
  assert.equal(first.facts.length, PAGE_SIZE);
  assert.equal(first.total, PAGE_SIZE + 20);
  assert.equal(first.hasMore, true);

  const last = pageFacts(many, PAGE_SIZE);
  assert.equal(last.facts.length, 20);
  assert.equal(last.hasMore, false);

  // A negative offset never crashes into Array.slice negative indexing.
  assert.equal(pageFacts(many, -5).facts.length, PAGE_SIZE);
});
