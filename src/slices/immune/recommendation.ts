/**
 * Immune recommendation — the semantic second opinion inside the consent
 * dialog (SPAI-047).
 *
 * The interceptor's rule match is probabilistic token overlap; when it
 * fires, the operator sees a dialog but learns nothing about whether the
 * rule is genuinely at risk. This module asks the shared cheap flash model
 * (the translate plugin's configured model — the same single knob, no new
 * configuration) for a verdict: does the added text VIOLATE the rule, merely
 * TOUCH its topic, or is it UNRELATED?
 *
 * Hard invariants, unchanged by anything here:
 * - the recommendation is advisory text inside the dialog — it never
 *   auto-approves, never blocks, never bypasses the operator's decision;
 * - on timeout, parse failure or model error the dialog simply shows
 *   WITHOUT a recommendation (degrade quiet, like the recall gate);
 * - the operator's decision is logged for evidence-based mode tuning
 *   (see shared/decision_log.ts), never into memory facts — facts describe
 *   invariants, not volatile operator statistics.
 */

import type { Locale } from "../../shared/i18n.js";
import type { RuleL1 } from "./index.js";

/** Relation of an edit to a rule, in decreasing severity. */
export type RuleRelation = "violates" | "touches" | "unrelated";

/** The parsed second opinion. */
export interface RuleRecommendation {
  relation: RuleRelation;
  /** 0..1 — the classifier's own confidence, displayed as a percentage. */
  confidence: number;
  /** One sentence, in the operator's language. */
  reason: string;
}

const RELATIONS: readonly RuleRelation[] = ["violates", "touches", "unrelated"];

/** Hard caps: a classification prompt must stay small and cheap. */
const MAX_RULE_BODY_CHARS = 2500;
const MAX_ADDED_CHARS = 4000;

/** Pure prompt shape (mirrors translate's Context contract: one user message). */
export interface RecommendContext {
  systemPrompt: string;
  userText: string;
}

/**
 * Pure prompt builder. The classifier gets the rule and the added text and
 * must answer ONLY with strict JSON; the reason is requested in the
 * operator's language so the dialog never mixes languages.
 */
export function buildRecommendationContext(
  rule: Pick<RuleL1, "title" | "body">,
  addedText: string,
  lang: Locale,
): RecommendContext {
  const ruleBody = rule.body.length > MAX_RULE_BODY_CHARS
    ? `${rule.body.slice(0, MAX_RULE_BODY_CHARS)}…`
    : rule.body;
  const added = addedText.length > MAX_ADDED_CHARS
    ? `${addedText.slice(0, MAX_ADDED_CHARS)}…`
    : addedText;
  const systemPrompt = [
    "You are a fast compliance classifier for an AI memory system.",
    'Answer ONLY with a strict JSON object: {"relation":"violates"|"touches"|"unrelated","confidence":<number 0..1>,"reason":"<one sentence>"}.',
    "No prose, no markdown, no code fence.",
    "Decide how the ADDED TEXT being saved relates to the MEMORY RULE:",
    "- violates: it would break or contradict what the rule prescribes;",
    "- touches: it works on the same topic but does not contradict the rule;",
    "- unrelated: the overlap is only vocabulary, the rule is not at risk.",
    "Be conservative about violates: it requires a concrete contradiction, not topic proximity.",
    `Write the reason sentence in ${lang === "cs" ? "Czech" : "English"}.`,
  ].join(" ");
  const userText = [
    `MEMORY RULE "${rule.title}":`,
    ruleBody,
    "",
    "ADDED TEXT being saved:",
    added,
  ].join("\n");
  return { systemPrompt, userText };
}

/**
 * Pure parser: defensive against a chatty model — accepts fenced JSON,
 * finds the first JSON object, validates the relation, clamps confidence.
 * Returns undefined when nothing usable is there (dialog shows without
 * a recommendation).
 */
export function parseRecommendation(raw: string): RuleRecommendation | undefined {
  if (!raw) return undefined;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const relation = record.relation;
  if (typeof relation !== "string" || !RELATIONS.includes(relation as RuleRelation)) {
    return undefined;
  }
  const confidenceRaw = record.confidence;
  const confidence = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0.5;
  const reason = typeof record.reason === "string" && record.reason.trim()
    ? record.reason.trim()
    : "";
  return { relation: relation as RuleRelation, confidence, reason };
}

/** Localized verdict line per relation; {p} is the confidence percent. */
const RECOMMENDATION_TEMPLATES: Record<Locale, Record<RuleRelation, string>> = {
  cs: {
    unrelated: "🧠 Jev: nesouvisí s jádrem pravidla ({p} %) — doporučuji Ano",
    touches: "🧠 Jev: dotýká se tématu pravidla ({p} %) — přečti si pravidlo",
    violates: "🧠 Jev: nejspíš porušuje pravidlo ({p} %) — doporučuji Ne",
  },
  en: {
    unrelated: "🧠 Jev: unrelated to the rule ({p}%) — recommending Yes",
    touches: "🧠 Jev: touches the rule's topic ({p}%) — read the rule body",
    violates: "🧠 Jev: likely violates the rule ({p}%) — recommending No",
  },
};

/**
 * Pure renderer: the recommendation lines appended to the dialog title.
 * The percentage is the classifier's own confidence; the recommendation
 * follows the relation, never overrides the operator.
 */
export function formatRecommendation(
  rec: RuleRecommendation,
  lang: Locale,
): string {
  const percent = Math.round(rec.confidence * 100);
  const template = RECOMMENDATION_TEMPLATES[lang][rec.relation];
  const lines = [template.replace("{p}", String(percent))];
  if (rec.reason) lines.push(`  „${rec.reason}“`);
  return lines.join("\n");
}
