/**
 * Staff authentication: password login and server-side sessions.
 * Session tokens are random 256-bit values; only their SHA-256 is stored.
 * Role is re-read from the membership on every request so revocation is immediate.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import type { StaffRole } from "@/domain/roles";
import { db } from "../db/client";
import { memberships, organizations, sessions, users } from "../db/schema";
import { now, randomToken, sha256 } from "../util";
import { DUMMY_HASH, verifyPassword } from "./password";
import type { ActorContext } from "./context";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

export class LoginThrottledError extends Error {}

export async function authenticate(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const f = failures.get(email);
  if (f && Date.now() - f.first < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES) {
    throw new LoginThrottledError("Too many failed attempts. Try again later.");
  }
  const [user] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.disabledAt) {
    const entry = f && Date.now() - f.first < FAILURE_WINDOW_MS ? f : { count: 0, first: Date.now() };
    entry.count += 1;
    failures.set(email, entry);
    return null;
  }
  failures.delete(email);
  const [membership] = await db()
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.active, true)))
    .limit(1);
  if (!membership) return null;
  return { user, membership };
}

export async function createSession(userId: string, orgId: string) {
  const token = randomToken(32);
  const created = now();
  await db()
    .insert(sessions)
    .values({ tokenHash: sha256(token), userId, orgId, createdAt: created, expiresAt: new Date(created.getTime() + SESSION_TTL_MS) });
  return token;
}

export interface StaffSession {
  ctx: ActorContext;
  user: { id: string; name: string; email: string; title: string | null; role: StaffRole; specialties: string[] };
  org: { id: string; name: string };
}

export async function resolveSession(token: string | undefined | null): Promise<StaffSession | null> {
  if (!token) return null;
  const [row] = await db()
    .select({ session: sessions, user: users, membership: memberships, org: organizations })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)))
    .innerJoin(organizations, eq(organizations.id, sessions.orgId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.disabledAt || !row.membership.active) return null;
  const { user, membership, org } = row;
  return {
    ctx: {
      orgId: org.id,
      actor: { type: "user", userId: user.id, role: membership.role, name: user.name, title: user.title, specialties: membership.specialties },
    },
    user: { id: user.id, name: user.name, email: user.email, title: user.title, role: membership.role, specialties: membership.specialties },
    org: { id: org.id, name: org.name },
  };
}

export async function revokeSession(token: string) {
  await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}
