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
  // SPAI-050: plasticity writes fitness telemetry — a model must not be able
  // to inflate or vent a rule's weight behind the operator's back via bash.
  // The plugin's own triggers go through runUma directly, not the bash tool.
  if (sub === "plasticity" && (second === "reinforce" || second === "frustrate")) return true;
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

/** True when a token names or embeds a UMA memory store path. Substring
 *  semantics: an argv token may be a bare path (`.uma/x.md`), an absolute
 *  store path, or embedded code (`open('.uma/x','w')`). */
function tokenTouchesStore(token: string): boolean {
  const norm = token.replace(/\\/g, "/").toLowerCase();
  if (norm === ".uma" || /(^|[^a-z0-9_.])\.uma\//.test(norm)) return true;
  return (
    norm.includes("uma/uma/data/global") ||
    norm.includes("uma/data/global") ||
    norm.includes("com.uma.uma/global") ||
    norm.includes(".local/share/uma/global")
  );
}

/** Separate-form output redirections: ">", ">>", "2>", "2>>", "&>", "&>>". */
const REDIRECT_OP_RE = /^&?\d*>>?$/;
/** Attached form — operator and target share one token: "2>/dev/null", ">>out". */
const ATTACHED_REDIRECT_RE = /^&?\d*(>>|>)(\S+)$/;

/** True when an output redirection in the segment lands in a store path.
 *  Input redirection (`< file`) is a read and never blocks; `/dev/null`
 *  and ordinary temp targets stay allowed (SPAI-053). */
function redirectWritesStore(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (REDIRECT_OP_RE.test(tokens[i])) {
      const target = tokens[i + 1];
      if (target && tokenTouchesStore(target)) return true;
      continue;
    }
    const attached = ATTACHED_REDIRECT_RE.exec(tokens[i]);
    if (attached && tokenTouchesStore(attached[2])) return true;
  }
  return false;
}

/** Utilities whose execution can mutate any file they name. The Windows and
 *  PowerShell spellings are listed too: the gate scans `cmd /c` and
 *  `powershell -Command` bodies (see unwrapShell), so `copy nul .uma\x.md`
 *  and `Set-Content .uma/x.md` must count as writes like `cp` and `tee`. */
const MUTATING_UTILS = new Set([
  "tee", "cp", "mv", "rm", "del", "sed", "truncate", "dd",
  "install", "rsync", "python", "python3", "perl", "node",
  // cmd.exe builtins
  "copy", "move", "ren", "rename", "erase", "rd", "rmdir", "xcopy", "robocopy",
  // PowerShell cmdlets (and their common aliases)
  "set-content", "add-content", "out-file", "copy-item", "move-item", "remove-item",
  "new-item", "clear-content", "rename-item", "sc", "ac", "cpi", "mi", "ri", "ni",
]);

/** Shells whose `-c` (or `/c`, `-Command`) body is itself a command line. A
 *  memory write hidden in that body must be judged exactly like a bare one:
 *  `bash -c "uma write …"` created a fact without the approval modal before
 *  the gate learned to look inside (live finding, 2026-10-27). */
const SH_WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const CMD_WRAPPERS = new Set(["cmd"]);
const PS_WRAPPERS = new Set(["powershell", "pwsh"]);

/** Lower-case basename without a trailing `.exe`: `C:/Git/bin/bash.exe` → `bash`. */
function executableName(token: string): string {
  const base = token.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

/**
 * Strips one shell-wrapper prefix: `bash -lc`, `cmd /c`, `powershell -Command`
 * (any flag order; the body starts after the command flag). Returns the body
 * tokens, or undefined when the segment is not a wrapper invocation. Quotes
 * were already stripped per token by segments(), so the body is inline.
 */
function unwrapShell(tokens: string[]): string[] | undefined {
  const name = executableName(tokens[0] ?? "");
  let isBody: (flag: string) => boolean;
  if (SH_WRAPPERS.has(name)) isBody = (f) => /^-[a-z]*c[a-z]*$/i.test(f);
  else if (CMD_WRAPPERS.has(name)) isBody = (f) => /^\/[ck]$/i.test(f);
  else if (PS_WRAPPERS.has(name)) isBody = (f) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(f);
  else return undefined;
  for (let i = 1; i < tokens.length; i++) {
    if (isBody(tokens[i])) return tokens.slice(i + 1);
    if (!tokens[i].startsWith("-") && !tokens[i].startsWith("/")) break; // positional: a script file, not a body
  }
  return undefined;
}

/** The effective command line after env assignments, transparent wrappers and
 *  any chain of shell wrappers (`sudo bash -c "cmd /c …"`). */
function unwrapAll(tokens: string[]): string[] {
  let rest = tokens.slice(commandIndexAfter(tokens, true));
  for (let guard = 0; guard < 8; guard++) {
    const body = unwrapShell(rest);
    if (body === undefined) break;
    rest = body.slice(commandIndexAfter(body, true));
  }
  return rest;
}

/** Wrappers that do not change what the effective command touches. Shared by
 *  the store-write scan and the UMA-binary scan so both see through them. */
const TRANSPARENT_WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "nice", "xargs"]);

/** Index of the first token that is not a wrapper (env assignments ignored). */
function commandIndexAfter(tokens: string[], skipEnv: boolean): number {
  let i = 0;
  while (
    i < tokens.length &&
    (TRANSPARENT_WRAPPERS.has(tokens[i]) ||
      (skipEnv && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])))
  ) {
    i++;
  }
  return i;
}

/** True when the segment's effective command is a file-mutating utility and
 *  some other token touches a store path. Every token except the command
 *  itself counts as an operand — flags included, so `dd of=.uma/x` and
 *  `node --eval="...writeFileSync('.uma/x',...)"` cannot hide in an option. */
function utilityWritesStore(tokens: string[]): boolean {
  for (const skipEnv of [false, true]) {
    const cmdIdx = commandIndexAfter(tokens, skipEnv);
    const cmd = executableName(tokens[cmdIdx] ?? "");
    if (cmd && MUTATING_UTILS.has(cmd)) {
      return tokens.some((t, idx) => idx !== cmdIdx && tokenTouchesStore(t));
    }
  }
  // The same check on the body of a shell wrapper: `cmd /c copy nul .uma\x.md`,
  // `powershell -Command "Set-Content .uma/x.md y"`, `bash -c "tee .uma/x"`.
  const body = unwrapAll(tokens);
  if (body !== tokens && body.length > 0) {
    const cmd = executableName(body[0]);
    if (MUTATING_UTILS.has(cmd)) {
      return body.some((t, idx) => idx !== 0 && tokenTouchesStore(t));
    }
  }
  return false;
}

/**
 * True when a shell segment persists into a UMA store: an output redirection
 * whose target is a store path, or a file-mutating utility naming one. The
 * store mention and the write capability must co-occur in the same operand —
 * a store path that is only NAMED, never written, stays allowed, so read-only
 * commands like `ls .uma/ 2>/dev/null` no longer trip the gate (SPAI-053).
 */
function commandWritesMemoryPath(command: string): boolean {
  return segments(command).some(
    (tokens) => redirectWritesStore(tokens) || utilityWritesStore(tokens),
  );
}

/**
 * True when a bash command can persist memory, directly or by bypassing the
 * approved tools: a UMA binary invocation (quoted or `uma-cli`, any subcommand
 * that writes), or a shell-level write into a store path.
 */
export function isBypassingBashCommand(command: string): boolean {
  for (const tokens of segments(command)) {
    // Wrapper-aware: env assignments, transparent wrappers and shell bodies
    // (`bash -c`, `cmd /c`, `powershell -Command`) never make a different
    // binary the real command.
    const rest = unwrapAll(tokens);
    if (isUmaExecutable(rest[0] ?? "") && subcommandMutatesMemory(rest.slice(1))) {
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
