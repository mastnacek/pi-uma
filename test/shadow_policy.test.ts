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
