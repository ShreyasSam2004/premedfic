import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDatabase, teardownTestDatabase } from "../support/db";
import { db } from "@/server/db/client";
import { auditEvents, triageResults } from "@/server/db/schema";
import { caseByPermit, createLakemont, importCsv } from "@/server/seed/seed";
import { generateLegacyExport, LEGACY_HEADERS, toCsv } from "@/server/seed/dataset";
import { createDraftFromVersion, getActiveRuleSet, getRuleSet, updateRuleSetDraft, verifyRuleSet } from "@/server/rules/service";
import { activateAndApply, getRuleSetApplication, previewRuleSetImpact } from "@/server/rules/impact-service";
import { defaultCategoryRule } from "@/domain/rule-library";
import type { RuleSetConfig } from "@/server/rules/config";
import { ConflictError, ForbiddenError } from "@/server/errors";

let L: Awaited<ReturnType<typeof createLakemont>>;
let draftId: string;
let activeId: string;

const meta = { name: "Lakemont policy with HVAC", effectiveDate: "2026-11-01", sourceCitation: "Administrative Policy BD-2026-04 (fictional)", sourceUrl: null, changeSummary: "Add document-based review for HVAC replacements" };
const triageOf = async (permitNumber: string) => {
  const { c } = await caseByPermit(L.org.id, permitNumber);
  const [t] = await db().select().from(triageResults).where(eq(triageResults.id, c.currentTriageId!));
  return { c, t };
};

beforeAll(async () => {
  await setupTestDatabase();
  L = await createLakemont();
  await importCsv(L.ctx.clerk, "export.csv", toCsv(generateLegacyExport(), LEGACY_HEADERS), { jurisdictionId: L.jurisdictions.LKM.id });
  activeId = (await getActiveRuleSet(L.org.id, L.jurisdictions.LKM.id))!.id;
});
afterAll(teardownTestDatabase);

describe("rule editor and impact preview", () => {
  it("imports uncovered work types into their own categories, routed to staff review", async () => {
    for (const [permit, category] of [["LKM-MEC-2019-00611", "hvac"], ["LKM-PLM-2019-08388", "plumbing"], ["LKM-PLM-2020-08764", "irrigation"], ["LKM-BLD-2019-08015", "door"]]) {
      const { c, t } = await triageOf(permit);
      expect(c.classification).toBe("STAFF_REVIEW");
      expect(t.ruleSetVersion).toBe(1);
      expect((await caseByPermit(L.org.id, permit)).permit.category).toBe(category);
    }
  });

  it("starts a draft that changes nothing until edited", async () => {
    const draft = await createDraftFromVersion(L.ctx.admin, activeId, { changeSummary: meta.changeSummary });
    draftId = draft.id;
    expect(draft.status).toBe("draft");
    const p = await previewRuleSetImpact(L.ctx.admin, draftId);
    expect(p.changed).toBe(0);
    expect(p.configDiff).toEqual([]);
    expect(p.evaluated).toBeGreaterThan(50);
  });

  it("previews the cases a new HVAC rule would move, flagged as less cautious", async () => {
    const { ruleSet } = await getRuleSet(L.org.id, draftId);
    const config = structuredClone(ruleSet.config) as RuleSetConfig;
    config.categories.hvac = defaultCategoryRule("hvac");
    await updateRuleSetDraft(L.ctx.admin, draftId, { ...meta, config });
    const p = await previewRuleSetImpact(L.ctx.inspector, draftId);
    const moved = p.changes.map((c) => c.permitNumber).sort();
    expect(moved).toEqual(["LKM-MEC-2019-00611", "LKM-MEC-2020-00277"]);
    expect(p.changes.every((c) => c.lessCautious && c.after.classification === "EVIDENCE_COLLECTION")).toBe(true);
    expect(p.lessCautious.toDocumentReview).toBe(2);
    expect(p.transitions).toEqual([{ from: "STAFF_REVIEW", to: "EVIDENCE_COLLECTION", count: 2 }]);
    expect(p.configDiff[0]).toMatch(/^Adds a rule for HVAC replacement/);
  });

  it("allows only administrators to edit, and only drafts", async () => {
    const { ruleSet } = await getRuleSet(L.org.id, draftId);
    await expect(updateRuleSetDraft(L.ctx.clerk, draftId, { ...meta, config: ruleSet.config })).rejects.toBeInstanceOf(ForbiddenError);
    const active = await getRuleSet(L.org.id, activeId);
    await expect(updateRuleSetDraft(L.ctx.admin, activeId, { ...meta, config: active.ruleSet.config })).rejects.toBeInstanceOf(ConflictError);
  });

  it("clears a source-review attestation when the draft is edited again", async () => {
    await verifyRuleSet(L.ctx.admin, draftId, { reviewedByName: "Avery Chen", note: "Reviewed against BD-2026-04" });
    const { ruleSet } = await getRuleSet(L.org.id, draftId);
    expect(ruleSet.verificationStatus).toBe("verified");
    await updateRuleSetDraft(L.ctx.admin, draftId, { ...meta, config: ruleSet.config });
    const after = (await getRuleSet(L.org.id, draftId)).ruleSet;
    expect(after.verificationStatus).toBe("unverified");
    expect(after.reviewedByName).toBeNull();
    const events = await db().select().from(auditEvents).where(eq(auditEvents.action, "rules.draft_updated"));
    expect(events.some((e) => (e.metadata as { attestationCleared?: boolean }).attestationCleared)).toBe(true);
  });

  it("activates and re-runs triage on exactly the changed cases", async () => {
    await verifyRuleSet(L.ctx.admin, draftId, { reviewedByName: "Avery Chen", note: "Reviewed against BD-2026-04" });
    const roofBefore = await triageOf("LKM-BLD-2019-02210");
    const r = await activateAndApply(L.ctx.admin, draftId, { retriage: true });
    expect(r.retriaged).toBe(2);
    expect(r.ruleSet.status).toBe("active");
    const hvac = await triageOf("LKM-MEC-2019-00611");
    expect(hvac.c.classification).toBe("EVIDENCE_COLLECTION");
    expect(hvac.t.ruleSetVersion).toBe(r.ruleSet.version);
    expect((hvac.t.requiredEvidence as { code: string }[]).map((e) => e.code)).toEqual(["contractor_invoice", "equipment_photo", "owner_statement"]);
    // Unaffected cases keep the result computed under the prior version.
    const roofAfter = await triageOf("LKM-BLD-2019-02210");
    expect(roofAfter.t.id).toBe(roofBefore.t.id);
    expect((await getRuleSet(L.org.id, activeId)).ruleSet.status).toBe("superseded");
    expect(await getRuleSetApplication(L.org.id, draftId)).toMatchObject({ retriaged: 2 });
  });
});
