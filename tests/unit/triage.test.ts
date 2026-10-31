import { describe, expect, it } from "vitest";
import { runTriage, RULES, type TriageInput } from "@/server/triage/engine";
import { CEDAR_BLUFF_FL_REFERENCE_RULESET, LAKEMONT_RULESET } from "@/server/rules/defaults";

const verified = { id: "rs1", version: 1, verified: true, config: LAKEMONT_RULESET };

function input(over: Partial<TriageInput["permit"]> = {}, rest: Partial<Omit<TriageInput, "permit">> = {}): TriageInput {
  return {
    permit: {
      permitNumber: "LKM-BLD-2019-04127",
      category: "roof",
      rawCategory: "Re-Roof",
      workDescription: "Tear off and replace architectural shingles",
      address: "418 MAGNOLIA AVE",
      issuedAt: "2019-08-12",
      expiresAt: "2020-02-08",
      sourceStatus: "expired",
      finalInspectionAt: null,
      missingFields: [],
      ...over,
    },
    passedFinalInspection: false,
    openDuplicateCandidates: 0,
    contacts: { total: 1, contactable: 1 },
    ruleSet: verified,
    asOf: "2026-10-30",
    ...rest,
  };
}

describe("triage engine", () => {
  it("routes an expired roof permit with a missing final to evidence collection", () => {
    const out = runTriage(input());
    expect(out.classification).toBe("EVIDENCE_COLLECTION");
    expect(out.pathway).toBe("evidence_review");
    expect(out.specialistRequired).toBe(false);
    expect(out.requiredEvidence.map((r) => r.code)).toEqual(["contractor_invoice", "exterior_photos", "owner_statement"]);
    expect(out.recommendedAction).toMatch(/Draft an owner notice/);
    expect(out.outcomes.find((o) => o.ruleId === "R-INSP-001")?.outcome).toBe("triggered");
  });

  it("escalates electrical service work to a specialist with a required site inspection", () => {
    const out = runTriage(input({ category: "electrical_service", workDescription: "Replace main electrical panel" }));
    expect(out.classification).toBe("SPECIALIST_REVIEW");
    expect(out.specialistRequired).toBe(true);
    expect(out.siteInspectionRequired).toBe(true);
    expect(out.specialistDiscipline).toBe("electrical");
    expect(out.humanReviewRequired).toBe(true);
    expect(out.priority).toBe("P1");
  });

  it("escalates from work-description keywords even when the category is standard", () => {
    const out = runTriage(input({ workDescription: "Re-roof and replace rotted rafters over garage" }));
    expect(out.classification).toBe("SPECIALIST_REVIEW");
    expect(out.specialistDiscipline).toBe("structural");
    const gas = runTriage(input({ category: "water_heater", workDescription: "Replace gas water heater in garage" }));
    expect(gas.specialistDiscipline).toBe("gas");
  });

  it("never de-escalates a high-concern category because of a benign description", () => {
    const out = runTriage(input({ category: "electrical_service", workDescription: "Minor cosmetic work only, nothing serious" }));
    expect(out.classification).toBe("SPECIALIST_REVIEW");
  });

  it("routes missing essential data to reconciliation and never infers values", () => {
    const out = runTriage(input({ address: null, issuedAt: null }));
    expect(out.classification).toBe("DATA_RECONCILIATION");
    expect(out.explanation).toMatch(/does not infer/);
    expect(out.permitAgeDays).toBeNull();
  });

  it("flags possible duplicates for reconciliation instead of opening outreach", () => {
    expect(runTriage(input({}, { openDuplicateCandidates: 1 })).classification).toBe("DATA_RECONCILIATION");
  });

  it("routes a reported final to verification, with or without a final inspection date", () => {
    expect(runTriage(input({ finalInspectionAt: "2020-01-15", sourceStatus: "finaled" })).classification).toBe("FINALIZATION_CONFIRMATION");
    const noDate = runTriage(input({ sourceStatus: "finaled" }));
    expect(noDate.classification).toBe("FINALIZATION_CONFIRMATION");
    expect(noDate.explanation).toMatch(/finaled status with no final inspection date/);
  });

  it("monitors permits that have not yet expired", () => {
    const out = runTriage(input({ issuedAt: "2026-06-01", expiresAt: "2026-11-28", sourceStatus: "issued" }));
    expect(out.classification).toBe("MONITOR_ACTIVE");
    expect(out.priority).toBe("P4");
  });

  it("requires staff review when no rule set exists or the category has no rule", () => {
    expect(runTriage(input({}, { ruleSet: null })).classification).toBe("STAFF_REVIEW");
    expect(runTriage(input({ category: "other", rawCategory: "Pool Barrier" })).classification).toBe("STAFF_REVIEW");
  });

  it("forces human review under an unverified rule set", () => {
    const out = runTriage(input({}, { ruleSet: { ...verified, verified: false } }));
    expect(out.humanReviewRequired).toBe(true);
    expect(out.outcomes.find((o) => o.ruleId === "R-RULE-001")?.explanation).toMatch(/not been verified/);
  });

  it("does not guess contacts: no contact → manual outreach", () => {
    const out = runTriage(input({}, { contacts: { total: 0, contactable: 0 } }));
    expect(out.manualOutreachRequired).toBe(true);
    expect(out.recommendedAction).toMatch(/Manual outreach/);
    const unverified = runTriage(input({}, { contacts: { total: 1, contactable: 0 } }));
    expect(unverified.manualOutreachRequired).toBe(false);
    expect(unverified.recommendedAction).toMatch(/Verify the owner contact/);
  });

  it("treats the Florida aged-permit provision as eligibility for consideration only", () => {
    const fl = { id: "fl", version: 1, verified: false, config: CEDAR_BLUFF_FL_REFERENCE_RULESET };
    const out = runTriage(input({ issuedAt: "2016-01-10", expiresAt: "2016-07-08" }, { ruleSet: fl }));
    expect(out.agedPermitEligible).toBe(true);
    expect(out.classification).toBe("EVIDENCE_COLLECTION");
    expect(out.humanReviewRequired).toBe(true);
    const ev = out.outcomes.find((o) => o.ruleId === "R-AGE-001")!;
    expect(ev.explanation).toMatch(/CONSIDERATION/);
    expect(ev.explanation).toMatch(/MAY close/);
    const young = runTriage(input({ issuedAt: "2023-01-10", expiresAt: "2023-07-08" }, { ruleSet: fl }));
    expect(young.agedPermitEligible).toBe(false);
  });

  it("records rule id, version, source fields, and an explanation for every rule", () => {
    const out = runTriage(input());
    expect(out.outcomes).toHaveLength(RULES.length);
    for (const o of out.outcomes) {
      expect(o.ruleId).toMatch(/^R-[A-Z]+-\d{3}$/);
      expect(o.ruleVersion).toBeTruthy();
      expect(o.explanation.length).toBeGreaterThan(5);
      expect(o.sourceFields).toBeTypeOf("object");
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it("is deterministic", () => {
    expect(runTriage(input())).toEqual(runTriage(input()));
  });

  it("rules are independently replaceable", () => {
    const onlyData = RULES.filter((r) => r.id === "R-DATA-001");
    const out = runTriage(input({ address: null }), onlyData);
    expect(out.outcomes).toHaveLength(1);
    expect(out.classification).toBe("DATA_RECONCILIATION");
  });
});
