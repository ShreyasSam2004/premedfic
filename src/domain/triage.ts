/**
 * Triage vocabulary shared by the engine and the UI.
 *
 * Review priority expresses *administrative urgency of human attention*.
 * It is never a statement about construction safety.
 */

export const TRIAGE_CLASSIFICATIONS = [
  "DATA_RECONCILIATION",
  "FINALIZATION_CONFIRMATION",
  "SPECIALIST_REVIEW",
  "STAFF_REVIEW",
  "EVIDENCE_COLLECTION",
  "MONITOR_ACTIVE",
] as const;
export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];

export const CLASSIFICATION_META: Record<TriageClassification, { label: string; description: string }> = {
  DATA_RECONCILIATION: {
    label: "Data reconciliation",
    description: "The record is incomplete or may duplicate another record. A data steward must reconcile it before any outreach.",
  },
  FINALIZATION_CONFIRMATION: {
    label: "Source reports final",
    description:
      "A source reports a final inspection or finaled status. The permit system of record must confirm it before the record is treated as resolved; no owner outreach meanwhile.",
  },
  SPECIALIST_REVIEW: {
    label: "Specialist review",
    description: "Safety-sensitive work category or description. Routed to a qualified specialist. No automated clearance pathway exists.",
  },
  STAFF_REVIEW: {
    label: "Staff review",
    description: "No verified rule covers this record, or the rule requires staff judgment before outreach.",
  },
  EVIDENCE_COLLECTION: {
    label: "Evidence collection",
    description: "Administrative pathway: request documentation from the property owner, then route to staff review.",
  },
  MONITOR_ACTIVE: {
    label: "Active — monitor",
    description: "Permit has not expired. No resolution workflow is needed yet.",
  },
};

export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<Priority, { label: string; description: string }> = {
  P1: { label: "Urgent review", description: "Highest administrative priority for human attention." },
  P2: { label: "High review", description: "Prioritize in the next review cycle." },
  P3: { label: "Normal review", description: "Standard queue order." },
  P4: { label: "Low review", description: "Low administrative urgency. Not a safety assessment." },
};

export const PRIORITY_DISCLAIMER =
  "Review priority reflects administrative urgency only. A low priority is not a determination that work is safe or code-compliant.";

export const PATHWAYS = [
  "data_reconciliation",
  "administrative_confirmation",
  "specialist_assessment",
  "evidence_review",
  "manual_staff_assessment",
  "monitor",
] as const;
export type Pathway = (typeof PATHWAYS)[number];

export const PATHWAY_LABELS: Record<Pathway, string> = {
  data_reconciliation: "Data reconciliation",
  administrative_confirmation: "Verify the reported final with the system of record",
  specialist_assessment: "Specialist assessment with site inspection",
  evidence_review: "Owner evidence request → staff review",
  manual_staff_assessment: "Manual staff assessment",
  monitor: "Monitor until expiration",
};
