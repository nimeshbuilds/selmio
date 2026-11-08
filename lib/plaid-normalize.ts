import type { Account, Ambiguity, Transaction, Workspace } from "./finance";

export interface PlaidTransaction extends Transaction {
  /** Stable source identity supplied by Plaid, never inferred from amount alone. */
  pendingTransactionId?: string;
}

export interface NormalizedPlaidSnapshot {
  accounts: Account[];
  transactions: PlaidTransaction[];
  environment: "sandbox" | "production";
  /** Empty means that no successful synchronization has been reported yet. */
  lastSyncedAt: string;
  warnings: string[];
  syncError?: string;
  /** Internal safety metadata: rejected source rows must not erase old history. */
  incompleteAccountIds?: string[];
}

export interface PlaidMergeResult { workspace: Workspace; warnings: string[] }
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function label(value: unknown, maximum = 200): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : "";
}

function sourceId(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 && !/[\s\u0000-\u001f\u007f]/.test(value) ? value : "";
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return "";
  if (!isoDate(value.slice(0, 10))) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  // Permit IEEE-754 representation noise, not genuine fractional USD cents.
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) return null;
  return rounded === 0 ? 0 : rounded;
}

function usd(value: JsonRecord): boolean {
  return value.iso_currency_code === "USD" && (value.unofficial_currency_code == null || value.unofficial_currency_code === "");
}

function categoryLabel(value: string): string {
  return value.toLowerCase().split(/[_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(" ").slice(0, 170);
}

function classification(raw: JsonRecord, amountCents: number): Pick<Transaction, "kind" | "category"> {
  const pfc = record(raw.personal_finance_category);
  const primary = label(pfc.primary);
  const detailed = label(pfc.detailed);
  const cardPayment = primary === "LOAN_PAYMENTS" && detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
  const accountTransfer = (primary === "TRANSFER_IN" && detailed === "TRANSFER_IN_ACCOUNT_TRANSFER") || (primary === "TRANSFER_OUT" && detailed === "TRANSFER_OUT_ACCOUNT_TRANSFER");
  if (cardPayment || accountTransfer) return { kind: "transfer", category: cardPayment ? "Card payment" : "Transfer" };
  if (primary === "INCOME" && amountCents > 0) return { kind: "income", category: categoryLabel(detailed || primary) || "Income" };
  const legacy = Array.isArray(raw.category) ? raw.category.filter((entry): entry is string => typeof entry === "string").at(-1) : undefined;
  const category = categoryLabel(detailed || primary) || label(legacy) || "Uncategorized";
  // A positive account credit can be a refund, reimbursement or loan. It is not
  // earned income merely because the sign is positive. Positive expenses net
  // against spending until the user supplies a more precise classification.
  return { kind: "expense", category: amountCents > 0 ? `Credit / refund · ${category}`.slice(0, 200) : category };
}

/** Convert the connector's selected raw fields; never turn unknown balances into zero. */
export function normalizePlaidSnapshot(value: unknown): NormalizedPlaidSnapshot {
  const raw = record(value);
  if (raw.snapshot !== true || !Array.isArray(raw.items) || !Array.isArray(raw.accounts) || !Array.isArray(raw.transactions)) throw new Error("The connector did not return a complete bank snapshot. Existing data has been kept.");
  if (raw.environment !== "sandbox" && raw.environment !== "production") throw new Error("The connector returned an unsupported Plaid environment. Existing data has been kept.");
  const environment = raw.environment;
  const warnings = new Set<string>();
  const itemById = new Map<string, { institution: string; lastSyncedAt: string }>();
  for (const value of raw.items) {
    const item = record(value);
    const id = sourceId(item.id);
    if (!id || (item.environment !== undefined && item.environment !== environment)) { warnings.add("An institution with invalid connection metadata was skipped. Its existing local data is kept."); continue; }
    if (itemById.has(id)) throw new Error("The bank snapshot contains duplicate institution IDs. Retry synchronization; existing data has been kept.");
    itemById.set(id, { institution: label(item.institutionName) || "Connected institution", lastSyncedAt: timestamp(item.lastSyncedAt) });
  }
  const lastSyncedAt = timestamp(raw.lastSyncedAt) || [...itemById.values()].map(item => item.lastSyncedAt).filter(Boolean).sort().at(-1) || "";
  if (!lastSyncedAt) warnings.add("No successful bank synchronization has been reported yet. Retry sync when initial transaction history is ready.");
  if (environment === "sandbox") warnings.add("Plaid Sandbox contains simulated accounts and transactions. These are not real bank funds.");
  const accounts: Account[] = [];
  const accountBySourceId = new Map<string, Account>();
  const seenAccounts = new Set<string>();
  for (const value of raw.accounts) {
    const account = record(value);
    const id = sourceId(account.account_id);
    const name = label(account.name) || label(account.official_name) || "Unnamed account";
    if (!id) { warnings.add(`${name}: missing or invalid account ID; skipped.`); continue; }
    if (seenAccounts.has(id)) throw new Error("The bank snapshot contains duplicate account IDs. Retry synchronization; existing data has been kept.");
    seenAccounts.add(id);
    const item = itemById.get(sourceId(account.item_id));
    if (!item) { warnings.add(`${name}: its institution metadata is missing; skipped.`); continue; }
    const subtype = label(account.subtype).toLowerCase();
    let type: Account["type"];
    if (account.type === "depository" && (subtype === "checking" || subtype === "cash management")) type = "checking";
    else if (account.type === "depository" && subtype === "savings") type = "savings";
    else if (account.type === "credit" && subtype === "credit card") type = "credit";
    else { warnings.add(`${name}: this account type is not supported. Only USD checking, savings, cash management and credit cards are imported.`); continue; }
    const balance = record(account.balances);
    if (!usd(balance)) { warnings.add(`${name}: its balance is not explicitly denominated in USD; skipped.`); continue; }
    const current = cents(balance.current);
    if (current === null) { warnings.add(`${name}: its current balance is missing or invalid; skipped rather than assumed to be zero.`); continue; }
    if (!item.lastSyncedAt) { warnings.add(`${name}: no successful institution sync time is available; skipped rather than assigned a false freshness date.`); continue; }
    const normalized: Account = { id: `plaid:${id}`, name, institution: item.institution, type, balanceCents: type === "credit" && current !== 0 ? -current : current, lastUpdated: item.lastSyncedAt };
    accounts.push(normalized);
    accountBySourceId.set(id, normalized);
  }
  const transactions: PlaidTransaction[] = [];
  const seenTransactions = new Set<string>();
  const incompleteAccounts = new Set<string>();
  for (const value of raw.transactions) {
    const transaction = record(value);
    const rawAccountId = sourceId(transaction.account_id);
    const account = accountBySourceId.get(rawAccountId);
    if (!account) { warnings.add("Transactions for an unsupported or unavailable account were skipped. Previously saved history for missing accounts is retained."); continue; }
    const id = sourceId(transaction.transaction_id);
    if (!id) { incompleteAccounts.add(account.id); warnings.add(`${account.name}: a transaction with a missing or invalid source ID was skipped. Its previously saved history is retained for review.`); continue; }
    if (seenTransactions.has(id)) throw new Error("The bank snapshot contains duplicate transaction IDs. Retry synchronization; existing data has been kept.");
    seenTransactions.add(id);
    const sourceAmount = cents(transaction.amount);
    if (sourceAmount === null || !isoDate(transaction.date) || typeof transaction.pending !== "boolean" || !usd(transaction)) {
      incompleteAccounts.add(account.id);
      warnings.add(`${account.name}: a transaction with an invalid amount, date, status or USD currency was skipped. Review this account before relying on totals.`);
      continue;
    }
    const amountCents = sourceAmount === 0 ? 0 : -sourceAmount;
    const predecessorId = sourceId(transaction.pending_transaction_id);
    const normalized: PlaidTransaction = {
      id: `plaid:${id}`, accountId: account.id, date: transaction.date,
      merchant: label(transaction.merchant_name, 500) || label(transaction.name, 500) || "Unnamed transaction",
      amountCents, ...classification(transaction, amountCents), status: transaction.pending ? "pending" : "posted",
      ...(predecessorId && predecessorId !== id ? { pendingTransactionId: `plaid:${predecessorId}` } : {}),
    };
    transactions.push(normalized);
  }
  if (accounts.length) warnings.add("Bank balances are cached source snapshots, not guaranteed real-time funds. Recheck upcoming commitments and pending activity after every refresh.");
  if (accounts.some(account => account.type === "credit")) warnings.add("Card balances and pending card purchases need dated repayment commitments before relying on spending room.");
  if (transactions.some(transaction => transaction.amountCents > 0 && transaction.kind === "expense")) warnings.add("Some account credits are not explicitly classified as income. They are labeled Credit / refund for your review instead of being assumed to be earned income.");
  const syncError = label(raw.syncError, 1000);
  if (syncError) warnings.add(syncError);
  return { accounts, transactions, environment, lastSyncedAt, warnings: [...warnings], ...(syncError ? { syncError } : {}), ...(incompleteAccounts.size ? { incompleteAccountIds: [...incompleteAccounts] } : {}) };
}

/**
 * A snapshot replaces source transactions only for accounts it successfully
 * normalized. Missing/disconnected accounts remain visible with their old date.
 * Existing user classifications survive stable IDs and explicit pending links.
 */
export function mergePlaidSnapshot(workspace: Workspace, snapshot: NormalizedPlaidSnapshot): PlaidMergeResult {
  const current: Workspace = workspace.mode === "demo" ? { schemaVersion: 1, mode: "personal", accounts: [], transactions: [], commitments: [], ambiguities: [], bufferCents: 50000 } : workspace;
  const warnings = [...snapshot.warnings];
  const incomingAccountIds = new Set(snapshot.accounts.map(account => account.id));
  const missing = current.accounts.filter(account => account.id.startsWith("plaid:") && !incomingAccountIds.has(account.id));
  if (missing.length) warnings.push(`${missing.map(account => account.name).join(", ")}: absent or unsupported in this snapshot. Its last saved balance, history and commitments are retained and may be stale. Reconcile or explicitly delete it when appropriate.`);
  const previousById = new Map(current.transactions.map(transaction => [transaction.id, transaction]));
  const incompleteAccountIds = new Set(snapshot.incompleteAccountIds ?? []);
  const replacedIds = new Set(snapshot.transactions.flatMap(transaction => [transaction.id, ...(transaction.pendingTransactionId ? [transaction.pendingTransactionId] : [])]));
  if (incompleteAccountIds.size) warnings.push("Some source rows could not be normalized. Previous history for the affected accounts was retained instead of treating rejected rows as deleted transactions. Reconcile those accounts before relying on totals.");
  const incomingTransactions = snapshot.transactions.map(transaction => {
    const previous = previousById.get(transaction.id) ?? (transaction.pendingTransactionId ? previousById.get(transaction.pendingTransactionId) : undefined);
    if (!previous || previous.accountId !== transaction.accountId) return { ...transaction };
    return { ...previous, ...transaction, category: previous.category, kind: previous.kind };
  });
  const pendingPrefix = "plaid-pending:";
  const accountById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const previousAmbiguities = new Map(current.ambiguities.map(item => [item.id, item]));
  const generatedAmbiguities: Ambiguity[] = incomingTransactions.flatMap(transaction => {
    const account = accountById.get(transaction.accountId);
    if (!account || account.type === "credit" || transaction.status !== "pending" || transaction.amountCents >= 0) return [];
    // Current/available semantics differ between sources. Preserve both readings
    // explicitly rather than assuming a hold is already included or subtracting
    // the entire imported transaction history from the opening snapshot.
    const id = `${pendingPrefix}${transaction.id.slice("plaid:".length)}`;
    const amountCents = -transaction.amountCents;
    const previous = previousAmbiguities.get(id);
    const sameExposure = previous?.accountId === account.id && previous.amountCents === amountCents;
    const resolvedOptionId = sameExposure && (previous.resolvedOptionId === "included" || previous.resolvedOptionId === "additional") ? previous.resolvedOptionId : undefined;
    return [{
      id, title: `Pending · ${transaction.merchant}`.slice(0, 500),
      detail: "This pending cash outflow may or may not already be reflected in your bank's opening balance. The cautious outcome reserves its full amount. Verify the balance before selecting an outcome; the settled amount may change.",
      amountCents, accountId: account.id, date: account.lastUpdated.slice(0, 10),
      options: [
        { id: "included", label: "Already reflected in balance", detail: "The bank balance already accounts for this pending outflow. Do not reserve it a second time.", additionalOutflowCents: 0 },
        { id: "additional", label: "Still needs to leave this account", detail: "The opening balance does not yet include this pending outflow. Reserve its full current amount.", additionalOutflowCents: amountCents },
      ],
      ...(resolvedOptionId ? { resolvedOptionId } : {}),
    }];
  });
  const generatedIds = new Set(generatedAmbiguities.map(item => item.id));
  const retainedAmbiguities = current.ambiguities.filter(item => {
    if (!item.id.startsWith(pendingPrefix) || !incomingAccountIds.has(item.accountId)) return true;
    if (generatedIds.has(item.id)) return false;
    const transactionId = `plaid:${item.id.slice(pendingPrefix.length)}`;
    // An incomplete source update cannot prove an old pending record vanished.
    // Explicit stable/pending replacement identities can still retire it safely.
    return incompleteAccountIds.has(item.accountId) && !replacedIds.has(transactionId);
  });
  if (generatedAmbiguities.length) warnings.push("Pending cash outflows have been added to review. The cautious spending-room estimate reserves them until you verify whether the opening balance already reflects them.");
  if (current.accounts.some(account => account.type === "credit") || snapshot.accounts.some(account => account.type === "credit")) warnings.push("Card balances and pending card purchases need dated repayment commitments before relying on spending room.");
  return {
    workspace: {
      ...current, mode: "personal",
      accounts: [...current.accounts.filter(account => !incomingAccountIds.has(account.id)), ...snapshot.accounts.map(account => ({ ...account }))],
      transactions: [...current.transactions.filter(transaction => !transaction.id.startsWith("plaid:") || !incomingAccountIds.has(transaction.accountId) || (incompleteAccountIds.has(transaction.accountId) && !replacedIds.has(transaction.id))), ...incomingTransactions],
      ambiguities: [...retainedAmbiguities, ...generatedAmbiguities],
    },
    warnings: [...new Set(warnings)],
  };
}
