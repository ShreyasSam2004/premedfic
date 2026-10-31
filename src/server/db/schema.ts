/**
 * PremedFix relational schema (PostgreSQL).
 *
 * Conventions
 * - Every tenant-owned row carries `org_id`; all service queries filter on it.
 * - Original imported rows live in `permit_source_records.raw`, separate from normalized `permits`.
 * - `audit_events` and `workflow_transitions` are append-only (enforced by DB triggers, see migrations).
 * - Calendar dates (issued/expires/final) are stored as DATE strings; instants as timestamptz.
 */
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CASE_STATES } from "../../domain/workflow";
import { STAFF_ROLES } from "../../domain/roles";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const pk = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => ts("created_at").notNull().defaultNow();
const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id);

export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);
export const caseStateEnum = pgEnum("case_state", CASE_STATES);

// ---------------------------------------------------------------------------
// Organizations, jurisdictions, identity
// ---------------------------------------------------------------------------

export interface OrgSettings {
  /** Must be explicitly enabled before any record is sent to a third-party AI provider. */
  aiProcessingAuthorized: boolean;
  /** Assumption used for the clearly-labeled "estimated time saved" metric. */
  manualResearchMinutesPerCase: number;
  evidenceRetentionDays: number;
}

export const organizations = pgTable("organizations", {
  id: pk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").$type<OrgSettings>().notNull(),
  createdAt: createdAt(),
});

export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: pk(),
    orgId: orgRef(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    state: text("state"),
    departmentName: text("department_name").notNull(),
    departmentPhone: text("department_phone"),
    departmentEmail: text("department_email"),
    isReferenceExample: boolean("is_reference_example").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("jurisdictions_org_code").on(t.orgId, t.code)],
);

export const users = pgTable("users", {
  id: pk(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  title: text("title"),
  passwordHash: text("password_hash").notNull(),
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: staffRoleEnum("role").notNull(),
    specialties: jsonb("specialties").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_org").on(t.userId, t.orgId)],
);

export const sessions = pgTable("sessions", {
  id: pk(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  orgId: orgRef(),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});

// ---------------------------------------------------------------------------
// Properties, permits, imports
// ---------------------------------------------------------------------------

export const properties = pgTable(
  "properties",
  {
    id: pk(),
    orgId: orgRef(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    parcelId: text("parcel_id"),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    normalizedAddress: text("normalized_address"),
    createdAt: createdAt(),
  },
  (t) => [index("properties_org_parcel").on(t.orgId, t.parcelId), index("properties_org_addr").on(t.orgId, t.normalizedAddress)],
);

export const permitImportBatches = pgTable("permit_import_batches", {
  id: pk(),
  orgId: orgRef(),
  jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id),
  filename: text("filename").notNull(),
  fileSha256: text("file_sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  sourceSystem: text("source_system"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  status: text("status", { enum: ["uploaded", "processing", "completed", "failed"] }).notNull(),
  headers: jsonb("headers").$type<string[]>().notNull(),
  columnMapping: jsonb("column_mapping").$type<Record<string, string | null>>(),
  rowCount: integer("row_count").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  duplicateFlagCount: integer("duplicate_flag_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});

export interface FieldWarning {
  field: string;
  message: string;
  raw?: string | null;
}

export const permits = pgTable(
  "permits",
  {
    id: pk(),
    orgId: orgRef(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    propertyId: uuid("property_id").references(() => properties.id),
    permitNumber: text("permit_number").notNull(),
    permitKey: text("permit_key").notNull(),
    permitLooseKey: text("permit_loose_key").notNull(),
    category: text("category"),
    rawCategory: text("raw_category"),
    workDescription: text("work_description"),
    issuedAt: date("issued_at", { mode: "string" }),
    expiresAt: date("expires_at", { mode: "string" }),
    sourceStatusRaw: text("source_status_raw"),
    sourceStatus: text("source_status").notNull().default("unknown"),
    finalInspectionAt: date("final_inspection_at", { mode: "string" }),
    contractorName: text("contractor_name"),
    contractorLicense: text("contractor_license"),
    sourceSystem: text("source_system"),
    sourceRecordId: text("source_record_id"),
    missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
    fieldWarnings: jsonb("field_warnings").$type<FieldWarning[]>().notNull().default([]),
    duplicateOfPermitId: uuid("duplicate_of_permit_id"),
    lastImportBatchId: uuid("last_import_batch_id").references(() => permitImportBatches.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("permits_org_juris_key").on(t.orgId, t.jurisdictionId, t.permitKey),
    index("permits_org_loose").on(t.orgId, t.permitLooseKey),
    index("permits_property").on(t.propertyId),
  ],
);

export const permitSourceRecords = pgTable(
  "permit_source_records",
  {
    id: pk(),
    orgId: orgRef(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => permitImportBatches.id),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    rowHash: text("row_hash").notNull(),
    sourceSystem: text("source_system"),
    sourceRecordId: text("source_record_id"),
    permitId: uuid("permit_id").references(() => permits.id),
    outcome: text("outcome", { enum: ["created", "updated", "unchanged", "error", "duplicate_in_file"] }).notNull(),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<FieldWarning[]>().notNull().default([]),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("source_records_batch_row").on(t.batchId, t.rowNumber), index("source_records_permit").on(t.permitId)],
);

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: pk(),
    orgId: orgRef(),
    permitId: uuid("permit_id")
      .notNull()
      .references(() => permits.id),
    candidatePermitId: uuid("candidate_permit_id")
      .notNull()
      .references(() => permits.id),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    status: text("status", { enum: ["open", "confirmed", "dismissed"] }).notNull().default("open"),
    primaryPermitId: uuid("primary_permit_id"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dup_pair").on(t.permitId, t.candidatePermitId)],
);

export const inspectionRecords = pgTable("inspection_records", {
  id: pk(),
  orgId: orgRef(),
  permitId: uuid("permit_id")
    .notNull()
    .references(() => permits.id),
  caseId: uuid("case_id"),
  inspectionType: text("inspection_type", { enum: ["final", "site_assessment", "rough", "other"] }).notNull(),
  result: text("result", { enum: ["passed", "failed", "partial", "not_performed"] }).notNull(),
  inspectedAt: ts("inspected_at").notNull(),
  inspectorName: text("inspector_name"),
  inspectorUserId: uuid("inspector_user_id").references(() => users.id),
  source: text("source", { enum: ["imported", "recorded"] }).notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Rules and triage
// ---------------------------------------------------------------------------

export const ruleSets = pgTable(
  "rule_sets",
  {
    id: pk(),
    orgId: orgRef(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "active", "superseded"] }).notNull(),
    verificationStatus: text("verification_status", { enum: ["verified", "unverified"] }).notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    sourceCitation: text("source_citation").notNull(),
    sourceUrl: text("source_url"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: ts("reviewed_at"),
    changeSummary: text("change_summary"),
    config: jsonb("config").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    activatedAt: ts("activated_at"),
    activatedBy: uuid("activated_by").references(() => users.id),
    supersededAt: ts("superseded_at"),
  },
  (t) => [uniqueIndex("rule_sets_juris_version").on(t.jurisdictionId, t.version)],
);

export const cases = pgTable(
  "cases",
  {
    id: pk(),
    orgId: orgRef(),
    permitId: uuid("permit_id")
      .notNull()
      .unique()
      .references(() => permits.id),
    status: caseStateEnum("status").notNull().default("IMPORTED"),
    version: integer("version").notNull().default(1),
    classification: text("classification"),
    priority: text("priority"),
    priorityScore: integer("priority_score"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    specialistUserId: uuid("specialist_user_id").references(() => users.id),
    currentTriageId: uuid("current_triage_id"),
    manualOutreachRequired: boolean("manual_outreach_required").notNull().default(false),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    openedAt: ts("opened_at").notNull(),
    closedAt: ts("closed_at"),
    lastTransitionAt: ts("last_transition_at").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("cases_org_status").on(t.orgId, t.status), index("cases_assigned").on(t.assignedUserId)],
);

export const caseAssignments = pgTable("case_assignments", {
  id: pk(),
  orgId: orgRef(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind", { enum: ["primary", "specialist"] }).notNull(),
  assignedBy: uuid("assigned_by").references(() => users.id),
  assignedAt: ts("assigned_at").notNull(),
  endedAt: ts("ended_at"),
});

export interface TriageEscalation {
  ruleId: string;
  message: string;
  discipline?: string;
}

export const triageResults = pgTable(
  "triage_results",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    permitId: uuid("permit_id")
      .notNull()
      .references(() => permits.id),
    ruleSetId: uuid("rule_set_id").references(() => ruleSets.id),
    ruleSetVersion: integer("rule_set_version"),
    ruleSetVerified: boolean("rule_set_verified").notNull(),
    engineVersion: text("engine_version").notNull(),
    classification: text("classification").notNull(),
    pathway: text("pathway").notNull(),
    priority: text("priority").notNull(),
    priorityScore: integer("priority_score").notNull(),
    humanReviewRequired: boolean("human_review_required").notNull(),
    specialistRequired: boolean("specialist_required").notNull(),
    siteInspectionRequired: boolean("site_inspection_required").notNull(),
    specialistDiscipline: text("specialist_discipline"),
    agedPermitEligible: boolean("aged_permit_eligible").notNull().default(false),
    recommendedAction: text("recommended_action").notNull(),
    explanation: text("explanation").notNull(),
    escalations: jsonb("escalations").$type<TriageEscalation[]>().notNull(),
    requiredEvidence: jsonb("required_evidence").notNull(),
    completeness: jsonb("completeness").$type<{ score: number; missing: string[] }>().notNull(),
    permitAgeDays: integer("permit_age_days"),
    daysSinceExpiration: integer("days_since_expiration"),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    computedAt: ts("computed_at").notNull(),
    computedBy: text("computed_by").notNull(),
  },
  (t) => [index("triage_case").on(t.caseId)],
);

export const ruleEvaluations = pgTable("rule_evaluations", {
  id: pk(),
  triageResultId: uuid("triage_result_id")
    .notNull()
    .references(() => triageResults.id),
  ruleId: text("rule_id").notNull(),
  ruleVersion: text("rule_version").notNull(),
  outcome: text("outcome", { enum: ["triggered", "passed", "not_applicable"] }).notNull(),
  sourceFields: jsonb("source_fields").$type<Record<string, unknown>>().notNull(),
  explanation: text("explanation").notNull(),
});

// ---------------------------------------------------------------------------
// Contacts and communications
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: pk(),
  orgId: orgRef(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  role: text("role", { enum: ["owner", "representative", "applicant", "contractor"] }).notNull(),
  source: text("source", { enum: ["import", "staff", "portal"] }).notNull(),
  verificationStatus: text("verification_status", { enum: ["unverified", "owner_of_record_verified", "rejected"] })
    .notNull()
    .default("unverified"),
  optOutEmail: boolean("opt_out_email").notNull().default(false),
  optOutSms: boolean("opt_out_sms").notNull().default(false),
  preferredChannel: text("preferred_channel", { enum: ["email", "sms", "letter"] }),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const contactVerifications = pgTable("contact_verifications", {
  id: pk(),
  orgId: orgRef(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  method: text("method", { enum: ["property_records_match", "portal_code", "staff_document_review", "representative_authorization"] }).notNull(),
  status: text("status", { enum: ["verified", "failed", "pending"] }).notNull(),
  note: text("note"),
  performedByType: text("performed_by_type", { enum: ["user", "homeowner", "system"] }).notNull(),
  performedBy: text("performed_by"),
  createdAt: createdAt(),
});

export const communications = pgTable(
  "communications",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
    channel: text("channel", { enum: ["email", "sms", "letter", "phone", "in_person", "portal"] }).notNull(),
    purpose: text("purpose", {
      enum: ["initial_notice", "info_request", "follow_up", "verification_code", "status_update", "manual_outreach"],
    }).notNull(),
    templateId: text("template_id"),
    templateVersion: integer("template_version"),
    subject: text("subject"),
    body: text("body").notNull(),
    recipientDisplay: text("recipient_display"),
    status: text("status", { enum: ["draft", "approved", "sent_simulated", "cancelled", "failed", "logged"] }).notNull(),
    adapter: text("adapter"),
    adapterMessageId: text("adapter_message_id"),
    createdBy: uuid("created_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    sentAt: ts("sent_at"),
    followUpDueAt: ts("follow_up_due_at"),
    responseStatus: text("response_status", { enum: ["none", "opened", "verified", "submitted"] }).notNull().default("none"),
    respondedAt: ts("responded_at"),
    cancelledReason: text("cancelled_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("comms_case").on(t.caseId), index("comms_org_status").on(t.orgId, t.status)],
);

export const portalGrants = pgTable("portal_grants", {
  id: pk(),
  orgId: orgRef(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id),
  communicationId: uuid("communication_id").references(() => communications.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  codeHash: text("code_hash"),
  codeExpiresAt: ts("code_expires_at"),
  codeAttempts: integer("code_attempts").notNull().default(0),
  verifiedAt: ts("verified_at"),
  relationship: text("relationship", { enum: ["owner", "representative"] }),
  lastAccessAt: ts("last_access_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface RequirementSpec {
  code: string;
  label: string;
  description: string;
  acceptedTypes: string[];
  minCount: number;
  required: boolean;
}

export const evidenceRequirements = pgTable(
  "evidence_requirements",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    acceptedTypes: jsonb("accepted_types").$type<string[]>().notNull(),
    minCount: integer("min_count").notNull().default(1),
    required: boolean("required").notNull().default(true),
    status: text("status", { enum: ["missing", "provided", "accepted", "rejected", "waived"] }).notNull().default("missing"),
    ruleSetVersion: integer("rule_set_version"),
    satisfiedBy: jsonb("satisfied_by").$type<string[]>().notNull().default([]),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("requirements_case_code").on(t.caseId, t.code)],
);

export const evidenceSubmissions = pgTable("evidence_submissions", {
  id: pk(),
  orgId: orgRef(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  grantId: uuid("grant_id").references(() => portalGrants.id),
  submittedByType: text("submitted_by_type", { enum: ["homeowner", "staff"] }).notNull(),
  submittedById: text("submitted_by_id").notNull(),
  submitterName: text("submitter_name"),
  relationship: text("relationship", { enum: ["owner", "representative", "staff"] }).notNull(),
  workDescription: text("work_description"),
  completionDateClaimed: date("completion_date_claimed", { mode: "string" }),
  contractorNameClaimed: text("contractor_name_claimed"),
  contractorLicenseClaimed: text("contractor_license_claimed"),
  notes: text("notes"),
  status: text("status", { enum: ["open", "submitted"] }).notNull(),
  submittedAt: ts("submitted_at"),
  createdAt: createdAt(),
});

export interface SourceRef {
  evidenceItemId?: string;
  submissionId?: string;
  permitId?: string;
  field?: string;
  page?: number;
  start?: number;
  end?: number;
  quote?: string;
}

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    submissionId: uuid("submission_id").references(() => evidenceSubmissions.id),
    uploadedByType: text("uploaded_by_type", { enum: ["homeowner", "staff"] }).notNull(),
    uploadedById: text("uploaded_by_id").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    declaredType: text("declared_type"),
    classifiedType: text("classified_type"),
    classificationMethod: text("classification_method"),
    classificationConfidence: text("classification_confidence"),
    classificationSignals: jsonb("classification_signals").$type<string[]>(),
    processingStatus: text("processing_status", { enum: ["received", "processing", "processed", "failed"] }).notNull(),
    processingError: text("processing_error"),
    pageCount: integer("page_count"),
    extractedText: text("extracted_text"),
    textExtractionMethod: text("text_extraction_method"),
    reviewStatus: text("review_status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("evidence_case_sha").on(t.caseId, t.sha256), index("evidence_case").on(t.caseId)],
);

export const evidenceFindings = pgTable(
  "evidence_findings",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    evidenceItemId: uuid("evidence_item_id").references(() => evidenceItems.id),
    scope: text("scope", { enum: ["item", "case"] }).notNull(),
    kind: text("kind", { enum: ["fact", "check", "conflict", "unknown", "warning", "untrusted_instruction"] }).notNull(),
    field: text("field"),
    value: text("value"),
    provenance: text("provenance", {
      enum: ["verified_record", "applicant_claim", "extracted", "ai_extracted", "inference", "unknown"],
    }).notNull(),
    method: text("method").notNull(),
    modelVersion: text("model_version"),
    confidence: text("confidence"),
    sourceRefs: jsonb("source_refs").$type<SourceRef[]>().notNull().default([]),
    message: text("message").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    fingerprint: text("fingerprint"),
    createdAt: createdAt(),
  },
  (t) => [index("findings_case").on(t.caseId), index("findings_item").on(t.evidenceItemId)],
);

// ---------------------------------------------------------------------------
// Review, disposition, workflow, audit
// ---------------------------------------------------------------------------

export interface SignatureMeta {
  name: string;
  title: string | null;
  role: string;
  userId: string;
  signedAt: string;
  method: "authenticated_session_attestation";
  attestation: string;
}

export const reviewDecisions = pgTable(
  "review_decisions",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    decisionType: text("decision_type", {
      enum: [
        "request_information",
        "request_corrected_documents",
        "require_inspection",
        "assign_specialist",
        "specialist_assessment",
        "mark_ready",
        "return_to_review",
        "official_determination",
        "requirement_review",
        "conflict_resolution",
        "evidence_review",
        "reconciliation",
      ],
    }).notNull(),
    determination: text("determination"),
    summary: text("summary").notNull(),
    reason: text("reason"),
    suggestedAction: text("suggested_action"),
    overrodeSuggestion: boolean("overrode_suggestion").notNull().default(false),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull(),
    signature: jsonb("signature").$type<SignatureMeta>(),
    ruleSetId: uuid("rule_set_id"),
    ruleSetVersion: integer("rule_set_version"),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_case").on(t.caseId)],
);

export const dispositionSubmissions = pgTable("disposition_submissions", {
  id: pk(),
  orgId: orgRef(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id),
  decisionId: uuid("decision_id")
    .notNull()
    .references(() => reviewDecisions.id),
  adapter: text("adapter").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["submitted", "confirmed", "rejected"] }).notNull(),
  externalReference: text("external_reference"),
  submittedAt: ts("submitted_at").notNull(),
  respondedAt: ts("responded_at"),
  confirmedByType: text("confirmed_by_type", { enum: ["system", "user"] }),
  confirmedBy: text("confirmed_by"),
  responseNote: text("response_note"),
});

export const workflowTransitions = pgTable(
  "workflow_transitions",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    transition: text("transition").notNull(),
    fromState: caseStateEnum("from_state").notNull(),
    toState: caseStateEnum("to_state").notNull(),
    actorType: text("actor_type", { enum: ["user", "homeowner", "system"] }).notNull(),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("transitions_idem").on(t.caseId, t.idempotencyKey), index("transitions_case").on(t.caseId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: uuid("id").notNull().defaultRandom().unique(),
    orgId: orgRef(),
    occurredAt: ts("occurred_at").notNull(),
    actorType: text("actor_type", { enum: ["user", "homeowner", "system"] }).notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    caseId: uuid("case_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_org_seq").on(t.orgId, t.seq), index("audit_case").on(t.caseId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    orgId: uuid("org_id").references(() => organizations.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lockedAt: ts("locked_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("jobs_status").on(t.status)],
);

/**
 * Stand-in for an external email/SMS provider's mailbox. Only the simulated
 * delivery adapter writes here. Unlike `communications` (our record, where
 * portal tokens are redacted), this holds the message as the recipient would
 * receive it, so the demo can follow the link. Not present with real providers.
 */
export const simulatedMailbox = pgTable("simulated_mailbox", {
  id: pk(),
  orgId: orgRef(),
  communicationId: uuid("communication_id").references(() => communications.id),
  channel: text("channel").notNull(),
  toAddress: text("to_address").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  deliveredAt: ts("delivered_at").notNull(),
});

/**
 * Checks of a reported final against the permit system of record. Append-only
 * (database trigger): each check is evidence, and a later check never rewrites
 * an earlier one. The latest row for a case governs.
 */
export const finalizationVerifications = pgTable(
  "finalization_verifications",
  {
    id: pk(),
    orgId: orgRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    permitId: uuid("permit_id")
      .notNull()
      .references(() => permits.id),
    outcome: text("outcome", { enum: ["confirmed", "not_confirmed"] }).notNull(),
    method: text("method", { enum: ["system_of_record", "manual"] }).notNull(),
    /** What the source reported at the time of the check. */
    reportedStatus: text("reported_status"),
    reportedFinalAt: date("reported_final_at", { mode: "string" }),
    /** What the system of record shows. */
    sourceReference: text("source_reference").notNull(),
    sourceStatus: text("source_status"),
    sourceFinalAt: date("source_final_at", { mode: "string" }),
    note: text("note").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull().default({}),
    actorType: text("actor_type", { enum: ["user", "system"] }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("finalization_case").on(t.caseId)],
);
export type FinalizationVerification = typeof finalizationVerifications.$inferSelect;

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.from(v),
});

/**
 * File storage for hosts without a durable local disk (STORAGE_DRIVER=database).
 * Keys are the same content-addressed keys the filesystem adapter uses.
 */
export const storedObjects = pgTable("stored_objects", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  size: integer("size").notNull(),
  createdAt: ts("created_at").notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type Jurisdiction = typeof jurisdictions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Permit = typeof permits.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type RuleSetRow = typeof ruleSets.$inferSelect;
export type TriageResultRow = typeof triageResults.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type EvidenceFinding = typeof evidenceFindings.$inferSelect;
export type EvidenceRequirement = typeof evidenceRequirements.$inferSelect;
export type EvidenceSubmission = typeof evidenceSubmissions.$inferSelect;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;
export type InspectionRecord = typeof inspectionRecords.$inferSelect;
export type PortalGrant = typeof portalGrants.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Job = typeof jobs.$inferSelect;
