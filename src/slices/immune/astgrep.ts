/**
 * Real ast-grep contract matching for the inline immune path (SPAI-049).
 *
 * Mirrors core/uma-core/src/contracts/ops.rs: the contract becomes a rule
 * YAML file, the proposed edit becomes a snippet file, and
 * `ast-grep scan --json=compact --rule ...` does the matching. No regex
 * transliteration — ast-grep metavariables ($VAR, $$$VAR) keep their real
 * semantics across string literals, semicolons and newlines, so a deny
 * contract can no longer silently miss a real breach inline.
 *
 * Degradation is VISIBLE and fail-safe: without ast-grep, with an unknown
 * language, or on a failed/timed-out scan, a deny contract downgrades to a
 * warn-severity breach carrying a note — it can neither silently pass nor
 * silently block, and decideImmuneAction never hard-blocks a warn-severity
 * breach (auto-blocking stays reserved for verified deterministic matches).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ContractDefinition } from "../../shared/types.js";

/** Upper bound per scan: a warning that costs 10s is worse than none.
 *  Passed to execFile as its timeout so the child is reaped instead of
 *  orphaned (the SPAI-052 invariant: never race a bare abandoned promise
 *  around a spawned process). */
const SCAN_TIMEOUT_MS = 10_000;

/** One contract rule handed to the scanner. */
export interface ContractRuleInput {
  id: string;
  contract: ContractDefinition;
}

/** Per-rule verification result. Exactly one of matched/degraded holds. */
export interface RuleScanResult {
  ruleId: string;
  matched: boolean;
  snippet?: string;
  /** Set when the rule could NOT be verified — the reason is shown. */
  degraded?: string;
}

export interface InlineScanReport {
  /** False when ast-grep itself is unavailable: EVERY rule degrades. */
  available: boolean;
  unavailableReason?: string;
  results: RuleScanResult[];
}

/** Normalized ast-grep language id for one rule, or undefined. */
function ruleLanguage(contract: ContractDefinition): string | undefined {
  const raw = contract.rule.language?.toLowerCase();
  if (!raw) return undefined;
  const aliases: Record<string, string> = {
    rs: "rust", ts: "typescript", tsx: "typescript", js: "javascript",
    jsx: "javascript", py: "python", golang: "go",
  };
  return aliases[raw] ?? raw;
}

const EXT_LANGUAGE: Record<string, string> = {
  rs: "rust", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python", go: "go", c: "c", h: "c", cpp: "cpp", cc: "cpp",
  cxx: "cpp", hpp: "cpp", java: "java", kt: "kotlin", swift: "swift", rb: "ruby",
  cs: "csharp", html: "html", css: "css", scss: "css", json: "json", yaml: "yaml",
  yml: "yaml", toml: "toml", lua: "lua", php: "php", sh: "bash", bash: "bash",
  sql: "sql", dart: "dart", scala: "scala", hs: "haskell", ex: "elixir",
};

const LANGUAGE_DEFAULT_EXT: Record<string, string> = {
  rust: ".rs", typescript: ".ts", javascript: ".js", python: ".py", go: ".go",
  c: ".c", cpp: ".cpp", java: ".java", kotlin: ".kt", swift: ".swift",
  ruby: ".rb", csharp: ".cs", html: ".html", css: ".css", json: ".json",
  yaml: ".yml", toml: ".toml", lua: ".lua", php: ".php", bash: ".sh",
  sql: ".sql", dart: ".dart", scala: ".scala", haskell: ".hs", elixir: ".ex",
};

/**
 * The language a rule is scanned with: the contract's explicit language if
 * it carries one, else the edited file's extension (which is also what the
 * snippet file is named after). An unknown language degrades the rule —
 * guessing Rust (the engine's store-side default) would parse arbitrary
 * snippets with the wrong tree and silently check nothing.
 */
export function languageForRule(contract: ContractDefinition, filePath: string):
  | { language: string; snippetExt: string }
  | { language: undefined; snippetExt: undefined } {
  const explicit = ruleLanguage(contract);
  const ext = path.extname(filePath).toLowerCase();
  const fromExt = ext ? EXT_LANGUAGE[ext.slice(1)] : undefined;
  const language = explicit ?? fromExt;
  if (!language) return { language: undefined, snippetExt: undefined };
  const snippetExt = ext || LANGUAGE_DEFAULT_EXT[language];
  if (!snippetExt) return { language: undefined, snippetExt: undefined };
  return { language, snippetExt };
}

/** Mirrors mod.rs find_ast_grep: PATH first, the npm sg.exe shim on Windows
 *  ONLY (on Unix /usr/bin/sg is shadow-utils' setgid tool, never ast-grep),
 *  then the known @ast-grep/cli layouts under ~/.pi/agent/npm. The `.cmd`
 *  shim is deliberately not used — execFile cannot reap a cmd.exe wrapper. */
export function findAstGrep(): string | undefined {
  const binary = process.platform === "win32" ? "ast-grep.exe" : "ast-grep";
  const found = findInPath(binary);
  if (found) return found;
  if (process.platform === "win32") {
    const shim = findInPath("sg.exe");
    if (shim) return shim;
  }
  const piNpm = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "@ast-grep");
  const candidates = [
    `cli-win32-x64-msvc/ast-grep.exe`,
    `cli-linux-x64-gnu/ast-grep`,
    `cli-linux-x64-musl/ast-grep`,
    `cli-darwin-x64/ast-grep`,
    `cli-darwin-arm64/ast-grep`,
  ].map((rel) => path.join(piNpm, ...rel.split("/")));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function findInPath(binary: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, binary);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Escapes a value for a double-quoted YAML scalar. */
function yamlQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Structural blind spots of a BARE ast-grep `pattern:` rule — cases where a
 * syntactically valid pattern silently matches nothing (verified against
 * ast-grep 0.45):
 *
 * 1. A metavariable inside a string literal: string contents are an atomic
 *    token, so `from "../commands/$$$B"` never matches `"../commands/x.ts"`.
 * 2. A metavariable directly after `::`: scoped paths are RIGHT-NESTED nodes
 *    (scoped_identifier(scoped_identifier, ::, id)), so the metavariable
 *    binds only ONE trailing segment — `use crate::slices::$$$REST;` misses
 *    `use crate::slices::doctor::checks::inspect_index;` entirely.
 *
 * Both shipped VSA contract patterns hit these spots, so a rule carrying one
 * degrades VISIBLY (deny→warn with note) instead of silently matching
 * nothing — the exact silent-miss SPAI-049 exists to prevent.
 */
function patternBlindSpot(pattern: string): string | undefined {
  if (/"[^"\n]*\$[A-Z]|'[^'\n]*\$[A-Z]/.test(pattern)) {
    return "metavariable inside a string literal never matches (strings are atomic)";
  }
  // Path-anchored blind spot. Verified empirically (ast-grep 0.45): the
  // STATEMENT form `use crate::slices::$$$REST;` matches only shallow
  // imports, but the BARE-PATH form `crate::slices::$$$REST` matches deep
  // paths via subtree matching. Statement patterns contain whitespace;
  // bare paths do not — so only flag the former.
  if (/::\s*\$+\{?[A-Z]/.test(pattern) && /\s/.test(pattern)) {
    return "metavariable after '::' binds a single path segment only";
  }
  return undefined;
}

/** The rule YAML for one contract, or undefined when it cannot be expressed
 *  as a single-line YAML rule (multi-line patterns degrade visibly). */
function ruleYaml(id: string, contract: ContractDefinition): string | undefined {
  const { language } = languageForRule(contract, "");
  const langId = language ?? "";
  if (!langId || /[\r\n]/.test(contract.rule.pattern)) return undefined;
  const severity = contract.severity === "warn" ? "warning" : "error";
  return (
    `id: uma-${id.toLowerCase()}\n` +
    `message: "${yamlQuote(contract.rule.message)}"\n` +
    `severity: ${severity}\n` +
    `language: ${langId}\n` +
    `rule:\n` +
    `  pattern: "${yamlQuote(contract.rule.pattern)}"\n`
  );
}

interface AstGrepMatch {
  ruleId?: string;
  lines?: string;
}

function execScan(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; failed?: string }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { cwd, timeout: SCAN_TIMEOUT_MS, killSignal: "SIGKILL" as const },
      (error, stdout) => {
        const out = String(stdout ?? "");
        if (error && (error as { killed?: boolean }).killed) {
          resolve({ stdout: out, failed: "scan timed out" });
          return;
        }
        // ast-grep exits 1 whenever error-severity findings exist — that is a
        // SUCCESSFUL scan (engine parity: ops.rs only distrusts a non-zero
        // exit with NO findings output). A failed run yields empty stdout.
        if (error && out.trim() === "") {
          resolve({ stdout: out, failed: "ast-grep scan failed" });
          return;
        }
        resolve({ stdout: out });
      },
    );
  });
}

/** Verifies every applicable rule against the proposed edit with real
 *  ast-grep matching. Never throws: every failure becomes a degradation. */
export async function scanContractRules(
  rules: ContractRuleInput[],
  filePath: string,
  addedText: string,
): Promise<InlineScanReport> {
  const bin = findAstGrep();
  if (!bin) {
    return {
      available: false,
      unavailableReason: "ast-grep executable not found",
      results: [],
    };
  }

  const results: RuleScanResult[] = [];
  for (const { id, contract } of rules) {
    // Blind-spot patterns would scan to a silent zero — degrade instead.
    const blind = patternBlindSpot(contract.rule.pattern);
    if (blind) {
      results.push({ ruleId: id, matched: false, degraded: blind });
      continue;
    }
    const yaml = ruleYaml(id, contract);
    const { snippetExt } = languageForRule(contract, filePath);
    if (!yaml || !snippetExt) {
      results.push({
        ruleId: id,
        matched: false,
        degraded: "contract language/pattern cannot be verified inline",
      });
      continue;
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-immune-"));
    try {
      const rulePath = path.join(dir, "rule.yml");
      const snippetPath = path.join(dir, `snippet${snippetExt}`);
      fs.writeFileSync(rulePath, yaml);
      fs.writeFileSync(snippetPath, addedText);
      const { stdout, failed } = await execScan(
        bin,
        ["scan", "--json=compact", "--rule", "rule.yml", `snippet${snippetExt}`],
        dir,
      );
      if (failed) {
        results.push({ ruleId: id, matched: false, degraded: failed });
        continue;
      }
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === "[]") {
        results.push({ ruleId: id, matched: false });
        continue;
      }
      let matches: AstGrepMatch[];
      try {
        matches = JSON.parse(trimmed) as AstGrepMatch[];
      } catch {
        results.push({ ruleId: id, matched: false, degraded: "unparsable ast-grep output" });
        continue;
      }
      const hit = matches.find((m) => (m.ruleId ?? "").toLowerCase() === `uma-${id.toLowerCase()}`);
      if (hit) {
        results.push({ ruleId: id, matched: true, snippet: (hit.lines ?? "").trim() });
      } else {
        results.push({ ruleId: id, matched: false });
      }
    } catch {
      results.push({ ruleId: id, matched: false, degraded: "inline scan could not run" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return { available: true, results };
}
