/**
 * Interactive TUI Modal for reviewing staged memory drafts (Proposal 02).
 *
 * Allows browsing through drafts, editing their contents inline, and approving
 * or discarding them one by one.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { runUma, findUmaBinary } from "../../shared/client.js";

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

    editor.onSubmit = (value) => {
      const draft = currentDraft();
      if (draft && editingField === "title" && value.trim()) {
        draft.fact.title = value.trim();
      } else if (draft && editingField === "body" && value.trim()) {
        draft.fact.body = value.trim();
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
          const bodyLines = draft.fact.body.split("\n");
          for (const bl of bodyLines.slice(0, 8)) {
            const fit = truncateToWidth(bl, inner - 4);
            lines.push(row(`  ${theme.fg("text", fit)}`));
          }
          if (bodyLines.length > 8) {
            lines.push(row(`  ${theme.fg("dim", `+${bodyLines.length - 8} more lines...`)}`));
          }
        }

        lines.push(row(""));
        lines.push(theme.fg("border", "├" + "─".repeat(inner) + "┤"));

        // Actions
        const actions =
          `  ${theme.fg("success", "[Enter/a] Approve")}   ` +
          `${theme.fg("accent", "[e] Edit")}   ` +
          `${theme.fg("error", "[d] Discard")}   ` +
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

        // Approve
        if (matchesKey(data, "enter") || data.toLowerCase() === "a") {
          void (async () => {
            await runUma(binPath, ["staging", "approve", draft.id], ctx.cwd);
            approvedCount++;
            onDraftAction?.();
            activeDrafts.splice(currentIndex, 1);
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
            if (activeDrafts.length === 0) {
              done();
            } else {
              currentIndex = Math.min(currentIndex, activeDrafts.length - 1);
              refresh();
            }
          })();
          return true;
        }

        // Edit
        if (data.toLowerCase() === "e") {
          editingField = "title";
          editor.setText(draft.fact.title);
          refresh();
          return true;
        }

        // Next / Prev navigation
        if (matchesKey(data, "tab") || matchesKey(data, "right") || data.toLowerCase() === "n") {
          if (activeDrafts.length > 1) {
            currentIndex = (currentIndex + 1) % activeDrafts.length;
            refresh();
          }
          return true;
        }
        if (matchesKey(data, "left") || data.toLowerCase() === "p") {
          if (activeDrafts.length > 1) {
            currentIndex = (currentIndex - 1 + activeDrafts.length) % activeDrafts.length;
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
