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

/**
 * One-line excerpt for a card: search hit snippet when present, else the
 * first `max` characters of the body with markdown noise squeezed out.
 * The card shows it in both languages, so the 🌐 toggle changes real content.
 */
export function excerptOf(fact: DashFact, max = 160): string {
  if (fact.snippet) return stripMatchMarkers(fact.snippet).trim();
  const body = (fact.body ?? "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[-*]\s*/gm, "· ")
    .replace(/\s+/g, " ")
    .trim();
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
}

function tagList(tags: string[]): string {
  if (tags.length === 0) return "";
  return `<span class="tags">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join(" ")}</span>`;
}

/**
 * One fact card in the list pane, plus its per-card translate control.
 *
 * Structure note: the card is a role="button" div, NOT a <button>, because the
 * 🌐 control is a real nested <label>/<input> pair — nesting interactive
 * elements inside a <button> is invalid HTML. Mouse click and the keyboard
 * script's .click() both reuse the same HTMX path.
 *
 * The translate control is CSS-only: the checkbox toggles `.orig` vs `.trans`,
 * and HTMX fills `.trans` once (hx-trigger="change"). Toggling back is free —
 * no second request, no server cache. The text being translated travels with
 * the request as hidden fields, so the translation is exactly of what is shown.
 */
export function renderCard(fact: DashFact): string {
  const id = escapeHtml(fact.id);
  const type = escapeHtml(fact.factType);
  const deprecated = fact.deprecated ? " deprecated" : "";
  const title = escapeHtml(fact.title);
  const excerpt = excerptOf(fact);
  const weight = fact.weight !== null ? ` · w ${fact.weight.toFixed(1)}` : "";
  const status = fact.status && fact.status !== "stable" ? ` · ${escapeHtml(fact.status)}` : "";
  return (
    `<div class="card-wrap" id="wrap-${id}">` +
    `<input type="checkbox" class="lang-cb" id="lang-${id}" name="checked" ` +
    `hx-post="/frag/translate" hx-target="#trans-${id}" hx-swap="innerHTML" ` +
    `hx-include="closest .card-wrap" hx-trigger="change">` +
    `<label class="lang-toggle" for="lang-${id}" title="translate for display (stored text unchanged)">🌐 CS</label>` +
    `<input type="hidden" name="id" value="${id}">` +
    `<input type="hidden" name="title" value="${title}">` +
    `<input type="hidden" name="excerpt" value="${escapeHtml(excerpt)}">` +
    `<div class="card${deprecated}" id="card-${id}" role="button" tabindex="0" ` +
    `hx-get="/frag/fact/${encodeURIComponent(fact.id)}" hx-target="#detail" hx-swap="innerHTML">` +
    `<span class="badge t-${type}">${type.toUpperCase()}</span>` +
    `<span class="orig">` +
    `<span class="title">${title}</span>` +
    `<span class="meta"><span class="scope ${scopeClass(fact.scope)}">${scopeLabel(fact.scope)}</span>${weight}${status} ${tagList(fact.tags)}</span>` +
    (excerpt ? `<span class="snippet">${inlineFormat(escapeHtml(excerpt))}</span>` : "") +
    `</span>` +
    `<span class="trans" id="trans-${id}"></span>` +
    `</div></div>`
  );
}

/**
 * The translated card text, swapped into `.trans` when the 🌐 checkbox flips.
 * Falls back to the original text plus a visible reason on failure — a
 * translation that silently does nothing is indistinguishable from a bug.
 */
export function renderTranslatedCard(
  title: string,
  excerpt: string,
  result: { title?: string; excerpt?: string; error?: string },
): string {
  if (result.error) {
    return (
      `<span class="trans-error">🌐 translation unavailable — ${escapeHtml(result.error.split("\n")[0])}</span>` +
      `<span class="title">${escapeHtml(title)}</span>` +
      (excerpt ? `<span class="snippet">${escapeHtml(excerpt)}</span>` : "")
    );
  }
  return (
    `<span class="title">${escapeHtml(result.title ?? title)}</span>` +
    (excerpt
      ? `<span class="snippet">${escapeHtml(result.excerpt ?? excerpt)}</span>`
      : "") +
    `<span class="trans-note">🌐 display translation — stored text unchanged</span>`
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
  const banner = page.note ? renderDegradedNote(page.note) : "";
  if (page.facts.length === 0) {
    return `${banner}<div class="empty">∅ no facts match</div>`;
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
  return banner + cards.join("\n");
}

/**
 * Degradation banner. The engine degrades hybrid to keyword-only when no
 * embeddings or no API key are available and says so — the dashboard must
 * repeat it, or a semantic search would look like a semantic search while
 * ranking by BM25.
 */
export function renderDegradedNote(note: string): string {
  return `<div class="degraded">⚠ ${escapeHtml(stripMatchMarkers(note))}</div>`;
}

/**
 * Header stats fragment: active totals, nonzero per-type/per-scope counts, the
 * inactive (deprecated/superseded) count and a button into the drafts view.
 * Inactive facts are counted but never mixed into the type mix — a retired rule
 * must not look current.
 */
export function renderStats(counts: DashCounts, draftCount?: number): string {
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
  if (counts.inactive > 0) {
    parts.push(
      `<span class="stat inactive" title="deprecated or superseded — enable 🕰 history">${counts.inactive} inactive</span>`,
    );
  }
  if (draftCount !== undefined) {
    parts.push(
      `<button type="button" class="stat-btn" hx-get="/frag/drafts" hx-target="#cards" hx-swap="innerHTML">` +
        `📥 ${draftCount} draft${draftCount === 1 ? "" : "s"}</button>`,
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
