import { z } from "zod";
import type { Workspace } from "./finance";
const cents = z.number().int().safe();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  );
const account = z
  .object({
    id: z.string().min(1).max(2000),
    name: z.string().min(1).max(2000),
    institution: z.string().min(1).max(2000),
    type: z.enum(["checking", "savings", "credit"]),
    balanceCents: cents,
    lastUpdated: z
      .string()
      .max(100)
      .refine(
        (s) =>
          /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) &&
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().slice(0, 10) === s.slice(0, 10),
        "Invalid balance snapshot date",
      ),
  })
  .passthrough();
const transaction = z
  .object({
    id: z.string().min(1).max(2000),
    accountId: z.string().min(1).max(2000),
    date,
    merchant: z.string().max(500),
    category: z.string().min(1).max(2000),
    amountCents: cents,
    kind: z.enum(["expense", "income", "transfer"]),
    status: z.enum(["posted", "pending"]),
  })
  .passthrough();
const commitment = z
  .object({
    id: z.string().min(1).max(2000),
    name: z.string().min(1).max(2000),
    amountCents: cents.nonnegative(),
    dueDate: date,
    accountId: z.string().min(1).max(2000),
    kind: z.enum(["bill", "income", "goal"]),
    confirmed: z.boolean(),
  })
  .passthrough();
const ambiguity = z
  .object({
    id: z.string().min(1).max(2000),
    title: z.string().max(500),
    detail: z.string().max(2000),
    amountCents: cents.nonnegative(),
    accountId: z.string().min(1).max(2000),
    date,
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().max(300),
          detail: z.string().max(1000),
          additionalOutflowCents: cents.nonnegative(),
        }),
      )
      .min(1)
      .max(20),
    resolvedOptionId: z.string().optional(),
  })
  .passthrough();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["demo", "personal"]),
    accounts: z.array(account).max(200),
    transactions: z.array(transaction).max(100000),
    commitments: z.array(commitment).max(5000),
    ambiguities: z.array(ambiguity).max(5000),
    bufferCents: cents.nonnegative(),
    sourceWarnings: z.array(z.string().max(2000)).max(500).optional(),
  })
  .passthrough();
export const STORAGE_KEY = "selmio.workspace.v1";
export function validateWorkspace(value: unknown): Workspace {
  const parsed = schema.parse(value);
  const ids = new Set(parsed.accounts.map((a) => a.id));
  if (ids.size !== parsed.accounts.length)
    throw new Error("The backup has duplicate account IDs.");
  for (const entries of [
    parsed.transactions,
    parsed.commitments,
    parsed.ambiguities,
  ])
    if (new Set(entries.map((x) => x.id)).size !== entries.length)
      throw new Error("The backup has duplicate record IDs.");
  for (const item of parsed.ambiguities) {
    if (new Set(item.options.map((o) => o.id)).size !== item.options.length)
      throw new Error("The backup has duplicate option IDs.");
    if (
      item.resolvedOptionId &&
      !item.options.some((o) => o.id === item.resolvedOptionId)
    )
      throw new Error("The backup has an invalid resolved alternative.");
  }
  if (
    [...parsed.transactions, ...parsed.commitments, ...parsed.ambiguities].some(
      (t) => !ids.has(t.accountId),
    )
  )
    throw new Error("The backup contains an entry without its account.");
  return parsed as Workspace;
}
export function downloadFile(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
