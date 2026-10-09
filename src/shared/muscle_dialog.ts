/**
 * Shared muscle-consent dialog (used by the muscle tool slice and the /uma
 * muscle command). User-facing text → string table.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "./types.js";
import { stringsFor } from "./i18n.js";

/** Asks the operator to consent to executing a muscle routine. */
export async function confirmMuscleExecution(
  ctx: ExtensionContext,
  state: ExtensionState,
  name: string,
): Promise<boolean> {
  const s = stringsFor(state.config.lang);
  return ctx.ui.confirm(s.muscleDialogTitle, `${s.muscleRunConfirm}"${name}"?`);
}
