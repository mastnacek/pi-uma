import assert from "node:assert/strict";
import { test } from "node:test";
import { matchRule, type RuleL1 } from "../src/slices/immune/index.ts";
import {
  buildRecommendationContext,
  formatRecommendation,
  parseRecommendation,
} from "../src/slices/immune/recommendation.ts";
import { summarizeImmuneDecisions } from "../src/shared/decision_log.ts";

const rule: RuleL1 = {
  id: "01TEST",
  title: "SPAI and UMA keep separate stores",
  fact_type: "decision",
  body: "Never index SPAI items as memory facts; the stores stay separate and connect only through structural identifiers and the read-only source adapter.",
};

const OTHER: RuleL1 = {
  id: "01OTHER",
  title: "Contract rules are deterministic",
  fact_type: "pattern",
  body: "Auto-blocking is reserved for deterministic contract-backed rules; probabilistic verdicts may only warn.",
};

test("matchRule: an edit about SPAI/UMA separation matches the separation rule", () => {
  const added = "Append the SPAI backlog items into the UMA store so facts and tasks share one index.";
  assert.equal(matchRule([OTHER, rule], added)?.id, "01TEST");
});

test("matchRule: unrelated edit matches nothing", () => {
  assert.equal(matchRule([rule], "Change the sidebar padding and green button color."), undefined);
});

test("matchRule: tiny edits are below the edit-token floor", () => {
  assert.equal(matchRule([rule], "SPAI store"), undefined);
});

test("parseRecommendation: strict JSON parses with clamped confidence", () => {
  const rec = parseRecommendation('{"relation":"unrelated","confidence":1.7,"reason":"Scope only."}');
  assert.ok(rec);
  assert.equal(rec.relation, "unrelated");
  assert.equal(rec.confidence, 1);
  assert.equal(rec.reason, "Scope only.");
});

test("parseRecommendation: tolerates a fenced or chatty reply", () => {
  const rec = parseRecommendation('Sure! ```json\n{"relation":"violates","confidence":0.8,"reason":"R"}\n```');
  assert.ok(rec);
  assert.equal(rec.relation, "violates");
});

test("parseRecommendation: garbage yields undefined (dialog without recommendation)", () => {
  assert.equal(parseRecommendation(""), undefined);
  assert.equal(parseRecommendation("no json here"), undefined);
  assert.equal(parseRecommendation('{"relation":"maybe","confidence":0.5}'), undefined);
});

test("formatRecommendation: localized verdict lines for every relation", () => {
  const rec = { relation: "unrelated" as const, confidence: 0.87, reason: "Jen slovní zásoba." };
  assert.equal(
    formatRecommendation(rec, "cs"),
    "🧠 Jev: nesouvisí s jádrem pravidla (87 %) — doporučuji Ano\n  „Jen slovní zásoba.“",
  );
  assert.ok(formatRecommendation({ ...rec, relation: "violates" }, "en").includes("recommending No"));
  assert.ok(formatRecommendation({ ...rec, relation: "touches" }, "cs").includes("přečti si pravidlo"));
});

test("buildRecommendationContext: strict-JSON system prompt and language instruction", () => {
  const ctx = buildRecommendationContext(rule, "some added text", "cs");
  assert.ok(ctx.systemPrompt.includes('"relation":"violates"|"touches"|"unrelated"'));
  assert.ok(ctx.systemPrompt.includes("Czech"));
  assert.ok(ctx.userText.includes(`MEMORY RULE "${rule.title}"`));
  assert.ok(ctx.userText.includes("some added text"));
});

test("buildRecommendationContext: truncates oversized bodies and edits", () => {
  const bigRule = { ...rule, body: "x".repeat(5000) };
  const ctx = buildRecommendationContext(bigRule, "y".repeat(9000), "en");
  assert.ok(ctx.userText.length < 13000);
  assert.ok(ctx.userText.endsWith("…"));
});

test("summarizeImmuneDecisions: aggregates agreement and skips corrupt lines", () => {
  const jsonl = [
    JSON.stringify({ ts: "t1", relation: "unrelated", confidence: 0.9, approved: true }),
    JSON.stringify({ ts: "t2", relation: "unrelated", confidence: 0.8, approved: true }),
    JSON.stringify({ ts: "t3", relation: "violates", confidence: 0.9, approved: false }),
    JSON.stringify({ ts: "t4", approved: true }), // no recommendation (degraded)
    "not json",
    "",
  ].join("\n");
  const s = summarizeImmuneDecisions(jsonl);
  assert.equal(s.total, 4);
  assert.equal(s.yesRecommended, 2);
  assert.equal(s.yesApproved, 2);
  assert.equal(s.noRecommended, 1);
  assert.equal(s.noBlocked, 1);
});

test("summarizeImmuneDecisions: empty log is a zero summary", () => {
  const s = summarizeImmuneDecisions("");
  assert.equal(s.total, 0);
  assert.equal(s.yesRecommended, 0);
});
