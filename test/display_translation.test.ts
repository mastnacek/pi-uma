import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DisplayTranslation } from "../src/slices/translate/index.ts";

/** A fake context whose "model" prefixes the last user message with CS:. */
function fakeCtx(agentDir: string, delayMs = 0) {
  return {
    agentDir,
    model: { provider: "fake", id: "fake" },
    modelRegistry: {
      find: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {}, env: {} }),
      completeSimple: async (_m: unknown, context: { messages: Array<{ content: unknown }> }) => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const last = context.messages.at(-1)?.content;
        const text = typeof last === "string" ? last : JSON.stringify(last);
        return { stopReason: "stop", content: [{ type: "text", text: `CS:${text}` }] };
      },
    },
  } as never;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("a translation is shown only for the body it was made from (stale-translation fix)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uma-dt-"));
  try {
    const dt = new DisplayTranslation(fakeCtx(dir), () => {});
    dt.start("Original body.");
    await settle();
    const shown = dt.bodyFor("Original body.", true);
    assert.match(shown, /^CS:/);
    assert.match(shown, /Original body\./);
    // The operator edited the body: the old translation must not be shown.
    assert.equal(dt.bodyFor("Original body. Appended.", true), "Original body. Appended.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalidate() lets the edited body be translated again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uma-dt-"));
  try {
    const dt = new DisplayTranslation(fakeCtx(dir), () => {});
    dt.start("v1");
    await settle();
    dt.invalidate();
    dt.start("v2 edited");
    assert.equal(dt.pending, true);
    await settle();
    const shown = dt.bodyFor("v2 edited", true);
    assert.match(shown, /^CS:/);
    assert.match(shown, /v2 edited/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a late result of a superseded translation is dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uma-dt-"));
  try {
    const dt = new DisplayTranslation(fakeCtx(dir, 40), () => {});
    dt.start("old");
    dt.invalidate(); // edited before the first translation arrived
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(dt.pending, false);
    assert.equal(dt.bodyFor("old", true), "old", "the old result must not land after invalidate()");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
