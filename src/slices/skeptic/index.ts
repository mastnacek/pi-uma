/**
 * Skeptic tool (Proposal 04, Pillar I): the adversarial devil's advocate.
 *
 * On-demand and read-only: the agent consults it BEFORE risky work and receives
 * a typed critique (failure mode, devil objection, risk level, concrete advice).
 * The verdict is advisory — it never blocks, because a probabilistic verdict
 * may not veto work (recorded decision); auto-blocking stays reserved for
 * deterministic AST contracts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeUma } from "../../shared/client.js";

export function registerSkepticTool(pi: ExtensionAPI, _state: unknown): void {
  pi.registerTool({
    name: "uma_skeptic",
    label: "UMA Skeptic",
    description:
      "Consult the adversarial Skeptic (devil's advocate) on a proposed intent BEFORE executing risky work. Read-only: returns a typed critique (failure mode, devil objection 0.0-1.0, risk level, concrete advice). The verdict is advisory and never blocks; use it on architecturally sensitive changes (locking, serialization, public APIs, migrations).",
    parameters: Type.Object({
      intent: Type.String({
        description: "Short synthetic Intent Statement: what you plan to do and why.",
      }),
      files: Type.Optional(
        Type.Array(Type.String(), {
          description: "Files the intent will touch, e.g. ['src/indexer/mod.rs'].",
        }),
      ),
      judge: Type.Optional(
        Type.String({
          description: "Which judge to use: 'jev' (default, semantic via OpenRouter) or 'off' (deterministic offline).",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const args = ["skeptic", "check", params.intent];
      if (params.files && params.files.length > 0) {
        args.push("--files", params.files.join(","));
      }
      if (params.judge) {
        args.push("--judge", params.judge);
      }
      args.push("--json");
      return executeUma(ctx.cwd, args);
    },
  });
}
