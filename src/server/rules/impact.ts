/**
 * Rule-change impact: runs the deterministic triage engine on the same inputs
 * under two rule sets and reports what would move. Pure; nothing is written.
 *
 * "Less cautious" is surfaced separately because a rule change that drops a
 * specialist, a site inspection, or human judgment is the kind a jurisdiction
 * must look at case by case before activating.
 */
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { TRIAGE_CLASSIFICATIONS, type Priority, type TriageClassification } from "@/domain/triage";
import { runTriage, type TriageInput } from "../triage/engine";
import type { CategoryRule, RuleSetConfig } from "./config";

export type RuleSetRef = { id: string; version: number; verified: boolean; config: RuleSetConfig } | null;

export interface ImpactSubject {
  key: string;
  permitNumber: string;
  caseId: string | null;
  category: string | null;
  input: Omit<TriageInput, "ruleSet">;
}

export interface Routing {
  classification: TriageClassification;
  priority: Priority;
  siteInspectionRequired: boolean;
  specialistRequired: boolean;
  humanReviewRequired: boolean;
}

export interface ImpactChange {
  key: string;
  permitNumber: string;
  caseId: string | null;
  category: string | null;
  before: Routing;
  after: Routing;
  lessCautious: boolean;
  moreCautious: boolean;
}

export interface ImpactReport {
  evaluated: number;
  changed: number;
  priorityOnly: number;
  classification: Record<TriageClassification, { before: number; after: number }>;
  transitions: { from: TriageClassification; to: TriageClassification; count: number }[];
  byCategory: { category: string; changed: number }[];
  lessCautious: { total: number; toDocumentReview: number; siteInspectionDropped: number; specialistDropped: number; humanReviewDropped: number };
  moreCautious: number;
  changes: ImpactChange[];
}

/** How much human judgment a pathway applies before outreach; higher is more cautious. */
const CAUTION: Partial<Record<TriageClassification, number>> = { SPECIALIST_REVIEW: 3, STAFF_REVIEW: 2, EVIDENCE_COLLECTION: 1 };

function route(input: Omit<TriageInput, "ruleSet">, ruleSet: RuleSetRef): Routing {
  const out = runTriage({ ...input, ruleSet });
  return {
    classification: out.classification,
    priority: out.priority,
    siteInspectionRequired: out.siteInspectionRequired,
    specialistRequired: out.specialistRequired,
    humanReviewRequired: out.humanReviewRequired,
  };
}

export function compareRuleSets(subjects: ImpactSubject[], before: RuleSetRef, after: RuleSetRef): ImpactReport {
  const classification = Object.fromEntries(TRIAGE_CLASSIFICATIONS.map((c) => [c, { before: 0, after: 0 }])) as ImpactReport["classification"];
  const transitions = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const lessCautious = { total: 0, toDocumentReview: 0, siteInspectionDropped: 0, specialistDropped: 0, humanReviewDropped: 0 };
  let moreCautious = 0;
  let priorityOnly = 0;
  const changes: ImpactChange[] = [];

  for (const s of subjects) {
    const b = route(s.input, before);
    const a = route(s.input, after);
    classification[b.classification].before++;
    classification[a.classification].after++;
    const routingChanged =
      b.classification !== a.classification || b.siteInspectionRequired !== a.siteInspectionRequired || b.specialistRequired !== a.specialistRequired || b.humanReviewRequired !== a.humanReviewRequired;
    if (!routingChanged) {
      if (b.priority !== a.priority) priorityOnly++;
      continue;
    }
    const cb = CAUTION[b.classification];
    const ca = CAUTION[a.classification];
    const dropsSite = b.siteInspectionRequired && !a.siteInspectionRequired;
    const dropsSpecialist = b.specialistRequired && !a.specialistRequired;
    const dropsHuman = b.humanReviewRequired && !a.humanReviewRequired;
    const less = (cb !== undefined && ca !== undefined && ca < cb) || dropsSite || dropsSpecialist || dropsHuman;
    const more = !less && ((cb !== undefined && ca !== undefined && ca > cb) || (!b.siteInspectionRequired && a.siteInspectionRequired) || (!b.specialistRequired && a.specialistRequired));
    if (less) {
      lessCautious.total++;
      if (a.classification === "EVIDENCE_COLLECTION" && b.classification !== "EVIDENCE_COLLECTION") lessCautious.toDocumentReview++;
      if (dropsSite) lessCautious.siteInspectionDropped++;
      if (dropsSpecialist) lessCautious.specialistDropped++;
      if (dropsHuman) lessCautious.humanReviewDropped++;
    }
    if (more) moreCautious++;
    if (b.classification !== a.classification) {
      const k = `${b.classification}>${a.classification}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
    const cat = s.category ?? "unknown";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    changes.push({ key: s.key, permitNumber: s.permitNumber, caseId: s.caseId, category: s.category, before: b, after: a, lessCautious: less, moreCautious: more });
  }

  changes.sort((x, y) => Number(y.lessCautious) - Number(x.lessCautious) || x.permitNumber.localeCompare(y.permitNumber));
  return {
    evaluated: subjects.length,
    changed: changes.length,
    priorityOnly,
    classification,
    transitions: [...transitions]
      .map(([k, count]) => {
        const [from, to] = k.split(">") as [TriageClassification, TriageClassification];
        return { from, to, count };
      })
      .sort((x, y) => y.count - x.count),
    byCategory: [...byCategory].map(([category, changed]) => ({ category, changed })).sort((x, y) => y.changed - x.changed),
    lessCautious,
    moreCautious,
    changes,
  };
}

// ---------------------------------------------------------------------------
// Configuration differences, in words
// ---------------------------------------------------------------------------

const catLabel = (c: string) => CATEGORY_LABELS[c as PermitCategory] ?? c;

function describeRule(r: CategoryRule) {
  const parts = [`${r.concernLevel} concern`, r.pathway.replace(/_/g, " ")];
  if (r.specialistDiscipline) parts.push(`${r.specialistDiscipline} specialist`);
  parts.push(r.siteInspectionRequired ? "site inspection required" : "no site inspection by rule");
  return parts.join(", ");
}

/** Human-readable differences between two configurations, for review before activation. */
export function diffConfigs(base: RuleSetConfig | null, next: RuleSetConfig): string[] {
  const lines: string[] = [];
  const cats = new Set([...Object.keys(base?.categories ?? {}), ...Object.keys(next.categories)]);
  for (const c of cats) {
    const a = base?.categories[c as PermitCategory];
    const b = next.categories[c as PermitCategory];
    if (!a && b) lines.push(`Adds a rule for ${catLabel(c)}: ${describeRule(b)}.`);
    else if (a && !b) lines.push(`Removes the rule for ${catLabel(c)}; those permits route to staff review.`);
    else if (a && b) {
      const changes: string[] = [];
      if (a.concernLevel !== b.concernLevel) changes.push(`concern ${a.concernLevel} → ${b.concernLevel}`);
      if (a.pathway !== b.pathway) changes.push(`pathway ${a.pathway.replace(/_/g, " ")} → ${b.pathway.replace(/_/g, " ")}`);
      if (a.siteInspectionRequired !== b.siteInspectionRequired) changes.push(b.siteInspectionRequired ? "now requires a site inspection" : "no longer requires a site inspection");
      if ((a.specialistDiscipline ?? "") !== (b.specialistDiscipline ?? "")) changes.push(`specialist ${a.specialistDiscipline ?? "none"} → ${b.specialistDiscipline ?? "none"}`);
      const ea = a.requiredEvidence.map((e) => `${e.code}:${e.minCount}:${e.required}`).join("|");
      const eb = b.requiredEvidence.map((e) => `${e.code}:${e.minCount}:${e.required}`).join("|");
      if (ea !== eb) changes.push("evidence requirements changed");
      if (a.approvalAuthority.join() !== b.approvalAuthority.join()) changes.push(`approval by ${b.approvalAuthority.join(", ")}`);
      if (a.basePriorityPoints !== b.basePriorityPoints) changes.push(`base priority ${a.basePriorityPoints} → ${b.basePriorityPoints}`);
      if (a.procedureNote !== b.procedureNote) changes.push("procedure note edited");
      if (changes.length) lines.push(`${catLabel(c)}: ${changes.join("; ")}.`);
    }
  }
  const ea = new Map((base?.descriptionEscalations ?? []).map((e) => [e.id, e]));
  const eb = new Map(next.descriptionEscalations.map((e) => [e.id, e]));
  for (const [id, e] of eb) {
    const prior = ea.get(id);
    if (!prior) lines.push(`Adds description escalation ${id} (${e.discipline}).`);
    else if (prior.pattern !== e.pattern || prior.discipline !== e.discipline || prior.message !== e.message) lines.push(`Edits description escalation ${id}.`);
  }
  for (const id of ea.keys()) if (!eb.has(id)) lines.push(`Removes description escalation ${id}.`);
  if (base && JSON.stringify(base.priority) !== JSON.stringify(next.priority)) lines.push("Review-priority weights or thresholds changed.");
  if (base && JSON.stringify(base.agedPermitProvision) !== JSON.stringify(next.agedPermitProvision)) lines.push("Aged-permit provision changed.");
  if (base && base.essentialFields.join() !== next.essentialFields.join()) lines.push("Essential fields changed.");
  return lines;
}
