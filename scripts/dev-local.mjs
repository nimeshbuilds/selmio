import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
process.env.PLAID_APP_ORIGIN ||= "http://127.0.0.1:3000";
const children = [];
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
function run(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", () => {
    console.error("A local service could not start. See README.md.");
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code || 0;
    }
  });
  return child;
}
if (
  process.env.PLAID_CONNECTOR_KEY?.length >= 32 &&
  process.env.PLAID_CLIENT_ID &&
  process.env.PLAID_SECRET
) {
  run(["--experimental-strip-types", "lib/plaid-server.ts"]);
} else {
  console.log(
    "Selmio local workspace · optional bank connection is not configured.",
  );
}
run([
  "scripts/run-framework.mjs",
  "dev",
  "--port",
  "3000",
  "--host",
  "127.0.0.1",
  ...process.argv.slice(2),
]);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop());
