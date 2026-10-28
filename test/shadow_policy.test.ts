import assert from "node:assert/strict";
import { test } from "node:test";
import { isCommandFailure } from "../src/slices/shadow/policy.ts";

test("isCommandFailure: '0 failed' on a green run is NOT a failure", () => {
  // The exact false positive: cargo's success summary.
  const green = "test result: ok. 148 passed; 0 failed; 0 ignored\n";
  assert.equal(isCommandFailure(green, false), false);
  assert.equal(isCommandFailure("0 errors, 0 warnings", false), false);
});

test("isCommandFailure: a non-zero count IS a failure", () => {
  assert.equal(
    isCommandFailure("test result: FAILED. 147 passed; 1 failed", false),
    true,
  );
  assert.equal(isCommandFailure("2 errors, 0 warnings", false), true);
});

test("isCommandFailure: compiler markers and the tool error flag count", () => {
  assert.equal(isCommandFailure("error[E0432]: unresolved import", false), true);
  assert.equal(isCommandFailure("error: expected `;`", false), true);
  assert.equal(isCommandFailure("clean output", true), true);
});

test("isCommandFailure: ordinary success output stays quiet", () => {
  assert.equal(isCommandFailure("Compiling uma-core\nFinished release profile", false), false);
  assert.equal(isCommandFailure("", false), false);
});

test("isUserCorrection: real corrections in English, translated and Czech original", async () => {
  const { isUserCorrection } = await import("../src/slices/shadow/policy.ts");
  assert.equal(isUserCorrection("That is an error: do not use var in this project, always const.", undefined, true), true);
  // Translation of "Špatně: ..." — the opener alone marks it.
  assert.equal(isUserCorrection("Incorrect: tests go into test, not tests.", undefined, true), true);
  // Czech marker survives only in the original the translate plugin keeps.
  assert.equal(isUserCorrection("Tests belong in test, not tests.", "Tohle je špatně: testy patří do test.", true), true);
});

test("isUserCorrection: task directives are never corrections (live false positive)", async () => {
  const { isUserCorrection } = await import("../src/slices/shadow/policy.ts");
  const directive = "Intentional gateway test: use the edit tool on src/app.js with newText console.log('debug: never use the logger module');";
  assert.equal(isUserCorrection(directive, undefined, true), false);
  assert.equal(isUserCorrection("Call uma_write with body 'never use tabs'.", undefined, true), false);
  assert.equal(isUserCorrection("x", "Zavolej uma_debt a nikdy nepoužívej nic jiného", true), false);
});

test("isUserCorrection: nothing to correct without a prior assistant reply", async () => {
  const { isUserCorrection } = await import("../src/slices/shadow/policy.ts");
  assert.equal(isUserCorrection("That's wrong, never use tabs.", undefined, false), false);
});
