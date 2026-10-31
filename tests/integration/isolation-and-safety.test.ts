import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "../support/db";
import type { ActorContext } from "@/server/auth/context";
import { caseByPermit, createHarbor, createLakemont, homeownerSession, importCsv, noticeOwner, portalTokenFromMailbox } from "@/server/seed/seed";
import { generateLegacyExport, LEGACY_HEADERS, newPermitBatch, NEW_BATCH_HEADERS, toCsv } from "@/server/seed/dataset";
import { getCaseDetail, getEvidenceItemForOrg, listCases, searchCases } from "@/server/cases/queries";
import { transitionCase } from "@/server/workflow/service";
import { ingestEvidence, submitEvidence } from "@/server/evidence/pipeline";
import { getPortalView } from "@/server/portal/service";
import { assignCase, performReviewAction, recordInspection, recordSpecialistAssessment } from "@/server/reviews/service";
import { recordDetermination } from "@/server/disposition/service";
import { getRuleSet } from "@/server/rules/service";
import { photoPng } from "@/server/seed/documents";
import { ForbiddenError, NotFoundError, TransitionError } from "@/server/errors";

let L: Awaited<ReturnType<typeof createLakemont>>;
let H: Awaited<ReturnType<typeof createHarbor>>;

beforeAll(async () => {
  await setupTestDatabase();
  L = await createLakemont();
  H = await createHarbor();
  await importCsv(L.ctx.clerk, "lkm.csv", toCsv(generateLegacyExport(), LEGACY_HEADERS), { jurisdictionId: L.jurisdictions.LKM.id });
  await importCsv(L.ctx.clerk, "lkm-batch.csv", toCsv(newPermitBatch(), NEW_BATCH_HEADERS), { jurisdictionId: L.jurisdictions.LKM.id });
});
afterAll(teardownTestDatabase);

describe("tenant isolation", () => {
  it("another municipality cannot read, search, list, or act on a case", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-BLD-2019-02210");
    await expect(getCaseDetail(H.org.id, c.id)).rejects.toThrow(NotFoundError);
    await expect(transitionCase(H.ctx.admin, { caseId: c.id, transition: "flag_reconciliation", reason: "cross-tenant attempt" })).rejects.toThrow(NotFoundError);
    await expect(assignCase(H.ctx.admin, c.id, { userId: (H.ctx.admin.actor as { userId: string }).userId, kind: "primary" })).rejects.toThrow(NotFoundError);
    expect((await listCases(H.org.id, {})).total).toBe(0);
    expect(await searchCases(H.org.id, "LKM")).toEqual([]);
    const rs = await getRuleSet(L.org.id, (await getCaseDetail(L.org.id, c.id)).triage!.ruleSetId!);
    await expect(getRuleSet(H.org.id, rs.ruleSet.id)).rejects.toThrow(NotFoundError);
  });

  it("a homeowner can only see and act on their own case", async () => {
    const mine = await caseByPermit(L.org.id, "LKM-BLD-2019-04127");
    const other = await caseByPermit(L.org.id, "LKM-BLD-2020-00918");
    const { contact, communicationId } = await noticeOwner(mine.c.id, L.ctx.clerk, L.ctx.admin);
    const token = await portalTokenFromMailbox(communicationId);
    const h: ActorContext = await homeownerSession(token, mine.c.id, contact.name ?? "Owner");
    expect((await getPortalView(h)).permitNumber).toBe("LKM-BLD-2019-04127");
    await expect(ingestEvidence(h, other.c.id, [{ filename: "x.png", bytes: photoPng("roof", 9) }])).rejects.toThrow(NotFoundError);
    await expect(transitionCase(h, { caseId: other.c.id, transition: "submit_evidence" })).rejects.toThrow(NotFoundError);
    await expect(submitEvidence(h, other.c.id)).rejects.toThrow(NotFoundError);
    await expect(getCaseDetail(H.org.id, mine.c.id)).rejects.toThrow(NotFoundError);
    const up = await ingestEvidence(h, mine.c.id, [{ filename: "roof.png", bytes: photoPng("roof", 11) }]);
    await expect(getEvidenceItemForOrg(H.org.id, up.accepted[0].id)).rejects.toThrow(NotFoundError);
    // Homeowner context carries no staff permissions.
    await expect(performReviewAction(h, mine.c.id, { action: "begin_review" })).rejects.toThrow(ForbiddenError);
  });
});

describe("safety-sensitive escalation (scenario B)", () => {
  it("an electrical service case has no path to closure without a specialist assessment and a passed inspection", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-ELE-2016-00388");
    expect(c.classification).toBe("SPECIALIST_REVIEW");
    await performReviewAction(L.ctx.inspector, c.id, { action: "begin_review" });
    await expect(performReviewAction(L.ctx.inspector, c.id, { action: "mark_ready", suggestedAction: "mark_ready" })).rejects.toThrow(TransitionError);

    // A structural/gas inspector without electrical specialty cannot record the electrical assessment.
    await expect(recordSpecialistAssessment(L.ctx.inspector2, c.id, { summary: "Looks fine from the documents provided by owner.", recommendation: "none" })).rejects.toThrow(/electrical specialist/);
    await recordSpecialistAssessment(L.ctx.inspector, c.id, { summary: "Service upgrade by licensed contractor; concealed work cannot be assessed from documents.", recommendation: "Site inspection required" });
    await performReviewAction(L.ctx.inspector, c.id, { action: "require_inspection", reason: "Rule set requires a passed site inspection." });

    const failed = await recordInspection(L.ctx.inspector, c.id, { inspectionType: "site_assessment", result: "failed", inspectedOn: "2026-10-01", notes: "Missing bonding jumper at water service." });
    expect(failed.result).toBe("failed");
    const detail = await getCaseDetail(L.org.id, c.id);
    expect(detail.c.status).toBe("UNDER_STAFF_REVIEW");
    const r = await performReviewAction(L.ctx.inspector, c.id, { action: "mark_ready", suggestedAction: "mark_ready" }).catch((e) => e);
    expect(r).toBeInstanceOf(TransitionError);
    expect((r as TransitionError).details.join(" ")).toMatch(/passed site inspection/);
  });

  it("even an official cannot record a closure for a high-concern case that skipped inspection", async () => {
    const { c } = await caseByPermit(L.org.id, "LKM-ELE-2020-00644");
    await expect(recordDetermination(L.ctx.official, c.id, { determination: "close_requirements_satisfied", reason: "Attempting closure without inspection on record.", attested: true })).rejects.toThrow(TransitionError);
  });
});
