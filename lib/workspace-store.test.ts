import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { validateWorkspace } from "./workspace-store.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { createDemoWorkspace, createEmptyWorkspace } from "./finance.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { importTransactionsCsv } from "./csv.ts";

test("demo and empty personal backups round-trip through schema validation", () => {
  for (const workspace of [createDemoWorkspace(), createEmptyWorkspace()]) assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
});

test("restored source warnings remain renderable text lists", () => {
  const workspace = createDemoWorkspace();
  assert.throws(() => validateWorkspace({ ...workspace, sourceWarnings: "not a list" }));
  assert.throws(() => validateWorkspace({ ...workspace, sourceWarnings: [{ message: "invalid entry" }] }));
  const withWarnings = { ...workspace, sourceWarnings: ["A balance needs review."] };
  assert.deepEqual(validateWorkspace(withWarnings), withWarnings);
});

test("unknown schemas, invalid money and impossible dates cannot be restored", () => {
  const workspace = createDemoWorkspace();
  assert.throws(() => validateWorkspace({ ...workspace, schemaVersion: 2 }));
  assert.throws(() => validateWorkspace({ ...workspace, bufferCents: 0.1 }));
  assert.throws(() => validateWorkspace({ ...workspace, bufferCents: -100 }));
  assert.throws(() => validateWorkspace({ ...workspace, accounts: workspace.accounts.map((account, index) => index === 0 ? { ...account, balanceCents: Number.MAX_SAFE_INTEGER + 1 } : account) }));
  assert.throws(() => validateWorkspace({ ...workspace, transactions: workspace.transactions.map((transaction, index) => index === 0 ? { ...transaction, date: "2026-02-30" } : transaction) }));
});

test("duplicate account IDs and orphaned entries cannot be restored", () => {
  const workspace = createDemoWorkspace();
  assert.throws(() => validateWorkspace({ ...workspace, accounts: [...workspace.accounts, workspace.accounts[0]] }), /duplicate account/);
  assert.throws(() => validateWorkspace({ ...workspace, accounts: [] }), /without its account/);
});

test("negative commitment amounts, empty alternatives and invalid alternative exposure fail", () => {
  const workspace = createDemoWorkspace();
  assert.throws(() => validateWorkspace({ ...workspace, commitments: [{ ...workspace.commitments[0], amountCents: -100 }] }));
  assert.throws(() => validateWorkspace({ ...workspace, ambiguities: [{ ...workspace.ambiguities[0], options: [] }] }));
  assert.throws(() => validateWorkspace({ ...workspace, ambiguities: [{ ...workspace.ambiguities[0], options: [{ ...workspace.ambiguities[0].options[0], additionalOutflowCents: -100 }] }] }));
});

test("balance snapshot dates are validated before they reach the forecast engine", () => {
  const workspace = createDemoWorkspace();
  for (const lastUpdated of ["yesterday", "", "2026-02-30", "2026-11-07T25:00:00Z"]) {
    assert.throws(() => validateWorkspace({ ...workspace, accounts: workspace.accounts.map((account, index) => index === 0 ? { ...account, lastUpdated } : account) }), /Invalid balance snapshot date/);
  }
  assert.equal(validateWorkspace({ ...workspace, accounts: workspace.accounts.map(account => ({ ...account, lastUpdated: "2026-11-07T12:30:00.000Z" })) }).accounts[0].lastUpdated, "2026-11-07T12:30:00.000Z");
});

test("duplicate transaction, commitment and review identities cannot be restored", () => {
  const workspace = createDemoWorkspace();
  assert.throws(() => validateWorkspace({ ...workspace, transactions: [...workspace.transactions, workspace.transactions[0]] }), /duplicate record/);
  assert.throws(() => validateWorkspace({ ...workspace, commitments: [...workspace.commitments, workspace.commitments[0]] }), /duplicate record/);
  assert.throws(() => validateWorkspace({ ...workspace, ambiguities: [...workspace.ambiguities, workspace.ambiguities[0]] }), /duplicate record/);
});

test("review choices must be unique and the selected alternative must exist", () => {
  const workspace = createDemoWorkspace();
  const item = workspace.ambiguities[0];
  assert.throws(() => validateWorkspace({ ...workspace, ambiguities: [{ ...item, options: [item.options[0], item.options[0]] }] }), /duplicate option/);
  assert.throws(() => validateWorkspace({ ...workspace, ambiguities: [{ ...item, resolvedOptionId: "not-an-option" }] }), /invalid resolved alternative/);
});

test("long deterministic CSV identities remain valid when a workspace is exported and restored", () => {
  const merchant = "A".repeat(300);
  const result = importTransactionsCsv(createDemoWorkspace(), `date,description,amount\n2026-11-07,${merchant},-10`, "checking");
  assert.equal(result.added, 1);
  assert.ok(result.transactions[0].id.length > 200);
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(result.workspace))), result.workspace);
});
