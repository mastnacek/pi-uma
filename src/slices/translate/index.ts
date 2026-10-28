/**
 * Display translation for the proposal modal.
 *
 * TRANSLATION IS DISPLAY-ONLY: the returned text must never reach the
 * proposal object — the reviewer sees Czech, UMA stores the original
 * English body untouched. That separation is the whole point of this
 * slice; folding the translated body back into the proposal would
 * silently change what gets saved (the modal round-trip lesson).
 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveTranslateModel } from "./model.ts";

import { buildTranslateContext } from "./prompt.ts";
export { buildTranslateContext };

export interface DisplayTranslationResult {
  /** Translated markdown; undefined when translation failed or was skipped. */
  text?: string;
  error?: string;
}

/**
 * Translates a fact body for display. Uses the session's current model —
 * no extra configuration, and the auth comes from pi's own model registry.
 * Degrades to `{}` (no text) on any failure: the modal then simply shows
 * the original, which is always acceptable because translation is a
 * display convenience, never a data transformation.
 */
export async function translateForDisplay(
  ctx: ExtensionContext,
  body: string,
): Promise<DisplayTranslationResult> {
  try {
    // Shared knob: the translate plugin's configured model (cheap flash),
    // degrading to the session's current model (see model.ts).
    const model = await resolveTranslateModel(ctx);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return { error: auth.error };

    // completeSimple reports model errors as a MESSAGE (stopReason "error"),
    // not a thrown exception — extract that path explicitly.
    const extract = (reply: AssistantMessage): DisplayTranslationResult => {
      if (reply.stopReason === "error") {
        return { error: reply.errorMessage ?? "model error" };
      }
      const text = reply.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (!text) return { error: "empty translation" };
      return { text };
    };

    const opts = {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal: ctx.signal,
    } as never;

    // Prefer the registry's own completion (it resolves provider routing and
    // auth the way pi does internally), then fall back to the compat shim.
    const registry = ctx.modelRegistry as
      | {
          completeSimple?: (
            m: Model<Api>,
            context: Context,
            options?: unknown,
          ) => Promise<AssistantMessage>;
          complete?: (
            m: Model<Api>,
            context: Context,
            options?: unknown,
          ) => Promise<AssistantMessage>;
        }
      | undefined;
    const context = buildTranslateContext(body);
    if (registry && typeof registry.completeSimple === "function") {
      return extract(await registry.completeSimple(model, context, opts));
    }
    if (registry && typeof registry.complete === "function") {
      return extract(await registry.complete(model, context, opts));
    }
    return extract(await completeSimple(model, context, opts));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
/** Module-level extractor: model errors arrive as stopReason "error"
 * messages, not exceptions — pull the text path explicitly. */
function extractDisplayText(reply: AssistantMessage): DisplayTranslationResult {
  if (reply.stopReason === "error") {
    return { error: reply.errorMessage ?? "model error" };
  }
  const text = reply.content
    ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
  if (!text) return { error: "empty translation" };
  return { text };
}

/**
 * Generic single-shot completion over the shared cheap display model (the
 * translate plugin's configured model). Generalizes the transport that
 * translateForDisplay uses so other features (immune recommendation,
 * SPAI-047) can ask the same model classification questions without a new
 * configuration knob. Display-only by the same invariant: nothing here
 * touches memory, CLI output or stored data; failures degrade to
 * `{ error }` and the caller decides what showing-the-original means.
 */
export async function completeForDisplay(
  ctx: ExtensionContext,
  systemPrompt: string,
  userText: string,
): Promise<DisplayTranslationResult> {
  try {
    const model = await resolveTranslateModel(ctx);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return { error: auth.error };

    const context = {
      systemPrompt,
      messages: [{ role: "user", content: userText, timestamp: Date.now() }],
    };
    const opts = {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal: ctx.signal,
    } as never;

    const registry = ctx.modelRegistry as
      | {
          completeSimple?: (
            m: Model<Api>,
            context: Context,
            options?: unknown,
          ) => Promise<AssistantMessage>;
          complete?: (
            m: Model<Api>,
            context: Context,
            options?: unknown,
          ) => Promise<AssistantMessage>;
        }
      | undefined;
    if (registry && typeof registry.completeSimple === "function") {
      return extractDisplayText(await registry.completeSimple(model, context as Context, opts));
    }
    if (registry && typeof registry.complete === "function") {
      return extractDisplayText(await registry.complete(model, context as Context, opts));
    }
    return extractDisplayText(await completeSimple(model, context as Context, opts));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Modal-side controller over the display translation lifecycle.
 *
 * Owns the cache and the state machine so the modal keeps only wiring:
 * `start()` fires the translation once (fire-and-forget), `onChange` is the
 * modal's re-render trigger, and `bodyFor()` is the only place the display
 * selection happens — the original body and the translated cache never
 * merge, which is the slice invariant. The failure reason is kept visible:
 * "unavailable" without a why is undebuggable.
 */
export class DisplayTranslation {
  private readonly ctx: ExtensionContext;
  private readonly onChange: () => void;
  private text?: string;
  /** The original the cached translation was made from: a translation of an
   *  older body must never be shown for an edited one (live finding
   *  2026-10-28 — the operator approved a stale translated body). */
  private source?: string;
  /** Bumped by invalidate(): a late result of a superseded request is dropped. */
  private generation = 0;
  private state: "idle" | "pending" | "done" | "failed" = "idle";
  private lastError?: string;

  constructor(
    ctx: ExtensionContext,
    onChange: () => void,
  ) {
    this.ctx = ctx;
    this.onChange = onChange;
  }

  /** Fires the translation once; later calls are no-ops. */
  start(body: string): void {
    if (this.state !== "idle") return;
    this.state = "pending";
    this.source = body;
    const generation = this.generation;
    void translateForDisplay(this.ctx, body).then((result) => {
      if (generation !== this.generation) return; // superseded by an edit
      if (result.text) {
        this.text = result.text;
        this.state = "done";
      } else {
        this.lastError = result.error;
        this.state = "failed";
      }
      this.onChange();
    });
  }

  get pending(): boolean {
    return this.state === "pending";
  }

  get failed(): boolean {
    return this.state === "failed";
  }

  get error(): string | undefined {
    return this.lastError;
  }

  /** Drops the cached translation (the body was edited); start() may run again. */
  invalidate(): void {
    this.generation++;
    this.text = undefined;
    this.source = undefined;
    this.lastError = undefined;
    this.state = "idle";
  }

  /** The body to display: the cache when shown, ready AND made from this very
   *  original — otherwise the original itself, never a stale translation. */
  bodyFor(original: string, showTranslation: boolean): string {
    return showTranslation &&
      this.state === "done" &&
      this.text !== undefined &&
      this.source === original
      ? this.text
      : original;
  }
}

/**
 * Display translation for /uma read, search and list output.
 *
 * One model call per command: the WHOLE output block (a fact body, or the
 * combined snippet list) goes through the same prompt contract as the
 * modal. Display-only by the same invariant — memory, CLI output and the
 * index stay untouched; a failure degrades to the original text with the
 * reason attached, never a partial or dropped view.
 */
export async function translateOutputForDisplay(
  ctx: ExtensionContext,
  text: string,
  lang: "cs" | "en",
): Promise<{ text: string; failed?: string }> {
  if (lang !== "cs" || text.trim().length < 80) return { text };
  const result = await translateForDisplay(ctx, text);
  if (result.text) return { text: result.text };
  return { text, failed: result.error };
}
