import type { Transaction, Workspace } from "./finance";

export interface CsvIssue { row: number; message: string }
export interface CsvParseResult { transactions: Transaction[]; errors: CsvIssue[]; warnings: string[] }
export interface CsvImportResult extends CsvParseResult { workspace: Workspace; added: number; skipped: number; updated: number }

/** CSV supports quoted commas, escaped quotes, embedded newlines and CRLF. */
function readRows(text: string): { rows: { line: number; cells: string[] }[]; errors: CsvIssue[] } {
  const rows: { line: number; cells: string[] }[] = [];
  const errors: CsvIssue[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => { cells.push(field.trim()); field = ""; afterQuote = false; };
  const endRow = () => { endField(); if (cells.some(Boolean)) rows.push({ line: rowLine, cells }); cells = []; };
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else {
        if (char === "\r" && source[i + 1] === "\n") { field += "\n"; i++; line++; }
        else { field += char; if (char === "\n" || char === "\r") line++; }
      }
    } else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      endRow(); line++; rowLine = line;
    } else if (char === '"') {
      if (field.trim() || afterQuote) errors.push({ row: line, message: "Unexpected quote. Put the entire field inside double quotes." });
      else { field = ""; quoted = true; }
    } else if (afterQuote) {
      if (!/\s/.test(char)) errors.push({ row: line, message: "Unexpected text after a closing quote." });
    } else field += char;
  }
  if (quoted) errors.push({ row: rowLine, message: "A quoted field is missing its closing double quote." });
  else if (field || cells.length) endRow();
  return { rows, errors };
}

export function parseAmountCents(value: string): number {
  let text = value.trim().replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  const parentheses = /^\(.*\)$/.test(text);
  if (parentheses) text = text.slice(1, -1).trim();
  text = text.replace(/^([+-]?)\$\s*/, "$1");
  if (parentheses && /^[+-]/.test(text)) throw new Error("Use either parentheses or a minus sign, not both.");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('Amount must be a number with at most two decimal places, such as "-42.50".');
  }
  const negative = parentheses || text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "").replace(/,/g, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is outside the supported range.");
  return cents === 0 ? 0 : negative ? -cents : cents;
}

export function parseCsvDate(value: string): string {
  let text = value.trim();
  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (usDate) text = `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Date must use YYYY-MM-DD or MM/DD/YYYY.");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("Date is not a real calendar date.");
  return text;
}

// A reversible composite key avoids hash collisions. Occurrence suffixes preserve
// two truly identical purchases within one export instead of collapsing them.
function fingerprint(parts: string[]): string { return parts.map(part => `${part.length}:${part}`).join("|"); }

export function parseTransactionsCsv(text: string, accountId: string): CsvParseResult {
  if (!accountId.trim()) return { transactions: [], errors: [{ row: 1, message: "Select an account before importing." }], warnings: [] };
  if (text.length > 5_000_000) return { transactions: [], errors: [{ row: 1, message: "CSV must be smaller than 5 MB. Import a shorter date range." }], warnings: [] };
  const { rows, errors } = readRows(text);
  const result: CsvParseResult = { transactions: [], errors, warnings: [] };
  if (errors.length) return result;
  if (!rows.length) { errors.push({ row: 1, message: "This file is empty. Add a header row and at least one transaction." }); return result; }
  const headers = rows[0].cells.map(cell => cell.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim());
  if (new Set(headers).size !== headers.length) errors.push({ row: rows[0].line, message: "Column names must be unique." });
  const column = (names: string[]) => headers.findIndex(header => names.includes(header));
  const dateIndex = column(["date", "transaction date", "posted date"]);
  const descriptionIndex = column(["description", "merchant", "payee", "name"]);
  const amountIndex = column(["amount", "transaction amount"]);
  const categoryIndex = column(["category"]);
  const kindIndex = column(["kind", "type", "transaction type"]);
  const statusIndex = column(["status"]);
  const idIndex = column(["id", "transaction id", "source id", "fitid"]);
  if (dateIndex < 0 || descriptionIndex < 0 || amountIndex < 0) errors.push({ row: rows[0].line, message: "Required columns: date, description (or merchant), amount. Optional: category, kind, status, id." });
  if (errors.length) return result;
  if (rows.length === 1) { errors.push({ row: rows[0].line + 1, message: "No transactions were found below the header row." }); return result; }
  const occurrences = new Map<string, number>();
  const explicitIds = new Map<string, string>();
  let repeatedRows = false;
  for (const row of rows.slice(1)) {
    if (row.cells.length !== headers.length) { errors.push({ row: row.line, message: `Expected ${headers.length} columns but found ${row.cells.length}. Quote descriptions or amounts containing commas.` }); continue; }
    try {
      const date = parseCsvDate(row.cells[dateIndex]);
      const merchant = row.cells[descriptionIndex].trim();
      if (!merchant) throw new Error("Description cannot be empty.");
      const amountCents = parseAmountCents(row.cells[amountIndex]);
      const category = categoryIndex >= 0 && row.cells[categoryIndex] ? row.cells[categoryIndex] : "Uncategorized";
      const rawKind = kindIndex >= 0 ? row.cells[kindIndex].toLowerCase() : "";
      let kind: Transaction["kind"];
      if (rawKind && !["expense", "income", "transfer"].includes(rawKind)) throw new Error("Kind must be expense, income or transfer. Leave it blank to infer it from amount.");
      if (rawKind) kind = rawKind as Transaction["kind"];
      else kind = /^(?:transfer|credit card payment)$/i.test(category) ? "transfer" : amountCents > 0 ? "income" : "expense";
      const rawStatus = statusIndex >= 0 ? row.cells[statusIndex].toLowerCase() : "";
      if (rawStatus && !["posted", "pending"].includes(rawStatus)) throw new Error("Status must be posted or pending. Leave it blank for posted.");
      const status: Transaction["status"] = rawStatus === "pending" ? "pending" : "posted";
      const base = fingerprint([accountId, date, merchant.toLowerCase(), String(amountCents)]);
      const sourceId = idIndex >= 0 ? row.cells[idIndex] : "";
      let id: string;
      if (sourceId) {
        id = `csv:id:${fingerprint([accountId, sourceId])}`;
        const previous = explicitIds.get(id);
        if (previous && previous !== base) throw new Error(`Transaction ID "${sourceId}" is reused for conflicting rows.`);
        explicitIds.set(id, base);
      } else {
        const occurrence = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, occurrence);
        if (occurrence > 1) repeatedRows = true;
        id = `csv:row:${base}:${occurrence}`;
      }
      result.transactions.push({ id, accountId, date, merchant, category, amountCents, kind, status });
    } catch (error) {
      errors.push({ row: row.line, message: error instanceof Error ? error.message : "Invalid transaction." });
    }
  }
  if (idIndex < 0) result.warnings.push("No transaction IDs supplied. Matching uses account, date, description, amount and repeated-row occurrence. Overlapping exports with identical purchases need review.");
  if (repeatedRows) result.warnings.push("Identical transaction rows were kept as separate occurrences. Check whether these are separate purchases or duplicate export rows.");
  result.warnings.push("Positive amounts are income and negative amounts are expenses unless kind is supplied. Use kind=transfer for card payments and movements between your accounts.");
  return result;
}

/** Atomic import: fix every error before importing any rows. Balances stay snapshots. */
export function importTransactionsCsv(workspace: Workspace, text: string, accountId: string): CsvImportResult {
  const parsed = parseTransactionsCsv(text, accountId);
  if (!workspace.accounts.some(account => account.id === accountId)) parsed.errors.unshift({ row: 1, message: "The selected account no longer exists." });
  if (parsed.errors.length) return { ...parsed, workspace, added: 0, skipped: 0, updated: 0 };
  const nextTransactions = [...workspace.transactions];
  const indexById = new Map(nextTransactions.map((item, index) => [item.id, index]));
  let added = 0;
  let skipped = 0;
  let updated = 0;
  for (const transaction of parsed.transactions) {
    const existingIndex = indexById.get(transaction.id);
    if (existingIndex !== undefined) {
      const existing = nextTransactions[existingIndex];
      // Stable bank IDs allow final amounts/dates to correct earlier observations.
      // Never regress a posted record back to a stale pending export.
      const changed = existing.date !== transaction.date || existing.amountCents !== transaction.amountCents || existing.merchant !== transaction.merchant || existing.status !== transaction.status;
      if (transaction.id.startsWith("csv:id:") && transaction.status === "posted" && changed) {
        nextTransactions[existingIndex] = { ...transaction, category: existing.category, kind: existing.kind };
        updated++;
      } else skipped++;
    } else {
      indexById.set(transaction.id, nextTransactions.length);
      nextTransactions.push(transaction);
      added++;
    }
  }
  return { ...parsed, workspace: { ...workspace, transactions: nextTransactions }, added, skipped, updated };
}
