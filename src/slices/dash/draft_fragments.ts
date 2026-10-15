/**
 * Rendering for the staged-drafts view (Proposal 10 §13 delta).
 *
 * Read-only by construction: there is no approve/discard control anywhere in
 * these fragments. A browser that could promote a draft would move consent out
 * of the TUI modal, which is where the operator review lives.
 */

import type { DashDraft, DraftsPage } from "./drafts.ts";
import {
  escapeHtml,
  excerptOf,
  renderBodyHtml,
  scopeLabel,
  stripMatchMarkers,
} from "./fragments.ts";

function confidencePct(draft: DashDraft): string {
  return `${Math.round(draft.confidence * 100)}%`;
}

/** One draft card: what would be stored, how sure the engine is, who asked. */
export function renderDraftCard(draft: DashDraft): string {
  const fact = draft.proposed;
  const type = escapeHtml(fact.factType);
  const excerpt = excerptOf(fact);
  return (
    `<div class="card-wrap" id="wrap-${escapeHtml(draft.id)}">` +
    `<div class="card draft" id="card-${escapeHtml(draft.id)}" role="button" tabindex="0" ` +
    `hx-get="/frag/draft/${encodeURIComponent(draft.id)}" hx-target="#detail" hx-swap="innerHTML">` +
    `<span class="badge t-${type}">${type.toUpperCase()}</span>` +
    `<span class="chip-conf">draft · ${confidencePct(draft)}</span>` +
    `<span class="orig">` +
    `<span class="title">${escapeHtml(fact.title)}</span>` +
    `<span class="meta"><span class="scope ${fact.scope === "global" ? "global" : "project"}">${scopeLabel(fact.scope)}</span>` +
    ` · ${escapeHtml(draft.trigger)}` +
    (fact.spai.length > 0 ? ` · ${escapeHtml(fact.spai.join(" "))}` : "") +
    `</span>` +
    (excerpt ? `<span class="snippet">${escapeHtml(excerpt)}</span>` : "") +
    `</span>` +
    `</div></div>`
  );
}

/** The drafts list fragment, with a way back to the facts view. */
export function renderDrafts(page: DraftsPage): string {
  const warning = page.warning
    ? `<div class="degraded">⚠ ${escapeHtml(stripMatchMarkers(page.warning))}</div>`
    : "";
  const back =
    `<button type="button" class="card more" hx-get="/frag/facts" hx-target="#cards" ` +
    `hx-swap="innerHTML" hx-include="#filters">← back to facts</button>`;
  if (page.drafts.length === 0) {
    return (
      warning +
      `<div class="empty">∅ no staged drafts awaiting review` +
      `<br><span class="dim">the shadow worker parks proposals here; review them with /uma review</span></div>` +
      back
    );
  }
  return warning + page.drafts.map(renderDraftCard).join("\n") + back;
}

/** Full view of one draft: the proposed record plus why it exists. */
export function renderDraftDetail(draft: DashDraft, factHtml: string): string {
  const fact = draft.proposed;
  const type = escapeHtml(fact.factType);
  const provenance = [
    `trigger ${draft.trigger}`,
    `confidence ${confidencePct(draft)}`,
    draft.sessionId ? `session ${draft.sessionId}` : undefined,
  ]
    .filter((x): x is string => x !== undefined)
    .map((x) => `<span class="meta-item">${escapeHtml(x)}</span>`)
    .join("");
  return (
    `<div class="detail-head">` +
    `<span class="badge t-${type}">${type.toUpperCase()}</span>` +
    `<span class="chip-conf">DRAFT · not stored yet</span>` +
    `<h3>${escapeHtml(fact.title)}</h3>` +
    (draft.context ? `<div class="description">${escapeHtml(draft.context)}</div>` : "") +
    `<div class="meta">` +
    `<span class="meta-item">id ${escapeHtml(draft.id)}</span>` +
    `<span class="meta-item scope ${fact.scope === "global" ? "global" : "project"}">${scopeLabel(fact.scope)}</span>` +
    provenance +
    (fact.tags.length > 0
      ? `<span class="meta-item">${fact.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</span>`
      : "") +
    `</div>` +
    `<div class="block-note">Read-only view. Approve or discard in the TUI: <code>/uma review</code> · <code>uma staging approve &lt;ID&gt;</code></div>` +
    `</div>` +
    factHtml
  );
}

/** The body of a draft's proposed fact (same markdown-lite as facts). */
export function renderDraftBody(draft: DashDraft): string {
  return `<div class="body">${renderBodyHtml(draft.proposed.body ?? "")}</div>`;
}
