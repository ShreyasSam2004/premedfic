/**
 * The permit-case state machine.
 *
 * This module is the single source of truth for which workflow transitions
 * exist, who may perform them, and what must be true beforehand. It is pure:
 * the workflow service builds a {@link GuardSnapshot} from the database and
 * asks this module whether a transition is allowed. Nothing else in the
 * codebase changes a case's status.
 *
 * Note: no transition accepts an AI/model actor. Model output can only ever
 * appear as a *recommendation* attached to a human decision.
 */
import type { StaffRole } from "./roles";
import type { TriageClassification } from "./triage";

export const CASE_STATES = [
  "IMPORTED",
  "NEEDS_DATA_RECONCILIATION",
  "FINALIZATION_VERIFICATION",
  "TRIAGED",
  "AWAITING_CONTACT_APPROVAL",
  "OWNER_CONTACTED",
  "AWAITING_EVIDENCE",
  "EVIDENCE_RECEIVED",
  "UNDER_STAFF_REVIEW",
  "ADDITIONAL_INFORMATION_REQUIRED",
  "INSPECTION_REQUIRED",
  "READY_FOR_AUTHORIZED_DISPOSITION",
  "DISPOSITION_PENDING_CONFIRMATION",
  "OFFICIALLY_CLOSED",
  "OTHER_OFFICIAL_OUTCOME",
  "MERGED_DUPLICATE",
  "ALREADY_RESOLVED",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export type Tone = "neutral" | "info" | "attention" | "critical" | "review" | "pending" | "confirmed";

export type Phase = "intake" | "verification" | "outreach" | "evidence" | "review" | "disposition" | "resolved";

export const STATE_META: Record<CaseState, { label: string; tone: Tone; phase: Phase; open: boolean; description: string }> = {
  IMPORTED: { label: "Imported", tone: "neutral", phase: "intake", open: true, description: "Record imported; triage has not run." },
  NEEDS_DATA_RECONCILIATION: {
    label: "Needs data reconciliation",
    tone: "attention",
    phase: "intake",
    open: true,
    description: "Record is incomplete or possibly duplicated. A data steward must reconcile it before any outreach.",
  },
  FINALIZATION_VERIFICATION: {
    label: "Finalization verification pending",
    tone: "pending",
    phase: "verification",
    open: true,
    description:
      "A source reports this permit finaled. The permit system of record must confirm it before the record is treated as resolved. No owner outreach, evidence requests, or inspections meanwhile.",
  },
  TRIAGED: { label: "Triaged", tone: "neutral", phase: "intake", open: true, description: "Rules evaluated; awaiting the next administrative step." },
  AWAITING_CONTACT_APPROVAL: {
    label: "Notice awaiting approval",
    tone: "info",
    phase: "outreach",
    open: true,
    description: "A homeowner notice is drafted and must be approved by authorized staff before it is sent.",
  },
  OWNER_CONTACTED: { label: "Owner contacted", tone: "info", phase: "outreach", open: true, description: "Approved notice sent; awaiting owner response." },
  AWAITING_EVIDENCE: { label: "Awaiting evidence", tone: "info", phase: "evidence", open: true, description: "Owner verified on the portal; evidence not yet submitted." },
  EVIDENCE_RECEIVED: { label: "Evidence received", tone: "review", phase: "evidence", open: true, description: "Evidence submitted and processed; ready for staff review." },
  UNDER_STAFF_REVIEW: { label: "Under staff review", tone: "review", phase: "review", open: true, description: "A reviewer is assessing the case." },
  ADDITIONAL_INFORMATION_REQUIRED: {
    label: "Additional information required",
    tone: "attention",
    phase: "evidence",
    open: true,
    description: "Reviewer requested more or corrected information from the owner.",
  },
  INSPECTION_REQUIRED: { label: "Inspection required", tone: "critical", phase: "review", open: true, description: "A site inspection must be completed and recorded." },
  READY_FOR_AUTHORIZED_DISPOSITION: {
    label: "Ready for authorized disposition",
    tone: "review",
    phase: "disposition",
    open: true,
    description: "Review complete. Awaiting a determination by an authorized official. Nothing has been approved yet.",
  },
  DISPOSITION_PENDING_CONFIRMATION: {
    label: "Determination recorded — awaiting source-of-record confirmation",
    tone: "pending",
    phase: "disposition",
    open: true,
    description: "An authorized official recorded a determination and it was submitted to the municipal system of record. Not yet officially closed.",
  },
  OFFICIALLY_CLOSED: {
    label: "Officially closed",
    tone: "confirmed",
    phase: "resolved",
    open: false,
    description: "Authorized closure determination confirmed by the municipal system of record.",
  },
  OTHER_OFFICIAL_OUTCOME: {
    label: "Other official outcome",
    tone: "confirmed",
    phase: "resolved",
    open: false,
    description: "A non-closure determination (e.g. re-permit required, voided) was confirmed by the system of record.",
  },
  MERGED_DUPLICATE: {
    label: "Merged as duplicate",
    tone: "neutral",
    phase: "resolved",
    open: false,
    description: "Record confirmed as a duplicate of another permit record and merged. Not a permit closure.",
  },
  ALREADY_RESOLVED: {
    label: "Already resolved",
    tone: "confirmed",
    phase: "resolved",
    open: false,
    description: "Finalized before PremedFix. The permit system of record confirmed an existing final; PremedFix did not close this permit.",
  },
};

export const OPEN_STATES = CASE_STATES.filter((s) => STATE_META[s].open);
/**
 * The active backlog: open cases that genuinely need resolution work. A
 * reported final awaiting verification is open but sits in its own queue.
 */
export const UNRESOLVED_STATES = OPEN_STATES.filter((s) => s !== "FINALIZATION_VERIFICATION");
/** Workflow states from which a reported final can still divert a case to verification. */
const PRE_DISPOSITION_STATES: CaseState[] = [
  "IMPORTED",
  "TRIAGED",
  "NEEDS_DATA_RECONCILIATION",
  "AWAITING_CONTACT_APPROVAL",
  "OWNER_CONTACTED",
  "AWAITING_EVIDENCE",
  "EVIDENCE_RECEIVED",
  "UNDER_STAFF_REVIEW",
  "ADDITIONAL_INFORMATION_REQUIRED",
  "INSPECTION_REQUIRED",
];

/** States in which the case is waiting on the property owner. */
export const AWAITING_OWNER_STATES: CaseState[] = ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"];
/** States in which the case sits in a reviewer queue. */
export const REVIEW_QUEUE_STATES: CaseState[] = [
  "EVIDENCE_RECEIVED",
  "UNDER_STAFF_REVIEW",
  "INSPECTION_REQUIRED",
  "READY_FOR_AUTHORIZED_DISPOSITION",
  "DISPOSITION_PENDING_CONFIRMATION",
];
/** States from which homeowners may submit evidence through the portal. */
export const PORTAL_SUBMISSION_STATES: CaseState[] = ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"];

// ---------------------------------------------------------------------------
// Determinations recorded by authorized officials
// ---------------------------------------------------------------------------

export const DETERMINATION_TYPES = [
  "close_requirements_satisfied",
  "close_final_inspection_passed",
  "close_aged_permit_no_apparent_hazard",
  "require_new_permit",
  "void_permit",
  "refer_code_enforcement",
] as const;
export type DeterminationType = (typeof DETERMINATION_TYPES)[number];

export const DETERMINATION_META: Record<DeterminationType, { label: string; closes: boolean; description: string }> = {
  close_requirements_satisfied: {
    label: "Close — permit requirements determined satisfied",
    closes: true,
    description: "The official determined, on the reviewed record, that the permit's requirements have been satisfied.",
  },
  close_final_inspection_passed: {
    label: "Close — final inspection passed",
    closes: true,
    description: "A passed final inspection is on record.",
  },
  close_aged_permit_no_apparent_hazard: {
    label: "Close — aged-permit provision (local determination)",
    closes: true,
    description:
      "Only where the jurisdiction's verified rule set provides an aged-permit provision. Requires the official's own determination that no apparent safety hazards exist.",
  },
  require_new_permit: { label: "Require new permit", closes: false, description: "Owner must apply for a new permit for the work." },
  void_permit: { label: "Void permit (work not performed)", closes: false, description: "Record indicates the permitted work was not performed." },
  refer_code_enforcement: { label: "Refer to code enforcement", closes: false, description: "Refer the matter to code enforcement." },
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type ActorKind = StaffRole | "system" | "homeowner";

/** Facts about a case needed to evaluate preconditions. Built by the workflow service. */
export interface GuardSnapshot {
  classification: TriageClassification | null;
  specialistRequired: boolean;
  siteInspectionRequired: boolean;
  approvalAuthority: StaffRole[];
  agedPermitEligible: boolean;
  openDuplicateCandidates: number;
  confirmedDuplicateOf: string | null;
  missingEssentialFields: string[];
  pendingDraftNotice: boolean;
  approvedNoticeDispatched: boolean;
  contactable: boolean;
  homeownerVerified: boolean;
  submittedEvidenceCount: number;
  requirementsOutstanding: string[];
  openConflicts: number;
  specialistAssessmentRecorded: boolean;
  passedInspectionRecorded: boolean;
  inspectionRecordedSinceRequired: boolean;
  proposedDetermination: DeterminationType | null;
  recordedDetermination: DeterminationType | null;
  pendingSubmission: boolean;
  /** Latest system-of-record check of a reported final, if any. */
  finalizationVerification: "confirmed" | "not_confirmed" | null;
}

export const TRANSITION_IDS = [
  "complete_triage",
  "flag_reconciliation",
  "resolve_reconciliation",
  "route_finalization_verification",
  "confirm_prior_finalization",
  "finalization_not_confirmed",
  "merge_duplicate",
  "queue_notice",
  "withdraw_notice",
  "send_notice",
  "owner_verified",
  "submit_evidence",
  "begin_review",
  "begin_review_without_response",
  "request_information",
  "require_inspection",
  "record_inspection_result",
  "mark_ready_for_disposition",
  "return_to_review",
  "record_determination",
  "confirm_source_closure",
  "confirm_source_other_outcome",
  "source_rejected",
  "reopen_case",
] as const;
export type TransitionId = (typeof TRANSITION_IDS)[number];

export interface TransitionDef {
  id: TransitionId;
  label: string;
  from: readonly CaseState[];
  to: CaseState;
  actors: readonly ActorKind[];
  requiresReason: boolean;
  /** Returns unmet preconditions; an empty array means allowed. */
  guard?: (s: GuardSnapshot, actor: ActorKind) => string[];
}

const STAFF_INTAKE: ActorKind[] = ["admin", "clerk"];
const REVIEWERS: ActorKind[] = ["inspector", "official"];

function closureReadiness(s: GuardSnapshot): string[] {
  const problems: string[] = [];
  if (s.requirementsOutstanding.length > 0) {
    problems.push(`Required evidence not accepted or waived: ${s.requirementsOutstanding.join(", ")}`);
  }
  if (s.openConflicts > 0) problems.push(`${s.openConflicts} unresolved evidence conflict(s) must be resolved by a reviewer`);
  if (s.specialistRequired && !s.specialistAssessmentRecorded) problems.push("Specialist assessment has not been recorded");
  if (s.siteInspectionRequired && !s.passedInspectionRecorded) problems.push("Jurisdiction rules require a passed site inspection on record");
  return problems;
}

export const TRANSITIONS: Record<TransitionId, TransitionDef> = {
  complete_triage: {
    id: "complete_triage",
    label: "Complete triage",
    from: ["IMPORTED"],
    to: "TRIAGED",
    actors: ["system", ...STAFF_INTAKE],
    requiresReason: false,
    guard: (s) => (s.classification ? [] : ["Triage result is required"]),
  },
  flag_reconciliation: {
    id: "flag_reconciliation",
    label: "Route to data reconciliation",
    from: ["IMPORTED", "TRIAGED"],
    to: "NEEDS_DATA_RECONCILIATION",
    actors: ["system", ...STAFF_INTAKE],
    requiresReason: true,
  },
  resolve_reconciliation: {
    id: "resolve_reconciliation",
    label: "Mark reconciliation resolved",
    from: ["NEEDS_DATA_RECONCILIATION"],
    to: "TRIAGED",
    actors: [...STAFF_INTAKE],
    requiresReason: true,
    guard: (s) => {
      const p: string[] = [];
      if (s.openDuplicateCandidates > 0) p.push("Open duplicate candidates must be confirmed or dismissed");
      if (s.missingEssentialFields.length > 0) p.push(`Essential fields still missing: ${s.missingEssentialFields.join(", ")}`);
      if (s.classification === "FINALIZATION_CONFIRMATION" && s.finalizationVerification !== "not_confirmed") {
        p.push("A source reports this permit finaled; route it to finalization verification instead");
      }
      return p;
    },
  },
  route_finalization_verification: {
    id: "route_finalization_verification",
    label: "Route to finalization verification",
    from: PRE_DISPOSITION_STATES,
    to: "FINALIZATION_VERIFICATION",
    actors: ["system", ...STAFF_INTAKE, ...REVIEWERS],
    requiresReason: true,
    guard: (s) => {
      const p: string[] = [];
      if (s.classification !== "FINALIZATION_CONFIRMATION") p.push("Only records a source reports as finaled go to finalization verification");
      if (s.finalizationVerification === "not_confirmed") p.push("The system of record already showed this permit as not finaled");
      if (s.openDuplicateCandidates > 0) p.push("Open duplicate candidates must be resolved first");
      return p;
    },
  },
  confirm_prior_finalization: {
    id: "confirm_prior_finalization",
    label: "Confirm existing final (already resolved)",
    from: ["FINALIZATION_VERIFICATION"],
    to: "ALREADY_RESOLVED",
    actors: ["system", ...STAFF_INTAKE],
    requiresReason: true,
    guard: (s) => {
      const p: string[] = [];
      if (s.finalizationVerification !== "confirmed") p.push("Record the system of record's confirmation of the final first");
      if (s.openDuplicateCandidates > 0) p.push("Open duplicate candidates must be resolved first");
      return p;
    },
  },
  finalization_not_confirmed: {
    id: "finalization_not_confirmed",
    label: "Final not confirmed: return to the backlog",
    from: ["FINALIZATION_VERIFICATION"],
    to: "TRIAGED",
    actors: ["system", ...STAFF_INTAKE],
    requiresReason: true,
    guard: (s) => (s.finalizationVerification === "not_confirmed" ? [] : ["Record what the system of record shows first"]),
  },
  merge_duplicate: {
    id: "merge_duplicate",
    label: "Merge into primary record",
    from: ["NEEDS_DATA_RECONCILIATION"],
    to: "MERGED_DUPLICATE",
    actors: [...STAFF_INTAKE],
    requiresReason: true,
    guard: (s) => (s.confirmedDuplicateOf ? [] : ["Duplicate must be confirmed against a primary record"]),
  },
  queue_notice: {
    id: "queue_notice",
    label: "Submit notice for approval",
    from: ["TRIAGED"],
    to: "AWAITING_CONTACT_APPROVAL",
    actors: [...STAFF_INTAKE],
    requiresReason: false,
    guard: (s) => {
      const p: string[] = [];
      if (!s.contactable) p.push("No verified, contactable owner-of-record contact on file");
      if (!s.pendingDraftNotice) p.push("A drafted notice is required");
      if (s.classification === "MONITOR_ACTIVE") p.push("Permit is still active; outreach is not appropriate");
      if (s.classification === "FINALIZATION_CONFIRMATION" && s.finalizationVerification !== "not_confirmed") {
        p.push("A source reports this permit finaled; verify the final with the system of record before any owner outreach");
      }
      return p;
    },
  },
  withdraw_notice: {
    id: "withdraw_notice",
    label: "Withdraw notice",
    from: ["AWAITING_CONTACT_APPROVAL"],
    to: "TRIAGED",
    actors: [...STAFF_INTAKE, "manager"],
    requiresReason: true,
  },
  send_notice: {
    id: "send_notice",
    label: "Approve and send notice",
    from: ["AWAITING_CONTACT_APPROVAL"],
    to: "OWNER_CONTACTED",
    actors: ["admin", "clerk", "manager"],
    requiresReason: false,
    guard: (s) => (s.approvedNoticeDispatched ? [] : ["Notice must be approved and dispatched"]),
  },
  owner_verified: {
    id: "owner_verified",
    label: "Owner verified on portal",
    from: ["OWNER_CONTACTED"],
    to: "AWAITING_EVIDENCE",
    actors: ["homeowner", ...STAFF_INTAKE],
    requiresReason: false,
    guard: (s, actor) => (actor === "homeowner" && !s.homeownerVerified ? ["Portal verification incomplete"] : []),
  },
  submit_evidence: {
    id: "submit_evidence",
    label: "Submit evidence for review",
    from: ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"],
    to: "EVIDENCE_RECEIVED",
    actors: ["homeowner", ...STAFF_INTAKE],
    requiresReason: false,
    guard: (s, actor) => {
      const p: string[] = [];
      if (s.submittedEvidenceCount === 0) p.push("At least one processed evidence item is required");
      if (actor === "homeowner" && !s.homeownerVerified) p.push("Portal verification incomplete");
      return p;
    },
  },
  begin_review: {
    id: "begin_review",
    label: "Begin staff review",
    from: ["EVIDENCE_RECEIVED", "TRIAGED"],
    to: "UNDER_STAFF_REVIEW",
    actors: REVIEWERS,
    requiresReason: false,
  },
  begin_review_without_response: {
    id: "begin_review_without_response",
    label: "Begin review without owner response",
    from: ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"],
    to: "UNDER_STAFF_REVIEW",
    actors: REVIEWERS,
    requiresReason: true,
  },
  request_information: {
    id: "request_information",
    label: "Request information from owner",
    from: ["UNDER_STAFF_REVIEW", "EVIDENCE_RECEIVED"],
    to: "ADDITIONAL_INFORMATION_REQUIRED",
    actors: REVIEWERS,
    requiresReason: true,
    guard: (s) => (s.contactable || s.homeownerVerified ? [] : ["No verified owner contact to receive the request"]),
  },
  require_inspection: {
    id: "require_inspection",
    label: "Require site inspection",
    from: ["TRIAGED", "EVIDENCE_RECEIVED", "UNDER_STAFF_REVIEW"],
    to: "INSPECTION_REQUIRED",
    actors: REVIEWERS,
    requiresReason: true,
  },
  record_inspection_result: {
    id: "record_inspection_result",
    label: "Return to review with inspection result",
    from: ["INSPECTION_REQUIRED"],
    to: "UNDER_STAFF_REVIEW",
    actors: ["inspector"],
    requiresReason: false,
    guard: (s) => (s.inspectionRecordedSinceRequired ? [] : ["Record the inspection result first"]),
  },
  mark_ready_for_disposition: {
    id: "mark_ready_for_disposition",
    label: "Mark ready for authorized disposition",
    from: ["UNDER_STAFF_REVIEW"],
    to: "READY_FOR_AUTHORIZED_DISPOSITION",
    actors: REVIEWERS,
    requiresReason: false,
    guard: (s) => closureReadiness(s),
  },
  return_to_review: {
    id: "return_to_review",
    label: "Return to staff review",
    from: ["READY_FOR_AUTHORIZED_DISPOSITION"],
    to: "UNDER_STAFF_REVIEW",
    actors: REVIEWERS,
    requiresReason: true,
  },
  record_determination: {
    id: "record_determination",
    label: "Record official determination",
    from: ["READY_FOR_AUTHORIZED_DISPOSITION"],
    to: "DISPOSITION_PENDING_CONFIRMATION",
    actors: ["official"],
    requiresReason: true,
    guard: (s, actor) => {
      const p: string[] = [];
      if (actor !== "system" && actor !== "homeowner" && !s.approvalAuthority.includes(actor)) {
        p.push("Your role does not hold approval authority for this permit category under the active rule set");
      }
      const d = s.proposedDetermination;
      if (!d) return [...p, "A determination type is required"];
      if (DETERMINATION_META[d].closes) {
        if (s.specialistRequired && !s.specialistAssessmentRecorded) p.push("Specialist assessment has not been recorded");
        if (s.siteInspectionRequired && !s.passedInspectionRecorded) p.push("Jurisdiction rules require a passed site inspection on record");
        if (s.openConflicts > 0) p.push("Unresolved evidence conflicts remain");
      }
      if (d === "close_final_inspection_passed" && !s.passedInspectionRecorded) p.push("No passed final inspection is on record");
      if (d === "close_aged_permit_no_apparent_hazard" && !s.agedPermitEligible) {
        p.push("The active rule set provides no aged-permit provision for this permit, or the permit does not meet its age threshold");
      }
      return p;
    },
  },
  confirm_source_closure: {
    id: "confirm_source_closure",
    label: "Confirm closure in system of record",
    from: ["DISPOSITION_PENDING_CONFIRMATION"],
    to: "OFFICIALLY_CLOSED",
    actors: ["system", "admin", "official"],
    requiresReason: true,
    guard: (s) => {
      const p: string[] = [];
      if (!s.pendingSubmission) p.push("No pending source-of-record submission");
      if (!s.recordedDetermination || !DETERMINATION_META[s.recordedDetermination].closes) p.push("Recorded determination is not a closure");
      return p;
    },
  },
  confirm_source_other_outcome: {
    id: "confirm_source_other_outcome",
    label: "Confirm outcome in system of record",
    from: ["DISPOSITION_PENDING_CONFIRMATION"],
    to: "OTHER_OFFICIAL_OUTCOME",
    actors: ["system", "admin", "official"],
    requiresReason: true,
    guard: (s) => {
      const p: string[] = [];
      if (!s.pendingSubmission) p.push("No pending source-of-record submission");
      if (!s.recordedDetermination || DETERMINATION_META[s.recordedDetermination].closes) p.push("Recorded determination is a closure");
      return p;
    },
  },
  source_rejected: {
    id: "source_rejected",
    label: "Source system rejected update",
    from: ["DISPOSITION_PENDING_CONFIRMATION"],
    to: "READY_FOR_AUTHORIZED_DISPOSITION",
    actors: ["system", "admin", "official"],
    requiresReason: true,
  },
  reopen_case: {
    id: "reopen_case",
    label: "Reopen case",
    from: ["OFFICIALLY_CLOSED", "OTHER_OFFICIAL_OUTCOME", "ALREADY_RESOLVED"],
    to: "UNDER_STAFF_REVIEW",
    actors: ["admin", "official"],
    requiresReason: true,
  },
};

export interface TransitionCheck {
  allowed: boolean;
  problems: string[];
}

/** Pure evaluation of whether `actor` may move a case in `state` through `transitionId`. */
export function checkTransition(
  transitionId: TransitionId,
  state: CaseState,
  actor: ActorKind,
  snapshot: GuardSnapshot,
  reason?: string | null,
): TransitionCheck {
  const def = TRANSITIONS[transitionId];
  const problems: string[] = [];
  if (!def.from.includes(state)) {
    problems.push(`'${def.label}' is not available from state ${STATE_META[state].label}`);
  }
  if (!def.actors.includes(actor)) {
    problems.push(`Actor '${actor}' is not authorized for '${def.label}'`);
  }
  if (def.requiresReason && !(reason && reason.trim().length >= 3)) {
    problems.push("A reason is required for this action");
  }
  if (problems.length === 0 && def.guard) problems.push(...def.guard(snapshot, actor));
  return { allowed: problems.length === 0, problems };
}

/** Transitions whose `from` includes `state` and whose actor list includes `actor`. */
export function availableTransitions(state: CaseState, actor: ActorKind): TransitionDef[] {
  return Object.values(TRANSITIONS).filter((t) => t.from.includes(state) && t.actors.includes(actor));
}

export function emptySnapshot(overrides: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    classification: null,
    specialistRequired: false,
    siteInspectionRequired: false,
    approvalAuthority: ["official"],
    agedPermitEligible: false,
    openDuplicateCandidates: 0,
    confirmedDuplicateOf: null,
    missingEssentialFields: [],
    pendingDraftNotice: false,
    approvedNoticeDispatched: false,
    contactable: false,
    homeownerVerified: false,
    submittedEvidenceCount: 0,
    requirementsOutstanding: [],
    openConflicts: 0,
    specialistAssessmentRecorded: false,
    passedInspectionRecorded: false,
    inspectionRecordedSinceRequired: false,
    proposedDetermination: null,
    recordedDetermination: null,
    pendingSubmission: false,
    finalizationVerification: null,
    ...overrides,
  };
}
