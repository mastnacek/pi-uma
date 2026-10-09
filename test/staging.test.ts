import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readStagedDraftsFromDisk } from "../src/slices/staging/drafts.ts";

test("staging: readStagedDraftsFromDisk returns empty array when no drafts exist", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-staging-test-"));
  try {
    const drafts = readStagedDraftsFromDisk(tempDir);
    assert.deepEqual(drafts, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("staging: readStagedDraftsFromDisk reads staged JSON drafts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-staging-test-"));
  const stagingDir = path.join(tempDir, ".uma", ".staging");
  fs.mkdirSync(stagingDir, { recursive: true });

  const mockDraft = {
    id: "01TESTDRAFT123",
    status: "draft",
    confidence: 0.9,
    provenance: {
      session_id: "sess-1",
      trigger_type: "compiler_recovery",
    },
    fact: {
      id: "01TESTDRAFT123",
      scope: "project:test",
      fact_type: "correction",
      title: "Use tempdir for store tests",
      body: "Never mock Store.",
      tags: ["testing"],
    },
  };

  fs.writeFileSync(
    path.join(stagingDir, "01testdraft123.json"),
    JSON.stringify(mockDraft, null, 2),
    "utf-8",
  );

  try {
    const drafts = readStagedDraftsFromDisk(tempDir);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].id, "01TESTDRAFT123");
    assert.equal(drafts[0].fact.title, "Use tempdir for store tests");
    assert.equal(drafts[0].confidence, 0.9);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
