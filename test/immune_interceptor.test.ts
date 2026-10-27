import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "../src/shared/types.ts";
import { registerImmuneInterceptor, resetImmuneCache } from "../src/hooks/immune_interceptor.ts";

function makeState(immuneMode: "off" | "warn" | "ask" | "auto" | "block" = "ask"): ExtensionState {
  return {
    config: {
      immuneMode,
      lang: "en",
      autoApprove: false,
      recallGate: true,
      appendGate: "warn",
      judge: "offline",
      hud: false,
      muscleAutoProposal: false,
      skepticGate: "off",
    },
    registeredTools: new Set(),
    activeSubsystems: new Set(),
  };
}

test("registerImmuneInterceptor registers tool_call and tool_result and unsubs both", () => {
  resetImmuneCache();
  const registered: string[] = [];
  const unsubs: string[] = [];
  const pi = {
    on: (event: string) => {
      registered.push(event);
      return () => {
        unsubs.push(event);
      };
    },
  } as unknown as ExtensionAPI;

  const unsub = registerImmuneInterceptor(pi, makeState());
  assert.ok(registered.includes("tool_call"));
  assert.ok(registered.includes("tool_result"));

  unsub();
  assert.equal(unsubs.length, 2);
  assert.ok(unsubs.includes("tool_call"));
  assert.ok(unsubs.includes("tool_result"));
});

test("tool_result attaches advisory warning for approved toolCallId and preserves content/structuredContent", async () => {
  resetImmuneCache();
  const handlers: Record<string, (event: any, ctx: any) => Promise<any>> = {};
  const pi = {
    on: (event: string, handler: any) => {
      handlers[event] = handler;
      return () => {};
    },
  } as unknown as ExtensionAPI;

  registerImmuneInterceptor(pi, makeState("ask"));

  // Mock tool_call event for an edit that triggers confirm
  const mockCtx = {
    cwd: process.cwd(),
    ui: {
      select: async (_title: string, options: string[]) => {
        return options[0]; // Proceed
      },
      notify: () => {},
    },
  } as unknown as ExtensionContext;

  // Simulate an edit with content that matches a rule
  const callEvent = {
    type: "tool_call",
    toolCallId: "call_abc_123",
    toolName: "write",
    input: {
      path: "src/slices/dummy.ts",
      content: "import feature slices never import each other directly; shared contracts flow through uma-core or src/shared",
    },
  };

  const callResult = await handlers.tool_call(callEvent, mockCtx);
  // Allowed because operator clicked proceed
  assert.equal(callResult, undefined);

  // Now simulate tool_result for call_abc_123
  const resultEvent = {
    type: "tool_result",
    toolCallId: "call_abc_123",
    input: callEvent.input,
    content: [{ type: "text", text: "File written successfully." }],
    structuredContent: { success: true },
    details: { bytes: 100 },
    isError: false,
  };

  const modifiedResult = await handlers.tool_result(resultEvent, mockCtx);
  assert.ok(modifiedResult, "tool_result should return modified result");
  assert.equal(modifiedResult.content.length, 2);
  assert.equal(modifiedResult.content[0].text, "File written successfully.");
  assert.ok(modifiedResult.content[1].text.includes("[UMA Immune Advisory Warning]:"));
  assert.deepEqual(modifiedResult.structuredContent, { success: true });
  assert.deepEqual(modifiedResult.details, { bytes: 100 });

  // A second tool_result with same id gets undefined (consumed)
  const secondResult = await handlers.tool_result(resultEvent, mockCtx);
  assert.equal(secondResult, undefined);
});

test("tool_result ignores unrelated toolCallIds", async () => {
  resetImmuneCache();
  const handlers: Record<string, (event: any, ctx: any) => Promise<any>> = {};
  const pi = {
    on: (event: string, handler: any) => {
      handlers[event] = handler;
      return () => {};
    },
  } as unknown as ExtensionAPI;

  registerImmuneInterceptor(pi, makeState("ask"));

  const mockCtx = { cwd: process.cwd() } as ExtensionContext;
  const resultEvent = {
    type: "tool_result",
    toolCallId: "unrelated_call",
    input: {},
    content: [{ type: "text", text: "ok" }],
    isError: false,
  };

  const res = await handlers.tool_result(resultEvent, mockCtx);
  assert.equal(res, undefined);
});
