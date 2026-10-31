/**
 * Deterministic permit triage engine.
 *
 * Each rule is a pure, independently testable function with a stable id and
 * version. The engine runs every rule, records every outcome (triggered or
 * not) with the source fields it read, and composes a classification using a
 * fixed precedence. Rules can only add caution: description keywords escalate
 * a case; nothing de-escalates one.
 */
import type { PermitCategory, SourceStatus } from "@/domain/permits";
import { CATEGORY_LABELS } from "@/domain/permits";
import type { Pathway, Priority, TriageClassification } from "@/domain/triage";
import { daysBetween } from "../util";
import type { CategoryRule, RequirementSpecConfig, RuleSetConfig } from "../rules/config";

export const ENGINE_VERSION = "triage-engine/1.1.0";

export interface TriageInput {
  permit: {
    permitNumber: string;
    category: PermitCategory | null;
    rawCategory: string | null;
    workDescription: string | null;
    address: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    sourceStatus: SourceStatus;
    finalInspectionAt: string | null;
    missingFields: string[];
  };
  passedFinalInspection: boolean;
  /** Latest system-of-record check of a reported final; the import alone never settles it. */
  finalizationVerification?: { outcome: "confirmed" | "not_confirmed"; at: string; reference: string } | null;
  openDuplicateCandidates: number;
  contacts: { total: number; contactable: number };
  ruleSet: { id: string; version: number; verified: boolean; config: RuleSetConfig } | null;
  asOf: string;
}

export interface Escalation {
  ruleId: string;
  message: string;
  discipline?: string;
}

export interface RuleEffects {
  classification?: TriageClassification;
  escalation?: Escalation;
  specialistRequired?: boolean;
  siteInspectionRequired?: boolean;
  discipline?: string;
  priorityPoints?: number;
  humanReview?: boolean;
  agedPermitEligible?: boolean;
  manualOutreach?: boolean;
}

export interface RuleOutcome {
  ruleId: string;
  ruleVersion: string;
  title: string;
  outcome: "triggered" | "passed" | "not_applicable";
  sourceFields: Record<string, unknown>;
  explanation: string;
  effects: RuleEffects;
}

export interface DerivedFacts {
  permitAgeDays: number | null;
  daysSinceExpiration: number | null;
  expired: boolean | null;
  categoryRule: CategoryRule | null;
}

export interface TriageRule {
  id: string;
  version: string;
  title: string;
  description: string;
  evaluate(input: TriageInput, facts: DerivedFacts): Omit<RuleOutcome, "ruleId" | "ruleVersion" | "title">;
}

const pass = (explanation: string, sourceFields: Record<string, unknown> = {}) => ({
  outcome: "passed" as const,
  sourceFields,
  explanation,
  effects: {},
});
const na = (explanation: string, sourceFields: Record<string, unknown> = {}) => ({
  outcome: "not_applicable" as const,
  sourceFields,
  explanation,
  effects: {},
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const RULES: TriageRule[] = [
  {
    id: "R-DATA-001",
    version: "1",
    title: "Essential record data",
    description: "Records missing essential fields route to data reconciliation before any outreach.",
    evaluate({ permit, ruleSet }) {
      const essentials = ruleSet?.config.essentialFields ?? ["address", "category", "issuedAt"];
      const missing = essentials.filter((f) => permit[f as keyof typeof permit] === null || permit[f as keyof typeof permit] === undefined);
      const sourceFields = Object.fromEntries(essentials.map((f) => [f, permit[f as keyof typeof permit] ?? null]));
      if (missing.length === 0) return pass("All essential fields are present.", sourceFields);
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `Essential field(s) missing from the source record: ${missing.join(", ")}. The system does not infer missing values.`,
        effects: { classification: "DATA_RECONCILIATION", priorityPoints: ruleSet?.config.priority.missingDataPoints ?? 12, humanReview: true },
      };
    },
  },
  {
    id: "R-DATA-002",
    version: "1",
    title: "Possible duplicate record",
    description: "Records that may duplicate another permit record route to reconciliation instead of creating parallel cases.",
    evaluate({ openDuplicateCandidates }) {
      const sourceFields = { openDuplicateCandidates };
      if (openDuplicateCandidates === 0) return pass("No open duplicate candidates.", sourceFields);
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `${openDuplicateCandidates} possible duplicate record(s) detected. A data steward must confirm or dismiss before outreach.`,
        effects: { classification: "DATA_RECONCILIATION", humanReview: true },
      };
    },
  },
  {
    id: "R-FINAL-001",
    version: "2",
    title: "Reported final",
    description:
      "A final inspection or finaled status reported by a source routes the record to finalization verification, never to closure. Only a system-of-record confirmation resolves it; a rejected report is disregarded.",
    evaluate({ permit, passedFinalInspection, finalizationVerification: v }) {
      const sourceFields = {
        finalInspectionAt: permit.finalInspectionAt,
        sourceStatus: permit.sourceStatus,
        passedFinalInspection,
        finalizationVerification: v ? `${v.outcome} ${v.at} (${v.reference})` : null,
      };
      const reported = Boolean(permit.finalInspectionAt) || passedFinalInspection || permit.sourceStatus === "finaled";
      if (!reported) return pass("No final inspection or finaled status is reported.", sourceFields);
      if (v?.outcome === "not_confirmed") {
        return pass(`The reported final was not confirmed by the system of record on ${v.at} (reference ${v.reference}); it is disregarded.`, sourceFields);
      }
      if (v?.outcome === "confirmed") {
        return {
          outcome: "triggered",
          sourceFields,
          explanation: `The system of record confirmed an existing final on ${v.at} (reference ${v.reference}). Already resolved; no resolution workflow applies.`,
          effects: { classification: "FINALIZATION_CONFIRMATION", humanReview: true },
        };
      }
      const what = permit.finalInspectionAt
        ? `a final inspection on ${permit.finalInspectionAt}`
        : passedFinalInspection
          ? "a passed final inspection"
          : "a finaled status with no final inspection date";
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `A source reports ${what}. It must be verified against the permit system of record before the record is treated as resolved; no owner outreach meanwhile.`,
        effects: { classification: "FINALIZATION_CONFIRMATION", humanReview: true },
      };
    },
  },
  {
    id: "R-STATUS-001",
    version: "1",
    title: "Void or cancelled source status",
    description: "Void or cancelled permits need staff confirmation that no resolution work is required.",
    evaluate({ permit }) {
      const sourceFields = { sourceStatus: permit.sourceStatus };
      if (permit.sourceStatus !== "void" && permit.sourceStatus !== "cancelled") return na("Source status is not void or cancelled.", sourceFields);
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `Source status is ${permit.sourceStatus}. Staff must confirm whether any resolution workflow applies.`,
        effects: { classification: "STAFF_REVIEW", humanReview: true },
      };
    },
  },
  {
    id: "R-EXP-001",
    version: "1",
    title: "Expiration status",
    description: "Determines whether the permit has expired using the recorded expiration date or source status. Never assumes a default term.",
    evaluate({ permit, asOf }, facts) {
      const sourceFields = { expiresAt: permit.expiresAt, sourceStatus: permit.sourceStatus, asOf };
      if (facts.expired === true) {
        return pass(
          facts.daysSinceExpiration !== null
            ? `Expired ${facts.daysSinceExpiration} days ago (on ${permit.expiresAt}).`
            : "Source status reports the permit as expired; no expiration date is recorded.",
          sourceFields,
        );
      }
      if (facts.expired === false) {
        return {
          outcome: "triggered",
          sourceFields,
          explanation: `Permit is not yet expired (expires ${permit.expiresAt}). No resolution workflow is needed yet.`,
          effects: { classification: "MONITOR_ACTIVE" },
        };
      }
      return {
        outcome: "triggered",
        sourceFields,
        explanation: "Expiration status is unknown: no expiration date and the source status does not indicate expiry. Staff must determine the permit's status.",
        effects: { classification: "STAFF_REVIEW", humanReview: true },
      };
    },
  },
  {
    id: "R-RULE-001",
    version: "1",
    title: "Rule coverage and verification",
    description: "Absent, unverified, or non-covering rules require human review. The engine never fills gaps with assumptions.",
    evaluate({ permit, ruleSet }, facts) {
      const sourceFields = {
        ruleSetVersion: ruleSet?.version ?? null,
        ruleSetVerified: ruleSet?.verified ?? null,
        category: permit.category,
      };
      if (!ruleSet) {
        return {
          outcome: "triggered",
          sourceFields,
          explanation: "No active rule set exists for this jurisdiction. All routing requires staff judgment.",
          effects: { classification: "STAFF_REVIEW", humanReview: true },
        };
      }
      if (permit.category && !facts.categoryRule) {
        return {
          outcome: "triggered",
          sourceFields,
          explanation: `The active rule set has no rule for category "${permit.rawCategory ?? permit.category}". Staff review required.`,
          effects: { classification: "STAFF_REVIEW", humanReview: true },
        };
      }
      if (!ruleSet.verified) {
        return {
          outcome: "triggered",
          sourceFields,
          explanation: `Rule set v${ruleSet.version} has not been verified by municipal administrators. Routing is provisional and requires human confirmation.`,
          effects: { humanReview: true },
        };
      }
      return pass(`Verified rule set v${ruleSet.version} covers this category.`, sourceFields);
    },
  },
  {
    id: "R-SAFE-001",
    version: "1",
    title: "High-concern permit category",
    description: "Safety-sensitive categories route to specialist assessment. No automated clearance exists for them.",
    evaluate({ permit }, facts) {
      const rule = facts.categoryRule;
      const sourceFields = { category: permit.category, concernLevel: rule?.concernLevel ?? null };
      if (!rule) return na("No category rule to evaluate.", sourceFields);
      if (rule.concernLevel !== "high") return pass(`${CATEGORY_LABELS[permit.category!]} is a standard-concern category under the active rules.`, sourceFields);
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `${CATEGORY_LABELS[permit.category!]} is a high-concern category. Requires ${rule.specialistDiscipline ?? "specialist"} assessment${rule.siteInspectionRequired ? " and a passed site inspection" : ""} before any disposition.`,
        effects: {
          classification: "SPECIALIST_REVIEW",
          specialistRequired: true,
          siteInspectionRequired: rule.siteInspectionRequired,
          discipline: rule.specialistDiscipline ?? undefined,
          escalation: { ruleId: "R-SAFE-001", message: `High-concern category: ${CATEGORY_LABELS[permit.category!]}`, discipline: rule.specialistDiscipline ?? undefined },
          humanReview: true,
        },
      };
    },
  },
  {
    id: "R-SAFE-002",
    version: "1",
    title: "Work-description escalation",
    description: "Keywords in the work description indicating safety-sensitive work escalate the case regardless of category. Text never de-escalates.",
    evaluate({ permit, ruleSet }) {
      const desc = permit.workDescription;
      const sourceFields = { workDescription: desc };
      if (!desc || !ruleSet) return na(desc ? "No rule set to supply escalation patterns." : "No work description recorded.", sourceFields);
      const hits = ruleSet.config.descriptionEscalations.filter((e) => new RegExp(e.pattern, "i").test(desc));
      if (hits.length === 0) return pass("No escalation keywords in the work description.", sourceFields);
      const first = hits[0];
      return {
        outcome: "triggered",
        sourceFields: { ...sourceFields, matchedEscalations: hits.map((h) => h.id) },
        explanation: `${hits.map((h) => h.message).join("; ")}. Escalated to ${hits.map((h) => h.discipline).join(" + ")} specialist review with a required site inspection.`,
        effects: {
          classification: "SPECIALIST_REVIEW",
          specialistRequired: true,
          siteInspectionRequired: true,
          discipline: first.discipline,
          escalation: { ruleId: "R-SAFE-002", message: hits.map((h) => h.message).join("; "), discipline: first.discipline },
          priorityPoints: ruleSet.config.priority.highConcernPoints,
          humanReview: true,
        },
      };
    },
  },
  {
    id: "R-INSP-001",
    version: "1",
    title: "Final inspection record",
    description: "Notes the absence of a final inspection record. Absence of a record is not evidence that work is incomplete or unsafe.",
    evaluate({ permit, passedFinalInspection, finalizationVerification: v }) {
      const sourceFields = { finalInspectionAt: permit.finalInspectionAt, passedFinalInspection };
      if (v?.outcome === "not_confirmed") {
        return { outcome: "triggered", sourceFields, explanation: "A reported final inspection was not confirmed by the system of record.", effects: {} };
      }
      if (permit.finalInspectionAt || passedFinalInspection) return na("A final inspection is reported.", sourceFields);
      return { outcome: "triggered", sourceFields, explanation: "No final inspection is recorded for this permit.", effects: {} };
    },
  },
  {
    id: "R-CONTACT-001",
    version: "1",
    title: "Owner contact availability",
    description: "Outreach requires a verified owner-of-record contact. The system never guesses contacts; unverified or missing contacts route to manual outreach research.",
    evaluate({ contacts, ruleSet }) {
      const sourceFields = { contactsOnFile: contacts.total, verifiedContactable: contacts.contactable };
      if (contacts.contactable > 0) return pass("A verified, contactable owner-of-record contact is on file.", sourceFields);
      return {
        outcome: "triggered",
        sourceFields,
        explanation:
          contacts.total > 0
            ? "Contact details exist but none are verified against property records. Verify before any outreach."
            : "No owner contact on file. The system will not guess or contact anyone; assign for manual outreach research.",
        effects: { manualOutreach: contacts.total === 0, priorityPoints: ruleSet?.config.priority.noContactPoints ?? 6 },
      };
    },
  },
  {
    id: "R-AGE-001",
    version: "1",
    title: "Aged-permit provision eligibility",
    description: "Where a verified rule set provides an aged-permit provision, notes that the permit is eligible for an official's consideration. Never automatic.",
    evaluate({ permit, ruleSet }, facts) {
      const prov = ruleSet?.config.agedPermitProvision;
      const sourceFields = { issuedAt: permit.issuedAt, permitAgeDays: facts.permitAgeDays, provision: prov?.citation ?? null };
      if (!prov || !prov.enabled) return na("The active rule set defines no aged-permit provision.", sourceFields);
      if (facts.permitAgeDays === null) return na("Issuance date unknown; age cannot be computed.", sourceFields);
      const years = facts.permitAgeDays / 365.25;
      const level = facts.categoryRule?.concernLevel ?? null;
      if (level && prov.excludedConcernLevels.includes(level)) return na(`Provision excludes ${level}-concern categories.`, sourceFields);
      if (years < prov.minYearsSinceIssuance) {
        return pass(`Issued ${years.toFixed(1)} years ago; below the ${prov.minYearsSinceIssuance}-year threshold in ${prov.citation}.`, sourceFields);
      }
      return {
        outcome: "triggered",
        sourceFields,
        explanation: `Issued ${years.toFixed(1)} years ago. Eligible for an official's CONSIDERATION under ${prov.citation}. ${prov.determinationRequired}`,
        effects: { agedPermitEligible: true },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const PRECEDENCE: TriageClassification[] = [
  "DATA_RECONCILIATION",
  "FINALIZATION_CONFIRMATION",
  "MONITOR_ACTIVE",
  "SPECIALIST_REVIEW",
  "STAFF_REVIEW",
  "EVIDENCE_COLLECTION",
];

const PATHWAY: Record<TriageClassification, Pathway> = {
  DATA_RECONCILIATION: "data_reconciliation",
  FINALIZATION_CONFIRMATION: "administrative_confirmation",
  MONITOR_ACTIVE: "monitor",
  SPECIALIST_REVIEW: "specialist_assessment",
  STAFF_REVIEW: "manual_staff_assessment",
  EVIDENCE_COLLECTION: "evidence_review",
};

export interface TriageOutput {
  engineVersion: string;
  classification: TriageClassification;
  pathway: Pathway;
  priority: Priority;
  priorityScore: number;
  priorityBreakdown: Record<string, number>;
  humanReviewRequired: boolean;
  specialistRequired: boolean;
  siteInspectionRequired: boolean;
  specialistDiscipline: string | null;
  agedPermitEligible: boolean;
  manualOutreachRequired: boolean;
  escalations: Escalation[];
  requiredEvidence: RequirementSpecConfig[];
  completeness: { score: number; missing: string[] };
  permitAgeDays: number | null;
  daysSinceExpiration: number | null;
  recommendedAction: string;
  explanation: string;
  outcomes: RuleOutcome[];
  approvalAuthority: string[];
}

export function deriveFacts(input: TriageInput): DerivedFacts {
  const { permit, asOf, ruleSet } = input;
  const permitAgeDays = permit.issuedAt ? daysBetween(permit.issuedAt, asOf) : null;
  let expired: boolean | null = null;
  let daysSinceExpiration: number | null = null;
  if (permit.expiresAt) {
    daysSinceExpiration = daysBetween(permit.expiresAt, asOf);
    expired = daysSinceExpiration > 0;
    if (!expired) daysSinceExpiration = null;
  } else if (permit.sourceStatus === "expired") {
    expired = true;
  }
  const categoryRule = permit.category && ruleSet ? (ruleSet.config.categories[permit.category] ?? null) : null;
  return { permitAgeDays, daysSinceExpiration, expired, categoryRule };
}

const COMPLETENESS_FIELDS = ["address", "category", "workDescription", "issuedAt", "expiresAt", "sourceStatus"] as const;

export function runTriage(input: TriageInput, rules: TriageRule[] = RULES): TriageOutput {
  const facts = deriveFacts(input);
  const outcomes: RuleOutcome[] = rules.map((r) => ({ ruleId: r.id, ruleVersion: r.version, title: r.title, ...r.evaluate(input, facts) }));
  const triggered = outcomes.filter((o) => o.outcome === "triggered");

  const candidates = new Set<TriageClassification>(triggered.map((o) => o.effects.classification).filter(Boolean) as TriageClassification[]);
  const classification = PRECEDENCE.find((c) => candidates.has(c)) ?? "EVIDENCE_COLLECTION";

  const specialistRequired = triggered.some((o) => o.effects.specialistRequired);
  const siteInspectionRequired = triggered.some((o) => o.effects.siteInspectionRequired) || Boolean(facts.categoryRule?.siteInspectionRequired);
  const specialistDiscipline = triggered.find((o) => o.effects.discipline)?.effects.discipline ?? null;
  const escalations = triggered.map((o) => o.effects.escalation).filter(Boolean) as Escalation[];
  const agedPermitEligible = triggered.some((o) => o.effects.agedPermitEligible);
  const manualOutreachRequired = triggered.some((o) => o.effects.manualOutreach);

  // Priority: administrative urgency only.
  const p = input.ruleSet?.config.priority ?? { pointsPerYearExpired: 4, maxAgePoints: 28, highConcernPoints: 25, missingDataPoints: 12, noContactPoints: 6, thresholds: { P1: 60, P2: 40, P3: 22 } };
  const breakdown: Record<string, number> = {};
  breakdown.category = facts.categoryRule?.basePriorityPoints ?? 10;
  if (facts.daysSinceExpiration !== null) breakdown.timeExpired = Math.min(p.maxAgePoints, Math.floor((facts.daysSinceExpiration / 365.25) * p.pointsPerYearExpired));
  if (facts.categoryRule?.concernLevel === "high") breakdown.highConcern = p.highConcernPoints;
  for (const o of triggered) {
    if (o.effects.priorityPoints && !(o.ruleId === "R-SAFE-002" && breakdown.highConcern)) breakdown[o.ruleId] = o.effects.priorityPoints;
  }
  let priorityScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (classification === "MONITOR_ACTIVE") priorityScore = Math.min(priorityScore, p.thresholds.P3 - 1);
  priorityScore = Math.max(0, Math.min(100, priorityScore));
  const priority: Priority = priorityScore >= p.thresholds.P1 ? "P1" : priorityScore >= p.thresholds.P2 ? "P2" : priorityScore >= p.thresholds.P3 ? "P3" : "P4";

  const humanReviewRequired =
    triggered.some((o) => o.effects.humanReview) || !(classification === "EVIDENCE_COLLECTION" || classification === "MONITOR_ACTIVE");

  const missing = COMPLETENESS_FIELDS.filter((f) => {
    const v = input.permit[f];
    return v === null || v === undefined || v === "unknown";
  });
  const completeness = { score: Math.round(((COMPLETENESS_FIELDS.length - missing.length) / COMPLETENESS_FIELDS.length) * 100), missing: [...missing] };

  const requiredEvidence = facts.categoryRule?.requiredEvidence ?? [];
  const recommendedAction = recommend(classification, { input, facts, specialistDiscipline, requiredEvidence, manualOutreachRequired });
  const explanation = triggered.map((o) => o.explanation).join(" ") || "No rule triggered; standard evidence collection pathway.";

  return {
    engineVersion: ENGINE_VERSION,
    classification,
    pathway: PATHWAY[classification],
    priority,
    priorityScore,
    priorityBreakdown: breakdown,
    humanReviewRequired,
    specialistRequired,
    siteInspectionRequired,
    specialistDiscipline,
    agedPermitEligible,
    manualOutreachRequired,
    escalations,
    requiredEvidence,
    completeness,
    permitAgeDays: facts.permitAgeDays,
    daysSinceExpiration: facts.daysSinceExpiration,
    recommendedAction,
    explanation,
    outcomes,
    approvalAuthority: facts.categoryRule?.approvalAuthority ?? ["official"],
  };
}

function recommend(
  c: TriageClassification,
  ctx: { input: TriageInput; facts: DerivedFacts; specialistDiscipline: string | null; requiredEvidence: RequirementSpecConfig[]; manualOutreachRequired: boolean },
): string {
  const { input } = ctx;
  switch (c) {
    case "DATA_RECONCILIATION": {
      const parts: string[] = [];
      if (input.openDuplicateCandidates > 0) parts.push("confirm or dismiss the possible duplicate record");
      const missing = (input.ruleSet?.config.essentialFields ?? ["address", "category", "issuedAt"]).filter((f) => input.permit[f as keyof typeof input.permit] === null);
      if (missing.length) parts.push(`obtain missing ${missing.join(", ")} from the system of record`);
      if (parts.length === 0) parts.push("reconcile the record's status against the system of record");
      return `Reconcile record: ${parts.join("; ")}.`;
    }
    case "FINALIZATION_CONFIRMATION":
      return input.finalizationVerification?.outcome === "confirmed"
        ? "No action: the system of record confirmed an existing final."
        : "Verify the reported final with the permit system of record. No owner outreach until it is verified.";
    case "MONITOR_ACTIVE":
      return `No action until the permit expires on ${input.permit.expiresAt}.`;
    case "SPECIALIST_REVIEW":
      return `Assign a ${ctx.specialistDiscipline ?? "qualified"} specialist. A passed site inspection is required before any disposition.`;
    case "STAFF_REVIEW":
      return "Staff review required to determine the applicable pathway.";
    case "EVIDENCE_COLLECTION": {
      const items = ctx.requiredEvidence.filter((r) => r.required).map((r) => r.label.toLowerCase());
      if (input.contacts.contactable === 0) {
        return ctx.manualOutreachRequired
          ? "Manual outreach: research the owner of record. No contact is on file."
          : "Verify the owner contact against property records, then draft a notice.";
      }
      return `Draft an owner notice requesting: ${items.join("; ") || "documentation of completed work"}.`;
    }
  }
}
