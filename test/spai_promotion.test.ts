import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPromotionDraft,
  canonicalizeSpaiId,
  cleanTaskText,
  isCanonicalSpaiId,
  isSpaiCompletion,
  PromotionLedger,
  SPAI_PROMOTION_CONFIDENCE,
  SPAI_PROMOTION_TRIGGER,
  spaiIdFromText,
} from "../src/slices/shadow/spai_promotion.ts";

test("only a transition to done promotes", () => {
  assert.equal(isSpaiCompletion("update_spai_status", { id: "SPAI-001", status: "done" }), true);
  assert.equal(isSpaiCompletion("update_spai_status", { status: "DONE" }), true);
  assert.equal(isSpaiCompletion("update_spai_status", { status: "working" }), false);
  assert.equal(isSpaiCompletion("update_spai_status", { status: "cancelled" }), false);
  assert.equal(isSpaiCompletion("update_spai_status", {}), false);
  assert.equal(isSpaiCompletion("update_spai_status", undefined), false);
  assert.equal(
    isSpaiCompletion("record_spai_item", { status: "done" }),
    false,
    "creating an already-done item is not a transition",
  );
});

test("the id is canonicalized from either the record or the response text", () => {
  assert.equal(spaiIdFromText('Stav položky SPAI-037 (x.md) byl změněn na "done".'), "SPAI-037");
  assert.equal(spaiIdFromText("SPAI-7 done"), "SPAI-007");
  assert.equal(spaiIdFromText("no reference here"), null);

  assert.equal(isCanonicalSpaiId("SPAI-037"), true);
  assert.equal(isCanonicalSpaiId("spai-7"), true);
  assert.equal(isCanonicalSpaiId("01M4WZCMGE9TAF6ARR87T69YZZ"), false, "a ULID is not a SPAI id");
  assert.equal(isCanonicalSpaiId("SPAI-x"), false);
  assert.equal(isCanonicalSpaiId(undefined), false);

  assert.equal(canonicalizeSpaiId("SPAI-7"), "SPAI-007");
  assert.equal(canonicalizeSpaiId("spai-041"), "SPAI-041");
  assert.equal(canonicalizeSpaiId("SPAI-"), null);
  assert.equal(canonicalizeSpaiId(null), null);
});

test("task text is tidied for review without touching prose", () => {
  assert.equal(
    cleanTaskText("x Tier 2 read-only source @pi-uma !medium :spai:integration:"),
    "Tier 2 read-only source",
  );
  assert.equal(cleanTaskText(". Fix the socket @\"my project\" ! :ipc:"), "Fix the socket");
  assert.equal(
    cleanTaskText("Kontext: akceptuje @id a ! v textu"),
    "Kontext: akceptuje a v textu",
    "the first metadata token per category is exactly what pi-spai consumes",
  );
  assert.equal(
    cleanTaskText("See @first and @second here"),
    "See and @second here",
    "only the first project token is metadata; the rest is prose and must survive",
  );
  assert.equal(cleanTaskText("plain sentence"), "plain sentence");
  assert.equal(cleanTaskText("/. waiting on upstream"), "waiting on upstream");
});

test("a promotion draft carries the task text and its provenance", () => {
  const draft = buildPromotionDraft(
    {
      id: "SPAI-036",
      title: "Tier 2 read-only SPAI source",
      body: "x Tier 2 read-only SPAI source @pi-uma :spai:integration:",
      tags: ["Spai", "integration"],
    },
    "SPAI-036",
  );

  assert.ok(draft);
  assert.equal(draft.type, "note");
  assert.equal(draft.title, "Tier 2 read-only SPAI source");
  assert.equal(draft.trigger, SPAI_PROMOTION_TRIGGER);
  assert.equal(draft.confidence, SPAI_PROMOTION_CONFIDENCE);
  assert.deepEqual(draft.spai, ["SPAI-036"]);
  assert.deepEqual(draft.tags, ["spai", "integration"], "lowercased and de-duplicated");
  assert.match(draft.body, /Completed SPAI-036/);
  assert.match(draft.body, /Tier 2 read-only SPAI source/);
  assert.ok(!draft.body.includes("@pi-uma"), "metadata is not part of the evidence text");
});

test("the record id wins over the fallback, and a missing id stages nothing", () => {
  const fromRecord = buildPromotionDraft({ id: "SPAI-041", title: "t", body: "b" }, "SPAI-007");
  assert.deepEqual(fromRecord?.spai, ["SPAI-041"]);

  const fromFallback = buildPromotionDraft({ title: "t", body: "b" }, "SPAI-7");
  assert.deepEqual(fromFallback?.spai, ["SPAI-007"], "canonicalized");

  assert.equal(
    buildPromotionDraft({ title: "t", body: "b" }, null),
    null,
    "no provenance, no draft",
  );
  assert.equal(buildPromotionDraft(undefined, "not-an-id"), null);

  const sparse = buildPromotionDraft({ id: "SPAI-005" }, "SPAI-005");
  assert.equal(sparse?.title, "Completed SPAI-005", "a missing title still yields a usable draft");
});

test("the ledger stages one proposal per completed item", () => {
  const ledger = new PromotionLedger();
  assert.equal(ledger.has("SPAI-001"), false);
  ledger.add("SPAI-001");
  assert.equal(ledger.has("SPAI-001"), true);
  ledger.add("SPAI-001");
  assert.equal(ledger.size(), 1, "re-marking done does not stage a second draft");
});
