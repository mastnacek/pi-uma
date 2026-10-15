import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ContractDefinition } from "./types.js";

function getPackageDir(): string {
  const currentFile = typeof __filename !== "undefined"
    ? __filename
    : fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "..", "..");
}

/**
 * Candidate engine-binary paths, in precedence order.
 *
 * A **local build wins over the shipped binary**: `bin/uma.exe` is committed,
 * so preferring it silently ignored every `cargo build` and shipped a stale
 * engine (SPAI-041 — the plugin and engine disagreed with no version check and
 * no error). The shipped binary stays as the fallback for installs with no
 * target directory. Pure so the order is covered by a test, not by a comment.
 */
export function umaBinaryCandidates(pkgDir: string, isWindows: boolean): string[] {
  const primary = isWindows ? "uma.exe" : "uma";
  const fallback = isWindows ? "uma-cli.exe" : "uma-cli";
  return [
    // 1. A build in this package's own cargo target dirs (development).
    path.join(pkgDir, "core", "target", "release", primary),
    path.join(pkgDir, "core", "target", "debug", primary),
    path.join(pkgDir, "target", "release", primary),
    path.join(pkgDir, "target", "debug", primary),
    // 2. The binary shipped with the package (production installs).
    path.join(pkgDir, "bin", primary),
    path.join(pkgDir, "bin", fallback),
  ];
}

export function findUmaBinary(_cwd?: string): string {
  const isWindows = process.platform === "win32";
  const primary = isWindows ? "uma.exe" : "uma";
  const pkgDir = getPackageDir();

  // Security invariant: never look inside arbitrary workspace cwd.
  // Binaries are only resolved from this plugin's own package installation directory or PATH.
  const candidates = umaBinaryCandidates(pkgDir, isWindows);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to system PATH (never workspace cwd)
  return primary;
}

export function runUma(
  binPath: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  // The missing-engine case must reach the MODEL as an instruction, not
  // surface as a bare ENOENT: a model that sees only "spawn failed"
  // improvises (it once stored a memory rule in an unrelated gotchas
  // file). Tell it exactly what happened and what to tell the operator.
  if (!fs.existsSync(binPath)) {
    return Promise.reject(missingBinaryError(binPath));
  }
  return new Promise((resolve, reject) => {
    // timeoutMs arms execFile's own reaper: the child is SIGKILLed (on
    // Windows: TerminateProcess) instead of being orphaned when the caller
    // gives up — a Promise.race timeout alone leaves the engine running.
    const options =
      timeoutMs !== undefined
        ? { cwd, timeout: timeoutMs, killSignal: "SIGKILL" as const }
        : { cwd };
    execFile(binPath, args, options, (error, stdout, stderr) => {
      // Killed by our own timeout: surface as 124 (conventional timeout exit
      // code) so callers can distinguish "engine too slow" from "engine
      // refused". stdout/stderr keep whatever the child managed to write.
      if (error && (error as { killed?: boolean }).killed) {
        resolve({ stdout, stderr, code: 124 });
        return;
      }
      if (error && "code" in error && typeof error.code === "number" && error.code !== 0) {
        resolve({ stdout, stderr, code: error.code });
      } else if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr, code: 0 });
      }
    });
  });
}

function missingBinaryError(binPath: string): Error {
  return new Error(
    `UMA engine binary not found (looked for: ${binPath} and standard locations). ` +
    "Do NOT store this request anywhere else. " +
    "Tell the operator to restore the engine: reinstall the plugin " +
    "(pi update --extensions) or build it (cd core && cargo build --release).",
  );
}

/**
 * Runs the CLI with a payload on STDIN. Used for secret scanning: passing the
 * text as an argv element hit the Windows ~32KB command-line limit (and could
 * be read from the process list), so the scanner reads `--stdin` instead.
 */
export function runUmaWithInput(
  binPath: string,
  args: string[],
  cwd: string,
  input: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!fs.existsSync(binPath)) {
    return Promise.reject(missingBinaryError(binPath));
  }
  return new Promise((resolve, reject) => {
    const child = execFile(binPath, args, { cwd }, (error, stdout, stderr) => {
      if (error && "code" in error && typeof error.code === "number" && error.code !== 0) {
        resolve({ stdout, stderr, code: error.code });
      } else if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr, code: 0 });
      }
    });
    // Guard the optional stdin pipe (a spawn failure leaves it null).
    child.stdin?.end(input);
  });
}

export interface FactSummary {
  id: string;
  title: string;
  type: string;
  scope: string;
  tags: string[];
  /** SPAI backlog item IDs this fact is linked to (cross-reference only). */
  spai?: string[];
  /** Executable AST contract, when the fact carries one. */
  contract?: ContractDefinition;
}

/**
 * Reads a fact via `uma read --json` so callers get its real type/scope/tags.
 * Returns `undefined` when the fact cannot be read.
 */
export async function readFactJson(cwd: string, id: string): Promise<FactSummary | undefined> {
  const binPath = findUmaBinary(cwd);
  try {
    const result = await runUma(binPath, ["read", id, "--json"], cwd);
    if (result.code !== 0) return undefined;
    const raw = JSON.parse(result.stdout) as {
      id: string;
      title: string;
      fact_type: unknown;
      scope: unknown;
      tags?: string[];
      spai?: string[];
      contract?: ContractDefinition;
    };
    return {
      id: raw.id,
      title: raw.title,
      type: enumValue(raw.fact_type),
      scope: scopeValue(raw.scope),
      tags: raw.tags ?? [],
      spai: raw.spai,
      contract: raw.contract,
    };
  } catch {
    return undefined;
  }
}

/** Unwraps a Rust enum: `"Preference"` or `{ "Custom": "cst" }` -> `"preference"` / `"cst"`. */
function enumValue(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object") {
    const inner = Object.values(value as Record<string, unknown>)[0];
    if (typeof inner === "string") return inner.toLowerCase();
  }
  return "note";
}

/** Unwraps the scope enum: `"Global"` -> `"global"`, `{ "Project": "x" }` -> `"x"`. */
function scopeValue(value: unknown): string {
  if (value === "Global") return "global";
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).Project;
    if (typeof inner === "string" && inner.length > 0) return inner;
  }
  return "project";
}

export async function executeUma(
  cwd: string,
  args: string[],
  emptyFallback = "No facts found."
): Promise<{ content: Array<{ type: "text"; text: string }>; details: { output?: string; error?: string } }> {
  const binPath = findUmaBinary(cwd);
  try {
    const result = await runUma(binPath, args, cwd);
    if (result.code !== 0) {
      return {
        content: [{ type: "text", text: `UMA error:\n${result.stderr || result.stdout}` }],
        details: { error: result.stderr },
      };
    }
    return {
      content: [{ type: "text", text: result.stdout.trim() || emptyFallback }],
      details: { output: result.stdout.trim() },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Failed to execute uma: ${message}` }],
      details: { error: message },
    };
  }
}

/**
 * Maps a tool's scope parameter onto the CLI convention. The literal word
 * "project" (a model convention, seen in the wild) and an empty string
 * mean "the current repository" — which is the CLI default, so the flag
 * is simply omitted. A real project name passes through; "global" is a
 * real scope in the CLI as well.
 */
export function scopeArgForCli(scope: string | undefined): string | undefined {
  if (!scope || scope.trim().length === 0) return undefined;
  const normalized = scope.trim().toLowerCase();
  if (normalized === "project" || normalized === "current" || normalized === "cwd") {
    return undefined;
  }
  return scope.trim();
}

/** One executable muscle step, as serialized by `uma muscle list --json`. */
export interface MuscleStepView {
  command: string;
  args: string[];
  label?: string | null;
}

interface MuscleRoutineView {
  name: string;
  steps: MuscleStepView[];
}

/**
 * Fetches the concrete step list for a curated routine so a consent dialog can
 * show exactly what would execute. Returns `undefined` when the routine is
 * unknown or the CLI cannot enumerate it — callers must then refuse to imply
 * an understood run rather than guessing.
 */
export async function fetchMuscleSteps(
  binPath: string,
  cwd: string,
  name: string,
): Promise<MuscleStepView[] | undefined> {
  const res = await runUma(binPath, ["muscle", "list", "--json"], cwd);
  if (res.code !== 0) return undefined;
  try {
    const routines = JSON.parse(res.stdout) as MuscleRoutineView[];
    return routines.find((r) => r.name === name)?.steps ?? [];
  } catch {
    return undefined;
  }
}

export interface RuleSummary {
  id: string;
  title: string;
  fact_type: string;
  body: string;
}

/** Fetches active decisions and patterns for system prompt enhancement. */
export async function fetchActiveRules(cwd: string): Promise<RuleSummary[]> {
  const binPath = findUmaBinary(cwd);
  try {
    const outputs = await Promise.all([
      runUma(binPath, ["list", "--json", "--type", "decision"], cwd),
      runUma(binPath, ["list", "--json", "--type", "pattern"], cwd),
    ]);
    const rules: RuleSummary[] = [];
    for (const output of outputs) {
      if (output && output.code === 0 && output.stdout) {
        try {
          const parsed = JSON.parse(output.stdout) as RuleSummary[];
          rules.push(...parsed);
        } catch {
          // ignore parse errors
        }
      }
    }
    return rules;
  } catch {
    return [];
  }
}

/** Formats active rules into a concise Markdown section for system prompt options. */
export function formatRulesForSystemPrompt(rules: RuleSummary[]): string {
  if (rules.length === 0) return "";
  const lines: string[] = [
    "## Project Memory & Architectural Rules (from UMA)",
    "Strictly follow these recorded decisions and patterns when implementing solutions:",
  ];
  for (const r of rules.slice(0, 10)) {
    const summaryLine = r.body.split("\n")[0] || "";
    lines.push(`- [${r.fact_type}] ${r.title}: ${summaryLine}`);
  }
  return lines.join("\n");
}
