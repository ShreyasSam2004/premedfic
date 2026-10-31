import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setupTestDatabase, teardownTestDatabase } from "../support/db";
import { db } from "@/server/db/client";
import { cases, duplicateCandidates, permits, permitSourceRecords, triageResults } from "@/server/db/schema";
import { createLakemont, importCsv, caseByPermit } from "@/server/seed/seed";
import { generateLegacyExport, LEGACY_HEADERS, newPermitBatch, NEW_BATCH_HEADERS, toCsv } from "@/server/seed/dataset";
import { commitImport, previewImport, stageImport } from "@/server/imports/service";
import { confirmDuplicate } from "@/server/cases/reconciliation";
import { ValidationError } from "@/server/errors";

let L: Awaited<ReturnType<typeof createLakemont>>;
const count = async (table: typeof cases | typeof permits) => (await db().select({ n: sql<number>`count(*)::int` }).from(table))[0].n;

beforeAll(async () => {
  await setupTestDatabase();
  L = await createLakemont();
});
afterAll(teardownTestDatabase);

describe("import → case creation", () => {
  it("previews without writing, then commits rows into permits, cases, and triage results", async () => {
    const csv = toCsv(generateLegacyExport(), LEGACY_HEADERS);
    const batch = await stageImport(L.ctx.clerk, { filename: "export.csv", bytes: new TextEncoder().encode(csv) });
    const preview = await previewImport(L.ctx.clerk, batch.id, { mapping: batch.columnMapping!, jurisdictionId: L.jurisdictions.LKM.id });
    expect(preview.summary.total).toBe(112);
    expect(preview.summary.error).toBe(1);
    expect(await count(permits)).toBe(0);

    const res = await commitImport(L.ctx.clerk, batch.id, { mapping: batch.columnMapping!, jurisdictionId: L.jurisdictions.LKM.id });
    expect(res.batch.status).toBe("completed");
    expect(res.batch.createdCount).toBe(111);
    expect(await count(permits)).toBe(111);
    expect(await count(cases)).toBe(111);
    const untriaged = await db().select().from(cases).where(eq(cases.status, "IMPORTED"));
    expect(untriaged).toHaveLength(0);
    const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(triageResults);
    expect(n).toBe(111);
  });

  it("preserves original rows separately, including rejected rows", async () => {
    const rejected = await db().select().from(permitSourceRecords).where(eq(permitSourceRecords.outcome, "error"));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].permitId).toBeNull();
    expect(rejected[0].raw.SITE_ADDRESS).toBe("88 Palmetto St");
    const { permit } = await caseByPermit(L.org.id, "LKM-BLD-2013-01142");
    const [src] = await db().select().from(permitSourceRecords).where(eq(permitSourceRecords.permitId, permit.id));
    expect(src.raw.EXPIRES).toBe("13/45/2013");
    expect(permit.expiresAt).toBeNull();
    expect(permit.fieldWarnings.some((w) => w.field === "expiresAt")).toBe(true);
  });

  it("routes incomplete records to reconciliation and flags the cross-system duplicate", async () => {
    const missing = await caseByPermit(L.org.id, "LKM-BLD-2014-00733");
    expect(missing.c.status).toBe("NEEDS_DATA_RECONCILIATION");
    const a = await caseByPermit(L.org.id, "LKM-BLD-2018-00412");
    const b = await caseByPermit(L.org.id, "LKMBLD2018-412");
    expect(a.c.status).toBe("NEEDS_DATA_RECONCILIATION");
    expect(b.c.status).toBe("NEEDS_DATA_RECONCILIATION");
    const dups = await db().select().from(duplicateCandidates);
    expect(dups).toHaveLength(1);
    expect(a.permit.propertyId).toBe(b.permit.propertyId);
  });

  it("reconciles a confirmed duplicate without deleting either record", async () => {
    const [cand] = await db().select().from(duplicateCandidates);
    const a = await caseByPermit(L.org.id, "LKM-BLD-2018-00412");
    await confirmDuplicate(L.ctx.clerk, cand.id, { primaryPermitId: a.permit.id, note: "Same permit; Accela record is authoritative." });
    const b = await caseByPermit(L.org.id, "LKMBLD2018-412");
    expect(b.c.status).toBe("MERGED_DUPLICATE");
    expect(b.permit.duplicateOfPermitId).toBe(a.permit.id);
    expect((await caseByPermit(L.org.id, "LKM-BLD-2018-00412")).c.status).toBe("TRIAGED");
  });

  it("re-importing the same file reconciles instead of duplicating", async () => {
    const before = await count(permits);
    const csv = toCsv(generateLegacyExport(), LEGACY_HEADERS);
    const res = await importCsv(L.ctx.clerk, "export-again.csv", csv, { jurisdictionId: L.jurisdictions.LKM.id });
    expect(res.batch.createdCount).toBe(0);
    expect(res.batch.unchangedCount).toBe(111);
    expect(await count(permits)).toBe(before);
  });

  it("re-import with a changed field records the diff and never erases known values with blanks", async () => {
    const rows = generateLegacyExport();
    const target = rows.find((r) => r.PERMIT_NO === "LKM-BLD-2019-02210")!;
    target.STATUS = "Final";
    target.FINAL_DATE = "2020-04-02";
    target.CONTRACTOR = "";
    const res = await importCsv(L.ctx.clerk, "export-changed.csv", toCsv(rows, LEGACY_HEADERS), { jurisdictionId: L.jurisdictions.LKM.id });
    expect(res.batch.updatedCount).toBe(1);
    const { permit, c } = await caseByPermit(L.org.id, "LKM-BLD-2019-02210");
    expect(permit.finalInspectionAt).toBe("2020-04-02");
    expect(permit.contractorName).toBe("Lakemont Roof Pros Inc.");
    const [src] = await db()
      .select()
      .from(permitSourceRecords)
      .where(and(eq(permitSourceRecords.permitId, permit.id), eq(permitSourceRecords.outcome, "updated")));
    expect(src.changes?.finalInspectionAt).toEqual({ from: null, to: "2020-04-02" });
    // A newly reported final sends the triaged case to verification, not to outreach or reconciliation.
    expect(c.status).toBe("FINALIZATION_VERIFICATION");
  });

  it("commit is idempotent, and a differently formatted export maps cleanly", async () => {
    const csv = toCsv(newPermitBatch(), NEW_BATCH_HEADERS);
    const batch = await stageImport(L.ctx.admin, { filename: "batch.csv", bytes: new TextEncoder().encode(csv) });
    const opts = { mapping: batch.columnMapping!, jurisdictionId: L.jurisdictions.LKM.id };
    const first = await commitImport(L.ctx.admin, batch.id, opts);
    expect(first.batch.createdCount).toBe(7);
    expect(first.batch.errorCount).toBe(2); // one missing permit ID + one duplicate row in the file
    const second = await commitImport(L.ctx.admin, batch.id, opts);
    expect(second.alreadyCommitted).toBe(true);
    expect((await caseByPermit(L.org.id, "LKM-ELE-2020-00644")).c.classification).toBe("SPECIALIST_REVIEW");
    expect((await caseByPermit(L.org.id, "LKM-BLD-2026-00811")).c.classification).toBe("MONITOR_ACTIVE");
  });

  it("rejects malformed files and unauthorized importers", async () => {
    await expect(stageImport(L.ctx.clerk, { filename: "x.csv", bytes: new TextEncoder().encode("only_one_column\n1\n") })).rejects.toThrow(ValidationError);
    await expect(stageImport(L.ctx.clerk, { filename: "x.xlsx", bytes: new TextEncoder().encode("a,b\n1,2\n") })).rejects.toThrow(/Only .csv/);
    await expect(stageImport(L.ctx.clerk, { filename: "x.csv", bytes: new Uint8Array([0, 1, 2, 0]) })).rejects.toThrow();
    await expect(stageImport(L.ctx.inspector, { filename: "x.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") })).rejects.toThrow(/not authorized/);
  });
});
