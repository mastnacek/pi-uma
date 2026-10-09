/**
 * Humility gate hook — thin subscription over the pure policy in
 * slices/humility/policy.ts (mirrors the immune interceptor pattern).
 *
 * The dialog TITLE comes from the string table (user-facing); the message
 * body stays English because it quotes the model-facing verdict guidance.
 * The operator decides: a decline blocks the call — consented, never silent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../shared/types.js";
import { stringsFor } from "../shared/i18n.js";
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

    const proceed = await ctx.ui.confirm(
      stringsFor(state.config.lang).humilityDialogTitle,
      action.message,
    );
    if (proceed === false) {
      return { block: true, reason: action.message };
    }
    return undefined;
  });
  return unsubscribe;
}