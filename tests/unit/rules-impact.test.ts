import { describe, expect, it } from "vitest";
import type { PermitCategory } from "@/domain/permits";
import { defaultCategoryRule } from "@/domain/rule-library";
import { parseRuleSetConfig, type RuleSetConfig } from "@/server/rules/config";
import { LAKEMONT_RULESET } from "@/server/rules/defaults";
import { compareRuleSets, diffConfigs, type ImpactSubject } from "@/server/rules/impact";

const subject = (permitNumber: string, category: PermitCategory, workDescription: string): ImpactSubject => ({
  key: permitNumber,
  permitNumber,
  caseId: null,
  category,
  input: {
    permit: {
      permitNumber,
      category,
      rawCategory: category,
      workDescription,
      address: "1 EXAMPLE ST",
      issuedAt: "2019-04-09",
      expiresAt: "2019-10-06",
      sourceStatus: "expired",
      finalInspectionAt: null,
      missingFields: [],
    },
    passedFinalInspection: false,
    openDuplicateCandidates: 0,
    contacts: { total: 1, contactable: 1 },
    asOf: "2026-10-30",
  },
});

const SUBJECTS = [
  subject("HVAC-1", "hvac", "Replace 3-ton condenser and air handler"),
  subject("HVAC-2", "hvac", "Replace heat pump and rewire disconnect, new circuit"),
  subject("ROOF-1", "roof", "Tear off and replace shingles"),
  subject("ELEC-1", "electrical_service", "Replace main electrical panel"),
];
const ref = (config: RuleSetConfig, version: number) => ({ id: `rs${version}`, version, verified: true, config });
const withRule = (patch: (c: RuleSetConfig) => void) => {
  const c = structuredClone(LAKEMONT_RULESET);
  patch(c);
  const parsed = parseRuleSetConfig(c);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.config;
};

describe("rule-change impact preview", () => {
  it("reports cases a new category rule moves to document review, and flags them as less cautious", () => {
    const draft = withRule((c) => {
      c.categories.hvac = defaultCategoryRule("hvac");
    });
    const r = compareRuleSets(SUBJECTS, ref(LAKEMONT_RULESET, 1), ref(draft, 2));
    expect(r.evaluated).toBe(4);
    expect(r.changed).toBe(1);
    expect(r.changes[0]).toMatchObject({ permitNumber: "HVAC-1", lessCautious: true, before: { classification: "STAFF_REVIEW" }, after: { classification: "EVIDENCE_COLLECTION" } });
    expect(r.lessCautious).toMatchObject({ total: 1, toDocumentReview: 1 });
    expect(r.transitions).toEqual([{ from: "STAFF_REVIEW", to: "EVIDENCE_COLLECTION", count: 1 }]);
    // The description escalation still sends the rewiring job to a specialist.
    expect(r.changes.find((c) => c.permitNumber === "HVAC-2")).toBeUndefined();
  });

  it("counts a stricter rule as more cautious", () => {
    const draft = withRule((c) => {
      c.categories.roof = { ...c.categories.roof!, concernLevel: "high", pathway: "specialist_assessment", specialistDiscipline: "building", siteInspectionRequired: true };
    });
    const r = compareRuleSets(SUBJECTS, ref(LAKEMONT_RULESET, 1), ref(draft, 2));
    expect(r.changed).toBe(1);
    expect(r.moreCautious).toBe(1);
    expect(r.lessCautious.total).toBe(0);
    expect(r.changes[0]).toMatchObject({ permitNumber: "ROOF-1", after: { classification: "SPECIALIST_REVIEW", siteInspectionRequired: true } });
  });

  it("flags a dropped site inspection even when the pathway is unchanged", () => {
    const draft = withRule((c) => {
      c.categories.electrical_service = { ...c.categories.electrical_service!, pathway: "manual_staff_assessment", siteInspectionRequired: false };
    });
    const r = compareRuleSets([subject("ELEC-2", "electrical_service", "Service work")], ref(LAKEMONT_RULESET, 1), ref(draft, 2));
    expect(r.lessCautious.siteInspectionDropped).toBe(1);
  });

  it("reports no change for an identical configuration", () => {
    const r = compareRuleSets(SUBJECTS, ref(LAKEMONT_RULESET, 1), ref(structuredClone(LAKEMONT_RULESET), 2));
    expect(r.changed).toBe(0);
    expect(r.lessCautious.total).toBe(0);
  });

  it("describes configuration differences in words", () => {
    const draft = withRule((c) => {
      c.categories.hvac = defaultCategoryRule("hvac");
      c.categories.fence = { ...c.categories.fence!, siteInspectionRequired: true };
      c.descriptionEscalations = c.descriptionEscalations.filter((e) => e.id !== "ESC-GAS");
    });
    const lines = diffConfigs(LAKEMONT_RULESET, draft);
    expect(lines).toContain("Adds a rule for HVAC replacement: standard concern, evidence review, no site inspection by rule.");
    expect(lines).toContain("Fence installation: now requires a site inspection.");
    expect(lines).toContain("Removes description escalation ESC-GAS.");
  });
});
