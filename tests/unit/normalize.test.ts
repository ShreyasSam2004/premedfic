import { describe, expect, it } from "vitest";
import {
  normalizeAddressKey,
  normalizeCategory,
  normalizeDate,
  normalizeEmail,
  normalizePermitNumber,
  normalizePhone,
  normalizeRow,
  normalizeStatus,
} from "@/server/imports/normalize";
import { suggestMapping, validateMapping } from "@/server/imports/mapping";

describe("normalizeDate", () => {
  it.each([
    ["2019-03-14", "2019-03-14"],
    ["3/14/2019", "2019-03-14"],
    ["03/14/19", "2019-03-14"],
    ["14-MAR-2019", "2019-03-14"],
    ["March 14, 2019", "2019-03-14"],
    ["20190314", "2019-03-14"],
    ["2019-03-14T00:00:00Z", "2019-03-14"],
  ])("parses %s", (raw, expected) => {
    expect(normalizeDate(raw).value).toBe(expected);
  });

  it("treats blanks as absent without warnings", () => {
    for (const b of ["", "  ", "N/A", "null", "0000-00-00"]) expect(normalizeDate(b)).toEqual({ value: null });
  });

  it("never fabricates invalid calendar dates", () => {
    const r = normalizeDate("13/45/2013");
    expect(r.value).toBeNull();
    expect(r.warning).toMatch(/Invalid calendar date/);
    expect(normalizeDate("2019-02-30").value).toBeNull();
  });

  it("flags unrecognized formats with the raw value", () => {
    const r = normalizeDate("sometime in spring");
    expect(r.value).toBeNull();
    expect(r.warning).toContain("sometime in spring");
  });

  it("interprets spreadsheet serial dates with a warning", () => {
    const r = normalizeDate("43538");
    expect(r.value).toBe("2019-03-14");
    expect(r.warning).toMatch(/serial/);
  });

  it("expands two-digit years around the pivot", () => {
    expect(normalizeDate("01/02/98", 2026).value).toBe("1998-01-02");
    expect(normalizeDate("01/02/26", 2026).value).toBe("2026-01-02");
  });
});

describe("normalizeStatus / normalizeCategory", () => {
  it.each([
    ["EXPIRED", "expired"],
    ["Exp - No Final", "expired"],
    ["Expired - No Final", "expired"],
    ["FINALED", "finaled"],
    ["C/O Issued", "finaled"],
    ["Issued", "issued"],
    ["Inspections in progress", "active"],
    ["VOID", "void"],
    ["Withdrawn", "cancelled"],
  ])("status %s → %s", (raw, expected) => expect(normalizeStatus(raw).value).toBe(expected));

  it("returns unknown with a warning for unrecognized status", () => {
    const r = normalizeStatus("Pending Plan Review Hold");
    expect(r.value).toBe("unknown");
    expect(r.warning).toBeTruthy();
  });

  it.each([
    ["RES RE-ROOF", "roof"],
    ["WINDOW/DOOR REPL", "window"],
    ["W/H CHANGE OUT", "water_heater"],
    ["ELEC SVC CHANGE", "electrical_service"],
    ["GAS PIPING", "gas"],
    ["STRUCT REPAIR", "structural"],
    ["Room Addition", "addition"],
    ["Fence", "fence"],
    ["HVAC CHANGE OUT", "hvac"],
    ["Replace heat pump system", "hvac"],
    ["Furnace change out", "gas"],
    ["Plumbing - Repipe", "plumbing"],
    ["Irrigation", "irrigation"],
    ["Fire sprinkler system", "other"],
    ["Door Replacement", "door"],
  ])("category %s → %s", (raw, expected) => expect(normalizeCategory(raw).value).toBe(expected));

  it("maps unmodeled categories to other with a warning, and blanks to null", () => {
    expect(normalizeCategory("Pool Barrier")).toMatchObject({ value: "other" });
    expect(normalizeCategory("Pool Barrier").warning).toBeTruthy();
    expect(normalizeCategory("").value).toBeNull();
  });
});

describe("identifiers", () => {
  it("builds exact and loose permit keys", () => {
    const a = normalizePermitNumber("LKM-BLD-2018-00412")!;
    const b = normalizePermitNumber(" lkmbld2018-412 ")!;
    expect(a.key).toBe("LKM-BLD-2018-00412");
    expect(a.key).not.toBe(b.key);
    expect(a.looseKey).toBe(b.looseKey);
    expect(normalizePermitNumber("")).toBeNull();
  });

  it("normalizes address suffixes, directions, and units", () => {
    expect(normalizeAddressKey("1209 Cypress Street")).toBe(normalizeAddressKey("1209 CYPRESS ST."));
    expect(normalizeAddressKey("10 North Elm Avenue Apt 4")).toBe("10 N ELM AVE UNIT 4");
  });

  it("validates contact fields without guessing", () => {
    expect(normalizeEmail("June.Sato@Example.com").value).toBe("june.sato@example.com");
    expect(normalizeEmail("june.sato@example").value).toBeNull();
    expect(normalizePhone("555.010.4410").value).toBe("(555) 010-4410");
    expect(normalizePhone("12345").value).toBeNull();
  });
});

describe("normalizeRow", () => {
  const mapping = suggestMapping(["PERMIT_NO", "SITE_ADDRESS", "PERMIT_TYPE", "ISSUED", "EXPIRES", "STATUS", "OWNER_EMAIL"]);

  it("rejects rows without a permit ID", () => {
    const r = normalizeRow({ PERMIT_NO: "", SITE_ADDRESS: "1 A St", PERMIT_TYPE: "Fence", ISSUED: "2020-01-01", EXPIRES: "", STATUS: "", OWNER_EMAIL: "" }, mapping);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Missing permit ID/);
  });

  it("records missing essentials instead of inventing them", () => {
    const r = normalizeRow({ PERMIT_NO: "X-2020-1", SITE_ADDRESS: "", PERMIT_TYPE: "", ISSUED: "garbage", EXPIRES: "", STATUS: "Expired", OWNER_EMAIL: "bad" }, mapping);
    expect(r.ok).toBe(true);
    expect(r.record!.missingFields).toEqual(["address", "category", "issuedAt"]);
    expect(r.record!.expiresAt).toBeNull();
    expect(r.record!.ownerEmail).toBeNull();
    expect(r.warnings.map((w) => w.field)).toEqual(expect.arrayContaining(["issuedAt", "ownerEmail"]));
  });

  it("warns when expiration precedes issuance", () => {
    const r = normalizeRow({ PERMIT_NO: "X-1", SITE_ADDRESS: "1 A St", PERMIT_TYPE: "Fence", ISSUED: "2020-05-01", EXPIRES: "2020-01-01", STATUS: "", OWNER_EMAIL: "" }, mapping);
    expect(r.warnings.some((w) => /precedes/.test(w.message))).toBe(true);
  });
});

describe("mapping", () => {
  it("suggests canonical fields from messy headers", () => {
    const m = suggestMapping(["Permit Number", "Address", "Type", "Issue Date", "Expiration Date", "Owner Email", "LIC_NO", "Record ID"]);
    expect(m).toMatchObject({ permitNumber: "Permit Number", address: "Address", category: "Type", issuedAt: "Issue Date", expiresAt: "Expiration Date", ownerEmail: "Owner Email", contractorLicense: "LIC_NO", sourceRecordId: "Record ID" });
  });

  it("validates required fields and duplicate columns", () => {
    expect(validateMapping({}, ["a"])).toContain("Permit ID must be mapped to a column");
    expect(validateMapping({ permitNumber: "a", address: "a" }, ["a"]).some((p) => /mapped to both/.test(p))).toBe(true);
    expect(validateMapping({ permitNumber: "zzz" }, ["a"]).some((p) => /does not exist/.test(p))).toBe(true);
  });
});
