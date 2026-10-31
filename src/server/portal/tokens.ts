/**
 * Portal access tokens and sessions.
 *
 * - Access links carry a random 256-bit token; only its SHA-256 is stored.
 * - A link alone reveals nothing: the holder must confirm a one-time code
 *   delivered to the contact channel staff verified against property records.
 * - After verification the browser holds a short-lived HMAC-signed session
 *   bound to the grant, and the token leaves the URL.
 */
import { db } from "../db/client";
import { portalGrants } from "../db/schema";
import { addDays, hmac, now, randomToken, safeEqual, sha256 } from "../util";

export const GRANT_TTL_DAYS = 60;
export const PORTAL_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const PORTAL_COOKIE = "pf_portal";

export function portalUrlFor(token: string) {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/portal/${token}`;
}

export async function createPortalGrant(input: { orgId: string; caseId: string; contactId: string; communicationId: string | null }) {
  const token = randomToken(32);
  const [grant] = await db()
    .insert(portalGrants)
    .values({
      orgId: input.orgId,
      caseId: input.caseId,
      contactId: input.contactId,
      communicationId: input.communicationId,
      tokenHash: sha256(token),
      expiresAt: addDays(now(), GRANT_TTL_DAYS),
      createdAt: now(),
    })
    .returning();
  return { token, grant };
}

export function codeHash(grantId: string, code: string) {
  return hmac(`portal-code:${grantId}:${code}`);
}

export function signPortalSession(grantId: string, issuedAt = Date.now()) {
  const exp = issuedAt + PORTAL_SESSION_TTL_MS;
  const payload = `${grantId}.${exp}`;
  return `${payload}.${hmac(`portal-session:${payload}`)}`;
}

export function readPortalSession(value: string | undefined | null): { grantId: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [grantId, exp, sig] = parts;
  if (!safeEqual(sig, hmac(`portal-session:${grantId}.${exp}`))) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  return { grantId };
}
