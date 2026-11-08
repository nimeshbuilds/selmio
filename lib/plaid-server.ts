/** Host-Node-only connector. Never import this module into the worker or client.
 * Docs: https://plaid.com/docs/transactions/add-to-app/
 * Keep the starting cursor until ALL pages succeed; restart from it on mutation.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Environment = "sandbox" | "production";
type JsonRecord = Record<string, unknown>;
type Item = {
  id: string; accessToken: string; environment: Environment; institutionName: string;
  cursor?: string; accounts: JsonRecord[]; transactions: JsonRecord[]; lastSyncedAt: string | null;
};
type Store = { version: 1; items: Item[] };
export type PlaidConnectorConfig = {
  key: string; clientId: string; secret: string; environment: Environment | null;
  appOrigin: string; redirectUri?: string;
};
const COOKIE = "budget_plaid_session";
const MAX_BYTES = 8_192;
const MAX_PAGES = 30;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const HOSTS: Record<Environment, string> = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" };

class ConnectorError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function string(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function records(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(record) : []; }
function pick(value: JsonRecord, names: string[]) {
  return Object.fromEntries(names.filter((name) => name in value).map((name) => [name, value[name]]));
}
function accounts(value: unknown) {
  return records(value).map((account) => ({ ...pick(account, ["account_id", "name", "official_name", "mask", "type", "subtype"]), balances: pick(record(account.balances), ["available", "current", "limit", "iso_currency_code", "unofficial_currency_code"]) }));
}
function transactions(value: unknown) {
  return records(value).map((transaction) => pick(transaction, ["transaction_id", "account_id", "amount", "date", "authorized_date", "name", "merchant_name", "pending", "pending_transaction_id", "iso_currency_code", "unofficial_currency_code", "category", "personal_finance_category", "payment_channel"]));
}
async function privateFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe local data file");
  await chmod(path, 0o600);
}
async function atomicWrite(path: string, value: unknown) {
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, path); await chmod(path, 0o600); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

/** Exported for isolated connector tests with a temporary directory and mocked Plaid transport. */
export async function createPlaidHandler(config: PlaidConnectorConfig, storageDir: string, transport: typeof fetch = fetch) {
  const origin = new URL(config.appOrigin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol) || config.appOrigin !== origin.origin) throw new Error("PLAID_APP_ORIGIN must be a local origin, with no path");
  if (config.key.length < 32) throw new Error("PLAID_CONNECTOR_KEY must contain at least 32 characters");
  if (config.redirectUri && new URL(config.redirectUri).origin !== origin.origin) throw new Error("PLAID_REDIRECT_URI must belong to PLAID_APP_ORIGIN");
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const info = await lstat(storageDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe local data directory");
  await chmod(storageDir, 0o700);
  const keyPath = resolve(storageDir, "session-key");
  try { const handle = await open(keyPath, "wx", 0o600); try { await handle.writeFile(randomBytes(32).toString("hex")); await handle.sync(); } finally { await handle.close(); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await privateFile(keyPath);
  const sessionKey = await readFile(keyPath, "utf8");
  if (!/^[a-f0-9]{64}$/.test(sessionKey)) throw new Error("Invalid session key file");
  const locks = new Map<string, Promise<unknown>>();
  const sign = (payload: string) => createHmac("sha256", sessionKey).update(payload).digest("hex");
  function session(request: Request) {
    const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const match = raw?.match(/^([a-f0-9]{64})\.(\d{10})\.([a-f0-9]{64})$/);
    if (match && equal(sign(`${match[1]}.${match[2]}`), match[3])) {
      const age = Date.now() / 1000 - Number(match[2]);
      if (age >= -60 && age < SESSION_SECONDS) return { id: match[1], cookie: undefined };
    }
    const id = randomBytes(32).toString("hex");
    const payload = `${id}.${Math.floor(Date.now() / 1000)}`;
    return { id, cookie: `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${origin.protocol === "https:" ? "; Secure" : ""}` };
  }
  async function load(id: string): Promise<Store> {
    const path = resolve(storageDir, `${id}.json`);
    try {
      await privateFile(path);
      const parsed = JSON.parse(await readFile(path, "utf8")) as Store;
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error("Invalid store");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, items: [] };
      throw new ConnectorError("LOCAL_STORE_ERROR", "The private connection store could not be read. It has not been overwritten.", 503);
    }
  }
  async function save(id: string, store: Store) {
    try { await atomicWrite(resolve(storageDir, `${id}.json`), store); }
    catch { throw new ConnectorError("LOCAL_STORE_ERROR", "The private connection store could not be saved. Please retry.", 503); }
  }
  async function plaid(endpoint: string, payload: JsonRecord): Promise<JsonRecord> {
    if (!config.environment || !config.clientId || !config.secret) throw new ConnectorError("PLAID_NOT_CONFIGURED", "Add Plaid credentials to .dev.vars and restart the local connector.", 503);
    let response: Response;
    try {
      response = await transport(`${HOSTS[config.environment]}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" }, body: JSON.stringify({ ...payload, client_id: config.clientId, secret: config.secret }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    } catch { throw new ConnectorError("PLAID_NETWORK_ERROR", "Plaid could not be reached. Your saved connection is unchanged.", 502); }
    const data = record(await response.json().catch(() => ({})));
    if (!response.ok) {
      const code = string(data.error_code);
      const safeCode = /^[A-Z0-9_]{1,100}$/.test(code) ? code : "PLAID_API_ERROR";
      // Never return Plaid's raw error_message: it may contain supplied tokens.
      const message = safeCode === "ITEM_LOGIN_REQUIRED" ? "Your bank requires renewed consent. Use Reconnect for this institution, then sync again." : `Plaid could not complete the request (${safeCode}). Please retry or check your Plaid setup.`;
      throw new ConnectorError(safeCode, message, 502);
    }
    return data;
  }
  function snapshot(store: Store) {
    return {
      environment: config.environment,
      items: store.items.map((item) => ({ id: item.id, institutionName: item.institutionName, lastSyncedAt: item.lastSyncedAt, environment: item.environment })),
      accounts: store.items.flatMap((item) => item.accounts.map((account) => ({ ...account, item_id: item.id }))),
      transactions: store.items.flatMap((item) => item.transactions.map((transaction) => ({ ...transaction, item_id: item.id }))),
      snapshot: true,
      lastSyncedAt: store.items.map((item) => item.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null,
    };
  }
  async function syncItem(item: Item) {
    if (item.environment !== config.environment) throw new ConnectorError("ENVIRONMENT_MISMATCH", "This connection belongs to a different Plaid environment. Restore that environment to disconnect it.", 409);
    const startingCursor = item.cursor;
    for (let attempt = 0; attempt < 3; attempt++) {
      let cursor = startingCursor;
      const current = new Map(item.transactions.map((transaction) => [string(transaction.transaction_id), transaction]));
      let syncedAccounts = item.accounts;
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const data = await plaid("/transactions/sync", { access_token: item.accessToken, count: 500, ...(cursor ? { cursor } : {}) });
          for (const entry of records(data.removed)) current.delete(string(entry.transaction_id));
          for (const entry of [...transactions(data.added), ...transactions(data.modified)]) {
            if (!string(entry.transaction_id)) throw new ConnectorError("INVALID_PLAID_RESPONSE", "Plaid returned incomplete transaction data. The cursor was not advanced.", 502);
            current.set(string(entry.transaction_id), entry);
          }
          if (Array.isArray(data.accounts)) syncedAccounts = accounts(data.accounts);
          const nextCursor = string(data.next_cursor);
          if (data.has_more && (!nextCursor || nextCursor === cursor)) throw new ConnectorError("INVALID_PLAID_CURSOR", "Plaid did not advance its transaction cursor. Please retry.", 502);
          cursor = nextCursor || cursor;
          if (!data.has_more) {
            return { ...item, cursor, accounts: syncedAccounts, transactions: [...current.values()], lastSyncedAt: new Date().toISOString() };
          }
        }
        throw new ConnectorError("SYNC_PAGE_LIMIT", "This update exceeded the local safety limit. The cursor was not advanced; no transactions were discarded.", 503);
      } catch (error) {
        if (error instanceof ConnectorError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConnectorError("SYNC_RETRY_LIMIT", "Plaid is updating this account. Retry sync shortly.", 503);
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return json({ error: "Local connector only.", code: "HOST_REJECTED" }, 403);
    if (!equal(request.headers.get("authorization") ?? "", `Bearer ${config.key}`)) return json({ error: "Connector authorization failed.", code: "CONNECTOR_UNAUTHORIZED" }, 401);
    if (request.headers.get("x-budget-app-origin") !== origin.origin) return json({ error: "App origin rejected.", code: "ORIGIN_REJECTED" }, 403);
    const action = url.pathname.slice(1);
    if (!["status", "link-token", "update-token", "exchange", "sync", "disconnect"].includes(action) || request.method !== (action === "status" ? "GET" : "POST")) return json({ error: "Not found.", code: "NOT_FOUND" }, 404);
    const user = session(request);
    const headers: Record<string, string> = user.cookie ? { "Set-Cookie": user.cookie } : {};
    const run = async () => {
      try {
        const store = await load(user.id);
        const configured = Boolean(config.clientId && config.secret && config.environment);
        if (action === "status") return json({ configured, available: true, connected: store.items.length > 0, environment: config.environment, items: snapshot(store).items, ...(!configured ? { reason: "plaid_credentials_missing" } : {}) }, 200, headers);
        if (user.cookie && action !== "link-token") throw new ConnectorError("SESSION_REQUIRED", "Start Connect bank in this browser before syncing or exchanging a Link token.", 401);
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ConnectorError("JSON_REQUIRED", "Use application/json.", 415);
        const raw = await request.text();
        if (Buffer.byteLength(raw) > MAX_BYTES) throw new ConnectorError("BODY_TOO_LARGE", "Request is too large.", 413);
        let payload: JsonRecord;
        try { const parsed: unknown = raw ? JSON.parse(raw) : {}; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); payload = record(parsed); } catch { throw new ConnectorError("INVALID_JSON", "A JSON object is required."); }
        if (action === "link-token") {
          const data = await plaid("/link/token/create", { client_name: "Selmio", language: "en", country_codes: ["US"], products: ["transactions"], user: { client_user_id: user.id }, transactions: { days_requested: 365 }, ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}) });
          return json({ link_token: data.link_token, expiration: data.expiration, environment: config.environment }, 200, headers);
        }
        if (action === "update-token") {
          const item = store.items.find((entry) => entry.id === string(payload.item_id));
          if (!item) throw new ConnectorError("ITEM_NOT_FOUND", "No matching bank connection exists in this browser session.", 404);
          if (item.environment !== config.environment) throw new ConnectorError("ENVIRONMENT_MISMATCH", "Restore this connection's Plaid environment before reconnecting it.", 409);
          // Update mode reuses the Item's access token. Plaid requires omitting
          // products and product-specific options; no token exchange follows.
          // https://plaid.com/docs/link/update-mode/
          const data = await plaid("/link/token/create", { client_name: "Selmio", language: "en", country_codes: ["US"], user: { client_user_id: user.id }, access_token: item.accessToken, ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}) });
          return json({ link_token: data.link_token, expiration: data.expiration, environment: config.environment, item_id: item.id, mode: "update" }, 200, headers);
        }
        if (action === "exchange") {
          if (store.items.length >= 5) throw new ConnectorError("ITEM_LIMIT", "Disconnect an institution before adding another. This local app supports five institutions.");
          const token = string(payload.public_token);
          if (!token || token.length > 2048 || !token.startsWith(`public-${config.environment}-`)) throw new ConnectorError("INVALID_PUBLIC_TOKEN", "A public token from the configured Plaid environment is required.");
          const data = await plaid("/item/public_token/exchange", { public_token: token });
          const accessToken = string(data.access_token);
          if (!accessToken) throw new ConnectorError("INVALID_PLAID_RESPONSE", "Plaid did not return a connection token.", 502);
          const item: Item = { id: randomBytes(16).toString("hex"), accessToken, environment: config.environment!, institutionName: string(record(payload.institution).name, "Connected institution").slice(0, 100), accounts: [], transactions: [], lastSyncedAt: null };
          store.items.push(item);
          try { await save(user.id, store); } catch (error) { await plaid("/item/remove", { access_token: accessToken }).catch(() => {}); throw error; }
          try { store.items[store.items.length - 1] = await syncItem(item); await save(user.id, store); }
          catch (error) { return json({ ...snapshot(await load(user.id)), connected: true, syncError: error instanceof ConnectorError ? error.message : "Initial sync failed. Your connection is saved; retry sync." }, 202, headers); }
          return json({ ...snapshot(store), connected: true }, 200, headers);
        }
        const itemId = payload.item_id === undefined ? undefined : string(payload.item_id);
        const selected = store.items.filter((item) => itemId === undefined || item.id === itemId);
        if (!selected.length) throw new ConnectorError("ITEM_NOT_FOUND", "No matching bank connection exists in this browser session.", 404);
        if (action === "disconnect") {
          for (const item of selected) {
            if (item.environment !== config.environment) throw new ConnectorError("ENVIRONMENT_MISMATCH", "Restore this item's Plaid environment before disconnecting.", 409);
            await plaid("/item/remove", { access_token: item.accessToken });
            store.items = store.items.filter((entry) => entry.id !== item.id);
            await save(user.id, store);
          }
          return json({ disconnected: true, ...snapshot(store) }, 200, headers);
        }
        // Persist full snapshots with cursors atomically. A dropped HTTP response
        // cannot cause lost deltas: the next sync returns the complete snapshot.
        for (const item of selected) {
          const next = await syncItem(item);
          store.items = store.items.map((entry) => entry.id === next.id ? next : entry);
          await save(user.id, store);
        }
        return json(snapshot(store), 200, headers);
      } catch (error) {
        if (error instanceof ConnectorError) return json({ error: error.message, code: error.code }, error.status, headers);
        return json({ error: "The local connector could not finish. No secret details have been returned.", code: "CONNECTOR_ERROR" }, 500, headers);
      }
    };
    const previous = locks.get(user.id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(run);
    locks.set(user.id, pending);
    try { return await pending; } finally { if (locks.get(user.id) === pending) locks.delete(user.id); }
  };
}

async function start() {
  const value = process.env.PLAID_ENV ?? "sandbox";
  const environment = value === "sandbox" || value === "production" ? value : null;
  if (!environment) throw new Error("PLAID_ENV must be sandbox or production");
  const handler = await createPlaidHandler({ key: process.env.PLAID_CONNECTOR_KEY ?? "", clientId: process.env.PLAID_CLIENT_ID ?? "", secret: process.env.PLAID_SECRET ?? "", environment, appOrigin: process.env.PLAID_APP_ORIGIN ?? "http://127.0.0.1:3000", redirectUri: process.env.PLAID_REDIRECT_URI || undefined }, resolve(dirname(fileURLToPath(import.meta.url)), "../.local-data/plaid"));
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== "127.0.0.1:4174") { outgoing.writeHead(403); outgoing.end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > MAX_BYTES) { outgoing.writeHead(413, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ error: "Request too large", code: "BODY_TOO_LARGE" })); return; } chunks.push(Buffer.from(chunk)); }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) { if (typeof value === "string") headers.set(name, value); }
      const response = await handler(new Request(`http://127.0.0.1:4174${incoming.url ?? "/"}`, { method: incoming.method, headers, ...(size ? { body: Buffer.concat(chunks) } : {}) }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ error: "Local connector request failed", code: "CONNECTOR_ERROR" })); }
  });
  server.listen(4174, "127.0.0.1", () => console.log(`Local Plaid connector listening on 127.0.0.1:4174 (${environment}).`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => { console.error("Plaid connector could not start. Check .dev.vars, local filesystem access, and docs/PLAID.md."); process.exitCode = 1; });
}
