import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRoutineProposal,
  detectRepeatedSequence,
  normalizeCommand,
  routineName,
  type RepetitionHit,
} from "../src/slices/muscle/policy.ts";

test("muscle: normalizeCommand strips to shape and excludes hazardous commands", () => {
  assert.equal(normalizeCommand("cargo test --release --features x"), "cargo test");
  assert.equal(normalizeCommand("npm run build"), "npm run");
  assert.equal(normalizeCommand("git push --force origin main"), undefined);
  assert.equal(normalizeCommand("rm -rf ."), undefined);
  assert.equal(normalizeCommand("sudo apt install"), undefined);
  assert.equal(normalizeCommand("   "), undefined);
});

test("muscle: detectRepeatedSequence finds non-overlapping repeats", () => {
  const shapes = ["cargo fmt", "cargo clippy", "cargo test", "git status", "cargo fmt", "cargo clippy", "cargo test", "git status"];
  const raw = shapes; // raw lines equal shapes here
  const hit = detectRepeatedSequence(shapes, raw);
  assert.ok(hit);
  assert.deepEqual(hit?.sequence, ["cargo fmt", "cargo clippy", "cargo test"]);
  assert.equal(hit?.occurrences, 2);
  assert.equal(hit?.name, "cargo-fmt-clippy");
});

test("muscle: repeated identical command is not a sequence", () => {
  const shapes = ["git status", "git status", "git status", "git status"];
  assert.equal(detectRepeatedSequence(shapes, shapes), undefined);
});

test("muscle: single occurrence stays silent", () => {
  const shapes = ["cargo fmt", "cargo clippy", "cargo test"];
  assert.equal(detectRepeatedSequence(shapes, shapes), undefined);
});

test("muscle: proposal carries a valid JSON step template and muscle: title", () => {
  const hit: RepetitionHit = {
    sequence: ["cargo fmt", "cargo clippy", "cargo test"],
    occurrences: 2,
    name: "cargo-fmt-clippy",
    rawLines: ["cargo fmt --all", "cargo clippy -- -D warnings", "cargo test -p uma-cli"],
  };
  const proposal = buildRoutineProposal(hit);
  assert.equal(proposal.title, "muscle:cargo-fmt-clippy");
  assert.ok(proposal.tags.includes("muscle"));
  assert.ok(proposal.tags.includes("routine-proposal"));
  const steps = JSON.parse(proposal.template) as Array<{ command: string; args: string[] }>;
  assert.equal(steps.length, 3);
  assert.equal(steps[0].command, "cargo");
  assert.deepEqual(steps[0].args, ["fmt", "--all"]);
  assert.ok(proposal.body.includes("2×"));
  assert.ok(proposal.body.includes("uma muscle run cargo-fmt-clippy --confirm"));
});

test("muscle: routineName dedupes words", () => {
  assert.equal(routineName(["npm test", "npm run", "npm test"]), "npm-test-run");
});
