/**
 * Muscle synthesis hook — thin subscription over the pure repetition detector
 * in slices/muscle/policy.ts (the immune-interceptor pattern).
 *
 * The shadow worker may only PROPOSE: a detected repetition becomes a staged
 * draft in .uma/.staging/; curation is the operator's action through /uma
 * review. Notification text is user-facing → string table.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../shared/types.js";
import { stringsFor } from "../shared/i18n.js";
import { findUmaBinary, runUma } from "../shared/client.js";
import {
  buildRoutineProposal,
  detectRepeatedSequence,
  normalizeCommand,
  type NormalizedCommand,
} from "../slices/muscle/policy.ts";

/** Rolling window of successful bash commands in this session. */
const HISTORY_LIMIT = 40;

function historyOf(state: ExtensionState): { shapes: NormalizedCommand[]; raw: string[] } {
  state.muscleHistory = state.muscleHistory ?? { shapes: [], raw: [] };
  return state.muscleHistory;
}

export function registerMuscleSynthesis(pi: ExtensionAPI, state: ExtensionState): () => void {
  const unsubscribe = pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.isError) return;
    const input = event.input as Record<string, unknown> | undefined;
    const raw = typeof input?.command === "string" ? input.command : "";
    if (!raw) return;

    const shape = normalizeCommand(raw);
    const history = historyOf(state);
    if (shape) {
      history.shapes.push(shape);
      history.raw.push(raw.trim());
      if (history.shapes.length > HISTORY_LIMIT) {
        history.shapes.shift();
        history.raw.shift();
      }
    }

    const hit = detectRepeatedSequence(history.shapes, history.raw);
    if (!hit) return;

    // One proposal per sequence per session.
    state.muscleProposed = state.muscleProposed ?? [];
    const key = hit.sequence.join("→");
    if (state.muscleProposed.includes(key)) return;
    state.muscleProposed.push(key);

    const proposal = buildRoutineProposal(hit);
    const binPath = findUmaBinary(ctx.cwd);
    const res = await runUma(
      binPath,
      [
        "staging", "create",
        "--type", "skill",
        "--title", proposal.title,
        "--body", proposal.body,
        "--template", proposal.template,
        "--trigger", "muscle_synthesis",
        "--confidence", "0.8",
        "--tags", proposal.tags.join(","),
      ],
      ctx.cwd,
    );
    if (res.code === 0) {
      const s = stringsFor(state.config.lang);
      ctx.ui.notify(s.muscleProposalStaged.replace("{name}", hit.name), "info");
      void state.refreshDetector?.(ctx, true);
    }
  });
  return unsubscribe;
}