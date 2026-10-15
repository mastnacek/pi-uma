/**
 * The dash record model: what a fact looks like after normalization, and the
 * pure parsers that get there (Proposal 10 §13 delta).
 *
 * `uma` serializes the same fact differently per command — `list --json` has no
 * status/validity/provenance, `read --json` has everything, `search --json` has
 * hits with lowercase status and a snippet. Normalization erases those
 * differences here, once, so renderers never branch on command output shape.
 *
 * Everything is parsed defensively: a stored record is data written by an older
 * engine and must not be able to crash a renderer.
 */

import type {
  ContractDefinition,
  PlasticityDefinition,
  SaliencyDefinition,
} from "../../shared/types.js";

/** Page size for the fact list, the search cap and the "load more" sentinel. */
export const PAGE_SIZE = 50;

/** Validity window of a fact, as far as the engine reported it. */
export interface DashValidity {
  since?: string;
  staleAfter?: string;
  until?: string;
}

/** One provenance entry (`generated` / `verified`). */
export interface DashProvenance {
  by?: string;
  at?: string;
}

/** One browsable fact, unified from list records, read records and search hits. */
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
  /** Engine status: "stable" | "deprecated" | "superseded" | … */
  status?: string;
  weight: number | null;
  /** True when the fact is no longer active (status ≠ stable). */
  deprecated: boolean;

  // ── full-record metadata (read --json; absent on search hits) ────────────
  description?: string;
  supersedes?: string;
  links: string[];
  spai: string[];
  validity: DashValidity;
  generatedBy?: string;
  verified: DashProvenance[];
  /** Executable AST invariant (Proposal 03a), when the fact carries one. */
  contract?: ContractDefinition;
  /** Invocation template for `skill` facts. Data only — never executed. */
  template?: string;
  plasticity?: PlasticityDefinition;
  saliency?: SaliencyDefinition;
}

/** A parsed JSON document (strict recursive type for parse boundaries). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Controlled JSON.parse: wraps the SyntaxError in a domain error message. */
export function tryParseJson(stdout: string): JsonValue {
  try {
    return JSON.parse(stdout) as JsonValue;
  } catch (err) {
    throw new Error(`invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function positiveNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseValidity(value: JsonValue | undefined): DashValidity {
  const raw = asRecord(value);
  if (!raw) return {};
  return {
    since: optionalString(raw.since),
    staleAfter: optionalString(raw.stale_after),
    until: optionalString(raw.until),
  };
}

function parseProvenance(value: JsonValue | undefined): DashProvenance[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter((r): r is Record<string, JsonValue> => r !== undefined)
    .map((r) => ({ by: optionalString(r.by), at: optionalString(r.at) }));
}

/** Parses the AST contract block (`{engine, severity, rule{…}}`). */
function parseContract(value: JsonValue | undefined): ContractDefinition | undefined {
  const raw = asRecord(value);
  const rule = asRecord(raw?.rule);
  if (!raw || !rule) return undefined;
  const pattern = optionalString(rule.pattern);
  const message = optionalString(rule.message);
  if (!pattern || !message) return undefined;
  return {
    engine: optionalString(raw.engine) ?? "unknown",
    severity: raw.severity === "deny" ? "deny" : "warn",
    rule: {
      pattern,
      inside: optionalString(rule.inside),
      language: optionalString(rule.language),
      message,
    },
  };
}

function parsePlasticity(value: JsonValue | undefined): PlasticityDefinition | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const weight = positiveNumber(raw.weight);
  if (weight === undefined) return undefined;
  return {
    weight,
    reinforcements: positiveNumber(raw.reinforcements) ?? 0,
    frustrations: positiveNumber(raw.frustrations) ?? 0,
    last_activated: optionalString(raw.last_activated),
    half_life_days: positiveNumber(raw.half_life_days) ?? 0,
  };
}

function parseSaliency(value: JsonValue | undefined): SaliencyDefinition | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const shock = positiveNumber(raw.shock_level);
  if (shock === undefined) return undefined;
  return {
    shock_level: shock,
    multiplier: positiveNumber(raw.multiplier) ?? 1,
    immune_to_decay: raw.immune_to_decay === true,
  };
}

/** Normalizes one raw record (list/read JSON shape) into a DashFact. */
export function normalizeRecord(raw: Record<string, JsonValue>): DashFact {
  const status = optionalString(raw.status)?.toLowerCase();
  return {
    id: optionalString(raw.id) ?? "",
    title: optionalString(raw.title) ?? "",
    factType: (optionalString(raw.fact_type) ?? "note").toLowerCase(),
    scope: normalizeScope(raw.scope),
    tags: stringList(raw.tags),
    body: optionalString(raw.body),
    status,
    weight: positiveNumber(raw.effective_weight) ?? null,
    deprecated: status !== undefined && status !== "stable",
    description: optionalString(raw.description),
    supersedes: optionalString(raw.supersedes),
    links: stringList(raw.links),
    spai: stringList(raw.spai),
    validity: parseValidity(raw.validity),
    generatedBy: optionalString(asRecord(raw.generated)?.by),
    verified: parseProvenance(raw.verified),
    contract: parseContract(raw.contract),
    template: optionalString(raw.template),
    plasticity: parsePlasticity(raw.plasticity),
    saliency: parseSaliency(raw.saliency),
  };
}

/** Accepts "global" / "Global" / "project:x" / { "Project": "x" } / { "Global": null }. */
export function normalizeScope(value: JsonValue | undefined): string {
  if (typeof value !== "string") {
    const obj = asRecord(value);
    const project = optionalString(obj?.Project);
    if (project) return `project:${project}`;
    return "project";
  }
  const lower = value.toLowerCase();
  if (lower === "global") return "global";
  if (lower.startsWith("project:")) return value;
  return `project:${value}`;
}

/** Parses `uma list --json` output into unified facts. Throws on bad JSON. */
export function normalizeListFacts(stdout: string): DashFact[] {
  const parsed = tryParseJson(stdout);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
  return parsed.map((item) => normalizeRecord(asRecord(item) ?? {}));
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
  const root = asRecord(parsed);
  if (!root || !Array.isArray(root.hits)) throw new Error("expected a hits array");
  const hits = root.hits.map((hit) => {
    const record = asRecord(hit) ?? {};
    const fact = normalizeRecord(record);
    return {
      ...fact,
      snippet: optionalString(record.snippet),
      body: undefined,
      status: fact.status ?? "stable",
      deprecated: (fact.status ?? "stable") !== "stable",
    };
  });
  const rawNote = optionalString(root.note);
  if (root.degraded === true && !rawNote) {
    return { hits, note: "search degraded to keyword-only results (no embeddings available)" };
  }
  return { hits, note: rawNote };
}

/** Deprecated alias kept for callers that only want the hits. */
export function normalizeSearchHits(stdout: string): DashFact[] {
  return parseSearchJson(stdout).hits;
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
export function pageFacts(
  facts: DashFact[],
  offset: number,
  limit: number = PAGE_SIZE,
): { facts: DashFact[]; hasMore: boolean; total: number } {
  const start = Math.max(0, offset);
  return {
    facts: facts.slice(start, start + limit),
    hasMore: facts.length > start + limit,
    total: facts.length,
  };
}

/** Marks the facts that are absent from the active set as deprecated. */
export function markInactive(all: DashFact[], activeIds: Set<string>): DashFact[] {
  return all.map((fact) =>
    activeIds.has(fact.id)
      ? fact
      : { ...fact, deprecated: true, status: fact.status ?? "deprecated" },
  );
}
