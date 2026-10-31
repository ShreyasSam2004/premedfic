/**
 * Read models for the staff UI. Every query is scoped by org_id.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { CASE_STATES, OPEN_STATES, UNRESOLVED_STATES, type CaseState } from "@/domain/workflow";
import { db } from "../db/client";
import {
  cases,
  communications,
  contacts,
  contactVerifications,
  dispositionSubmissions,
  duplicateCandidates,
  evidenceFindings,
  evidenceItems,
  evidenceRequirements,
  evidenceSubmissions,
  inspectionRecords,
  jurisdictions,
  memberships,
  permitImportBatches,
  permits,
  permitSourceRecords,
  portalGrants,
  properties,
  reviewDecisions,
  ruleEvaluations,
  ruleSets,
  triageResults,
  users,
  workflowTransitions,
  finalizationVerifications,
} from "../db/schema";
import { NotFoundError } from "../errors";
import { isoDate, now } from "../util";
import { listAuditEvents } from "../audit/audit";

export interface CaseFilters {
  q?: string;
  status?: string;
  category?: string;
  jurisdictionId?: string;
  assigned?: string;
  priority?: string;
  age?: string;
  evidence?: string;
  classification?: string;
  queue?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const STATUS_GROUPS: Record<string, CaseState[]> = {
  open: OPEN_STATES,
  unresolved: UNRESOLVED_STATES,
  intake: ["IMPORTED", "NEEDS_DATA_RECONCILIATION", "TRIAGED"],
  verification: ["FINALIZATION_VERIFICATION"],
  already_resolved: ["ALREADY_RESOLVED"],
  outreach: ["AWAITING_CONTACT_APPROVAL", "OWNER_CONTACTED"],
  awaiting_owner: ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"],
  review: ["EVIDENCE_RECEIVED", "UNDER_STAFF_REVIEW", "INSPECTION_REQUIRED"],
  evidence_review: ["EVIDENCE_RECEIVED", "UNDER_STAFF_REVIEW"],
  disposition: ["READY_FOR_AUTHORIZED_DISPOSITION", "DISPOSITION_PENDING_CONFIRMATION"],
  resolved: ["OFFICIALLY_CLOSED", "OTHER_OFFICIAL_OUTCOME"],
};

const AGE_BUCKETS: Record<string, [number, number]> = {
  lt2: [0, 2],
  "2to5": [2, 5],
  "5to10": [5, 10],
  gt10: [10, 200],
};

function yearsAgo(years: number) {
  const d = now();
  return isoDate(new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate())));
}

function requirementAgg() {
  return db()
    .select({
      caseId: evidenceRequirements.caseId,
      required: sql<number>`count(*) filter (where ${evidenceRequirements.required})::int`.as("required"),
      satisfied: sql<number>`count(*) filter (where ${evidenceRequirements.required} and ${evidenceRequirements.status} in ('provided','accepted','waived'))::int`.as("satisfied"),
    })
    .from(evidenceRequirements)
    .groupBy(evidenceRequirements.caseId)
    .as("req");
}

function evidenceAgg() {
  return db()
    .select({ caseId: evidenceItems.caseId, items: sql<number>`count(*)::int`.as("items") })
    .from(evidenceItems)
    .groupBy(evidenceItems.caseId)
    .as("ev");
}

export function caseFilterConditions(orgId: string, f: CaseFilters, userId?: string, req?: ReturnType<typeof requirementAgg>) {
  const conds: SQL[] = [eq(cases.orgId, orgId)];
  if (f.q?.trim()) {
    const term = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(permits.permitNumber, term), ilike(properties.addressLine, term), ilike(properties.parcelId, term), ilike(permits.contractorName, term))!);
  }
  if (f.status) {
    const states = STATUS_GROUPS[f.status] ?? (CASE_STATES.includes(f.status as CaseState) ? [f.status as CaseState] : null);
    if (states) conds.push(inArray(cases.status, states));
  }
  if (f.category) conds.push(f.category === "uncategorized" ? isNull(permits.category) : eq(permits.category, f.category));
  if (f.jurisdictionId) conds.push(eq(permits.jurisdictionId, f.jurisdictionId));
  if (f.priority) conds.push(eq(cases.priority, f.priority));
  if (f.classification) conds.push(eq(cases.classification, f.classification));
  if (f.assigned === "unassigned") conds.push(isNull(cases.assignedUserId));
  else if (f.assigned === "me" && userId) conds.push(or(eq(cases.assignedUserId, userId), eq(cases.specialistUserId, userId))!);
  else if (f.assigned) conds.push(or(eq(cases.assignedUserId, f.assigned), eq(cases.specialistUserId, f.assigned))!);
  if (f.age && AGE_BUCKETS[f.age]) {
    const [minY, maxY] = AGE_BUCKETS[f.age];
    conds.push(and(lt(permits.issuedAt, yearsAgo(minY)), gte(permits.issuedAt, yearsAgo(maxY)))!);
  }
  if (f.queue === "manual_outreach") conds.push(eq(cases.manualOutreachRequired, true), eq(cases.status, "TRIAGED"));
  if (f.queue === "expired") conds.push(or(lt(permits.expiresAt, isoDate(now())), eq(permits.sourceStatus, "expired"))!);
  if (f.queue === "unresolved") conds.push(inArray(cases.status, UNRESOLVED_STATES), or(isNull(cases.classification), ne(cases.classification, "MONITOR_ACTIVE"))!);
  if (f.evidence && req) {
    if (f.evidence === "none") conds.push(sql`coalesce(${req.satisfied}, 0) = 0`);
    if (f.evidence === "partial") conds.push(sql`${req.satisfied} > 0 and ${req.satisfied} < ${req.required}`);
    if (f.evidence === "complete") conds.push(sql`${req.required} > 0 and ${req.satisfied} >= ${req.required}`);
  }
  return and(...conds)!;
}

export async function listCases(orgId: string, f: CaseFilters, userId?: string) {
  const req = requirementAgg();
  const ev = evidenceAgg();
  const assignee = alias(users, "assignee");
  const where = caseFilterConditions(orgId, f, userId, req);
  const dir = f.dir === "asc" ? asc : desc;
  const sortCol =
    f.sort === "permit"
      ? permits.permitNumber
      : f.sort === "issued"
        ? permits.issuedAt
        : f.sort === "expires"
          ? permits.expiresAt
          : f.sort === "updated"
            ? cases.lastTransitionAt
            : f.sort === "status"
              ? cases.status
              : cases.priorityScore;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 200);
  const page = Math.max(f.page ?? 1, 1);

  const base = db()
    .select({
      id: cases.id,
      status: cases.status,
      version: cases.version,
      priority: cases.priority,
      priorityScore: cases.priorityScore,
      classification: cases.classification,
      manualOutreachRequired: cases.manualOutreachRequired,
      lastTransitionAt: cases.lastTransitionAt,
      permitId: permits.id,
      permitNumber: permits.permitNumber,
      category: permits.category,
      issuedAt: permits.issuedAt,
      expiresAt: permits.expiresAt,
      sourceStatus: permits.sourceStatus,
      address: properties.addressLine,
      jurisdiction: jurisdictions.name,
      assignedName: assignee.name,
      reqRequired: req.required,
      reqSatisfied: req.satisfied,
      evidenceItems: ev.items,
    })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, permits.jurisdictionId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(assignee, eq(assignee.id, cases.assignedUserId))
    .leftJoin(req, eq(req.caseId, cases.id))
    .leftJoin(ev, eq(ev.caseId, cases.id))
    .where(where);

  const rows = await base
    .orderBy(sql`${dir(sortCol)} nulls last`, asc(permits.permitNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(req, eq(req.caseId, cases.id))
    .where(where);
  return { rows, total, page, pageSize };
}

export async function listStaff(orgId: string) {
  return db()
    .select({ id: users.id, name: users.name, title: users.title, role: memberships.role, specialties: memberships.specialties, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.active, true)))
    .orderBy(users.name);
}

export async function listJurisdictions(orgId: string) {
  return db().select().from(jurisdictions).where(eq(jurisdictions.orgId, orgId)).orderBy(jurisdictions.name);
}

export async function getCaseDetail(orgId: string, caseId: string) {
  const assignee = alias(users, "assignee");
  const specialist = alias(users, "specialist");
  const [row] = await db()
    .select({ c: cases, permit: permits, property: properties, jurisdiction: jurisdictions, assignedName: assignee.name, specialistName: specialist.name })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, permits.jurisdictionId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(assignee, eq(assignee.id, cases.assignedUserId))
    .leftJoin(specialist, eq(specialist.id, cases.specialistUserId))
    .where(and(eq(cases.id, caseId), eq(cases.orgId, orgId)));
  if (!row) throw new NotFoundError("Case");
  const { c, permit, property } = row;

  const triageHistory = await db().select().from(triageResults).where(eq(triageResults.caseId, c.id)).orderBy(desc(triageResults.computedAt));
  const triage = triageHistory.find((t) => t.id === c.currentTriageId) ?? triageHistory[0] ?? null;
  const evaluations = triage ? await db().select().from(ruleEvaluations).where(eq(ruleEvaluations.triageResultId, triage.id)) : [];
  const [ruleSet] = triage?.ruleSetId ? await db().select().from(ruleSets).where(eq(ruleSets.id, triage.ruleSetId)) : [];

  const requirements = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, c.id)).orderBy(desc(evidenceRequirements.required), asc(evidenceRequirements.createdAt));
  const items = await db()
    .select({
      id: evidenceItems.id,
      originalFilename: evidenceItems.originalFilename,
      mimeType: evidenceItems.mimeType,
      sizeBytes: evidenceItems.sizeBytes,
      sha256: evidenceItems.sha256,
      declaredType: evidenceItems.declaredType,
      classifiedType: evidenceItems.classifiedType,
      classificationConfidence: evidenceItems.classificationConfidence,
      classificationMethod: evidenceItems.classificationMethod,
      classificationSignals: evidenceItems.classificationSignals,
      processingStatus: evidenceItems.processingStatus,
      processingError: evidenceItems.processingError,
      pageCount: evidenceItems.pageCount,
      textExtractionMethod: evidenceItems.textExtractionMethod,
      reviewStatus: evidenceItems.reviewStatus,
      reviewNote: evidenceItems.reviewNote,
      uploadedByType: evidenceItems.uploadedByType,
      submissionId: evidenceItems.submissionId,
      createdAt: evidenceItems.createdAt,
      hasText: sql<boolean>`${evidenceItems.extractedText} is not null`,
    })
    .from(evidenceItems)
    .where(eq(evidenceItems.caseId, c.id))
    .orderBy(asc(evidenceItems.createdAt));
  const findings = await db().select().from(evidenceFindings).where(eq(evidenceFindings.caseId, c.id)).orderBy(asc(evidenceFindings.createdAt));
  const submissions = await db().select().from(evidenceSubmissions).where(eq(evidenceSubmissions.caseId, c.id)).orderBy(desc(evidenceSubmissions.createdAt));
  const contactRows = property ? await db().select().from(contacts).where(eq(contacts.propertyId, property.id)).orderBy(asc(contacts.createdAt)) : [];
  const verifications = contactRows.length
    ? await db().select().from(contactVerifications).where(inArray(contactVerifications.contactId, contactRows.map((x) => x.id))).orderBy(desc(contactVerifications.createdAt))
    : [];
  const comms = await db()
    .select({ comm: communications, createdByName: users.name })
    .from(communications)
    .leftJoin(users, eq(users.id, communications.createdBy))
    .where(eq(communications.caseId, c.id))
    .orderBy(desc(communications.createdAt));
  const grants = await db()
    .select({ id: portalGrants.id, createdAt: portalGrants.createdAt, verifiedAt: portalGrants.verifiedAt, relationship: portalGrants.relationship, expiresAt: portalGrants.expiresAt, revokedAt: portalGrants.revokedAt })
    .from(portalGrants)
    .where(eq(portalGrants.caseId, c.id))
    .orderBy(desc(portalGrants.createdAt));
  const inspections = await db().select().from(inspectionRecords).where(eq(inspectionRecords.permitId, permit.id)).orderBy(desc(inspectionRecords.inspectedAt));
  const decisions = await db().select().from(reviewDecisions).where(eq(reviewDecisions.caseId, c.id)).orderBy(desc(reviewDecisions.createdAt));
  const dispositions = await db().select().from(dispositionSubmissions).where(eq(dispositionSubmissions.caseId, c.id)).orderBy(desc(dispositionSubmissions.submittedAt));
  const transitions = await db().select().from(workflowTransitions).where(eq(workflowTransitions.caseId, c.id)).orderBy(desc(workflowTransitions.createdAt));
  const audit = await listAuditEvents(orgId, { caseId: c.id, limit: 300 });

  const otherPermit = alias(permits, "other_permit");
  const otherCase = alias(cases, "other_case");
  const dupRows = await db()
    .select({ d: duplicateCandidates, other: otherPermit, otherCaseId: otherCase.id, otherStatus: otherCase.status })
    .from(duplicateCandidates)
    .innerJoin(
      otherPermit,
      or(
        and(eq(duplicateCandidates.permitId, permit.id), eq(otherPermit.id, duplicateCandidates.candidatePermitId)),
        and(eq(duplicateCandidates.candidatePermitId, permit.id), eq(otherPermit.id, duplicateCandidates.permitId)),
      ),
    )
    .innerJoin(otherCase, eq(otherCase.permitId, otherPermit.id))
    .where(eq(duplicateCandidates.orgId, orgId));

  const related = property
    ? await db()
        .select({ permitId: permits.id, permitNumber: permits.permitNumber, category: permits.category, issuedAt: permits.issuedAt, caseId: cases.id, status: cases.status })
        .from(permits)
        .innerJoin(cases, eq(cases.permitId, permits.id))
        .where(and(eq(permits.propertyId, property.id), ne(permits.id, permit.id)))
    : [];
  const sourceRecords = await db()
    .select({ record: permitSourceRecords, batch: permitImportBatches })
    .from(permitSourceRecords)
    .innerJoin(permitImportBatches, eq(permitImportBatches.id, permitSourceRecords.batchId))
    .where(eq(permitSourceRecords.permitId, permit.id))
    .orderBy(desc(permitSourceRecords.createdAt));
  const finalizationChecks = await db()
    .select()
    .from(finalizationVerifications)
    .where(and(eq(finalizationVerifications.orgId, orgId), eq(finalizationVerifications.caseId, c.id)))
    .orderBy(desc(finalizationVerifications.createdAt));

  return {
    ...row,
    triage,
    triageHistory,
    evaluations,
    ruleSet: ruleSet ?? null,
    requirements,
    items,
    findings,
    submissions,
    contacts: contactRows,
    verifications,
    comms,
    grants,
    inspections,
    decisions,
    dispositions,
    transitions,
    audit,
    duplicates: dupRows,
    related,
    sourceRecords,
    finalizationChecks,
  };
}

export type CaseDetail = Awaited<ReturnType<typeof getCaseDetail>>;

export async function searchCases(orgId: string, q: string) {
  if (q.trim().length < 2) return [];
  const term = `%${q.trim().replace(/[%_]/g, "")}%`;
  return db()
    .select({ id: cases.id, status: cases.status, permitNumber: permits.permitNumber, address: properties.addressLine, category: permits.category })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .where(and(eq(cases.orgId, orgId), or(ilike(permits.permitNumber, term), ilike(properties.addressLine, term))))
    .limit(8);
}

export async function getEvidenceItemForOrg(orgId: string, itemId: string) {
  const [item] = await db()
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, itemId), eq(evidenceItems.orgId, orgId)));
  if (!item) throw new NotFoundError("Evidence item");
  return item;
}
