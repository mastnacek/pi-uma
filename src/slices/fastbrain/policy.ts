/**
 * Fastbrain policy: the pure decision half of the recall gate.
 *
 * Deliberately import-free so `node --test` (strip-types) can exercise the
 * policy directly; the transport half lives in index.ts.
 */

/** Verdict of `uma recall check --json`. */
export interface RecallVerdict {
  search: boolean;
  judged_by: string;
  fact_types: string[];
  probability?: number[];
  recalled: number;
  facts: RecallFact[];
  note: string | null;
}

/** The CLI serializes the Scope enum in serde's default external form. */
export type ScopeWire = { Project: string } | "Global";

export interface RecallFact {
  id: string;
  title: string;
  fact_type: string;
  scope: ScopeWire;
  score: number;
  relevance?: number;
  snippet: string;
  tags: string[];
}

/**
 * CLI arguments for one recall-gate check. Every engine judge is passed
 * explicitly: omitting `--judge` makes the engine fall back to the offline
 * marker judge, which silently disabled jev-relevance when only "jev" was
 * mapped here.
 */
export function buildRecallArgs(
  judge: "off" | "jev" | "jev-relevance",
  prompt: string,
  excludeIds: readonly string[],
): string[] {
  return ["recall", "check", "--judge", judge, "--json", "--max", "3"]
    .concat(excludeIds.flatMap((id) => ["--exclude", id]))
    .concat([prompt]);
}

/** The injected message's shape (BeforeAgentStartEventResult["message"]). */
export interface RecallMessage {
  customType: string;
  content: string;
  display: boolean;
  details: { judge: string; count: number; ids: string[] };
}

/** Renders the scope for display: "Global" becomes "global", the tagged
 * variant becomes "project:<name>" — interpolating the raw object was the
 * [object Object] seen in the first live recall injection. */
export function formatScope(scope: ScopeWire): string {
  return typeof scope === "string" ? "global" : `project:${scope.Project}`;
}

/**
 * Injection budget: facts injected into the context per turn, regardless of
 * how many the deeper recall window returned. The window exists to fill the
 * budget despite anti-echo filtering — not to grow the per-turn footprint.
 */
const MAX_INJECTED = 3;

/**
 * Pure decision: what should the hook do with a verdict?
 * No trigger or no facts → nothing is injected.
 *
 * `exclude` carries fact IDs already injected into this session (SPAI-048
 * anti-echo): a fact the model already holds is pure token waste — the
 * injected message persists in the transcript — so it is filtered out, and
 * a verdict whose facts are ALL already in context injects nothing. The
 * engine's window is wider than the budget, so after filtering the budget
 * fills with the next-best NEW facts in rank order; the message details
 * carry the injected ids so session_start can restore the exclusion set
 * after reload/resume without a second gate run.
 */
export function buildRecallMessage(
  verdict: RecallVerdict,
  lang: "cs" | "en",
  exclude?: ReadonlySet<string>,
): { message: RecallMessage } | undefined {
  if (!verdict.search || verdict.facts.length === 0) return undefined;
  const facts = exclude
    ? verdict.facts.filter((fact) => !exclude.has(fact.id))
    : verdict.facts;
  const budget = facts.slice(0, MAX_INJECTED);
  if (budget.length === 0) return undefined;
  const lines = budget.map(
    (fact) =>
      `- [${fact.fact_type}] ${stripMatchMarkers(fact.title)} (${formatScope(fact.scope)}): ${stripMatchMarkers(fact.snippet)}`,
  );
  const header =
    lang === "cs"
      ? "Paměť k tomuto úkolu (použij, kde je relevantní):"
      : "Memory relevant to this task (use where applicable):";
  const content = `${header}\n${lines.join("\n")}`;
  return {
    message: {
      customType: "uma-recall",
      content,
      display: false,
      details: { judge: verdict.judged_by, count: budget.length, ids: budget.map((f) => f.id) },
    },
  };
}

/** Truncates a prompt for the one-line decision report. */
function elide(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= width) return single;
  return `${single.slice(0, width - 1)}…`;
}

/**
 * The engine's BM25 recall marks hit terms with `[match]…[/match]`. Plain-text
 * sinks (the LLM-bound injection, the notify fallback) must never see them —
 * they leaked verbatim into both the transcript and the model's context.
 */
export function stripMatchMarkers(text: string): string {
  return text.replace(/\[match\]|\[\/match\]/g, "");
}

/** Segments of a snippet, split on the engine's [match]…[/match] markers. */
export interface MatchSegment {
  text: string;
  match: boolean;
}

/**
 * Splits a snippet on `[match]…[/match]` markers so a TUI renderer can paint
 * the hit terms instead of showing the raw markers. Marked text is never
 * nested; unmatched markers pass through as plain text.
 */
export function splitMatchMarkers(text: string): MatchSegment[] {
  const segments: MatchSegment[] = [];
  const re = /\[match\]([\s\S]*?)\[\/match\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), match: false });
    segments.push({ text: m[1], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

/**
 * The compact one-line gate report for the notify toast. The full structured
 * view lives in the transcript entry renderer; this is the glanceable summary.
 * `injectedCount` overrides the verdict's recalled count when the anti-echo
 * filter injected fewer facts than the judge recalled.
 */
export function formatGateOneLiner(
  verdict: RecallVerdict,
  lang: "cs" | "en",
  injectedCount?: number,
): string {
  const judge = verdict.judged_by;
  if (!verdict.search) {
    return lang === "cs"
      ? `🧠 ${judge} ○ žádný trigger`
      : `🧠 ${judge} ○ no trigger`;
  }
  const shown = injectedCount ?? verdict.recalled;
  if (shown > 0) {
    return lang === "cs"
      ? `🧠 ${judge} ● trigger → ${czechFactCount(shown)}`
      : `🧠 ${judge} ● trigger → ${shown} fact(s)`;
  }
  return lang === "cs"
    ? `🧠 ${judge} ◐ trigger, nic nenalezeno`
    : `🧠 ${judge} ◐ trigger, nothing found`;
}

/** Checks whether a verdict note represents a degraded/fallback condition. */
export function isDegradedNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const lower = note.toLowerCase();
  return (
    lower.includes("unavailable") ||
    lower.includes("degraded") ||
    lower.includes("fail") ||
    lower.includes("error") ||
    lower.includes("timeout") ||
    lower.includes("fallback")
  );
}

function czechFactCount(count: number): string {
  if (count === 1) return "1 faktum";
  if (count >= 2 && count <= 4) return `${count} fakta`;
  return `${count} faktů`;
}

/**
 * Formats the gate's decision as a clear, visually differentiated report:
 * Distinct header, quoted prompt, clear status bullet, and structured fact items.
 */
export function formatGateDecision(
  prompt: string,
  verdict: RecallVerdict,
  lang: "cs" | "en",
): string {
  const header =
    lang === "cs"
      ? `🧠 UMA FastBrain Recall Gate · Soudce: ${verdict.judged_by}`
      : `🧠 UMA FastBrain Recall Gate · Judge: ${verdict.judged_by}`;

  const promptLine =
    lang === "cs"
      ? `  Dotaz: „${elide(prompt, 60)}“`
      : `  Prompt: "${elide(prompt, 60)}"`;

  const types = verdict.fact_types.join(", ");
  const isDegraded = isDegradedNote(verdict.note);
  const degradationNote =
    isDegraded && verdict.note
      ? lang === "cs"
        ? `  Upozornění: ⚠ ${elide(verdict.note, 100)}`
        : `  Notice: ⚠ ${elide(verdict.note, 100)}`
      : undefined;

  if (!verdict.search) {
    const statusLine =
      lang === "cs"
        ? `  Stav: ○ Žádný trigger → paměť zůstává zavřená`
        : `  Status: ○ No trigger → memory stays closed`;
    const lines = [header, promptLine, statusLine];
    if (degradationNote) lines.push(degradationNote);
    return lines.join("\n");
  }

  const resultLine =
    verdict.recalled > 0
      ? lang === "cs"
        ? `  Výsledek: ● Trigger (${types || "obecný"}) → injektováno ${czechFactCount(verdict.recalled)}`
        : `  Result: ● Trigger (${types || "general"}) → injecting ${verdict.recalled} fact(s)`
      : lang === "cs"
        ? `  Výsledek: ◐ Trigger (${types || "obecný"}), nic relevantního nenalezeno → 0 faktů`
        : `  Result: ◐ Trigger (${types || "general"}), nothing relevant found → 0 facts`;

  const lines = [header, promptLine, resultLine];
  if (degradationNote) {
    lines.push(degradationNote);
  }

  if (verdict.facts.length > 0) {
    const memoryHeader = lang === "cs" ? "  Vyvolaná paměť:" : "  Recalled Memory:";
    lines.push(memoryHeader);

    for (const [index, fact] of verdict.facts.entries()) {
      lines.push(
        `    ${index + 1}. [${fact.fact_type}] ${stripMatchMarkers(fact.title)} (${formatScope(fact.scope)})\n` +
        `       ${elide(stripMatchMarkers(fact.snippet), 100)}`,
      );
    }
  }

  return lines.join("\n");
}
