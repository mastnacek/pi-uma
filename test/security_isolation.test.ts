import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findUmaBinary } from "../src/shared/client.ts";
import {
  loadConfig,
  PROJECT_ALLOWED_KEYS,
  sanitizeConfig,
} from "../src/shared/config.ts";

test("findUmaBinary never executes binaries planted in workspace cwd", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-malicious-repo-"));
  try {
    const maliciousBinDir = path.join(tmpDir, "bin");
    fs.mkdirSync(maliciousBinDir, { recursive: true });

    const binaryName = process.platform === "win32" ? "uma.exe" : "uma";
    const plantedBinary = path.join(maliciousBinDir, binaryName);
    fs.writeFileSync(plantedBinary, "fake binary content");

    const resolved = findUmaBinary(tmpDir);

    // It must NEVER resolve to the planted binary in tmpDir!
    assert.notEqual(
      path.resolve(resolved),
      path.resolve(plantedBinary),
      "findUmaBinary must ignore binaries inside cwd"
    );
    assert.ok(
      !resolved.startsWith(tmpDir),
      "Resolved binary must not reside inside the untrusted cwd"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sanitizeConfig strictly enforces project allowlist against sensitive gates", () => {
  const untrustedInput = {
    autoApprove: true,
    appendPrompt: true,
    immuneMode: "off",
    lang: "en",
    recallGate: true,
    maliciousKey: "injected",
  };

  const sanitized = sanitizeConfig(untrustedInput, PROJECT_ALLOWED_KEYS);

  // Sensitive keys must be dropped
  assert.equal(sanitized.autoApprove, undefined);
  assert.equal(sanitized.appendPrompt, undefined);
  assert.equal(sanitized.immuneMode, undefined);
  assert.equal((sanitized as Record<string, unknown>).maliciousKey, undefined);

  // Allowed keys must be preserved
  assert.equal(sanitized.lang, "en");
  assert.equal(sanitized.recallGate, true);
});

test("sanitizeConfig normalizes casing and rejects invalid enum values", () => {
  const input = {
    immuneMode: "Block",
    fastbrainJudge: "JEV",
    lang: "CS",
  };

  // Global scope (no key restriction)
  const sanitized = sanitizeConfig(input);
  assert.equal(sanitized.immuneMode, "block");
  assert.equal(sanitized.fastbrainJudge, "jev");
  assert.equal(sanitized.lang, "cs");

  const invalid = sanitizeConfig({
    immuneMode: "invalid_mode",
    fastbrainJudge: "nonsense",
    lang: "fr",
  });
  assert.equal(invalid.immuneMode, undefined);
  assert.equal(invalid.fastbrainJudge, undefined);
  assert.equal(invalid.lang, undefined);
});

test("loadConfig ignores sensitive gates from project .pi/uma.json", () => {
  const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uma-project-test-"));
  try {
    const dotPiDir = path.join(tmpProjectDir, ".pi");
    fs.mkdirSync(dotPiDir, { recursive: true });

    // Untrusted repo attempts to bypass approval modal and inject prompt
    fs.writeFileSync(
      path.join(dotPiDir, "uma.json"),
      JSON.stringify({
        autoApprove: true,
        appendPrompt: true,
        immuneMode: "off",
        recallGate: true,
      })
    );

    const { config } = loadConfig(tmpProjectDir);

    // autoApprove and appendPrompt must remain false (default/global safe values)
    assert.equal(config.autoApprove, false);
    assert.equal(config.appendPrompt, false);
    // immuneMode must not be forced off by project
    assert.notEqual(config.immuneMode, "off");
    // Allowed key recallGate is accepted
    assert.equal(config.recallGate, true);
  } finally {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  }
});
