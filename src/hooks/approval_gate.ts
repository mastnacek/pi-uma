import type { ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
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

/** UMA executables that can persist memory (bare name, with or without path). */
const UMA_BINARY_NAMES = new Set(["uma", "uma.exe", "uma-cli", "uma-cli.exe"]);

/** Subcommands whose execution persists to the memory store. */
function subcommandMutatesMemory(tokens: string[]): boolean {
  const sub = tokens[0]?.toLowerCase();
  const second = tokens[1]?.toLowerCase();
  if (sub === "write" || sub === "supersede") return true;
  if (sub === "staging" && second === "approve") return true;
  if (sub === "skill" && second === "new") return true;
  if (sub === "muscle" && second === "new") return true;
  if (sub === "mcp" && second === "serve" && tokens.some((t) => t === "--allow-writes")) return true;
  return false;
}

/**
 * True when the path targets a UMA memory store (project `.uma/` or the global
 * store on ANY platform).
 *
 * Normalizes separators and case, and recognises the three real global layouts:
 *   Windows: %APPDATA%\uma\uma\data\global
 *   macOS:   ~/Library/Application Support/com.uma.uma/global
 *   Linux:   ~/.local/share/uma/global
 * (the previous check only knew the Windows shape, leaving mac/Linux open).
 */
export function isUmaMemoryFilePath(targetPath: string): boolean {
  const norm = targetPath.replace(/\\/g, "/").toLowerCase();
  if (
    norm.includes("/.uma/") ||
    norm.startsWith(".uma/") ||
    norm.endsWith("/.uma") ||
    norm === ".uma"
  ) {
    return true;
  }
  const globalMarkers = [
    "/uma/uma/data/global/",
    "/uma/data/global/",
    "/com.uma.uma/global/",
    "/.local/share/uma/global/",
  ];
  return globalMarkers.some((m) => norm.includes(m) || norm.endsWith(m.slice(0, -1)));
}

/** Best-effort symlink resolution, so a link into `.uma` cannot evade the gate. */
function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // The file usually does not exist yet; resolve the existing parent.
  }
  const parent = path.dirname(p);
  try {
    return path.join(fs.realpathSync(parent), path.basename(p));
  } catch {
    return path.resolve(p);
  }
}

/**
 * True when a path — or the real path behind a symlink — is a UMA memory file.
 * Resolving the link closes the `ln -s .uma m; write m/x.md` bypass.
 */
export function isProtectedMemoryPath(targetPath: string, cwd: string): boolean {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
  return isUmaMemoryFilePath(abs) || isUmaMemoryFilePath(realPath(abs));
}

/** Splits a shell line into command segments (crude, but quote-tolerant). */
function segments(command: string): string[][] {
  return command
    .split(/[|;&\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.split(/\s+/).map((t) => t.replace(/^["'`]+|["'`]+$/g, "")),
    );
}

/** True when a token names a UMA executable (quotes/path already stripped). */
function isUmaExecutable(token: string): boolean {
  const base = token.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return UMA_BINARY_NAMES.has(base);
}

/** Shell-level writes straight into a memory store path. */
function commandWritesMemoryPath(command: string): boolean {
  const norm = command.replace(/\\/g, "/");
  const storeHit =
    /(?:^|[\s>|;&"'`])\.uma\//i.test(norm) ||
    /\/\.uma\//i.test(norm) ||
    /uma[\\/]uma[\\/]data[\\/]global/i.test(norm) ||
    /uma[\\/]data[\\/]global/i.test(norm) ||
    /com\.uma\.uma[\\/]global/i.test(norm) ||
    /\.local[\\/]share[\\/]uma[\\/]global/i.test(norm);
  if (!storeHit) return false;
  // Only a write counts: redirection, `tee`, or a file-mutating utility.
  return /(?:>>?|\btee\b|\b(?:cp|mv|rm|del|sed|truncate|dd|install|rsync|python\d?|perl|node)\b)/i.test(
    command,
  );
}

/**
 * True when a bash command can persist memory, directly or by bypassing the
 * approved tools: a UMA binary invocation (quoted or `uma-cli`, any subcommand
 * that writes), or a shell-level write into a store path.
 */
export function isBypassingBashCommand(command: string): boolean {
  for (const tokens of segments(command)) {
    let i = 0;
    while (
      i < tokens.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) ||
        ["sudo", "env", "command", "nohup", "time"].includes(tokens[i]))
    ) {
      i++;
    }
    if (isUmaExecutable(tokens[i] ?? "") && subcommandMutatesMemory(tokens.slice(i + 1))) {
      return true;
    }
  }
  return commandWritesMemoryPath(command);
}

/**
 * Fail-closed approval decision for a `tool_call`.
 *
 * 1. Blocks direct file writes/edits into UMA memory stores (any platform, and
 *    through a symlink) via write or edit.
 * 2. Blocks shell-level persistence into UMA memory (`uma write`/`supersede`/
 *    `staging approve`/`skill new`/`muscle new`/`mcp serve --allow-writes`,
 *    quoted or `uma-cli`, or a redirection/utility into a store path).
 * 3. Requires an interactive approval UI for native uma_write and uma_supersede
 *    unless autoApprove is enabled.
 */
export function evaluateApprovalGate(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  state: ExtensionState
): ToolCallEventResult | undefined {
  const cwd = ctx.cwd ?? process.cwd();

  // 1. Guard against direct file writes/edits into UMA memory stores
  if (event.toolName === "write" || event.toolName === "edit") {
    const targetPath = (event.input as { path?: string })?.path;
    if (targetPath && isProtectedMemoryPath(targetPath, cwd)) {
      return {
        block: true,
        reason:
          `[UMA Memory Integrity Guard]: Direct modification of UMA memory files (${targetPath}) via '${event.toolName}' is strictly forbidden! ` +
          `You MUST call the dedicated 'uma_write' or 'uma_supersede' tool so the operator can review and approve changes in the interactive modal dialog.`,
      };
    }
  }

  // 2. Guard against bypassing UMA via a shell command that persists memory
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
