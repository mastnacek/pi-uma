import type { ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../shared/types.js";

/**
 * Tools that mutate the UMA store and therefore require an approval path.
 * Adding a future mutating tool means adding one entry here — the guard is
 * centralized rather than duplicated per tool.
 *
 * Deliberately excludes `uma_consolidate`: it only *proposes* merges and
 * contradictions and never writes. Gating a read would make approval routine.
 */
export const MEMORY_MUTATING_TOOLS = new Set(["uma_write", "uma_supersede"]);

/** Checks if a path targets UMA memory stores (.uma/ or global store). */
export function isUmaMemoryFilePath(targetPath: string): boolean {
  const norm = targetPath.replace(/\\/g, "/").toLowerCase();
  // Project memory stores: .uma/<fact_type>/...
  if (norm.includes("/.uma/") || norm.startsWith(".uma/")) {
    return true;
  }
  // Global memory stores: AppData/.../uma/.../global/...
  if (norm.includes("/uma/uma/data/global/") || norm.includes("/uma/data/global/")) {
    return true;
  }
  return false;
}

/** Checks if a bash command attempts to invoke uma write or supersede directly. */
export function isBypassingBashCommand(command: string): boolean {
  return /\buma(\.exe)?\s+(write|supersede)\b/i.test(command);
}

/**
 * Fail-closed approval decision for a `tool_call`.
 *
 * 1. Blocks direct file writes/edits into UMA memory stores via write or edit.
 * 2. Blocks direct shell execution of `uma write` or `uma supersede` via bash.
 * 3. Requires an interactive approval UI for native uma_write and uma_supersede
 *    unless autoApprove is enabled.
 */
export function evaluateApprovalGate(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  state: ExtensionState
): ToolCallEventResult | undefined {
  // 1. Guard against direct file writes/edits into UMA memory stores
  if (event.toolName === "write" || event.toolName === "edit") {
    const targetPath = (event.input as { path?: string })?.path;
    if (targetPath && isUmaMemoryFilePath(targetPath)) {
      return {
        block: true,
        reason:
          `[UMA Memory Integrity Guard]: Direct modification of UMA memory files (${targetPath}) via '${event.toolName}' is strictly forbidden! ` +
          `You MUST call the dedicated 'uma_write' or 'uma_supersede' tool so the operator can review and approve changes in the interactive modal dialog.`,
      };
    }
  }

  // 2. Guard against bypassing UMA via direct bash invocation of write or supersede
  if (event.toolName === "bash") {
    const cmd = (event.input as { command?: string })?.command;
    if (cmd && isBypassingBashCommand(cmd)) {
      return {
        block: true,
        reason:
          `[UMA Memory Integrity Guard]: Executing '${cmd.trim()}' directly via bash is strictly forbidden! ` +
          `You MUST call the native 'uma_write' or 'uma_supersede' tool so the operator can review and approve changes in the interactive modal dialog.`,
      };
    }
  }

  // 3. Native UMA mutating tools (uma_write, uma_supersede)
  if (!MEMORY_MUTATING_TOOLS.has(event.toolName)) return undefined;

  const hasApprovalUi = ctx.mode === "tui" && ctx.hasUI;
  if (hasApprovalUi || state.config.autoApprove) return undefined;

  return {
    block: true,
    reason:
      `${event.toolName} would write to UMA memory, but no interactive approval UI is ` +
      `available (mode=${ctx.mode}). Run interactively so the approval window can open, ` +
      `or enable auto-approval with "/uma auto-approve on" (add --global for all sessions).`,
  };
}
