/**
 * Shared client for display-only translation — the seam that lets
 * consumers (proposal modal, /uma fact views, the dash slice) use the
 * translate slice without cross-slice imports. Memory, CLI output and
 * stored data are NEVER touched by anything here: translation is
 * presentation only.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { translateForDisplay } from "../slices/translate/index.js";

export {
  DisplayTranslation,
  translateOutputForDisplay,
  completeForDisplay,
} from "../slices/translate/index.js";

/**
 * The minimum a display translation needs: model access and the agent dir the
 * translate-model knob is read from. Deliberately not a whole
 * `ExtensionContext` — the dash slice translates from an HTTP request, long
 * after the command invocation's context, and must not hold UI/session
 * handles or a stale abort signal. Building this reduces the call to exactly
 * one model request.
 */
export interface DisplayTranslationEnv {
  agentDir?: string;
  model: ExtensionContext["model"];
  modelRegistry: ExtensionContext["modelRegistry"];
}

/**
 * Translates one text for display for callers that have no live
 * `ExtensionContext` (per-card translation in the browser dashboard).
 *
 * Unlike `translateOutputForDisplay` there is no length floor and no language
 * guard: the operator clicked translate explicitly, so a short title is a
 * real request, not noise. Degrades to `{ error }`, never throws.
 */
export function translateTextForDisplay(
  env: DisplayTranslationEnv,
  text: string,
): Promise<{ text?: string; error?: string }> {
  if (text.trim().length === 0) return Promise.resolve({ text: "" });
  // SAFETY: `translateForDisplay` reads only `agentDir`, `model`, `signal`
  // and `modelRegistry` from its context; `DisplayTranslationEnv` carries the
  // first, second and fourth, `signal` is absent (undefined — correct for work
  // outside a turn) and no other field is ever touched. The cast is confined
  // to this seam so no consumer can pass a broader context by accident.
  return translateForDisplay(env as unknown as ExtensionContext, text);
}
