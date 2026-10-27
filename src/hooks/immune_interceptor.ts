/**
 * Immune interceptor hook — thin subscription over the pure warn-mode
 * decision in slices/immune. The composition root owns the registration and
 * its tracked unsubscribe; this file only adapts pi's tool_call event to the
 * pure assessment and to UI notifications.
 *
 * Warn-only: this hook NEVER returns a block. It never throws into pi —
 * every failure degrades to silence, because an interceptor that breaks the
 * agent's work is worse than no interceptor.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../shared/types.ts";
import { runUma, findUmaBinary, updatePlasticity } from "../shared/client.ts";
import { stringsFor } from "../shared/i18n.ts";
import { translateOutputForDisplay, completeForDisplay } from "../shared/translate_client.ts";
import { appendImmuneDecision } from "../shared/decision_log.ts";
import {
  assessEdit,
  checkContractRules,
  decideImmuneAction,
  extractEdit,
  matchRule,
  type PainVerdict,
  type RuleL1,
} from "../slices/immune/index.ts";
import {
  buildRecommendationContext,
  formatRecommendation,
  parseRecommendation,
  type RuleRecommendation,
} from "../slices/immune/recommendation.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Upper bound per check: a warning that costs 5 seconds is worse than none.
 *  Passed to runUma as its execFile timeout: the child is reaped (exit 124)
 *  instead of being orphaned when the call gives up (SPAI-052) — the old
 *  bare Promise.race left uma.exe running for up to the engine's internal
 *  timeout. */
const CHECK_TIMEOUT_MS = 5_000;

/** Upper bound for the semantic second opinion: the dialog is interactive,
 * but a recommendation that arrives after 8s is worse than none at all. */
const RECOMMENDATION_TIMEOUT_MS = 8_000;

/** The L1 rules cache: decisions and patterns only, refreshed at most every 10 minutes. */
const RULES_CACHE_TTL_MS = 10 * 60 * 1_000;

interface CachedRules {
  rules: RuleL1[];
  fetchedAt: number;
}

let rulesCache: CachedRules | undefined;
const pendingWarnings = new Map<string, string>();

/**
 * Deadline wrapper for promises that do NOT own a spawned child (LLM calls
 * over fetch). Never wrap runUma in this: abandoning the race leaves the
 * engine process running — runUma's timeoutMs argument reaps instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

async function fetchPain(cwd: string, path: string): Promise<PainVerdict | undefined> {
  const binPath = findUmaBinary(cwd);
  // CHECK_TIMEOUT_MS rides inside runUma (exit 124 on kill), so the promise
  // always settles and no orphaned uma.exe survives the deadline.
  const output = await runUma(binPath, ["risk", "pain", path, "--json"], cwd, CHECK_TIMEOUT_MS);
  if (output.code !== 0) return undefined;
  try {
    return JSON.parse(output.stdout) as PainVerdict;
  } catch {
    return undefined;
  }
}

async function fetchRules(cwd: string): Promise<RuleL1[]> {
  const now = Date.now();
  if (rulesCache && now - rulesCache.fetchedAt < RULES_CACHE_TTL_MS) {
    return rulesCache.rules;
  }
  const binPath = findUmaBinary(cwd);
  // Two separate calls: clap rejects a repeated --type flag, and a single
  // call with both types silently reduced the cache to patterns only — the
  // decision rules (the VSA isolation rule among them) were missing.
  const outputs = await Promise.all([
    runUma(binPath, ["list", "--json", "--type", "decision"], cwd, CHECK_TIMEOUT_MS),
    runUma(binPath, ["list", "--json", "--type", "pattern"], cwd, CHECK_TIMEOUT_MS),
  ]);
  const rules: RuleL1[] = [];
  for (const output of outputs) {
    if (output.code !== 0) continue;
    try {
      const parsed = JSON.parse(output.stdout) as RuleL1[];
      rules.push(...parsed);
    } catch {
      // skip an unparsable response; the cache stays smaller, not wrong
    }
  }
  rulesCache = { rules, fetchedAt: now };
  return rules;
}

/** Public reset for tests: caches must never leak between test cases. */
export function resetImmuneCache(): void {
  rulesCache = undefined;
  pendingWarnings.clear();
}

/**
 * The semantic second opinion (SPAI-047): ask the shared cheap display model
 * whether the added text genuinely relates to the matched rule. Advisory
 * only — every failure path degrades to undefined and the dialog shows
 * without a recommendation; the operator's consent is never pre-empted.
 */
async function recommendForRule(
  ctx: ExtensionContext,
  rule: RuleL1,
  addedText: string,
  lang: "cs" | "en",
): Promise<RuleRecommendation | undefined> {
  try {
    const { systemPrompt, userText } = buildRecommendationContext(rule, addedText, lang);
    const result = await withTimeout(completeForDisplay(ctx, systemPrompt, userText), RECOMMENDATION_TIMEOUT_MS);
    if (!result?.text) return undefined;
    return parseRecommendation(result.text);
  } catch {
    return undefined;
  }
}

export function registerImmuneInterceptor(pi: ExtensionAPI, state: ExtensionState): () => void {
  const unsubCall = pi.on("tool_call", async (event, ctx) => {
    const mode = state.config.immuneMode;
    if (mode === "off") return undefined;

    // Only file-mutating code tools are checked at all.
    const edit = extractEdit(event.toolName, event.input);
    if (!edit) return undefined;

    try {
      const [pain, rules] = await Promise.all([
        fetchPain(ctx.cwd, edit.path),
        fetchRules(ctx.cwd),
      ]);
      const warnings = assessEdit(pain, rules, edit.added);
      // SPAI-049: real ast-grep matching (child process) — awaited, and the
      // hook's catch still degrades any failure to silence.
      const breaches = await checkContractRules(rules, edit.path, edit.added);
      const action = decideImmuneAction(mode, warnings, breaches);

      switch (action.kind) {
        case "allow":
          return undefined;
        case "notify": {
          // UI-only: the agent and the transcript never see these. The body
          // is display-translated like every other fact view (translate
          // slice invariant: presentation only, degrades to the original).
          const { text } = await translateOutputForDisplay(ctx, action.message, state.config.lang);
          ctx.ui.notify(text, "warning");
          return undefined;
        }
        case "confirm": {
          // The AI proposed, the operator decides: a decline BLOCKS the
          // call with the reason — consented blocking, the consent model
          // intact. The dialog shows a display-translated body and localized
          // buttons (pi's confirm() labels are hardcoded Yes/No, so select
          // carries the consent); the block REASON stays the English
          // original because the model reads it.
          if (action.message.length > 0) {
            const matched = matchRule(rules, edit.added);
            const hasRuleBreach = breaches.length > 0;
            const hasRuleMatch = matched !== undefined;
            const isHighPain = (pain?.score ?? 0) >= 50;

            // In ask mode (and auto mode heuristic prompts):
            // Dialog ONLY when the modification touches/violates a rule
            // or pain >= 50; otherwise no dialog, warning only via tool_result.
            if (!hasRuleBreach && !hasRuleMatch && !isHighPain) {
              if (pendingWarnings.size > 50) {
                const firstKey = pendingWarnings.keys().next().value;
                if (firstKey) pendingWarnings.delete(firstKey);
              }
              pendingWarnings.set(event.toolCallId, action.message);
              return undefined;
            }

            const s = stringsFor(state.config.lang);
            const { text } = await translateOutputForDisplay(ctx, action.message, state.config.lang);
            // Second opinion (SPAI-047): when the heuristic matched a rule,
            // attach the classifier's verdict so the operator decides with
            // information, not on faith. Advisory only — a missing verdict
            // silently shows the dialog unchanged.
            const rec = matched
              ? await recommendForRule(ctx, matched, edit.added, state.config.lang)
              : undefined;
            const recommendation = rec ? formatRecommendation(rec, state.config.lang) : undefined;
            // pi's confirm() hardcodes "Yes"/"No" (it is select(`${title}\n${message}`)
            // internally), so the localized consent runs through select: the
            // translated body rides in the multi-line title, the buttons come
            // from the string table. The block REASON stays the English
            // original — the model reads it.
            const title = recommendation
              ? `${s.immuneDialogTitle}\n${text}\n${recommendation}`
              : `${s.immuneDialogTitle}\n${text}`;
            const choice = await ctx.ui.select(title, [s.dialogProceed, s.dialogBlock]);
            // Plasticity wiring (SPAI-050): the consent outcome is an honest,
            // observable Hebbian signal for the matched RULE fact — the
            // operator upheld the rule (blocked the edit) → reinforce; the
            // operator overrode it (proceeded) → frustrate. Fire-and-forget
            // telemetry: a failure never affects the decision itself.
            // Frustrate only when verdict is contradicts/violates and the operator
            // proceeds anyway. An edit that only touches or is unrelated must
            // not erode the rule's weight.
            if (matched) {
              if (choice === s.dialogProceed) {
                if (rec?.relation === "violates" || (rec?.relation as string) === "contradicts") {
                  updatePlasticity(ctx.cwd ?? process.cwd(), matched.id, "frustrate");
                }
              } else {
                updatePlasticity(ctx.cwd ?? process.cwd(), matched.id, "reinforce");
              }
            }
            // The decision log (SPAI-047): evidence for evidence-based mode
            // tuning. Advisory — a logging failure never affects the call.
            void appendImmuneDecision({
              ts: new Date().toISOString(),
              ruleId: matched?.id,
              relation: rec?.relation,
              confidence: rec?.confidence,
              approved: choice === s.dialogProceed,
            });
            if (choice !== s.dialogProceed) {
              return { block: true, reason: action.message };
            }

            // On "Yes, continue", store the warning so it reaches the model via tool_result
            const jevVerdict = rec ? formatRecommendation(rec, "en") : undefined;
            const fullWarning = jevVerdict ? `${action.message}\n${jevVerdict}` : action.message;
            if (pendingWarnings.size > 50) {
              const firstKey = pendingWarnings.keys().next().value;
              if (firstKey) pendingWarnings.delete(firstKey);
            }
            pendingWarnings.set(event.toolCallId, fullWarning);
          }
          return undefined;
        }
        case "block":
          return { block: true, reason: action.reason };
        default:
          return undefined;
      }
    } catch {
      // Advisory half of the consent model: silence is the safe fallback.
    }
    return undefined;
  });

  const unsubResult = pi.on("tool_result", async (event, _ctx) => {
    const warning = pendingWarnings.get(event.toolCallId);
    if (!warning) return undefined;
    pendingWarnings.delete(event.toolCallId);

    const warningText = `\n[UMA Immune Advisory Warning]:\n${warning}`;
    return {
      content: [
        ...event.content,
        {
          type: "text" as const,
          text: warningText,
        },
      ],
      structuredContent: event.structuredContent,
      details: event.details,
    };
  });

  return () => {
    unsubCall();
    unsubResult();
  };
}