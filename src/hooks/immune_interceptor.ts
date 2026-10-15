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
import type { ExtensionState } from "../shared/types.js";
import { runUma, findUmaBinary } from "../shared/client.js";
import { stringsFor } from "../shared/i18n.js";
import { translateOutputForDisplay } from "../shared/translate_client.js";
import {
  assessEdit,
  checkContractRules,
  decideImmuneAction,
  extractEdit,
  type PainVerdict,
  type RuleL1,
} from "../slices/immune/index.js";

/** Upper bound per check: a warning that costs 5 seconds is worse than none. */
const CHECK_TIMEOUT_MS = 5_000;

/** The L1 rules cache: decisions and patterns only, refreshed at most every 10 minutes. */
const RULES_CACHE_TTL_MS = 10 * 60 * 1_000;

interface CachedRules {
  rules: RuleL1[];
  fetchedAt: number;
}

let rulesCache: CachedRules | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

async function fetchPain(cwd: string, path: string): Promise<PainVerdict | undefined> {
  const binPath = findUmaBinary(cwd);
  const output = await withTimeout(runUma(binPath, ["risk", "pain", path, "--json"], cwd), CHECK_TIMEOUT_MS);
  if (!output || output.code !== 0) return undefined;
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
    withTimeout(runUma(binPath, ["list", "--json", "--type", "decision"], cwd), CHECK_TIMEOUT_MS),
    withTimeout(runUma(binPath, ["list", "--json", "--type", "pattern"], cwd), CHECK_TIMEOUT_MS),
  ]);
  const rules: RuleL1[] = [];
  for (const output of outputs) {
    if (!output || output.code !== 0) continue;
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
}

export function registerImmuneInterceptor(pi: ExtensionAPI, state: ExtensionState): () => void {
  const unsubscribe = pi.on("tool_call", async (event, ctx) => {
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
      const breaches = checkContractRules(rules, edit.path, edit.added);
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
            const s = stringsFor(state.config.lang);
            const { text } = await translateOutputForDisplay(ctx, action.message, state.config.lang);
            // pi's confirm() hardcodes "Yes"/"No" (it is select(`${title}\n${message}`)
            // internally), so the localized consent runs through select: the
            // translated body rides in the multi-line title, the buttons come
            // from the string table. The block REASON stays the English
            // original — the model reads it.
            const choice = await ctx.ui.select(`${s.immuneDialogTitle}\n${text}`, [s.dialogProceed, s.dialogBlock]);
            if (choice !== s.dialogProceed) {
              return { block: true, reason: action.message };
            }
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
  return unsubscribe;
}