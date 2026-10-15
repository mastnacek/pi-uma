/**
 * /uma dash tests — the staged-drafts view (Proposal 10 §13 delta).
 *
 * Drafts are not facts: they live in `.uma/.staging/*.json` and are only
 * reachable through `uma staging`. The dashboard shows them read-only — a
 * browser that could promote a draft would move consent out of the TUI modal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanWarning,
  normalizeDraft,
  normalizeDrafts,
} from "../src/slices/dash/drafts.ts";
import {
  renderDraftBody,
  renderDraftCard,
  renderDraftDetail,
  renderDrafts,
} from "../src/slices/dash/draft_fragments.ts";
import { DRAFTS_JSON, draftsFixture } from "./dash_fixtures.ts";

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

test("renderDraftCard: injected HTML in a title stays inert", () => {
  const drafts = draftsFixture();
  const html = renderDraftCard({
    ...drafts[0],
    proposed: { ...drafts[0].proposed, title: "<script>alert(1)</script>" },
  });
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderDrafts: empty state explains the queue and offers the way back", () => {
  const html = renderDrafts({ drafts: [] });
  assert.ok(html.includes("no staged drafts"));
  assert.ok(html.includes("← back to facts"));
  assert.ok(!/approve|discard/i.test(html));
});

test("renderDrafts: an unreadable-draft warning is shown, not swallowed", () => {
  const html = renderDrafts({
    drafts: draftsFixture(),
    warning: "21 staging file(s) could not be read (first: x.json: missing field `spai`)",
  });
  assert.ok(html.includes('class="degraded"'));
  assert.ok(html.includes("21 staging file(s) could not be read"));
  assert.ok(html.includes("draft · 70%") && html.includes("draft · 80%"));
  assert.ok(html.includes("← back to facts"));
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
