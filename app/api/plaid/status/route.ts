import { proxyPlaid } from "../_proxy";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return proxyPlaid(request, "status"); }
