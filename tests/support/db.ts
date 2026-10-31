import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { closeDatabase, MIGRATIONS_FOLDER, schema, setDatabaseForTesting } from "@/server/db/client";

/** Fresh in-memory PostgreSQL (PGlite) with all migrations applied, plus an isolated storage dir. */
export async function setupTestDatabase() {
  process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "premedfix-test-"));
  process.env.DEMO_MODE = "true";
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  setDatabaseForTesting(db, () => client.close());
  return db;
}

export async function teardownTestDatabase() {
  await closeDatabase();
}
