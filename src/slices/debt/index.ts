/**
 * Debt Ledger transport half (Proposal 04, Pillar III).
 *
 * Wires the pure ledger into pi:
 * - `uma_debt` tool: the agent records and settles its own obligations.
 * - Auto-capture: a Skeptic verdict with failure_mode=breaking_public_contract
 *   and a warning-worthy objection writes a debt automatically.
 * - `agent_before_settle`: while open BLOCKING debts exist, the agent gets one
 *   continuation reminder per settle attempt (capped) — it cannot quietly
 *   declare the task done with open blocking obligations.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionState } from "../../shared/types.js";
import { stringsFor } from "../../shared/i18n.js";
import {
  addDebt,
  decideDebtEnforcement,
  debtReminderContent,
  listOpenDebts,
  openBlockingDebts,
  settleDebt,
  type ProspectiveDebt,
} from "./ledger.js";

/** Session counters (module-level like the immune cache: one session per process). */
let debtCounter = 0;
let enforcementsThisRun = 0;

/** Public reset for tests. */
export function resetDebtState(): void {
  debtCounter = 0;
  enforcementsThisRun = 0;
}

function ledgerOf(state: ExtensionState): ProspectiveDebt[] {
  state.debts = state.debts ?? [];
  return state.debts;
}

export function registerDebtLedger(pi: ExtensionAPI, state: ExtensionState): () => void {
  // Reset the enforcement cap at the start of every agent run.
  const unsubStart = pi.on("agent_start", () => {
    enforcementsThisRun = 0;
  });

  // 1. Auto-capture from Skeptic verdicts: a flagged public-contract break
  //    automatically writes the owed follow-up into the ledger.
  const unsubSkeptic = pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "uma_skeptic") return;
    try {
      const text = event.content
        .map((c) => (typeof c === "object" && c !== null && "text" in c ? String((c as { text: unknown }).text ?? "") : ""))
        .join("\n");
      const parsed = JSON.parse(text) as {
        failure_mode?: string;
        warrants_warning?: boolean;
        advice?: string;
      };
      if (parsed.failure_mode === "breaking_public_contract" && parsed.warrants_warning) {
        addDebt(
          ledgerOf(state),
          "Skeptic flagged a public-contract risk",
          parsed.advice?.slice(0, 200) || "Update all callers of the changed contract before finishing.",
          true,
          ++debtCounter,
        );
        const s = stringsFor(state.config.lang);
        ctx.ui.notify(s.debtAutoCaptured, "info");
        void state.refreshDetector?.(ctx, true);
      }
    } catch {
      // Advisory: a malformed skeptic result never breaks the run.
    }
  });

  // 2. Settle-boundary enforcement: no quiet finishing with open blocking debts.
  const unsubSettle = pi.on("agent_before_settle", (_event, ctx) => {
    const blocking = openBlockingDebts(ledgerOf(state));
    const decision = decideDebtEnforcement(blocking.length, enforcementsThisRun);
    if (decision === "allow") return undefined;
    enforcementsThisRun += 1;

    if (decision === "notify") {
      const s = stringsFor(state.config.lang);
      ctx.ui.notify(`${s.debtStillOpen}${blocking.length}`, "warning");
      return undefined;
    }

    return {
      entries: [
        {
          type: "custom_message",
          customType: "uma-debt",
          content: debtReminderContent(blocking),
          display: false,
          details: { count: blocking.length },
        },
      ],
      continue: true,
    };
  });

  // 3. The agent's own ledger tool.
  pi.registerTool({
    name: "uma_debt",
    label: "UMA Debt Ledger",
    description:
      "Session-scoped Prospective Debt Ledger (cognitive debts). Record an obligation created by your current action (add), settle one when the owed work is done (settle), or list open debts (list). Debts are advisory session state — they are not written to the memory store; blocking debts must be settled before you declare the task finished.",
    parameters: Type.Object({
      action: Type.String({ description: "'add', 'settle', or 'list'." }),
      sourceAction: Type.Optional(
        Type.String({ description: "For 'add': the action that creates the obligation." }),
      ),
      requiredAction: Type.Optional(
        Type.String({ description: "For 'add': the owed follow-up work." }),
      ),
      blocking: Type.Optional(
        Type.Boolean({ description: "For 'add': blocks declaring the task done (default true)." }),
      ),
      id: Type.Optional(Type.String({ description: "For 'settle': the debt id." })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const ledger = ledgerOf(state);

      if (params.action === "add") {
        if (!params.sourceAction || !params.requiredAction) {
          return {
            content: [{ type: "text", text: "add requires sourceAction and requiredAction." }],
            details: {},
            isError: true,
          };
        }
        const debt = addDebt(ledger, params.sourceAction, params.requiredAction, params.blocking ?? true, ++debtCounter);
        void state.refreshDetector?.(ctx, true);
        return {
          content: [{ type: "text", text: `Debt ${debt.id} recorded: "${params.sourceAction}" owes "${params.requiredAction}".` }],
          details: { debt },
        };
      }

      if (params.action === "settle") {
        if (!params.id) {
          return { content: [{ type: "text", text: "settle requires id." }], details: {}, isError: true };
        }
        const ok = settleDebt(ledger, params.id);
        void state.refreshDetector?.(ctx, true);
        return {
          content: [{ type: "text", text: ok ? `Debt ${params.id} settled.` : `No open debt ${params.id}.` }],
          details: {},
        };
      }

      const open = listOpenDebts(ledger);
      if (open.length === 0) {
        return { content: [{ type: "text", text: "Ledger is empty — no open debts." }], details: {} };
      }
      const text = open
        .map((d) => `${d.id}${d.blocking ? " [BLOCKING]" : ""}: ${d.sourceAction} → ${d.requiredAction}`)
        .join("\n");
      return { content: [{ type: "text", text: `Open debts (${open.length}):\n${text}` }], details: {} };
    },
  });

  return () => {
    unsubStart();
    unsubSkeptic();
    unsubSettle();
  };
}
