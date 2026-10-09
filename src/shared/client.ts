import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export function findUmaBinary(cwd: string): string {
  const isWindows = process.platform === "win32";
  // The canonical binary is `uma` (Cargo.toml [[bin]]); `uma-cli` is kept as a
  // fallback for stale installs built before the rename.
  const primary = isWindows ? "uma.exe" : "uma";
  const fallback = isWindows ? "uma-cli.exe" : "uma-cli";

  const candidates = [
    // The engine binary ships with the package (bin/), so a plain clone
    // works without a Rust toolchain or PATH entry.
    path.join(__dirname, "..", "bin", primary),
    path.join(__dirname, "..", "..", "bin", primary),
    path.join(cwd, "bin", primary),
    // Consolidated repo layout: the Rust workspace lives in core/.
    path.join(__dirname, "..", "..", "core", "target", "release", primary),
    path.join(__dirname, "..", "..", "core", "target", "debug", primary),
    path.join(__dirname, "..", "core", "target", "release", primary),
    path.join(__dirname, "..", "core", "target", "debug", primary),
    path.join(cwd, "core", "target", "release", primary),
    path.join(cwd, "uma", "target", "release", primary),
    path.join(cwd, "uma", "target", "debug", primary),
    path.join(__dirname, "..", "..", "..", "uma", "target", "release", primary),
    path.join(__dirname, "..", "..", "..", "uma", "target", "debug", primary),
    path.join(__dirname, "..", "..", "target", "release", primary),
    path.join(__dirname, "..", "..", "target", "debug", primary),
    path.join(cwd, "uma", "target", "release", fallback),
    path.join(cwd, "uma", "target", "debug", fallback),
    primary,
    fallback,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Nothing exists anywhere: return a path anyway (callers spawn it), but
  // runUma turns the failure into an actionable error for the model.

  return primary;
}

export function runUma(
  binPath: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  // The missing-engine case must reach the MODEL as an instruction, not
  // surface as a bare ENOENT: a model that sees only "spawn failed"
  // improvises (it once stored a memory rule in an unrelated gotchas
  // file). Tell it exactly what happened and what to tell the operator.
  if (!fs.existsSync(binPath)) {
    return Promise.reject(
      new Error(
        `UMA engine binary not found (looked for: ${binPath} and standard locations). ` +
        "Do NOT store this request anywhere else. " +
        "Tell the operator to restore the engine: reinstall the plugin " +
        "(pi update --extensions) or build it (cd core && cargo build --release).",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    execFile(binPath, args, { cwd }, (error, stdout, stderr) => {
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

export interface FactSummary {
  id: string;
  title: string;
  type: string;
  scope: string;
  tags: string[];
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
    };
    return {
      id: raw.id,
      title: raw.title,
      type: enumValue(raw.fact_type),
      scope: scopeValue(raw.scope),
      tags: raw.tags ?? [],
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
