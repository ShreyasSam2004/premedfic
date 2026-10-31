import { describe, expect, it } from "vitest";
import { parseRuleSetConfig } from "@/server/rules/config";
import { CEDAR_BLUFF_FL_REFERENCE_RULESET, LAKEMONT_RULESET } from "@/server/rules/defaults";
import { lintMessage, renderTemplate, TEMPLATES, type Channel, type TemplateId } from "@/server/communications/templates";

describe("rule set configuration", () => {
  it("default rule sets validate", () => {
    expect(parseRuleSetConfig(LAKEMONT_RULESET).ok).toBe(true);
    expect(parseRuleSetConfig(CEDAR_BLUFF_FL_REFERENCE_RULESET).ok).toBe(true);
  });

  it("rejects invalid patterns, inverted thresholds, and unsafe high-concern rules", () => {
    const bad = structuredClone(LAKEMONT_RULESET);
    bad.descriptionEscalations[0].pattern = "(unclosed";
    bad.priority.thresholds = { P1: 10, P2: 40, P3: 22 };
    bad.categories.electrical_service = { ...bad.categories.electrical_service!, siteInspectionRequired: false };
    const r = parseRuleSetConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/invalid pattern/);
      expect(r.errors.join("\n")).toMatch(/P1 > P2 > P3/);
      expect(r.errors.join("\n")).toMatch(/must require a site inspection/);
    }
  });

  it("rejects unknown fields types and empty approval authority", () => {
    const bad = structuredClone(LAKEMONT_RULESET) as unknown as { categories: { roof: { approvalAuthority: string[] } } };
    bad.categories.roof.approvalAuthority = [];
    expect(parseRuleSetConfig(bad).ok).toBe(false);
    expect(parseRuleSetConfig({ schemaVersion: 2 }).ok).toBe(false);
  });

  it("the Florida reference states the provision is permissive and determination-based", () => {
    const p = CEDAR_BLUFF_FL_REFERENCE_RULESET.agedPermitProvision!;
    expect(p.citation).toBe("Fla. Stat. § 553.79(16)(c) (2025)");
    expect(p.determinationRequired).toMatch(/MAY close/);
    expect(p.determinationRequired).toMatch(/not entitlement/);
    expect(LAKEMONT_RULESET.agedPermitProvision).toBeNull();
  });
});

describe("message templates", () => {
  const ctx = {
    ownerName: "Dana Whitfield",
    permitNumber: "LKM-BLD-2019-04127",
    address: "418 MAGNOLIA AVE",
    categoryLabel: "Roof replacement",
    departmentName: "City of Lakemont Building Division",
    departmentPhone: "(555) 010-4400",
    departmentEmail: "permits@lakemont.example",
    portalUrl: "https://example.test/portal/abc",
    requestedItems: ["Contractor invoice"],
    requestMessage: "Please upload the second page of the invoice.",
    code: "123456",
    statusMessage: "Your permit record has been updated.",
  };

  it("every template and channel passes tone review", () => {
    for (const [id, t] of Object.entries(TEMPLATES)) {
      for (const ch of Object.keys(t.channels)) {
        const r = renderTemplate(id as TemplateId, ch as Channel, ctx);
        expect(lintMessage(r.body), `${id}/${ch}`).toEqual([]);
        expect(r.body).not.toMatch(/\{|\}/);
      }
    }
  });

  it("the initial notice uses the non-threatening framing", () => {
    const r = renderTemplate("initial_notice", "email", ctx);
    expect(r.body).toContain("may still require administrative resolution");
    expect(r.body).toContain("not a finding that anything is wrong");
  });

  it("lint catches threatening, payment, and legal-conclusion language", () => {
    expect(lintMessage("Failure to respond will result in fines.")).toEqual(expect.arrayContaining(["mentions fines", "threatening language"]));
    expect(lintMessage("Payment is due immediately.")).toContain("implies payment is required");
    expect(lintMessage("Your roof is unsafe.")).toContain("implies a legal or safety conclusion");
    expect(lintMessage("This is a code violation.")).toContain("alleges a violation");
  });
});
