import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Node's strip-types runner requires an explicit .ts extension.
import { createPlaidHandler } from "./plaid-server.ts";
import type { PlaidConnectorConfig } from "./plaid-server";

type Data = {
  configured?: boolean; connected?: boolean; available?: boolean; disconnected?: boolean;
  error?: string; code?: string; link_token?: string; mode?: string; item_id?: string; syncError?: string;
  items?: { id: string; institutionName: string; lastSyncedAt: string | null }[];
  transactions?: Record<string, unknown>[]; accounts?: Record<string, unknown>[];
};
type Call = { path: string; body: Record<string, unknown> };
const configuration: PlaidConnectorConfig = {
  key: "test-only-connector-key-01234567890123456789", clientId: "test-client", secret: "server-only-secret",
  environment: "sandbox", appOrigin: "http://127.0.0.1:3000", redirectUri: "http://127.0.0.1:3000/",
};
const transaction = (id: string, amount = 50) => ({ transaction_id: id, account_id: "a1", amount, name: "Example", date: "2026-11-07", pending: false, iso_currency_code: "USD" });
const completedPage = (added: Record<string, unknown>[] = [transaction("t1")], next_cursor = "c1") => ({
  added, modified: [], removed: [], next_cursor, has_more: false,
  accounts: [{ account_id: "a1", name: "Checking", type: "depository", subtype: "checking", balances: { current: 1000, available: null, iso_currency_code: "USD" } }],
});

async function fixture(t: test.TestContext, sync?: (body: Record<string, unknown>) => Response, overrides: Partial<PlaidConnectorConfig> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "selmio-plaid-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: Call[] = [];
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.secret, "server-only-secret");
    calls.push({ path, body });
    if (path === "/link/token/create") return Response.json({ link_token: "link-sandbox-test", expiration: "2026-11-07T12:00:00Z" });
    if (path === "/item/public_token/exchange") return Response.json({ access_token: "access-sandbox-private-token" });
    if (path === "/item/remove") return Response.json({ request_id: "safe-request-id" });
    assert.equal(path, "/transactions/sync");
    return sync ? sync(body) : Response.json(completedPage());
  };
  const handler = await createPlaidHandler({ ...configuration, ...overrides }, directory, transport);
  let cookie = "";
  async function call(action: string, body: Record<string, unknown> = {}, headerOverrides: Record<string, string> = {}) {
    const response = await handler(new Request(`http://127.0.0.1:4174/${action}`, {
      method: action === "status" ? "GET" : "POST",
      headers: { authorization: `Bearer ${configuration.key}`, "x-budget-app-origin": configuration.appOrigin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headerOverrides },
      ...(action === "status" ? {} : { body: JSON.stringify(body) }),
    }));
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, data: await response.json() as Data, headers: response.headers };
  }
  async function connect() {
    await call("status");
    await call("link-token");
    return call("exchange", { public_token: "public-sandbox-example", institution: { name: "Example institution" } });
  }
  async function saved() {
    const file = (await readdir(directory)).find((name) => name.endsWith(".json"));
    assert.ok(file);
    return { path: join(directory, file), data: JSON.parse(await readFile(join(directory, file), "utf8")) as { items: { cursor: string; transactions: Record<string, unknown>[] }[] } };
  }
  return { call, connect, saved, calls, directory, handler, getCookie: () => cookie, setCookie: (value: string) => { cookie = value; } };
}

test("unconfigured status is honest; credentials are never inferred", async (t) => {
  const f = await fixture(t, undefined, { clientId: "", secret: "" });
  const response = await f.call("status");
  assert.equal(response.data.configured, false);
  assert.equal(response.data.available, true);
  assert.equal(response.data.connected, false);
  assert.equal((await f.call("link-token")).status, 503);
  assert.equal(f.calls.length, 0);
});

test("authorization, origin, session signatures, payload limits and browser isolation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("status", {}, { authorization: "wrong" })).status, 401);
  assert.equal((await f.call("link-token", {}, { "x-budget-app-origin": "https://evil.example" })).status, 403);
  assert.equal((await f.call("exchange", { public_token: "public-sandbox-example" })).status, 401);
  const first = await f.connect();
  assert.equal(first.status, 200);
  assert.equal(first.data.connected, true);
  const ownerCookie = f.getCookie();
  f.setCookie(`${ownerCookie.slice(0, -1)}${ownerCookie.endsWith("a") ? "b" : "a"}`);
  assert.equal((await f.call("status")).data.connected, false);
  f.setCookie("");
  assert.equal((await f.call("status")).data.connected, false);
  const ownerItem = first.data.items![0].id;
  assert.equal((await f.call("update-token", { item_id: ownerItem })).status, 404);
  assert.equal((await f.call("disconnect", { item_id: ownerItem })).status, 404);
  f.setCookie(ownerCookie);
  assert.equal((await f.call("status")).data.connected, true);
  assert.equal((await f.call("sync", { too_large: "x".repeat(9000) })).status, 413);
});

test("new Link requests only Transactions; update mode preserves the existing access token", async (t) => {
  const f = await fixture(t);
  const connected = await f.connect();
  const newLink = f.calls.find((call) => call.path === "/link/token/create")!;
  assert.equal(newLink.body.client_name, "Selmio");
  assert.deepEqual(newLink.body.products, ["transactions"]);
  assert.deepEqual(newLink.body.transactions, { days_requested: 365 });
  assert.equal(newLink.body.redirect_uri, configuration.redirectUri);
  assert.equal("access_token" in newLink.body, false);
  const item = connected.data.items![0];
  const update = await f.call("update-token", { item_id: item.id });
  assert.equal(update.status, 200);
  assert.equal(update.data.mode, "update");
  assert.equal(update.data.item_id, item.id);
  const updateLink = f.calls.filter((call) => call.path === "/link/token/create").at(-1)!;
  assert.equal(updateLink.body.access_token, "access-sandbox-private-token");
  assert.equal("products" in updateLink.body, false);
  assert.equal("transactions" in updateLink.body, false);
  assert.equal(updateLink.body.redirect_uri, configuration.redirectUri);
  assert.equal(JSON.stringify(update).includes("access-sandbox-private-token"), false);
  assert.equal(f.calls.filter((call) => call.path === "/item/public_token/exchange").length, 1);
});

test("pagination mutation discards partial batch and restarts at original cursor", async (t) => {
  const cursors: unknown[] = [];
  let count = 0;
  const f = await fixture(t, (body) => {
    cursors.push(body.cursor); count++;
    if (count === 1) return Response.json({ added: [transaction("partial")], modified: [], removed: [], next_cursor: "partial-cursor", has_more: true });
    if (count === 2) return Response.json({ error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "access-sandbox-private-token" }, { status: 400 });
    return Response.json(completedPage());
  });
  const response = await f.connect();
  assert.equal(response.status, 200);
  assert.deepEqual(cursors, [undefined, "partial-cursor", undefined]);
  assert.deepEqual(response.data.transactions?.map((entry) => entry.transaction_id), ["t1"]);
  assert.equal((await f.saved()).data.items[0].cursor, "c1");
});

test("sync snapshots include modifications/removals and a failed later page does not advance cursor", async (t) => {
  let phase = "initial"; let page = 0;
  const f = await fixture(t, () => {
    if (phase === "initial") return Response.json(completedPage());
    if (phase === "update") return Response.json({ ...completedPage([transaction("t2")], "c2"), modified: [transaction("t1", 90)] });
    if (phase === "remove") return Response.json({ ...completedPage([], "c3"), removed: [{ transaction_id: "t1" }] });
    page++;
    return page === 1
      ? Response.json({ added: [transaction("uncommitted")], next_cursor: "uncommitted-cursor", has_more: true })
      : Response.json({ error_code: "ITEM_LOGIN_REQUIRED", error_message: "access-sandbox-private-token" }, { status: 400 });
  });
  await f.connect();
  phase = "update";
  let response = await f.call("sync");
  assert.equal(response.data.transactions?.find((entry) => entry.transaction_id === "t1")?.amount, 90);
  phase = "remove";
  response = await f.call("sync");
  assert.deepEqual(response.data.transactions?.map((entry) => entry.transaction_id), ["t2"]);
  phase = "fail";
  response = await f.call("sync");
  assert.equal(response.status, 502);
  assert.equal(response.data.code, "ITEM_LOGIN_REQUIRED");
  assert.equal(JSON.stringify(response).includes("access-sandbox-private-token"), false);
  const persisted = await f.saved();
  assert.equal(persisted.data.items[0].cursor, "c3");
  assert.deepEqual(persisted.data.items[0].transactions.map((entry) => entry.transaction_id), ["t2"]);
});

test("initial sync failure saves the Item and reports HTTP 202 without claiming an imported budget", async (t) => {
  const f = await fixture(t, () => Response.json({ error_code: "PRODUCT_NOT_READY" }, { status: 400 }));
  const response = await f.connect();
  assert.equal(response.status, 202);
  assert.equal(response.data.connected, true);
  assert.ok(response.data.syncError);
  assert.equal(response.data.items?.length, 1);
  assert.deepEqual(response.data.transactions, []);
  assert.equal((await f.saved()).data.items.length, 1);
});

test("private files have restrictive permissions and disconnect removes the remote Item", async (t) => {
  const f = await fixture(t);
  const response = await f.connect();
  assert.equal(JSON.stringify(response).includes("server-only-secret"), false);
  assert.equal(JSON.stringify(response).includes("access-sandbox-private-token"), false);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  for (const file of await readdir(f.directory)) assert.equal((await stat(join(f.directory, file))).mode & 0o777, 0o600);
  assert.equal((await f.call("disconnect")).data.disconnected, true);
  assert.equal(f.calls.filter((call) => call.path === "/item/remove").length, 1);
  assert.equal((await f.call("status")).data.connected, false);
  assert.deepEqual((await f.saved()).data.items, []);
});

test("connector rejects an OAuth redirect on another origin", async (t) => {
  await assert.rejects(fixture(t, undefined, { redirectUri: "https://other.example/callback" }), /PLAID_REDIRECT_URI/);
});
