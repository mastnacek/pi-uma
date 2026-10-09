/**
 * Muscle tool (Proposal 05, Pillar I + consent amendment).
 *
 * Model-facing English only (tool description and results are instructions to
 * the agent); the operator-facing confirm dialog lives in dialog.ts and the
 * shadow-worker synthesis listener in hooks/muscle_synthesis.ts.
 *
 * Consent model: `run` is a DRY-RUN unless the operator consents through the
 * confirm dialog; in a non-interactive mode there is no consent surface, so
 * execution is refused (fail-closed) and only the dry-run is available.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionState } from "../../shared/types.js";
import { findUmaBinary, runUma } from "../../shared/client.js";
import { confirmExecution } from "./dialog.ts";

export function registerMuscleTool(pi: ExtensionAPI, state: ExtensionState): void {
  pi.registerTool({
    name: "uma_muscle",
    label: "UMA Muscle",
    description:
      "Procedural muscle memory: list operator-curated routines (list) or run one (run). WITHOUT consent a run is a DRY-RUN only (prints the sequence, executes nothing). Actual execution requires an interactive operator confirm dialog — in a non-interactive session there is no consent surface, so execution is refused (fail-closed) and only the dry-run is available. Routines are operator-curated skill facts tagged 'muscle'; the shadow worker can only propose candidates.",
    parameters: Type.Object({
      action: Type.String({
        description: "'list' curated routines, or 'run' one.",
      }),
      name: Type.Optional(
        Type.String({ description: "For 'run': the routine name (without the muscle: prefix)." }),
      ),
      confirm: Type.Optional(
        Type.Boolean({
          description: "For 'run': request operator consent to actually execute. Omit for a dry-run.",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const binPath = findUmaBinary(ctx.cwd);

      if (params.action === "list") {
        const res = await runUma(binPath, ["muscle", "list", "--json"], ctx.cwd);
        if (res.code !== 0) {
          return { content: [{ type: "text", text: `muscle list failed: ${res.stderr}` }], details: {} };
        }
        const routines = JSON.parse(res.stdout) as Array<{ name: string; steps: Array<{ command: string; args: string[] }> }>;
        if (routines.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No operator-curated routines (uma muscle new curates one; the shadow worker stages proposals for /uma review).",
              },
            ],
            details: {},
          };
        }
        const text = routines
          .map((r) => `${r.name} (${r.steps.length} steps):\n${r.steps.map((s) => `  $ ${s.command} ${s.args.join(" ")}`).join("\n")}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Operator-curated routines:\n${text}\n\nRun with action=run (dry-run by default).` }],
          details: { routines: routines.map((r) => r.name) },
        };
      }

      if (params.action === "run") {
        if (!params.name) {
          return { content: [{ type: "text", text: "run requires name." }], details: {}, isError: true };
        }
        if (params.confirm === true) {
          // Fail closed without a consent surface; ask when one exists.
          if (ctx.mode !== "tui" || !ctx.hasUI) {
            return {
              content: [
                {
                  type: "text",
                  text: "Refusing to execute: no interactive approval UI is available. A dry-run is permitted; ask the operator to run `uma muscle run --confirm` in a terminal, or re-run action=run without confirm.",
                },
              ],
              details: { executed: false, refused: "no-consent-surface" },
            };
          }
          const proceed = await confirmExecution(ctx, state, params.name);
          if (proceed === false) {
            return {
              content: [
                {
                  type: "text",
                  text: `Execution of '${params.name}' declined by the operator; only the dry-run summary is available.`,
                },
              ],
              details: { executed: false, declined: true },
            };
          }
          const res = await runUma(binPath, ["muscle", "run", params.name, "--confirm", "--json"], ctx.cwd);
          if (res.code !== 0) {
            return {
              content: [{ type: "text", text: `Routine '${params.name}' FAILED:\n${res.stdout || res.stderr}` }],
              details: { executed: true, success: false },
              isError: true,
            };
          }
          const report = JSON.parse(res.stdout) as { summary: string; steps_run: number; steps_total: number };
          return {
            content: [{ type: "text", text: `Muscle '${params.name}': ${report.summary}` }],
            details: { executed: true, success: true, steps_run: report.steps_run },
          };
        }

        // Dry-run: safe, no consent needed.
        const res = await runUma(binPath, ["muscle", "run", params.name, "--json"], ctx.cwd);
        if (res.code !== 0) {
          return { content: [{ type: "text", text: `Dry-run failed: ${res.stdout || res.stderr}` }], details: {}, isError: true };
        }
        const report = JSON.parse(res.stdout) as { summary: string };
        return {
          content: [
            {
              type: "text",
              text: `DRY-RUN of '${params.name}':\n${report.summary}\n\nSet confirm=true (operator consent dialog) to execute.`,
            },
          ],
          details: { executed: false, dry_run: true },
        };
      }

      return { content: [{ type: "text", text: "Unknown action: use 'list' or 'run'." }], details: {}, isError: true };
    },
  });
}