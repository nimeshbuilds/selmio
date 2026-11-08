import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const requestedBase = process.env.PAGES_BASE_PATH?.trim() || "/selmio/";
const segments = requestedBase.split("/").filter(Boolean);
const base = segments.length ? `/${segments.join("/")}/` : "/";
if (segments.some(segment => segment === "." || segment === "..") || !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base)) {
  throw new Error("PAGES_BASE_PATH must be a URL path such as /selmio/ or /.");
}

export default defineConfig({
  root: resolve(repositoryRoot, "web-preview"),
  publicDir: resolve(repositoryRoot, "public"),
  base,
  plugins: [react()],
  resolve: {
    alias: { "@": repositoryRoot },
  },
  define: {
    "process.env.NEXT_PUBLIC_STATIC_PREVIEW": JSON.stringify("true"),
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(base.replace(/\/$/, "")),
  },
  build: {
    outDir: resolve(repositoryRoot, "dist-pages"),
    emptyOutDir: true,
  },
});
