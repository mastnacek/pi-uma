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

  const addedTokens = new Set(tokenize(addedText));
  if (addedTokens.size >= MIN_EDIT_TOKENS) {
    for (const rule of rules) {
      const ruleTokens = new Set(tokenize(`${rule.title} ${rule.body}`));
      let shared = 0;
      for (const token of addedTokens) {
        if (ruleTokens.has(token)) shared += 1;
      }
      const containment = shared / addedTokens.size;
      if (shared >= MIN_SHARED_TOKENS && containment >= MIN_CONTAINMENT) {
        warnings.push(
          `[UMA Rule] This edit may touch active rule ${rule.id} "${rule.title}" — verify compliance before saving.`,
        );
        break; // one rule warning per edit: enough to look, not noise
      }
    }
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

/** Converts a simple ast-grep pattern into a regular expression. */
export function patternToRegex(pattern: string): RegExp {
  const multiVars: string[] = [];
  let intermediate = pattern.replace(/\$\$\$([A-Z0-9_]+)/g, (_m, name) => {
    multiVars.push(name);
    return `__UMA_MULTI_${multiVars.length - 1}__`;
  });

  const singleVars: string[] = [];
  intermediate = intermediate.replace(/\$([A-Z0-9_]+)/g, (_m, name) => {
    singleVars.push(name);
    return `__UMA_SINGLE_${singleVars.length - 1}__`;
  });

  let escaped = intermediate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (let i = 0; i < multiVars.length; i++) {
    escaped = escaped.replace(`__UMA_MULTI_${i}__`, "[^;\\n]*?");
  }
  for (let i = 0; i < singleVars.length; i++) {
    escaped = escaped.replace(`__UMA_SINGLE_${i}__`, "[a-zA-Z0-9_.:]+(?:\\([^)]*\\))?");
  }

  escaped = escaped.replace(/\\\s+/g, "\\s+");
  return new RegExp(escaped, "m");
}

/** Matches a file path against a contract's `inside` glob pattern. */
export function pathMatchesInside(inside: string, filePath: string): boolean {
  const normPath = filePath.replace(/\\/g, "/");
  const normInside = inside.replace(/\\/g, "/");

  if (normInside.endsWith("/**")) {
    const prefix = normInside.slice(0, -3);
    return normPath.startsWith(prefix) || normPath.includes(`/${prefix}`) || normPath.includes(prefix);
  }
  if (normInside.includes("*")) {
    const regexStr = "^" + normInside.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$";
    try {
      return new RegExp(regexStr).test(normPath);
    } catch {
      return normPath.includes(normInside.replace(/\*/g, ""));
    }
  }
  return normPath.includes(normInside);
}

/** Checks active contract-backed rules against a proposed edit. */
export function checkContractRules(
  rules: RuleL1[],
  filePath: string,
  addedText: string,
): ContractBreach[] {
  const breaches: ContractBreach[] = [];

  for (const rule of rules) {
    const contract = rule.contract;
    if (!contract || !contract.rule || !contract.rule.pattern) continue;

    if (contract.rule.inside && !pathMatchesInside(contract.rule.inside, filePath)) {
      continue;
    }

    try {
      const rx = patternToRegex(contract.rule.pattern);
      if (rx.test(addedText)) {
        breaches.push({
          factId: rule.id,
          title: rule.title,
          ruleMessage: contract.rule.message || `Violated contract pattern: ${contract.rule.pattern}`,
          severity: contract.severity || "deny",
          pattern: contract.rule.pattern,
          file: filePath,
        });
      }
    } catch {
      if (addedText.includes(contract.rule.pattern.replace(/[$^]/g, ""))) {
        breaches.push({
          factId: rule.id,
          title: rule.title,
          ruleMessage: contract.rule.message,
          severity: contract.severity || "deny",
          pattern: contract.rule.pattern,
          file: filePath,
        });
      }
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

  if (breaches.length > 0) {
    const breachMessages = breaches
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

  if (warnings.length === 0) return { kind: "allow" };
  const message = warnings.join("\n");

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
