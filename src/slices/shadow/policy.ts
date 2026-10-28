/**
 * Shadow-worker policies (pure, no pi imports) — testable with `node --test`.
 */

/**
 * True when a command's output indicates a real failure.
 *
 * A bare "failed" is NOT a failure: `cargo test` prints "0 failed" on a green
 * run, so the old `output.includes("failed")` staged a bogus compiler-recovery
 * draft after every successful test run. A failure requires a NON-ZERO count, a
 * compiler error marker, or the tool's own error flag.
 */
export function isCommandFailure(output: string, toolReportedError: boolean): boolean {
  if (toolReportedError) return true;
  if (/\b[1-9]\d*\s+(?:failed|failure|failures|errors?)\b/i.test(output)) return true;
  const lower = output.toLowerCase();
  return lower.includes("error[e") || lower.includes("err!") || lower.includes("error:");
}

/** Phrases that mark a user message as correcting the agent. */
const CORRECTION_MARKERS: readonly string[] = [
  // Czech (matched against the original text the translate plugin keeps)
  "takhle ne", "nepouzivej", "nepoužívej", "spatne", "špatně", "chyba", "tam ne", "nedělej to",
  // English
  "don't use", "do not use", "never use", "instead of", "that's wrong", "thats wrong",
  "that is wrong", "this is wrong", "that's a mistake", "that is a mistake", "that is an error",
  "that's incorrect", "that is incorrect", "you should not",
];

/** English openers a translation produces for "Špatně:" / "Chyba:". */
const CORRECTION_OPENERS = /^(?:wrong|incorrect|mistake|error)\s*[:!,.-]/i;

/**
 * A task directive is not a correction: it names a tool or an explicit
 * operation ("use the edit tool", "call uma_write", "spusť …"). Live finding
 * 2026-10-28: a test directive containing "never use" was staged as a
 * correction that reversed the real rule (console.log vs the logger module).
 */
const TASK_DIRECTIVE =
  /\b(?:use|call|run|invoke)\s+(?:the\s+)?[\w-]+\s+tool\b|\buma_[a-z_]+\b|\bnástroj\w*|\b(?:zavolej|spusť|použij nástroj|vytvoř soubor)\b|\b(?:edit|write|bash|read)\s+tool\b/i;

/**
 * True when a user message corrects the agent and is worth distilling.
 *
 * - The marker may sit in the message the agent saw (often an English
 *   translation) or in the operator's original text (`source`).
 * - A task directive is never a correction, whatever words it contains.
 * - A correction reacts to something: without an earlier assistant reply in
 *   the branch there is nothing to correct.
 */
export function isUserCorrection(text: string, source: string | undefined, hasPriorAssistant: boolean): boolean {
  if (!hasPriorAssistant) return false;
  const candidates = [text, source ?? ""].map((t) => t.trim()).filter(Boolean);
  if (candidates.length === 0) return false;
  if (candidates.some((t) => TASK_DIRECTIVE.test(t))) return false;
  return candidates.some((t) => {
    const lower = t.toLowerCase();
    return CORRECTION_OPENERS.test(t) || CORRECTION_MARKERS.some((m) => lower.includes(m));
  });
}
