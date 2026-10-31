import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setupTestDatabase, teardownTestDatabase } from "../support/db";
import { db } from "@/server/db/client";
import { auditEvents, dispositionSubmissions, finalizationVerifications, reviewDecisions, workflowTransitions } from "@/server/db/schema";
import { caseByPermit, createLakemont, importCsv, noticeOwner } from "@/server/seed/seed";
import { generateLegacyExport, LEGACY_HEADERS, toCsv } from "@/server/seed/dataset";
import { getOverview } from "@/server/analytics/service";
import { listCases } from "@/server/cases/queries";
import { checkFinalizationWithSystemOfRecord, recordManualFinalizationCheck, routeToFinalizationVerification } from "@/server/cases/finalization";
import { draftNotice } from "@/server/communications/service";
import { buildSnapshot } from "@/server/workflow/service";
import { ConflictError, ValidationError } from "@/server/errors";

let L: Awaited<ReturnType<typeof createLakemont>>;
const REPORTED_FINALS = ["LKM-BLD-2012-02718", "LKM-BLD-2018-08722", "LKM-BLD-2019-01503", "LKM-PLM-2024-01968"];
const lkm = () => ({ jurisdictionId: L.jurisdictions.LKM.id });

beforeAll(async () => {
  await setupTestDatabase();
  L = await createLakemont();
  await importCsv(L.ctx.clerk, "export.csv", toCsv(generateLegacyExport(), LEGACY_HEADERS), lkm());
});
afterAll(teardownTestDatabase);

describe("reported finals", () => {
  it("land in finalization verification, not reconciliation or the unresolved backlog", async () => {
    for (const p of REPORTED_FINALS) expect((await caseByPermit(L.org.id, p)).c.status).toBe("FINALIZATION_VERIFICATION");
    const unresolved = await listCases(L.org.id, { ...lkm(), queue: "unresolved", pageSize: 500 });
    const numbers = unresolved.rows.map((r) => r.permitNumber);
    for (const p of REPORTED_FINALS) expect(numbers).not.toContain(p);
    const { tiles, counts } = await getOverview(L.org.id, lkm());
    expect(tiles.finalizationToVerify).toBe(counts.FINALIZATION_VERIFICATION);
    expect(tiles.finalizationToVerify).toBeGreaterThanOrEqual(REPORTED_FINALS.length);
    expect(tiles.unresolved).toBe(unresolved.total);
  });

  it("cannot be sent into owner outreach while verification is pending", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2019-01503");
    await expect(draftNotice(L.ctx.clerk, c.id, { contactId: "00000000-0000-0000-0000-000000000000", channel: "email" })).rejects.toBeInstanceOf(Error);
    const transitions = await db().select().from(workflowTransitions).where(eq(workflowTransitions.caseId, c.id));
    expect(transitions.map((t) => t.toState)).toEqual(["FINALIZATION_VERIFICATION"]);
  });

  it("records the permit system's confirmation as evidence and resolves the record as already resolved", async () => {
    const before = await getOverview(L.org.id, lkm());
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2012-02718");
    const check = await checkFinalizationWithSystemOfRecord(L.ctx.clerk, c.id);
    expect(check).toMatchObject({ outcome: "confirmed", method: "system_of_record", reportedStatus: "Final", reportedFinalAt: "2012-07-18", sourceFinalAt: "2012-07-18" });
    expect(check.sourceReference).toMatch(/^SIM-PMT-/);
    const after = await caseByPermit(L.org.id, "LKM-BLD-2012-02718");
    expect(after.c.status).toBe("ALREADY_RESOLVED");
    expect(after.c.closedAt).not.toBeNull();
    // Not a PremedFix closure: no official determination, no disposition submission.
    expect(await db().select().from(reviewDecisions).where(and(eq(reviewDecisions.caseId, c.id), eq(reviewDecisions.decisionType, "official_determination")))).toHaveLength(0);
    expect(await db().select().from(dispositionSubmissions).where(eq(dispositionSubmissions.caseId, c.id))).toHaveLength(0);
    const [audit] = await db().select().from(auditEvents).where(and(eq(auditEvents.caseId, c.id), eq(auditEvents.action, "finalization.confirmed")));
    expect(audit.summary).toMatch(/not a PremedFix closure/);
    const tiles = (await getOverview(L.org.id, lkm())).tiles;
    expect(tiles.alreadyResolved).toBe(before.tiles.alreadyResolved + 1);
    expect(tiles.finalizationToVerify).toBe(before.tiles.finalizationToVerify - 1);
    expect(tiles.confirmedResolutions).toBe(before.tiles.confirmedResolutions);
    expect(tiles.unresolved).toBe(before.tiles.unresolved);
  });

  it("returns a final the permit system does not confirm to the backlog, with the imported final disregarded", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2018-08722");
    const check = await checkFinalizationWithSystemOfRecord(L.ctx.clerk, c.id);
    expect(check.outcome).toBe("not_confirmed");
    const after = await caseByPermit(L.org.id, "LKM-BLD-2018-08722");
    expect(after.c.status).toBe("TRIAGED");
    expect(after.c.classification).toBe("EVIDENCE_COLLECTION");
    const unresolved = await listCases(L.org.id, { ...lkm(), queue: "unresolved", pageSize: 500 });
    expect(unresolved.rows.map((r) => r.permitNumber)).toContain("LKM-BLD-2018-08722");
  });

  it("does not let an imported inspection satisfy inspection requirements after the final is rejected", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2019-02504");
    await recordManualFinalizationCheck(L.ctx.clerk, c.id, { outcome: "not_confirmed", sourceReference: "ACC-PMT-2504", note: "Accela shows no passed final inspection for this permit." });
    const after = await caseByPermit(L.org.id, "LKM-BLD-2019-02504");
    expect(after.c.status).toBe("TRIAGED");
    expect((await buildSnapshot(after.c)).passedInspectionRecorded).toBe(false);
  });

  it("requires a reference and the final date for a manual confirmation", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-PLM-2024-01968");
    await expect(recordManualFinalizationCheck(L.ctx.clerk, c.id, { outcome: "confirmed", sourceReference: "ACC-1", note: "Checked inspection history" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordManualFinalizationCheck(L.ctx.inspector, c.id, { outcome: "confirmed", sourceReference: "ACC-1", sourceFinalAt: "2024-03-22", note: "Checked inspection history" })).rejects.toThrow();
    await recordManualFinalizationCheck(L.ctx.clerk, c.id, { outcome: "confirmed", sourceReference: "ACC-PMT-1968", sourceFinalAt: "2024-03-22", note: "Accela inspection history shows the final passed." });
    expect((await caseByPermit(L.org.id, "LKM-PLM-2024-01968")).c.status).toBe("ALREADY_RESOLVED");
    await expect(recordManualFinalizationCheck(L.ctx.clerk, c.id, { outcome: "confirmed", sourceReference: "ACC-2", sourceFinalAt: "2024-03-22", note: "A second check" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps verification evidence append-only", async () => {
    const err = await db()
      .update(finalizationVerifications)
      .set({ note: "edited" })
      .where(sql`true`)
      .catch((e: Error & { cause?: Error }) => e);
    expect(String((err as Error & { cause?: Error }).cause?.message ?? err)).toMatch(/append-only/);
  });

  it("pauses an in-progress case for verification when a re-import reports a final", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2019-02210");
    await noticeOwner(c.id, L.ctx.clerk, L.ctx.admin);
    const rows = generateLegacyExport();
    const target = rows.find((r) => r.PERMIT_NO === "LKM-BLD-2019-02210")!;
    target.STATUS = "Final";
    target.FINAL_DATE = "2019-09-30";
    await importCsv(L.ctx.clerk, "export-final.csv", toCsv(rows, LEGACY_HEADERS), lkm());
    const flagged = await caseByPermit(L.org.id, "LKM-BLD-2019-02210");
    expect(flagged.c.status).toBe("OWNER_CONTACTED");
    expect(flagged.c.flags).toContain("source_reports_final");
    await routeToFinalizationVerification(L.ctx.clerk, c.id, "Re-import reports a final inspection on 2019-09-30");
    expect((await caseByPermit(L.org.id, "LKM-BLD-2019-02210")).c.status).toBe("FINALIZATION_VERIFICATION");
  });
});
