/**
 * Staged-draft adapter for the dash (Proposal 10 §13 delta).
 *
 * The shadow worker and the muscle synthesiser park proposals in
 * `<store>/.staging/*.json`; they are *not* facts — they are invisible to
 * `list`/`search`/`read` and only reachable through `uma staging`. The
 * dashboard shows them read-only: reviewing (approve/discard) stays in the TUI
 * modal, where consent lives.
 *
 * Invariant: the drafts view never promotes anything. If a draft is approved
 * elsewhere, the next fetch simply stops listing it.
 */

import { findUmaBinary, runUma } from "../../shared/client.ts";
import { normalizeRecord, tryParseJson, type DashFact, type JsonValue } from "./record.ts";

/** A proposal awaiting review, with the fact it would become. */
export interface DashDraft {
  id: string;
  /** Engine confidence 0..1. */
  confidence: number;
  /** What produced it: spai_done, muscle_synthesis, … */
  trigger: string;
  sessionId?: string;
  context?: string;
  proposed: DashFact;
}

export interface DraftsPage {
  drafts: DashDraft[];
  /** Engine note (e.g. unreadable staging files), carried, never dropped. */
  warning?: string;
}

export type DraftsResult<T> = { ok: true; value: T } | { ok: false; error: string };

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normalizes one staged draft record. */
export function normalizeDraft(raw: Record<string, JsonValue>): DashDraft {
  const provenance = asObject(raw.provenance);
  return {
    id: optionalString(raw.id) ?? "",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    trigger: optionalString(provenance.trigger_type) ?? "unknown",
    sessionId: optionalString(provenance.session_id),
    context: optionalString(provenance.context),
    proposed: normalizeRecord(asObject(raw.fact)),
  };
}

/** Parses `uma staging list --json` output. Throws on bad JSON. */
export function normalizeDrafts(stdout: string): DashDraft[] {
  const parsed = tryParseJson(stdout);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array of drafts");
  return parsed.map((item) => normalizeDraft(asObject(item)));
}

/** Strips the engine's leading "! " marker from a stderr warning line. */
export function cleanWarning(stderr: string): string | undefined {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return line.replace(/^!\s*/, "");
}

/** Shared runner: drafts come with a stderr channel worth keeping. */
async function runStaging(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string }> {
  const binPath = findUmaBinary(cwd);
  try {
    const res = await runUma(binPath, args, cwd);
    if (res.code !== 0) {
      const line = (res.stderr || res.stdout).split("\n")[0].trim() || `exit code ${res.code}`;
      return { ok: false, error: `staging: ${line}` };
    }
    return { ok: true, stdout: res.stdout, stderr: res.stderr };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, error: `staging: ${msg}` };
  }
}

/**
 * Lists the drafts of the store the engine resolves for `cwd` (the current
 * project; `uma staging` has no `--scope`). Unreadable staging files are
 * reported by the engine on stderr and surface here as a warning.
 */
export async function fetchDrafts(cwd: string): Promise<DraftsResult<DraftsPage>> {
  const res = await runStaging(cwd, ["staging", "list", "--json"]);
  if (!res.ok) return res;
  try {
    return {
      ok: true,
      value: { drafts: normalizeDrafts(res.stdout), warning: cleanWarning(res.stderr) },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `staging: unparseable engine output (${msg})` };
  }
}

/** Fetches one draft (`uma staging show --json <id>`). */
export async function fetchDraft(cwd: string, id: string): Promise<DraftsResult<DashDraft>> {
  const safeId = id.trim();
  if (!safeId) return { ok: false, error: "staging: missing draft id" };
  const res = await runStaging(cwd, ["staging", "show", "--json", safeId]);
  if (!res.ok) return res;
  try {
    const parsed = tryParseJson(res.stdout);
    const raw = Array.isArray(parsed) ? parsed[0] : parsed;
    return { ok: true, value: normalizeDraft(asObject(raw)) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `staging: unparseable engine output (${msg})` };
  }
}
