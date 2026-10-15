/**
 * Data adapter for the /uma dash browser dashboard (Proposal 10).
 *
 * Every fact the dashboard shows flows through the existing `uma` CLI JSON
 * output — the engine stays harness-agnostic and sync, the plugin owns the
 * HTTP surface. This module is the only place that talks to the engine; the
 * renderers in fragments.ts are pure string-in/string-out.
 *
 * Invariants:
 * - Read-only: only `list` / `search` / `read` with `--json` are invoked.
 * - Degradation is data, not an exception: a non-zero exit or unparseable
 *   JSON becomes `{ ok: false, error }` so the HTTP layer can render an
 *   error fragment instead of crashing the handler.
 */

// `.ts` specifier (not `.js`): data.ts is imported directly by the test suite
// under `node --experimental-strip-types`, which resolves real file names.
// Precedent: complete.ts imports command_help.ts. Type-only `.js` imports in
// client.ts are erased, so this chain stays loadable in tests.
import { findUmaBinary, runUma } from "../../shared/client.ts";

/** One browsable fact, unified from `list` full records and `search` hits. */
export interface DashFact {
  id: string;
  title: string;
  factType: string;
  /** "global" or "project:<name>" as serialized by the engine. */
  scope: string;
  tags: string[];
  /** Search-hit snippet (may contain [match] markers — fragments strips them). */
  snippet?: string;
  /** Full record body (list/read records only). */
  body?: string;
  /** Search-hit status; "stable" or anything else (e.g. "deprecated"). */
  status?: string;
  weight: number | null;
  deprecated: boolean;
}

export interface FactsPage {
  facts: DashFact[];
  hasMore: boolean;
  total: number;
  /** Engine degradation note (hybrid fell back to keyword-only), when present.
   *  Never dropped: the engine's own rule is that a caller who asked for hybrid
   *  ranking must not silently receive BM25. */
  note?: string;
}

export type DataResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DashQuery {
  q: string;
  type: string;
  scope: string;
  offset: number;
}

/** Page size for the fact list and its "load more" sentinel. */
export const PAGE_SIZE = 50;

/** Normalizes one raw CLI record (list/read JSON shape) into a DashFact. */
export function normalizeRecord(raw: Record<string, unknown>): DashFact {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    factType: String(raw.fact_type ?? "note").toLowerCase(),
    scope: normalizeScope(raw.scope),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    body: typeof raw.body === "string" ? raw.body : undefined,
    weight: typeof raw.effective_weight === "number" ? raw.effective_weight : null,
    deprecated: false,
  };
}

/** Accepts "global" / "Global" / "project:x" / { "Project": "x" } / { "Global": null }. */
export function normalizeScope(value: unknown): string {
  if (typeof value !== "string") {
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.Project === "string" && obj.Project.length > 0) {
        return `project:${obj.Project}`;
      }
    }
    return "project";
  }
  const lower = value.toLowerCase();
  if (lower === "global") return "global";
  if (lower.startsWith("project:")) return value;
  return `project:${value}`;
}

/** A parsed JSON document (strict recursive domain type for parse boundaries). */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Controlled JSON.parse: wraps the SyntaxError in a domain error message. */
function tryParseJson(stdout: string): JsonValue {
  try {
    return JSON.parse(stdout) as JsonValue;
  } catch (err) {
    throw new Error(`invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Parses `uma list --json` output into unified facts. Throws on bad JSON. */
export function normalizeListFacts(stdout: string): DashFact[] {
  const parsed = tryParseJson(stdout);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
  return parsed.map((item) => normalizeRecord(item as Record<string, unknown>));
}

/** One `uma search --json` document: the hits plus the degradation note. */
export interface SearchOutcome {
  hits: DashFact[];
  /** The engine's one-line explanation, or undefined when nothing degraded. */
  note?: string;
}

/** Parses `uma search --json` output (hits + degradation). Throws on bad JSON. */
export function parseSearchJson(stdout: string): SearchOutcome {
  const parsed = tryParseJson(stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.hits)) {
    throw new Error("expected a hits array");
  }
  const hits = parsed.hits.map((hit) => {
    const record = hit as Record<string, unknown>;
    const status = typeof record.status === "string" ? record.status : "stable";
    return {
      ...normalizeRecord(record),
      snippet: typeof record.snippet === "string" ? record.snippet : undefined,
      body: undefined,
      status,
      deprecated: status !== "stable",
    };
  });
  const note = typeof parsed.note === "string" && parsed.note.length > 0 ? parsed.note : undefined;
  const degraded = parsed.degraded === true;
  if (degraded && !note) {
    return { hits, note: "search degraded to keyword-only results (no embeddings available)" };
  }
  return { hits, note };
}

/** Deprecated alias kept for callers that only want the hits. */
export function normalizeSearchHits(stdout: string): DashFact[] {
  return parseSearchJson(stdout).hits;
}

/**
 * The engine `search` invocation for a query. Type/scope go to the CLI so the
 * engine filters BEFORE its result cap — filtering the returned top-N in code
 * could report "no facts match" while matches exist past the cap. `-n` lifts
 * the 10-hit default so the list can page like the browse path.
 */
export function searchArgs(query: DashQuery): string[] {
  const args = ["search", "--json", "-n", String(PAGE_SIZE)];
  if (query.type) args.push("--type", query.type);
  // The CLI resolves the literals "global" / "project" itself.
  if (query.scope === "global" || query.scope === "project") {
    args.push("--scope", query.scope);
  }
  args.push(query.q);
  return args;
}

/** Applies the dashboard's type/scope chips to an already-fetched set. */
export function filterFacts(
  facts: DashFact[],
  filters: { type?: string; scope?: string },
): DashFact[] {
  const type = filters.type?.trim().toLowerCase();
  const scope = filters.scope?.trim().toLowerCase();
  return facts.filter((f) => {
    if (type && f.factType !== type) return false;
    if (scope === "global" && f.scope !== "global") return false;
    if (scope === "project" && f.scope === "global") return false;
    return true;
  });
}

/** Slices a filtered set into one page for the fragment renderer. */
export function pageFacts(facts: DashFact[], offset: number, limit = PAGE_SIZE): FactsPage {
  const start = Math.max(0, offset);
  return {
    facts: facts.slice(start, start + limit),
    hasMore: facts.length > start + limit,
    total: facts.length,
  };
}

function engineError(prefix: string, res: { stderr: string; stdout: string; code: number }): DataResult<never> {
  const firstLine = (res.stderr || res.stdout || `exit code ${res.code}`).split("\n")[0].trim();
  return { ok: false, error: `${prefix}: ${firstLine || `exit code ${res.code}`}` };
}

function parseFailure(prefix: string, err: unknown): DataResult<never> {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: `${prefix}: unparseable engine output (${msg})` };
}

/** Runs the CLI with shared error/parse handling; `parse` throws on bad JSON. */
async function runJson<T>(
  cwd: string,
  args: string[],
  prefix: string,
  parse: (stdout: string) => T,
): Promise<DataResult<T>> {
  const binPath = findUmaBinary(cwd);
  try {
    const res = await runUma(binPath, args, cwd);
    if (res.code !== 0) return engineError(prefix, res);
    try {
      return { ok: true, value: parse(res.stdout) };
    } catch (err) {
      return parseFailure(prefix, err);
    }
  } catch (err) {
    // Missing binary etc.: surface the instructional error as a fragment.
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, error: `${prefix}: ${msg}` };
  }
}

/**
 * The CLI `list` invocations a scope chip needs. The engine lists one store at
 * a time and defaults to the current project, so "all" merges both ("🌐 global"
 * would otherwise always render empty from a bare `list`).
 */
function listArgsForScope(scope: string): string[][] {
  if (scope === "global") return [["list", "--json", "--scope", "global"]];
  if (scope === "project") return [["list", "--json"]];
  return [["list", "--json"], ["list", "--json", "--scope", "global"]];
}

/** Lists the stores the scope chip asks for, merged and deduped by fact id. */
async function fetchAllLists(cwd: string, scope: string): Promise<DataResult<DashFact[]>> {
  const results = await Promise.all(
    listArgsForScope(scope).map((args) => runJson(cwd, args, "list", normalizeListFacts)),
  );
  const merged = new Map<string, DashFact>();
  for (const result of results) {
    if (!result.ok) return result;
    for (const f of result.value) merged.set(f.id, f);
  }
  return { ok: true, value: [...merged.values()] };
}

/**
 * Fetches one page of facts for the list fragment: the engine's hybrid search
 * when `q` is non-empty, a merged list otherwise (the engine lists one store at
 * a time). Type/scope chips go to the CLI where the CLI supports them and are
 * re-applied in code as a safety net, so both paths agree.
 */
export async function fetchFacts(cwd: string, query: DashQuery): Promise<DataResult<FactsPage>> {
  const filters = { type: query.type, scope: query.scope };
  if (query.q.trim()) {
    const found = await runJson(cwd, searchArgs(query), "search", parseSearchJson);
    if (!found.ok) return found;
    return {
      ok: true,
      value: { ...pageFacts(filterFacts(found.value.hits, filters), query.offset), note: found.value.note },
    };
  }
  const listed = await fetchAllLists(cwd, query.scope);
  if (!listed.ok) return listed;
  return { ok: true, value: pageFacts(filterFacts(listed.value, filters), query.offset) };
}

/** Fetches one full fact for the detail fragment. */
export function fetchFact(cwd: string, id: string): Promise<DataResult<DashFact>> {
  const safeId = id.trim();
  if (!safeId) return Promise.resolve({ ok: false, error: "read: missing fact id" });
  return runJson(cwd, ["read", "--json", safeId], "read", (out) => {
    const parsed = tryParseJson(out);
    const raw: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!raw || typeof raw !== "object") throw new Error("expected a record object");
    return normalizeRecord(raw as Record<string, unknown>);
  });
}

export interface DashCounts {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
}

/** Header counts (total, by type, by scope) across both stores. */
export async function fetchCounts(cwd: string): Promise<DataResult<DashCounts>> {
  const listed = await fetchAllLists(cwd, "");
  if (!listed.ok) return listed;
  const byType: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  for (const f of listed.value) {
    byType[f.factType] = (byType[f.factType] ?? 0) + 1;
    byScope[f.scope] = (byScope[f.scope] ?? 0) + 1;
  }
  return { ok: true, value: { total: listed.value.length, byType, byScope } };
}
