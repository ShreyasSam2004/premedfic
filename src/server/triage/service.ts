/**
 * Persists triage runs: one immutable triage_results row per run, with one
 * rule_evaluations row per rule, and syncs the case's evidence checklist.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { PermitCategory, SourceStatus } from "@/domain/permits";
import { CLASSIFICATION_META } from "@/domain/triage";
import { OPEN_STATES, STATE_META } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import {
  cases,
  contacts,
  duplicateCandidates,
  evidenceRequirements,
  finalizationVerifications,
  inspectionRecords,
  permits,
  properties,
  ruleEvaluations,
  triageResults,
} from "../db/schema";
import type { ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { isoDate, now } from "../util";
import { getActiveRuleSet } from "../rules/service";
import { isContactable, loadCaseForOrg, transitionCase } from "../workflow/service";
import { ENGINE_VERSION, runTriage, type TriageInput } from "./engine";

function triagePermit(permit: typeof permits.$inferSelect, address: string | null): TriageInput["permit"] {
  return {
    permitNumber: permit.permitNumber,
    category: permit.category as PermitCategory | null,
    rawCategory: permit.rawCategory,
    workDescription: permit.workDescription,
    address,
    issuedAt: permit.issuedAt,
    expiresAt: permit.expiresAt,
    sourceStatus: permit.sourceStatus as SourceStatus,
    finalInspectionAt: permit.finalInspectionAt,
    missingFields: permit.missingFields,
  };
}

/**
 * Triage inputs (without a rule set) for every open case in a jurisdiction,
 * loaded in a fixed number of queries. Mirrors buildTriageInput.
 */
export async function loadOpenCaseInputs(orgId: string, jurisdictionId: string) {
  const rows = await db()
    .select({ permit: permits, caseId: cases.id, address: properties.addressLine })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .where(and(eq(cases.orgId, orgId), eq(permits.jurisdictionId, jurisdictionId), inArray(cases.status, OPEN_STATES)));
  const finals = await db()
    .select({ permitId: inspectionRecords.permitId })
    .from(inspectionRecords)
    .where(and(eq(inspectionRecords.orgId, orgId), eq(inspectionRecords.inspectionType, "final"), eq(inspectionRecords.result, "passed")));
  const passed = new Set(finals.map((f) => f.permitId));
  const dupRows = await db()
    .select({ a: duplicateCandidates.permitId, b: duplicateCandidates.candidatePermitId })
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.orgId, orgId), eq(duplicateCandidates.status, "open")));
  const dups = new Map<string, number>();
  for (const d of dupRows) for (const id of [d.a, d.b]) dups.set(id, (dups.get(id) ?? 0) + 1);
  const contactRows = await db().select().from(contacts).where(eq(contacts.orgId, orgId));
  const checks = await latestFinalizationChecks(orgId);
  const byProperty = new Map<string, (typeof contactRows)[number][]>();
  for (const c of contactRows) if (c.propertyId) byProperty.set(c.propertyId, [...(byProperty.get(c.propertyId) ?? []), c]);
  const asOf = isoDate(now());
  return rows.map((r) => {
    const cs = r.permit.propertyId ? (byProperty.get(r.permit.propertyId) ?? []) : [];
    const input: Omit<TriageInput, "ruleSet"> = {
      permit: triagePermit(r.permit, r.address ?? null),
      passedFinalInspection: passed.has(r.permit.id),
      finalizationVerification: checks.get(r.permit.id) ?? null,
      openDuplicateCandidates: dups.get(r.permit.id) ?? 0,
      contacts: { total: cs.length, contactable: cs.filter((c) => isContactable(c, Boolean(r.address))).length },
      asOf,
    };
    return { key: r.permit.id, permitNumber: r.permit.permitNumber, caseId: r.caseId, category: r.permit.category, input };
  });
}

/** Latest system-of-record check of a reported final, per permit. */
async function latestFinalizationChecks(orgId: string, permitId?: string) {
  const rows = await db()
    .select({ permitId: finalizationVerifications.permitId, outcome: finalizationVerifications.outcome, reference: finalizationVerifications.sourceReference, at: finalizationVerifications.createdAt })
    .from(finalizationVerifications)
    .where(permitId ? and(eq(finalizationVerifications.orgId, orgId), eq(finalizationVerifications.permitId, permitId)) : eq(finalizationVerifications.orgId, orgId))
    .orderBy(desc(finalizationVerifications.createdAt));
  const out = new Map<string, NonNullable<TriageInput["finalizationVerification"]>>();
  for (const r of rows) if (!out.has(r.permitId)) out.set(r.permitId, { outcome: r.outcome, at: isoDate(r.at), reference: r.reference });
  return out;
}

export async function buildTriageInput(orgId: string, permitId: string): Promise<{ input: TriageInput; ruleSetId: string | null }> {
  const [permit] = await db()
    .select()
    .from(permits)
    .where(and(eq(permits.id, permitId), eq(permits.orgId, orgId)));
  const [prop] = permit.propertyId ? await db().select().from(properties).where(eq(properties.id, permit.propertyId)) : [];
  const inspections = await db().select().from(inspectionRecords).where(eq(inspectionRecords.permitId, permit.id));
  const dups = await db()
    .select({ id: duplicateCandidates.id })
    .from(duplicateCandidates)
    .where(
      and(
        eq(duplicateCandidates.status, "open"),
        or(eq(duplicateCandidates.permitId, permit.id), eq(duplicateCandidates.candidatePermitId, permit.id)),
      ),
    );
  const contactRows = permit.propertyId ? await db().select().from(contacts).where(eq(contacts.propertyId, permit.propertyId)) : [];
  const ruleSet = await getActiveRuleSet(orgId, permit.jurisdictionId);
  return {
    ruleSetId: ruleSet?.id ?? null,
    input: {
      permit: triagePermit(permit, prop?.addressLine ?? null),
      passedFinalInspection: inspections.some((i) => i.inspectionType === "final" && i.result === "passed"),
      finalizationVerification: (await latestFinalizationChecks(orgId, permit.id)).get(permit.id) ?? null,
      openDuplicateCandidates: dups.length,
      contacts: { total: contactRows.length, contactable: contactRows.filter((c) => isContactable(c, Boolean(prop?.addressLine))).length },
      ruleSet: ruleSet ? { id: ruleSet.id, version: ruleSet.version, verified: ruleSet.verificationStatus === "verified", config: ruleSet.config } : null,
      asOf: isoDate(now()),
    },
  };
}

export async function triageCase(ctx: ActorContext, caseId: string) {
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId, { forUpdate: true });
    const { input, ruleSetId } = await buildTriageInput(ctx.orgId, c.permitId);
    const out = runTriage(input);
    const computedAt = now();
    const computedBy = ctx.actor.type === "user" ? `user:${ctx.actor.userId}` : ctx.actor.type === "system" ? ctx.actor.name : "homeowner";

    const [tr] = await db()
      .insert(triageResults)
      .values({
        orgId: ctx.orgId,
        caseId: c.id,
        permitId: c.permitId,
        ruleSetId,
        ruleSetVersion: input.ruleSet?.version ?? null,
        ruleSetVerified: input.ruleSet?.verified ?? false,
        engineVersion: ENGINE_VERSION,
        classification: out.classification,
        pathway: out.pathway,
        priority: out.priority,
        priorityScore: out.priorityScore,
        humanReviewRequired: out.humanReviewRequired,
        specialistRequired: out.specialistRequired,
        siteInspectionRequired: out.siteInspectionRequired,
        specialistDiscipline: out.specialistDiscipline,
        agedPermitEligible: out.agedPermitEligible,
        recommendedAction: out.recommendedAction,
        explanation: out.explanation,
        escalations: out.escalations,
        requiredEvidence: out.requiredEvidence,
        completeness: out.completeness,
        permitAgeDays: out.permitAgeDays,
        daysSinceExpiration: out.daysSinceExpiration,
        inputSnapshot: { ...input, ruleSet: input.ruleSet ? { id: input.ruleSet.id, version: input.ruleSet.version, verified: input.ruleSet.verified } : null, priorityBreakdown: out.priorityBreakdown },
        computedAt,
        computedBy,
      })
      .returning();

    await db()
      .insert(ruleEvaluations)
      .values(
        out.outcomes.map((o) => ({
          triageResultId: tr.id,
          ruleId: o.ruleId,
          ruleVersion: o.ruleVersion,
          outcome: o.outcome,
          sourceFields: o.sourceFields,
          explanation: o.explanation,
        })),
      );

    // Sync the evidence checklist. Existing statuses are preserved; requirements
    // no longer in the active rules are marked not-required rather than deleted.
    const existing = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, c.id));
    const codes = new Set(out.requiredEvidence.map((r) => r.code));
    for (const spec of out.requiredEvidence) {
      const prior = existing.find((e) => e.code === spec.code);
      if (prior) {
        await db()
          .update(evidenceRequirements)
          .set({ label: spec.label, description: spec.description, acceptedTypes: spec.acceptedTypes, minCount: spec.minCount, required: spec.required, ruleSetVersion: input.ruleSet?.version ?? null, updatedAt: computedAt })
          .where(eq(evidenceRequirements.id, prior.id));
      } else {
        await db().insert(evidenceRequirements).values({
          orgId: ctx.orgId,
          caseId: c.id,
          code: spec.code,
          label: spec.label,
          description: spec.description,
          acceptedTypes: spec.acceptedTypes,
          minCount: spec.minCount,
          required: spec.required,
          ruleSetVersion: input.ruleSet?.version ?? null,
          createdAt: computedAt,
          updatedAt: computedAt,
        });
      }
    }
    const stale = existing.filter((e) => !codes.has(e.code) && e.required).map((e) => e.id);
    if (stale.length) await db().update(evidenceRequirements).set({ required: false, updatedAt: computedAt }).where(inArray(evidenceRequirements.id, stale));

    const flags = new Set(c.flags);
    const reportsFinal = out.classification === "FINALIZATION_CONFIRMATION";
    const unverifiedFinal = reportsFinal && !input.finalizationVerification;
    const intake = ["IMPORTED", "TRIAGED", "NEEDS_DATA_RECONCILIATION"].includes(c.status);
    // A final reported while a case is already in progress: staff decide whether to divert it.
    if (unverifiedFinal && !intake && c.status !== "FINALIZATION_VERIFICATION" && STATE_META[c.status].open) flags.add("source_reports_final");
    else flags.delete("source_reports_final");
    if (!["IMPORTED", "TRIAGED", "NEEDS_DATA_RECONCILIATION"].includes(c.status) && c.classification && c.classification !== out.classification) {
      flags.add("retriaged_during_review");
    }
    await db()
      .update(cases)
      .set({
        classification: out.classification,
        priority: out.priority,
        priorityScore: out.priorityScore,
        currentTriageId: tr.id,
        manualOutreachRequired: out.manualOutreachRequired,
        flags: [...flags],
        updatedAt: computedAt,
      })
      .where(eq(cases.id, c.id));

    await recordAudit(ctx, {
      action: "triage.completed",
      entityType: "triage_result",
      entityId: tr.id,
      caseId: c.id,
      summary: `Triage: ${CLASSIFICATION_META[out.classification].label} (${out.priority}) under rule set ${input.ruleSet ? `v${input.ruleSet.version}` : "none"}`,
      metadata: {
        classification: out.classification,
        priority: out.priority,
        ruleSetVersion: input.ruleSet?.version ?? null,
        triggered: out.outcomes.filter((o) => o.outcome === "triggered").map((o) => o.ruleId),
      },
    });

    // Route the case. Only intake states are moved automatically. A reported
    // final goes to verification, never into outreach or reconciliation.
    const needsReconciliation = out.classification === "DATA_RECONCILIATION";
    if (intake && unverifiedFinal) {
      await transitionCase(ctx, { caseId: c.id, transition: "route_finalization_verification", reason: out.explanation, idempotencyKey: `triage:${tr.id}` });
    } else if (c.status === "IMPORTED") {
      await transitionCase(ctx, {
        caseId: c.id,
        transition: needsReconciliation ? "flag_reconciliation" : "complete_triage",
        reason: needsReconciliation ? out.recommendedAction : null,
        idempotencyKey: `triage:${tr.id}`,
      });
    } else if (c.status === "TRIAGED" && needsReconciliation) {
      await transitionCase(ctx, { caseId: c.id, transition: "flag_reconciliation", reason: out.recommendedAction, idempotencyKey: `triage:${tr.id}` });
    }
    return { triage: tr, output: out };
  });
}

export async function triageCases(ctx: ActorContext, caseIds: string[]) {
  const results = [];
  for (const id of caseIds) results.push(await triageCase(ctx, id));
  return results;
}

export async function listCaseIdsForPermits(orgId: string, permitIds: string[]) {
  if (permitIds.length === 0) return [];
  const rows = await db()
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), inArray(cases.permitId, permitIds)));
  return rows.map((r) => r.id);
}
