/**
 * Workflow service: the only code path that changes `cases.status`.
 */
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  availableTransitions,
  checkTransition,
  STATE_META,
  TRANSITIONS,
  type CaseState,
  type DeterminationType,
  type GuardSnapshot,
  type TransitionId,
} from "@/domain/workflow";
import type { StaffRole } from "@/domain/roles";
import type { TriageClassification } from "@/domain/triage";
import { db, transaction } from "../db/client";
import {
  cases,
  communications,
  contacts,
  dispositionSubmissions,
  duplicateCandidates,
  evidenceFindings,
  evidenceItems,
  evidenceRequirements,
  inspectionRecords,
  permits,
  portalGrants,
  properties,
  reviewDecisions,
  ruleSets,
  triageResults,
  workflowTransitions,
  finalizationVerifications,
} from "../db/schema";
import { actorIdentity, actorKind, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, NotFoundError, TransitionError } from "../errors";
import { now, randomToken } from "../util";
import type { RuleSetConfig } from "../rules/config";

export async function loadCaseForOrg(orgId: string, caseId: string, opts: { forUpdate?: boolean } = {}) {
  const q = db()
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.orgId, orgId)));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("Case");
  return row;
}

/** Whether a contact may receive outreach: verified against property records, with a usable channel. */
export function isContactable(c: { verificationStatus: string; email: string | null; phone: string | null; optOutEmail: boolean; optOutSms: boolean }, propertyHasAddress: boolean) {
  if (c.verificationStatus !== "owner_of_record_verified") return false;
  return Boolean((c.email && !c.optOutEmail) || (c.phone && !c.optOutSms) || propertyHasAddress);
}

export interface SnapshotOptions {
  proposedDetermination?: DeterminationType | null;
  submissionId?: string | null;
}

export async function buildSnapshot(caseRow: typeof cases.$inferSelect, opts: SnapshotOptions = {}): Promise<GuardSnapshot> {
  const [permit] = await db().select().from(permits).where(eq(permits.id, caseRow.permitId));
  const [triage] = caseRow.currentTriageId ? await db().select().from(triageResults).where(eq(triageResults.id, caseRow.currentTriageId)) : [];

  let approvalAuthority: StaffRole[] = ["official"];
  if (triage?.ruleSetId && permit.category) {
    const [rs] = await db().select({ config: ruleSets.config }).from(ruleSets).where(eq(ruleSets.id, triage.ruleSetId));
    const rule = (rs?.config as RuleSetConfig | undefined)?.categories?.[permit.category as keyof RuleSetConfig["categories"]];
    if (rule) approvalAuthority = rule.approvalAuthority;
  }

  const dupRows = await db()
    .select()
    .from(duplicateCandidates)
    .where(or(eq(duplicateCandidates.permitId, permit.id), eq(duplicateCandidates.candidatePermitId, permit.id)));
  const openDuplicateCandidates = dupRows.filter((d) => d.status === "open").length;
  const confirmed = dupRows.find((d) => d.status === "confirmed" && d.primaryPermitId && d.primaryPermitId !== permit.id);

  const [prop] = permit.propertyId ? await db().select().from(properties).where(eq(properties.id, permit.propertyId)) : [];
  const contactRows = permit.propertyId ? await db().select().from(contacts).where(eq(contacts.propertyId, permit.propertyId)) : [];
  const contactable = contactRows.some((c) => isContactable(c, Boolean(prop?.addressLine)));

  const comms = await db()
    .select({ status: communications.status, purpose: communications.purpose })
    .from(communications)
    .where(and(eq(communications.caseId, caseRow.id), inArray(communications.purpose, ["initial_notice", "follow_up"])));

  const [grant] = await db()
    .select({ id: portalGrants.id })
    .from(portalGrants)
    .where(and(eq(portalGrants.caseId, caseRow.id), isNotNull(portalGrants.verifiedAt), isNull(portalGrants.revokedAt)))
    .limit(1);

  const evidenceFilter = opts.submissionId
    ? and(eq(evidenceItems.caseId, caseRow.id), eq(evidenceItems.submissionId, opts.submissionId), eq(evidenceItems.processingStatus, "processed"))
    : and(eq(evidenceItems.caseId, caseRow.id), eq(evidenceItems.processingStatus, "processed"));
  const [{ count: submittedEvidenceCount }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(evidenceItems)
    .where(evidenceFilter);

  const reqs = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, caseRow.id));
  const requirementsOutstanding = reqs.filter((r) => r.required && r.status !== "accepted" && r.status !== "waived").map((r) => r.label);

  const [{ count: openConflicts }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(evidenceFindings)
    .where(and(eq(evidenceFindings.caseId, caseRow.id), eq(evidenceFindings.kind, "conflict"), eq(evidenceFindings.status, "open")));

  const decisions = await db()
    .select({ decisionType: reviewDecisions.decisionType, determination: reviewDecisions.determination })
    .from(reviewDecisions)
    .where(eq(reviewDecisions.caseId, caseRow.id))
    .orderBy(desc(reviewDecisions.createdAt));
  const specialistAssessmentRecorded = decisions.some((d) => d.decisionType === "specialist_assessment");
  const recordedDetermination = (decisions.find((d) => d.decisionType === "official_determination")?.determination ?? null) as DeterminationType | null;

  const inspections = await db().select().from(inspectionRecords).where(eq(inspectionRecords.permitId, permit.id));
  // Only inspections actually recorded count; an imported inspection row is the import's own claim.
  const passedInspectionRecorded = inspections.some((i) => i.source === "recorded" && i.result === "passed" && (i.inspectionType === "final" || i.inspectionType === "site_assessment"));

  const [lastRequired] = await db()
    .select({ createdAt: workflowTransitions.createdAt })
    .from(workflowTransitions)
    .where(and(eq(workflowTransitions.caseId, caseRow.id), eq(workflowTransitions.toState, "INSPECTION_REQUIRED")))
    .orderBy(desc(workflowTransitions.createdAt))
    .limit(1);
  const inspectionRecordedSinceRequired = lastRequired
    ? inspections.some((i) => i.source === "recorded" && i.createdAt.getTime() >= lastRequired.createdAt.getTime())
    : false;

  const [pending] = await db()
    .select({ id: dispositionSubmissions.id })
    .from(dispositionSubmissions)
    .where(and(eq(dispositionSubmissions.caseId, caseRow.id), eq(dispositionSubmissions.status, "submitted")))
    .limit(1);

  const [finalCheck] = await db()
    .select({ outcome: finalizationVerifications.outcome })
    .from(finalizationVerifications)
    .where(eq(finalizationVerifications.caseId, caseRow.id))
    .orderBy(desc(finalizationVerifications.createdAt))
    .limit(1);

  return {
    classification: (triage?.classification ?? null) as TriageClassification | null,
    specialistRequired: triage?.specialistRequired ?? false,
    siteInspectionRequired: triage?.siteInspectionRequired ?? false,
    approvalAuthority,
    agedPermitEligible: triage?.agedPermitEligible ?? false,
    openDuplicateCandidates,
    confirmedDuplicateOf: confirmed?.primaryPermitId ?? null,
    missingEssentialFields: permit.missingFields,
    pendingDraftNotice: comms.some((c) => c.status === "draft"),
    approvedNoticeDispatched: comms.some((c) => c.status === "sent_simulated"),
    contactable,
    homeownerVerified: Boolean(grant),
    submittedEvidenceCount,
    requirementsOutstanding,
    openConflicts,
    specialistAssessmentRecorded,
    passedInspectionRecorded,
    inspectionRecordedSinceRequired,
    proposedDetermination: opts.proposedDetermination ?? null,
    recordedDetermination,
    pendingSubmission: Boolean(pending),
    finalizationVerification: finalCheck?.outcome ?? null,
  };
}

export interface TransitionRequest extends SnapshotOptions {
  caseId: string;
  transition: TransitionId;
  reason?: string | null;
  idempotencyKey?: string | null;
  expectedVersion?: number | null;
  metadata?: Record<string, unknown>;
}

export async function transitionCase(ctx: ActorContext, req: TransitionRequest) {
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, req.caseId, { forUpdate: true });
    if (ctx.actor.type === "homeowner" && ctx.actor.caseId !== c.id) throw new NotFoundError("Case");

    if (req.idempotencyKey) {
      const [prior] = await db()
        .select()
        .from(workflowTransitions)
        .where(and(eq(workflowTransitions.caseId, c.id), eq(workflowTransitions.idempotencyKey, req.idempotencyKey)));
      if (prior) return { case: c, transition: prior, alreadyApplied: true };
    }
    if (req.expectedVersion != null && req.expectedVersion !== c.version) {
      throw new ConflictError("This case changed since you loaded it. Reload to see the latest state.");
    }

    const def = TRANSITIONS[req.transition];
    const snapshot = await buildSnapshot(c, req);
    const check = checkTransition(req.transition, c.status, actorKind(ctx.actor), snapshot, req.reason);
    if (!check.allowed) throw new TransitionError(`Cannot ${def.label.toLowerCase()}`, check.problems);

    const at = now();
    const toState = def.to;
    const closes = !STATE_META[toState].open;
    const [updated] = await db()
      .update(cases)
      .set({
        status: toState,
        version: sql`${cases.version} + 1`,
        lastTransitionAt: at,
        updatedAt: at,
        closedAt: closes ? at : null,
      })
      .where(and(eq(cases.id, c.id), eq(cases.version, c.version)))
      .returning();
    if (!updated) throw new ConflictError("This case changed concurrently. Reload and try again.");

    const who = actorIdentity(ctx.actor);
    const [row] = await db()
      .insert(workflowTransitions)
      .values({
        orgId: ctx.orgId,
        caseId: c.id,
        transition: def.id,
        fromState: c.status,
        toState,
        ...who,
        reason: req.reason?.trim() || null,
        idempotencyKey: req.idempotencyKey ?? `auto:${randomToken(12)}`,
        metadata: req.metadata ?? null,
        createdAt: at,
      })
      .returning();

    await recordAudit(ctx, {
      action: "case.transition",
      entityType: "case",
      entityId: c.id,
      caseId: c.id,
      summary: `${def.label}: ${STATE_META[c.status].label} → ${STATE_META[toState].label}`,
      metadata: { transition: def.id, from: c.status, to: toState, reason: req.reason ?? null, ...(req.metadata ?? {}) },
    });
    return { case: updated, transition: row, alreadyApplied: false };
  });
}

export interface ActionAvailability {
  id: TransitionId;
  label: string;
  to: CaseState;
  requiresReason: boolean;
  problems: string[];
}

/** Transitions the actor could take from the current state, with any unmet preconditions. */
export async function getAvailableTransitions(ctx: ActorContext, caseId: string): Promise<ActionAvailability[]> {
  const c = await loadCaseForOrg(ctx.orgId, caseId);
  const kind = actorKind(ctx.actor);
  const snapshot = await buildSnapshot(c);
  return availableTransitions(c.status, kind).map((t) => {
    const check = checkTransition(t.id, c.status, kind, snapshot, t.requiresReason ? "placeholder-reason" : null);
    return { id: t.id, label: t.label, to: t.to, requiresReason: t.requiresReason, problems: check.problems };
  });
}

export async function listTransitions(orgId: string, caseId: string) {
  return db()
    .select()
    .from(workflowTransitions)
    .where(and(eq(workflowTransitions.orgId, orgId), eq(workflowTransitions.caseId, caseId)))
    .orderBy(desc(workflowTransitions.createdAt));
}

