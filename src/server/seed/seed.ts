/**
 * Demo environment seed. Creates two organizations (for tenant-isolation
 * demos), versioned rule sets, imports the synthetic export through the real
 * import pipeline, then advances a subset of cases through the real workflow
 * services under a backdated clock so every record has a genuine history.
 */
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { StaffRole } from "@/domain/roles";
import { db } from "../db/client";
import { cases, communications, contacts, evidenceRequirements, jurisdictions, memberships, organizations, permits, simulatedMailbox, users } from "../db/schema";
import type { ActorContext } from "../auth/context";
import { hashPassword } from "../auth/password";
import { withClock } from "../util";
import { activateRuleSet, createRuleSetVersion, verifyRuleSet } from "../rules/service";
import { CEDAR_BLUFF_FL_REFERENCE_RULESET, FLORIDA_STATUTE_URL, LAKEMONT_RULESET } from "../rules/defaults";
import { commitImport, stageImport } from "../imports/service";
import { approveAndSend, draftNotice, verifyContact } from "../communications/service";
import { requestVerificationCode, resolvePortalContext, saveStatement, verifyPortalCode } from "../portal/service";
import { signPortalSession } from "../portal/tokens";
import { ingestEvidence, submitEvidence } from "../evidence/pipeline";
import { checkFinalizationWithSystemOfRecord, recordManualFinalizationCheck } from "../cases/finalization";
import { assignCase, performReviewAction, recordSpecialistAssessment, reviewRequirement } from "../reviews/service";
import { recordDetermination, reopenCase, simulateSourceResponse } from "../disposition/service";
import { generateLegacyExport, LEGACY_HEADERS, newPermitBatch, NEW_BATCH_HEADERS, SCENARIOS, toCsv } from "./dataset";
import { invoicePdf, photoPng } from "./documents";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "premedfix-demo";
const DAY = 86_400_000;
// Business-hours-ish variation so seeded events do not all share one time of day.
const ago = (days: number) => new Date(Date.now() - days * DAY - ((Math.round(days * 97) % 420) + 30) * 60_000);
const at = <T,>(daysAgo: number, fn: () => Promise<T>) => withClock(ago(daysAgo), fn);

interface UserSpec {
  key: string;
  email: string;
  name: string;
  title: string;
  role: StaffRole;
  specialties?: string[];
}

export async function createOrganization(spec: {
  name: string;
  slug: string;
  jurisdictions: { code: string; name: string; state: string | null; departmentName: string; departmentPhone: string; departmentEmail: string; isReferenceExample?: boolean }[];
  users: UserSpec[];
}) {
  const [org] = await db()
    .insert(organizations)
    .values({ name: spec.name, slug: spec.slug, settings: { aiProcessingAuthorized: false, manualResearchMinutesPerCase: 45, evidenceRetentionDays: 2555 } })
    .returning();
  const js: Record<string, typeof jurisdictions.$inferSelect> = {};
  for (const j of spec.jurisdictions) {
    const [row] = await db()
      .insert(jurisdictions)
      .values({ orgId: org.id, ...j, isReferenceExample: j.isReferenceExample ?? false })
      .returning();
    js[j.code] = row;
  }
  const ctxs: Record<string, ActorContext> = {};
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const u of spec.users) {
    const [user] = await db().insert(users).values({ email: u.email, name: u.name, title: u.title, passwordHash }).returning();
    await db().insert(memberships).values({ orgId: org.id, userId: user.id, role: u.role, specialties: u.specialties ?? [] });
    ctxs[u.key] = { orgId: org.id, actor: { type: "user", userId: user.id, role: u.role, name: u.name, title: u.title, specialties: u.specialties ?? [] } };
  }
  return { org, jurisdictions: js, ctx: ctxs };
}

export const LAKEMONT_USERS: UserSpec[] = [
  { key: "admin", email: "admin@lakemont.example", name: "Avery Chen", title: "Permit Systems Administrator", role: "admin" },
  { key: "clerk", email: "clerk@lakemont.example", name: "Jordan Patel", title: "Senior Permit Clerk", role: "clerk" },
  { key: "inspector", email: "inspector@lakemont.example", name: "Sam Rivera", title: "Building Inspector (Electrical)", role: "inspector", specialties: ["electrical", "building"] },
  { key: "inspector2", email: "inspector2@lakemont.example", name: "Casey Nguyen", title: "Building Inspector (Structural & Gas)", role: "inspector", specialties: ["structural", "gas", "building"] },
  { key: "official", email: "official@lakemont.example", name: "Morgan Ellis", title: "Building Official", role: "official" },
  { key: "manager", email: "manager@lakemont.example", name: "Riley Brooks", title: "Department Manager", role: "manager" },
];

export async function createLakemont() {
  const o = await createOrganization({
    name: "Lakemont Regional Building Department",
    slug: "lakemont",
    jurisdictions: [
      { code: "LKM", name: "City of Lakemont", state: null, departmentName: "City of Lakemont Building Division", departmentPhone: "(555) 010-4400", departmentEmail: "permits@lakemont.example" },
      {
        code: "CDB",
        name: "Town of Cedar Bluff (FL reference)",
        state: "FL",
        departmentName: "Cedar Bluff Building Services",
        departmentPhone: "(555) 010-8800",
        departmentEmail: "building@cedarbluff.example",
        isReferenceExample: true,
      },
    ],
    users: LAKEMONT_USERS,
  });
  const admin = o.ctx.admin;
  const lkm = await createRuleSetVersion(admin, {
    jurisdictionId: o.jurisdictions.LKM.id,
    name: "Lakemont Residential Permit Resolution Policy",
    config: LAKEMONT_RULESET,
    effectiveDate: "2026-01-01",
    sourceCitation: "City of Lakemont Building Division Administrative Policy BD-2026-03 (fictional, for demonstration)",
    changeSummary: "Initial policy: evidence review for standard residential categories; specialist assessment and site inspection for electrical, gas, structural, and additions.",
  });
  await verifyRuleSet(admin, lkm.id, { reviewedByName: "Avery Chen (demo attestation)", note: "Configuration reviewed against the (fictional) administrative policy BD-2026-03." });
  await activateRuleSet(admin, lkm.id);
  const cdb = await createRuleSetVersion(admin, {
    jurisdictionId: o.jurisdictions.CDB.id,
    name: "Florida reference: § 553.79(16) permit-closure provisions",
    config: CEDAR_BLUFF_FL_REFERENCE_RULESET,
    effectiveDate: "2025-07-01",
    sourceCitation: "Fla. Stat. § 553.79(16)(b)-(c) (2025) — reference only; not adopted or reviewed by any local enforcement agency",
    sourceUrl: FLORIDA_STATUTE_URL,
    changeSummary: "Reference configuration illustrating Florida's expired-permit closure provisions. Left UNVERIFIED so every routing requires human review.",
  });
  await activateRuleSet(admin, cdb.id);
  return o;
}

export async function createHarbor() {
  const o = await createOrganization({
    name: "Harbor County Permitting",
    slug: "harbor",
    jurisdictions: [{ code: "HBR", name: "Harbor County (unincorporated)", state: null, departmentName: "Harbor County Permitting", departmentPhone: "(555) 010-6600", departmentEmail: "permits@harbor.example" }],
    users: [
      { key: "admin", email: "admin@harbor.example", name: "Quinn Harper", title: "Permitting Administrator", role: "admin" },
      { key: "inspector", email: "inspector@harbor.example", name: "Jesse Ward", title: "Building Inspector", role: "inspector", specialties: ["building"] },
    ],
  });
  const rs = await createRuleSetVersion(o.ctx.admin, {
    jurisdictionId: o.jurisdictions.HBR.id,
    name: "Harbor County Residential Policy",
    config: LAKEMONT_RULESET,
    effectiveDate: "2026-01-01",
    sourceCitation: "Harbor County Permitting Procedure HP-12 (fictional)",
    changeSummary: "Initial policy",
  });
  await verifyRuleSet(o.ctx.admin, rs.id, { reviewedByName: "Quinn Harper (demo attestation)", note: "Reviewed against HP-12 (fictional)." });
  await activateRuleSet(o.ctx.admin, rs.id);
  return o;
}

export async function importCsv(ctx: ActorContext, filename: string, csv: string, opts: { jurisdictionId: string | null; sourceSystem?: string }) {
  const batch = await stageImport(ctx, { filename, bytes: new TextEncoder().encode(csv), sourceSystem: opts.sourceSystem ?? null });
  return commitImport(ctx, batch.id, { mapping: batch.columnMapping ?? {}, jurisdictionId: opts.jurisdictionId });
}

// ---------------------------------------------------------------------------
// Workflow helpers used by the seed and by integration tests
// ---------------------------------------------------------------------------

export async function caseByPermit(orgId: string, permitNumber: string) {
  const [row] = await db()
    .select({ c: cases, permit: permits })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .where(and(eq(cases.orgId, orgId), eq(permits.permitNumber, permitNumber)));
  if (!row) throw new Error(`No case for permit ${permitNumber}`);
  return row;
}

export async function ownerContact(caseId: string) {
  const [c] = await db().select({ propertyId: permits.propertyId }).from(cases).innerJoin(permits, eq(permits.id, cases.permitId)).where(eq(cases.id, caseId));
  const [contact] = await db().select().from(contacts).where(eq(contacts.propertyId, c.propertyId!)).limit(1);
  return contact ?? null;
}

/** Latest delivered portal link for a communication, read from the simulated mailbox. */
export async function portalTokenFromMailbox(communicationId: string) {
  const [m] = await db().select().from(simulatedMailbox).where(eq(simulatedMailbox.communicationId, communicationId)).orderBy(desc(simulatedMailbox.deliveredAt)).limit(1);
  const token = m?.body.match(/\/portal\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!token) throw new Error("No portal link in mailbox");
  return token;
}

export async function latestCodeFromMailbox(caseId: string) {
  const [comm] = await db()
    .select({ id: communications.id })
    .from(communications)
    .where(and(eq(communications.caseId, caseId), eq(communications.purpose, "verification_code")))
    .orderBy(desc(communications.createdAt))
    .limit(1);
  const [m] = await db().select().from(simulatedMailbox).where(eq(simulatedMailbox.communicationId, comm.id));
  return m.body.match(/\b(\d{6})\b/)![1];
}

export async function noticeOwner(caseId: string, clerk: ActorContext, approver: ActorContext) {
  const contact = await ownerContact(caseId);
  if (!contact) throw new Error("No contact");
  if (contact.verificationStatus !== "owner_of_record_verified") {
    await verifyContact(clerk, caseId, contact.id, { note: "Matched owner name and mailing address to the county property appraiser record." });
  }
  const channel = contact.email ? "email" : contact.phone ? "sms" : "letter";
  const draft = await draftNotice(clerk, caseId, { contactId: contact.id, channel });
  await approveAndSend(approver, draft.id);
  return { contact, communicationId: draft.id };
}

export async function homeownerSession(token: string, caseId: string, name: string) {
  await requestVerificationCode(token);
  const code = await latestCodeFromMailbox(caseId);
  const grant = await verifyPortalCode(token, { code, relationship: "owner", name });
  const ctx = await resolvePortalContext(signPortalSession(grant.id));
  if (!ctx) throw new Error("Portal session failed");
  return ctx;
}

export async function standardSubmission(
  hctx: ActorContext,
  caseId: string,
  spec: { category: string; permitNumber: string; address: string; owner: string; contractor: string | null; license: string | null; issuedAt: string; completion: string; claimed?: string; seed?: number },
) {
  const files: { filename: string; bytes: Uint8Array; declaredType: string }[] = [];
  const kind = spec.category === "fence" ? "fence" : spec.category === "window" ? "window" : spec.category === "water_heater" ? "unit" : "roof";
  if (spec.contractor) {
    files.push({
      filename: "contractor-invoice.pdf",
      declaredType: "invoice",
      bytes: await invoicePdf({
        contractor: spec.contractor,
        license: spec.license,
        invoiceNumber: `INV-${10000 + (spec.seed ?? 1) * 37}`,
        invoiceDate: spec.completion,
        completionDate: spec.completion,
        permitNumber: spec.permitNumber,
        jobSite: spec.address,
        ownerName: spec.owner,
        lines: [[`Permitted work: ${spec.category.replace("_", " ")}`, 4200 + (spec.seed ?? 1) * 113]],
      }),
    });
  }
  files.push({ filename: "photo-1.png", declaredType: "photo", bytes: photoPng(kind, spec.seed ?? 1) });
  files.push({ filename: "photo-2.png", declaredType: "photo", bytes: photoPng(kind, (spec.seed ?? 1) + 7) });
  await saveStatement(hctx, {
    workDescription: `The ${spec.category.replace("_", " ")} work described on the permit was completed${spec.contractor ? ` by ${spec.contractor}` : " by the owner"}.`,
    completionDate: spec.claimed ?? spec.completion,
    contractorName: spec.contractor,
    contractorLicense: spec.license,
    notes: null,
  });
  await ingestEvidence(hctx, caseId, files);
  await submitEvidence(hctx, caseId);
}

export async function acceptProvided(reviewer: ActorContext, caseId: string) {
  const reqs = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, caseId));
  for (const r of reqs) {
    if (r.status === "provided") await reviewRequirement(reviewer, r.id, { decision: "accept", note: "Document reviewed and consistent with the permit record." });
    else if (r.required && r.status === "missing") await reviewRequirement(reviewer, r.id, { decision: "waive", note: "Not available; reviewer determined other evidence is sufficient for this item." });
  }
}

async function permitInfo(caseId: string) {
  const [row] = await db().select({ permit: permits }).from(cases).innerJoin(permits, eq(permits.id, cases.permitId)).where(eq(cases.id, caseId));
  return row.permit;
}

// ---------------------------------------------------------------------------
// Full demo seed
// ---------------------------------------------------------------------------

export async function seedDemo(opts: { log?: (m: string) => void; writeDemoFiles?: boolean } = {}) {
  const log = opts.log ?? (() => {});
  const T0 = 210; // initial import ~7 months ago

  log("Creating organizations, users, and rule sets…");
  const L = await at(T0 + 5, () => createLakemont());
  const H = await at(T0 + 5, () => createHarbor());
  const { admin, clerk, inspector, inspector2, official, manager } = L.ctx;

  log("Generating synthetic export and importing through the pipeline…");
  const rows = generateLegacyExport();
  const exportCsv = toCsv(rows, LEGACY_HEADERS);
  const batchCsv = toCsv(newPermitBatch(), NEW_BATCH_HEADERS);
  if (opts.writeDemoFiles) {
    const dir = path.join(process.cwd(), "demo", "data");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lakemont_legacy_export_2026-03.csv"), exportCsv);
    fs.writeFileSync(path.join(dir, "lakemont_new_permits_batch.csv"), batchCsv);
  }
  const imported = await at(T0, () => importCsv(clerk, "lakemont_legacy_export_2026-03.csv", exportCsv, { jurisdictionId: L.jurisdictions.LKM.id }));
  log(`  Lakemont: ${imported.batch.createdCount} created, ${imported.batch.errorCount} rejected rows, ${imported.batch.duplicateFlagCount} possible duplicates`);

  const harborCsv = toCsv(
    [
      { "Permit Number": "HBR-2017-0042", Address: "12 Dune Rd", Type: "Roofing", "Scope of Work": "Re-roof", "Issue Date": "2017-04-01", "Expiration Date": "2017-09-28", Status: "Expired", Owner: "Pat Lowell", "Owner Email": "pat.lowell@example.com" },
      { "Permit Number": "HBR-2018-0107", Address: "480 Marsh Ln", Type: "Fence", "Scope of Work": "Install fence", "Issue Date": "2018-02-11", "Expiration Date": "2018-08-10", Status: "Expired", Owner: "Robin Ash", "Owner Email": "robin.ash@example.com" },
      { "Permit Number": "HBR-2016-0300", Address: "9 Tidewater Ct", Type: "ELEC SVC CHANGE", "Scope of Work": "200A service upgrade", "Issue Date": "2016-06-20", "Expiration Date": "2016-12-17", Status: "Expired", Owner: "", "Owner Email": "" },
    ],
    NEW_BATCH_HEADERS,
  );
  await at(T0, () => importCsv(H.ctx.admin, "harbor_export.csv", harborCsv, { jurisdictionId: H.jurisdictions.HBR.id }));

  log("Advancing cases through the workflow (backdated, via real services)…");
  // Candidate pool: standard-category, contactable-after-verification, evidence-collection cases.
  const pool = await db()
    .select({ c: cases, permit: permits })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .where(and(eq(cases.orgId, L.org.id), eq(cases.status, "TRIAGED"), eq(cases.classification, "EVIDENCE_COLLECTION"), eq(permits.jurisdictionId, L.jurisdictions.LKM.id)))
    .orderBy(permits.permitNumber);
  const reserved = new Set(Object.values(SCENARIOS).flat());
  const candidates: typeof pool = [];
  for (const p of pool) {
    if (reserved.has(p.permit.permitNumber)) continue;
    const contact = await ownerContact(p.c.id);
    if (contact && (contact.email || contact.phone)) candidates.push(p);
  }
  let i = 0;
  const next = () => candidates[i++];

  // F — fully resolved cases spread over the past six months.
  const closedPlan = [170, 150, 132, 118, 101, 88, 74, 61, 47, 33, 21, 12];
  for (const [k, startAgo] of closedPlan.entries()) {
    const target = next();
    if (!target) break;
    const caseId = target.c.id;
    const { contact, communicationId } = await at(startAgo, () => noticeOwner(caseId, clerk, k % 3 === 0 ? manager : admin));
    const token = await portalTokenFromMailbox(communicationId);
    const hctx = await at(startAgo - 4, () => homeownerSession(token, caseId, contact.name ?? "Owner"));
    const p = await permitInfo(caseId);
    const completion = new Date(Date.parse(`${p.issuedAt}T00:00:00Z`) + 40 * DAY).toISOString().slice(0, 10);
    await at(startAgo - 5, () =>
      standardSubmission(hctx, caseId, { category: p.category!, permitNumber: p.permitNumber, address: "", owner: contact.name ?? "Owner", contractor: p.contractorName, license: p.contractorLicense, issuedAt: p.issuedAt!, completion, seed: k + 2 }),
    );
    const reviewer = k % 2 ? inspector : inspector2;
    await at(startAgo - 7, () => assignCase(reviewer, caseId, { userId: (reviewer.actor as { userId: string }).userId, kind: "primary" }));
    await at(startAgo - 7, () => performReviewAction(reviewer, caseId, { action: "begin_review" }));
    if (k % 4 === 1) {
      await at(startAgo - 8, () => performReviewAction(reviewer, caseId, { action: "request_information", message: "Please upload one more photograph showing the completed work from the street side." }));
      await at(startAgo - 12, async () => {
        await ingestEvidence(hctx, caseId, [{ filename: "street-view.png", declaredType: "photo", bytes: photoPng("roof", k + 40) }]);
        await submitEvidence(hctx, caseId);
      });
      await at(startAgo - 13, () => performReviewAction(reviewer, caseId, { action: "begin_review" }));
    }
    await at(startAgo - 14, () => acceptProvided(reviewer, caseId));
    await at(startAgo - 14, () => performReviewAction(reviewer, caseId, { action: "mark_ready" }));
    const determination = k === 5 || k === 9 ? "require_new_permit" : "close_requirements_satisfied";
    const res = await at(startAgo - 16, () =>
      recordDetermination(official, caseId, {
        determination,
        reason:
          determination === "require_new_permit"
            ? "Submitted documentation describes work materially different from the permitted scope; a new permit is required."
            : "Contractor invoice, photographs, and owner statement are consistent with the permitted scope; requirements determined satisfied.",
        attested: true,
      }),
    );
    if ("submission" in res && res.submission) await at(startAgo - 17, () => simulateSourceResponse(admin, res.submission.id, "confirmed"));
    if (k === 3) {
      await at(startAgo - 30, () => reopenCase(official, caseId, "Owner reported the roof was replaced again by an unpermitted contractor; reopening to review."));
      await at(startAgo - 31, () => acceptProvided(reviewer, caseId));
      await at(startAgo - 31, () => performReviewAction(reviewer, caseId, { action: "mark_ready" }));
      const r2 = await at(startAgo - 32, () => recordDetermination(official, caseId, { determination: "close_requirements_satisfied", reason: "Follow-up review found the original permitted work complete; the later report concerned a different structure.", attested: true }));
      if ("submission" in r2 && r2.submission) await at(startAgo - 33, () => simulateSourceResponse(admin, r2.submission.id, "confirmed"));
    }
  }

  // Owner contacted, no response yet (some overdue for follow-up).
  for (const daysAgo of [40, 31, 22, 9, 4]) {
    const t = next();
    if (t) await at(daysAgo, () => noticeOwner(t.c.id, clerk, admin));
  }
  // Owner verified on portal, evidence pending.
  for (const daysAgo of [16, 6]) {
    const t = next();
    if (!t) break;
    const { contact, communicationId } = await at(daysAgo, () => noticeOwner(t.c.id, clerk, admin));
    const token = await portalTokenFromMailbox(communicationId);
    await at(daysAgo - 2, () => homeownerSession(token, t.c.id, contact.name ?? "Owner"));
  }
  // Evidence received, awaiting review.
  for (const [k, daysAgo] of [18, 11, 5].entries()) {
    const t = next();
    if (!t) break;
    const { contact, communicationId } = await at(daysAgo, () => noticeOwner(t.c.id, clerk, admin));
    const token = await portalTokenFromMailbox(communicationId);
    const hctx = await at(daysAgo - 1, () => homeownerSession(token, t.c.id, contact.name ?? "Owner"));
    const p = t.permit;
    const completion = new Date(Date.parse(`${p.issuedAt}T00:00:00Z`) + 30 * DAY).toISOString().slice(0, 10);
    await at(daysAgo - 2, () =>
      standardSubmission(hctx, t.c.id, { category: p.category!, permitNumber: p.permitNumber, address: "", owner: contact.name ?? "Owner", contractor: p.contractorName, license: p.contractorLicense, issuedAt: p.issuedAt!, completion, seed: 60 + k }),
    );
    if (k === 0) await at(daysAgo - 3, () => performReviewAction(inspector2, t.c.id, { action: "begin_review" }));
  }
  // Drafts awaiting approval.
  for (const daysAgo of [2, 1]) {
    const t = next();
    if (!t) break;
    const contact = await ownerContact(t.c.id);
    await at(daysAgo, async () => {
      await verifyContact(clerk, t.c.id, contact!.id, { note: "Matched to county property appraiser owner of record." });
      await draftNotice(clerk, t.c.id, { contactId: contact!.id, channel: contact!.email ? "email" : "sms" });
    });
  }

  // E — evidence conflict: applicant statement contradicts the invoice.
  {
    const { c, permit } = await caseByPermit(L.org.id, SCENARIOS.conflict);
    const { contact, communicationId } = await at(15, () => noticeOwner(c.id, clerk, admin));
    const token = await portalTokenFromMailbox(communicationId);
    const hctx = await at(13, () => homeownerSession(token, c.id, contact.name ?? "Owner"));
    await at(12, () =>
      standardSubmission(hctx, c.id, {
        category: "roof",
        permitNumber: permit.permitNumber,
        address: "56 Juniper Pl",
        owner: "Marcus Bell",
        contractor: permit.contractorName,
        license: permit.contractorLicense,
        issuedAt: permit.issuedAt!,
        completion: "03/15/2020",
        claimed: "2019-06-01",
        seed: 91,
      }),
    );
    await at(11, () => assignCase(inspector, c.id, { userId: (inspector.actor as { userId: string }).userId, kind: "primary" }));
  }

  // B — electrical service: specialist assigned; a second electrical case awaiting inspection.
  {
    const { c } = await caseByPermit(L.org.id, SCENARIOS.electrical);
    await at(20, () => assignCase(clerk, c.id, { userId: (inspector.actor as { userId: string }).userId, kind: "specialist" }));
    const { c: c2 } = await caseByPermit(L.org.id, SCENARIOS.electricalInspection);
    await at(26, () => assignCase(clerk, c2.id, { userId: (inspector.actor as { userId: string }).userId, kind: "specialist" }));
    await at(25, () => performReviewAction(inspector, c2.id, { action: "begin_review" }));
    await at(25, () =>
      recordSpecialistAssessment(inspector, c2.id, {
        summary: "Panel replacement by a licensed electrical contractor per permit record. Concealed conductors and bonding cannot be assessed from documents; a site inspection is required.",
        recommendation: "Schedule site inspection of the service equipment and grounding electrode system.",
      }),
    );
    await at(24, () => performReviewAction(inspector, c2.id, { action: "require_inspection", reason: "Electrical service work requires a passed site inspection under the active rule set." }));
  }

  // F (live) — one case ready for disposition, one awaiting source-of-record confirmation.
  for (const [permitNumber, stopAt] of [
    [SCENARIOS.readyForDisposition, "ready"],
    [SCENARIOS.pendingConfirmation, "pending"],
  ] as const) {
    const { c, permit } = await caseByPermit(L.org.id, permitNumber);
    const { contact, communicationId } = await at(30, () => noticeOwner(c.id, clerk, admin));
    const token = await portalTokenFromMailbox(communicationId);
    const hctx = await at(28, () => homeownerSession(token, c.id, contact.name ?? "Owner"));
    const completion = new Date(Date.parse(`${permit.issuedAt}T00:00:00Z`) + 35 * DAY).toISOString().slice(0, 10);
    await at(27, () =>
      standardSubmission(hctx, c.id, { category: permit.category!, permitNumber: permit.permitNumber, address: "", owner: contact.name ?? "Owner", contractor: permit.contractorName, license: permit.contractorLicense, issuedAt: permit.issuedAt!, completion, seed: 120 }),
    );
    await at(20, () => assignCase(inspector2, c.id, { userId: (inspector2.actor as { userId: string }).userId, kind: "primary" }));
    await at(20, () => performReviewAction(inspector2, c.id, { action: "begin_review" }));
    await at(19, () => acceptProvided(inspector2, c.id));
    await at(19, () => performReviewAction(inspector2, c.id, { action: "mark_ready" }));
    if (stopAt === "pending") {
      await at(3, () =>
        recordDetermination(official, c.id, {
          determination: "close_requirements_satisfied",
          reason: "Photographs and owner statement document the completed fence consistent with the permitted scope; requirements determined satisfied.",
          attested: true,
        }),
      );
    }
  }

  // Reported finals: some already verified against the permit system, the rest pending.
  log("Verifying a few reported finals against the (simulated) permit system…");
  for (const [permit, daysAgo] of [["LKM-BLD-2019-01503", 64], ["LKM-BLD-2021-02066", 27]] as const) {
    const { c } = await caseByPermit(L.org.id, permit);
    await at(daysAgo, () => checkFinalizationWithSystemOfRecord(clerk, c.id));
  }
  {
    const { c } = await caseByPermit(L.org.id, "LKM-PLM-2024-01968");
    await at(12, () =>
      recordManualFinalizationCheck(admin, c.id, {
        outcome: "confirmed",
        sourceReference: "ACC-PMT-2024-01968",
        sourceFinalAt: "2024-03-22",
        note: "Accela inspection history shows the final plumbing inspection passed on 2024-03-22; permit status Finaled.",
      }),
    );
  }

  // A few cases assigned to the clerk for intake work.
  const intake = await db()
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.orgId, L.org.id), inArray(cases.status, ["NEEDS_DATA_RECONCILIATION", "FINALIZATION_VERIFICATION"])));
  for (const c of intake) await at(2, () => assignCase(clerk, c.id, { userId: (clerk.actor as { userId: string }).userId, kind: "primary" }));

  log("Seed complete.");
  return { lakemont: L, harbor: H, exportCsv, batchCsv };
}
