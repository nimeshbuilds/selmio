import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { assessPurchase, createDemoWorkspace, createEmptyWorkspace, resolveAmbiguity, summarizeWorkspace } from "./finance.ts";
import type { Workspace } from "./finance";

function basicWorkspace(): Workspace {
  return {
    ...createEmptyWorkspace(), bufferCents: 10000,
    accounts: [{ id: "cash", name: "Checking", institution: "Manual", type: "checking", balanceCents: 100000, lastUpdated: "2026-11-07" }],
  };
}

test("demo forecast is deterministic, account-specific and does not consume savings or credit", () => {
  const workspace = createDemoWorkspace();
  const result = assessPurchase(workspace, { accountId: "checking", amountCents: 60000, date: "2026-11-10" });
  assert.equal(result.status, "fits");
  assert.equal(result.startDate, "2026-11-07");
  assert.equal(result.endDate, "2026-11-30");
  assert.equal(result.conservativeRoomCents, 324750);
  assert.equal(result.favorableRoomCents, 337550);
  assert.deepEqual(result, assessPurchase(workspace, { accountId: "checking", amountCents: 60000, date: "2026-11-10" }));
  const altered = { ...workspace, accounts: workspace.accounts.map(account => account.id === "savings" ? { ...account, balanceCents: 0 } : account) };
  assert.equal(assessPurchase(altered, { accountId: "checking", amountCents: 60000, date: "2026-11-10" }).conservativeRoomCents, result.conservativeRoomCents);
});

test("ambiguous duplicate versus distinct purchase changes the verdict without double counting the posted charge", () => {
  const workspace = createDemoWorkspace();
  const purchase = { accountId: "checking", amountCents: 330000, date: "2026-11-10" };
  assert.equal(assessPurchase(workspace, purchase).status, "uncertain");
  assert.equal(assessPurchase(resolveAmbiguity(workspace, "everlane-hold", "duplicate"), purchase).status, "fits");
  assert.equal(assessPurchase(resolveAmbiguity(workspace, "everlane-hold", "distinct"), purchase).status, "exceeds");
  assert.equal(workspace.ambiguities[0].resolvedOptionId, undefined);
});

test("transaction history is not reapplied to the opening balance", () => {
  const workspace = basicWorkspace();
  workspace.transactions.push({ id: "old", accountId: "cash", date: "2026-11-06", merchant: "Rent", category: "Housing", amountCents: -200000, kind: "expense", status: "posted" });
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 0, date: "2026-11-07" });
  assert.equal(result.lowestConservativeCents, 100000);
  assert.equal(result.spendingRoomCents, 90000);
});

test("card payments and savings transfers are excluded from economic expense totals", () => {
  const workspace = basicWorkspace();
  workspace.transactions = [
    { id: "purchase", accountId: "cash", date: "2026-11-06", merchant: "Groceries", category: "Food", amountCents: -4200, kind: "expense", status: "posted" },
    { id: "payment", accountId: "cash", date: "2026-11-06", merchant: "Card payment", category: "Transfer", amountCents: -50000, kind: "transfer", status: "posted" },
    { id: "transfer", accountId: "cash", date: "2026-11-06", merchant: "Savings", category: "Transfer", amountCents: -10000, kind: "transfer", status: "posted" },
    { id: "pending", accountId: "cash", date: "2026-11-06", merchant: "Hold", category: "Food", amountCents: -8000, kind: "expense", status: "pending" },
  ];
  assert.equal(summarizeWorkspace(workspace).postedExpenseCents, 4200);
  assert.equal(summarizeWorkspace(workspace).pendingExpenseCents, 8000);
});

test("a card payment commitment still consumes checking cash", () => {
  const workspace = basicWorkspace();
  workspace.commitments.push({ id: "card", name: "Card payment", accountId: "cash", amountCents: 40000, dueDate: "2026-11-12", kind: "bill", confirmed: true });
  assert.equal(assessPurchase(workspace, { accountId: "cash", amountCents: 0, date: "2026-11-07" }).spendingRoomCents, 50000);
});

test("unconfirmed income never finances a purchase", () => {
  const workspace = basicWorkspace();
  workspace.commitments.push({ id: "maybe-pay", name: "Possible bonus", accountId: "cash", amountCents: 100000, dueDate: "2026-11-08", kind: "income", confirmed: false });
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 100000, date: "2026-11-09" });
  assert.equal(result.status, "exceeds");
  assert.equal(result.favorableRoomCents, 90000);
  assert.match(result.warnings.join(" "), /unconfirmed and is excluded/);
});

test("confirmed income is scheduled and accompanied by a conditional warning", () => {
  const workspace = basicWorkspace();
  workspace.commitments.push({ id: "pay", name: "Salary", accountId: "cash", amountCents: 100000, dueDate: "2026-11-08", kind: "income", confirmed: true });
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 100000, date: "2026-11-09" });
  assert.equal(result.status, "fits");
  assert.match(result.warnings.join(" "), /not a guarantee/);
});

test("a future payday does not conceal an earlier cash shortfall", () => {
  const workspace = basicWorkspace();
  workspace.commitments = [
    { id: "rent", name: "Rent", accountId: "cash", amountCents: 150000, dueDate: "2026-11-08", kind: "bill", confirmed: true },
    { id: "pay", name: "Salary", accountId: "cash", amountCents: 200000, dueDate: "2026-11-09", kind: "income", confirmed: true },
  ];
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 100, date: "2026-11-10" });
  assert.equal(result.status, "exceeds");
  assert.equal(result.lowestDate, "2026-11-08");
  assert.equal(result.lowestConservativeCents, -50000);
});

test("same-day income does not hide an intraday shortfall", () => {
  const workspace = basicWorkspace();
  workspace.commitments = [
    { id: "rent", name: "Rent", accountId: "cash", amountCents: 150000, dueDate: "2026-11-08", kind: "bill", confirmed: true },
    { id: "pay", name: "Salary", accountId: "cash", amountCents: 200000, dueDate: "2026-11-08", kind: "income", confirmed: true },
  ];
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 0, date: "2026-11-07" });
  assert.equal(result.status, "exceeds");
  assert.equal(result.timeline.find(day => day.date === "2026-11-08")?.dailyLowConservativeCents, -50000);
  assert.equal(result.timeline.find(day => day.date === "2026-11-08")?.conservativeCents, 150000);
});

test("unconfirmed bill contributes to the conservative outcome only", () => {
  const workspace = basicWorkspace();
  workspace.commitments.push({ id: "repair", name: "Possible repair", accountId: "cash", amountCents: 50000, dueDate: "2026-11-09", kind: "bill", confirmed: false });
  const result = assessPurchase(workspace, { accountId: "cash", amountCents: 50000, date: "2026-11-08" });
  assert.equal(result.status, "uncertain");
  assert.equal(result.conservativeRoomCents, 40000);
  assert.equal(result.favorableRoomCents, 90000);
});

test("invalid money, invalid dates, credit accounts and past dates fail explicitly", () => {
  const workspace = createDemoWorkspace();
  for (const amountCents of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assessPurchase(workspace, { accountId: "checking", amountCents, date: "2026-11-10" }), /integer cents/);
  }
  assert.throws(() => assessPurchase(workspace, { accountId: "checking", amountCents: 100, date: "2026-02-30" }), /real date/);
  assert.throws(() => assessPurchase(workspace, { accountId: "credit", amountCents: 100, date: "2026-11-10" }), /not available cash/);
  assert.throws(() => assessPurchase(workspace, { accountId: "checking", amountCents: 100, date: "2026-11-06" }), /cannot precede/);
});

test("an empty personal workspace is genuinely empty", () => {
  const workspace = createEmptyWorkspace();
  assert.equal(workspace.mode, "personal");
  assert.equal(workspace.accounts.length, 0);
  assert.equal(workspace.transactions.length, 0);
  assert.equal(summarizeWorkspace(workspace).netBalanceCents, 0);
  assert.equal(summarizeWorkspace(workspace).defaultAccountId, null);
});
