/**
 * /uma dash slice tests (Proposal 10 §10).
 *
 * Pure parts only: fragments.ts is string-in/string-out and data.ts's
 * normalize/filter/page helpers run against recorded CLI fixtures. The HTTP
 * server is deliberately not exercised here — it stays thin enough that the
 * logic carrying the behaviour lives in these functions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeHtml,
  factsPath,
  renderBodyHtml,
  renderCard,
  renderDetail,
  renderError,
  renderFacts,
  renderStats,
  stripMatchMarkers,
} from "../src/slices/dash/fragments.ts";
import {
  PAGE_SIZE,
  filterFacts,
  normalizeListFacts,
  normalizeScope,
  normalizeSearchHits,
  pageFacts,
  type DashFact,
  type DashQuery,
} from "../src/slices/dash/data.ts";

/** Recorded `uma list --json` shape (two facts, project + global scope). */
const LIST_JSON = `[
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
const SEARCH_JSON = `{
  "degraded": false,
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

function fact(over: Partial<DashFact> = {}): DashFact {
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

function query(over: Partial<DashQuery> = {}): DashQuery {
  return { q: "", type: "", scope: "", offset: 0, ...over };
}

// ── data.ts: normalization ────────────────────────────────────────────────

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

test("data.ts: unparseable engine output is a controlled error, never a crash", () => {
  assert.throws(() => normalizeListFacts("not json at all"));
  assert.throws(() => normalizeListFacts('{"not":"an array"}'));
  assert.throws(() => normalizeSearchHits('{"degraded":false}'));
  assert.throws(() => normalizeSearchHits("[1,2,3]"));
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

// ── fragments.ts: the escaping boundary ───────────────────────────────────

test("escapeHtml: neutralizes every HTML-significant character", () => {
  const escaped = escapeHtml('<script>alert("x") & \'y\'</script>');
  assert.ok(!escaped.includes("<script>"));
  assert.ok(escaped.includes("&lt;script&gt;"));
  assert.ok(escaped.includes("&amp;"));
  assert.ok(escaped.includes("&quot;"));
  assert.ok(escaped.includes("&#39;"));
});

test("renderCard: injected HTML in a title renders inert", () => {
  const html = renderCard(fact({ title: '<script>alert("pwned")</script>' }));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderCard: badge, scope icon, weight and tags are rendered", () => {
  const html = renderCard(
    fact({ factType: "decision", scope: "project:pi-uma", tags: ["vsa"], weight: 1 }),
  );
  assert.ok(html.includes(">DECISION<"));
  assert.ok(html.includes("📁 project:pi-uma"));
  assert.ok(html.includes("w 1.0"));
  assert.ok(html.includes("#vsa"));
  assert.ok(html.includes('hx-get="/frag/fact/01TESTFACT000000000000000"'));

  const globalHtml = renderCard(fact({ scope: "global" }));
  assert.ok(globalHtml.includes("🌐 global"));
});

test("renderCard: deprecated facts are dimmed and marked", () => {
  const html = renderCard(fact({ deprecated: true, status: "deprecated" }));
  assert.ok(html.includes('class="card deprecated"'));
  assert.ok(html.includes("· deprecated"));
});

test("stripMatchMarkers + renderCard: no [match] markers reach the browser", () => {
  assert.equal(stripMatchMarkers("a [match]b[/match] c"), "a b c");
  const html = renderCard(fact({ snippet: "x [match]VSA[/match] y" }));
  assert.ok(!html.includes("[match]"));
  assert.ok(!html.includes("[/match]"));
  assert.ok(html.includes("VSA"));
});

test("renderBodyHtml: markdown-lite on escaped input", () => {
  const html = renderBodyHtml("### Heading\n\n**bold** and `code`\n\n- one\n- two");
  assert.ok(html.includes("<h4>Heading</h4>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("<li>one</li>"));
  assert.equal((html.match(/<ul>/g) ?? []).length, 1);
});

test("renderBodyHtml: HTML in a body is inert, formatting still applies", () => {
  const html = renderBodyHtml('<img src=x onerror=alert(1)>\n\n**safe**');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("<strong>safe</strong>"));
});

test("renderFacts: empty page, sentinel and terminal page", () => {
  const empty = renderFacts({ facts: [], hasMore: false, total: 0 }, query());
  assert.ok(empty.includes("no facts"));

  const page = renderFacts(
    {
      facts: [fact()],
      hasMore: true,
      total: PAGE_SIZE + 5,
    },
    query({ q: "vsa", type: "decision" }),
  );
  assert.ok(page.includes('hx-trigger="revealed"'));
  assert.ok(page.includes(`offset=${PAGE_SIZE}`));
  assert.ok(page.includes("q=vsa"));
  assert.ok(page.includes("type=decision"));

  const terminal = renderFacts({ facts: [fact()], hasMore: false, total: 1 }, query());
  assert.ok(!terminal.includes("revealed"));
});

test("renderDetail: full view carries metadata and rendered body", () => {
  const html = renderDetail(
    fact({
      factType: "pattern",
      scope: "project:pi-uma",
      tags: ["a"],
      weight: 0.75,
      body: "### X\n\n**y**",
    }),
  );
  assert.ok(html.includes("PATTERN"));
  assert.ok(html.includes("project:pi-uma"));
  assert.ok(html.includes("weight 0.75"));
  assert.ok(html.includes("#a"));
  assert.ok(html.includes("<h4>X</h4>"));
});

test("renderStats: totals by type and scope", () => {
  const html = renderStats({
    total: 3,
    byType: { decision: 2, note: 1 },
    byScope: { "project:pi-uma": 2, global: 1 },
  });
  assert.ok(html.includes("<strong>3</strong> facts"));
  assert.ok(html.includes("2 decision"));
  assert.ok(html.includes("1 🌐 global"));
  assert.ok(html.includes("📁 project:pi-uma"));
});

test("renderError: escapes and bounds the message", () => {
  const html = renderError('<b>boom</b>\nline2\nline3\nline4');
  assert.ok(html.includes("&lt;b&gt;boom&lt;/b&gt;"));
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes("line4"));
});

test("factsPath: encodes query params and honours the offset override", () => {
  const path = factsPath(query({ q: "a b&c", type: "decision", scope: "global" }), 50);
  assert.ok(path.startsWith("/frag/facts?"));
  assert.ok(path.includes("q=a+b%26c"));
  assert.ok(path.includes("offset=50"));
  assert.equal(factsPath(query()), "/frag/facts?offset=0");
});
