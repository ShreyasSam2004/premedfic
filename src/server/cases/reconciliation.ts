/**
 * Data reconciliation: duplicate confirmation/dismissal, staff correction of
 * missing fields from the system of record. (Reported finals go to finalization verification.)
 * Corrections are attributed and noted on the permit; raw source rows are never edited.
 */
import { and, eq, or } from "drizzle-orm";
import { PERMIT_CATEGORIES } from "@/domain/permits";
import { checkTransition } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import { cases, duplicateCandidates, permits, reviewDecisions } from "../db/schema";
import { actorKind, requirePermission, type ActorContext, type UserActor } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { NotFoundError, ValidationError } from "../errors";
import { now } from "../util";
import { buildSnapshot, loadCaseForOrg, transitionCase } from "../workflow/service";
import { triageCase } from "../triage/service";

async function caseForPermit(orgId: string, permitId: string) {
  const [c] = await db()
    .select()
    .from(cases)
    .where(and(eq(cases.orgId, orgId), eq(cases.permitId, permitId)));
  if (!c) throw new NotFoundError("Case");
  return c;
}

async function note(ctx: ActorContext, user: UserActor, caseId: string, summary: string, reason: string) {
  await db().insert(reviewDecisions).values({
    orgId: ctx.orgId,
    caseId,
    decisionType: "reconciliation",
    summary,
    reason,
    actorUserId: user.userId,
    actorRole: user.role,
    actorName: user.name,
    createdAt: now(),
  });
}

/** Re-triage, then resolve reconciliation automatically only if every guard now passes. */
async function retriageAndTryResolve(ctx: ActorContext, caseId: string, reason: string) {
  await triageCase(ctx, caseId);
  const c = await loadCaseForOrg(ctx.orgId, caseId);
  if (c.status !== "NEEDS_DATA_RECONCILIATION") return;
  const snap = await buildSnapshot(c);
  if (checkTransition("resolve_reconciliation", c.status, actorKind(ctx.actor), snap, reason).allowed) {
    await transitionCase(ctx, { caseId, transition: "resolve_reconciliation", reason });
    await triageCase(ctx, caseId);
  }
}

export async function confirmDuplicate(ctx: ActorContext, candidateId: string, input: { primaryPermitId: string; note: string }) {
  const user = requirePermission(ctx, "cases:reconcile");
  if (input.note.trim().length < 10) throw new ValidationError("Explain how the duplicate was confirmed (at least 10 characters)");
  return transaction(async () => {
    const [cand] = await db()
      .select()
      .from(duplicateCandidates)
      .where(and(eq(duplicateCandidates.id, candidateId), eq(duplicateCandidates.orgId, ctx.orgId), eq(duplicateCandidates.status, "open")));
    if (!cand) throw new NotFoundError("Open duplicate candidate");
    if (input.primaryPermitId !== cand.permitId && input.primaryPermitId !== cand.candidatePermitId) throw new ValidationError("Primary must be one of the two records");
    const secondaryId = input.primaryPermitId === cand.permitId ? cand.candidatePermitId : cand.permitId;
    await db()
      .update(duplicateCandidates)
      .set({ status: "confirmed", primaryPermitId: input.primaryPermitId, resolvedBy: user.userId, resolvedAt: now(), resolutionNote: input.note.trim() })
      .where(eq(duplicateCandidates.id, cand.id));
    await db().update(permits).set({ duplicateOfPermitId: input.primaryPermitId, updatedAt: now() }).where(eq(permits.id, secondaryId));

    const secondaryCase = await caseForPermit(ctx.orgId, secondaryId);
    const primaryCase = await caseForPermit(ctx.orgId, input.primaryPermitId);
    // Other open candidates involving the secondary record no longer apply.
    await db()
      .update(duplicateCandidates)
      .set({ status: "dismissed", resolvedBy: user.userId, resolvedAt: now(), resolutionNote: "Superseded: record merged into another permit" })
      .where(
        and(
          eq(duplicateCandidates.status, "open"),
          or(eq(duplicateCandidates.permitId, secondaryId), eq(duplicateCandidates.candidatePermitId, secondaryId)),
        ),
      );
    await note(ctx, user, secondaryCase.id, "Confirmed duplicate; merged into primary record", input.note.trim());
    await note(ctx, user, primaryCase.id, "Duplicate record merged into this case", input.note.trim());
    if (secondaryCase.status === "NEEDS_DATA_RECONCILIATION") {
      await transitionCase(ctx, { caseId: secondaryCase.id, transition: "merge_duplicate", reason: input.note.trim(), metadata: { primaryPermitId: input.primaryPermitId } });
    }
    await recordAudit(ctx, {
      action: "reconciliation.duplicate_confirmed",
      entityType: "duplicate_candidate",
      entityId: cand.id,
      caseId: primaryCase.id,
      summary: `Duplicate confirmed by ${user.name}; secondary record merged into primary`,
      metadata: { primaryPermitId: input.primaryPermitId, secondaryPermitId: secondaryId },
    });
    await retriageAndTryResolve(ctx, primaryCase.id, `Duplicate reconciled: ${input.note.trim()}`);
  });
}

export async function dismissDuplicate(ctx: ActorContext, candidateId: string, input: { note: string }) {
  const user = requirePermission(ctx, "cases:reconcile");
  if (input.note.trim().length < 10) throw new ValidationError("Explain why these are distinct records (at least 10 characters)");
  return transaction(async () => {
    const [cand] = await db()
      .update(duplicateCandidates)
      .set({ status: "dismissed", resolvedBy: user.userId, resolvedAt: now(), resolutionNote: input.note.trim() })
      .where(and(eq(duplicateCandidates.id, candidateId), eq(duplicateCandidates.orgId, ctx.orgId), eq(duplicateCandidates.status, "open")))
      .returning();
    if (!cand) throw new NotFoundError("Open duplicate candidate");
    for (const pid of [cand.permitId, cand.candidatePermitId]) {
      const c = await caseForPermit(ctx.orgId, pid);
      await note(ctx, user, c.id, "Possible duplicate dismissed: records are distinct", input.note.trim());
      await recordAudit(ctx, { action: "reconciliation.duplicate_dismissed", entityType: "duplicate_candidate", entityId: cand.id, caseId: c.id, summary: `Possible duplicate dismissed by ${user.name}` });
      await retriageAndTryResolve(ctx, c.id, `Duplicate dismissed: ${input.note.trim()}`);
    }
  });
}

const CORRECTABLE = ["category", "issuedAt", "expiresAt", "workDescription"] as const;
type Correctable = (typeof CORRECTABLE)[number];

export async function correctPermitField(ctx: ActorContext, caseId: string, input: { field: string; value: string; sourceNote: string }) {
  const user = requirePermission(ctx, "cases:reconcile");
  if (!CORRECTABLE.includes(input.field as Correctable)) throw new ValidationError("This field cannot be corrected here");
  if (input.sourceNote.trim().length < 5) throw new ValidationError("Cite where the value came from (e.g. the system-of-record screen)");
  const field = input.field as Correctable;
  const value = input.value.trim();
  if ((field === "issuedAt" || field === "expiresAt") && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError("Date must be YYYY-MM-DD");
  if (field === "category" && !PERMIT_CATEGORIES.includes(value as (typeof PERMIT_CATEGORIES)[number])) throw new ValidationError("Unknown category");
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    const [p] = await db().select().from(permits).where(eq(permits.id, c.permitId));
    const before = p[field];
    const missing = p.missingFields.filter((m) => m !== field);
    await db()
      .update(permits)
      .set({
        [field]: value,
        missingFields: missing,
        fieldWarnings: [...p.fieldWarnings, { field, message: `Corrected by ${user.name} from: ${input.sourceNote.trim()}`, raw: before == null ? null : String(before) }],
        updatedAt: now(),
      })
      .where(eq(permits.id, p.id));
    await note(ctx, user, c.id, `Corrected ${field}: ${before ?? "(blank)"} → ${value}`, input.sourceNote.trim());
    await recordAudit(ctx, {
      action: "reconciliation.field_corrected",
      entityType: "permit",
      entityId: p.id,
      caseId: c.id,
      summary: `${field} corrected by ${user.name}`,
      metadata: { field, before: before ?? null, after: value, source: input.sourceNote.trim() },
    });
    await retriageAndTryResolve(ctx, c.id, `Missing data reconciled from system of record: ${input.sourceNote.trim()}`);
  });
}
