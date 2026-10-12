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
