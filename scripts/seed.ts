/**
 * Seeds the demo environment.
 *   npm run db:seed    # seed an empty database
 *   npm run db:reset   # wipe local data (embedded DB + storage) and re-seed
 */
import "./env";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { closeDatabase, db, initDatabase } from "../src/server/db/client";
import { organizations } from "../src/server/db/schema";
import { DEMO_PASSWORD, LAKEMONT_USERS, seedDemo } from "../src/server/seed/seed";

const reset = process.argv.includes("--reset");
const dataRoot = path.resolve(".data");

function safeRemove(dir: string) {
  const full = path.resolve(dir);
  if (!full.startsWith(dataRoot + path.sep)) throw new Error(`Refusing to delete ${full}: outside ${dataRoot}`);
  fs.rmSync(full, { recursive: true, force: true });
}

if (reset) {
  if (!process.env.DATABASE_URL) safeRemove(process.env.PGLITE_DATA_DIR || ".data/pglite");
  safeRemove(process.env.STORAGE_DIR || ".data/storage");
}
await initDatabase();
if (reset && process.env.DATABASE_URL) {
  await db().execute(sql`drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;`);
  await closeDatabase();
  await initDatabase();
}
const existing = await db().select({ id: organizations.id }).from(organizations).limit(1);
if (existing.length) {
  console.log("Database already contains data. Run `npm run db:reset` to wipe and re-seed.");
  await closeDatabase();
  process.exit(0);
}
const started = Date.now();
await seedDemo({ log: (m) => console.log(m), writeDemoFiles: true });
console.log(`\nSeeded in ${((Date.now() - started) / 1000).toFixed(1)}s. Demo sign-ins (password: ${DEMO_PASSWORD}):`);
for (const u of LAKEMONT_USERS) console.log(`  ${u.email.padEnd(30)} ${u.name} — ${u.title}`);
console.log("  admin@harbor.example           Quinn Harper — separate tenant (isolation demo)");
await closeDatabase();
