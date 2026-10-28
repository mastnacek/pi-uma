import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  evaluateApprovalGate,
  isBypassingBashCommand,
  isProtectedMemoryPath,
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

test("isUmaMemoryFilePath covers the macOS and Linux global stores", () => {
  // Regression: the old check only knew the Windows %APPDATA% shape, so a
  // direct edit of the global store on mac/Linux slipped through.
  assert.equal(
    isUmaMemoryFilePath("/Users/x/Library/Application Support/com.uma.uma/global/decision/01.md"),
    true,
  );
  assert.equal(isUmaMemoryFilePath("/home/x/.local/share/uma/global/fact/01.md"), true);
  assert.equal(isUmaMemoryFilePath("/home/x/projects/app/src/main.rs"), false);
});

test("isBypassingBashCommand catches quoted, uma-cli and every memory-writing subcommand", () => {
  assert.equal(isBypassingBashCommand('"/path/to/uma.exe" write --title x'), true);
  assert.equal(isBypassingBashCommand("uma-cli supersede 01ABC --title x"), true);
  assert.equal(isBypassingBashCommand("uma staging approve 01ABC"), true);
  assert.equal(isBypassingBashCommand("uma skill new --name x"), true);
  assert.equal(isBypassingBashCommand("uma muscle new r --template '[]'"), true);
  // SPAI-050: plasticity fitness writes are model-invisible mutations.
  assert.equal(isBypassingBashCommand("uma plasticity reinforce rule-01"), true);
  assert.equal(isBypassingBashCommand("uma plasticity frustrate rule-01"), true);
  assert.equal(isBypassingBashCommand("uma mcp serve --allow-writes"), true);
  // Read-only invocations stay allowed.
  assert.equal(isBypassingBashCommand("uma staging list"), false);
  assert.equal(isBypassingBashCommand("uma plasticity status"), false);
  assert.equal(isBypassingBashCommand("uma mcp serve"), false);
  assert.equal(isBypassingBashCommand("uma list --json"), false);
});

test("isBypassingBashCommand catches shell writes into a store path", () => {
  assert.equal(isBypassingBashCommand("echo hi > .uma/decision/x.md"), true);
  assert.equal(isBypassingBashCommand("cp /tmp/a .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("sed -i s/a/b/ .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("python -c \"open('.uma/x','w')\""), true);
  // Reading a store file is not a write.
  assert.equal(isBypassingBashCommand("cat .uma/decision/x.md"), false);
  assert.equal(isBypassingBashCommand("ls .uma/"), false);
});

test("redirection target decides, not a bare mention (SPAI-053)", () => {
  // The reported false positive: stderr into /dev/null is not a store write.
  assert.equal(isBypassingBashCommand("ls .uma/ 2>/dev/null"), false);
  assert.equal(isBypassingBashCommand("cat .uma/decision/x.md 2>/dev/null | head"), false);
  assert.equal(isBypassingBashCommand("grep -r foo .uma/ > /tmp/out.txt"), false);
  assert.equal(isBypassingBashCommand("uma list --json 2>/dev/null"), false);
  assert.equal(isBypassingBashCommand("wc -l < .uma/decision/x.md"), false);
  // …but a redirect INTO the store is still blocked, in every spelling.
  assert.equal(isBypassingBashCommand("echo hi 2>/dev/null > .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("echo hi >>.uma/x.md"), true);
  assert.equal(isBypassingBashCommand("echo hi &> .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("echo hi | tee .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("rm .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("dd if=/dev/zero of=.uma/x.md"), true);
  assert.equal(isBypassingBashCommand("truncate -s 0 .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("sudo rm .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("env FOO=1 rm .uma/x.md"), true);
  assert.equal(isBypassingBashCommand("python3 -c \"open('.uma/x','w')\""), true);
  assert.equal(isBypassingBashCommand("echo x >> \"$APPDATA/uma/uma/data/global/f.md\""), true);
  // Mixed segments: the safe one must not mask the unsafe one.
  assert.equal(isBypassingBashCommand("ls .uma/ 2>/dev/null && rm -rf .uma"), true);
  assert.equal(isBypassingBashCommand("echo ok > /tmp/a; cat .uma/x.md > /tmp/b"), false);
});

test("isProtectedMemoryPath resolves a symlink into .uma", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-symlink-"));
  try {
    fs.mkdirSync(path.join(dir, ".uma"), { recursive: true });
    try {
      fs.symlinkSync(path.join(dir, ".uma"), path.join(dir, "m"), "dir");
    } catch {
      return; // symlink creation needs privileges on some Windows setups
    }
    const literal = path.join(dir, "m", "x.md");
    assert.equal(
      isProtectedMemoryPath(literal, dir),
      true,
      "a path through a symlink into .uma must be protected",
    );

    const call = {
      type: "tool_call",
      toolCallId: "1",
      toolName: "write",
      input: { path: literal, content: "x" },
    } as never;
    const ctxWithCwd = { mode: "tui", hasUI: true, cwd: dir } as never;
    assert.ok(evaluateApprovalGate(call, ctxWithCwd, state(false))?.block);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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


test("shell wrappers cannot hide a memory write (live bypass 2026-10-27)", () => {
  // The exact spelling that created a fact without the modal.
  assert.equal(
    isBypassingBashCommand('bash -c "D:/01_programovani/pi/plugins/pi-uma/bin/uma.exe write --title bypass-test --body x --type note"'),
    true,
  );
  assert.equal(isBypassingBashCommand("bash -c 'uma write --title a --body b'"), true);
  assert.equal(isBypassingBashCommand("sh -lc \"uma supersede 01ABC --title t\""), true);
  assert.equal(isBypassingBashCommand("sudo bash -c 'uma staging approve 01X'"), true);
  assert.equal(isBypassingBashCommand("cmd /c uma.exe write --title a --body b"), true);
  assert.equal(isBypassingBashCommand("cmd.exe /C \"uma-cli.exe write --title a\""), true);
  assert.equal(isBypassingBashCommand("powershell -Command \"uma write --title a --body b\""), true);
  assert.equal(isBypassingBashCommand("pwsh -NoProfile -c 'uma plasticity reinforce 01X'"), true);
  // Nested wrappers.
  assert.equal(isBypassingBashCommand("bash -c \"cmd /c uma write --title a\""), true);
  // Shell-level store writes inside a wrapper body.
  assert.equal(isBypassingBashCommand("powershell -Command \"Set-Content .uma/x.md 'y'\""), true);
  assert.equal(isBypassingBashCommand("pwsh -c \"Out-File -FilePath .uma/x.md -InputObject y\""), true);
  assert.equal(isBypassingBashCommand("cmd /c copy nul .uma\\x.md"), true);
  assert.equal(isBypassingBashCommand("bash -c 'printf y | tee .uma/x.md'"), true);
  assert.equal(isBypassingBashCommand("bash -c 'echo y > .uma/x.md'"), true);
  // Read-only bodies and unrelated wrappers stay allowed.
  assert.equal(isBypassingBashCommand("bash -c 'uma search leaf'"), false);
  assert.equal(isBypassingBashCommand("cmd /c type .uma\\x.md"), false);
  assert.equal(isBypassingBashCommand("powershell -Command \"Get-Content .uma/x.md\""), false);
  assert.equal(isBypassingBashCommand("bash script.sh"), false);
  assert.equal(isBypassingBashCommand("bash -c 'npm test'"), false);
  assert.equal(isBypassingBashCommand("Set-Content src/app.js 'x'"), false);
});

test("store-mutating CLI commands are gated (live bypasses 2026-10-28)", () => {
  // Each of these ran through bash unblocked in the live test.
  assert.equal(isBypassingBashCommand("uma domains set --domain gatetest 01M60MRAHCE754NDY032ZTV2WA"), true);
  assert.equal(isBypassingBashCommand("D:/x/bin/uma.exe migrate"), true);
  assert.equal(isBypassingBashCommand("uma migrate --reindex"), true);
  assert.equal(isBypassingBashCommand("uma sync push --message x"), true);
  assert.equal(isBypassingBashCommand("uma sync pull"), true);
  assert.equal(isBypassingBashCommand("uma staging discard 01M60N92B1MDJ7YXMF79FQWCZ7"), true);
  assert.equal(isBypassingBashCommand("uma muscle run git-status-log --confirm"), true);
  assert.equal(isBypassingBashCommand("bash -c 'uma sync push'"), true);
  // Read-only and dry-run spellings stay allowed.
  assert.equal(isBypassingBashCommand("uma migrate --dry-run"), false);
  assert.equal(isBypassingBashCommand("uma sync status"), false);
  assert.equal(isBypassingBashCommand("uma staging list"), false);
  assert.equal(isBypassingBashCommand("uma muscle run git-status-log"), false);
  assert.equal(isBypassingBashCommand("uma domains --help"), false);
});
