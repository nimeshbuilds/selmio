import { proxyPlaid } from "../_proxy";
export function POST(request: Request) { return proxyPlaid(request, "exchange"); }
