/**
 * Starts an isolated server for Playwright: separate embedded database and
 * storage under .data/e2e, freshly seeded, demo mode on.
 */
import { spawn, spawnSync } from "node:child_process";

const port = process.env.E2E_PORT || "3211";
const env = {
  ...process.env,
  PGLITE_DATA_DIR: ".data/e2e/pglite",
  STORAGE_DIR: ".data/e2e/storage",
  DEMO_MODE: "true",
  APP_BASE_URL: `http://localhost:${port}`,
};
delete env.DATABASE_URL;
const run = (args) => {
  const r = spawnSync("npx", args, { env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["tsx", "scripts/seed.ts", "--reset"]);
run(["tsx", "scripts/generate-demo-assets.ts"]);
const server = spawn("npx", ["next", "start", "-p", port], { env, stdio: "inherit", shell: true });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
