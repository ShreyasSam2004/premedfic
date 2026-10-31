import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "../support/db";

let storage: typeof import("@/server/storage").storage;

beforeAll(async () => {
  await setupTestDatabase();
  process.env.STORAGE_DRIVER = "database";
  ({ storage } = await import("@/server/storage"));
});
afterAll(async () => {
  delete process.env.STORAGE_DRIVER;
  await teardownTestDatabase();
});

describe("database storage driver", () => {
  it("stores, overwrites, and reads back bytes exactly", async () => {
    const s = storage();
    const key = "evidence/org/case/abc123";
    expect(await s.exists(key)).toBe(false);
    await s.put(key, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
    expect(await s.exists(key)).toBe(true);
    expect([...(await s.get(key))]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await s.put(key, Buffer.from("replaced"));
    expect((await s.get(key)).toString()).toBe("replaced");
  });

  it("rejects unsafe keys and reports missing objects", async () => {
    await expect(storage().put("../escape", Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    await expect(storage().get("evidence/none")).rejects.toThrow("Stored object not found");
  });
});
