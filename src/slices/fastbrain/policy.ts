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
  snippet: string;
  tags: string[];
}

/** The injected message's shape (BeforeAgentStartEventResult["message"]). */
export interface RecallMessage {
  customType: string;
  content: string;
  display: boolean;
  details: { judge: string; count: number };
}

/** Renders the scope for display: "Global" becomes "global", the tagged
 * variant becomes "project:<name>" — interpolating the raw object was the
 * [object Object] seen in the first live recall injection. */
export function formatScope(scope: ScopeWire): string {
  return typeof scope === "string" ? "global" : `project:${scope.Project}`;
}

/**
 * Pure decision: what should the hook do with a verdict?
 * No trigger or no facts → nothing is injected.
 */
export function buildRecallMessage(
  verdict: RecallVerdict,
  lang: "cs" | "en",
): { message: RecallMessage } | undefined {
  if (!verdict.search || verdict.facts.length === 0) return undefined;
  const lines = verdict.facts.map(
    (fact) =>
      `- [${fact.fact_type}] ${fact.title} (${formatScope(fact.scope)}): ${fact.snippet}`,
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
      details: { judge: verdict.judged_by, count: verdict.facts.length },
    },
  };
}

/** Truncates a prompt for the one-line decision report. */
function elide(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= width) return single;
  return `${single.slice(0, width - 1)}…`;
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
        `    ${index + 1}. [${fact.fact_type}] ${fact.title} (${formatScope(fact.scope)})\n` +
        `       ${elide(fact.snippet, 100)}`,
      );
    }
  }

  return lines.join("\n");
}
