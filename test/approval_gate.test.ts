import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateApprovalGate,
  isBypassingBashCommand,
  isUmaMemoryFilePath,
  MEMORY_MUTATING_TOOLS,
} from "../src/hooks/approval_gate.ts";

/** Minimal fakes: the gate only reads `mode`, `hasUI`, and `config.autoApprove`. */
const ctx = (mode: string, hasUI: boolean) => ({ mode, hasUI }) as never;
const state = (autoApprove: boolean) => ({ config: { lang: "cs", autoApprove } }) as never;
const call = (toolName: string) => ({ type: "tool_call", toolCallId: "1", toolName, input: {} }) as never;

test("read-only tools are never gated", () => {
  // uma_consolidate belongs here: it proposes merges/contradictions but never
  // writes, so gating it would make approval routine instead of meaningful.
  for (const tool of ["uma_read", "uma_list", "uma_search", "uma_consolidate", "bash", "read"]) {
    assert.equal(evaluateApprovalGate(call(tool), ctx("print", false), state(false)), undefined);
  }
});

test("the gated set is exactly the memory-mutating tools", () => {
  assert.deepEqual([...MEMORY_MUTATING_TOOLS].sort(), ["uma_supersede", "uma_write"]);
});

test("TUI with auto-approve off allows the call so the modal can open", () => {
  assert.equal(evaluateApprovalGate(call("uma_write"), ctx("tui", true), state(false)), undefined);
});

test("TUI with auto-approve on allows the call", () => {
  assert.equal(evaluateApprovalGate(call("uma_write"), ctx("tui", true), state(true)), undefined);
});

test("non-interactive mode fails closed for every mutating tool", () => {
  for (const tool of MEMORY_MUTATING_TOOLS) {
    const result = evaluateApprovalGate(call(tool), ctx("print", false), state(false));
    assert.ok(result?.block, `${tool} must be blocked without a UI`);
    assert.match(result.reason ?? "", /approval/);
  }
});

test("auto-approve on permits non-interactive writes", () => {
  assert.equal(evaluateApprovalGate(call("uma_write"), ctx("print", false), state(true)), undefined);
});

test("hasUI true in a non-tui mode is still not an approval surface", () => {
  // RPC reports hasUI but cannot render custom components, so it must block.
  const result = evaluateApprovalGate(call("uma_supersede"), ctx("rpc", true), state(false));
  assert.ok(result?.block);
});

test("isUmaMemoryFilePath detects project and global UMA memory paths", () => {
  assert.equal(isUmaMemoryFilePath(".uma/decision/01ABC.md"), true);
  assert.equal(isUmaMemoryFilePath("d:/repo/.uma/preference/01ABC.md"), true);
  assert.equal(isUmaMemoryFilePath("C:\\Users\\user\\AppData\\Roaming\\uma\\uma\\data\\global\\fact\\01.md"), true);
  assert.equal(isUmaMemoryFilePath("src/main.rs"), false);
  assert.equal(isUmaMemoryFilePath(".pi/settings.json"), false);
});

test("isBypassingBashCommand detects uma write and uma supersede commands", () => {
  assert.equal(isBypassingBashCommand("uma write --title test --body hello"), true);
  assert.equal(isBypassingBashCommand("./bin/uma.exe supersede 01ABC --title test"), true);
  assert.equal(isBypassingBashCommand("uma.exe write --type decision"), true);
  assert.equal(isBypassingBashCommand("uma search 'query'"), false);
  assert.equal(isBypassingBashCommand("uma doctor"), false);
  assert.equal(isBypassingBashCommand("cargo test"), false);
});

test("direct file write or edit to UMA memory is strictly blocked by the gate", () => {
  const writeCall = {
    type: "tool_call",
    toolCallId: "1",
    toolName: "write",
    input: { path: ".uma/decision/01M4DIRECT.md", content: "bypass" },
  } as never;
  const result = evaluateApprovalGate(writeCall, ctx("tui", true), state(false));
  assert.ok(result?.block);
  assert.match(result?.reason ?? "", /UMA Memory Integrity Guard/);
  assert.match(result?.reason ?? "", /uma_write/);

  const editCall = {
    type: "tool_call",
    toolCallId: "2",
    toolName: "edit",
    input: { path: "D:/01_programovani/pi/plugins/pi-uma/.uma/preference/01P.md" },
  } as never;
  const editResult = evaluateApprovalGate(editCall, ctx("tui", true), state(false));
  assert.ok(editResult?.block);
  assert.match(editResult?.reason ?? "", /UMA Memory Integrity Guard/);

  // Normal edits to source files remain allowed
  const normalWrite = {
    type: "tool_call",
    toolCallId: "3",
    toolName: "write",
    input: { path: "src/app.ts", content: "ok" },
  } as never;
  assert.equal(evaluateApprovalGate(normalWrite, ctx("tui", true), state(false)), undefined);
});

test("direct bash invocation of uma write or supersede is strictly blocked", () => {
  const bashCall = {
    type: "tool_call",
    toolCallId: "4",
    toolName: "bash",
    input: { command: "uma write --title Bypass --type decision" },
  } as never;
  const result = evaluateApprovalGate(bashCall, ctx("tui", true), state(false));
  assert.ok(result?.block);
  assert.match(result?.reason ?? "", /UMA Memory Integrity Guard/);
  assert.match(result?.reason ?? "", /bash is strictly forbidden/);

  // Read-only bash commands are allowed
  const safeBash = {
    type: "tool_call",
    toolCallId: "5",
    toolName: "bash",
    input: { command: "uma search 'something'" },
  } as never;
  assert.equal(evaluateApprovalGate(safeBash, ctx("tui", true), state(false)), undefined);
});

