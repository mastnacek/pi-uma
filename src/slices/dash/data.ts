/**
 * Data adapter for the /uma dash browser dashboard (Proposal 10).
 *
 * Every fact the dashboard shows flows through the existing `uma` CLI JSON
 * output — the engine stays harness-agnostic and sync, the plugin owns the
 * HTTP surface. This module is the only place that talks to the engine; the
 * renderers are pure string-in/string-out, and the record model lives in
 * record.ts.
 *
 * Invariants:
 * - Read-only: only `list` / `search` / `read` / `timeline` with `--json`.
 * - Degradation is data, not an exception: a non-zero exit or unparseable
 *   JSON becomes `{ ok: false, error }` so the HTTP layer can render an
 *   error fragment instead of crashing the handler.
 */

import { findUmaBinary, runUma } from "../../shared/client.ts";
import {
  PAGE_SIZE,
  filterFacts,
  markInactive,
  normalizeListFacts,
  normalizeRecord,
  pageFacts,
  parseSearchJson,
  tryParseJson,
  type DashFact,
  type JsonValue,
  type SearchOutcome,
} from "./record.ts";

export {
  PAGE_SIZE,
  filterFacts,
  normalizeListFacts,
  normalizeScope,
  normalizeSearchHits,
  pageFacts,
  parseSearchJson,
} from "./record.ts";
export type { DashFact, SearchOutcome } from "./record.ts";

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
  /** Include deprecated/superseded facts (the history view). */
  history: boolean;
}

/** One revision in a fact's supersession chain. */
export interface DashRevision {
  id: string;
  title: string;
  status: string;
  since?: string;
  until?: string;
}

export interface DashChain {
  current: string;
  length: number;
  hasHistory: boolean;
  revisions: DashRevision[];
}

/**
 * The CLI `list` invocations a scope chip needs. The engine lists one store at
 * a time and defaults to the current project, so "all" merges both ("🌐 global"
 * would otherwise always render empty from a bare `list`).
 */
function listArgsForScope(scope: string, history: boolean): string[][] {
  const include = history ? ["--include-deprecated"] : [];
  if (scope === "global") return [["list", "--json", "--scope", "global", ...include]];
  if (scope === "project") return [["list", "--json", ...include]];
  return [
    ["list", "--json", ...include],
    ["list", "--json", "--scope", "global", ...include],
  ];
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
  if (query.history) args.push("--include-deprecated");
  args.push(query.q);
  return args;
}

function engineError(
  prefix: string,
  res: { stderr: string; stdout: string; code: number },
): DataResult<never> {
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

/** Lists the stores the scope chip asks for, merged and deduped by fact id. */
async function fetchAllLists(
  cwd: string,
  scope: string,
  history: boolean,
): Promise<DataResult<DashFact[]>> {
  const results = await Promise.all(
    listArgsForScope(scope, history).map((args) =>
      runJson(cwd, args, "list", normalizeListFacts),
    ),
  );
  const merged = new Map<string, DashFact>();
  for (const result of results) {
    if (!result.ok) return result;
    for (const f of result.value) merged.set(f.id, f);
  }
  return { ok: true, value: [...merged.values()] };
}

/**
 * Marks the inactive facts. The list JSON carries no status (only `read` does),
 * so the history view derives it: everything present in the `--include-deprecated`
 * listing but absent from the active listing is no longer active. Two cheap CLI
 * calls beat one `read` per fact.
 */
async function withHistoryMarks(
  cwd: string,
  scope: string,
  all: DashFact[],
): Promise<DataResult<DashFact[]>> {
  const active = await fetchAllLists(cwd, scope, false);
  if (!active.ok) return active;
  const activeIds = new Set(active.value.map((f) => f.id));
  return { ok: true, value: markInactive(all, activeIds) };
}

/**
 * Fetches one page of facts for the list fragment: the engine's hybrid search
 * when `q` is non-empty, a merged list otherwise (the engine lists one store at
 * a time). Type/scope chips reach the CLI where the CLI supports them and are
 * re-applied in code as a safety net.
 */
export async function fetchFacts(cwd: string, query: DashQuery): Promise<DataResult<FactsPage>> {
  const filters = { type: query.type, scope: query.scope };
  if (query.q.trim()) {
    const found = await runJson(cwd, searchArgs(query), "search", parseSearchJson);
    if (!found.ok) return found;
    const outcome: SearchOutcome = found.value;
    return {
      ok: true,
      value: {
        ...pageFacts(filterFacts(outcome.hits, filters), query.offset),
        note: outcome.note,
      },
    };
  }
  const listed = await fetchAllLists(cwd, query.scope, query.history);
  if (!listed.ok) return listed;
  const facts = query.history
    ? await withHistoryMarks(cwd, query.scope, listed.value)
    : listed;
  if (!facts.ok) return facts;
  return { ok: true, value: pageFacts(filterFacts(facts.value, filters), query.offset) };
}

/** Fetches one full fact for the detail fragment. */
export function fetchFact(cwd: string, id: string): Promise<DataResult<DashFact>> {
  const safeId = id.trim();
  if (!safeId) return Promise.resolve({ ok: false, error: "read: missing fact id" });
  return runJson(cwd, ["read", "--json", safeId], "read", (out) => {
    const parsed = tryParseJson(out);
    const raw: JsonValue = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("expected a record object");
    }
    return normalizeRecord(raw as Record<string, JsonValue>);
  });
}

/**
 * Fetches the supersession chain containing a fact (`timeline --json --id`).
 * The engine emits the whole chain, oldest revision first, including statuses —
 * so the detail pane can show real history instead of guessing.
 */
/** Parses `uma timeline --json --id <id>` output. Throws on bad JSON. */
export function parseChainJson(stdout: string): DashChain | undefined {
  const parsed = tryParseJson(stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const chain = asObject(parsed[0]);
  const revisions = Array.isArray(chain.revisions) ? chain.revisions : [];
  return {
    current: typeof chain.current === "string" ? chain.current : "",
    length: typeof chain.length === "number" ? chain.length : revisions.length,
    hasHistory: chain.has_history === true,
    revisions: revisions.map((rev) => {
      const r = asObject(rev);
      return {
        id: typeof r.id === "string" ? r.id : "",
        title: typeof r.title === "string" ? r.title : "",
        status: typeof r.status === "string" ? r.status : "unknown",
        since: typeof r.since === "string" ? r.since : undefined,
        until: typeof r.until === "string" ? r.until : undefined,
      };
    }),
  };
}

export function fetchChain(cwd: string, id: string): Promise<DataResult<DashChain | undefined>> {
  const safeId = id.trim();
  if (!safeId) return Promise.resolve({ ok: false, error: "timeline: missing fact id" });
  return runJson(cwd, ["timeline", "--json", "--id", safeId], "timeline", parseChainJson);
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export interface DashCounts {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  /** Facts that are no longer active (deprecated/superseded). */
  inactive: number;
}

/** Header counts (total, by type, by scope, inactive) across both stores. */
export async function fetchCounts(cwd: string): Promise<DataResult<DashCounts>> {
  const all = await fetchAllLists(cwd, "", true);
  if (!all.ok) return all;
  const active = await fetchAllLists(cwd, "", false);
  if (!active.ok) return active;
  const activeIds = new Set(active.value.map((f) => f.id));

  const byType: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  let inactive = 0;
  for (const f of all.value) {
    // Only active facts feed the type/scope mix; the rest are reported as one
    // "inactive" number so the header never implies retired rules are current.
    if (!activeIds.has(f.id)) {
      inactive += 1;
      continue;
    }
    byType[f.factType] = (byType[f.factType] ?? 0) + 1;
    byScope[f.scope] = (byScope[f.scope] ?? 0) + 1;
  }
  return {
    ok: true,
    value: { total: active.value.length, inactive, byType, byScope },
  };
}
