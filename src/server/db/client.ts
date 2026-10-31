/**
 * Database access.
 *
 * Driver selection:
 * - DATABASE_URL set  -> node-postgres against a real PostgreSQL server.
 * - otherwise         -> PGlite (PostgreSQL compiled to WASM) persisted at PGLITE_DATA_DIR.
 *
 * Both run the same SQL migrations from /drizzle. Services never hold a client
 * directly: they call `db()`, which returns the active transaction when called
 * inside `transaction()`, so nested service calls join the outer transaction.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgliteDatabase, PgliteQueryResultHKT } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgliteDatabase<Schema>;
/** A database or transaction handle. */
export type Executor = PgDatabase<PgliteQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

interface DbState {
  db: Db | null;
  init: Promise<Db> | null;
  close: (() => Promise<void>) | null;
}

const globalKey = Symbol.for("premedfix.db");
const g = globalThis as unknown as { [globalKey]?: DbState };
const state: DbState = (g[globalKey] ??= { db: null, init: null, close: null });

const txStorage = new AsyncLocalStorage<Executor>();

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

function acquireDirLock(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(path.dirname(path.resolve(dataDir)), `${path.basename(dataDir)}.lock`);
  try {
    const existing = Number(fs.readFileSync(lockPath, "utf8"));
    if (existing && existing !== process.pid) {
      let alive = false;
      try {
        process.kill(existing, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        throw new Error(
          `Embedded database at ${dataDir} is in use by process ${existing}. Stop the running server before using it from another process.`,
        );
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.writeFileSync(lockPath, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(lockPath, "utf8") === String(process.pid)) fs.unlinkSync(lockPath);
    } catch {
      /* already released */
    }
  };
  process.once("exit", release);
  return release;
}

async function openDatabase(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // Serverless-friendly: few connections, idle ones closed before a managed
    // server or pooler drops them. A dropped idle connection must not crash the
    // process, so pool errors are logged rather than left unhandled.
    const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5), idleTimeoutMillis: 10_000 });
    pool.on("error", (err) => console.warn("db.pool_error", err.message));
    const db = drizzle(pool, { schema });
    if (process.env.AUTO_MIGRATE !== "false") await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    state.close = async () => pool.end();
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DATA_DIR || ".data/pglite";
  const release = acquireDirLock(dataDir);
  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  state.close = async () => {
    await client.close();
    release();
  };
  return db;
}

/** Open (once) and migrate the database. Safe to call repeatedly. */
export function initDatabase(): Promise<Db> {
  if (state.db) return Promise.resolve(state.db);
  state.init ??= openDatabase().then((db) => {
    state.db = db;
    return db;
  });
  return state.init;
}

/** The active executor: the current transaction if inside `transaction()`, else the root handle. */
export function db(): Executor {
  const tx = txStorage.getStore();
  if (tx) return tx;
  if (!state.db) throw new Error("Database not initialized. Call initDatabase() first.");
  return state.db as unknown as Executor;
}

/** Run `fn` in a transaction. Nested calls join the outer transaction. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStorage.getStore()) return fn();
  if (!state.db) await initDatabase();
  return (state.db as unknown as Executor).transaction((tx) => txStorage.run(tx as unknown as Executor, fn));
}

/** Test hook: install an already-migrated database handle. */
export function setDatabaseForTesting(db: Db | null, close?: () => Promise<void>) {
  state.db = db;
  state.init = db ? Promise.resolve(db) : null;
  state.close = close ?? null;
}

export async function closeDatabase() {
  const close = state.close;
  state.db = null;
  state.init = null;
  state.close = null;
  if (close) await close();
}

export { schema };
