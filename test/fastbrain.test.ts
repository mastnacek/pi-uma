import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecallArgs, buildRecallMessage, type RecallVerdict } from "../src/slices/fastbrain/policy.ts";

test("every configured judge reaches the engine explicitly", () => {
  for (const judge of ["off", "jev", "jev-relevance"] as const) {
    const args = buildRecallArgs(judge, "why VSA?", []);
    assert.deepEqual(args.slice(0, 4), ["recall", "check", "--judge", judge]);
    assert.equal(args.at(-1), "why VSA?");
  }
});

test("recall args carry anti-echo exclusions before the prompt", () => {
  const args = buildRecallArgs("jev-relevance", "prompt", ["01A", "01B"]);
  assert.deepEqual(args.slice(-6), ["--exclude", "01A", "--exclude", "01B", "--", "prompt"]);
});

test("a prompt starting with a dash stays a positional argument", () => {
  const args = buildRecallArgs("jev", "- fix the list", []);
  assert.deepEqual(args.slice(-2), ["--", "- fix the list"]);
});

test("bilingual recall args carry alt-prompt when supplied", () => {
  const args = buildRecallArgs("jev-relevance", "how does it work?", ["01A"], "jak to funguje?");
  assert.equal(args.includes("--alt-prompt=jak to funguje?"), true);
  assert.deepEqual(args.slice(-4), ["--exclude", "01A", "--", "how does it work?"]);
});

test("an alt-prompt starting with a dash stays bound to its flag", () => {
  const args = buildRecallArgs("jev", "- fix the list", [], "- oprav ten seznam");
  assert.equal(args.includes("--alt-prompt=- oprav ten seznam"), true);
});

test("bilingual recall args omit alt-prompt when absent or blank", () => {
  const hasAlt = (args: string[]) => args.some((a) => a.startsWith("--alt-prompt"));
  assert.equal(hasAlt(buildRecallArgs("jev-relevance", "how does it work?", ["01A"])), false);
  assert.equal(hasAlt(buildRecallArgs("jev-relevance", "how does it work?", ["01A"], "   ")), false);
});

const verdict = (facts: RecallVerdict["facts"]): RecallVerdict => ({
  search: true,
  judged_by: "jev",
  fact_types: ["decision"],
  recalled: facts.length,
  facts,
  note: null,
});

const fact = {
  id: "01TEST",
  title: "Sync is git-based over the global store only",
  fact_type: "decision",
  // The CLI serializes the Scope enum in serde's external wire form.
  scope: { Project: "ai-memory" } as const,
  score: 0.9,
  snippet: "Sync is git-based…",
  tags: ["sync"],
};

test("no trigger means no injected message", () => {
  assert.equal(buildRecallMessage(verdict([]), "en"), undefined);
  assert.equal(
    buildRecallMessage({ ...verdict([fact]), search: false }, "en"),
    undefined,
  );
});

test("a trigger injects one hidden message with the facts", () => {
  const result = buildRecallMessage(verdict([fact]), "en");
  assert.ok(result);
  assert.equal(result.message?.customType, "uma-recall");
  // Hidden: display false keeps the transcript clean; the model still reads it.
  assert.equal(result.message?.display, false);
  assert.ok(String(result.message?.content).includes("Sync is git-based"));
});

test("the injected header follows the configured language", () => {
  const en = buildRecallMessage(verdict([fact]), "en");
  const cs = buildRecallMessage(verdict([fact]), "cs");
  assert.ok(String(en?.message?.content).includes("Memory relevant"));
  assert.ok(String(cs?.message?.content).includes("Paměť k tomuto úkolu"));
});

import { formatGateDecision, isDegradedNote } from "../src/slices/fastbrain/policy.ts";

test("the decision report shows ask, verdict, and next action", () => {
  const report = formatGateDecision(
    "Can we refactor the sync slice like we decided yesterday?",
    verdict([fact]),
    "en",
  );
  assert.ok(report.includes("Judge: jev"), `judge: ${report}`);
  assert.ok(report.includes('"Can we refactor the sync slice'), `prompt: ${report}`);
  assert.ok(report.includes("Trigger (decision)"), `verdict: ${report}`);
  assert.ok(report.includes("injecting 1 fact(s)"), `next: ${report}`);
});

test("a no-trigger verdict reports memory staying closed", () => {
  const report = formatGateDecision(
    "thanks, commit it",
    { ...verdict([fact]), search: false, fact_types: [], facts: [] },
    "en",
  );
  assert.ok(report.includes("No trigger"), report);
  assert.ok(report.includes("memory stays closed"), report);
});

test("a degraded judge verdict carries the warning", () => {
  const report = formatGateDecision(
    "why did we pick pnpm?",
    { ...verdict([fact]), note: "Jev unavailable (401); offline verdict" },
    "en",
  );
  assert.ok(report.includes("Jev unavailable"), report);
});

test("long prompts are elided and whitespace collapsed", () => {
  const report = formatGateDecision("word ".repeat(40), verdict([fact]), "en");
  assert.ok(report.split("\n")[0].length < 160, `header line too long: ${report}`);
  assert.ok(report.split("\n")[1].length < 160, `prompt line too long: ${report}`);
});

test("the injected facts are listed under the decision line", () => {
  const report = formatGateDecision(
    "How does the supersede chain preserve the origin?",
    verdict([fact, { ...fact, id: "01SECOND", title: "Second recalled fact" }]),
    "en",
  );
  assert.ok(report.includes("injecting 2 fact(s)"), report);
  assert.ok(report.includes("1. [decision] Sync is git-based"), report);
  assert.ok(report.includes("project:ai-memory"), report);
  assert.ok(report.includes("2. [decision] Second recalled fact"), report);
});

test("no-trigger and zero-fact verdicts list no facts", () => {
  const closed = formatGateDecision(
    "thanks",
    { ...verdict([fact]), search: false, fact_types: [], facts: [] },
    "en",
  );
  assert.ok(!closed.includes("1. [decision]"), closed);
  assert.ok(!formatGateDecision("why?", verdict([]), "en").includes("1. [decision]"));
});

test("isDegradedNote: standard model provenance is not a warning, degradation is", () => {
  assert.equal(isDegradedNote("typesafe/jev-router"), false);
  assert.equal(isDegradedNote(null), false);
  assert.equal(isDegradedNote(undefined), false);
  assert.equal(isDegradedNote("Jev unavailable (401); offline verdict"), true);
  assert.equal(isDegradedNote("timeout occurred"), true);
});

import { buildTranslateContext } from "../src/slices/translate/prompt.ts";
import { stringsFor } from "../src/shared/i18n.ts";
import { renderProposalView } from "../src/shared/modal_renderer.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

test("translate context is a real Context, not a bare array", () => {
  const ctx = buildTranslateContext("## Rule\n- use ULID 01M4DQ9C37YR0J7ZG358DQQA6F");
  // A bare message array (or a timestamp-less message) passes a cast but
  // fails the real Message contract — the bug that made translation
  // silently unavailable.
  assert.ok(Array.isArray(ctx.messages) && ctx.messages.length === 1);
  assert.ok(ctx.systemPrompt.includes("ULID"));
  assert.ok(ctx.systemPrompt.includes("#tag"));
  assert.ok(ctx.systemPrompt.includes("Translate only the prose"));
  assert.equal(ctx.messages[0].role, "user");
  assert.equal(ctx.messages[0].content, "## Rule\n- use ULID 01M4DQ9C37YR0J7ZG358DQQA6F");
  assert.ok(typeof ctx.messages[0].timestamp === "number");
});

const demoTheme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t } as any;
const longBody = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the fact body.`).join("\n");
const demoProposal = {
  title: "Full text demo",
  body: longBody,
  type: "decision",
  scope: "global",
  tags: ["demo"],
};
const s = stringsFor("cs");
const base = { proposal: demoProposal, projectName: "ai-memory", editField: null as null, editorLines: [] as string[], width: 80, theme: demoTheme, s };

test("full view renders a scroll window with a position marker", () => {
  const lines = renderProposalView({ ...base, actionIndex: 0, bodyText: demoProposal.body, fullView: { scrollOffset: 10, viewportLines: 16 } });
  const joined = lines.join("\n");
  assert.ok(joined.includes("Line 11 "), `scroll window starts at offset: ${joined}`);
  assert.ok(joined.includes("Line 26"), "window covers offset+16");
  assert.ok(!joined.includes("Line 31"), "window does not run past the body");
  assert.ok(joined.includes("[11–26/30]"), `position marker: ${joined}`);
  assert.ok(lines.every((l) => visibleWidth(l) <= 80));
});

test("preview shows the translation note without touching the title", () => {
  const lines = renderProposalView({ ...base, actionIndex: 0, bodyText: "Přeložený text.", bodyNote: s.translatedNote });
  assert.ok(lines.join("\n").includes("ukládá se ORIGINÁL"));
  assert.ok(lines.join("\n").includes("Full text demo"));
  assert.ok(lines.join("\n").includes("Přeložený text."));
});

test("preview caps at 8 lines and points to [v]", () => {
  const lines = renderProposalView({ ...base, actionIndex: 0, bodyText: demoProposal.body });
  const joined = lines.join("\n");
  assert.ok(joined.includes("+22 řádků"));
  assert.ok(joined.includes("[v] 📜"));
  assert.ok(!joined.includes("Line 9 "), "preview stops at 8 lines");
});

import {
  formatGateOneLiner,
  splitMatchMarkers,
  stripMatchMarkers,
} from "../src/slices/fastbrain/policy.ts";

test("stripMatchMarkers removes engine highlight markers", () => {
  assert.equal(stripMatchMarkers("a [match]hit[/match] b"), "a hit b");
  assert.equal(stripMatchMarkers("no markers"), "no markers");
  assert.equal(stripMatchMarkers("[match]x[/match][match]y[/match]"), "xy");
});

test("splitMatchMarkers segments highlighted and plain spans", () => {
  assert.deepEqual(splitMatchMarkers("a [match]hit[/match] b"), [
    { text: "a ", match: false },
    { text: "hit", match: true },
    { text: " b", match: false },
  ]);
  assert.deepEqual(splitMatchMarkers("plain"), [{ text: "plain", match: false }]);
});

test("the injected LLM message never carries raw match markers", () => {
  const marked = { ...fact, snippet: "…[match]sync[/match] is git-based…" };
  const result = buildRecallMessage(verdict([marked]), "en");
  assert.ok(result);
  assert.ok(!String(result.message?.content).includes("[match]"));
  assert.ok(String(result.message?.content).includes("sync is git-based"));
});

test("the decision report never shows raw match markers", () => {
  const marked = { ...fact, snippet: "[match]sync[/match] everywhere" };
  const report = formatGateDecision("q", verdict([marked]), "en");
  assert.ok(!report.includes("[match]"), report);
  assert.ok(report.includes("sync everywhere"), report);
});

test("formatGateOneLiner summarizes each verdict shape", () => {
  assert.equal(formatGateOneLiner({ ...verdict([]), search: false }, "en"), "🧠 jev ○ no trigger");
  assert.equal(formatGateOneLiner(verdict([fact]), "en"), "🧠 jev ● trigger → 1 fact(s)");
  assert.equal(formatGateOneLiner(verdict([]), "cs"), "🧠 jev ◐ trigger, nic nenalezeno");
  assert.equal(formatGateOneLiner(verdict([fact, fact, fact]), "cs"), "🧠 jev ● trigger → 3 fakta");
});

test("anti-echo: facts already injected this session are filtered out", () => {
  const second = { ...fact, id: "01SECOND", title: "Second fact", snippet: "Distinct second snippet…" };
  const result = buildRecallMessage(verdict([fact, second]), "en", new Set([fact.id]));
  assert.ok(result);
  const content = String(result.message?.content);
  assert.ok(content.includes("Second fact"));
  assert.ok(content.includes("Distinct second snippet"));
  assert.ok(!content.includes("Sync is git-based"), content);
  assert.equal(result.message?.details.count, 1);
  assert.deepEqual(result.message?.details.ids, ["01SECOND"]);
});

test("anti-echo: a verdict whose facts are all already injected injects nothing", () => {
  assert.equal(buildRecallMessage(verdict([fact]), "en", new Set([fact.id])), undefined);
});

test("anti-echo: without an exclusion set the message carries the injected ids", () => {
  const result = buildRecallMessage(verdict([fact]), "en");
  assert.deepEqual(result?.message?.details.ids, [fact.id]);
});

test("anti-echo backfill: the budget fills with the next-best new facts in rank order", () => {
  const six = ["a", "b", "c", "d", "e", "f"].map((n, i) => ({
    ...fact,
    id: `01${n.toUpperCase()}`,
    title: `Fact ${n}`,
    snippet: `Snippet ${n}…`,
    score: 1 - i * 0.1,
  }));
  // a and b are already in context; the budget (3) fills with c, d, e —
  // the next-best NEW facts in rank order, never the injected a/b.
  const result = buildRecallMessage(verdict(six), "en", new Set(["01A", "01B"]));
  assert.ok(result);
  assert.deepEqual(result.message?.details.ids, ["01C", "01D", "01E"]);
  const content = String(result.message?.content);
  assert.ok(content.includes("Fact c") && content.includes("Fact e"));
  assert.ok(!content.includes("Fact a") && !content.includes("Fact b") && !content.includes("Fact f"));
});
