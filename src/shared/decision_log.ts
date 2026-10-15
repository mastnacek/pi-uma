/**
 * Immune decision log — the evidence base for consent-mode tuning.
 *
 * Every operator answer to an immune consent dialog is appended here with
 * the recommendation that was shown, so the operator can later verify the
 * claim "I would just be giving approval anyway" with numbers instead of
 * impression (SPAI-047). Session-local volatile statistics live HERE, never
 * in memory facts — facts describe invariants, not operator behavior.
 *
 * Fail-quiet: logging must never break or delay the consent path; any
 * failure to append is silently ignored (the dialog outcome matters more
 * than the journal entry).
 */

import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ImmuneDecisionEntry {
  /** ISO timestamp of the operator's answer. */
  ts: string;
  /** The rule the interceptor matched (undefined for pain-only dialogs). */
  ruleId?: string;
  /** The recommendation shown, if the classifier answered in time. */
  relation?: "violates" | "touches" | "unrelated";
  confidence?: number;
  /** true = operator proceeded, false = operator blocked the call. */
  approved: boolean;
}

export function immuneDecisionLogPath(): string {
  return join(homedir(), ".pi", "agent", "uma-immune-log.jsonl");
}

/** Appends one decision; never throws into the caller. */
export async function appendImmuneDecision(entry: ImmuneDecisionEntry): Promise<void> {
  try {
    await appendFile(immuneDecisionLogPath(), `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // fail-quiet: the journal is advisory evidence, not a contract
  }
}

/** Reads the whole log as text; missing file or read error → empty string. */
export async function readImmuneDecisionLog(): Promise<string> {
  try {
    return await readFile(immuneDecisionLogPath(), "utf-8");
  } catch {
    return "";
  }
}

/** Aggregated view over the recent decisions (pure, testable). */
export interface ImmuneDecisionSummary {
  /** Total logged decisions. */
  total: number;
  /** Decisions where the recommendation was "Yes" (unrelated). */
  yesRecommended: number;
  /** Of those, how many the operator approved (agreement with the rec). */
  yesApproved: number;
  /** Decisions where the recommendation was "No" (violates). */
  noRecommended: number;
  /** Of those, how many the operator blocked (agreement with the rec). */
  noBlocked: number;
}

/** Parses JSONL text and aggregates; corrupt lines are skipped, not fatal. */
export function summarizeImmuneDecisions(text: string): ImmuneDecisionSummary {
  const summary: ImmuneDecisionSummary = {
    total: 0, yesRecommended: 0, yesApproved: 0, noRecommended: 0, noBlocked: 0,
  };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: ImmuneDecisionEntry;
    try {
      entry = JSON.parse(trimmed) as ImmuneDecisionEntry;
    } catch {
      continue;
    }
    if (typeof entry?.approved !== "boolean") continue;
    summary.total += 1;
    if (entry.relation === "unrelated") {
      summary.yesRecommended += 1;
      if (entry.approved) summary.yesApproved += 1;
    }
    if (entry.relation === "violates") {
      summary.noRecommended += 1;
      if (!entry.approved) summary.noBlocked += 1;
    }
  }
  return summary;
}
