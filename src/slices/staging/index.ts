/**
 * Staging Review Slice: batch human consent and interactive review modal (Proposal 02).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findUmaBinary, runUma } from "../../shared/client.js";
import type { ExtensionState } from "../../shared/types.js";
import { showStagingReviewModal, type StagedDraftRecord } from "./modal.js";

export async function fetchStagedDrafts(cwd: string): Promise<StagedDraftRecord[]> {
  try {
    const binPath = findUmaBinary(cwd);
    const res = await runUma(binPath, ["staging", "list", "--json"], cwd);
    if (res.code !== 0 || !res.stdout) return [];
    return JSON.parse(res.stdout) as StagedDraftRecord[];
  } catch {
    return [];
  }
}

export async function startStagingReview(
  ctx: ExtensionContext,
  state: ExtensionState,
): Promise<{ approved: number; discarded: number }> {
  if (!ctx.hasUI) return { approved: 0, discarded: 0 };

  const drafts = await fetchStagedDrafts(ctx.cwd);
  if (drafts.length === 0) {
    ctx.ui.notify("No staged memory drafts waiting in .uma/.staging/", "info");
    return { approved: 0, discarded: 0 };
  }

  const result = await showStagingReviewModal(ctx, drafts, () => {
    void state.refreshDetector?.(ctx, true);
  });

  void state.refreshDetector?.(ctx, true);

  if (result.approved > 0 || result.discarded > 0) {
    ctx.ui.notify(
      `Staging review complete: ${result.approved} approved & promoted, ${result.discarded} discarded.`,
      "info",
    );
  }

  return result;
}
