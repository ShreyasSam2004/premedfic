import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Clock. Services read time through `now()` so the seed can replay history
// through the real services with realistic timestamps.
// ---------------------------------------------------------------------------

const clockStorage = new AsyncLocalStorage<() => Date>();

export function now(): Date {
  const fn = clockStorage.getStore();
  return fn ? fn() : new Date();
}

export function withClock<T>(at: Date, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const base = at.getTime();
  // Advance with wall time so events inside one call keep their order.
  return clockStorage.run(() => new Date(base + (Date.now() - start)), fn);
}

/** Calendar date (YYYY-MM-DD) for an instant, in UTC. */
export function isoDate(d: Date = now()): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days from date string `a` to date string/instant `b` (b - a). */
export function daysBetween(a: string, b: string | Date): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = typeof b === "string" ? Date.parse(`${b}T00:00:00Z`) : Date.parse(`${isoDate(b)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Hashing and tokens
// ---------------------------------------------------------------------------

export function sha256(input: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomCode(digits = 6): string {
  const n = crypto.randomInt(0, 10 ** digits);
  return n.toString().padStart(digits, "0");
}

export function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be set (>= 16 chars) in production");
    return "premedfix-development-secret-not-for-production";
  }
  return secret;
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", appSecret()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Deterministic JSON with sorted keys, used for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// PII masking for logs, audit metadata and recipient display
// ---------------------------------------------------------------------------

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
}

/** Logger that never prints record contents: callers pass identifiers and counts only. */
export const log = {
  info(event: string, meta: Record<string, string | number | boolean | null> = {}) {
    if (process.env.NODE_ENV !== "test") console.info(`[premedfix] ${event}`, meta);
  },
  error(event: string, err: unknown, meta: Record<string, string | number | boolean | null> = {}) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[premedfix] ${event}`, { ...meta, error: message.slice(0, 300) });
  },
};
