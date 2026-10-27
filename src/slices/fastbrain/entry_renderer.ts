/**
 * Recall-gate transcript entry: the structured, color-coded display half.
 *
 * The notify toast carries a one-line summary (policy.formatGateOneLiner);
 * everything else lives here as a `uma-recall-gate` custom entry. Being a
 * transcript entry it is scrollable by pi itself (fullscreen transcript owns
 * scrolling) and gets real theme colors — semantics the flat notify string
 * could never express:
 *
 *   ● trigger / injection  → success (green)
 *   ◐ trigger, 0 facts     → warning (amber)
 *   ○ no trigger           → dim
 *   ⚠ degraded judge       → warning
 *   fact-type badges       → colored by meaning (decision/correction/…)
 *   [match]…[/match] hits  → highlighted, never shown raw
 *
 * Pure rendering: the component holds only the immutable entry data, so a
 * re-render at a different width is a pure re-layout.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  isDegradedNote,
  splitMatchMarkers,
  stripMatchMarkers,
  type RecallFact,
  type RecallVerdict,
} from "./policy.ts";

/** JSON payload stored on the custom entry by the gate hook. */
export interface RecallGateEntryData {
  prompt: string;
  verdict: RecallVerdict;
  lang: "cs" | "en";
  /** Facts actually injected after the anti-echo filter; undefined means
   * the pre-dedup behavior (everything recalled was injected). */
  injectedCount?: number;
}

export const RECALL_GATE_ENTRY_TYPE = "uma-recall-gate";

/** The slice of pi's Theme this renderer needs (same structural pattern as
 * the approval modal renderer). */
type ThemeColor =
  | "accent" | "border" | "borderAccent" | "warning" | "error"
  | "success" | "text" | "muted" | "dim" | "mdHeading" | "toolTitle";

interface ThemeRenderer {
  fg: (color: ThemeColor, text: string) => string;
  bold: (text: string) => string;
}

/** Fact types → semantic colors. Meaning at a glance: corrections are red,
 * decisions and skills stand out, plain notes recede. */
function factTypeColor(factType: string): ThemeColor {
  switch (factType) {
    case "decision":
      return "accent";
    case "correction":
      return "error";
    case "preference":
      return "success";
    case "pattern":
      return "mdHeading";
    case "skill":
      return "toolTitle";
    case "task":
      return "warning";
    default:
      return "muted";
  }
}

function elidePlain(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= width) return single;
  return `${single.slice(0, width - 1)}…`;
}

/**
 * Paints a snippet with [match] hits highlighted and markers never shown.
 * Elides against the *visible* length (markers excluded) by walking segments
 * with a character budget — eliding the stripped text instead would lose
 * the match positions the highlight needs.
 */
function paintSnippet(theme: ThemeRenderer, snippet: string, budget = 160): string {
  const out: string[] = [];
  let remaining = budget;
  for (const seg of splitMatchMarkers(snippet.replace(/\s+/g, " ").trim())) {
    if (remaining <= 0) break;
    const text = seg.text.length > remaining ? `${seg.text.slice(0, Math.max(0, remaining - 1))}…` : seg.text;
    out.push(seg.match ? theme.fg("warning", theme.bold(text)) : theme.fg("dim", text));
    remaining -= seg.text.length;
  }
  return out.join("");
}

function renderFact(
  theme: ThemeRenderer,
  fact: RecallFact,
  index: number,
): string[] {
  const badge = theme.fg(factTypeColor(fact.fact_type), theme.bold(`[${fact.fact_type.toUpperCase()}]`));
  const scope =
    typeof fact.scope === "string"
      ? theme.fg("success", "🌐 global")
      : theme.fg("accent", `📁 ${fact.scope.Project}`);
  const title = elidePlain(stripMatchMarkers(fact.title), 90);
  const lines = [
    `  ${theme.fg("muted", `${index + 1}.`)} ${badge} ${theme.fg("text", title)} ${scope}`,
  ];
  const snippet = paintSnippet(theme, fact.snippet);
  if (snippet) lines.push(`     ${snippet}`);
  return lines;
}

class RecallGateEntryComponent {
  // Explicit fields, not parameter properties: the repo's tests run on
  // node --experimental-strip-types, which cannot parse them.
  private readonly data: RecallGateEntryData;
  private readonly theme: ThemeRenderer;

  constructor(data: RecallGateEntryData, theme: ThemeRenderer) {
    this.data = data;
    this.theme = theme;
  }

  /** Stateless renderer — nothing cached, so invalidation is a no-op. */
  invalidate(): void {}

  render(width: number): string[] {
    const { prompt, verdict, lang } = this.data;
    const theme = this.theme;
    const lines: string[] = [];

    // Header: judge colored by provenance — jev is a live semantic call,
    // off is the local heuristic.
    const judgeBadge =
      verdict.judged_by === "jev" || verdict.judged_by === "jev-relevance"
        ? theme.fg("accent", theme.bold(verdict.judged_by))
        : theme.fg("dim", verdict.judged_by);
    const headerLabel = lang === "cs" ? "Soudce" : "Judge";
    lines.push(
      theme.fg("borderAccent", "🧠 ") +
        theme.fg("toolTitle", theme.bold("UMA FastBrain Recall Gate")) +
        theme.fg("dim", ` · ${headerLabel}: `) +
        judgeBadge,
    );

    const promptLabel = lang === "cs" ? "Dotaz" : "Prompt";
    lines.push(`  ${theme.fg("muted", `${promptLabel}:`)} ${theme.fg("dim", `„${elidePlain(prompt, 70)}“`)}`);

    // Status line colored by outcome.
    const types = verdict.fact_types.join(", ");
    if (!verdict.search) {
      lines.push(
        `  ${theme.fg("dim", lang === "cs" ? "○ Žádný trigger → paměť zůstává zavřená" : "○ No trigger → memory stays closed")}`,
      );
    } else if (verdict.recalled > 0) {
      // Anti-echo: the judge may recall 3 facts but inject only 2 new ones;
      // the entry reports what actually entered the context.
      const injected = this.data.injectedCount ?? verdict.recalled;
      const countText = injected < verdict.recalled
        ? lang === "cs"
          ? `vybráno ${verdict.recalled}, injektováno ${injected}× (zbytek již v kontextu)`
          : `recalled ${verdict.recalled}, injected ${injected}× (rest already in context)`
        : lang === "cs"
          ? `injektováno ${injected}×`
          : `injected ${injected}×`;
      const label =
        lang === "cs"
          ? `● Trigger (${types || "obecný"}) → ${countText}`
          : `● Trigger (${types || "general"}) → ${countText}`;
      lines.push(`  ${theme.fg("success", theme.bold(label))}`);
    } else {
      const label =
        lang === "cs"
          ? `◐ Trigger (${types || "obecný"}), nic relevantního → 0 faktů`
          : `◐ Trigger (${types || "general"}), nothing relevant → 0 facts`;
      lines.push(`  ${theme.fg("warning", label)}`);
    }

    // Degradation is always visible, never silently green.
    if (isDegradedNote(verdict.note) && verdict.note) {
      lines.push(`  ${theme.fg("warning", `⚠ ${elidePlain(verdict.note, 100)}`)}`);
    }

    if (verdict.facts.length > 0) {
      lines.push(`  ${theme.fg("mdHeading", lang === "cs" ? "Vyvolaná paměť:" : "Recalled memory:")}`);
      for (const [index, fact] of verdict.facts.entries()) {
        lines.push(...renderFact(theme, fact, index));
      }
    }

    // Width safety: the TUI hard-crashes on overflow — clip every line.
    return lines.map((line) =>
      visibleWidth(line) > width ? truncateToWidth(line, width, "…") : line,
    );
  }
}

/** Registers the transcript renderer for recall-gate decision entries. */
export function registerRecallEntryRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<RecallGateEntryData>(
    RECALL_GATE_ENTRY_TYPE,
    (entry, _options, theme) => {
      const data = (entry as { data?: RecallGateEntryData }).data;
      if (!data?.verdict) return undefined;
      // SAFETY: pi's Theme is a superset of ThemeRenderer (same structural
      // pattern as shared/modal_renderer.ts); the entry payload is written
      // by our own hook, so the narrow cast cannot lie at runtime.
      return new RecallGateEntryComponent(data, theme as unknown as ThemeRenderer);
    },
  );
}
