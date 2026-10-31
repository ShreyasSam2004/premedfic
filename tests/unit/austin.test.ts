import { describe, expect, it } from "vitest";
import { AUSTIN_MAPPING, austinToCanonical, deriveAustinCategory, type AustinRow } from "@/server/imports/austin";
import { normalizeRow } from "@/server/imports/normalize";

const row = (permittype: string, work_class: string, description: string, extra: AustinRow = {}): AustinRow => ({ permittype, work_class, description, ...extra });

describe("Austin category derivation", () => {
  it("assigns standard categories only to recognizable single-scope jobs", () => {
    expect(deriveAustinCategory(row("PP", "Change Out", "Replacement of an existing water heater")).category).toBe("water_heater");
    expect(deriveAustinCategory(row("BP", "Repair", "REPLACE WINDOWS SIZE FOR SIZE ON EXISTING SINGLE-FAMILY RESIDENCE.")).category).toBe("window");
    expect(deriveAustinCategory(row("BP", "Remodel", "RE-ROOF RESIDENCE")).category).toBe("roof");
    expect(deriveAustinCategory(row("BP", "New", "Construct 6 ft privacy fence along rear property line")).category).toBe("fence");
  });

  it("lets every high-concern signal win", () => {
    expect(deriveAustinCategory(row("EP", "Remodel", "A/C CHANGEOUT RESIDENTIAL")).category).toBe("electrical_service");
    expect(deriveAustinCategory(row("PP", "Change Out", "Replace 50 gal gas water heater")).category).toBe("gas");
    expect(deriveAustinCategory(row("BP", "Repair", "EXPRESS: FOUNDATION REPAIR")).category).toBe("structural");
    expect(deriveAustinCategory(row("BP", "Addition", "Add covered patio to rear")).category).toBe("addition");
  });

  it("falls back to Other rather than guessing", () => {
    // Pool permits carry boilerplate about the barrier fence.
    const pool = row("BP", "New", "New in-ground swimming pool. The fence must be at least 4 ft in height with a self-closing gate.");
    expect(deriveAustinCategory(pool).category).toBe("other");
    expect(deriveAustinCategory(row("BP", "Remodel", "Re-roof and remodel kitchen")).category).toBe("other");
    expect(deriveAustinCategory(row("MP", "Remodel", "Re-roof")).category).toBe("other");
    // Found in the spot check of real Austin records.
    expect(deriveAustinCategory(row("BP", "Remodel", "Change From Flat To Pitch Roof")).category).toBe("other");
    expect(deriveAustinCategory(row("BP", "Remodel", "Remod. To Incl Replace Windows Remove Fireplace Ut. Rm. Replumb")).category).toBe("other");
    expect(deriveAustinCategory(row("BP", "Repair", "Replacement of 16 windows and 3 doors. New stairwell treads and guardrail")).category).toBe("other");
    expect(deriveAustinCategory(row("PP", "Repair", "Relocate water heater from attic to garage")).category).toBe("other");
  });

  it("derives HVAC only for mechanical change-outs without fuel-burning equipment", () => {
    expect(deriveAustinCategory(row("MP", "Change Out", "Replacement of complete existing central heat and air system with or without duct work")).category).toBe("hvac");
    expect(deriveAustinCategory(row("MP", "Change Out", "Change out to existing residence only")).category).toBe("hvac");
    expect(deriveAustinCategory(row("MP", "Change Out", "Replacement of furnace only")).category).toBe("gas");
    expect(deriveAustinCategory(row("MP", "Change Out", "Replace HVAC and add electrical circuit")).category).toBe("electrical_service");
    expect(deriveAustinCategory(row("MP", "Remodel", "NEW RESIDENCE")).category).toBe("other");
    expect(deriveAustinCategory(row("PP", "Irrigation", "Install irrigation system to existing residence only")).category).toBe("irrigation");
    expect(deriveAustinCategory(row("BP", "Repair", "REPLACE DOOR SIZE FOR SIZE ON EXISTING SINGLE-FAMILY RESIDENCE")).category).toBe("door");
  });

  it("keeps closely related scope with its category", () => {
    expect(deriveAustinCategory(row("BP", "Repair", "Replace windows and exterior door")).category).toBe("window");
    expect(deriveAustinCategory(row("PP", "Change Out", "Replace 50 gallon electric water heater")).category).toBe("water_heater");
  });

  it("maps through the importer without treating completed_date as a final inspection", () => {
    const { raw, derivation } = austinToCanonical(
      row("PP", "Change Out", "Replacement of an existing water heater", {
        permit_number: "2017-144584 PP",
        original_address1: "100 Example St",
        issue_date: "2017-11-17T00:00:00.000",
        expiresdate: "2018-05-16T00:00:00.000",
        completed_date: "2018-05-16T00:00:00.000",
        status_current: "Expired",
      }),
    );
    const r = normalizeRow(raw, AUSTIN_MAPPING);
    expect(r.ok).toBe(true);
    expect(r.record?.category).toBe(derivation.category);
    expect(r.record?.sourceStatus).toBe("expired");
    expect(r.record?.issuedAt).toBe("2017-11-17");
    expect(r.record?.finalInspectionAt).toBeNull();
  });
});
