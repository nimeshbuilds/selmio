# Optional local Plaid connection

This is a real, optional Transactions integration. It does not come with credentials, does not fake a bank connection, and does not initiate payments. Sandbox uses simulated institutions and must not be presented as a real connected bank. Production requires your own Plaid approval, applicable institution access, and Production credentials.

## Run locally

1. Copy `.env.example` to `.dev.vars`. Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and a randomly generated `PLAID_CONNECTOR_KEY` of at least 32 characters. The connector key authenticates the app server to the local connector; it is not a Plaid key. Use your exact browser origin for `PLAID_APP_ORIGIN`, initially `http://127.0.0.1:3000`.
2. From the app directory run `npm run dev`. This starts both the application and the private Node connector when credentials and a connector key are configured. Open `http://127.0.0.1:3000` using the same origin configured above. Restart after changing `.dev.vars`.
3. For debugging only, the connector can instead be launched with `npm run connector` alongside the framework command. Do not start a second connector on the same port. The normal `npm run dev` command handles both services.
4. Use Connect bank. Link runs via Plaid's official browser interface. Never put `PLAID_SECRET`, `PLAID_CONNECTOR_KEY`, or an access token in a `NEXT_PUBLIC_*` / `VITE_*` variable or client code.

The browser integration must load official Plaid Link, call `/api/plaid/link-token`, initialize Link with the returned `link_token`, and POST `public_token` from `onSuccess` to `/api/plaid/exchange`. A Link token/public token is intended for this flow; the enduring access token remains in the local connector.

## Why a separate process

This starter renders in Cloudflare workerd, including local development. Its filesystem is not the host's durable private filesystem. Same-origin App Router handlers therefore proxy to a fixed loopback-only Node process at `127.0.0.1:4174`. The proxy authenticates with the connector key. It accepts local hostnames only, validates the Origin of mutations, rejects cross-site requests, limits request bodies to 8 KiB, and never accepts a caller-supplied upstream URL. The Node service has no CORS support and also checks its Host, connector key, and configured app origin.

This connector intentionally does **not** work on a published cloud Site. A hosted deployment requires an authenticated backend, encrypted durable storage, explicit user identities, key management, and an appropriate Plaid deployment review. Do not expose this local connector via a public tunnel.

## Local data and session boundary

`/.local-data/plaid/` is outside the public tree and must be gitignored. The directory is mode 0700; its session-signing key and per-browser files are mode 0600. Files contain access tokens, sync cursors, normalized account data and transactions. They are private host files, not encrypted at rest; disk encryption and OS account security remain relevant. Never publish or upload this directory.

Each browser receives a random, HMAC-signed, HttpOnly, SameSite=Strict cookie, Secure when the configured origin uses HTTPS. The cookie expires after 30 days. A request can only access the items belonging to that signed browser session. This is local session isolation, not a multi-user login system. Clearing cookies loses this browser's route to its saved items; disconnect before clearing browser storage. If that happens, revoke the connection using your bank/Plaid permissions tools before deleting orphaned files. Removing files alone does not remove the Plaid Item or end subscription billing.

Use Disconnect to call Plaid `/item/remove`. Local credentials are retained on failure so removal can be retried. Disconnect stops syncing and deletes the corresponding connector snapshot, but a previously imported copy in browser storage must be deleted separately by the UI if the user requests deletion.

## API contract

All mutations require same-origin `Origin`, `Content-Type: application/json`, and the browser cookie; fetch uses the default same-origin credentials. No access token is ever returned.

| Route | Body | Response |
|---|---|---|
| GET `/api/plaid/status` | — | `{configured, available, environment, connected, items, reason?}` |
| POST `/api/plaid/link-token` | `{}` | `{link_token, expiration, environment}`; establishes a session if needed |
| POST `/api/plaid/update-token` | `{item_id}` | `{link_token, expiration, environment, item_id, mode:"update"}` for an existing Item belonging to this browser. |
| POST `/api/plaid/exchange` | `{public_token, institution?: {name, id}}` | Full snapshot; `connected:true`. HTTP 202 plus `syncError` means the Item was saved but initial data is not ready or sync failed. |
| POST `/api/plaid/sync` | `{item_id?}` | Full snapshot for this browser, not transaction deltas. |
| POST `/api/plaid/disconnect` | `{item_id?}` | `{disconnected:true, ...snapshot}`; omitted item id removes all this browser's items. |

A snapshot is `{environment, items, accounts, transactions, snapshot:true, lastSyncedAt}`. `items` exposes opaque local `id`, `institutionName`, environment and last sync time. Accounts and transactions retain selected Plaid snake_case fields and include that local `item_id`. Replace the existing Plaid-derived browser snapshot; do not append or sum snapshots. Replacing removes transactions that Plaid has removed and updates pending/posted entries. Plaid amounts are positive for money leaving the account and negative for money entering; credit-card payments and transfers still need accounting reconciliation in the budgeting engine. Balances can be null and currency must be respected. Account balances are cached source values, not guaranteed real-time funds.

Errors are `{error, code}` with no raw upstream errors or credentials. When the connector/credentials are absent, status gracefully reports unavailable/unconfigured. These conditions do not count as an active connection. HTTP 202 from exchange means the bank Item exists but the data is not successfully synchronized yet: display `syncError`, do not import empty data as a successful budget, and offer Sync again.

## Renew consent and resume OAuth

For `ITEM_LOGIN_REQUIRED`, POST the local `item_id` to `update-token`, initialize Plaid Link with the returned token, and on successful completion call `sync` for that same Item. Ignore the `public_token` in an update-mode `onSuccess`: the saved access token is unchanged, and **do not call exchange again**. This endpoint does not add products or move money.

If using redirect-based OAuth, configure `PLAID_REDIRECT_URI` to the exact URL registered in the Plaid Dashboard. It must have the same origin as `PLAID_APP_ORIGIN`. Production institutions may require approved HTTPS redirect configuration; do not assume a local HTTP URI works for all institutions.

The client must retain `{linkToken, mode, itemId?}` in `sessionStorage` before opening Link. When the redirect returns with `oauth_state_id` in the URL, initialize Link using the **same** stored Link token and `receivedRedirectUri: window.location.href`. Pass that exact returned URL, without adding query parameters or fragments. After success, new connections exchange their public token; update-mode sessions instead sync the stored Item. Clear the saved Link state and remove the OAuth query parameters after completion/exit so a used OAuth state is not replayed. If storage is missing or the token expired, start a new explicit Link flow and report the problem rather than manufacturing a connection. This is a frontend resume contract; the connector does not receive or process the bank OAuth code.

See [Plaid update mode](https://plaid.com/docs/link/update-mode/) and [Plaid OAuth guide](https://plaid.com/docs/link/oauth/).

## Sync correctness and limitations

Sync fetches at most 30 pages of 500 updates, restarting from the original saved cursor up to twice for `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`. An incomplete batch never advances its persisted cursor. Successful full snapshots and cursors are written together by temporary-file rename. Requests for one browser are serialized in the single connector process. Because a full snapshot is returned, a lost browser response does not lose deltas. Limits return an explicit retryable error; they do not discard history.

The app requests only `transactions` and up to 365 days of history. Actual history varies by institution. Initial sync may return empty arrays while Plaid fetches the data; retry manually. No automatic refresh, webhooks, continuous polling, or guarantees about institution freshness are implemented. OAuth institution availability depends on the Plaid account's approvals and redirect configuration. The implementation supports at most five institutions per browser.

## Reproducible checks

Run `node --experimental-strip-types --test lib/plaid-server.test.ts`. These tests use temporary directories and a mocked transport; they do not create a real bank connection. They cover signed session isolation, connector authorization, origin checks, pagination restart, cursor rollback, removal/update snapshots, file permissions, update-mode payloads, and disconnect.

Source references: [Plaid API environments](https://plaid.com/docs/api/), [Link token flow](https://plaid.com/docs/api/link/), [Transactions integration and cursor handling](https://plaid.com/docs/transactions/add-to-app/), [Transactions fields](https://plaid.com/docs/api/products/transactions/), [Item removal](https://plaid.com/docs/api/items/).
