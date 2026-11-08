import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { importTransactionsCsv, parseAmountCents, parseCsvDate, parseTransactionsCsv } from "./csv.ts";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { createDemoWorkspace } from "./finance.ts";

test("quoted commas, double quotes, CRLF, BOM and embedded newlines parse correctly", () => {
  const parsed = parseTransactionsCsv('\uFEFFdate,description,amount,category\r\n2026-11-01,"Shop, Inc.","-1,234.56",Shopping\r\n11/2/2026,"A ""quoted""\nmerchant",-4.50,Food\r\n', "checking");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[0].merchant, "Shop, Inc.");
  assert.equal(parsed.transactions[0].amountCents, -123456);
  assert.equal(parsed.transactions[1].merchant, 'A "quoted"\nmerchant');
  assert.equal(parsed.transactions[1].date, "2026-11-02");
});

test("decimal amounts use exact integer cents", () => {
  assert.equal(parseAmountCents("0.29"), 29);
  assert.equal(parseAmountCents("$1,234.50"), 123450);
  assert.equal(parseAmountCents("($42.05)"), -4205);
  assert.equal(parseAmountCents("-0.01"), -1);
  assert.equal(parseAmountCents("USD 12"), 1200);
  for (const invalid of ["1.234", "12,34", "1e3", "NaN", "", "(-5)", "900719925474099.99"]) assert.throws(() => parseAmountCents(invalid));
});

test("dates validate actual calendar days rather than rolling into a later month", () => {
  assert.equal(parseCsvDate("2/29/2024"), "2024-02-29");
  for (const invalid of ["2026-02-29", "2026-11-31", "11/31/2026", "1/2/26", "03-04-2026"]) assert.throws(() => parseCsvDate(invalid));
});

test("imports are deterministic and replaying the same file does not duplicate transactions", () => {
  const workspace = createDemoWorkspace();
  const csv = "date,description,amount,category\n2026-11-07,Market,-20.15,Groceries\n2026-11-07,Coffee,-4.50,Food\n";
  const first = importTransactionsCsv(workspace, csv, "checking");
  const second = importTransactionsCsv(first.workspace, csv, "checking");
  assert.equal(first.added, 2);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 2);
  assert.equal(first.workspace.accounts[0].balanceCents, workspace.accounts[0].balanceCents);
  assert.deepEqual(first.workspace.transactions, second.workspace.transactions);
  assert.equal(workspace.transactions.length, 11);
});

test("identical legitimate purchases retain occurrence identity", () => {
  const workspace = createDemoWorkspace();
  const csv = "date,description,amount\n2026-11-07,Coffee,-4.50\n2026-11-07,Coffee,-4.50";
  const first = importTransactionsCsv(workspace, csv, "checking");
  assert.equal(first.added, 2);
  assert.notEqual(first.transactions[0].id, first.transactions[1].id);
  assert.equal(importTransactionsCsv(first.workspace, csv, "checking").skipped, 2);
  assert.match(first.warnings.join(" "), /Identical transaction rows/);
});

test("explicit IDs reconcile pending to posted while preserving user categorization", () => {
  const workspace = createDemoWorkspace();
  const pending = importTransactionsCsv(workspace, "id,date,description,amount,category,status\nabc,2026-11-07,Dinner,-80,Food,pending", "checking");
  const posted = importTransactionsCsv(pending.workspace, "id,date,description,amount,category,status\nabc,2026-11-08,Dinner with tip,-96,Other,posted", "checking");
  assert.equal(posted.added, 0);
  assert.equal(posted.updated, 1);
  const entry = posted.workspace.transactions.find(item => item.id === pending.transactions[0].id);
  assert.equal(entry?.status, "posted");
  assert.equal(entry?.amountCents, -9600);
  assert.equal(entry?.category, "Food");
});

test("card payments can be imported as transfers rather than expenses", () => {
  const parsed = parseTransactionsCsv("date,description,amount,kind\n2026-11-07,Card payment,-100,transfer\n2026-11-07,Salary,2000,income", "checking");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.transactions[0].kind, "transfer");
  assert.equal(parsed.transactions[1].kind, "income");
});

test("stable IDs accept a corrected posted amount and never regress to a stale pending version", () => {
  const original = importTransactionsCsv(createDemoWorkspace(), "id,date,description,amount,status\nabc,2026-11-07,Dinner,-80,posted", "checking");
  const correction = importTransactionsCsv(original.workspace, "id,date,description,amount,status\nabc,2026-11-08,Dinner,-96,posted", "checking");
  assert.equal(correction.updated, 1);
  const stale = importTransactionsCsv(correction.workspace, "id,date,description,amount,status\nabc,2026-11-07,Dinner,-80,pending", "checking");
  assert.equal(stale.updated, 0);
  assert.equal(stale.workspace.transactions.find(item => item.id === original.transactions[0].id)?.amountCents, -9600);
});

test("one bad row prevents the entire import and reports its actual line", () => {
  const workspace = createDemoWorkspace();
  const result = importTransactionsCsv(workspace, "date,description,amount\n2026-11-07,Good,-20\n2026-11-31,Bad,-10", "checking");
  assert.equal(result.added, 0);
  assert.equal(result.workspace, workspace);
  assert.equal(result.errors[0].row, 3);
  assert.match(result.errors[0].message, /real calendar date/);
});

test("malformed quotes, unknown accounts, missing headers and conflicting IDs produce errors", () => {
  assert.match(parseTransactionsCsv('date,description,amount\n2026-11-07,"bad,-20', "checking").errors[0].message, /closing/);
  assert.match(parseTransactionsCsv("description,amount\nHi,10", "checking").errors[0].message, /Required columns/);
  assert.match(importTransactionsCsv(createDemoWorkspace(), "date,description,amount\n2026-11-07,Hi,-10", "missing").errors[0].message, /no longer exists/);
  assert.match(parseTransactionsCsv("id,date,description,amount\nx,2026-11-07,One,-10\nx,2026-11-08,Two,-20", "checking").errors[0].message, /conflicting rows/);
});
