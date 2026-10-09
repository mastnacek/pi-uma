/**
 * User-facing muscle dialog (multilingual-UI rule: operator-read text from the
 * string table). Kept out of index.ts so the tool slice stays model-facing
 * English without mixing surfaces.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../../shared/types.js";
import { stringsFor } from "../../shared/i18n.js";

/** Asks the operator to consent to executing a routine. */
export async function confirmExecution(
  ctx: ExtensionContext,
  state: ExtensionState,
  name: string,
): Promise<boolean> {
  const s = stringsFor(state.config.lang);
  return ctx.ui.confirm(s.muscleDialogTitle, `${s.muscleRunConfirm}"${name}"?`);
}
