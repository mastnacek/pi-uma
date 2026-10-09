/**
 * Prospective Debt Ledger (Proposal 04, Pillar III) — pure decision half.
 *
 * A session-scoped, in-RAM list of cognitive debts: obligations a step creates
 * for later steps ("if you touch the API, you owe an update to the mock in
 * test X"). Deliberately import-free so `node --test` (strip-types) can
 * exercise it directly; the transport/enforcement half lives in index.ts.
 *
 * Invariants: the ledger is advisory state, never memory-store mutations;
 * enforcement may only nudge (one continuation), never silently veto —
 * the operator always sees what is outstanding.
 */

/** One cognitive debt. */
export interface ProspectiveDebt {
  id: string;
  /** The action that created the obligation. */
  sourceAction: string;
  /** What must be done before the task may count as finished. */
  requiredAction: string;
  /** Blocks declaring the task done while open. */
  blocking: boolean;
  createdAt: number;
}

/** Creates a debt with a monotonic session id. */
export function addDebt(
  ledger: ProspectiveDebt[],
  sourceAction: string,
  requiredAction: string,
  blocking: boolean,
  counter: number,
): ProspectiveDebt {
  const debt: ProspectiveDebt = {
    id: `debt-${counter}`,
    sourceAction,
    requiredAction,
    blocking,
    createdAt: Date.now(),
  };
  ledger.push(debt);
  return debt;
}

/** Settles a debt by id; returns true when found and removed. */
export function settleDebt(ledger: ProspectiveDebt[], id: string): boolean {
  const index = ledger.findIndex((d) => d.id === id);
  if (index < 0) return false;
  ledger.splice(index, 1);
  return true;
}

/** Open debts: everything currently in the ledger. */
export function listOpenDebts(ledger: ProspectiveDebt[]): ProspectiveDebt[] {
  return [...ledger];
}

/** Open debts that block declaring the task finished. */
export function openBlockingDebts(ledger: ProspectiveDebt[]): ProspectiveDebt[] {
  return ledger.filter((d) => d.blocking);
}

/**
 * Pure enforcement policy at the settle boundary:
 * - no open blocking debts → allow settle
 * - blocking debts and fewer than MAX_ENFORCEMENTS continuations used →
 *   inject one reminder and request one continuation
 * - cap exhausted → stop nudging (notify the operator instead); a debt
 *   reminder must never loop the agent forever
 */
export const MAX_ENFORCEMENTS_PER_RUN = 2;

export type DebtEnforcement = "allow" | "enforce" | "notify";

export function decideDebtEnforcement(
  blockingCount: number,
  enforcementsUsed: number,
): DebtEnforcement {
  if (blockingCount === 0) return "allow";
  if (enforcementsUsed < MAX_ENFORCEMENTS_PER_RUN) return "enforce";
  return "notify";
}

/** Renders the English reminder injected into the agent's thought stream. */
export function debtReminderContent(debts: ProspectiveDebt[]): string {
  const lines = debts.map(
    (d) =>
      `- [${d.id}] from: ${d.sourceAction}\n  owes: ${d.requiredAction}`,
  );
  return (
    "Outstanding cognitive debts (Prospective Debt Ledger). You may not declare " +
    "this task finished while blocking obligations are open. Settle each one now " +
    "(do the owed work, or restate it as non-blocking with uma_debt settle/add), then finish.\n" +
    lines.join("\n")
  );
}
