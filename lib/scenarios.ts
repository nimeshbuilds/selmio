import type { Commitment, Workspace } from "./finance";

export type ScenarioPage = "Overview" | "Transactions" | "Your plan" | "Accounts" | "Settings";
export interface ScenarioAction {
  page?: ScenarioPage;
  modal?: "decision" | "review" | "import" | "account";
  purchase?: { amount: string; date: string; accountId: string };
  accountId?: string;
}
export interface ScenarioStep {
  title: string;
  instruction: string;
  check: string;
  actionLabel: string;
  action: ScenarioAction;
}
export interface BudgetScenario {
  id: string;
  title: string;
  summary: string;
  category: string;
  duration: string;
  lesson: string;
  workspace: Workspace;
  steps: ScenarioStep[];
  sampleCsv?: string;
}

const SNAPSHOT_DATE = "2026-11-07T09:00:00.000Z";

function sampleWorkspace(id: string, balanceCents: number, bufferCents: number): Workspace {
  return {
    schemaVersion: 1, mode: "demo", bufferCents,
    accounts: [{ id: `${id}-checking`, name: "Everyday checking", institution: "Sample Bank · fictional", type: "checking", balanceCents, lastUpdated: SNAPSHOT_DATE }],
    transactions: [], commitments: [], ambiguities: [],
  };
}

function commitment(workspace: Workspace, id: string, name: string, amountCents: number, dueDate: string, kind: Commitment["kind"] = "bill"): void {
  workspace.commitments.push({ id, name, amountCents, dueDate, kind, accountId: workspace.accounts[0].id, confirmed: true });
}

function purchase(accountId: string, amount: string, date: string): ScenarioAction {
  return { page: "Overview", modal: "decision", accountId, purchase: { amount, date, accountId } };
}

function weekendScenario(): BudgetScenario {
  const workspace = sampleWorkspace("weekend", 320000, 50000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "weekend-groceries", "Groceries & essentials", 25000, "2026-11-10");
  commitment(workspace, "weekend-utilities", "Utilities", 15000, "2026-11-16");
  commitment(workspace, "weekend-rent", "Next rent reserve", 120000, "2026-11-27", "goal");
  return {
    id: "weekend-purchase", title: "A weekend that fits", summary: "Try a $240 getaway while keeping bills and a $500 cushion in view.", category: "Everyday decisions", duration: "2 min",
    lesson: "A purchase can fit the listed plan while leaving room for bills and a chosen cash buffer. The result still depends on those inputs being complete.", workspace,
    steps: [
      { title: "Start with spending room", instruction: "Look at Estimated room to spend. The $3,200 bank snapshot also needs to cover three planned outflows and your $500 buffer.", check: "The initial spending-room estimate is $1,100 through November 30.", actionLabel: "See the starting plan", action: { page: "Overview", accountId } },
      { title: "Try the weekend", instruction: "Open the prefilled $240 purchase for November 8. Compare the lowest projected balance with the protected buffer.", check: "The result says there is room in this plan. The projected low is $1,360, above the $500 buffer.", actionLabel: "Try $240", action: purchase(accountId, "240", "2026-11-08") },
      { title: "Inspect what was protected", instruction: "In Your commitments, inspect Groceries & essentials, Utilities, and Next rent reserve. These are future plans; the opening balance already includes past activity.", check: "The three outflows total $1,600. The buffer stays separate from those payments.", actionLabel: "Inspect the commitments", action: { page: "Your plan", accountId } },
      { title: "Find the boundary", instruction: "Try $1,150 for the same date. This changes the proposed purchase without recording a real transaction.", check: "The projected low becomes $450, so this amount would dip into the $500 buffer.", actionLabel: "Compare $1,150", action: purchase(accountId, "1150", "2026-11-08") },
    ],
  };
}

function timingScenario(): BudgetScenario {
  const workspace = sampleWorkspace("timing", 180000, 30000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "timing-rent", "Rent", 120000, "2026-11-10");
  commitment(workspace, "timing-payday", "Expected payday", 200000, "2026-11-10", "income");
  commitment(workspace, "timing-essentials", "Weekly essentials", 20000, "2026-11-12");
  return {
    id: "timing-trap", title: "Payday is not here yet", summary: "See why a purchase can fail before rent, even when payday lifts the month-end balance.", category: "Cash timing", duration: "3 min",
    lesson: "Payment order matters. Selmio tests same-day outflows before income, so a positive end-of-day balance can hide a lower intraday balance.", workspace,
    steps: [
      { title: "Try buying before rent", instruction: "Test $600 on November 9. Rent and the expected payday are both listed for November 10.", check: "The proposed purchase leads to a $0 low before the expected deposit, below the $300 buffer.", actionLabel: "Try November 9", action: purchase(accountId, "600", "2026-11-09") },
      { title: "Inspect the two dated events", instruction: "Find Rent and Expected payday in Your commitments. They share a date; the plan does not assume the deposit clears first.", check: "Rent is $1,200 and expected income is $2,000 on November 10. Expected income is still a planning assumption.", actionLabel: "Compare rent and payday", action: { page: "Your plan", accountId } },
      { title: "Look below the closing balance", instruction: "Try November 10 instead. Inspect that date on the chart, using the orange intraday marker or the arrow keys after focusing the chart.", check: "The day ends at $2,000 after the purchase, but its intraday low is $0. The purchase still dips into the buffer.", actionLabel: "Inspect the same-day trap", action: purchase(accountId, "600", "2026-11-10") },
      { title: "Move the purchase later", instruction: "Try November 11, after the expected payday. The rent event is now evaluated before the proposed purchase.", check: "The result fits the supplied schedule. The forecast's overall low is $600, above the $300 buffer.", actionLabel: "Try November 11", action: purchase(accountId, "600", "2026-11-11") },
    ],
  };
}

function pendingScenario(): BudgetScenario {
  const workspace = sampleWorkspace("pending", 180000, 50000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "pending-essentials", "Remaining essentials", 60000, "2026-11-12");
  workspace.transactions = [
    { id: "pending-posted-jacket", accountId, date: "2026-11-05", merchant: "Willow Outfitters", category: "Shopping", amountCents: -20000, kind: "expense", status: "posted" },
    { id: "pending-jacket-hold", accountId, date: "2026-11-06", merchant: "Willow Outfitters · authorization", category: "Shopping", amountCents: -20000, kind: "expense", status: "pending" },
  ];
  workspace.ambiguities = [{
    id: "pending-jacket-question", title: "One jacket or two?", detail: "The posted $200 jacket is already reflected in the $1,800 opening balance. The pending $200 authorization might be that same purchase or a second purchase that has not yet reduced the balance.", amountCents: 20000, accountId, date: "2026-11-08",
    options: [
      { id: "duplicate", label: "Same purchase", detail: "The pending authorization belongs to the already posted jacket. There is no additional $200 outflow.", additionalOutflowCents: 0 },
      { id: "distinct", label: "Two purchases", detail: "A separate $200 purchase still needs to leave this account.", additionalOutflowCents: 20000 },
    ],
  }];
  return {
    id: "pending-or-duplicate", title: "One charge, two possible stories", summary: "Resolve a $200 pending charge, then reopen it and see the other outcome.", category: "Uncertainty", duration: "3 min",
    lesson: "An unresolved identity can change a purchase decision. Preserve both possible effects until you have evidence, and keep a way to revise a choice.", workspace,
    steps: [
      { title: "Keep both possibilities", instruction: "Try $600 on November 10. The forecast includes an extra $200 only in the cautious interpretation.", check: "The result is uncertain: spending room ranges from $500 to $700.", actionLabel: "See the two outcomes", action: purchase(accountId, "600", "2026-11-10") },
      { title: "Resolve the sample duplicate", instruction: "For this exercise, select Same purchase. That means the posted charge already covers the authorization; it does not add $200 to the bank balance.", check: "The review item moves under Previously reviewed, with Same purchase selected.", actionLabel: "Review the charge", action: { modal: "review", accountId } },
      { title: "Recheck the purchase", instruction: "Try the same $600 purchase with the duplicate interpretation selected.", check: "It now fits the supplied plan, with a $600 projected low and a $500 buffer.", actionLabel: "Recheck $600", action: purchase(accountId, "600", "2026-11-10") },
      { title: "Reopen the assumption", instruction: "Under Previously reviewed, choose Review again, then select Two purchases. This sample alternative reserves another $200.", check: "The selected outcome becomes Two purchases. You can revise an assumption without deleting the source history.", actionLabel: "Try the other interpretation", action: { modal: "review", accountId } },
      { title: "See why the answer changed", instruction: "Recheck $600 once more. The account snapshot has not changed; only the unresolved charge's additional effect changed.", check: "The projected low is now $400, so the purchase would dip into the $500 buffer.", actionLabel: "Compare the revised result", action: purchase(accountId, "600", "2026-11-10") },
    ],
  };
}

function paycheckScenario(): BudgetScenario {
  const workspace = sampleWorkspace("paycheck", 120000, 30000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "paycheck-salary", "Studio payday", 200000, "2026-11-10", "income");
  commitment(workspace, "paycheck-rent", "Rent", 150000, "2026-11-12");
  commitment(workspace, "paycheck-essentials", "Essentials", 20000, "2026-11-18");
  return {
    id: "late-paycheck", title: "When payday moves", summary: "Move an expected paycheck five days later and inspect the gap before rent.", category: "Income assumptions", duration: "3 min",
    lesson: "A confirmed date is still an assumption about the future. Changing it must change the dated cash forecast, rather than just the monthly income total.", workspace,
    steps: [
      { title: "Check the original schedule", instruction: "Try $400 on November 11 with Studio payday expected on November 10.", check: "The purchase fits these inputs. The projected low is $1,100 against a $300 buffer.", actionLabel: "Try the original payday", action: purchase(accountId, "400", "2026-11-11") },
      { title: "Move the sample payday", instruction: "Use Edit Studio payday in Your commitments. Change Date from November 10 to November 15, leave the $2,000 amount unchanged, and choose Save changes.", check: "Studio payday is now listed for November 15, after the November 12 rent payment.", actionLabel: "Edit the payday date", action: { page: "Your plan", accountId } },
      { title: "Inspect the funding gap", instruction: "Try the same $400 purchase. The later income has not arrived when rent leaves the account.", check: "The forecast reaches −$700 on November 12. Even the original plan now needs attention before rent.", actionLabel: "Recheck the delayed schedule", action: purchase(accountId, "400", "2026-11-11") },
      { title: "Keep the assumption visible", instruction: "Expand What this answer depends on. The expected-income warning remains even when its amount and date are marked confirmed.", check: "The calculation states that confirmed income is an expectation, not a guarantee. The changed date has not created any real deposit.", actionLabel: "Read the assumptions", action: purchase(accountId, "400", "2026-11-11") },
    ],
  };
}

function bufferScenario(): BudgetScenario {
  const workspace = sampleWorkspace("buffer", 250000, 30000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "buffer-rent", "Rent", 120000, "2026-11-15");
  commitment(workspace, "buffer-essentials", "Essentials", 30000, "2026-11-22");
  return {
    id: "emergency-buffer", title: "Choose your breathing room", summary: "Raise a protected buffer without changing the bank balance or planned bills.", category: "Cash cushion", duration: "2 min",
    lesson: "A buffer is a policy you choose, not a transaction. A larger protected cushion reduces discretionary room without moving money.", workspace,
    steps: [
      { title: "See the starting cushion", instruction: "Start with a $2,500 balance, $1,500 of planned outflows, and a $300 protected buffer.", check: "Estimated spending room is $700.", actionLabel: "See the baseline", action: { page: "Overview", accountId } },
      { title: "Try a $600 purchase", instruction: "Check $600 for November 10 with the original cushion.", check: "The projected low is $400. It stays above the current $300 buffer.", actionLabel: "Test the purchase", action: purchase(accountId, "600", "2026-11-10") },
      { title: "Protect more cash", instruction: "In A little cushion, change Your protected buffer from 300 to 700. This updates the sample policy immediately.", check: "Your bank snapshot remains $2,500. The revised spending-room estimate is $300.", actionLabel: "Change the protected buffer", action: { page: "Your plan", accountId } },
      { title: "Recheck the same amount", instruction: "Try $600 again. The purchase and bills are unchanged, but the amount of cash you want protected is larger.", check: "The $400 projected low now falls below the $700 buffer. A green result should not be a reason to weaken a real emergency cushion.", actionLabel: "Compare the larger cushion", action: purchase(accountId, "600", "2026-11-10") },
    ],
  };
}

function goalScenario(): BudgetScenario {
  const workspace = sampleWorkspace("goal", 260000, 50000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "goal-rent", "Rent", 100000, "2026-11-15");
  commitment(workspace, "goal-essentials", "Essentials", 30000, "2026-11-20");
  commitment(workspace, "goal-camera", "Camera fund", 80000, "2026-11-25", "goal");
  return {
    id: "savings-goal", title: "A goal, a purchase, a choice", summary: "Explore the cash tradeoff between a goal contribution and a $300 purchase.", category: "Goals", duration: "3 min",
    lesson: "Changing a planned goal contribution changes what remains available. It does not produce savings or execute a transfer; it changes a future allocation.", workspace,
    steps: [
      { title: "See the competing priority", instruction: "Find the $800 Camera fund goal in Your commitments. Rent, essentials and this contribution use the cash above the $500 buffer.", check: "The initial estimated spending room is $0.", actionLabel: "Inspect the goal", action: { page: "Your plan", accountId } },
      { title: "Try the extra purchase", instruction: "Test $300 on November 11 before changing the goal.", check: "The projected low is $200, below the $500 protected buffer.", actionLabel: "Try $300", action: purchase(accountId, "300", "2026-11-11") },
      { title: "Change the sample allocation", instruction: "Use Edit Camera fund. Change Amount from 800 to 400, keep Date November 25 and Type Goal contribution, then choose Save changes.", check: "The goal is now $400 and the spending-room estimate becomes $400. No bank money has moved.", actionLabel: "Edit the contribution", action: { page: "Your plan", accountId } },
      { title: "Compare the tradeoff", instruction: "Try the same $300 purchase with the smaller planned contribution. Consider whether slowing the goal would be worthwhile in a real decision.", check: "The projected low is now $600, above the $500 buffer. The $400 reduction in the goal made $400 of additional room.", actionLabel: "Recheck the new allocation", action: purchase(accountId, "300", "2026-11-11") },
    ],
  };
}

function cardScenario(): BudgetScenario {
  const workspace = sampleWorkspace("card", 400000, 50000);
  const accountId = workspace.accounts[0].id;
  const cardId = "card-credit";
  workspace.accounts.push({ id: cardId, name: "Everyday card", institution: "Sample Card · fictional", type: "credit", balanceCents: -180000, lastUpdated: SNAPSHOT_DATE });
  commitment(workspace, "card-rent", "Rent", 120000, "2026-11-12");
  commitment(workspace, "card-essentials", "Essentials", 30000, "2026-11-22");
  workspace.transactions = [
    { id: "card-old-purchase", accountId: cardId, date: "2026-11-03", merchant: "Bicycle shop", category: "Transport", amountCents: -60000, kind: "expense", status: "posted" },
    { id: "card-old-payment-out", accountId, date: "2026-11-05", merchant: "Previous card payment", category: "Transfer", amountCents: -40000, kind: "transfer", status: "posted" },
    { id: "card-old-payment-in", accountId: cardId, date: "2026-11-05", merchant: "Previous card payment", category: "Transfer", amountCents: 40000, kind: "transfer", status: "posted" },
  ];
  return {
    id: "credit-card-repayment", title: "The card still needs paying", summary: "Turn a card liability into a dated checking-account obligation.", category: "Credit cards", duration: "4 min",
    lesson: "A card balance is a liability, not spendable cash. Purchases count as spending; card payments move cash to settle debt and need a planned payment date.", workspace,
    steps: [
      { title: "Read the liability", instruction: "Inspect Everyday card in Accounts. Its −$1,800 balance means money owed; it is not an extra $1,800 available for purchases.", check: "Checking holds $4,000, the card shows −$1,800, and the combined balance is $2,200.", actionLabel: "Inspect cash and card", action: { page: "Accounts", accountId } },
      { title: "Notice a missing assumption", instruction: "Try $1,000 on November 10, then expand What this answer depends on. This sample starts without a future card repayment in its plan.", check: "The listed plan fits, but the warning says card balances need dated repayment commitments. That omission makes this result incomplete.", actionLabel: "See the incomplete plan", action: purchase(accountId, "1000", "2026-11-10") },
      { title: "Plan the repayment", instruction: "Choose Add to your plan. Name it Card statement payment, enter Amount 1800 and Date November 15, choose Type Bill or planned spending and Account Everyday checking, then Add to your plan.", check: "A $1,800 checking outflow now appears on November 15. This schedules cash; it does not change today's card balance.", actionLabel: "Add the missing payment", action: { page: "Your plan", accountId } },
      { title: "Recheck with the debt funded", instruction: "Try the same $1,000 purchase after adding the repayment.", check: "The projected low becomes −$300. Without the purchase, only $200 remains above the $500 buffer after the listed payments.", actionLabel: "Include the repayment", action: purchase(accountId, "1000", "2026-11-10") },
      { title: "Avoid counting payments twice", instruction: "Inspect the two Previous card payment rows. Both are transfers; the Bicycle shop row is the actual expense already included in the opening snapshots.", check: "Historical card payments are marked Transfer. Replaying them as new expenses would count spending twice.", actionLabel: "Inspect the transaction kinds", action: { page: "Transactions", accountId } },
    ],
  };
}

function csvScenario(): BudgetScenario {
  const workspace = sampleWorkspace("csv", 250000, 50000);
  const accountId = workspace.accounts[0].id;
  workspace.accounts[0].name = "Statement checking";
  commitment(workspace, "csv-rent", "Rent", 100000, "2026-11-15");
  const sampleCsv = "id,date,description,amount,category,kind,status\nscenario-coffee,2026-11-06,Coffee,-4.50,Dining,expense,posted\nscenario-market,2026-11-05,Neighborhood market,-62.35,Groceries,expense,posted\nscenario-payday,2026-11-04,Studio payday,2000.00,Income,income,posted\nscenario-transfer,2026-11-04,Transfer to savings,-300.00,Transfer,transfer,posted\n";
  return {
    id: "csv-import", title: "History is not new money", summary: "Import a sample statement twice without replaying it against today's balance.", category: "Import & reconcile", duration: "4 min",
    lesson: "CSV rows add historical context to an entered balance snapshot. Stable source IDs prevent a repeated import from appending the same transactions again.", workspace, sampleCsv,
    steps: [
      { title: "Anchor the account first", instruction: "Inspect Statement checking. Its $2,500 snapshot is dated November 7; the sample CSV contains earlier activity already reflected in that balance.", check: "The account starts at $2,500 with no transaction rows, and spending room is $1,000 after rent and the buffer.", actionLabel: "See the balance anchor", action: { page: "Accounts", accountId } },
      { title: "Import the scenario file", instruction: "Under Import into, choose Statement checking, then choose Use sample statement. You can also download the scenario CSV and select it with Choose your CSV statement.", check: "Four transactions are imported. The source IDs travel with the rows so the same file can be recognized again.", actionLabel: "Import the sample CSV", action: { page: "Transactions", modal: "import", accountId } },
      { title: "Read the history", instruction: "Inspect Coffee, Neighborhood market, Studio payday and Transfer to savings. The transfer is not an expense, and the earlier payday is not new future income.", check: "There are four sample rows. Posted expenses total $66.85; the account snapshot remains $2,500.", actionLabel: "Inspect imported rows", action: { page: "Transactions", accountId } },
      { title: "Re-import the same file", instruction: "Choose Use sample statement again for Statement checking, or select the exact same downloaded scenario CSV.", check: "The import reports 0 transactions imported and 4 duplicates skipped. The table still has four sample rows.", actionLabel: "Check duplicate protection", action: { page: "Transactions", modal: "import", accountId } },
      { title: "Recheck the forecast", instruction: "Return to Overview. Importing old records must not spend the same money again or add the old payday a second time.", check: "Estimated room to spend remains $1,000, because the snapshot and future rent commitment did not change.", actionLabel: "Compare the unchanged anchor", action: { page: "Overview", accountId } },
    ],
  };
}

function separateAccountsScenario(): BudgetScenario {
  const workspace = sampleWorkspace("separate", 90000, 50000);
  const accountId = workspace.accounts[0].id;
  const savingsId = "separate-savings";
  workspace.accounts.push({ id: savingsId, name: "Rainy day savings", institution: "Sample Bank · fictional", type: "savings", balanceCents: 500000, lastUpdated: SNAPSHOT_DATE });
  commitment(workspace, "separate-utilities", "Utilities", 25000, "2026-11-12");
  return {
    id: "separate-accounts", title: "Plenty saved, little in checking", summary: "See why $5,000 in savings does not silently pay a checking-account purchase.", category: "Account boundaries", duration: "2 min",
    lesson: "An account's dated cash path matters more than a household-wide total. Selecting a different forecast account does not transfer money between accounts.", workspace,
    steps: [
      { title: "Separate the balances", instruction: "Inspect Everyday checking and Rainy day savings. The accounts total $5,900, but checking must also cover $250 of utilities and its protected buffer.", check: "Checking is $900 and savings is $5,000. Checking has only $150 of spending room.", actionLabel: "Inspect both accounts", action: { page: "Accounts", accountId } },
      { title: "Try paying from checking", instruction: "Test a $400 purchase on November 10 from Everyday checking.", check: "The projected low is $250, below the $500 buffer. Savings is not silently added to checking.", actionLabel: "Test checking", action: purchase(accountId, "400", "2026-11-10") },
      { title: "Inspect the other account", instruction: "Test the same amount and date from Rainy day savings. This changes the account being assessed, not the account balances.", check: "Savings has a $4,600 projected low after the proposed purchase, above the $500 buffer under its listed commitments.", actionLabel: "Test savings separately", action: purchase(savingsId, "400", "2026-11-10") },
      { title: "Confirm no money moved", instruction: "Return to the checking purchase. Switching the forecast did not execute a payment or transfer; any real transfer would need separate planning and execution.", check: "Checking still has the same $250 projected low for this purchase and the result still dips into the buffer.", actionLabel: "Return to checking", action: purchase(accountId, "400", "2026-11-10") },
    ],
  };
}

function backupScenario(): BudgetScenario {
  const workspace = sampleWorkspace("backup", 280000, 50000);
  const accountId = workspace.accounts[0].id;
  commitment(workspace, "backup-rent", "Rent", 120000, "2026-11-14");
  commitment(workspace, "backup-travel", "Travel fund", 40000, "2026-11-25", "goal");
  return {
    id: "backup-restore", title: "Your data, your way back", summary: "Export a sample backup, make an edit, and restore the earlier version.", category: "Local ownership", duration: "3 min",
    lesson: "A local workspace needs a recoverable copy. An exported JSON backup contains financial data; keep real backups private and know that restore replaces the current workspace.", workspace,
    steps: [
      { title: "Keep a practice copy", instruction: "Choose Save practice copy to temporarily keep this fictional workspace in memory. Optionally choose Export under Export your workspace to download a real Selmio JSON file. The temporary practice copy is not a durable backup.", check: "The practice copy preserves the original $500 buffer and $700 spending-room estimate for this exercise. For real finances, export a file and keep it private.", actionLabel: "Save the starting practice copy", action: { page: "Settings", accountId } },
      { title: "Make a visible edit", instruction: "In A little cushion, change Your protected buffer from 500 to 900. The scenario's sample balance stays unchanged.", check: "The buffer becomes $900 and estimated spending room decreases from $700 to $300.", actionLabel: "Edit the sample buffer", action: { page: "Your plan", accountId } },
      { title: "Restore the earlier copy", instruction: "Choose Restore practice copy to return to the temporary sample snapshot. Alternatively, choose Restore under Restore a backup and select the scenario JSON file exported in step 1. Do not select a personal-finance backup for this exercise.", check: "The current exercise is replaced by its earlier version, including the original $500 buffer. Restoring the practice copy does not download or create a backup file.", actionLabel: "Restore the starting practice copy", action: { page: "Settings", accountId } },
      { title: "Verify the recovered state", instruction: "Check the forecast and buffer after restoring. The in-memory practice copy is temporary; real workspaces need exported private files for durable recovery.", check: "The account is $2,800, the buffer is $500, and estimated spending room is $700 again.", actionLabel: "Verify the restored plan", action: { page: "Overview", accountId } },
    ],
  };
}

/** Fictional, deterministic exercises. Treat these as fixtures, never live funds. */
export const BUDGET_SCENARIOS: BudgetScenario[] = [
  weekendScenario(), timingScenario(), pendingScenario(), paycheckScenario(), bufferScenario(),
  goalScenario(), cardScenario(), csvScenario(), separateAccountsScenario(), backupScenario(),
];

/** Return independent data so restarting a guided exercise restores its baseline. */
export function getScenario(id: string): BudgetScenario | undefined {
  const scenario = BUDGET_SCENARIOS.find(item => item.id === id);
  return scenario ? structuredClone(scenario) : undefined;
}
