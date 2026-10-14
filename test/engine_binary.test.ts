import assert from "node:assert/strict";
import { test } from "node:test";
import { umaBinaryCandidates } from "../src/shared/client.ts";

const PKG = "D:/pkg";

/** `path.join` uses the platform separator; compare in one normalized form. */
function slashed(candidates: string[]): string[] {
  return candidates.map((candidate) => candidate.replace(/\\/g, "/"));
}

test("a local cargo build outranks the shipped binary (SPAI-041)", () => {
  const candidates = slashed(umaBinaryCandidates(PKG, true));
  const dev = candidates.indexOf(`${PKG}/core/target/release/uma.exe`);
  const shipped = candidates.indexOf(`${PKG}/bin/uma.exe`);

  assert.ok(dev >= 0, "the development build must be a candidate");
  assert.ok(shipped >= 0, "the shipped binary must stay as the fallback");
  assert.ok(
    dev < shipped,
    "the committed binary used to shadow every cargo build: the plugin and engine then disagreed silently",
  );
  assert.equal(candidates[0], `${PKG}/core/target/release/uma.exe`);
});

test("the shipped binary remains reachable for production installs", () => {
  const candidates = slashed(umaBinaryCandidates(PKG, true));
  assert.ok(
    candidates.includes(`${PKG}/bin/uma.exe`),
    "an install with no target dir must still find its engine",
  );
  assert.ok(
    candidates.includes(`${PKG}/bin/uma-cli.exe`),
    "the pre-rename fallback is kept for stale installs",
  );
});

test("non-Windows candidates have no extension", () => {
  const candidates = slashed(umaBinaryCandidates("/pkg", false));
  assert.equal(candidates[0], "/pkg/core/target/release/uma");
  assert.ok(candidates.includes("/pkg/bin/uma"));
  assert.ok(!candidates.some((candidate) => candidate.endsWith(".exe")));
});
