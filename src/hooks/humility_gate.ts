/**
 * Humility gate hook — thin subscription over the pure policy in
 * slices/humility/policy.ts (mirrors the immune interceptor pattern).
 *
 * The dialog TITLE and buttons come from the string table (user-facing);
 * the message body is display-translated for the dialog like every other
 * fact view, while the block REASON stays the English original — the model
 * reads it, and translation is presentation-only by the translate-slice
 * invariant. The operator decides: a decline blocks the call — consented,
 * never silent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../shared/types.js";
import { stringsFor } from "../shared/i18n.js";
import { translateOutputForDisplay } from "../shared/translate_client.js";
import { decideHumilityGate, type HumilityFlag } from "../slices/humility/policy.ts";

export function registerHumilityGate(pi: ExtensionAPI, state: ExtensionState): () => void {
  const unsubscribe = pi.on("tool_call", async (event, ctx) => {
    if (!state.config.humilityGate) return undefined;
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
    const input = event.input as Record<string, unknown> | undefined;
    const path = typeof input?.path === "string" ? input.path : "";
    if (!path) return undefined;

    const flags: HumilityFlag[] = state.humilityFlags ?? [];
    const action = decideHumilityGate(flags, path, true);
    if (action.kind === "allow") return undefined;
    if (action.kind === "block") return { block: true, reason: action.reason };

    const s = stringsFor(state.config.lang);
    const { text } = await translateOutputForDisplay(ctx, action.message, state.config.lang);
    // Same pattern as the immune interceptor: translated body in the
    // multi-line title, localized buttons via select (confirm() hardcodes
    // Yes/No). Esc/undefined or the block button both decline — fail-closed,
    // and the model-facing reason is always the English original.
    const choice = await ctx.ui.select(`${s.humilityDialogTitle}\n${text}`, [s.dialogProceed, s.dialogBlock]);
    if (choice !== s.dialogProceed) {
      return { block: true, reason: action.message };
    }
    return undefined;
  });
  return unsubscribe;
}