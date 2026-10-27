#!/usr/bin/env node
// Recall scenario runner: replays real prompts against the operator's real
// memory, from inside each real project, and scores what the recall gate
// would inject. It measures, it does not mock: a failing case is either a
// recall defect or a data defect, and the report says which it looks like.
//
// Usage: node test/recall-scenarios/run.mjs [--judge jev|off|always] [--repeat N]
//        [--lang en|cs] [--max 3] [--only PREFIX] [--uma PATH] [--json OUT]
//
// Read-only: `uma recall check` never mutates the store (no plasticity writes).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const spec = JSON.parse(readFileSync(join(here, "scenarios.json"), "utf8"));

function parseArgs(argv) {
  const opts = { judge: "jev", repeat: 1, lang: "en", max: 3, only: "", uma: "", json: "" };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key in opts) opts[key] = typeof opts[key] === "number" ? Number(argv[++i]) : argv[++i];
  }
  return opts;
}

function findUma(explicit) {
  if (explicit) return explicit;
  const exe = process.platform === "win32" ? "uma.exe" : "uma";
  for (const candidate of [join(repo, "core", "target", "release", exe), join(repo, "bin", exe)]) {
    if (existsSync(candidate)) return candidate;
  }
  return exe;
}

const matches = (fact, exp) =>
  (exp.id && fact.id === exp.id) || (exp.title && String(fact.title).includes(exp.title));

function expandGroups(names) {
  return names.flatMap((name) => {
    const group = spec.groups[name];
    if (!group) throw new Error(`unknown group ${name}`);
    return group.map((exp) => ({ ...exp, group: name }));
  });
}

function recall(uma, cwd, prompt, opts) {
  const args = ["recall", "check", "--judge", opts.judge, "--json", "--max", String(opts.max), prompt];
  const run = spawnSync(uma, args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (run.status !== 0) return { error: (run.stderr || run.error?.message || "failed").split("\n")[0] };
  try {
    return JSON.parse(run.stdout);
  } catch {
    return { error: "unparseable output" };
  }
}

/** Scores one run of one case. Returns { pass, reason, facts, stale } */
function score(c, verdict) {
  if (verdict.error) return { pass: false, reason: `engine: ${verdict.error}`, facts: [] };
  const facts = verdict.facts ?? [];
  const forbidden = expandGroups([...(spec.always_forbidden ?? []), ...(c.must_exclude ?? [])]);
  const labelled = facts.map((f) => {
    const bad = forbidden.find((exp) => matches(f, exp));
    const good = (c.must_include ?? []).find((exp) => matches(f, exp));
    const primed = String(f.snippet ?? "").startsWith("[primed");
    return { ...f, primed, label: bad ? `FORBIDDEN:${bad.group}` : good ? "expected" : primed ? "extra(primed)" : "extra" };
  });
  const stale = (c.must_include ?? [])
    .filter((exp) => exp.id && facts.some((f) => f.id !== exp.id && matches(f, { title: exp.title })))
    .map((exp) => exp.id);

  const leaked = labelled.filter((f) => f.label.startsWith("FORBIDDEN"));
  if (leaked.length) return { pass: false, reason: `forbidden: ${leaked.map((f) => f.label).join(", ")}`, facts: labelled, stale };
  if (c.expect_empty && facts.length) return { pass: false, reason: `expected nothing, got ${facts.length}`, facts: labelled, stale };
  const missing = (c.must_include ?? []).filter((exp) => !facts.some((f) => matches(f, exp)));
  if (missing.length) {
    const why = verdict.search ? "searched but not found" : "judge did not search";
    return { pass: false, reason: `missing (${why})`, facts: labelled, stale };
  }
  return { pass: true, reason: "", facts: labelled, stale };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const uma = findUma(opts.uma);
  const root = process.env[spec.projects_root_env] || spec.projects_root_default;
  const cases = spec.cases.filter((c) => !opts.only || c.id.startsWith(opts.only));
  const report = [];

  for (const c of cases) {
    const cwd = join(root, spec.projects[c.project]);
    if (!existsSync(cwd)) {
      report.push({ id: c.id, kind: c.kind, skipped: `missing project ${cwd}` });
      continue;
    }
    const prompt = opts.lang === "cs" ? c.prompt_cs : c.prompt;
    const runs = [];
    for (let i = 0; i < opts.repeat; i++) runs.push(score(c, recall(uma, cwd, prompt, opts)));
    report.push({ id: c.id, kind: c.kind, project: c.project, prompt, why: c.why, runs });
  }

  // Human report: one line per case, then the facts of the first failing run.
  let failed = 0;
  for (const r of report) {
    if (r.skipped) {
      console.log(`SKIP ${r.id}  ${r.skipped}`);
      continue;
    }
    const passes = r.runs.filter((x) => x.pass).length;
    const ok = passes === r.runs.length;
    if (!ok) failed++;
    const rate = r.runs.length > 1 ? ` (${passes}/${r.runs.length})` : "";
    const first = r.runs.find((x) => !x.pass) ?? r.runs[0];
    console.log(`${ok ? "PASS" : "FAIL"} ${r.id.padEnd(8)} ${r.kind.padEnd(8)} [${r.project}]${rate} ${ok ? "" : first.reason}`);
    if (!ok || first.stale?.length) {
      for (const f of first.facts) console.log(`       ${f.label.padEnd(30)} ${Number(f.score).toFixed(1).padStart(5)}  ${f.title}`);
      if (first.stale?.length) console.log(`       stale expectation ids: ${first.stale.join(", ")}`);
    }
  }

  // Aggregate metrics: what the operator actually feels.
  const allRuns = report.filter((r) => !r.skipped).flatMap((r) => r.runs.map((x) => ({ ...x, kind: r.kind })));
  const injected = allRuns.flatMap((x) => x.facts);
  const hitRuns = allRuns.filter((x) => x.kind === "hit");
  const negRuns = allRuns.filter((x) => x.kind === "negative");
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  console.log("\n— summary —");
  console.log(`cases ${report.length}, failed ${failed}, judge ${opts.judge}, lang ${opts.lang}, repeat ${opts.repeat}`);
  console.log(`hit rate (expected fact recalled):    ${pct(hitRuns.filter((x) => x.pass).length, hitRuns.length)}`);
  console.log(`precision (injected that were expected): ${pct(injected.filter((f) => f.label === "expected").length, injected.length)}  (${injected.length} injected)`);
  console.log(`negatives kept empty:                 ${pct(negRuns.filter((x) => x.pass).length, negRuns.length)}`);
  console.log(`forbidden injections (leaks/junk):    ${injected.filter((f) => f.label.startsWith("FORBIDDEN")).length}`);
  const primed = injected.filter((f) => f.primed);
  console.log(`primed neighbors injected:            ${primed.length} (${primed.filter((f) => f.label === "expected").length} expected)`);
  const skipped = hitRuns.filter((x) => x.reason.includes("judge did not search")).length;
  console.log(`hit misses caused by the judge:       ${skipped} of ${hitRuns.filter((x) => !x.pass).length}`);

  if (opts.json) writeFileSync(opts.json, JSON.stringify({ opts, report }, null, 2));
  process.exitCode = failed ? 1 : 0;
}

main();
