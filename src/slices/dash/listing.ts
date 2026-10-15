/**
 * The list pane: one scrollable sequence of elements, not several views.
 *
 * Pending drafts come first (they are the only actionable thing on screen),
 * then the stored facts of the current page — same cards, same selection keys,
 * same detail pane, same filter chips. A draft is never hidden behind a button
 * or a separate mode; only its badge and "draft" wording say it is not stored
 * yet. This module is the only place that knows both halves, so
 * `fragments.ts` (facts) and `draft_fragments.ts` (drafts) stay pure and
 * cycle-free.
 */

import type { FactsPage, DashQuery } from "./data.ts";
import type { DashDraft } from "./drafts.ts";
import { renderDraftCard } from "./draft_fragments.ts";
import { renderDegradedNote, renderFactCards } from "./fragments.ts";

export interface PendingDrafts {
  /** Drafts matching the current chips and search term. */
  drafts: DashDraft[];
  /** Drafts in the store before filtering (for "N of M"). */
  total: number;
  /** Engine note about unreadable staging files, when there is one. */
  warning?: string;
}

/** Section header with a count: keeps the two halves visually unambiguous. */
function sectionHead(icon: string, label: string, count: string): string {
  return `<div class="section-head">${icon} ${label} <span class="dim">· ${count}</span></div>`;
}

/**
 * Composes the pane from the current fact page and the pending queue.
 * Degradation banners (search fell back to keyword-only, drafts unreadable)
 * stay at the very top: they explain the whole result, not one section.
 */
export function renderList(page: FactsPage, query: DashQuery, pending: PendingDrafts): string {
  const parts: string[] = [];
  if (page.note) parts.push(renderDegradedNote(page.note));
  if (pending.warning) parts.push(renderDegradedNote(pending.warning));

  const draftsShown = pending.drafts.length;
  if (draftsShown > 0) {
    const count =
      draftsShown < pending.total ? `${draftsShown} of ${pending.total}` : String(pending.total);
    parts.push(sectionHead("📥", "pending review", count));
    parts.push(pending.drafts.map(renderDraftCard).join("\n"));
  }

  if (page.facts.length > 0) {
    const scope = query.history ? "incl. retired" : "active";
    parts.push(sectionHead("📚", "stored facts", `${page.total} ${scope}`));
    parts.push(renderFactCards(page, query));
  } else {
    // No facts on this page: say why, without hiding the drafts above.
    parts.push(
      draftsShown > 0
        ? `<div class="empty">∅ no stored facts match <span class="dim">(only the drafts above)</span></div>`
        : `<div class="empty">∅ nothing matches</div>`,
    );
  }
  return parts.join("\n");
}
