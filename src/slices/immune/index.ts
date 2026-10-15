/**
 * Immune interceptor — warn-mode (the advisory half of Proposal 01).
 *
 * Before a file-mutating tool call lands, the active memory rules and the
 * file's pain score are checked and any hazard is surfaced to the operator
 * as a warning. This mode **never blocks**: blocking on a probabilistic
 * verdict would invert the consent model; block-mode is reserved for the
 * deterministic contract-backed rules of Proposal 03.
 *
 * Pure decision logic lives here (testable without pi); the thin event
 * subscription sits in hooks/immune_interceptor.ts and is wired — tracked —
 * in the composition root, per the hook-purity rule.
 */

import type { ContractDefinition } from "../../shared/types.js";
import { scanContractRules, type ContractRuleInput } from "./astgrep.ts";

/** Verdict of `uma risk pain <path> --json`. */
export interface PainVerdict {
  score: number;
  band: "low" | "medium" | "critical";
}

/** One L1 rule: what the interceptor checks proposed edits against. */
export interface RuleL1 {
  id: string;
  title: string;
  fact_type: string;
  body: string;
  contract?: ContractDefinition;
}

/** Specific contract breach detected during an edit. */
export interface ContractBreach {
  factId: string;
  title: string;
  ruleMessage: string;
  severity: "deny" | "warn";
  pattern: string;
  file: string;
}

/** Everything the interceptor needs from the outside, injectable for tests. */
export interface ImmuneDeps {
  painScore(cwd: string, path: string): Promise<PainVerdict | undefined>;
  rules(cwd: string): Promise<RuleL1[]>;
}

/** Tokenizes text into lowercase words long enough to carry meaning. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4);
}

/** Jaccard overlap is unusable here: rule bodies run to 100+ tokens, which
 * dilutes any edit's score below every meaningful threshold (the live test
 * fired at 0.103 for a genuinely rule-touching edit). What discriminates is
 * the rule's coverage of the EDIT plus an absolute shared-token floor.
 * Validated on 6 live fixtures: the true VSA probe (inter=10, ratio=0.48)
 * warns; five benign/real edits (inter 0–3) stay silent. */
const MIN_EDIT_TOKENS = 5;
const MIN_SHARED_TOKENS = 4;
const MIN_CONTAINMENT = 0.25;

/**
 * The single rule an edit most likely touches, by the same containment
 * heuristic assessEdit warns with. Extracted so the hook can attach a
 * semantic second opinion (recommendation.ts) to the matched rule without
 * re-parsing warning strings. Returns the first matching rule (same
 * first-match-wins order as the warning) or undefined.
 */
export function matchRule(rules: RuleL1[], addedText: string): RuleL1 | undefined {
  const addedTokens = new Set(tokenize(addedText));
  if (addedTokens.size < MIN_EDIT_TOKENS) return undefined;
  for (const rule of rules) {
    const ruleTokens = new Set(tokenize(`${rule.title} ${rule.body}`));
    let shared = 0;
    for (const token of addedTokens) {
      if (ruleTokens.has(token)) shared += 1;
    }
    const containment = shared / addedTokens.size;
    if (shared >= MIN_SHARED_TOKENS && containment >= MIN_CONTAINMENT) {
      return rule; // one rule per edit: enough to look, not noise
    }
  }
  return undefined;
}

/**
 * Pure decision: which warnings does this edit deserve?
 * Returns human-readable warnings; empty means "nothing to say". Never
 * produces a block — the return value is fed to a notification, nothing else.
 */
export function assessEdit(
  pain: PainVerdict | undefined,
  rules: RuleL1[],
  addedText: string,
): string[] {
  const warnings: string[] = [];

  if (pain?.band === "medium") {
    warnings.push(`[UMA Risk] Pain score ${pain.score}/100 for this file — run the affected tests after editing.`);
  }
  if (pain?.band === "critical") {
    warnings.push(`[UMA Risk] Pain score ${pain.score}/100 — test-first: propose the failing test before changing this file.`);
  }

  const rule = matchRule(rules, addedText);
  if (rule) {
    warnings.push(
      `[UMA Rule] This edit may touch active rule ${rule.id} "${rule.title}" — verify compliance before saving.`,
    );
  }

  return warnings;
}

/** Extracts the path and the added text from a write/edit tool input. */
export function extractEdit(toolName: string, input: unknown): { path: string; added: string } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const path = record.path;
  if (typeof path !== "string" || !path) return undefined;

  if (toolName === "write" && typeof record.content === "string") {
    return { path, added: record.content };
  }
  if (toolName === "edit" && Array.isArray(record.edits)) {
    const added = record.edits
      .map((edit) => (typeof edit === "object" && edit !== null ? (edit as Record<string, unknown>).newText : undefined))
      .filter((text): text is string => typeof text === "string")
      .join("\n");
    return { path, added };
  }
  return undefined;
}

/** What the hook should do with an assessment, given the operator's mode. */
export type ImmuneAction =
  | { kind: "allow" }
  | { kind: "notify"; message: string }
  | { kind: "confirm"; message: string }
  | { kind: "block"; reason: string };

/** Matches a file path against a contract's `inside` glob pattern. */
export function pathMatchesInside(inside: string, filePath: string): boolean {
  const normPath = filePath.replace(/\\/g, "/");
  const normInside = inside.replace(/\\/g, "/");

  if (normInside.endsWith("/**")) {
    const prefix = normInside.slice(0, -3);
    return normPath.startsWith(prefix) || normPath.includes(`/${prefix}`) || normPath.includes(prefix);
  }
  if (normInside.includes("*")) {
    // Escape every regex metacharacter EXCEPT the glob wildcard `*` before
    // translating wildcards to their regex forms. Without this an
    // attacker-controlled glob such as `(a+)+` becomes a ReDoS that runs
    // synchronously on every write/edit hook.
    const escaped = normInside.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regexStr = "^" + escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$";
    try {
      return new RegExp(regexStr).test(normPath);
    } catch {
      return normPath.includes(normInside.replace(/\*/g, ""));
    }
  }
  return normPath.includes(normInside);
}

/** The visible note riding a degraded (unverifiable) contract breach. */
function degradedMessage(contract: ContractDefinition, reason: string): string {
  return (
    `${contract.rule.message} ` +
    `[UMA inline check DEGRADED: ${reason} — this deny contract is downgraded to warn and was NOT verified.]`
  );
}

/**
 * Checks active contract-backed rules against a proposed edit with REAL
 * ast-grep matching (SPAI-049): each applicable contract becomes a rule YAML,
 * the added text becomes a snippet, and `ast-grep scan --json=compact` runs
 * exactly like the engine's `uma contracts check`. The regex transliteration
 * this replaced could not match metavariables across string literals or
 * newlines, so deny contracts silently missed real breaches.
 *
 * Never throws. Every unverifiable rule degrades VISIBLY: severity warn with
 * a degradation note — it can neither silently pass nor silently block.
 */
export async function checkContractRules(
  rules: RuleL1[],
  filePath: string,
  addedText: string,
): Promise<ContractBreach[]> {
  const applicable = rules.filter((rule): rule is RuleL1 & { contract: ContractDefinition } => {
    const contract = rule.contract;
    if (!contract?.rule?.pattern) return false;
    return !contract.rule.inside || pathMatchesInside(contract.rule.inside, filePath);
  });
  if (applicable.length === 0 || addedText.trim() === "") return [];

  const inputs: ContractRuleInput[] = applicable.map((rule) => ({
    id: rule.id,
    contract: rule.contract,
  }));
  const report = await scanContractRules(inputs, filePath, addedText);

  if (!report.available) {
    return applicable.map((rule) => ({
      factId: rule.id,
      title: rule.title,
      ruleMessage: degradedMessage(rule.contract, report.unavailableReason ?? "unavailable"),
      severity: "warn" as const,
      pattern: rule.contract.rule.pattern,
      file: filePath,
    }));
  }

  const byId = new Map(applicable.map((rule) => [rule.id.toLowerCase(), rule]));
  const breaches: ContractBreach[] = [];
  for (const result of report.results) {
    const rule = byId.get(result.ruleId.toLowerCase());
    if (!rule) continue;
    if (result.degraded) {
      breaches.push({
        factId: rule.id,
        title: rule.title,
        ruleMessage: degradedMessage(rule.contract, result.degraded),
        severity: "warn",
        pattern: rule.contract.rule.pattern,
        file: filePath,
      });
    } else if (result.matched) {
      breaches.push({
        factId: rule.id,
        title: rule.title,
        ruleMessage: rule.contract.rule.message || `Violated contract pattern: ${rule.contract.rule.pattern}`,
        severity: rule.contract.severity || "deny",
        pattern: rule.contract.rule.pattern,
        file: filePath,
      });
    }
  }
  return breaches;
}

/**
 * Pure mode policy (testable without pi):
 * - off:    the interceptor does not run
 * - warn:   surface the warnings, never disturb the flow
 * - ask:    show each warning set as a confirm dialog; a decline BLOCKS the
 *           tool call with the reason — the operator consented to the block,
 *           the AI proposed it, which is the consent model intact
 * - auto:   deterministic contract violations block outright; heuristic warnings ask
 * - block:  alias for auto / strict block mode
 */
export function decideImmuneAction(
  mode: "off" | "warn" | "ask" | "auto" | "block",
  warnings: string[],
  breaches: ContractBreach[] = [],
): ImmuneAction {
  if (mode === "off") return { kind: "allow" };

  // Severity decides: only VERIFIED deny breaches belong to the block path.
  // Warn-severity breaches (explicit warn contracts, and degraded/unverifiable
  // deny contracts) ride the warning channel — auto-blocking stays reserved
  // for deterministic verified matches (the standing invariant).
  const denies = breaches.filter((b) => b.severity === "deny");
  const warnBreaches = breaches.filter((b) => b.severity === "warn");

  if (denies.length > 0) {
    const breachMessages = denies
      .map(
        (b) =>
          `[UMA Immune System Block]: Your proposed change in '${b.file}' violates active memory contract [${b.factId}] "${b.title}". Rule: ${b.ruleMessage}. Revise your implementation to comply with this constraint.`,
      )
      .join("\n\n");

    if (mode === "auto" || mode === "block") {
      return { kind: "block", reason: breachMessages };
    }
    if (mode === "ask") {
      return { kind: "confirm", message: breachMessages };
    }
    if (mode === "warn") {
      return { kind: "notify", message: breachMessages };
    }
  }

  const breachWarnings = warnBreaches.map(
    (b) =>
      `[UMA Contract] '${b.file}' may violate contract [${b.factId}] "${b.title}" (advisory only): ${b.ruleMessage}`,
  );
  const allWarnings = [...breachWarnings, ...warnings];
  if (allWarnings.length === 0) return { kind: "allow" };
  const message = allWarnings.join("\n");

  switch (mode) {
    case "warn":
      return { kind: "notify", message };
    case "ask":
      return { kind: "confirm", message };
    case "auto":
    case "block":
      return {
        kind: "confirm",
        message:
          message +
          "\n(auto mode: blocks only contract-backed rules once they exist; heuristics ask)",
      };
  }
}
