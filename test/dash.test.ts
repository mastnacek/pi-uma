/**
 * /uma dash slice tests — the rendering half (Proposal 10 §10).
 *
 * fragments.ts is pure string-in/string-out: escaping, marker stripping,
 * markdown-lite, cards (including the per-card display-translation control)
 * and detail. The HTTP server is deliberately not exercised here; the CLI
 * adapter half lives in dash_data.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeHtml,
  excerptOf,
  factsPath,
  renderBodyHtml,
  renderCard,
  renderDegradedNote,
  renderError,
  renderFacts,
  renderStats,
  renderTranslatedCard,
  stripMatchMarkers,
} from "../src/slices/dash/fragments.ts";
import { PAGE_SIZE } from "../src/slices/dash/data.ts";
import { fact, query } from "./dash_fixtures.ts";

// ── escaping boundary ─────────────────────────────────────────────────────

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

test("renderCard: injected HTML stays inert in the hidden translate fields", () => {
  const html = renderCard(fact({ title: '<script>alert("x")</script>', body: '"><img src=x>' }));
  assert.ok(!/<script/i.test(html));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('value="><img'));
});

// ── cards ─────────────────────────────────────────────────────────────────

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

test("excerptOf: snippet wins, body is flattened and truncated", () => {
  assert.equal(excerptOf(fact({ snippet: "x [match]VSA[/match] y" })), "x VSA y");
  const long = excerptOf(fact({ body: `## T\n\n${"word ".repeat(80)}` }), 20);
  assert.ok(long.length <= 21, `excerpt length ${long.length}`);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.includes("#"));
  assert.equal(excerptOf(fact({ body: "short" })), "short");
  assert.equal(excerptOf(fact()), "");
});

// ── per-card display translation ──────────────────────────────────────────

test("renderCard: carries the per-card translate control", () => {
  const html = renderCard(fact({ title: "T", body: "B" }));
  assert.ok(html.includes('class="card-wrap"'));
  assert.ok(html.includes('hx-post="/frag/translate"'));
  assert.ok(html.includes('hx-include="closest .card-wrap"'));
  assert.ok(html.includes('hx-trigger="change"'));
  // Present only while checked: the server answers an uncheck with an empty
  // body and no model call.
  assert.ok(html.includes('name="checked"'));
  assert.ok(html.includes('for="lang-01TESTFACT000000000000000"'));
  assert.ok(html.includes('id="trans-01TESTFACT000000000000000"'));
  assert.ok(html.includes('role="button"'));
  // The displayed text travels with the request: the translation is of exactly
  // what is on screen.
  assert.ok(html.includes('name="title" value="T"'));
  assert.ok(html.includes('name="excerpt" value="B"'));
});

test("renderCard: the translate control is a sibling, never nested in the card", () => {
  const html = renderCard(fact());
  const label = html.indexOf('class="lang-toggle"');
  const card = html.indexOf('class="card"');
  assert.ok(label > -1 && card > -1 && label < card, "label must precede the card div");
  // A nested interactive control would be invalid HTML — no <button> wrapper.
  assert.ok(!html.includes("<button"));
});

test("renderTranslatedCard: success note, and failure keeps the original text", () => {
  const ok = renderTranslatedCard("Title", "Excerpt", { title: "Titulek", excerpt: "Výňatek" });
  assert.ok(ok.includes("Titulek"));
  assert.ok(ok.includes("Výňatek"));
  assert.ok(ok.includes("stored text unchanged"));

  const failed = renderTranslatedCard("<b>Title</b>", "Excerpt", { error: "no active model" });
  assert.ok(failed.includes("translation unavailable"));
  assert.ok(failed.includes("no active model"));
  assert.ok(failed.includes("&lt;b&gt;Title&lt;/b&gt;"));
  assert.ok(!failed.includes("<b>Title</b>"));
});

// ── body rendering ────────────────────────────────────────────────────────

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

// ── list, detail, stats, errors ───────────────────────────────────────────

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

test("renderFacts: a degraded mode shows a banner above the cards", () => {
  const html = renderFacts(
    {
      facts: [fact()],
      hasMore: false,
      total: 1,
      note: "Hybrid search degraded to Keyword: no embeddings are stored.",
    },
    query(),
  );
  assert.ok(html.includes('class="degraded"'));
  assert.ok(html.includes("no embeddings are stored"));
  assert.ok(
    html.indexOf('class="degraded"') < html.indexOf('class="card-wrap"'),
    "banner must come before the cards",
  );

  const healthy = renderFacts({ facts: [fact()], hasMore: false, total: 1 }, query());
  assert.ok(!healthy.includes("degraded"));
  assert.ok(renderDegradedNote("<b>x</b>").includes("&lt;b&gt;"));
});

test("renderStats: totals by type and scope", () => {
  const html = renderStats({
    total: 3,
    inactive: 0,
    byType: { decision: 2, note: 1 },
    byScope: { "project:pi-uma": 2, global: 1 },
  });
  assert.ok(html.includes("<strong>3</strong> facts"));
  assert.ok(html.includes("2 decision"));
  assert.ok(html.includes("1 🌐 global"));
  assert.ok(html.includes("📁 project:pi-uma"));
  // A healthy store advertises no inactive count and no drafts button.
  assert.ok(!html.includes("inactive"));
  assert.ok(!html.includes("drafts"));
});

test("renderStats: inactive facts and the draft queue are surfaced", () => {
  const html = renderStats(
    {
      total: 10,
      inactive: 4,
      byType: { decision: 2 },
      byScope: { global: 2 },
    },
    3,
  );
  assert.ok(html.includes("4 inactive"));
  assert.ok(html.includes("📥 3 drafts"));
  assert.ok(html.includes('hx-get="/frag/drafts"'));

  const one = renderStats({ total: 1, inactive: 0, byType: {}, byScope: {} }, 1);
  assert.ok(one.includes("1 draft"), "singular must stay singular");
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
