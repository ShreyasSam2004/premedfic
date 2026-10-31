import { describe, expect, it } from "vitest";
import { availableTransitions, checkTransition, emptySnapshot, OPEN_STATES, STATE_META, UNRESOLVED_STATES } from "@/domain/workflow";
import { runTriage, type TriageInput } from "@/server/triage/engine";
import { LAKEMONT_RULESET } from "@/server/rules/defaults";
import { reviewReportedFinal } from "@/server/cases/finalization";
import { simulatedPermitSystem } from "@/server/disposition/service";

const ruleSet = { id: "rs1", version: 1, verified: true, config: LAKEMONT_RULESET };
const input = (permit: Partial<TriageInput["permit"]>, rest: Partial<TriageInput> = {}): TriageInput => ({
  permit: {
    permitNumber: "LKM-BLD-2012-02718",
    category: "roof",
    rawCategory: "Roofing",
    workDescription: "Re-roof",
    address: "1 EXAMPLE ST",
    issuedAt: "2012-04-25",
    expiresAt: "2012-10-22",
    sourceStatus: "finaled",
    finalInspectionAt: "2012-07-18",
    missingFields: [],
    ...permit,
  },
  passedFinalInspection: false,
  openDuplicateCandidates: 0,
  contacts: { total: 1, contactable: 1 },
  ruleSet,
  asOf: "2026-10-31",
  ...rest,
});

describe("reported finals in triage", () => {
  it("never treats an imported final as a closure", () => {
    const out = runTriage(input({}));
    expect(out.classification).toBe("FINALIZATION_CONFIRMATION");
    expect(out.recommendedAction).toMatch(/Verify the reported final/);
    expect(out.explanation).toMatch(/must be verified against the permit system of record/);
  });

  it("disregards a final the system of record did not confirm", () => {
    const out = runTriage(input({}, { finalizationVerification: { outcome: "not_confirmed", at: "2026-10-30", reference: "SIM-PMT-1" } }));
    expect(out.classification).toBe("EVIDENCE_COLLECTION");
    expect(out.outcomes.find((o) => o.ruleId === "R-FINAL-001")?.explanation).toMatch(/not confirmed/);
    expect(out.outcomes.find((o) => o.ruleId === "R-INSP-001")?.outcome).toBe("triggered");
  });

  it("describes a confirmed final as already resolved", () => {
    const out = runTriage(input({}, { finalizationVerification: { outcome: "confirmed", at: "2026-10-30", reference: "SIM-PMT-1" } }));
    expect(out.classification).toBe("FINALIZATION_CONFIRMATION");
    expect(out.recommendedAction).toMatch(/^No action/);
  });
});

describe("finalization states and transitions", () => {
  it("keeps verification and already-resolved records out of the unresolved backlog", () => {
    expect(OPEN_STATES).toContain("FINALIZATION_VERIFICATION");
    expect(UNRESOLVED_STATES).not.toContain("FINALIZATION_VERIFICATION");
    expect(UNRESOLVED_STATES).not.toContain("ALREADY_RESOLVED");
    expect(STATE_META.ALREADY_RESOLVED.open).toBe(false);
  });

  it("offers no outreach, evidence, or inspection path while verification is pending", () => {
    const ids = ["admin", "clerk", "inspector", "official", "manager"].flatMap((a) => availableTransitions("FINALIZATION_VERIFICATION", a as "admin").map((t) => t.id));
    expect(new Set(ids)).toEqual(new Set(["confirm_prior_finalization", "finalization_not_confirmed"]));
  });

  it("routes a reported final to verification but not after the system of record rejected it", () => {
    const snap = emptySnapshot({ classification: "FINALIZATION_CONFIRMATION" });
    expect(checkTransition("route_finalization_verification", "IMPORTED", "system", snap, "reported final").allowed).toBe(true);
    expect(checkTransition("route_finalization_verification", "OWNER_CONTACTED", "clerk", snap, "reported final").allowed).toBe(true);
    expect(checkTransition("route_finalization_verification", "READY_FOR_AUTHORIZED_DISPOSITION", "clerk", snap, "x").allowed).toBe(false);
    const rejected = { ...snap, finalizationVerification: "not_confirmed" as const };
    expect(checkTransition("route_finalization_verification", "TRIAGED", "system", rejected, "reported final").problems).toContain("The system of record already showed this permit as not finaled");
  });

  it("resolves only with recorded evidence, and never as a PremedFix closure", () => {
    const pending = emptySnapshot({ classification: "FINALIZATION_CONFIRMATION" });
    expect(checkTransition("confirm_prior_finalization", "FINALIZATION_VERIFICATION", "clerk", pending, "verified").problems).toContain(
      "Record the system of record's confirmation of the final first",
    );
    const confirmed = { ...pending, finalizationVerification: "confirmed" as const };
    expect(checkTransition("confirm_prior_finalization", "FINALIZATION_VERIFICATION", "clerk", confirmed, "verified").allowed).toBe(true);
    expect(checkTransition("confirm_prior_finalization", "FINALIZATION_VERIFICATION", "inspector", confirmed, "verified").allowed).toBe(false);
    expect(checkTransition("finalization_not_confirmed", "FINALIZATION_VERIFICATION", "clerk", confirmed, "verified").allowed).toBe(false);
  });

  it("blocks owner outreach for an unverified reported final", () => {
    const snap = emptySnapshot({ classification: "FINALIZATION_CONFIRMATION", contactable: true, pendingDraftNotice: true });
    expect(checkTransition("queue_notice", "TRIAGED", "clerk", snap).allowed).toBe(false);
    expect(checkTransition("queue_notice", "TRIAGED", "clerk", { ...snap, finalizationVerification: "not_confirmed" }).allowed).toBe(true);
  });
});

describe("why a reported final still needs verification", () => {
  const permit = {
    permitNumber: "LKM-BLD-2012-02718",
    sourceStatus: "finaled",
    sourceStatusRaw: "Final",
    finalInspectionAt: "2012-07-18",
    issuedAt: "2012-04-25",
    expiresAt: "2012-10-22",
    sourceSystem: "Accela export 2026-03",
  };
  const base = { permit, source: { filename: "lakemont_legacy_export_2026-03.csv", importedAt: new Date("2026-04-04T12:00:00Z") }, passedInspectionRecords: 0, openDuplicates: 0, latest: null, today: "2026-10-31" };

  it("explains each reason for LKM-BLD-2012-02718", () => {
    const r = reviewReportedFinal(base);
    expect(r.reportedBy).toBe("Imported record (Accela export 2026-03; file lakemont_legacy_export_2026-03.csv, imported 2026-04-04)");
    const byLabel = Object.fromEntries(r.items.map((i) => [i.label, i.ok]));
    expect(byLabel).toEqual({
      "Reported by an import, not confirmed by the permit system": false,
      "Status reads as finaled": true,
      "Final inspection date is consistent": true,
      "No recorded inspection": false,
      "No system-of-record confirmation": false,
    });
    expect(r.summary).toMatch(/^Verification is still required/);
  });

  it("flags inconsistent or missing dates", () => {
    const early = reviewReportedFinal({ ...base, permit: { ...permit, finalInspectionAt: "2012-01-02" } });
    expect(early.items.find((i) => i.label === "Final inspection date is inconsistent")?.detail).toMatch(/precedes the issue date/);
    const none = reviewReportedFinal({ ...base, permit: { ...permit, finalInspectionAt: null } });
    expect(none.items.some((i) => i.label === "No final inspection date" && i.ok === false)).toBe(true);
  });

  it("the simulated permit system confirms only a consistent final", async () => {
    expect((await simulatedPermitSystem.lookupPermit({ permitNumber: "A", issuedAt: "2012-04-25", finalInspectionAt: "2012-07-18" })).finaled).toBe(true);
    expect((await simulatedPermitSystem.lookupPermit({ permitNumber: "A", issuedAt: "2012-04-25", finalInspectionAt: null })).finaled).toBe(false);
    expect((await simulatedPermitSystem.lookupPermit({ permitNumber: "A", issuedAt: "2012-04-25", finalInspectionAt: "2011-01-01" })).finaled).toBe(false);
  });
});
