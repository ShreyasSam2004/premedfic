/**
 * Case-level evidence checks: compares extracted document facts, applicant
 * claims, and municipal records. Conflicts preserve every source; the system
 * never picks a winner. Pure and deterministic.
 */
import type { Provenance } from "@/domain/evidence";
import { PHOTO_LIMITATION } from "@/domain/evidence";
import type { SourceRef } from "../db/schema";
import { normalizeAddressKey, normalizePermitNumber } from "../imports/normalize";
import { canonicalJson, daysBetween, sha256 } from "../util";
import type { ExtractedField } from "./analyze";

export const CROSSCHECK_VERSION = "crosscheck/1.0.0";
export const COMPLETION_DATE_TOLERANCE_DAYS = 30;

export interface CrossCheckInput {
  permit: { id: string; permitNumber: string; issuedAt: string | null; contractorName: string | null; contractorLicense: string | null };
  propertyAddress: string | null;
  passedFinalOnRecord: boolean;
  claims: {
    submissionId: string;
    completionDate: string | null;
    contractorName: string | null;
    contractorLicense: string | null;
  } | null;
  items: { id: string; filename: string; type: string; fields: ExtractedField[] }[];
}

export interface CaseFinding {
  kind: "fact" | "check" | "conflict" | "unknown" | "warning";
  field: string | null;
  value: string | null;
  provenance: Provenance;
  message: string;
  severity: "info" | "warning" | "critical";
  sourceRefs: SourceRef[];
  fingerprint: string;
}

function ref(itemId: string, f: ExtractedField): SourceRef {
  return { evidenceItemId: itemId, page: f.page, start: f.start, end: f.end, quote: f.quote };
}

function fp(parts: unknown) {
  return sha256(canonicalJson(parts)).slice(0, 32);
}

function streetKey(addr: string | null): { number: string; street: string } | null {
  const key = normalizeAddressKey(addr);
  const m = key?.match(/^(\d+)\s+(?:[NSEW]{1,2}\s+)?([A-Z0-9]+)/);
  return m ? { number: m[1], street: m[2] } : null;
}

function nameTokens(name: string) {
  return new Set(
    name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !["LLC", "INC", "CORP", "COMPANY", "THE", "AND", "SERVICES"].includes(t)),
  );
}

export function namesLikelySame(a: string, b: string) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

export function crossCheck(input: CrossCheckInput): CaseFinding[] {
  const out: CaseFinding[] = [];
  const permitKeys = normalizePermitNumber(input.permit.permitNumber);
  const docs = input.items.filter((i) => i.type !== "photo");

  // 1. Permit references.
  for (const item of docs) {
    for (const f of item.fields.filter((x) => x.field === "permit_reference")) {
      const k = normalizePermitNumber(f.value);
      const matches = Boolean(k && permitKeys && k.looseKey === permitKeys.looseKey);
      out.push({
        kind: matches ? "check" : "conflict",
        field: "permit_reference",
        value: f.value,
        provenance: "extracted",
        message: matches
          ? `${item.filename} references this permit (${f.value}).`
          : `${item.filename} references permit ${f.value}, but this case concerns permit ${input.permit.permitNumber}.`,
        severity: matches ? "info" : "warning",
        sourceRefs: [ref(item.id, f), { permitId: input.permit.id, field: "permitNumber", quote: input.permit.permitNumber }],
        fingerprint: fp(["permit_reference", item.id, f.value]),
      });
    }
  }

  // 2. Property address.
  const recordAddr = streetKey(input.propertyAddress);
  for (const item of docs) {
    for (const f of item.fields.filter((x) => x.field === "property_address")) {
      const docAddr = streetKey(f.value);
      if (!recordAddr || !docAddr) continue;
      const same = recordAddr.number === docAddr.number && recordAddr.street === docAddr.street;
      out.push({
        kind: same ? "check" : "conflict",
        field: "property_address",
        value: f.value,
        provenance: "extracted",
        message: same
          ? `${item.filename} job-site address matches the property record.`
          : `${item.filename} lists job site "${f.value}", but the property record is "${input.propertyAddress}".`,
        severity: same ? "info" : "warning",
        sourceRefs: [ref(item.id, f), { permitId: input.permit.id, field: "propertyAddress", quote: input.propertyAddress ?? undefined }],
        fingerprint: fp(["property_address", item.id, f.value]),
      });
    }
  }

  // 3. Completion dates: applicant claim vs documents, and documents vs issuance.
  const docCompletion = docs.flatMap((i) => i.fields.filter((f) => f.field === "completion_date" && f.normalized).map((f) => ({ item: i, f })));
  const claim = input.claims;
  if (claim?.completionDate) {
    for (const { item, f } of docCompletion) {
      const delta = Math.abs(daysBetween(claim.completionDate, f.normalized!));
      if (delta > COMPLETION_DATE_TOLERANCE_DAYS) {
        out.push({
          kind: "conflict",
          field: "completion_date",
          value: `${claim.completionDate} vs ${f.normalized}`,
          provenance: "applicant_claim",
          message: `Applicant states the work was completed on ${claim.completionDate}; ${item.filename} states completion on ${f.normalized} (${delta} days apart). Both records are preserved for the reviewer.`,
          severity: "warning",
          sourceRefs: [{ submissionId: claim.submissionId, field: "completionDateClaimed", quote: claim.completionDate }, ref(item.id, f)],
          fingerprint: fp(["completion_conflict", claim.submissionId, item.id, claim.completionDate, f.normalized]),
        });
      } else {
        out.push({
          kind: "check",
          field: "completion_date",
          value: f.normalized,
          provenance: "extracted",
          message: `Applicant's stated completion date is consistent with ${item.filename} (within ${COMPLETION_DATE_TOLERANCE_DAYS} days).`,
          severity: "info",
          sourceRefs: [{ submissionId: claim.submissionId, field: "completionDateClaimed", quote: claim.completionDate }, ref(item.id, f)],
          fingerprint: fp(["completion_consistent", claim.submissionId, item.id, claim.completionDate, f.normalized]),
        });
      }
    }
  }
  if (input.permit.issuedAt) {
    for (const { item, f } of docCompletion) {
      if (f.normalized! < input.permit.issuedAt) {
        out.push({
          kind: "conflict",
          field: "completion_date",
          value: f.normalized,
          provenance: "extracted",
          message: `${item.filename} dates completion (${f.normalized}) before the permit was issued (${input.permit.issuedAt}).`,
          severity: "warning",
          sourceRefs: [ref(item.id, f), { permitId: input.permit.id, field: "issuedAt", quote: input.permit.issuedAt }],
          fingerprint: fp(["completion_before_issue", item.id, f.normalized]),
        });
      }
    }
    if (claim?.completionDate && claim.completionDate < input.permit.issuedAt) {
      out.push({
        kind: "conflict",
        field: "completion_date",
        value: claim.completionDate,
        provenance: "applicant_claim",
        message: `Applicant's stated completion date (${claim.completionDate}) precedes permit issuance (${input.permit.issuedAt}).`,
        severity: "warning",
        sourceRefs: [{ submissionId: claim.submissionId, field: "completionDateClaimed", quote: claim.completionDate }, { permitId: input.permit.id, field: "issuedAt" }],
        fingerprint: fp(["claim_before_issue", claim.submissionId, claim.completionDate]),
      });
    }
  }

  // 4. Contractor license and name.
  for (const item of docs) {
    for (const f of item.fields.filter((x) => x.field === "contractor_license")) {
      if (input.permit.contractorLicense && f.normalized !== input.permit.contractorLicense) {
        out.push({
          kind: "conflict",
          field: "contractor_license",
          value: f.value,
          provenance: "extracted",
          message: `${item.filename} shows contractor license ${f.value}; the permit record lists ${input.permit.contractorLicense}.`,
          severity: "warning",
          sourceRefs: [ref(item.id, f), { permitId: input.permit.id, field: "contractorLicense", quote: input.permit.contractorLicense }],
          fingerprint: fp(["license", item.id, f.value]),
        });
      }
    }
    for (const f of item.fields.filter((x) => x.field === "contractor_name")) {
      if (input.permit.contractorName && !namesLikelySame(f.value, input.permit.contractorName)) {
        out.push({
          kind: "warning",
          field: "contractor_name",
          value: f.value,
          provenance: "extracted",
          message: `${item.filename} names "${f.value}"; the permit lists "${input.permit.contractorName}". May indicate a subcontractor or a different job.`,
          severity: "warning",
          sourceRefs: [ref(item.id, f), { permitId: input.permit.id, field: "contractorName", quote: input.permit.contractorName }],
          fingerprint: fp(["contractor_name", item.id, f.value]),
        });
      }
    }
  }
  if (claim?.contractorName && input.permit.contractorName && !namesLikelySame(claim.contractorName, input.permit.contractorName)) {
    out.push({
      kind: "warning",
      field: "contractor_name",
      value: claim.contractorName,
      provenance: "applicant_claim",
      message: `Applicant names contractor "${claim.contractorName}"; the permit lists "${input.permit.contractorName}".`,
      severity: "warning",
      sourceRefs: [{ submissionId: claim.submissionId, field: "contractorNameClaimed", quote: claim.contractorName }, { permitId: input.permit.id, field: "contractorName" }],
      fingerprint: fp(["claim_contractor", claim.submissionId, claim.contractorName]),
    });
  }

  // 5. Applicant documents asserting an inspection the municipal record lacks.
  for (const item of docs) {
    for (const f of item.fields.filter((x) => x.field === "inspection_assertion")) {
      if (!input.passedFinalOnRecord) {
        out.push({
          kind: "warning",
          field: "inspection_assertion",
          value: f.value,
          provenance: "applicant_claim",
          message: `${item.filename} asserts "${f.value}", but municipal records show no final inspection. An applicant-supplied document cannot establish that an inspection occurred; verify against the system of record.`,
          severity: "critical",
          sourceRefs: [ref(item.id, f)],
          fingerprint: fp(["inspection_assertion", item.id, f.value]),
        });
      }
    }
  }

  // 6. Explicit unknowns for documents that should carry dates.
  for (const item of docs.filter((i) => i.type === "invoice" || i.type === "contract")) {
    const hasDate = item.fields.some((f) => (f.field === "completion_date" || f.field === "invoice_date") && f.normalized);
    if (!hasDate) {
      out.push({
        kind: "unknown",
        field: "completion_date",
        value: null,
        provenance: "unknown",
        message: `No completion or invoice date was found in ${item.filename}. The date of work is unknown from this document.`,
        severity: "info",
        sourceRefs: [{ evidenceItemId: item.id }],
        fingerprint: fp(["no_date", item.id]),
      });
    }
  }
  if (claim && !claim.completionDate) {
    out.push({
      kind: "unknown",
      field: "completion_date",
      value: null,
      provenance: "unknown",
      message: "The applicant did not state when the work was completed.",
      severity: "info",
      sourceRefs: [{ submissionId: claim.submissionId }],
      fingerprint: fp(["claim_no_date", claim.submissionId]),
    });
  }

  // 7. Photo limitation, stated once per case with photos.
  const photos = input.items.filter((i) => i.type === "photo");
  if (photos.length) {
    out.push({
      kind: "check",
      field: "photos",
      value: String(photos.length),
      provenance: "verified_record",
      message: `${photos.length} photograph(s) received. ${PHOTO_LIMITATION}`,
      severity: "info",
      sourceRefs: photos.map((p) => ({ evidenceItemId: p.id })),
      fingerprint: fp(["photos", photos.map((p) => p.id).sort()]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export interface ChecklistRequirement {
  id: string;
  acceptedTypes: string[];
  minCount: number;
  status: string;
}

export interface ChecklistItem {
  id: string;
  type: string;
  reviewStatus: string;
}

/** Computes missing/provided for requirements not yet decided by a reviewer. */
export function evaluateChecklist(reqs: ChecklistRequirement[], items: ChecklistItem[], statementComplete: boolean) {
  return reqs.map((r) => {
    if (r.status === "accepted" || r.status === "waived" || r.status === "rejected") return { id: r.id, status: r.status, satisfiedBy: [] as string[] };
    const matching = items.filter((i) => i.reviewStatus !== "rejected" && r.acceptedTypes.includes(i.type)).map((i) => i.id);
    const statementOk = r.acceptedTypes.includes("applicant_statement") && statementComplete;
    const provided = statementOk || matching.length >= r.minCount;
    return { id: r.id, status: provided ? "provided" : "missing", satisfiedBy: matching };
  });
}
