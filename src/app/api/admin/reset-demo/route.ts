/**
 * Wipes and re-seeds a hosted demo database, next to the database instead of
 * over a long network path. Disabled unless DEMO_RESET_TOKEN is set, demo mode
 * is on, and a PostgreSQL server is configured; otherwise it does not exist.
 *   curl -X POST -H "Authorization: Bearer $DEMO_RESET_TOKEN" https://<host>/api/admin/reset-demo
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { initDatabase, MIGRATIONS_FOLDER } from "@/server/db/client";
import { seedDemo } from "@/server/seed/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function POST(req: Request) {
  const token = process.env.DEMO_RESET_TOKEN;
  if (!token || token.length < 32 || process.env.DEMO_MODE !== "true" || !process.env.DATABASE_URL) return notFound();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const digest = (v: string) => crypto.createHash("sha256").update(v).digest();
  if (!crypto.timingSafeEqual(digest(given), digest(token))) return notFound();

  const started = Date.now();
  const database = await initDatabase();
  await database.execute(sql.raw("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;"));
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(database as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  await seedDemo({ writeDemoFiles: false });
  return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - started) / 1000) });
}
