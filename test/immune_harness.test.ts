import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessEdit,
  checkContractRules,
  decideImmuneAction,
  extractEdit,
  type ContractBreach,
  type PainVerdict,
  type RuleL1,
} from "../src/slices/immune/index.ts";

const pain = (score: number, band: PainVerdict["band"]): PainVerdict => ({ score, band });

const realVsaRule: RuleL1 = {
  id: "01M4D7S5YART7AGWN7RDSRNRM1",
  title: "Adopt Vertical Slice Architecture (VSA) for UMA",
  fact_type: "decision",
  body:
    "Inviolable VSA Rule: Slices must NEVER import each other directly! Use uma-core or src/shared.",
  contract: {
    engine: "ast-grep",
    severity: "deny",
    rule: {
      pattern: "use crate::slices::$$$REST;",
      inside: "src/slices/**",
      message: "Inviolable VSA Rule: Slices must NEVER import each other directly! Use uma-core or src/shared.",
      language: "rust",
    },
  },
};

const tsVsaRule: RuleL1 = {
  id: "01M4TSVSA00000000000000000",
  title: "TypeScript VSA Slice Isolation",
  fact_type: "decision",
  body: "TypeScript slices must never import sibling slices directly.",
  contract: {
    engine: "ast-grep",
    severity: "deny",
    rule: {
      pattern: 'import { $$$A } from "../commands/$$$B";',
      inside: "src/slices/**",
      message: "Forbidden sibling slice import in TypeScript VSA.",
      language: "typescript",
    },
  },
};

// ── Scenario 1: Rust VSA Contract Violations ─────────────────────────────

test("blind-spot Rust pattern degrades to warn, never hard-blocks", async () => {
  // SPAI-049 live finding: the shipped pattern cannot match deep scoped
  // paths under real ast-grep, so the breach surfaces as a VISIBLE warn
  // degradation instead of a silent pass or a false hard block.
  const diff = `
+use crate::slices::doctor::checks::inspect_index;
+
 pub fn run_search() -> Result<()> {
+    println!("searching...");
     Ok(())
 }
`;
  const breaches = await checkContractRules([realVsaRule], "src/slices/search/mod.rs", diff);

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].factId, "01M4D7S5YART7AGWN7RDSRNRM1");
  assert.equal(breaches[0].severity, "warn");
  assert.ok(breaches[0].ruleMessage.includes("DEGRADED"));

  // Mode verification: a degraded breach rides the advisory channel in every
  // mode — auto-blocking stays reserved for VERIFIED deterministic matches.
  const autoDecision = decideImmuneAction("auto", [], breaches);
  assert.equal(autoDecision.kind, "confirm");

  const askDecision = decideImmuneAction("ask", [], breaches);
  assert.equal(askDecision.kind, "confirm");

  const warnDecision = decideImmuneAction("warn", [], breaches);
  assert.equal(warnDecision.kind, "notify");
});

test("verified Rust breach denies and auto-blocks", async () => {
  const diff = `
+use crate::slices::doctor::checks::inspect_index;
+
 pub fn run_search() -> Result<()> {
+    println!("searching...");
     Ok(())
 }
`;
  const verifiable: RuleL1 = {
    ...realVsaRule,
    contract: {
      ...realVsaRule.contract!,
      rule: { ...realVsaRule.contract!.rule, pattern: "use crate::slices::doctor::checks::inspect_index;" },
    },
  };
  const breaches = await checkContractRules([verifiable], "src/slices/search/mod.rs", diff);

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].severity, "deny");
  assert.ok(breaches[0].ruleMessage.includes("Inviolable VSA Rule"));

  const autoDecision = decideImmuneAction("auto", [], breaches);
  assert.equal(autoDecision.kind, "block");
  assert.ok(autoDecision.kind === "block" && autoDecision.reason.includes("[UMA Immune System Block]"));
});

test("allows valid shared kernel imports in Rust", async () => {
  const diff = `
+use crate::shared::format::print_fact;
+use uma_core::store::Store;
+use anyhow::Result;
+
 pub fn execute() -> Result<()> {
     Ok(())
 }
`;
  const breaches = await checkContractRules([realVsaRule], "src/slices/search/mod.rs", diff);
  // No DENY breach — but the blind-spot rule still degrades visibly.
  assert.equal(breaches.filter((b) => b.severity === "deny").length, 0);
  assert.equal(breaches.filter((b) => b.severity === "warn").length, 1);

  const decision = decideImmuneAction("auto", [], breaches);
  assert.equal(decision.kind, "confirm");
});

test("exempts files outside the 'inside' glob", async () => {
  // main.rs is the composition root, where multi-slice imports are explicitly allowed!
  const diff = `
+use crate::slices::doctor::run as run_doctor;
+use crate::slices::search::run as run_search;
`;
  const breaches = await checkContractRules([realVsaRule], "src/main.rs", diff);
  assert.equal(breaches.length, 0);
});

// ── Scenario 2: TypeScript VSA Contract Violations ───────────────────────

test("blind-spot TS pattern degrades to warn (metavariable in a string literal)", async () => {
  const diff = `
+import { registerCommands } from "../commands/index.ts";
+
 export function search() {}
`;
  const breaches = await checkContractRules([tsVsaRule], "src/slices/search/index.ts", diff);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].severity, "warn");
  assert.ok(breaches[0].ruleMessage.includes("DEGRADED"));
  assert.ok(breaches[0].ruleMessage.includes("string literal"));
});

test("allows shared imports in TypeScript", async () => {
  const diff = `
+import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
+import { stringsFor } from "../../shared/i18n.ts";
+import type { PluginState } from "../../shared/state.ts";
`;
  const breaches = await checkContractRules([tsVsaRule], "src/slices/search/index.ts", diff);
  assert.equal(breaches.filter((b) => b.severity === "deny").length, 0);
});

// ── Scenario 3: Pain Score & Heuristic Warnings ───────────────────────────

test("critical pain triggers test-first warning but NEVER blocks alone", async () => {
  const harmlessEdit = "pub fn add(a: i32, b: i32) -> i32 { a + b }";
  const warnings = assessEdit(pain(85, "critical"), [realVsaRule], harmlessEdit);

  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("85/100"));
  assert.ok(warnings[0].includes("test-first"));

  // Crucial invariant: pain alone only warns/confirms, NEVER blocks!
  const action = decideImmuneAction("auto", warnings, []);
  assert.equal(action.kind, "confirm");
  assert.notEqual(action.kind, "block");
});

test("low pain and clean code produces zero warnings", async () => {
  const warnings = assessEdit(pain(10, "low"), [realVsaRule], "const PI = 3.14159;");
  assert.deepEqual(warnings, []);
  assert.deepEqual(decideImmuneAction("auto", warnings, []), { kind: "allow" });
});

// ── Scenario 4: Multi-Hunk Tool Payload Extraction ────────────────────────

test("extractEdit handles full multi-edit tool calls", async () => {
  const multiEditToolInput = {
    path: "src/slices/delegate/index.ts",
    edits: [
      { oldText: "let a = 1;", newText: "let a = 2;" },
      { oldText: "let b = 1;", newText: "use crate::slices::doctor;" },
    ],
  };

  const extracted = extractEdit("edit", multiEditToolInput);
  assert.ok(extracted);
  assert.equal(extracted.path, "src/slices/delegate/index.ts");
  assert.ok(extracted.added.includes("let a = 2;"));
  assert.ok(extracted.added.includes("use crate::slices::doctor;"));

  const breaches = await checkContractRules([realVsaRule], extracted.path, extracted.added);
  assert.equal(breaches.length, 1);
});
