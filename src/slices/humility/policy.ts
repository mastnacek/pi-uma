/**
 * Epistemic-humility gate policy (Proposal 04, Pillar IV) — pure decision half.
 *
 * Import-free so `node --test` (strip-types) can exercise it directly; the
 * transport/tracking half lives in index.ts.
 *
 * The consent model: the gate ASKS (operator decides); a decline blocks the
 * call with the reason. It never silently vetoes — the explorative-mode
 * requirement itself is deterministic (flagged low-familiarity + no confirmed
 * hypothesis), not a probabilistic verdict.
 */

/** One flagged low-familiarity subsystem (a directory prefix). */
export interface HumilityFlag {
  dir: string;
  flaggedAt: number;
  confirmed: boolean;
  hypothesis?: string;
  /** File paths read under this dir since flagging. */
  reads: string[];
}

/** Minimum related files read before the hypothesis may be confirmed. */
export const REQUIRED_READS = 3;

/** Flags a directory as low-familiarity (after a LOW familiarity verdict). */
export function flagSubsystem(flags: HumilityFlag[], dir: string): HumilityFlag {
  const existing = flags.find((f) => f.dir === dir);
  if (existing) {
    existing.flaggedAt = Date.now();
    existing.confirmed = false;
    return existing;
  }
  const flag: HumilityFlag = {
    dir,
    flaggedAt: Date.now(),
    confirmed: false,
    reads: [],
  };
  flags.push(flag);
  return flag;
}

/** Normalizes any path to forward slashes for prefix matching. */
function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Finds the flag governing a path (longest matching directory prefix). */
export function flagForPath(flags: HumilityFlag[], filePath: string): HumilityFlag | undefined {
  const path = norm(filePath);
  let best: HumilityFlag | undefined;
  for (const flag of flags) {
    const dir = norm(flag.dir);
    if ((path === dir || path.startsWith(`${dir}/`)) && (!best || dir.length > norm(best.dir).length)) {
      best = flag;
    }
  }
  return best;
}

/** Records a read of a path against the matching flag. */
export function recordRead(flags: HumilityFlag[], filePath: string): void {
  const flag = flagForPath(flags, filePath);
  if (!flag) return;
  const path = norm(filePath);
  if (!flag.reads.includes(path)) {
    flag.reads.push(path);
  }
}

/** Whether the explorative-mode requirement is satisfied for a flag. */
export function explorationSatisfied(flag: HumilityFlag): boolean {
  return flag.reads.length >= REQUIRED_READS;
}

/** What the gate should do for a write/edit to a flagged subsystem. */
export type HumilityAction =
  | { kind: "allow" }
  | { kind: "confirm"; message: string }
  | { kind: "block"; reason: string };

/**
 * Pure gate decision for a candidate edit path.
 * - no matching flag, flag already confirmed, requirement satisfied → allow
 * - flagged, unconfirmed, and requirement unmet → confirm (operator consents)
 * - (a decline of the confirm is the operator's block, as with immune ask)
 */
export function decideHumilityGate(
  flags: HumilityFlag[],
  filePath: string,
  gateEnabled: boolean,
): HumilityAction {
  if (!gateEnabled) return { kind: "allow" };
  const flag = flagForPath(flags, filePath);
  if (!flag || flag.confirmed) return { kind: "allow" };

  if (explorationSatisfied(flag)) {
    // Requirement met but the hypothesis was never confirmed: one last ask.
    return {
      kind: "confirm",
      message:
        `[UMA Humility] The subsystem ${flag.dir} is low-familiarity (${flag.reads.length} file(s) read, ` +
        `hypothesis not yet confirmed via uma_humility confirm). Proceed anyway?`,
    };
  }

  return {
    kind: "confirm",
    message:
      `[UMA Humility] No memory covers ${flag.dir} and you have read ` +
      `${flag.reads.length}/${REQUIRED_READS} related files. Read-Only Explorative Mode: ` +
      `read at least ${REQUIRED_READS} related files, state your hypothesis (uma_humility confirm), ` +
      `then mutate. Proceed without exploration anyway?`,
  };
}
