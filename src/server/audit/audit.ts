/**
 * Append-only, hash-chained audit trail.
 *
 * Each event's hash covers its content plus the previous event's hash for the
 * same organization, so any later modification or deletion is detectable by
 * `verifyAuditChain`. The table itself rejects UPDATE/DELETE via trigger.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, transaction } from "../db/client";
import { auditEvents } from "../db/schema";
import { actorIdentity, type ActorContext } from "../auth/context";
import { canonicalJson, now, sha256 } from "../util";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  caseId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

function eventHash(prevHash: string, body: Record<string, unknown>) {
  return sha256(prevHash + canonicalJson(body));
}

export async function recordAudit(ctx: ActorContext, input: AuditInput) {
  return transaction(async () => {
    // Serialize chain appends per organization.
    await db().execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.orgId}))`);
    const [last] = await db()
      .select({ hash: auditEvents.hash })
      .from(auditEvents)
      .where(eq(auditEvents.orgId, ctx.orgId))
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    const who = actorIdentity(ctx.actor);
    const occurredAt = now();
    const body = {
      orgId: ctx.orgId,
      occurredAt: occurredAt.toISOString(),
      ...who,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      caseId: input.caseId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
    };
    const hash = eventHash(prevHash, body);
    const [row] = await db()
      .insert(auditEvents)
      .values({
        orgId: ctx.orgId,
        occurredAt,
        actorType: who.actorType,
        actorId: who.actorId,
        actorName: who.actorName,
        actorRole: who.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        caseId: input.caseId ?? null,
        summary: input.summary,
        metadata: input.metadata ?? {},
        prevHash,
        hash,
      })
      .returning();
    return row;
  });
}

export async function verifyAuditChain(orgId: string): Promise<{ valid: boolean; count: number; brokenAtSeq: number | null; headHash: string }> {
  const rows = await db().select().from(auditEvents).where(eq(auditEvents.orgId, orgId)).orderBy(asc(auditEvents.seq));
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const body = {
      orgId: r.orgId,
      occurredAt: r.occurredAt.toISOString(),
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorName,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      caseId: r.caseId,
      summary: r.summary,
      metadata: r.metadata,
    };
    if (r.prevHash !== prev || eventHash(prev, body) !== r.hash) {
      return { valid: false, count: rows.length, brokenAtSeq: r.seq, headHash: prev };
    }
    prev = r.hash;
  }
  return { valid: true, count: rows.length, brokenAtSeq: null, headHash: prev };
}

export async function listAuditEvents(orgId: string, opts: { caseId?: string; limit?: number } = {}) {
  const where = opts.caseId ? and(eq(auditEvents.orgId, orgId), eq(auditEvents.caseId, opts.caseId)) : eq(auditEvents.orgId, orgId);
  return db()
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.seq))
    .limit(opts.limit ?? 200);
}
