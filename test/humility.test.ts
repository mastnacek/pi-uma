import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideHumilityGate,
  explorationSatisfied,
  flagForPath,
  flagSubsystem,
  recordRead,
  REQUIRED_READS,
  type HumilityFlag,
} from "../src/slices/humility/policy.ts";

const flags = (): HumilityFlag[] => [];

test("humility: flagging and longest-prefix matching", () => {
  const f = flags();
  flagSubsystem(f, "src/deep/nested");
  const hit = flagForPath(f, "src/deep/nested/module.rs");
  assert.ok(hit);
  assert.equal(flagForPath(f, "src/other/module.rs"), undefined);
  assert.equal(flagForPath(f, "src/deep/nested-lookalike.rs"), undefined, "prefix must match on directory boundary");

  flagSubsystem(f, "src");
  assert.equal(flagForPath(f, "src/deep/nested/module.rs")?.dir, "src/deep/nested", "longest prefix wins");
});

test("humility: reads accumulate and satisfy the requirement", () => {
  const f = flags();
  const flag = flagSubsystem(f, "src/ffi");
  assert.ok(!explorationSatisfied(flag));

  recordRead(f, "src/ffi/one.rs");
  recordRead(f, "src/ffi/two.rs");
  recordRead(f, "src/ffi/three.rs");
  recordRead(f, "src/ffi/one.rs"); // duplicate ignored
  assert.equal(flag.reads.length, 3);
  assert.ok(explorationSatisfied(flag));
  assert.equal(REQUIRED_READS, 3);
});

test("humility: gate disabled allows everything", () => {
  const f = flags();
  flagSubsystem(f, "src/ffi");
  const action = decideHumilityGate(f, "src/ffi/one.rs", false);
  assert.deepEqual(action, { kind: "allow" });
});

test("humility: unexplored subsystem asks with the requirement stated", () => {
  const f = flags();
  flagSubsystem(f, "src/ffi");
  const action = decideHumilityGate(f, "src/ffi/one.rs", true);
  assert.equal(action.kind, "confirm");
  assert.ok(action.kind === "confirm" && action.message.includes("0/3"));
  assert.ok(action.kind === "confirm" && action.message.includes("Read-Only Explorative Mode"));
  assert.ok(action.kind === "confirm" && action.message.includes("uma_humility confirm"));
});

test("humility: after the required reads the ask softens (hypothesis missing)", () => {
  const f = flags();
  flagSubsystem(f, "src/ffi");
  for (const p of ["a.rs", "b.rs", "c.rs"]) recordRead(f, `src/ffi/${p}`);
  const action = decideHumilityGate(f, "src/ffi/d.rs", true);
  assert.equal(action.kind, "confirm");
  assert.ok(action.kind === "confirm" && action.message.includes("3 file(s) read"));
  assert.ok(action.kind === "confirm" && action.message.includes("not yet confirmed"));
});

test("humility: confirmed subsystem allows mutations", () => {
  const f = flags();
  const flag = flagSubsystem(f, "src/ffi");
  flag.confirmed = true;
  assert.deepEqual(decideHumilityGate(f, "src/ffi/one.rs", true), { kind: "allow" });
});