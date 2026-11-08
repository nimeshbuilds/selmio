/**
 * Deterministic, local budgeting model. Money is always integer USD cents.
 * Account balances are opening snapshots: transaction history is never reapplied.
 * Ambiguity alternatives describe ONLY additional exposure outside that snapshot.
 * Forecast results are conditional on the supplied balances and commitments.
 */
export const DEMO_DATE = "2026-11-07";
export const DEMO_HORIZON_END = "2026-11-30";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: "checking" | "savings" | "credit";
  balanceCents: number;
  lastUpdated: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  merchant: string;
  category: string;
  amountCents: number;
  kind: "expense" | "income" | "transfer";
  status: "posted" | "pending";
}

export interface Commitment {
  id: string;
  name: string;
  amountCents: number;
  dueDate: string;
  accountId: string;
  kind: "bill" | "income" | "goal";
  confirmed: boolean;
}

export interface AmbiguityOption {
  id: string;
  label: string;
  detail: string;
  additionalOutflowCents: number;
}

export interface Ambiguity {
  id: string;
  title: string;
  detail: string;
  amountCents: number;
  accountId: string;
  date: string;
  options: AmbiguityOption[];
  resolvedOptionId?: string;
}

export interface Workspace {
  schemaVersion: 1;
  mode: "demo" | "personal";
  accounts: Account[];
  transactions: Transaction[];
  commitments: Commitment[];
  ambiguities: Ambiguity[];
  bufferCents: number;
}

export interface PurchaseInput {
  amountCents: number;
  date: string;
  accountId: string;
  horizonEndDate?: string;
}

export interface ForecastEvent {
  id: string;
  name: string;
  kind: "bill" | "income" | "goal" | "ambiguity" | "purchase";
  conservativeDeltaCents: number;
  favorableDeltaCents: number;
  confirmed: boolean;
}

export interface TimelinePoint {
  date: string;
  conservativeCents: number;
  favorableCents: number;
  baselineConservativeCents: number;
  baselineFavorableCents: number;
  dailyLowConservativeCents: number;
  dailyLowFavorableCents: number;
  events: ForecastEvent[];
}

export interface PurchaseAssessment {
  status: "fits" | "uncertain" | "exceeds";
  accountId: string;
  startDate: string;
  endDate: string;
  bufferCents: number;
  conservativeRoomCents: number;
  favorableRoomCents: number;
  spendingRoomCents: number;
  lowestConservativeCents: number;
  lowestFavorableCents: number;
  lowestDate: string;
  timeline: TimelinePoint[];
  commitments: Commitment[];
  ambiguities: Ambiguity[];
  explanations: string[];
  warnings: string[];
}

export function assertCents(value: number, name = "Amount", nonnegative = false): void {
  if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) {
    throw new Error(`${name} must be ${nonnegative ? "nonnegative " : ""}integer cents within the supported range.`);
  }
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertDate(value: string, name: string): void {
  if (!isIsoDate(value)) throw new Error(`${name} must be a real date in YYYY-MM-DD format.`);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addCents(a: number, b: number): number {
  const total = a + b;
  assertCents(total, "Calculated balance");
  return total;
}

function accountDate(account: Account): string {
  const value = account.lastUpdated.slice(0, 10);
  assertDate(value, "Balance snapshot date");
  return value;
}

export function formatMoney(cents: number): string {
  assertCents(cents);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function createEmptyWorkspace(): Workspace {
  return { schemaVersion: 1, mode: "personal", accounts: [], transactions: [], commitments: [], ambiguities: [], bufferCents: 50000 };
}

export function createDemoWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    mode: "demo",
    accounts: [
      { id: "checking", name: "Everyday checking", institution: "Northstar Bank", type: "checking", balanceCents: 684200, lastUpdated: `${DEMO_DATE}T09:42:00` },
      { id: "savings", name: "Rainy day fund", institution: "Northstar Bank", type: "savings", balanceCents: 1245000, lastUpdated: `${DEMO_DATE}T09:42:00` },
      { id: "credit", name: "Everyday card", institution: "Northstar Card", type: "credit", balanceCents: -138450, lastUpdated: `${DEMO_DATE}T09:42:00` },
    ],
    transactions: [
      { id: "demo-01", accountId: "checking", date: "2026-11-06", merchant: "Whole Foods Market", category: "Groceries", amountCents: -8426, kind: "expense", status: "posted" },
      { id: "demo-02", accountId: "credit", date: "2026-11-06", merchant: "Blue Bottle Coffee", category: "Food & drink", amountCents: -650, kind: "expense", status: "posted" },
      { id: "demo-03", accountId: "checking", date: "2026-11-05", merchant: "Salary · Acme Studio", category: "Income", amountCents: 320000, kind: "income", status: "posted" },
      { id: "demo-04", accountId: "checking", date: "2026-11-05", merchant: "Transfer to rainy day fund", category: "Transfer", amountCents: -50000, kind: "transfer", status: "posted" },
      { id: "demo-05", accountId: "savings", date: "2026-11-05", merchant: "Transfer from checking", category: "Transfer", amountCents: 50000, kind: "transfer", status: "posted" },
      { id: "demo-06", accountId: "credit", date: "2026-11-04", merchant: "City transit", category: "Transport", amountCents: -3500, kind: "expense", status: "posted" },
      { id: "demo-07", accountId: "checking", date: "2026-11-04", merchant: "Everlane", category: "Shopping", amountCents: -12800, kind: "expense", status: "posted" },
      { id: "demo-08", accountId: "checking", date: "2026-11-03", merchant: "Everlane · authorization", category: "Shopping", amountCents: -12800, kind: "expense", status: "pending" },
      { id: "demo-09", accountId: "checking", date: "2026-11-03", merchant: "Spotify", category: "Subscriptions", amountCents: -1199, kind: "expense", status: "posted" },
      { id: "demo-10", accountId: "checking", date: "2026-11-02", merchant: "Greenline Energy", category: "Utilities", amountCents: -9734, kind: "expense", status: "posted" },
      { id: "demo-11", accountId: "checking", date: "2026-11-01", merchant: "Oak Street Apartments", category: "Housing", amountCents: -185000, kind: "expense", status: "posted" },
    ],
    commitments: [
      { id: "insurance", name: "Car insurance", amountCents: 16200, dueDate: "2026-11-09", accountId: "checking", kind: "bill", confirmed: true },
      { id: "card-payment", name: "Card statement payment", amountCents: 138450, dueDate: "2026-11-12", accountId: "checking", kind: "bill", confirmed: true },
      { id: "groceries", name: "Groceries & essentials", amountCents: 42000, dueDate: "2026-11-15", accountId: "checking", kind: "bill", confirmed: true },
      { id: "payday", name: "Expected salary", amountCents: 320000, dueDate: "2026-11-20", accountId: "checking", kind: "income", confirmed: true },
      { id: "internet", name: "Home internet", amountCents: 7500, dueDate: "2026-11-21", accountId: "checking", kind: "bill", confirmed: true },
      { id: "savings-goal", name: "Travel fund contribution", amountCents: 60000, dueDate: "2026-11-24", accountId: "checking", kind: "goal", confirmed: true },
      { id: "rent-reserve", name: "December rent reserve", amountCents: 185000, dueDate: "2026-11-28", accountId: "checking", kind: "goal", confirmed: true },
    ],
    ambiguities: [{
      id: "everlane-hold", title: "One purchase or two?", detail: "A $128 authorization and a posted Everlane charge may describe the same purchase. The posted charge is already in the opening balance; only a possible second charge is additional exposure.", amountCents: 12800, accountId: "checking", date: "2026-11-08",
      options: [
        { id: "duplicate", label: "Same purchase", detail: "The authorization is replaced by the posted charge. No additional cash leaves the account.", additionalOutflowCents: 0 },
        { id: "distinct", label: "Two purchases", detail: "The authorization is a separate purchase that may still settle for $128.", additionalOutflowCents: 12800 },
      ],
    }],
    bufferCents: 150000,
  };
}

export function resolveAmbiguity(workspace: Workspace, ambiguityId: string, optionId: string): Workspace {
  const ambiguity = workspace.ambiguities.find(item => item.id === ambiguityId);
  if (!ambiguity) throw new Error("That review item no longer exists.");
  if (!ambiguity.options.some(option => option.id === optionId)) throw new Error("Choose one of this review item's available options.");
  return { ...workspace, ambiguities: workspace.ambiguities.map(item => item.id === ambiguityId ? { ...item, resolvedOptionId: optionId } : item) };
}

export function assessPurchase(workspace: Workspace, input: PurchaseInput): PurchaseAssessment {
  assertCents(input.amountCents, "Purchase amount", true);
  assertCents(workspace.bufferCents, "Protected buffer", true);
  assertDate(input.date, "Purchase date");
  const account = workspace.accounts.find(item => item.id === input.accountId);
  if (!account) throw new Error("Choose an account before checking a purchase.");
  if (account.type === "credit") throw new Error("Choose a checking or savings account. Credit limits are not available cash.");
  assertCents(account.balanceCents, "Opening balance");
  const startDate = accountDate(account);
  if (input.date < startDate) throw new Error("The purchase date cannot precede the account's balance snapshot.");
  const defaultEnd = addDays(startDate, 23);
  const endDate = input.horizonEndDate ?? (defaultEnd > input.date ? defaultEnd : addDays(input.date, 7));
  assertDate(endDate, "Forecast end date");
  if (endDate < input.date || endDate < startDate) throw new Error("The forecast must include the purchase date and balance snapshot.");
  const duration = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
  if (duration > 366) throw new Error("Choose a forecast horizon of one year or less.");
  const warnings: string[] = [];
  const eventsByDate = new Map<string, ForecastEvent[]>();
  const append = (date: string, event: ForecastEvent) => eventsByDate.set(date, [...(eventsByDate.get(date) ?? []), event]);
  const commitments = workspace.commitments.filter(item => item.accountId === account.id && item.dueDate >= startDate && item.dueDate <= endDate);
  for (const item of commitments) {
    assertDate(item.dueDate, "Commitment date");
    assertCents(item.amountCents, "Commitment amount", true);
    if (item.kind === "income" && !item.confirmed) {
      warnings.push(`${item.name} is unconfirmed and is excluded from available spending room.`);
      continue;
    }
    const delta = item.kind === "income" ? item.amountCents : -item.amountCents;
    append(item.dueDate, { id: item.id, name: item.name, kind: item.kind, conservativeDeltaCents: delta, favorableDeltaCents: item.confirmed ? delta : 0, confirmed: item.confirmed });
  }
  const ambiguities = workspace.ambiguities.filter(item => item.accountId === account.id && item.date <= endDate);
  for (const item of ambiguities) {
    assertDate(item.date, "Review item date");
    if (item.options.length === 0) throw new Error("A review item must have at least one possible outcome.");
    for (const option of item.options) assertCents(option.additionalOutflowCents, "Additional exposure", true);
    const selected = item.resolvedOptionId ? item.options.find(option => option.id === item.resolvedOptionId) : undefined;
    if (item.resolvedOptionId && !selected) throw new Error("A review item's selected outcome is no longer available.");
    const amounts = selected ? [selected.additionalOutflowCents] : item.options.map(option => option.additionalOutflowCents);
    append(item.date < startDate ? startDate : item.date, { id: item.id, name: item.title, kind: "ambiguity", conservativeDeltaCents: -Math.max(...amounts), favorableDeltaCents: -Math.min(...amounts), confirmed: Boolean(selected) });
  }
  append(input.date, { id: "proposed-purchase", name: "Proposed purchase", kind: "purchase", conservativeDeltaCents: -input.amountCents, favorableDeltaCents: -input.amountCents, confirmed: false });
  let conservative = account.balanceCents;
  let favorable = account.balanceCents;
  let baselineConservative = account.balanceCents;
  let baselineFavorable = account.balanceCents;
  let lowestConservative = conservative;
  let lowestFavorable = favorable;
  let lowestDate = startDate;
  let baselineAfterPurchaseConservative = Number.POSITIVE_INFINITY;
  let baselineAfterPurchaseFavorable = Number.POSITIVE_INFINITY;
  const timeline: TimelinePoint[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    // Outflows precede same-day incomes, avoiding an optimistic intraday assumption.
    const events = (eventsByDate.get(date) ?? []).sort((a, b) => Number(a.kind === "income") - Number(b.kind === "income") || a.id.localeCompare(b.id));
    let dailyLowConservative = conservative;
    let dailyLowFavorable = favorable;
    if (date >= input.date) {
      baselineAfterPurchaseConservative = Math.min(baselineAfterPurchaseConservative, baselineConservative);
      baselineAfterPurchaseFavorable = Math.min(baselineAfterPurchaseFavorable, baselineFavorable);
    }
    for (const event of events) {
      conservative = addCents(conservative, event.conservativeDeltaCents);
      favorable = addCents(favorable, event.favorableDeltaCents);
      if (event.kind !== "purchase") {
        baselineConservative = addCents(baselineConservative, event.conservativeDeltaCents);
        baselineFavorable = addCents(baselineFavorable, event.favorableDeltaCents);
      }
      if (date >= input.date) {
        baselineAfterPurchaseConservative = Math.min(baselineAfterPurchaseConservative, baselineConservative);
        baselineAfterPurchaseFavorable = Math.min(baselineAfterPurchaseFavorable, baselineFavorable);
      }
      dailyLowConservative = Math.min(dailyLowConservative, conservative);
      dailyLowFavorable = Math.min(dailyLowFavorable, favorable);
      if (conservative < lowestConservative) { lowestConservative = conservative; lowestDate = date; }
      lowestFavorable = Math.min(lowestFavorable, favorable);
    }
    timeline.push({ date, conservativeCents: conservative, favorableCents: favorable, baselineConservativeCents: baselineConservative, baselineFavorableCents: baselineFavorable, dailyLowConservativeCents: dailyLowConservative, dailyLowFavorableCents: dailyLowFavorable, events });
  }
  const conservativeRoomCents = Math.max(0, baselineAfterPurchaseConservative - workspace.bufferCents);
  const favorableRoomCents = Math.max(0, baselineAfterPurchaseFavorable - workspace.bufferCents);
  const status = lowestConservative >= workspace.bufferCents ? "fits" : lowestFavorable >= workspace.bufferCents ? "uncertain" : "exceeds";
  if (commitments.some(item => item.kind === "income" && item.confirmed)) warnings.push("Confirmed income is an expectation you entered, not a guarantee. This forecast depends on it arriving on the listed date.");
  if (workspace.accounts.some(item => item.type === "credit")) warnings.push("Card balances and pending card purchases are not automatically mapped to a checking account or payment date. Add dated repayment commitments before relying on spending room.");
  warnings.push("Balances are entered snapshots. Imported transaction history does not update them; reconcile balances after importing.");
  warnings.push("The forecast only covers the listed accounts, commitments and review outcomes. Unexpected spending is not predicted.");
  const unresolved = ambiguities.filter(item => !item.resolvedOptionId);
  return {
    status, accountId: account.id, startDate, endDate, bufferCents: workspace.bufferCents,
    conservativeRoomCents, favorableRoomCents, spendingRoomCents: conservativeRoomCents,
    lowestConservativeCents: lowestConservative, lowestFavorableCents: lowestFavorable, lowestDate,
    timeline, commitments, ambiguities,
    explanations: [
      `Starts with ${formatMoney(account.balanceCents)} in ${account.name} as of ${startDate}.`,
      `Protects a ${formatMoney(workspace.bufferCents)} minimum balance through ${endDate}.`,
      `${commitments.filter(item => item.kind !== "income").length} planned outflows are included; moving money between accounts is not new spending.`,
      unresolved.length ? `${unresolved.length} unresolved review item${unresolved.length === 1 ? "" : "s"} explain the range between outcomes.` : "All listed review items have a selected outcome.",
      "Same-day outflows are evaluated before income. Savings and unused credit are not added to this account's spending room.",
    ],
    warnings,
  };
}

export interface WorkspaceSummary {
  asOfDate: string;
  horizonEndDate: string;
  checkingCents: number;
  savingsCents: number;
  creditBalanceCents: number;
  netBalanceCents: number;
  postedExpenseCents: number;
  pendingExpenseCents: number;
  incomeCents: number;
  unresolvedCount: number;
  upcomingBillCents: number;
  spendingRoomCents: number;
  conservativeRoomCents: number;
  favorableRoomCents: number;
  defaultAccountId: string | null;
}

export function summarizeWorkspace(workspace: Workspace): WorkspaceSummary {
  const account = workspace.accounts.find(item => item.type === "checking") ?? workspace.accounts.find(item => item.type === "savings");
  const asOfDate = account ? accountDate(account) : DEMO_DATE;
  const horizonEndDate = addDays(asOfDate, 23);
  const assessment = account ? assessPurchase(workspace, { accountId: account.id, amountCents: 0, date: asOfDate, horizonEndDate }) : undefined;
  const sum = (items: number[]) => items.reduce((total, amount) => addCents(total, amount), 0);
  return {
    asOfDate, horizonEndDate,
    checkingCents: sum(workspace.accounts.filter(item => item.type === "checking").map(item => item.balanceCents)),
    savingsCents: sum(workspace.accounts.filter(item => item.type === "savings").map(item => item.balanceCents)),
    creditBalanceCents: sum(workspace.accounts.filter(item => item.type === "credit").map(item => item.balanceCents)),
    netBalanceCents: sum(workspace.accounts.map(item => item.balanceCents)),
    postedExpenseCents: -sum(workspace.transactions.filter(item => item.kind === "expense" && item.status === "posted").map(item => item.amountCents)),
    pendingExpenseCents: -sum(workspace.transactions.filter(item => item.kind === "expense" && item.status === "pending").map(item => item.amountCents)),
    incomeCents: sum(workspace.transactions.filter(item => item.kind === "income" && item.status === "posted").map(item => item.amountCents)),
    unresolvedCount: workspace.ambiguities.filter(item => !item.resolvedOptionId).length,
    upcomingBillCents: sum(workspace.commitments.filter(item => item.kind === "bill" && item.dueDate >= asOfDate && item.dueDate <= horizonEndDate).map(item => item.amountCents)),
    spendingRoomCents: assessment?.conservativeRoomCents ?? 0,
    conservativeRoomCents: assessment?.conservativeRoomCents ?? 0,
    favorableRoomCents: assessment?.favorableRoomCents ?? 0,
    defaultAccountId: account?.id ?? null,
  };
}
