import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { BUDGET_SCENARIOS, getScenario } from "./scenarios.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { assessPurchase, resolveAmbiguity, summarizeWorkspace } from "./finance.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { importTransactionsCsv } from "./csv.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { validateWorkspace } from "./workspace-store.ts";
import type { Workspace } from "./finance";
import type { BudgetScenario } from "./scenarios";

function scenario(id: string): BudgetScenario {
  const value = getScenario(id);
  assert.ok(value, `Missing scenario: ${id}`);
  return value;
}

function assess(workspace: Workspace, amountCents: number, date = "2026-11-10", accountId = workspace.accounts[0].id) {
  return assessPurchase(workspace, { amountCents, date, accountId });
}

test("ten distinct synthetic fixtures validate and every guided action targets a real account", () => {
  assert.equal(BUDGET_SCENARIOS.length, 10);
  assert.equal(new Set(BUDGET_SCENARIOS.map(item => item.id)).size, 10);
  const allAccountIds = new Set<string>();
  for (const item of BUDGET_SCENARIOS) {
    assert.deepEqual(validateWorkspace(item.workspace), item.workspace);
    assert.equal(item.workspace.mode, "demo");
    assert.ok(item.steps.length >= 3 && item.steps.length <= 5);
    for (const account of item.workspace.accounts) {
      assert.equal(account.lastUpdated.slice(0, 10), "2026-11-07");
      assert.equal(allAccountIds.has(account.id), false);
      allAccountIds.add(account.id);
    }
    for (const step of item.steps) {
      if (step.action.accountId) assert.ok(item.workspace.accounts.some(account => account.id === step.action.accountId));
      if (step.action.purchase) {
        const input = step.action.purchase;
        assert.match(input.amount, /^\d+(?:\.\d{1,2})?$/);
        assert.ok(input.date >= "2026-11-07" && input.date <= "2026-11-30");
        const account = item.workspace.accounts.find(account => account.id === input.accountId);
        assert.ok(account && account.type !== "credit");
      }
    }
  }
});

test("weekend purchase fits while a larger purchase crosses the protected boundary", () => {
  const workspace = scenario("weekend-purchase").workspace;
  assert.equal(summarizeWorkspace(workspace).spendingRoomCents, 110000);
  const weekend = assess(workspace, 24000, "2026-11-08");
  assert.equal(weekend.status, "fits");
  assert.equal(weekend.lowestConservativeCents, 136000);
  const larger = assess(workspace, 115000, "2026-11-08");
  assert.equal(larger.status, "exceeds");
  assert.equal(larger.lowestConservativeCents, 45000);
});

test("rent/payday timing exposes an intraday shortfall despite a positive closing balance", () => {
  const workspace = scenario("timing-trap").workspace;
  assert.equal(assess(workspace, 60000, "2026-11-09").status, "exceeds");
  const sameDay = assess(workspace, 60000, "2026-11-10");
  assert.equal(sameDay.status, "exceeds");
  const payday = sameDay.timeline.find(point => point.date === "2026-11-10");
  assert.equal(payday?.conservativeCents, 200000);
  assert.equal(payday?.dailyLowConservativeCents, 0);
  const later = assess(workspace, 60000, "2026-11-11");
  assert.equal(later.status, "fits");
  assert.equal(later.lowestConservativeCents, 60000);
});

test("pending identity changes only the additional exposure and can be reopened", () => {
  const workspace = scenario("pending-or-duplicate").workspace;
  const initial = assess(workspace, 60000);
  assert.equal(initial.status, "uncertain");
  assert.equal(initial.conservativeRoomCents, 50000);
  assert.equal(initial.favorableRoomCents, 70000);
  const question = workspace.ambiguities[0];
  const duplicate = resolveAmbiguity(workspace, question.id, "duplicate");
  assert.equal(assess(duplicate, 60000).status, "fits");
  assert.equal(assess(duplicate, 60000).lowestConservativeCents, 60000);
  const reopened = { ...duplicate, ambiguities: duplicate.ambiguities.map(item => ({ ...item, resolvedOptionId: undefined })) };
  assert.equal(assess(reopened, 60000).status, "uncertain");
  const distinct = resolveAmbiguity(reopened, question.id, "distinct");
  assert.equal(assess(distinct, 60000).status, "exceeds");
  assert.equal(assess(distinct, 60000).lowestConservativeCents, 40000);
  assert.equal(distinct.accounts[0].balanceCents, workspace.accounts[0].balanceCents);
});

test("moving the expected paycheck after rent creates a dated funding gap", () => {
  const workspace = scenario("late-paycheck").workspace;
  const original = assess(workspace, 40000, "2026-11-11");
  assert.equal(original.status, "fits");
  assert.equal(original.lowestConservativeCents, 110000);
  const delayed = { ...workspace, commitments: workspace.commitments.map(item => item.kind === "income" ? { ...item, dueDate: "2026-11-15" } : item) };
  const result = assess(delayed, 40000, "2026-11-11");
  assert.equal(result.status, "exceeds");
  assert.equal(result.lowestDate, "2026-11-12");
  assert.equal(result.lowestConservativeCents, -70000);
  assert.match(result.warnings.join(" "), /not a guarantee/);
});

test("a larger emergency cushion changes room without moving the account balance", () => {
  const workspace = scenario("emergency-buffer").workspace;
  assert.equal(summarizeWorkspace(workspace).spendingRoomCents, 70000);
  assert.equal(assess(workspace, 60000).status, "fits");
  const protectedMore = { ...workspace, bufferCents: 70000 };
  assert.equal(summarizeWorkspace(protectedMore).spendingRoomCents, 30000);
  assert.equal(assess(protectedMore, 60000).status, "exceeds");
  assert.equal(protectedMore.accounts[0].balanceCents, 250000);
});

test("editing a goal contribution reveals the exact cash tradeoff", () => {
  const workspace = scenario("savings-goal").workspace;
  assert.equal(summarizeWorkspace(workspace).spendingRoomCents, 0);
  assert.equal(assess(workspace, 30000, "2026-11-11").lowestConservativeCents, 20000);
  const changed = { ...workspace, commitments: workspace.commitments.map(item => item.kind === "goal" ? { ...item, amountCents: 40000 } : item) };
  assert.equal(summarizeWorkspace(changed).spendingRoomCents, 40000);
  const result = assess(changed, 30000, "2026-11-11");
  assert.equal(result.status, "fits");
  assert.equal(result.lowestConservativeCents, 60000);
});

test("a card liability needs an explicit checking payment and historical payments stay transfers", () => {
  const workspace = scenario("credit-card-repayment").workspace;
  const original = assess(workspace, 100000);
  assert.equal(original.status, "fits");
  assert.match(original.warnings.join(" "), /dated repayment commitments/);
  assert.equal(summarizeWorkspace(workspace).netBalanceCents, 220000);
  assert.equal(summarizeWorkspace(workspace).postedExpenseCents, 60000);
  const funded = { ...workspace, commitments: [...workspace.commitments, { id: "exercise-card-payment", name: "Card statement payment", amountCents: 180000, dueDate: "2026-11-15", accountId: workspace.accounts[0].id, kind: "bill" as const, confirmed: true }] };
  assert.equal(summarizeWorkspace(funded).spendingRoomCents, 20000);
  const result = assess(funded, 100000);
  assert.equal(result.status, "exceeds");
  assert.equal(result.lowestConservativeCents, -30000);
  assert.throws(() => assess(workspace, 10000, "2026-11-10", "card-credit"), /not available cash/);
});

test("scenario CSV imports once, replays idempotently and never reapplies history to its snapshot", () => {
  const item = scenario("csv-import");
  assert.ok(item.sampleCsv);
  const accountId = item.workspace.accounts[0].id;
  const first = importTransactionsCsv(item.workspace, item.sampleCsv, accountId);
  assert.deepEqual(first.errors, []);
  assert.equal(first.added, 4);
  assert.equal(summarizeWorkspace(first.workspace).postedExpenseCents, 6685);
  const second = importTransactionsCsv(first.workspace, item.sampleCsv, accountId);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 4);
  assert.equal(second.workspace.transactions.length, 4);
  assert.equal(second.workspace.accounts[0].balanceCents, 250000);
  assert.equal(summarizeWorkspace(second.workspace).spendingRoomCents, 100000);
  assert.deepEqual(validateWorkspace(second.workspace), second.workspace);
});

test("checking and savings decisions use separate cash paths", () => {
  const workspace = scenario("separate-accounts").workspace;
  assert.equal(summarizeWorkspace(workspace).netBalanceCents, 590000);
  assert.equal(summarizeWorkspace(workspace).spendingRoomCents, 15000);
  const checking = assess(workspace, 40000);
  assert.equal(checking.status, "exceeds");
  assert.equal(checking.lowestConservativeCents, 25000);
  const savings = assess(workspace, 40000, "2026-11-10", "separate-savings");
  assert.equal(savings.status, "fits");
  assert.equal(savings.lowestConservativeCents, 460000);
  assert.equal(assess(workspace, 40000).status, "exceeds");
});

test("a serialized backup restores the original financial state after a buffer edit", () => {
  const workspace = scenario("backup-restore").workspace;
  const backup = JSON.stringify(workspace);
  assert.equal(summarizeWorkspace(workspace).spendingRoomCents, 70000);
  const edited = { ...workspace, bufferCents: 90000 };
  assert.equal(summarizeWorkspace(edited).spendingRoomCents, 30000);
  const restored = validateWorkspace(JSON.parse(backup));
  assert.equal(restored.bufferCents, 50000);
  assert.equal(summarizeWorkspace(restored).spendingRoomCents, 70000);
  assert.deepEqual(restored, workspace);
});

test("scenario restarts return independent data and unknown IDs do not select another fixture", () => {
  const first = scenario("weekend-purchase");
  first.workspace.bufferCents = 999999;
  first.steps[0].action.accountId = "modified";
  const restarted = scenario("weekend-purchase");
  assert.equal(restarted.workspace.bufferCents, 50000);
  assert.equal(restarted.steps[0].action.accountId, "weekend-checking");
  assert.equal(getScenario("does-not-exist"), undefined);
});
