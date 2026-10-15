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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

/** Upper bound on the whole gate: a triage that outlives this is skipped.
 *  The engine's own HTTP timeout must stay BELOW this (see TIMEOUT_SECS in
 *  jev.rs) so a slow judge degrades to the offline verdict inside the budget
 *  instead of tripping this ceiling. runUma reaps the child at this limit,
 *  so a timed-out gate never leaves an orphaned uma.exe behind. */
const GATE_TIMEOUT_MS = 15_000;

/**
 * Cap on the exclusion list sent to the engine (SPAI-048): a very long
 * session could grow the injected-id set unboundedly, and CLI argv has a
 * hard length ceiling on Windows. The most RECENT ids matter most — an old
 * fact whose exclusion gets dropped may legitimately re-appear after it
 * scrolled far out of the effective context window anyway.
 */
const MAX_EXCLUDE_IDS = 100;

/** Prompts that are commands, not questions — never gated. */
function isCommand(prompt: string): boolean {
  return prompt.trim().startsWith("/") || prompt.trim().startsWith("!");
}

export function registerFastbrainHook(pi: ExtensionAPI, state: ExtensionState): () => void {
  // Transcript renderer for gate decisions: structured, color-coded, and
  // scrollable by pi's own transcript — everything the flat notify was not.
  registerRecallEntryRenderer(pi);

  // Anti-echo bookkeeping (session-scoped): rebuild the injected-facts set
  // from the branch's own recall entries so reload/resume does not re-inject
  // what the transcript already holds, and clear it on compaction because
  // the summary may no longer carry the facts.
  const unsubscribers: Array<() => void> = [];
  unsubscribers.push(
    pi.on("session_start", (_event, ctx) => {
      const rebuilt = new Set<string>();
      for (const entry of ctx.sessionManager.getBranch()) {
        if (
          entry.type === "custom_message" &&
          (entry as { customType?: string }).customType === "uma-recall"
        ) {
          const ids = (entry as { details?: { ids?: unknown } }).details?.ids;
          if (Array.isArray(ids)) {
            for (const id of ids) {
              if (typeof id === "string") rebuilt.add(id);
            }
          }
        }
      }
      state.injectedFactIds = rebuilt;
    }),
  );
  unsubscribers.push(
    pi.on("session_before_compact", () => {
      state.injectedFactIds = new Set<string>();
    }),
  );

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
      // Engine-side anti-echo (SPAI-048): already-injected fact IDs are
      // removed from the ranking competition BEFORE the limit is applied,
      // so `--max 3` returns exactly the 3 best facts the session has not
      // seen. BM25 scores are per-fact independent, so exclusion never
      // reorders the survivors — the plugin-side filter in
      // buildRecallMessage stays as defense in depth for data drift.
      const injected = state.injectedFactIds ?? (state.injectedFactIds = new Set<string>());
      const excludeArgs = Array.from(injected)
        .slice(-MAX_EXCLUDE_IDS)
        .flatMap((id) => ["--exclude", id]);
      const judgeArgs =
        (state.config.fastbrainJudge === "jev"
          ? ["recall", "check", "--judge", "jev", "--json"]
          : ["recall", "check", "--json"])
          .concat(["--max", "3"], excludeArgs, [event.prompt]);

      // Session cwd, not the process start dir: the engine scopes recall
      // search to the git-root project name of the cwd it is given. When pi
      // is launched outside a git repo (e.g. a workspace root), process.cwd()
      // makes current_project None and the engine drops the project filter
      // entirely — every project's facts became recallable and unrelated
      // memories leaked into unrelated sessions.
      const output = await runUma(binPath, judgeArgs, ctx.cwd ?? process.cwd(), GATE_TIMEOUT_MS);
      // 124 = runUma's timeout reaper fired (engine outlived the gate).
      if (output.code === 124) {
        ctx.ui.notify("🧠 recall gate timed out — memory skipped this turn", "warning");
        return undefined;
      }
      if (output.code !== 0) {
        ctx.ui.notify(`🧠 recall gate unavailable: ${output.stderr.split("\n")[0] || "unknown error"}`, "warning");
        return undefined;
      }

      const verdict = JSON.parse(output.stdout) as RecallVerdict;
      // Anti-echo (SPAI-048): a fact the model already holds is pure token
      // waste — the injected message persists in the transcript — so facts
      // injected earlier this session are filtered out of the injection.
      // (`injected` was declared with the judge args; the engine already
      // excluded these IDs from ranking, this filter is defense in depth.)
      const message = buildRecallMessage(verdict, lang, injected);
      const newCount = message?.message.details.count ?? 0;
      // Two surfaces, two jobs: the transcript entry carries the structured,
      // color-coded detail (scrollable, persistent); the notify is only a
      // glanceable one-liner. Turns with nothing new stay out of the
      // transcript — repetition is exactly the noise this avoids — unless
      // the judge degraded, which must never hide behind silence.
      const degraded = isDegradedNote(verdict.note);
      if (newCount > 0 && message) {
        for (const id of message.message.details.ids) injected.add(id);
        pi.appendEntry(RECALL_GATE_ENTRY_TYPE, {
          prompt: event.prompt, verdict, lang, injectedCount: newCount,
        });
        if (ctx.hasUI) {
          ctx.ui.notify(
            degraded && verdict.note
              ? `${formatGateOneLiner(verdict, lang, newCount)} ⚠ ${verdict.note.split("\n")[0]}`
              : formatGateOneLiner(verdict, lang, newCount),
            degraded ? "warning" : "info",
          );
        }
        return message;
      }
      if (degraded && !verdict.search) {
        pi.appendEntry(RECALL_GATE_ENTRY_TYPE, { prompt: event.prompt, verdict, lang });
      }
      if (ctx.hasUI) {
        const quietLine =
          verdict.search && verdict.facts.length > 0
            ? lang === "cs"
              ? "🧠 ◐ trigger, ale všechna fakta jsou již v kontextu — nic neinjektováno"
              : "🧠 ◐ trigger, but all facts are already in context — nothing injected"
            : formatGateOneLiner(verdict, lang);
        ctx.ui.notify(
          degraded && verdict.note ? `${quietLine} ⚠ ${verdict.note.split("\n")[0]}` : quietLine,
          degraded ? "warning" : "info",
        );
      }
      return undefined;
    } catch {
      // The gate is advisory: any failure means "no recall", never "no run".
      ctx.ui.notify("🧠 recall gate failed — memory skipped this turn", "warning");
      return undefined;
    }
  });
  return unsubscribe;
}
