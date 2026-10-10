import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapText } from "../src/shared/wrap.ts";

test("wrapText: wraps long paragraphs into bounded lines", () => {
  const paragraph =
    "This is a long sentence explaining why views should open in a pane instead of a tab so that the user can see everything side by side.";
  const wrapped = wrapText(paragraph, 40);

  assert.ok(wrapped.length > 1);
  for (const line of wrapped) {
    assert.ok(line.length <= 40, `line length ${line.length} exceeds 40`);
  }
});

test("wrapText: preserves explicit newlines and blank lines", () => {
  const text = "First line.\n\nThird line after empty line.";
  const wrapped = wrapText(text, 50);

  assert.equal(wrapped.length, 3);
  assert.equal(wrapped[0], "First line.");
  assert.equal(wrapped[1], "");
  assert.equal(wrapped[2], "Third line after empty line.");
});

test("wrapText: splits unbroken long words exceeding maxWidth", () => {
  const longWord = "A".repeat(80);
  const wrapped = wrapText(longWord, 30);

  assert.equal(wrapped.length, 3);
  assert.equal(wrapped[0], "A".repeat(30));
  assert.equal(wrapped[1], "A".repeat(30));
  assert.equal(wrapped[2], "A".repeat(20));
});
