/**
 * Epistemic Humility slice (Proposal 04, Pillar IV) — the on-demand tool.
 *
 * Model-facing text stays English (tool description and results are
 * instructions to the agent); the operator-facing confirm dialog title is
 * localized in hooks/humility_gate.ts per the multilingual-UI rule.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionState } from "../../shared/types.js";
import { findUmaBinary, runUma } from "../../shared/client.js";
import {
  explorationSatisfied,
  flagForPath,
  flagSubsystem,
  recordRead,
  REQUIRED_READS,
  type HumilityFlag,
} from "./policy.ts";

export function flagsOf(state: ExtensionState): HumilityFlag[] {
  state.humilityFlags = state.humilityFlags ?? [];
  return state.humilityFlags;
}

/** Registers the tool and the read-tracking listener; returns the unsubscribe. */
export function registerHumilityTool(pi: ExtensionAPI, state: ExtensionState): () => void {
  // Read tracking: every read result feeds the flagged subsystems.
  const unsubRead = pi.on("tool_result", (event) => {
    if (event.toolName !== "read") return;
    const input = event.input as Record<string, unknown> | undefined;
    const path = typeof input?.path === "string" ? input.path : "";
    if (path) recordRead(flagsOf(state), path);
  });

  pi.registerTool({
    name: "uma_humility",
    label: "UMA Humility",
    description:
      "Familiarity Index / epistemic-humility check (read-only). Consult BEFORE touching a subsystem with no memory coverage or intricate constructs (macros, FFI, unsafe). A LOW verdict requires Read-Only Explorative Mode: read at least 3 related files, then confirm your hypothesis with action=confirm before the first mutation. The verdict advises; the operator gate asks, never silently blocks.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          description:
            "'check' (default) to assess familiarity, or 'confirm' to validate your hypothesis after the required reads.",
        }),
      ),
      intent: Type.Optional(
        Type.String({ description: "The intent you plan to execute (required for 'check')." }),
      ),
      files: Type.Optional(
        Type.Array(Type.String(), { description: "Files the intent will touch." }),
      ),
      hypothesis: Type.Optional(
        Type.String({
          description:
            "For 'confirm': your understanding of the subsystem, stated as a falsifiable hypothesis.",
        }),
      ),
      judge: Type.Optional(
        Type.String({
          description: "Which judge: 'jev' (default, semantic via OpenRouter) or 'off' (deterministic).",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const flags = flagsOf(state);

      if (params.action === "confirm") {
        const hypothesis = (params.hypothesis ?? "").trim();
        if (!hypothesis) {
          return {
            content: [
              {
                type: "text",
                text: "confirm requires hypothesis: state your understanding of the subsystem as a falsifiable hypothesis.",
              },
            ],
            details: { confirmed: false },
          };
        }
        const target =
          (params.files && params.files.length > 0 && flagForPath(flags, params.files[0])) ||
          [...flags].reverse().find((f) => !f.confirmed);
        if (!target) {
          return {
            content: [{ type: "text", text: "No flagged low-familiarity subsystem to confirm." }],
            details: { confirmed: false },
          };
        }
        if (!explorationSatisfied(target)) {
          return {
            content: [
              {
                type: "text",
                text: `Exploration incomplete: ${target.reads.length}/${REQUIRED_READS} related files read under ${target.dir}. Read more files first, then confirm.`,
              },
            ],
            details: { confirmed: false, reads: target.reads.length, required: REQUIRED_READS },
          };
        }
        target.confirmed = true;
        target.hypothesis = hypothesis;
        void state.refreshDetector?.(ctx, true);
        return {
          content: [
            {
              type: "text",
              text: `Hypothesis confirmed for ${target.dir} (${target.reads.length} files read). The humility gate now allows mutations there.`,
            },
          ],
          details: { confirmed: true, dir: target.dir, hypothesis },
        };
      }

      // Default: check
      const intent = (params.intent ?? "").trim();
      if (!intent) {
        return {
          content: [{ type: "text", text: "check requires intent (what you plan to do)." }],
          details: {},
        };
      }
      const files = params.files ?? [];
      const binPath = findUmaBinary(ctx.cwd);
      const args = ["humility", "check", intent, "--json"];
      if (files.length > 0) args.push("--files", files.join(","));
      if (params.judge) args.push("--judge", params.judge);

      const res = await runUma(binPath, args, ctx.cwd);
      if (res.code !== 0) {
        return {
          content: [{ type: "text", text: `Humility check failed: ${res.stderr.split("\n")[0] || res.stdout}` }],
          details: {},
        };
      }

      const verdict = JSON.parse(res.stdout) as {
        familiarity: string;
        exploration_required: boolean;
        fact_coverage: number;
        advice: string;
      };

      // LOW verdict flags the touched directories in session state so the gate can ask.
      if (verdict.familiarity === "low" && verdict.exploration_required) {
        for (const file of files) {
          const dir = file.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || ".";
          flagSubsystem(flags, dir);
        }
        void state.refreshDetector?.(ctx, true);
      }

      const instructions = verdict.exploration_required
        ? `\n\nREQUIRED (explorative mode): read at least ${REQUIRED_READS} related files, then call uma_humility with action=confirm and your stated hypothesis before the first mutation.`
        : "";
      return {
        content: [
          {
            type: "text",
            text: `Familiarity: ${verdict.fact_coverage} fact(s) covering these files → ${verdict.familiarity}.\n${verdict.advice}${instructions}`,
          },
        ],
        details: { familiarity: verdict.familiarity, exploration_required: verdict.exploration_required },
      };
    },
  });

  return unsubRead;
}