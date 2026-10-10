/**
 * Interactive TUI Modal for reviewing staged memory drafts (Proposal 02).
 *
 * Allows browsing through drafts, viewing translated contents inline, scrolling
 * through long bodies, editing fields, and approving or discarding one by one.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { runUma, findUmaBinary } from "../../shared/client.js";
import { DisplayTranslation } from "../../shared/translate_client.js";

export interface StagedDraftRecord {
  id: string;
  confidence: number;
  provenance: {
    session_id?: string;
    trigger_type: string;
    context?: string;
  };
  fact: {
    id: string;
    scope: unknown;
    fact_type: string;
    title: string;
    body: string;
    tags: string[];
  };
}

export async function showStagingReviewModal(
  ctx: ExtensionContext,
  drafts: StagedDraftRecord[],
  onDraftAction?: () => void,
  lang = "cs",
): Promise<{ approved: number; discarded: number }> {
  if (ctx.mode !== "tui" || !ctx.hasUI || drafts.length === 0) {
    return { approved: 0, discarded: 0 };
  }

  const binPath = findUmaBinary(ctx.cwd);
  let currentIndex = 0;
  let approvedCount = 0;
  let discardedCount = 0;
  let activeDrafts = [...drafts];
  let editingField: "title" | "body" | null = null;

  // Translation & scroll state
  let showTranslation = lang === "cs";
  let scrollOffset = 0;
  const VIEWPORT = 12;

  const translations = new Map<string, DisplayTranslation>();

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const editorTheme: EditorTheme = {
      borderColor: (str: string) => theme.fg("accent", str),
      selectList: {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("muted", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      },
    };

    const editor = new Editor(tui, editorTheme);

    function currentDraft(): StagedDraftRecord | undefined {
      return activeDrafts[currentIndex];
    }

    function refresh() {
      tui.requestRender();
    }

    function getTranslation(draft: StagedDraftRecord): DisplayTranslation {
      let dt = translations.get(draft.id);
      if (!dt) {
        dt = new DisplayTranslation(ctx, refresh);
        translations.set(draft.id, dt);
        if (showTranslation) dt.start(draft.fact.body);
      }
      return dt;
    }

    editor.onSubmit = (value) => {
      const draft = currentDraft();
      if (draft && editingField === "title" && value.trim()) {
        draft.fact.title = value.trim();
      } else if (draft && editingField === "body" && value.trim()) {
        draft.fact.body = value.trim();
        translations.delete(draft.id);
      }
      editingField = null;
      refresh();
    };

    return {
      render(width: number): string[] {
        const lines: string[] = [];
        const renderWidth = Math.max(40, width);
        const inner = renderWidth - 2;

        const draft = currentDraft();
        if (!draft) {
          lines.push(theme.fg("muted", "No more drafts in staging."));
          return lines;
        }

        const dt = getTranslation(draft);
        if (showTranslation) dt.start(draft.fact.body);

        const titleText = ` ✦ UMA Staging Review • Draft ${currentIndex + 1} of ${activeDrafts.length} `;
        const titleW = visibleWidth(titleText);
        const topFill = Math.max(0, inner - titleW - 1);
        lines.push(
          theme.fg("borderAccent", "╭─") +
            theme.fg("borderAccent", theme.bold(titleText)) +
            theme.fg("borderAccent", "─".repeat(topFill) + "╮"),
        );
        lines.push(theme.fg("border", "│" + " ".repeat(inner) + "│"));

        const row = (content: string): string =>
          theme.fg("border", "│ ") +
          content +
          " ".repeat(Math.max(0, inner - 2 - visibleWidth(content))) +
          theme.fg("border", " │");

        // Provenance & trigger
        const confPct = `${(draft.confidence * 100).toFixed(0)}%`;
        const prov = `⚡ Trigger: ${theme.fg("warning", draft.provenance.trigger_type)}  Confidence: ${theme.fg("success", confPct)}`;
        lines.push(row(`  ${prov}`));

        // Metadata badge: Type + Scope + Tags
        const typeBadge = theme.fg("accent", theme.bold(`[${draft.fact.fact_type.toUpperCase()}]`));
        const tagsBadge = draft.fact.tags.length > 0 ? draft.fact.tags.map((t) => "#" + t).join(" ") : "(no tags)";
        lines.push(row(`  ${typeBadge}  🏷️ ${theme.fg("dim", tagsBadge)}`));

        // Translation status chip
        let transChip = "";
        if (dt.pending) {
          transChip = theme.fg("dim", " [⏳ Překládám...]");
        } else if (showTranslation && !dt.failed) {
          transChip = theme.fg("dim", " [🇨🇿 Zobrazen český překlad • 't' pro originál]");
        } else if (dt.failed) {
          transChip = theme.fg("warning", ` [⚠️ Překlad selhal: ${dt.error ?? "chyba"}]`);
        } else {
          transChip = theme.fg("dim", " [🇬🇧 Zobrazen anglický originál • 't' pro překlad]");
        }
        lines.push(row(`  ${transChip}`));
        lines.push(row(""));

        // Title
        lines.push(row(`  ${theme.fg("mdHeading", theme.bold("📌 " + draft.fact.title))}`));
        lines.push(row(""));

        // Body
        if (editingField) {
          lines.push(row(`  ${theme.fg("accent", `Editing ${editingField}: [Enter to Save, Esc to Cancel]`)}`));
          for (const el of editor.render(inner - 4)) {
            lines.push(row(`    ${el}`));
          }
        } else {
          const bodyText = dt.bodyFor(draft.fact.body, showTranslation);
          const bodyLines = bodyText.split("\n");
          const maxScroll = Math.max(0, bodyLines.length - VIEWPORT);
          scrollOffset = Math.min(Math.max(0, scrollOffset), maxScroll);

          const visibleSlice = bodyLines.slice(scrollOffset, scrollOffset + VIEWPORT);
          for (const bl of visibleSlice) {
            const fit = truncateToWidth(bl, inner - 4);
            lines.push(row(`  ${theme.fg("text", fit)}`));
          }

          if (bodyLines.length > VIEWPORT) {
            const pct = Math.round(((scrollOffset + visibleSlice.length) / bodyLines.length) * 100);
            const scrollInfo = `↕ [Scroll: řádky ${scrollOffset + 1}–${Math.min(scrollOffset + VIEWPORT, bodyLines.length)} z ${bodyLines.length} (${pct}%) • ↑/↓ nebo j/k]`;
            lines.push(row(`  ${theme.fg("dim", scrollInfo)}`));
          }
        }

        lines.push(row(""));
        lines.push(theme.fg("border", "├" + "─".repeat(inner) + "┤"));

        // Actions
        const actions =
          `  ${theme.fg("success", "[Enter/a] Approve")}   ` +
          `${theme.fg("accent", "[e] Title  [b] Body")}   ` +
          `${theme.fg("error", "[d] Discard")}   ` +
          `${theme.fg("warning", "[t] Translate")}   ` +
          `${theme.fg("muted", "[Tab/→] Next")}   ` +
          `${theme.fg("dim", "[Esc/q] Close")}`;
        lines.push(row(actions));
        lines.push(theme.fg("border", "╰" + "─".repeat(inner) + "╯"));

        return lines;
      },

      handleInput(data: string): boolean {
        if (editingField) {
          if (matchesKey(data, "escape")) {
            editingField = null;
            refresh();
            return true;
          }
          editor.handleInput(data);
          return true;
        }

        const draft = currentDraft();
        if (!draft) {
          done();
          return true;
        }

        // Toggle display translation ('t' or 'c')
        if (data.toLowerCase() === "t" || data.toLowerCase() === "c") {
          showTranslation = !showTranslation;
          const dt = getTranslation(draft);
          if (showTranslation) dt.start(draft.fact.body);
          scrollOffset = 0;
          refresh();
          return true;
        }

        // Vertical scroll within draft body
        const dt = getTranslation(draft);
        const bodyText = dt.bodyFor(draft.fact.body, showTranslation);
        const totalLines = bodyText.split("\n").length;
        const maxScroll = Math.max(0, totalLines - VIEWPORT);

        if (matchesKey(data, "up") || data === "k") {
          if (scrollOffset > 0) {
            scrollOffset = Math.max(0, scrollOffset - 1);
            refresh();
          }
          return true;
        }
        if (matchesKey(data, "down") || data === "j") {
          if (scrollOffset < maxScroll) {
            scrollOffset = Math.min(maxScroll, scrollOffset + 1);
            refresh();
          }
          return true;
        }
        if (matchesKey(data, "pageUp")) {
          scrollOffset = Math.max(0, scrollOffset - VIEWPORT);
          refresh();
          return true;
        }
        if (matchesKey(data, "pageDown")) {
          scrollOffset = Math.min(maxScroll, scrollOffset + VIEWPORT);
          refresh();
          return true;
        }

        // Approve (always promotes original draft fact, never the display translation)
        if (matchesKey(data, "enter") || data.toLowerCase() === "a") {
          void (async () => {
            await runUma(binPath, ["staging", "approve", draft.id], ctx.cwd);
            approvedCount++;
            onDraftAction?.();
            activeDrafts.splice(currentIndex, 1);
            scrollOffset = 0;
            if (activeDrafts.length === 0) {
              done();
            } else {
              currentIndex = Math.min(currentIndex, activeDrafts.length - 1);
              refresh();
            }
          })();
          return true;
        }

        // Discard
        if (data.toLowerCase() === "d" || matchesKey(data, "delete") || matchesKey(data, "backspace")) {
          void (async () => {
            await runUma(binPath, ["staging", "discard", draft.id], ctx.cwd);
            discardedCount++;
            onDraftAction?.();
            activeDrafts.splice(currentIndex, 1);
            scrollOffset = 0;
            if (activeDrafts.length === 0) {
              done();
            } else {
              currentIndex = Math.min(currentIndex, activeDrafts.length - 1);
              refresh();
            }
          })();
          return true;
        }

        // Edit Title ('e') or Body ('b')
        if (data.toLowerCase() === "e") {
          editingField = "title";
          editor.setText(draft.fact.title);
          refresh();
          return true;
        }
        if (data.toLowerCase() === "b") {
          editingField = "body";
          editor.setText(draft.fact.body);
          refresh();
          return true;
        }

        // Next / Prev navigation
        if (matchesKey(data, "tab") || matchesKey(data, "right") || data.toLowerCase() === "n") {
          if (activeDrafts.length > 1) {
            currentIndex = (currentIndex + 1) % activeDrafts.length;
            scrollOffset = 0;
            refresh();
          }
          return true;
        }
        if (matchesKey(data, "left") || data.toLowerCase() === "p") {
          if (activeDrafts.length > 1) {
            currentIndex = (currentIndex - 1 + activeDrafts.length) % activeDrafts.length;
            scrollOffset = 0;
            refresh();
          }
          return true;
        }

        // Close / Exit
        if (matchesKey(data, "escape") || data.toLowerCase() === "q") {
          done();
          return true;
        }

        return false;
      },

      invalidate(): void {},
    };
  });

  return { approved: approvedCount, discarded: discardedCount };
}
