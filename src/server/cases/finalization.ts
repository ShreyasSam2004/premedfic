/**
 * Finalization verification.
 *
 * A finaled status or final-inspection date in an imported record is a claim,
 * not a closure. Such records wait in FINALIZATION_VERIFICATION, outside the
 * unresolved backlog and outside outreach, until the permit system of record
 * is checked:
 *   - confirmed      -> ALREADY_RESOLVED (finalized before PremedFix; not a PremedFix closure)
 *   - not confirmed  -> back to the backlog, with the imported final disregarded
 * Every check is stored as evidence (append-only) and audited.
 */
import { desc, eq } from "drizzle-orm";
import { checkTransition } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import { finalizationVerifications, permits, type FinalizationVerification, type Permit } from "../db/schema";
import { actorKind, requirePermission, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, TransitionError, ValidationError } from "../errors";
import { isoDate, now } from "../util";
import { simulatedPermitSystem } from "../disposition/service";
import { triageCase } from "../triage/service";
import { buildSnapshot, loadCaseForOrg, transitionCase } from "../workflow/service";

export async function latestFinalizationCheck(caseId: string): Promise<FinalizationVerification | null> {
  const [row] = await db()
    .select()
    .from(finalizationVerifications)
    .where(eq(finalizationVerifications.caseId, caseId))
    .orderBy(desc(finalizationVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Why verification is required (pure)
// ---------------------------------------------------------------------------

export interface FinalizationCheckItem {
  /** true = consistent, false = problem or missing, null = informational. */
  ok: boolean | null;
  label: string;
  detail: string;
}

export interface FinalizationReview {
  reportedBy: string;
  items: FinalizationCheckItem[];
  summary: string;
}

export function reviewReportedFinal(input: {
  permit: Pick<Permit, "permitNumber" | "sourceStatus" | "sourceStatusRaw" | "finalInspectionAt" | "issuedAt" | "expiresAt" | "sourceSystem">;
  source: { filename: string; importedAt: Date } | null;
  passedInspectionRecords: number;
  openDuplicates: number;
  latest: Pick<FinalizationVerification, "outcome" | "sourceReference" | "createdAt"> | null;
  today: string;
}): FinalizationReview {
  const { permit: p, source } = input;
  const items: FinalizationCheckItem[] = [];
  const raw = p.sourceStatusRaw ?? "(blank)";
  const where = [p.sourceSystem, source ? `file ${source.filename}, imported ${isoDate(source.importedAt)}` : null].filter(Boolean).join("; ");
  const reportedBy = `Imported record${where ? ` (${where})` : ""}`;

  items.push({
    ok: false,
    label: "Reported by an import, not confirmed by the permit system",
    detail: `The status "${raw}"${p.finalInspectionAt ? ` and final inspection date ${p.finalInspectionAt}` : ""} came from ${where || "an imported file"}. An export can be stale, partial, or keyed to the wrong record, so PremedFix does not treat it as proof of closure.`,
  });

  items.push(
    p.sourceStatus === "finaled"
      ? { ok: true, label: "Status reads as finaled", detail: `The source status "${raw}" normalizes to finaled.` }
      : { ok: false, label: "Status does not read as finaled", detail: `The source status is "${raw}", yet a final inspection is reported. The two fields disagree.` },
  );

  const f = p.finalInspectionAt;
  if (!f) {
    items.push({ ok: false, label: "No final inspection date", detail: "The export reports a finaled status without a final inspection date. The status alone does not show that a final inspection passed." });
  } else {
    const problems: string[] = [];
    if (p.issuedAt && f < p.issuedAt) problems.push(`it precedes the issue date (${p.issuedAt})`);
    if (f > input.today) problems.push("it is in the future");
    if (p.expiresAt && f > p.expiresAt) problems.push(`it falls after the permit expired (${p.expiresAt})`);
    items.push(
      problems.length
        ? { ok: false, label: "Final inspection date is inconsistent", detail: `Final inspection date ${f}: ${problems.join("; ")}.` }
        : {
            ok: true,
            label: "Final inspection date is consistent",
            detail: `Final inspection date ${f} falls ${p.issuedAt ? `after issuance (${p.issuedAt})` : "on a plausible date"}${p.expiresAt ? ` and before expiration (${p.expiresAt})` : ""}. Consistency is necessary, not sufficient.`,
          },
    );
  }

  items.push(
    input.passedInspectionRecords > 0
      ? { ok: true, label: "Inspection recorded", detail: `${input.passedInspectionRecords} passed final or site inspection(s) were recorded by an inspector in PremedFix.` }
      : { ok: false, label: "No recorded inspection", detail: "No inspector has recorded an inspection for this permit in PremedFix. The only inspection on file is the import's own claim." },
  );

  if (input.openDuplicates > 0) {
    items.push({ ok: false, label: "Possible duplicate record", detail: `${input.openDuplicates} possible duplicate(s) must be reconciled; the final may belong to the other record.` });
  }

  const l = input.latest;
  items.push(
    !l
      ? { ok: false, label: "No system-of-record confirmation", detail: "Nobody has yet checked this permit in the permit system of record." }
      : l.outcome === "confirmed"
        ? { ok: true, label: "Confirmed by the system of record", detail: `Confirmed on ${isoDate(l.createdAt)} (reference ${l.sourceReference}).` }
        : { ok: false, label: "Not confirmed by the system of record", detail: `Checked on ${isoDate(l.createdAt)} (reference ${l.sourceReference}): the permit system does not show it finaled.` },
  );

  const summary = !l
    ? "Verification is still required: the only evidence of finalization is the imported record. Check the permit in the system of record. If it confirms the final, the record becomes Already resolved; if not, it returns to the backlog."
    : l.outcome === "confirmed"
      ? "Finalized before PremedFix. The system of record confirmed the final; PremedFix did not close this permit."
      : "The system of record did not confirm the reported final, so the permit is handled as unresolved.";
  return { reportedBy, items, summary };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function recordCheck(
  ctx: ActorContext,
  caseId: string,
  check: {
    outcome: "confirmed" | "not_confirmed";
    method: "system_of_record" | "manual";
    sourceReference: string;
    sourceStatus: string | null;
    sourceFinalAt: string | null;
    note: string;
    response?: Record<string, unknown>;
  },
) {
  const user = requirePermission(ctx, "cases:reconcile");
  const c = await loadCaseForOrg(ctx.orgId, caseId, { forUpdate: true });
  if (c.status !== "FINALIZATION_VERIFICATION") throw new ConflictError("This case is not awaiting finalization verification");
  const [permit] = await db().select().from(permits).where(eq(permits.id, c.permitId));
  // Check the outcome's transition before writing evidence that cannot be removed.
  const transition = check.outcome === "confirmed" ? "confirm_prior_finalization" : "finalization_not_confirmed";
  const snap = { ...(await buildSnapshot(c)), finalizationVerification: check.outcome };
  const reason = `${check.method === "system_of_record" ? "Permit system of record" : `Manual check by ${user.name}`}: ${
    check.outcome === "confirmed" ? `final confirmed${check.sourceFinalAt ? ` (final inspection ${check.sourceFinalAt})` : ""}` : `not finaled${check.sourceStatus ? ` (status ${check.sourceStatus})` : ""}`
  }; reference ${check.sourceReference}. ${check.note}`;
  const allowed = checkTransition(transition, c.status, actorKind(ctx.actor), snap, reason);
  if (!allowed.allowed) throw new TransitionError("Cannot record this verification", allowed.problems);

  const [row] = await db()
    .insert(finalizationVerifications)
    .values({
      orgId: ctx.orgId,
      caseId: c.id,
      permitId: permit.id,
      outcome: check.outcome,
      method: check.method,
      reportedStatus: permit.sourceStatusRaw,
      reportedFinalAt: permit.finalInspectionAt,
      sourceReference: check.sourceReference,
      sourceStatus: check.sourceStatus,
      sourceFinalAt: check.sourceFinalAt,
      note: check.note,
      response: check.response ?? {},
      actorType: "user",
      actorUserId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      createdAt: now(),
    })
    .returning();
  await recordAudit(ctx, {
    action: check.outcome === "confirmed" ? "finalization.confirmed" : "finalization.not_confirmed",
    entityType: "finalization_verification",
    entityId: row.id,
    caseId: c.id,
    summary:
      check.outcome === "confirmed"
        ? `Existing final confirmed against the system of record (reference ${check.sourceReference}); recorded as already resolved, not a PremedFix closure`
        : `Reported final not confirmed by the system of record (reference ${check.sourceReference}); returned to the unresolved backlog`,
    metadata: { method: check.method, sourceReference: check.sourceReference, sourceStatus: check.sourceStatus, sourceFinalAt: check.sourceFinalAt },
  });
  await transitionCase(ctx, { caseId: c.id, transition, reason, metadata: { finalizationVerificationId: row.id } });
  // A rejected report re-enters triage with the imported final disregarded.
  if (check.outcome === "not_confirmed") await triageCase(ctx, c.id);
  return row;
}

/** Looks the permit up in the system of record and records what it shows. */
export async function checkFinalizationWithSystemOfRecord(ctx: ActorContext, caseId: string) {
  requirePermission(ctx, "cases:reconcile");
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    const [permit] = await db().select().from(permits).where(eq(permits.id, c.permitId));
    const r = await simulatedPermitSystem.lookupPermit(permit);
    return recordCheck(ctx, caseId, {
      outcome: r.finaled ? "confirmed" : "not_confirmed",
      method: "system_of_record",
      sourceReference: r.reference,
      sourceStatus: r.status,
      sourceFinalAt: r.finalInspectionAt,
      note: r.note,
      response: { adapter: simulatedPermitSystem.id, live: simulatedPermitSystem.live, ...r },
    });
  });
}

/** A documented manual check, for permit systems without an integration. */
export async function recordManualFinalizationCheck(
  ctx: ActorContext,
  caseId: string,
  input: { outcome: "confirmed" | "not_confirmed"; sourceReference: string; sourceFinalAt?: string | null; note: string },
) {
  if (input.sourceReference.trim().length < 3) throw new ValidationError("Enter the record reference shown in the permit system of record");
  if (input.note.trim().length < 10) throw new ValidationError("Describe what you checked (at least 10 characters)");
  const finalAt = input.sourceFinalAt?.trim() || null;
  if (finalAt && !/^\d{4}-\d{2}-\d{2}$/.test(finalAt)) throw new ValidationError("Final inspection date must be YYYY-MM-DD");
  if (input.outcome === "confirmed" && !finalAt) throw new ValidationError("Enter the final inspection date the permit system shows");
  return transaction(() =>
    recordCheck(ctx, caseId, {
      outcome: input.outcome,
      method: "manual",
      sourceReference: input.sourceReference.trim(),
      sourceStatus: input.outcome === "confirmed" ? "Final" : null,
      sourceFinalAt: finalAt,
      note: input.note.trim(),
    }),
  );
}

/** Moves a case that is already in progress to verification once a source reports a final. */
export async function routeToFinalizationVerification(ctx: ActorContext, caseId: string, reason: string) {
  requirePermission(ctx, "cases:reconcile");
  return transitionCase(ctx, { caseId, transition: "route_finalization_verification", reason });
}
