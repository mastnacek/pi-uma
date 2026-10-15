/**
 * Fastbrain recall gate — the S3 compromise.
 *
 * S3 (auto-inject memory facts into turns) was paused by operator choice:
 * uncontrolled injection caused context noise. This hook reopens it *gated*:
 * before each run, a fast judge decides whether the prompt may depend on
 * remembered facts. No trigger → nothing is injected. Trigger → an offline
 * BM25 recall (never a network semantic call per turn) brings the top facts
 * in as one hidden custom message, keeping the system prompt cache-stable.
 *
 * Everything here degrades quiet: the gate must never delay or fail a run.
 * No binary, no key, judge unavailable → the run proceeds with no recall.
 */

import type {
  ExtensionAPI,
  BeforeAgentStartEventResult,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../../shared/types.js";
import {
  runUma,
  findUmaBinary,
  fetchActiveRules,
  formatRulesForSystemPrompt,
} from "../../shared/client.js";
import {
  buildRecallMessage,
  formatGateOneLiner,
  isDegradedNote,
  type RecallVerdict,
} from "./policy.js";
import { RECALL_GATE_ENTRY_TYPE, registerRecallEntryRenderer } from "./entry_renderer.js";

/** Upper bound on the whole gate: a triage that outlives this is skipped. */
const GATE_TIMEOUT_MS = 15_000;

/** Prompts that are commands, not questions — never gated. */
function isCommand(prompt: string): boolean {
  return prompt.trim().startsWith("/") || prompt.trim().startsWith("!");
}

/** Races a promise against the gate timeout; undefined on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

export function registerFastbrainHook(pi: ExtensionAPI, state: ExtensionState): () => void {
  // Transcript renderer for gate decisions: structured, color-coded, and
  // scrollable by pi's own transcript — everything the flat notify was not.
  registerRecallEntryRenderer(pi);

  const unsubscribe = pi.on("before_agent_start", async (event, ctx) => {
    // 1. System prompt enhancement (abendum / append toggle)
    if (state.config.appendPrompt && event.systemPromptOptions?.sections) {
      try {
        const rules = await fetchActiveRules(ctx.cwd ?? process.cwd());
        const rulesText = formatRulesForSystemPrompt(rules);
        if (rulesText) {
          event.systemPromptOptions.sections.uma_rules = rulesText;
        }
      } catch {
        // fail quiet
      }
    }

    // 2. Recall gate (default off — S3 stays paused unless reopened).
    //    Only user prompts carry recallable text; 1.2.0 split the event into
    //    a union (user prompt | custom trigger message), so narrow before
    //    touching `.prompt` — a custom event has no prompt field at all.
    if (event.messageType !== "user") return undefined;
    if (!state.config.recallGate) return undefined;
    if (isCommand(event.prompt)) return undefined;

    const lang = state.config.lang;
    try {
      const binPath = findUmaBinary(ctx.cwd ?? process.cwd());
      const judgeArgs =
        state.config.fastbrainJudge === "jev"
          ? ["recall", "check", "--judge", "jev", "--json", event.prompt]
          : ["recall", "check", "--json", event.prompt];

      // Session cwd, not the process start dir: the engine scopes recall
      // search to the git-root project name of the cwd it is given. When pi
      // is launched outside a git repo (e.g. a workspace root), process.cwd()
      // makes current_project None and the engine drops the project filter
      // entirely — every project's facts became recallable and unrelated
      // memories leaked into unrelated sessions.
      const output = await withTimeout(runUma(binPath, judgeArgs, ctx.cwd ?? process.cwd()), GATE_TIMEOUT_MS);
      if (!output) {
        ctx.ui.notify("🧠 recall gate timed out — memory skipped this turn", "warning");
        return undefined;
      }
      if (output.code !== 0) {
        ctx.ui.notify(`🧠 recall gate unavailable: ${output.stderr.split("\n")[0] || "unknown error"}`, "warning");
        return undefined;
      }

      const verdict = JSON.parse(output.stdout) as RecallVerdict;
      // Two surfaces, two jobs: the transcript entry carries the structured,
      // color-coded detail (scrollable, persistent); the notify is only a
      // glanceable one-liner. No-trigger turns stay out of the transcript
      // unless the judge degraded — silence must never hide a fallback.
      const degraded = isDegradedNote(verdict.note);
      if (verdict.search || degraded) {
        pi.appendEntry(RECALL_GATE_ENTRY_TYPE, { prompt: event.prompt, verdict, lang });
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          degraded && verdict.note
            ? `${formatGateOneLiner(verdict, lang)} ⚠ ${verdict.note.split("\n")[0]}`
            : formatGateOneLiner(verdict, lang),
          degraded ? "warning" : "info",
        );
      }
      return buildRecallMessage(verdict, lang);
    } catch {
      // The gate is advisory: any failure means "no recall", never "no run".
      ctx.ui.notify("🧠 recall gate failed — memory skipped this turn", "warning");
      return undefined;
    }
  });
  return unsubscribe;
}
