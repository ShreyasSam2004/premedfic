/**
 * Evidence vocabulary: document types, provenance classes, and requirement statuses.
 */

export const EVIDENCE_TYPES = [
  "invoice",
  "contract",
  "inspection_report",
  "permit_document",
  "completion_record",
  "correspondence",
  "photo",
  "authorization_letter",
  "unknown",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  invoice: "Contractor invoice",
  contract: "Contract / agreement",
  inspection_report: "Inspection document",
  permit_document: "Permit document",
  completion_record: "Work-completion record",
  correspondence: "Correspondence",
  photo: "Photograph",
  authorization_letter: "Representative authorization",
  unknown: "Unclassified document",
};

/**
 * Every fact shown to a reviewer or written into a packet carries exactly one provenance class.
 * These are deliberately distinct so AI-extracted text is never presented as verified.
 */
export const PROVENANCE = ["verified_record", "applicant_claim", "extracted", "ai_extracted", "inference", "unknown"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const PROVENANCE_META: Record<Provenance, { label: string; description: string }> = {
  verified_record: { label: "Verified record", description: "From the municipal source of record or recorded by authorized staff." },
  applicant_claim: { label: "Applicant claim", description: "Stated by the homeowner or representative. Not independently verified." },
  extracted: { label: "Extracted (deterministic)", description: "Pattern-matched from document text with a verbatim source quote." },
  ai_extracted: { label: "AI-extracted", description: "Produced by a model, schema-validated, and quote-checked. Not verified." },
  inference: { label: "Inference", description: "Derived by the system from other facts. Not a recorded fact." },
  unknown: { label: "Unknown", description: "Not present in the available records or documents." },
};

export const REQUIREMENT_STATUSES = ["missing", "provided", "accepted", "rejected", "waived"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  missing: "Missing",
  provided: "Provided — pending review",
  accepted: "Accepted by reviewer",
  rejected: "Rejected by reviewer",
  waived: "Waived by reviewer",
};

export const FINDING_KINDS = ["fact", "check", "conflict", "unknown", "warning", "untrusted_instruction"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const PHOTO_LIMITATION =
  "Photographs can show visible conditions only. They cannot establish when concealed work was performed, whether concealed work complies with code, or whether an inspection occurred.";

export const ALLOWED_UPLOAD_TYPES = {
  "application/pdf": { ext: [".pdf"], label: "PDF" },
  "image/jpeg": { ext: [".jpg", ".jpeg"], label: "JPEG image" },
  "image/png": { ext: [".png"], label: "PNG image" },
} as const;
export type AllowedMime = keyof typeof ALLOWED_UPLOAD_TYPES;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
