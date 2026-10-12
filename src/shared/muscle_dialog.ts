/**
 * Shared muscle-consent dialog (used by the muscle tool slice and the /uma
 * muscle command). User-facing text → string table.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "./types.js";
import type { MuscleStepView } from "./client.js";
import { stringsFor } from "./i18n.js";

/**
 * Asks the operator to consent to executing a muscle routine.
 *
 * The confirmation MUST show the concrete commands about to run — approving a
 * routine name alone lets a routine body smuggle in arbitrary shell. When the
 * step list is unavailable the dialog says so explicitly rather than implying
 * the run is understood.
 */
export async function confirmMuscleExecution(
  ctx: ExtensionContext,
  state: ExtensionState,
  name: string,
  steps?: MuscleStepView[],
): Promise<boolean> {
  const s = stringsFor(state.config.lang);
  const commandLines =
    steps && steps.length > 0
      ? `${s.muscleStepsLabel}\n${steps.map((st) => `  $ ${st.command} ${st.args.join(" ")}`).join("\n")}\n\n`
      : "";
  return ctx.ui.confirm(
    s.muscleDialogTitle,
    `${commandLines}${s.muscleRunConfirm}"${name}"?`,
  );
}
