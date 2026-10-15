/**
 * /uma dash tests — pending drafts as list elements (Proposal 10 §13 delta).
 *
 * Drafts are not facts: they live in `.uma/.staging/*.json` and are only
 * reachable through `uma staging`. In the dashboard they are ordinary elements
 * of the same list — same pane, same chips, same keys, same 🌐 CS translation —
 * and read-only: promotion stays in the TUI modal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanWarning,
  filterDrafts,
  normalizeDraft,
  normalizeDrafts,
} from "../src/slices/dash/drafts.ts";
import {
  renderDraftBody,
  renderDraftCard,
  renderDraftDetail,
} from "../src/slices/dash/draft_fragments.ts";
import { renderList } from "../src/slices/dash/listing.ts";
import { DRAFTS_JSON, draftsFixture, fact, query } from "./dash_fixtures.ts";

test("normalizeDrafts: parses the recorded staging payload with provenance", () => {
  const drafts = normalizeDrafts(DRAFTS_JSON);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].id, "01M4Z77HCC4J3FBBFS3S4YFZMS");
  assert.equal(drafts[0].trigger, "spai_done");
  assert.equal(drafts[0].confidence, 0.7);
  assert.equal(drafts[0].proposed.factType, "note");
  assert.deepEqual(drafts[0].proposed.spai, ["SPAI-042"]);
  assert.equal(drafts[0].proposed.scope, "project:pi-uma");
  // A draft has not been verified by anyone yet.
  assert.deepEqual(drafts[0].proposed.verified, []);

  const muscle = drafts[1];
  assert.equal(muscle.trigger, "muscle_synthesis");
  assert.equal(muscle.sessionId, "session-abc");
  assert.equal(muscle.proposed.factType, "skill");
  assert.equal(muscle.proposed.template, '[{"command":"ls","args":["-la"]}]');
});

test("normalizeDrafts: rejects non-array payloads instead of guessing", () => {
  assert.throws(() => normalizeDrafts('{"drafts":[]}'));
  assert.throws(() => normalizeDrafts("not json"));
});

test("normalizeDraft: a draft missing its fact degrades to an empty record", () => {
  const draft = normalizeDraft({ id: "01X", confidence: 0.5 });
  assert.equal(draft.id, "01X");
  assert.equal(draft.trigger, "unknown");
  assert.equal(draft.proposed.title, "");
  assert.equal(draft.proposed.factType, "note");
});

test("cleanWarning: keeps the engine's reason, drops the marker", () => {
  assert.equal(
    cleanWarning("! 21 staging file(s) could not be read (first: x.json: missing field)\n"),
    "21 staging file(s) could not be read (first: x.json: missing field)",
  );
  assert.equal(cleanWarning(""), undefined);
  assert.equal(cleanWarning("   \n  "), undefined);
});

test("filterDrafts: the same chips that filter facts filter the queue", () => {
  const drafts = draftsFixture();
  assert.equal(filterDrafts(drafts, {}).length, 2);
  // type matches the PROPOSED record's type
  assert.equal(filterDrafts(drafts, { type: "skill" }).length, 1);
  assert.equal(filterDrafts(drafts, { type: "note" }).length, 1);
  assert.equal(filterDrafts(drafts, { type: "decision" }).length, 0);
  // scope
  assert.equal(filterDrafts(drafts, { scope: "project" }).length, 2);
  assert.equal(filterDrafts(drafts, { scope: "global" }).length, 0);
  // search text: title, body, tags and trigger all match
  assert.equal(filterDrafts(drafts, { q: "muscle" }).length, 1);
  assert.equal(filterDrafts(drafts, { q: "SPAI-042" }).length, 1);
  assert.equal(filterDrafts(drafts, { q: "list the directory" }).length, 1);
  assert.equal(filterDrafts(drafts, { q: "nothing here" }).length, 0);
  // filters combine
  assert.equal(filterDrafts(drafts, { q: "muscle", type: "note" }).length, 0);
});

test("renderDraftCard: says what it is, how sure, and where it came from", () => {
  const html = renderDraftCard(draftsFixture()[0]);
  assert.ok(html.includes(">NOTE<"));
  assert.ok(html.includes("draft · 70%"));
  assert.ok(html.includes("spai_done"));
  assert.ok(html.includes('hx-get="/frag/draft/01M4Z77HCC4J3FBBFS3S4YFZMS"'));
  assert.ok(html.includes("SPAI-042"));
  // Read-only: no promote/discard control anywhere.
  assert.ok(!/approve|discard/i.test(html));
});

test("renderDraftCard: carries the same 🌐 CS translation control as a fact", () => {
  const html = renderDraftCard(draftsFixture()[1]);
  assert.ok(html.includes('class="lang-cb"'));
  assert.ok(html.includes('name="checked"'));
  assert.ok(html.includes('hx-post="/frag/translate"'));
  assert.ok(html.includes('hx-target="#trans-01M4RMTNN90RWZQF5XWXFDPTKB"'));
  assert.ok(html.includes('id="trans-01M4RMTNN90RWZQF5XWXFDPTKB"'));
  assert.ok(html.includes('for="lang-01M4RMTNN90RWZQF5XWXFDPTKB"'));
  // The displayed text travels with the request.
  assert.ok(html.includes('name="title" value="muscle:ls--la-cd"'));
  assert.ok(html.includes('name="excerpt" value="1. list the directory"'));
});

test("renderDraftCard: injected HTML in a title stays inert", () => {
  const drafts = draftsFixture();
  const html = renderDraftCard({
    ...drafts[0],
    proposed: { ...drafts[0].proposed, title: "<script>alert(1)</script>" },
  });
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderList: drafts are elements of the list, above the stored facts", () => {
  const html = renderList(
    { facts: [fact({ title: "Stored fact" })], hasMore: false, total: 1 },
    query(),
    { drafts: draftsFixture(), total: 2 },
  );
  assert.ok(html.includes("📥 pending review"), "the queue has a section, not a button");
  assert.ok(html.includes("· 2<"), "the queue count is shown");
  assert.ok(html.includes("📚 stored facts"));
  assert.ok(html.includes("draft · 70%"));
  assert.ok(html.includes("Stored fact"));
  // Order: drafts first, facts after.
  assert.ok(html.indexOf("pending review") < html.indexOf("stored facts"));
  // No separate view affordance anywhere.
  assert.ok(!html.includes('hx-get="/frag/drafts"'));
  assert.ok(!/approve|discard/i.test(html));
});

test("renderList: filtered queues report 'N of M' without hiding the store", () => {
  const html = renderList(
    { facts: [fact()], hasMore: false, total: 1 },
    query({ q: "muscle" }),
    { drafts: [draftsFixture()[1]], total: 23 },
  );
  assert.ok(html.includes("1 of 23"));
  assert.ok(html.includes("stored facts"));
});

test("renderList: an empty store explains itself, with and without drafts", () => {
  const empty = renderList({ facts: [], hasMore: false, total: 0 }, query(), {
    drafts: [],
    total: 0,
  });
  assert.ok(empty.includes("nothing matches"));

  const draftsOnly = renderList({ facts: [], hasMore: false, total: 0 }, query(), {
    drafts: draftsFixture(),
    total: 2,
  });
  assert.ok(draftsOnly.includes("no stored facts match"));
  assert.ok(draftsOnly.includes("only the drafts above"));
});

test("renderList: both degradation banners sit on top of the pane", () => {
  const html = renderList(
    { facts: [fact()], hasMore: false, total: 1, note: "Hybrid search degraded to Keyword." },
    query(),
    { drafts: draftsFixture(), total: 2, warning: "1 staging file(s) could not be read" },
  );
  assert.ok(html.includes("Hybrid search degraded to Keyword."));
  assert.ok(html.includes("1 staging file(s) could not be read"));
  assert.ok(html.indexOf("degraded") < html.indexOf("pending review"));
  assert.ok(html.indexOf("could not be read") < html.indexOf("📥"));
});

test("renderDraftDetail: marks the draft as not stored and points at the TUI", () => {
  const draft = draftsFixture()[1];
  const html = renderDraftDetail(draft, renderDraftBody(draft));
  assert.ok(html.includes("DRAFT · not stored yet"));
  assert.ok(html.includes("confidence 80%"));
  assert.ok(html.includes("trigger muscle_synthesis"));
  assert.ok(html.includes("session-abc"));
  assert.ok(html.includes("Read-only view"));
  assert.ok(html.includes("/uma review"));
  assert.ok(html.includes("list the directory"), "the proposed body is rendered");
  assert.ok(!/<button[^>]*>(approve|discard)/i.test(html));
});
