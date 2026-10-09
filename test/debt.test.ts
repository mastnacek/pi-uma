import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDebt,
  decideDebtEnforcement,
  debtReminderContent,
  listOpenDebts,
  MAX_ENFORCEMENTS_PER_RUN,
  openBlockingDebts,
  settleDebt,
  type ProspectiveDebt,
} from "../src/slices/debt/ledger.ts";

const ledger = (): ProspectiveDebt[] => [];

test("debt: add and settle roundtrip", () => {
  const l = ledger();
  const debt = addDebt(l, "Changed Store::search_all signature", "Update slices/search and mcp tools", true, 1);
  assert.equal(debt.id, "debt-1");
  assert.equal(l.length, 1);

  assert.ok(settleDebt(l, "debt-1"));
  assert.equal(l.length, 0);
  assert.ok(!settleDebt(l, "debt-1"), "double settle is a no-op");
});

test("debt: blocking filter only returns blocking entries", () => {
  const l = ledger();
  addDebt(l, "a", "b", true, 1);
  addDebt(l, "c", "d", false, 2);
  assert.equal(listOpenDebts(l).length, 2);
  assert.equal(openBlockingDebts(l).length, 1);
});

test("debt: enforcement policy — allow, enforce capped, then notify", () => {
  assert.equal(decideDebtEnforcement(0, 0), "allow");
  assert.equal(decideDebtEnforcement(2, 0), "enforce");
  assert.equal(decideDebtEnforcement(2, MAX_ENFORCEMENTS_PER_RUN - 1), "enforce");
  assert.equal(decideDebtEnforcement(2, MAX_ENFORCEMENTS_PER_RUN), "notify");
  assert.equal(decideDebtEnforcement(2, MAX_ENFORCEMENTS_PER_RUN + 5), "notify");
});

test("debt: reminder content lists every blocking debt in English", () => {
  const l = ledger();
  addDebt(l, "Changed the public API", "Update all callers in slices/search", true, 1);
  addDebt(l, "Ephemeral", "not blocking", false, 2);

  const content = debtReminderContent(openBlockingDebts(l));
  assert.ok(content.includes("Outstanding cognitive debts"), content);
  assert.ok(content.includes("debt-1"), content);
  assert.ok(content.includes("Update all callers in slices/search"), content);
  assert.ok(!content.includes("debt-2"), "non-blocking debts stay out of the reminder");
  assert.ok(!content.includes("nepoužívej") && !content.includes("Paměť"), "model text stays English");
});