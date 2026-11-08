import { env } from "cloudflare:workers";

const CONNECTOR = "http://127.0.0.1:4174";
const COOKIE_NAME = "budget_plaid_session";
const MAX_BODY_BYTES = 8_192;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function trustedLocalRequest(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  const host = request.headers.get("host");
  if (host && host !== url.host) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (request.method !== "GET") {
    // Deliberately require Origin, including for command-line clients.
    if (request.headers.get("origin") !== url.origin) return false;
    if (!request.headers.get("content-type")?.startsWith("application/json")) return false;
  }
  return true;
}

export async function proxyPlaid(request: Request, action: string) {
  if (!trustedLocalRequest(request)) {
    return json({ error: "Plaid is available only from this local app's origin.", code: "ORIGIN_REJECTED" }, 403);
  }
  const bindings = env as unknown as Record<string, string | undefined>;
  const key = bindings.PLAID_CONNECTOR_KEY;
  if (!key || key.length < 32) {
    if (action === "status") return json({ configured: false, available: false, connected: false, environment: null, items: [], reason: "connector_not_configured" });
    return json({ error: "Configure and start the local Plaid connector first. See docs/PLAID.md.", code: "CONNECTOR_NOT_CONFIGURED" }, 503);
  }
  let body: Uint8Array | undefined;
  if (request.method !== "GET") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel();
          return json({ error: "Request is too large.", code: "BODY_TOO_LARGE" }, 413);
        }
        chunks.push(value);
      }
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  try {
    const response = await fetch(`${CONNECTOR}/${action}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Budget-App-Origin": new URL(request.url).origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body as BodyInit | undefined,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) headers.set("set-cookie", setCookie);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    if (action === "status") return json({ configured: false, available: false, connected: false, environment: null, items: [], reason: "connector_offline" });
    return json({ error: "The local Plaid connector is offline or timed out. Your connection was not simulated.", code: "CONNECTOR_OFFLINE" }, 503);
  }
}
