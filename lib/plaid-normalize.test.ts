import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { mergePlaidSnapshot, normalizePlaidSnapshot } from "./plaid-normalize.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { assessPurchase } from "./finance.ts";
import type { Workspace } from "./finance";

const syncTime = "2026-11-07T12:30:00.000Z";
function sourceAccount(overrides: Record<string, unknown> = {}) {
  return { account_id: "cash", item_id: "bank", name: "Checking", type: "depository", subtype: "checking", balances: { current: 1234.56, available: 1200, iso_currency_code: "USD", unofficial_currency_code: null }, ...overrides };
}
function sourceTransaction(overrides: Record<string, unknown> = {}) {
  return { transaction_id: "purchase", account_id: "cash", item_id: "bank", amount: 24.50, date: "2026-11-06", merchant_name: "Market", pending: false, iso_currency_code: "USD", unofficial_currency_code: null, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" }, ...overrides };
}
function sourceSnapshot(overrides: Record<string, unknown> = {}) {
  return { snapshot: true, environment: "production", items: [{ id: "bank", institutionName: "Real Bank", lastSyncedAt: syncTime, environment: "production" }], accounts: [sourceAccount()], transactions: [sourceTransaction()], lastSyncedAt: syncTime, ...overrides };
}
function personal(): Workspace { return { schemaVersion: 1, mode: "personal", accounts: [], transactions: [], commitments: [], ambiguities: [], bufferCents: 50000 }; }

test("USD cash and card balances use integer cents and correct debt signs", () => {
  const result = normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount(), sourceAccount({ account_id: "savings", type: "depository", subtype: "savings" }), sourceAccount({ account_id: "card", type: "credit", subtype: "credit card", balances: { current: 450.75, iso_currency_code: "USD" } }), sourceAccount({ account_id: "overpaid", type: "credit", subtype: "credit card", balances: { current: -20, iso_currency_code: "USD" } })] }));
  assert.equal(result.accounts[0].id, "plaid:cash");
  assert.equal(result.accounts[0].balanceCents, 123456);
  assert.equal(result.accounts[0].institution, "Real Bank");
  assert.equal(result.accounts[0].lastUpdated, syncTime);
  assert.equal(result.accounts[1].type, "savings");
  assert.equal(result.accounts[2].balanceCents, -45075);
  assert.equal(result.accounts[3].balanceCents, 2000);
  assert.equal(result.transactions[0].amountCents, -2450);
});

test("cash management maps to checking, while investment and loan accounts are skipped", () => {
  const result = normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount({ subtype: "cash management" }), sourceAccount({ account_id: "investment", type: "investment", subtype: "brokerage" }), sourceAccount({ account_id: "loan", type: "loan", subtype: "mortgage" })] }));
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].type, "checking");
  assert.match(result.warnings.join(" "), /not supported/);
});

test("null current balance never falls back to available or zero", () => {
  const result = normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount({ balances: { current: null, available: 1000, iso_currency_code: "USD" } })] }));
  assert.equal(result.accounts.length, 0);
  assert.equal(result.transactions.length, 0);
  assert.match(result.warnings.join(" "), /rather than assumed to be zero/);
});

test("unknown, non-USD and conflicting currencies are skipped", () => {
  for (const balances of [{ current: 5 }, { current: 5, iso_currency_code: "EUR" }, { current: 5, iso_currency_code: "USD", unofficial_currency_code: "BTC" }]) {
    const result = normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount({ balances })] }));
    assert.equal(result.accounts.length, 0);
    assert.match(result.warnings.join(" "), /not explicitly denominated in USD/);
  }
});

test("only explicit income is earned income; refunds are positive expense offsets", () => {
  const result = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "refund", amount: -35 }), sourceTransaction({ transaction_id: "salary", amount: -2000, personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" } })] }));
  assert.equal(result.transactions[0].amountCents, 3500);
  assert.equal(result.transactions[0].kind, "expense");
  assert.match(result.transactions[0].category, /Credit \/ refund/);
  assert.equal(result.transactions[1].kind, "income");
  assert.equal(result.transactions[1].amountCents, 200000);
});

test("only matching primary and detailed transfer or card-payment codes become transfers", () => {
  const categories = [
    { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" },
    { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
    { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" },
    { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_CASH_ADVANCES_AND_LOANS" },
    { primary: "GENERAL_MERCHANDISE", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" },
  ];
  const result = normalizePlaidSnapshot(sourceSnapshot({ transactions: categories.map((category, index) => sourceTransaction({ transaction_id: `tx-${index}`, personal_finance_category: category })) }));
  assert.deepEqual(result.transactions.map(transaction => transaction.kind), ["transfer", "transfer", "expense", "expense", "expense"]);
});

test("malformed supported-account transactions are rejected without erasing old local history", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot())).workspace;
  for (const transaction of [sourceTransaction({ date: "2026-02-30" }), sourceTransaction({ amount: 1.001 }), sourceTransaction({ iso_currency_code: null }), sourceTransaction({ pending: undefined })]) {
    const normalized = normalizePlaidSnapshot(sourceSnapshot({ transactions: [transaction] }));
    assert.equal(normalized.transactions.length, 0);
    assert.deepEqual(normalized.incompleteAccountIds, ["plaid:cash"]);
    const merged = mergePlaidSnapshot(prior, normalized);
    assert.equal(merged.workspace.transactions.length, 1);
    assert.match(merged.warnings.join(" "), /retained instead of treating rejected rows as deleted/);
  }
});

test("complete snapshots replace source history and remove provider-deleted transactions", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot())).workspace;
  prior.transactions.push({ id: "csv:manual", accountId: "plaid:cash", date: "2026-11-06", merchant: "Manual imported expense", amountCents: -100, category: "Food", kind: "expense", status: "posted" });
  const result = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ transactions: [] })));
  assert.deepEqual(result.workspace.transactions.map(transaction => transaction.id), ["csv:manual"]);
});

test("explicit pending replacement carries user category and kind to its new source identity", () => {
  const pending = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 80, pending: true })] }));
  const prior = mergePlaidSnapshot(personal(), pending).workspace;
  prior.transactions[0].category = "Business meals";
  prior.transactions[0].kind = "transfer";
  const posted = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "final", pending_transaction_id: "hold", amount: 96, pending: false })] }));
  const result = mergePlaidSnapshot(prior, posted);
  assert.equal(result.workspace.transactions.length, 1);
  assert.equal(result.workspace.transactions[0].id, "plaid:final");
  assert.equal(result.workspace.transactions[0].amountCents, -9600);
  assert.equal(result.workspace.transactions[0].category, "Business meals");
  assert.equal(result.workspace.transactions[0].kind, "transfer");
  assert.equal(result.workspace.ambiguities.length, 0);
  assert.equal(prior.transactions[0].id, "plaid:hold");
});

test("stable IDs keep edited classifications when source details change", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot())).workspace;
  prior.transactions[0].category = "My custom category";
  const next = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ amount: 25, date: "2026-11-07", personal_finance_category: { primary: "OTHER" } })] }));
  const result = mergePlaidSnapshot(prior, next);
  assert.equal(result.workspace.transactions[0].category, "My custom category");
  assert.equal(result.workspace.transactions[0].amountCents, -2500);
});

test("missing or unsupported bank accounts retain balances, history and dependent commitments", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot())).workspace;
  prior.commitments.push({ id: "bill", name: "Rent", accountId: "plaid:cash", amountCents: 50000, dueDate: "2026-11-15", kind: "bill", confirmed: true });
  const result = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ accounts: [], transactions: [] })));
  assert.equal(result.workspace.accounts.length, 1);
  assert.equal(result.workspace.transactions.length, 1);
  assert.equal(result.workspace.commitments[0].accountId, result.workspace.accounts[0].id);
  assert.equal(result.workspace.accounts[0].lastUpdated, syncTime);
  assert.match(result.warnings.join(" "), /may be stale/);
});

test("connecting from demo clears sample data instead of mixing it with bank funds", () => {
  const demo = { ...personal(), mode: "demo" as const, bufferCents: 150000, accounts: [{ id: "demo", name: "Sample", institution: "Sample", type: "checking" as const, balanceCents: 99999999, lastUpdated: "2026-11-07" }], commitments: [{ id: "sample-bill", name: "Sample", accountId: "demo", amountCents: 1, dueDate: "2026-11-15", kind: "bill" as const, confirmed: true }] };
  const result = mergePlaidSnapshot(demo, normalizePlaidSnapshot(sourceSnapshot()));
  assert.equal(result.workspace.mode, "personal");
  assert.equal(result.workspace.accounts.length, 1);
  assert.equal(result.workspace.accounts[0].id, "plaid:cash");
  assert.equal(result.workspace.commitments.length, 0);
  assert.equal(result.workspace.bufferCents, 50000);
  assert.equal(demo.accounts[0].id, "demo");
});

test("freshness is per institution, and does not borrow another bank's newer sync date", () => {
  const older = "2026-11-01T00:00:00.000Z";
  const result = normalizePlaidSnapshot(sourceSnapshot({ items: [{ id: "bank", institutionName: "Slow Bank", lastSyncedAt: older, environment: "production" }, { id: "new", institutionName: "Fresh Bank", lastSyncedAt: syncTime, environment: "production" }] }));
  assert.equal(result.accounts[0].lastUpdated, older);
  assert.equal(result.lastSyncedAt, syncTime);
});

test("initial empty sync and sandbox are labeled explicitly", () => {
  const result = normalizePlaidSnapshot(sourceSnapshot({ environment: "sandbox", items: [], accounts: [], transactions: [], lastSyncedAt: null, syncError: "Initial sync is not ready." }));
  assert.equal(result.environment, "sandbox");
  assert.equal(result.lastSyncedAt, "");
  assert.equal(result.syncError, "Initial sync is not ready.");
  assert.match(result.warnings.join(" "), /simulated/);
  assert.match(result.warnings.join(" "), /No successful/);
});

test("malformed, delta-only or duplicate-ID payloads fail without a replacement", () => {
  assert.throws(() => normalizePlaidSnapshot({ accounts: [], transactions: [] }), /complete bank snapshot/);
  assert.throws(() => normalizePlaidSnapshot(sourceSnapshot({ environment: "development" })), /unsupported Plaid environment/);
  assert.throws(() => normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount(), sourceAccount()] })), /duplicate account/);
  assert.throws(() => normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction(), sourceTransaction()] })), /duplicate transaction/);
});

test("normalization drops credentials and does not mutate source objects", () => {
  const raw = sourceSnapshot({ secret: "must-not-copy", access_token: "must-not-copy" });
  const before = JSON.stringify(raw);
  const result = normalizePlaidSnapshot(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(JSON.stringify(result).includes("must-not-copy"), false);
});

test("pending cash outflows add explicit snapshot-date exposure without replaying posted history", () => {
  const normalized = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 80, date: "2026-11-06", pending: true }), sourceTransaction({ transaction_id: "posted", amount: 500, pending: false })] }));
  const merged = mergePlaidSnapshot(personal(), normalized);
  assert.equal(merged.workspace.ambiguities.length, 1);
  const review = merged.workspace.ambiguities[0];
  assert.equal(review.id, "plaid-pending:hold");
  assert.equal(review.date, "2026-11-07");
  assert.equal(review.amountCents, 8000);
  assert.equal(review.resolvedOptionId, undefined);
  assert.deepEqual(review.options.map(option => option.additionalOutflowCents), [0, 8000]);
  const decision = assessPurchase(merged.workspace, { accountId: "plaid:cash", amountCents: 0, date: "2026-11-07" });
  assert.equal(decision.conservativeRoomCents, 65456);
  assert.equal(decision.favorableRoomCents, 73456);
  assert.match(merged.warnings.join(" "), /cautious spending-room estimate reserves/);
});

test("pending choices survive same identity and amount but reset when the amount changes", () => {
  const pending = normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 80, pending: true })] }));
  const prior = mergePlaidSnapshot(personal(), pending).workspace;
  prior.ambiguities[0].resolvedOptionId = "included";
  const same = mergePlaidSnapshot(prior, pending);
  assert.equal(same.workspace.ambiguities[0].resolvedOptionId, "included");
  const changed = mergePlaidSnapshot(same.workspace, normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 96, pending: true })] })));
  assert.equal(changed.workspace.ambiguities[0].resolvedOptionId, undefined);
  assert.equal(changed.workspace.ambiguities[0].amountCents, 9600);
  assert.equal(prior.ambiguities[0].amountCents, 8000);
});

test("a complete update retires vanished pending reservations and keeps manual review items", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 80, pending: true })] }))).workspace;
  prior.ambiguities.push({ ...prior.ambiguities[0], id: "manual-review", title: "User-created review" });
  const merged = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ transactions: [] })));
  assert.deepEqual(merged.workspace.ambiguities.map(item => item.id), ["manual-review"]);
});

test("incomplete or missing-account updates retain pending reservations until explicit replacement", () => {
  const prior = mergePlaidSnapshot(personal(), normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: 80, pending: true })] }))).workspace;
  const incomplete = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "hold", amount: null, pending: true })] })));
  assert.equal(incomplete.workspace.ambiguities[0].id, "plaid-pending:hold");
  const missing = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ accounts: [], transactions: [] })));
  assert.equal(missing.workspace.ambiguities[0].id, "plaid-pending:hold");
  const posted = mergePlaidSnapshot(prior, normalizePlaidSnapshot(sourceSnapshot({ transactions: [sourceTransaction({ transaction_id: "final", pending_transaction_id: "hold", amount: 96 }), sourceTransaction({ transaction_id: "bad", amount: null })] })));
  assert.equal(posted.workspace.ambiguities.length, 0);
});

test("pending incoming cash is not spendable forecast income and card holds do not invent checking repayments", () => {
  const normalized = normalizePlaidSnapshot(sourceSnapshot({ accounts: [sourceAccount(), sourceAccount({ account_id: "card", type: "credit", subtype: "credit card" })], transactions: [sourceTransaction({ transaction_id: "incoming", amount: -1000, pending: true }), sourceTransaction({ transaction_id: "card-hold", account_id: "card", amount: 250, pending: true })] }));
  const merged = mergePlaidSnapshot(personal(), normalized);
  assert.equal(merged.workspace.ambiguities.length, 0);
  assert.equal(merged.workspace.commitments.length, 0);
  assert.match(merged.warnings.join(" "), /Card balances and pending card purchases need dated repayment commitments/);
  const decision = assessPurchase(merged.workspace, { accountId: "plaid:cash", amountCents: 0, date: "2026-11-07" });
  assert.equal(decision.favorableRoomCents, 73456);
  assert.match(decision.warnings.join(" "), /not automatically mapped/);
});
