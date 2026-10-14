import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStagingCreateArgs,
  DEFAULT_DRAFT_CONFIDENCE,
} from "../src/slices/shadow/staging_args.ts";

const base = {
  type: "note",
  title: "Tier 3",
  body: "evidence",
  trigger: "spai_done",
};

test("spai provenance always reaches the engine", () => {
  const args = buildStagingCreateArgs({ ...base, spai: ["SPAI-037"] });
  const at = args.indexOf("--spai");
  assert.ok(at >= 0, "the --spai flag must be present");
  assert.equal(args[at + 1], "SPAI-037");

  const multi = buildStagingCreateArgs({ ...base, spai: ["SPAI-037", "SPAI-036"] });
  assert.equal(multi[multi.indexOf("--spai") + 1], "SPAI-037,SPAI-036");
});

test("empty or absent provenance adds no flag", () => {
  assert.equal(buildStagingCreateArgs(base).includes("--spai"), false);
  assert.equal(buildStagingCreateArgs({ ...base, spai: [] }).includes("--spai"), false);
});

test("tags and template are forwarded, and confidence is explicit", () => {
  const args = buildStagingCreateArgs({
    ...base,
    confidence: 0.7,
    tags: ["spai", "integration"],
    template: "run {{x}}",
  });
  assert.equal(args[args.indexOf("--tags") + 1], "spai,integration");
  assert.equal(args[args.indexOf("--template") + 1], "run {{x}}");
  assert.equal(args[args.indexOf("--confidence") + 1], "0.7");
  assert.equal(args[args.indexOf("--trigger") + 1], "spai_done");
});

test("confidence defaults when omitted", () => {
  const args = buildStagingCreateArgs(base);
  assert.equal(args[args.indexOf("--confidence") + 1], String(DEFAULT_DRAFT_CONFIDENCE));
});
