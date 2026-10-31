/**
 * Inspector / reviewer actions. Each action is an explicit, attributable human
 * decision recorded in review_decisions. The system's suggested next action is
 * advisory; choosing a different action requires a recorded reason.
 */
import { and, eq } from "drizzle-orm";
import type { TransitionId } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import { caseAssignments, cases, evidenceFindings, evidenceItems, evidenceRequirements, inspectionRecords, memberships, reviewDecisions, triageResults, users } from "../db/schema";
import { requirePermission, type ActorContext, type UserActor } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { now } from "../util";
import { loadCaseForOrg, transitionCase } from "../workflow/service";
import { sendInfoRequest } from "../communications/service";
import { refreshCaseEvidence } from "../evidence/pipeline";

export const REVIEW_ACTIONS = {
  begin_review: { transition: "begin_review", decision: null, label: "Begin review" },
  begin_review_without_response: { transition: "begin_review_without_response", decision: null, label: "Begin review without owner response" },
  request_information: { transition: "request_information", decision: "request_information", label: "Request more information" },
  request_corrected_documents: { transition: "request_information", decision: "request_corrected_documents", label: "Request corrected documents" },
  require_inspection: { transition: "require_inspection", decision: "require_inspection", label: "Recommend site inspection" },
  mark_ready: { transition: "mark_ready_for_disposition", decision: "mark_ready", label: "Mark ready for authorized disposition" },
  return_to_review: { transition: "return_to_review", decision: "return_to_review", label: "Return to staff review" },
} as const satisfies Record<string, { transition: TransitionId; decision: string | null; label: string }>;
export type ReviewAction = keyof typeof REVIEW_ACTIONS;

async function decision(
  ctx: ActorContext,
  user: UserActor,
  caseId: string,
  input: { decisionType: (typeof reviewDecisions.$inferInsert)["decisionType"]; summary: string; reason?: string | null; suggestedAction?: string | null; overrode?: boolean },
) {
  const c = await loadCaseForOrg(ctx.orgId, caseId);
  const [tr] = c.currentTriageId ? await db().select().from(triageResults).where(eq(triageResults.id, c.currentTriageId)) : [];
  const [row] = await db()
    .insert(reviewDecisions)
    .values({
      orgId: ctx.orgId,
      caseId,
      decisionType: input.decisionType,
      summary: input.summary,
      reason: input.reason?.trim() || null,
      suggestedAction: input.suggestedAction ?? null,
      overrodeSuggestion: input.overrode ?? false,
      actorUserId: user.userId,
      actorRole: user.role,
      actorName: user.name,
      ruleSetId: tr?.ruleSetId ?? null,
      ruleSetVersion: tr?.ruleSetVersion ?? null,
      createdAt: now(),
    })
    .returning();
  return row;
}

export async function performReviewAction(
  ctx: ActorContext,
  caseId: string,
  input: { action: ReviewAction; reason?: string | null; message?: string | null; suggestedAction?: string | null; expectedVersion?: number | null; idempotencyKey?: string | null },
) {
  const user = requirePermission(ctx, "review:act");
  const spec = REVIEW_ACTIONS[input.action];
  if (!spec) throw new ValidationError("Unknown review action");
  const overrode = Boolean(input.suggestedAction && input.suggestedAction !== input.action);
  if (overrode && !(input.reason && input.reason.trim().length >= 10)) {
    throw new ValidationError("You chose a different action than the system suggested. Record a reason (at least 10 characters).");
  }
  const isRequest = input.action === "request_information" || input.action === "request_corrected_documents";
  if (isRequest && !(input.message && input.message.trim().length >= 10)) {
    throw new ValidationError("Write the request the owner will see (at least 10 characters)");
  }
  return transaction(async () => {
    const result = await transitionCase(ctx, {
      caseId,
      transition: spec.transition,
      reason: input.reason ?? (isRequest ? input.message : null),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      metadata: { reviewAction: input.action, overrodeSuggestion: overrode, suggestedAction: input.suggestedAction ?? null },
    });
    if (result.alreadyApplied) return result;
    if (spec.decision) {
      await decision(ctx, user, caseId, {
        decisionType: spec.decision,
        summary: isRequest ? input.message!.trim() : spec.label,
        reason: input.reason,
        suggestedAction: input.suggestedAction,
        overrode,
      });
    }
    if (isRequest) await sendInfoRequest(ctx, caseId, input.message!.trim());
    if (overrode) {
      await recordAudit(ctx, {
        action: "review.override",
        entityType: "case",
        entityId: caseId,
        caseId,
        summary: `Reviewer chose "${spec.label}" instead of suggested "${input.suggestedAction}"`,
        metadata: { reason: input.reason ?? null },
      });
    }
    return result;
  });
}

export async function reviewRequirement(ctx: ActorContext, requirementId: string, input: { decision: "accept" | "reject" | "waive"; note: string }) {
  const user = requirePermission(ctx, "review:act");
  return transaction(async () => {
    const [r] = await db()
      .select()
      .from(evidenceRequirements)
      .where(and(eq(evidenceRequirements.id, requirementId), eq(evidenceRequirements.orgId, ctx.orgId)));
    if (!r) throw new NotFoundError("Requirement");
    if (input.decision === "accept" && r.status !== "provided") throw new ValidationError("Only provided items can be accepted");
    if (input.decision === "waive" && input.note.trim().length < 10) throw new ValidationError("Waiving a requirement needs a reason (at least 10 characters)");
    if (input.decision === "reject" && input.note.trim().length < 5) throw new ValidationError("Explain why the item was rejected");
    const status = input.decision === "accept" ? "accepted" : input.decision === "reject" ? "rejected" : "waived";
    await db()
      .update(evidenceRequirements)
      .set({ status, reviewedBy: user.userId, reviewedAt: now(), reviewNote: input.note.trim() || null, updatedAt: now() })
      .where(eq(evidenceRequirements.id, r.id));
    await decision(ctx, user, r.caseId, { decisionType: "requirement_review", summary: `${r.label}: ${status}`, reason: input.note });
    await recordAudit(ctx, {
      action: `requirement.${status}`,
      entityType: "evidence_requirement",
      entityId: r.id,
      caseId: r.caseId,
      summary: `Requirement "${r.label}" ${status} by ${user.name}`,
      metadata: { note: input.note.trim() },
    });
  });
}

export async function reviewEvidenceItem(ctx: ActorContext, itemId: string, input: { decision: "accept" | "reject"; note: string }) {
  const user = requirePermission(ctx, "review:act");
  return transaction(async () => {
    const [item] = await db()
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.id, itemId), eq(evidenceItems.orgId, ctx.orgId)));
    if (!item) throw new NotFoundError("Evidence item");
    if (input.decision === "reject" && input.note.trim().length < 5) throw new ValidationError("Explain why the document was rejected");
    await db()
      .update(evidenceItems)
      .set({ reviewStatus: input.decision === "accept" ? "accepted" : "rejected", reviewNote: input.note.trim() || null, reviewedBy: user.userId, reviewedAt: now() })
      .where(eq(evidenceItems.id, item.id));
    await decision(ctx, user, item.caseId, { decisionType: "evidence_review", summary: `${item.originalFilename}: ${input.decision}ed`, reason: input.note });
    await recordAudit(ctx, {
      action: `evidence.${input.decision}ed`,
      entityType: "evidence_item",
      entityId: item.id,
      caseId: item.caseId,
      summary: `${item.originalFilename} ${input.decision}ed by ${user.name}`,
    });
    await refreshCaseEvidence(ctx.orgId, item.caseId);
  });
}

export async function resolveFinding(ctx: ActorContext, findingId: string, input: { note: string }) {
  const user = requirePermission(ctx, "review:act");
  if (input.note.trim().length < 10) throw new ValidationError("Explain how the discrepancy was resolved (at least 10 characters)");
  return transaction(async () => {
    const [f] = await db()
      .update(evidenceFindings)
      .set({ status: "resolved", resolutionNote: input.note.trim(), resolvedBy: user.userId, resolvedAt: now() })
      .where(and(eq(evidenceFindings.id, findingId), eq(evidenceFindings.orgId, ctx.orgId), eq(evidenceFindings.status, "open")))
      .returning();
    if (!f) throw new NotFoundError("Open finding");
    await decision(ctx, user, f.caseId, { decisionType: "conflict_resolution", summary: `Resolved: ${f.message.slice(0, 200)}`, reason: input.note });
    await recordAudit(ctx, {
      action: "finding.resolved",
      entityType: "evidence_finding",
      entityId: f.id,
      caseId: f.caseId,
      summary: `Discrepancy resolved by ${user.name}. Both source records remain preserved.`,
      metadata: { note: input.note.trim() },
    });
    return f;
  });
}

export async function assignCase(ctx: ActorContext, caseId: string, input: { userId: string; kind: "primary" | "specialist" }) {
  const actor = ctx.actor;
  const canAssign = actor.type === "user" && (["admin", "clerk", "manager"].includes(actor.role) || (input.userId === actor.userId && ["inspector", "official"].includes(actor.role)));
  if (!canAssign || actor.type !== "user") throw new ForbiddenError();
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    const [m] = await db()
      .select({ role: memberships.role, specialties: memberships.specialties, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.userId, input.userId), eq(memberships.orgId, ctx.orgId), eq(memberships.active, true)));
    if (!m) throw new NotFoundError("Staff member");
    if (input.kind === "specialist" && !["inspector", "official"].includes(m.role)) throw new ValidationError("Specialists must be inspectors or building officials");
    const at = now();
    await db()
      .update(caseAssignments)
      .set({ endedAt: at })
      .where(and(eq(caseAssignments.caseId, c.id), eq(caseAssignments.kind, input.kind)));
    await db().insert(caseAssignments).values({ orgId: ctx.orgId, caseId: c.id, userId: input.userId, kind: input.kind, assignedBy: actor.userId, assignedAt: at });
    await db()
      .update(cases)
      .set(input.kind === "primary" ? { assignedUserId: input.userId, updatedAt: at } : { specialistUserId: input.userId, updatedAt: at })
      .where(eq(cases.id, c.id));
    await recordAudit(ctx, {
      action: "case.assigned",
      entityType: "case",
      entityId: c.id,
      caseId: c.id,
      summary: `${input.kind === "primary" ? "Assigned" : "Specialist assigned"}: ${m.name}`,
      metadata: { userId: input.userId, kind: input.kind },
    });
  });
}

export async function bulkAssign(ctx: ActorContext, caseIds: string[], userId: string) {
  requirePermission(ctx, "cases:assign");
  if (caseIds.length > 200) throw new ValidationError("Assign at most 200 cases at a time");
  for (const id of caseIds) await assignCase(ctx, id, { userId, kind: "primary" });
  return caseIds.length;
}

export async function recordSpecialistAssessment(ctx: ActorContext, caseId: string, input: { summary: string; recommendation: string }) {
  const user = requirePermission(ctx, "review:specialist");
  if (input.summary.trim().length < 20) throw new ValidationError("Summarize the specialist assessment (at least 20 characters)");
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    const [tr] = c.currentTriageId ? await db().select().from(triageResults).where(eq(triageResults.id, c.currentTriageId)) : [];
    if (!tr?.specialistRequired) throw new ValidationError("This case does not require a specialist assessment");
    if (tr.specialistDiscipline && user.role !== "official" && !user.specialties.includes(tr.specialistDiscipline)) {
      throw new ForbiddenError(`A ${tr.specialistDiscipline} specialist must record this assessment`);
    }
    const d = await decision(ctx, user, caseId, {
      decisionType: "specialist_assessment",
      summary: input.summary.trim(),
      reason: input.recommendation.trim(),
    });
    await recordAudit(ctx, {
      action: "review.specialist_assessment",
      entityType: "review_decision",
      entityId: d.id,
      caseId,
      summary: `${tr.specialistDiscipline ?? "Specialist"} assessment recorded by ${user.name}`,
    });
    return d;
  });
}

export async function recordInspection(
  ctx: ActorContext,
  caseId: string,
  input: { inspectionType: "site_assessment" | "final"; result: "passed" | "failed" | "partial" | "not_performed"; inspectedOn: string; notes: string },
) {
  const user = requirePermission(ctx, "inspections:record");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inspectedOn)) throw new ValidationError("Inspection date is required");
  if (input.inspectedOn > new Date().toISOString().slice(0, 10)) throw new ValidationError("Inspection date cannot be in the future");
  if (input.notes.trim().length < 10) throw new ValidationError("Inspection notes are required (at least 10 characters)");
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    const [rec] = await db()
      .insert(inspectionRecords)
      .values({
        orgId: ctx.orgId,
        permitId: c.permitId,
        caseId: c.id,
        inspectionType: input.inspectionType,
        result: input.result,
        inspectedAt: new Date(`${input.inspectedOn}T12:00:00Z`),
        inspectorName: user.name,
        inspectorUserId: user.userId,
        source: "recorded",
        notes: input.notes.trim(),
        createdAt: now(),
      })
      .returning();
    await recordAudit(ctx, {
      action: "inspection.recorded",
      entityType: "inspection_record",
      entityId: rec.id,
      caseId: c.id,
      summary: `${input.inspectionType === "final" ? "Final" : "Site"} inspection recorded: ${input.result} (${input.inspectedOn}) by ${user.name}`,
    });
    if (c.status === "INSPECTION_REQUIRED") {
      await transitionCase(ctx, { caseId: c.id, transition: "record_inspection_result", idempotencyKey: `inspection:${rec.id}`, metadata: { result: input.result } });
    }
    return rec;
  });
}
