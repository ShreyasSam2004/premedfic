/**
 * Object storage adapter. The local-filesystem implementation is the default;
 * STORAGE_DRIVER=database keeps bytes in PostgreSQL for hosts without a
 * durable disk. An S3/GCS/Azure adapter implements the same interface. Files
 * are never served directly: downloads go through authorized route handlers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { storedObjects } from "./db/schema";
import { now } from "./util";

export interface StorageAdapter {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,400}$/;

export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Invalid storage key");
}

class LocalFsStorage implements StorageAdapter {
  // Runtime-configured directory; excluded from build-time file tracing.
  private root = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || ".data/storage");

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer | Uint8Array) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "w" });
  }

  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }

  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** For hosts without a durable local disk (e.g. serverless): bytes live in PostgreSQL. */
class DatabaseStorage implements StorageAdapter {
  async put(key: string, data: Buffer | Uint8Array) {
    assertSafeKey(key);
    const bytes = Buffer.from(data);
    await db()
      .insert(storedObjects)
      .values({ key, data: bytes, size: bytes.length, createdAt: now() })
      .onConflictDoUpdate({ target: storedObjects.key, set: { data: bytes, size: bytes.length } });
  }

  async get(key: string) {
    assertSafeKey(key);
    const [row] = await db().select({ data: storedObjects.data }).from(storedObjects).where(eq(storedObjects.key, key));
    if (!row) throw new Error("Stored object not found");
    return row.data;
  }

  async exists(key: string) {
    assertSafeKey(key);
    const [row] = await db().select({ key: storedObjects.key }).from(storedObjects).where(eq(storedObjects.key, key));
    return Boolean(row);
  }
}

let instance: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  instance ??= process.env.STORAGE_DRIVER === "database" ? new DatabaseStorage() : new LocalFsStorage();
  return instance;
}
