import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PluginConfig } from "./types.js";

const DEFAULT_CONFIG: PluginConfig = {
  lang: "cs",
  autoApprove: false,
  // S3 was paused by operator preference; the gate reopens it only when the
  // operator flips it on explicitly.
  recallGate: false,
  // Warn-only keeps the pre-existing interceptor behavior as the default;
  // stronger modes are the operator's explicit choice.
  immuneMode: "warn",
  fastbrainJudge: "off",
  hud: true,
  // The humility confirm gate is a stronger measure — the operator's explicit
  // choice (/uma humility on), consistent with immuneMode's default-warn.
  humilityGate: false,
  // System prompt enhancement (append rules into systemPromptOptions.sections.uma_rules)
  appendPrompt: false,
};

export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "uma.json");
}

/**
 * Security allowlist: Keys that a repository's `.pi/uma.json` is allowed to override.
 * Sensitive operational and security gates (`autoApprove`, `appendPrompt`, `immuneMode`)
 * can ONLY be configured globally by the operator (`~/.pi/agent/uma.json`), never by
 * a cloned project repo.
 */
export const PROJECT_ALLOWED_KEYS: ReadonlySet<keyof PluginConfig> = new Set([
  "lang",
  "recallGate",
  "fastbrainJudge",
  "hud",
  "humilityGate",
]);

/**
 * Validates and sanitizes untrusted configuration objects, dropping unknown or disallowed keys
 * and ensuring enum and boolean values strictly conform to PluginConfig types.
 */
export function sanitizeConfig(
  raw: unknown,
  allowedKeys?: ReadonlySet<keyof PluginConfig>
): Partial<PluginConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const clean: Partial<PluginConfig> = {};

  const isAllowed = (k: keyof PluginConfig) => !allowedKeys || allowedKeys.has(k);

  if (isAllowed("lang") && typeof obj.lang === "string") {
    const lang = obj.lang.toLowerCase();
    if (lang === "cs" || lang === "en") {
      clean.lang = lang as PluginConfig["lang"];
    }
  }
  if (isAllowed("autoApprove") && typeof obj.autoApprove === "boolean") {
    clean.autoApprove = obj.autoApprove;
  }
  if (isAllowed("recallGate") && typeof obj.recallGate === "boolean") {
    clean.recallGate = obj.recallGate;
  }
  if (isAllowed("immuneMode") && typeof obj.immuneMode === "string") {
    const mode = obj.immuneMode.toLowerCase();
    if (["off", "warn", "ask", "auto", "block"].includes(mode)) {
      clean.immuneMode = mode as PluginConfig["immuneMode"];
    }
  }
  if (isAllowed("fastbrainJudge") && typeof obj.fastbrainJudge === "string") {
    const judge = obj.fastbrainJudge.toLowerCase();
    if (judge === "off" || judge === "jev") {
      clean.fastbrainJudge = judge as PluginConfig["fastbrainJudge"];
    }
  }
  if (isAllowed("hud") && typeof obj.hud === "boolean") {
    clean.hud = obj.hud;
  }
  if (isAllowed("humilityGate") && typeof obj.humilityGate === "boolean") {
    clean.humilityGate = obj.humilityGate;
  }
  if (isAllowed("appendPrompt") && typeof obj.appendPrompt === "boolean") {
    clean.appendPrompt = obj.appendPrompt;
  }

  return clean;
}

export function loadConfig(cwd: string): { config: PluginConfig; globalFile: string } {
  const globalFile = getGlobalConfigPath();
  let merged: PluginConfig = { ...DEFAULT_CONFIG };

  // 1. Load global config (all keys allowed, sanitized against schema)
  if (fs.existsSync(globalFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(globalFile, "utf-8"));
      merged = { ...merged, ...sanitizeConfig(data) };
    } catch {
      // ignore invalid json
    }
  }

  // 2. Load project config (.pi/uma.json) strictly gated by PROJECT_ALLOWED_KEYS
  const projectFile = path.join(cwd, ".pi", "uma.json");
  if (fs.existsSync(projectFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(projectFile, "utf-8"));
      merged = { ...merged, ...sanitizeConfig(data, PROJECT_ALLOWED_KEYS) };
    } catch {
      // ignore invalid json
    }
  }

  return { config: merged, globalFile };
}

export function saveConfig(
  patch: Partial<PluginConfig>,
  isGlobal: boolean,
  cwd: string,
  globalFile: string
): void {
  const targetFile = isGlobal ? globalFile : path.join(cwd, ".pi", "uma.json");
  const targetDir = path.dirname(targetFile);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(targetFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const sanitizedPatch = isGlobal
    ? sanitizeConfig(patch)
    : sanitizeConfig(patch, PROJECT_ALLOWED_KEYS);

  const updated = { ...existing, ...sanitizedPatch };
  fs.writeFileSync(targetFile, JSON.stringify(updated, null, 2), "utf-8");
}
