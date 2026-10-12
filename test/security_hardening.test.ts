import assert from "node:assert/strict";
import { test } from "node:test";
import { pathMatchesInside } from "../src/slices/immune/index.ts";

test("pathMatchesInside escapes regex metacharacters instead of ReDoS-ing", () => {
  // An attacker-controlled glob. Unescaped, `(a+)+` is catastrophic
  // backtracking; escaped, it is a literal that simply does not match.
  const start = Date.now();
  const result = pathMatchesInside("src/(a+)+/**", "src/aaaaaa/x.ts");
  const elapsed = Date.now() - start;

  assert.equal(result, false, "a metacharacter glob must not be treated as a regex");
  assert.ok(elapsed < 250, `glob match must stay linear (took ${elapsed}ms)`);
});

test("pathMatchesInside still matches ordinary globs", () => {
  assert.equal(pathMatchesInside("src/slices/**", "src/slices/write/index.ts"), true);
  assert.equal(pathMatchesInside("src/slices/*.ts", "src/slices/a.ts"), true);
  assert.equal(pathMatchesInside("src/slices/*.ts", "src/slices/nested/a.ts"), false);
  assert.equal(pathMatchesInside("core/uma-cli/src/slices/**", "core/uma-cli/src/slices/x/mod.rs"), true);
});
