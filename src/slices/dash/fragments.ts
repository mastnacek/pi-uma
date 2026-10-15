/**
 * HTML fragment renderers for /uma dash (Proposal 10).
 *
 * Pure string-in/string-out — every function takes normalized data from
 * data.ts and returns an HTML fragment string. The HTTP layer only wires
 * routes to these.
 *
 * Invariants:
 * - XSS boundary: escapeHtml runs on EVERY record field before it is
 *   interpolated. Fact bodies are operator-controlled markdown rendered
 *   into HTML; markdown-lite formatting is applied only after escaping.
 * - The engine's [match]…[/match] BM25 markers never reach the browser.
 *   (The 3-line strip regex is duplicated here on purpose: slices never
 *   import slices — fastbrain/policy.ts owns its copy for the TUI.)
 */

import type { DashCounts, DashFact, DashQuery, FactsPage } from "./data.ts";
import { PAGE_SIZE } from "./data.ts";

/** Escapes the five HTML-significant characters. The XSS boundary. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips the engine's BM25 highlight markers from a string. */
export function stripMatchMarkers(text: string): string {
  return text.replace(/\[match\]|\[\/match\]/g, "");
}

/** Inline markdown-lite on ALREADY-escaped text: code spans, then bold. */
function inlineFormat(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Minimal safe body renderer: escape first, then structural replacements —
 * `### ` headings, `- ` list items, paragraphs on blank lines. No external
 * markdown library (spec §4): the subset is fixed and the input is escaped.
 */
export function renderBodyHtml(markdown: string): string {
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${para.map((l) => inlineFormat(escapeHtml(l))).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of stripMatchMarkers(markdown).split("\n")) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      flushPara();
      closeList();
      continue;
    }
    if (line.startsWith("### ")) {
      flushPara();
      closeList();
      out.push(`<h4>${inlineFormat(escapeHtml(line.slice(4)))}</h4>`);
      continue;
    }
    if (/^[-*] /.test(line)) {
      flushPara();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineFormat(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
}

/** Scope → display label: 🌐 global / 📁 project:<name>. */
export function scopeLabel(scope: string): string {
  return scope === "global" ? "🌐 global" : `📁 ${escapeHtml(scope)}`;
}

function scopeClass(scope: string): string {
  return scope === "global" ? "global" : "project";
}

function tagList(tags: string[]): string {
  if (tags.length === 0) return "";
  return `<span class="tags">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join(" ")}</span>`;
}

/** One fact card in the list pane. Cards are real buttons: mouse click and
 * the keyboard script's .click() both reuse the same HTMX path. */
export function renderCard(fact: DashFact): string {
  const type = escapeHtml(fact.factType);
  const deprecated = fact.deprecated ? " deprecated" : "";
  const snippet = fact.snippet
    ? `<span class="snippet">${inlineFormat(escapeHtml(stripMatchMarkers(fact.snippet)))}</span>`
    : "";
  const weight = fact.weight !== null ? ` · w ${fact.weight.toFixed(1)}` : "";
  const status = fact.status && fact.status !== "stable" ? ` · ${escapeHtml(fact.status)}` : "";
  return (
    `<button type="button" class="card${deprecated}" id="card-${escapeHtml(fact.id)}" ` +
    `hx-get="/frag/fact/${encodeURIComponent(fact.id)}" hx-target="#detail" hx-swap="innerHTML">` +
    `<span class="badge t-${type}">${type.toUpperCase()}</span> ` +
    `<span class="title">${escapeHtml(fact.title)}</span>` +
    `<span class="meta"><span class="scope ${scopeClass(fact.scope)}">${scopeLabel(fact.scope)}</span>${weight}${status} ${tagList(fact.tags)}</span>` +
    snippet +
    `</button>`
  );
}

/** Builds the /frag/facts path for a query, preserving filters in the URL. */
export function factsPath(query: DashQuery, offset?: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.scope) params.set("scope", query.scope);
  params.set("offset", String(offset ?? query.offset));
  const qs = params.toString();
  return qs ? `/frag/facts?${qs}` : "/frag/facts";
}

/**
 * The list fragment: cards for the page plus a "load more" sentinel when
 * more exist. The sentinel targets itself with outerHTML — when HTMX reveals
 * it, the next page (ending in a fresh sentinel) replaces it, giving
 * infinite scroll with zero client-side rendering.
 */
export function renderFacts(page: FactsPage, query: DashQuery): string {
  if (page.facts.length === 0) {
    return `<div class="empty">∅ no facts match</div>`;
  }
  const cards = page.facts.map(renderCard);
  if (page.hasMore) {
    const nextOffset = Math.max(0, query.offset) + PAGE_SIZE;
    cards.push(
      `<button type="button" class="card more" ` +
        `hx-get="${factsPath(query, nextOffset)}" hx-target="this" hx-swap="outerHTML" ` +
        `hx-trigger="revealed">… ${page.total - nextOffset} more · load …</button>`,
    );
  }
  return cards.join("\n");
}

/** The detail fragment: full view of one fact in the right pane. */
export function renderDetail(fact: DashFact): string {
  const type = escapeHtml(fact.factType);
  const bodySource = fact.body ?? fact.snippet ?? "";
  const weight = fact.weight !== null ? `<span class="meta-item">weight ${fact.weight.toFixed(2)}</span>` : "";
  const statusGlyph = fact.deprecated ? "⚠ " : "";
  const status = fact.status
    ? `<span class="meta-item">${statusGlyph}${escapeHtml(fact.status)}</span>`
    : "";
  return (
    `<div class="detail-head">` +
    `<span class="badge t-${type}">${type.toUpperCase()}</span>` +
    `<h3>${escapeHtml(fact.title)}</h3>` +
    `<div class="meta">` +
    `<span class="meta-item">id ${escapeHtml(fact.id)}</span>` +
    `<span class="meta-item scope ${scopeClass(fact.scope)}">${scopeLabel(fact.scope)}</span>` +
    weight +
    status +
    (fact.tags.length > 0 ? `<span class="meta-item">${fact.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</span>` : "") +
    `</div></div>` +
    `<div class="body">${renderBodyHtml(bodySource)}</div>`
  );
}

/** Header stats fragment: total plus nonzero per-type and per-scope counts. */
export function renderStats(counts: DashCounts): string {
  const parts: string[] = [
    `<span class="stat"><strong>${counts.total}</strong> facts</span>`,
  ];
  const typeOrder = ["decision", "pattern", "preference", "correction", "skill", "task", "note", "fact"];
  for (const t of typeOrder) {
    const n = counts.byType[t];
    if (n) parts.push(`<span class="stat t-${escapeHtml(t)}">${n} ${escapeHtml(t)}</span>`);
  }
  for (const scope of Object.keys(counts.byScope).sort((a, b) => a.localeCompare(b))) {
    parts.push(
      `<span class="stat scope ${scopeClass(scope)}">${counts.byScope[scope]} ${scope === "global" ? "🌐" : "📁"} ${escapeHtml(scope)}</span>`,
    );
  }
  return parts.join("");
}

/** Red error box — the degradation surface for engine/CLI failures. */
export function renderError(message: string): string {
  const firstLines = stripMatchMarkers(message)
    .split("\n")
    .slice(0, 3)
    .map((l) => escapeHtml(l.trim()))
    .filter((l) => l.length > 0)
    .join("<br>");
  return `<div class="error">⚠ ${firstLines || "unknown error"}</div>`;
}
