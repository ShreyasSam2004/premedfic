/**
 * Advisory next-action suggestion for reviewers. Deterministic and explained.
 * A reviewer may choose any permitted action; choosing a different one
 * requires a recorded reason (enforced in the review service).
 */
import type { ReviewAction } from "../reviews/service";
import type { CaseDetail } from "./queries";

export function suggestReviewAction(d: CaseDetail): { action: ReviewAction; because: string } | null {
  const st = d.c.status;
  if (st === "EVIDENCE_RECEIVED") return { action: "begin_review", because: "Evidence was submitted and processed." };
  if (st !== "UNDER_STAFF_REVIEW") return null;
  const missing = d.requirements.filter((r) => r.required && (r.status === "missing" || r.status === "rejected"));
  const conflicts = d.findings.filter((f) => f.kind === "conflict" && f.status === "open");
  const injection = d.findings.some((f) => f.kind === "untrusted_instruction");
  const needsSpecialist = Boolean(d.triage?.specialistRequired) && !d.decisions.some((x) => x.decisionType === "specialist_assessment");
  const needsInspection = Boolean(d.triage?.siteInspectionRequired) && !d.inspections.some((i) => i.result === "passed" && (i.inspectionType === "final" || i.inspectionType === "site_assessment"));
  if (needsInspection) return { action: "require_inspection", because: "The active rule set requires a passed site inspection for this case." };
  if (conflicts.length) return { action: "request_corrected_documents", because: `${conflicts.length} unresolved conflict(s) between the applicant's statement and documents.` };
  if (missing.length) return { action: "request_information", because: `Required item(s) missing or rejected: ${missing.map((m) => m.label).join("; ")}.` };
  if (injection) return { action: "request_corrected_documents", because: "A document contains instruction-like text; consider requesting a clean copy." };
  if (needsSpecialist) return null;
  const pending = d.requirements.filter((r) => r.required && r.status === "provided");
  if (pending.length) return { action: "mark_ready", because: `All required items are provided; accept or reject ${pending.length} item(s) first, then mark ready.` };
  return { action: "mark_ready", because: "All required items are accepted or waived and no conflicts remain." };
}
