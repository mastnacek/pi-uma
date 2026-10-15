/**
 * Rendering for pending drafts inside the list (Proposal 10 §13 delta).
 *
 * Drafts are list elements, not a separate view: they appear in the same pane
 * as facts, are selected with the same keys, open their detail in the same right
 * pane, and carry the same 🌐 CS display translation as a stored fact. Only the
 * badge, the confidence chip and the "not stored yet" wording tell them apart.
 *
 * Read-only by construction: there is no approve/discard control anywhere in
 * these fragments. A browser that could promote a draft would move consent out
 * of the TUI modal, which is where the operator review lives.
 */

import type { DashDraft } from "./drafts.ts";
import {
  escapeHtml,
  excerptOf,
  renderBodyHtml,
  renderTranslationToggle,
  scopeLabel,
} from "./fragments.ts";

function confidencePct(draft: DashDraft): string {
  return `${Math.round(draft.confidence * 100)}%`;
}

/**
 * One draft card: what would be stored, how sure the engine is, what produced
 * it — plus the same 🌐 CS toggle a fact card has, so a proposal is readable in
 * Czech while the TUI review keeps the English original.
 */
export function renderDraftCard(draft: DashDraft): string {
  const fact = draft.proposed;
  const id = escapeHtml(draft.id);
  const type = escapeHtml(fact.factType);
  const excerpt = excerptOf(fact);
  return (
    `<div class="card-wrap" id="wrap-${id}">` +
    renderTranslationToggle(draft.id, fact.title, excerpt) +
    `<div class="card draft" id="card-${id}" role="button" tabindex="0" ` +
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
    `<span class="trans" id="trans-${id}"></span>` +
    `</div></div>`
  );
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
