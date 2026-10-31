/**
 * Drains queued or failed (retryable) jobs. With embedded PGlite the web server
 * runs jobs inline, so this is mainly for PostgreSQL deployments.
 *   npm run worker            # drain once
 *   npm run worker -- --watch # poll every 5 seconds
 */
import "./env";
import { closeDatabase, initDatabase } from "../src/server/db/client";
import { runPendingJobs } from "../src/server/jobs/queue";
import "../src/server/imports/service";
import "../src/server/evidence/pipeline";

await initDatabase();
const watch = process.argv.includes("--watch");
do {
  const results = await runPendingJobs(25);
  if (results.length) console.log(`Processed ${results.length} job(s):`, results.map((r) => `${r.type}=${r.status}`).join(", "));
  if (watch) await new Promise((r) => setTimeout(r, 5000));
} while (watch);
await closeDatabase();
