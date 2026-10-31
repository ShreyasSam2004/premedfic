"use server";

/**
 * Server actions for the staff application. Each action authenticates from
 * the session cookie, validates its input, and delegates to a domain service.
 * Authorization and workflow rules are enforced in the services, not here.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CANONICAL_FIELDS } from "@/domain/permits";
import { initDatabase, db } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getStaffSession, SESSION_COOKIE } from "@/server/auth/session";
import { revokeSession } from "@/server/auth/service";
import { requirePermission, type ActorContext } from "@/server/auth/context";
import { recordAudit } from "@/server/audit/audit";
import { DomainError, ForbiddenError, ValidationError } from "@/server/errors";
import { log } from "@/server/util";
import { triageCases } from "@/server/triage/service";
import { addContact, approveAndSend, cancelDraft, draftNotice, logManualOutreach, setContactOptOut, verifyContact } from "@/server/communications/service";
import { assignCase, bulkAssign, performReviewAction, recordInspection, recordSpecialistAssessment, resolveFinding, reviewEvidenceItem, reviewRequirement, REVIEW_ACTIONS, type ReviewAction } from "@/server/reviews/service";
import { recordDetermination, recordManualConfirmation, reopenCase, simulateSourceResponse } from "@/server/disposition/service";
import { confirmDuplicate, correctPermitField, dismissDuplicate } from "@/server/cases/reconciliation";
import { checkFinalizationWithSystemOfRecord, recordManualFinalizationCheck, routeToFinalizationVerification } from "@/server/cases/finalization";
import { submitEvidence } from "@/server/evidence/pipeline";
import { commitImport, previewImport } from "@/server/imports/service";
import { createDraftFromVersion, createRuleSetVersion, updateRuleSetDraft, verifyRuleSet } from "@/server/rules/service";
import { activateAndApply } from "@/server/rules/impact-service";
import { retryJob } from "@/server/jobs/queue";
import type { ActionState } from "./action-state";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const optInt = (fd: FormData, k: string) => {
  const v = Number(str(fd, k));
  return Number.isFinite(v) && str(fd, k) !== "" ? v : null;
};

async function run(fn: (ctx: ActorContext) => Promise<string | void>, success: string): Promise<ActionState> {
  const s = await getStaffSession();
  if (!s) redirect("/login");
  try {
    const msg = await fn(s.ctx);
    revalidatePath("/", "layout");
    return { ok: true, message: msg || success, at: Date.now() };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, message: err.message, details: err.details, at: Date.now() };
    if (err instanceof z.ZodError) return { ok: false, message: "Invalid input", details: err.issues.map((i) => i.message), at: Date.now() };
    log.error("action.failed", err);
    return { ok: false, message: "Something went wrong. The action was not completed.", at: Date.now() };
  }
}

export async function logoutAction() {
  await initDatabase();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Cases: assignment, triage, contacts
// ---------------------------------------------------------------------------

export async function bulkCaseAction(_: ActionState, fd: FormData) {
  const ids = fd.getAll("caseId").map(String).filter(Boolean);
  const op = str(fd, "op");
  return run(async (ctx) => {
    if (ids.length === 0) throw new ValidationError("Select at least one case");
    if (op === "triage") {
      requirePermission(ctx, "cases:triage");
      if (ids.length > 200) throw new ValidationError("Re-run triage on at most 200 cases at a time");
      await triageCases(ctx, ids);
      return `Triage re-run for ${ids.length} case(s) under the active rule sets`;
    }
    if (op === "assign") {
      const userId = str(fd, "assignee");
      if (!userId) throw new ValidationError("Choose a staff member to assign");
      const n = await bulkAssign(ctx, ids, userId);
      return `Assigned ${n} case(s)`;
    }
    throw new ValidationError("Unsupported bulk action. Approvals and closures cannot be performed in bulk.");
  }, "Done");
}

export async function assignAction(_: ActionState, fd: FormData) {
  return run((ctx) => assignCase(ctx, str(fd, "caseId"), { userId: str(fd, "userId"), kind: str(fd, "kind") === "specialist" ? "specialist" : "primary" }), "Assignment updated");
}

export async function retriageAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    requirePermission(ctx, "cases:triage");
    await triageCases(ctx, [str(fd, "caseId")]);
  }, "Triage re-run under the active rule set");
}

export async function addContactAction(_: ActionState, fd: FormData) {
  return run(
    (ctx) =>
      addContact(ctx, str(fd, "caseId"), {
        name: str(fd, "name"),
        email: str(fd, "email") || null,
        phone: str(fd, "phone") || null,
        role: str(fd, "role") === "representative" ? "representative" : "owner",
      }).then(() => undefined),
    "Contact added. Verify it against property records before any outreach.",
  );
}

export async function verifyContactAction(_: ActionState, fd: FormData) {
  return run((ctx) => verifyContact(ctx, str(fd, "caseId"), str(fd, "contactId"), { note: str(fd, "note") }), "Contact verified as owner of record");
}

export async function optOutAction(_: ActionState, fd: FormData) {
  return run((ctx) => setContactOptOut(ctx, str(fd, "contactId"), { email: fd.get("optOutEmail") === "on", sms: fd.get("optOutSms") === "on" }).then(() => undefined), "Preferences saved");
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export async function draftNoticeAction(_: ActionState, fd: FormData) {
  const channel = z.enum(["email", "sms", "letter"]).parse(str(fd, "channel"));
  return run((ctx) => draftNotice(ctx, str(fd, "caseId"), { contactId: str(fd, "contactId"), channel }).then(() => undefined), "Notice drafted and submitted for approval");
}

export async function approveNoticeAction(_: ActionState, fd: FormData) {
  return run((ctx) => approveAndSend(ctx, str(fd, "communicationId")).then(() => undefined), "Approved and delivered via the simulated adapter. No real message was sent.");
}

export async function cancelDraftAction(_: ActionState, fd: FormData) {
  return run((ctx) => cancelDraft(ctx, str(fd, "communicationId"), str(fd, "reason")).then(() => undefined), "Draft withdrawn");
}

export async function manualOutreachAction(_: ActionState, fd: FormData) {
  const channel = z.enum(["phone", "in_person", "letter"]).parse(str(fd, "channel"));
  return run((ctx) => logManualOutreach(ctx, str(fd, "caseId"), { channel, note: str(fd, "note") }).then(() => undefined), "Outreach attempt logged");
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function reviewAction(_: ActionState, fd: FormData) {
  const action = str(fd, "action") as ReviewAction;
  if (!(action in REVIEW_ACTIONS)) return { ok: false, message: "Unknown action", at: Date.now() };
  return run(
    (ctx) =>
      performReviewAction(ctx, str(fd, "caseId"), {
        action,
        reason: str(fd, "reason") || null,
        message: str(fd, "message") || null,
        suggestedAction: str(fd, "suggestedAction") || null,
        expectedVersion: optInt(fd, "version"),
        idempotencyKey: str(fd, "idempotencyKey") || null,
      }).then(() => undefined),
    `${REVIEW_ACTIONS[action].label}: recorded`,
  );
}

export async function requirementAction(_: ActionState, fd: FormData) {
  const decision = z.enum(["accept", "reject", "waive"]).parse(str(fd, "decision"));
  return run((ctx) => reviewRequirement(ctx, str(fd, "requirementId"), { decision, note: str(fd, "note") }), "Checklist item updated");
}

export async function evidenceItemAction(_: ActionState, fd: FormData) {
  const decision = z.enum(["accept", "reject"]).parse(str(fd, "decision"));
  return run((ctx) => reviewEvidenceItem(ctx, str(fd, "itemId"), { decision, note: str(fd, "note") }), `Document ${decision}ed`);
}

export async function resolveFindingAction(_: ActionState, fd: FormData) {
  return run((ctx) => resolveFinding(ctx, str(fd, "findingId"), { note: str(fd, "note") }).then(() => undefined), "Discrepancy resolved. Both source records remain on file.");
}

export async function inspectionAction(_: ActionState, fd: FormData) {
  const inspectionType = z.enum(["site_assessment", "final"]).parse(str(fd, "inspectionType"));
  const result = z.enum(["passed", "failed", "partial", "not_performed"]).parse(str(fd, "result"));
  return run((ctx) => recordInspection(ctx, str(fd, "caseId"), { inspectionType, result, inspectedOn: str(fd, "inspectedOn"), notes: str(fd, "notes") }).then(() => undefined), "Inspection recorded");
}

export async function specialistAction(_: ActionState, fd: FormData) {
  return run((ctx) => recordSpecialistAssessment(ctx, str(fd, "caseId"), { summary: str(fd, "summary"), recommendation: str(fd, "recommendation") }).then(() => undefined), "Specialist assessment recorded");
}

export async function staffSubmitEvidenceAction(_: ActionState, fd: FormData) {
  return run((ctx) => submitEvidence(ctx, str(fd, "caseId")).then(() => undefined), "Staff-uploaded documents submitted for review");
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export async function determinationAction(_: ActionState, fd: FormData) {
  return run(
    (ctx) =>
      recordDetermination(ctx, str(fd, "caseId"), {
        determination: str(fd, "determination"),
        reason: str(fd, "reason"),
        attested: fd.get("attest") === "on",
        expectedVersion: optInt(fd, "version"),
        idempotencyKey: str(fd, "idempotencyKey") || null,
      }).then(() => undefined),
    "Determination recorded and submitted to the system of record. The permit is not officially closed until confirmation is received.",
  );
}

export async function sourceResponseAction(_: ActionState, fd: FormData) {
  const outcome = str(fd, "outcome") === "rejected" ? "rejected" : "confirmed";
  return run((ctx) => simulateSourceResponse(ctx, str(fd, "submissionId"), outcome).then(() => undefined), outcome === "confirmed" ? "Source-of-record confirmation received" : "Source system rejected the update");
}

export async function manualConfirmAction(_: ActionState, fd: FormData) {
  return run((ctx) => recordManualConfirmation(ctx, str(fd, "submissionId"), { externalReference: str(fd, "externalReference"), note: str(fd, "note") }).then(() => undefined), "Manual confirmation recorded");
}

export async function reopenAction(_: ActionState, fd: FormData) {
  return run((ctx) => reopenCase(ctx, str(fd, "caseId"), str(fd, "reason")).then(() => undefined), "Case reopened for review");
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export async function duplicateAction(_: ActionState, fd: FormData) {
  const op = str(fd, "op");
  return run(
    (ctx) =>
      op === "confirm"
        ? confirmDuplicate(ctx, str(fd, "candidateId"), { primaryPermitId: str(fd, "primaryPermitId"), note: str(fd, "note") })
        : dismissDuplicate(ctx, str(fd, "candidateId"), { note: str(fd, "note") }),
    op === "confirm" ? "Duplicate confirmed and merged" : "Marked as distinct records",
  );
}

export async function correctFieldAction(_: ActionState, fd: FormData) {
  return run((ctx) => correctPermitField(ctx, str(fd, "caseId"), { field: str(fd, "field"), value: str(fd, "value"), sourceNote: str(fd, "sourceNote") }), "Field corrected and case re-triaged");
}

export async function checkFinalizationAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await checkFinalizationWithSystemOfRecord(ctx, str(fd, "caseId"));
    return r.outcome === "confirmed"
      ? `The permit system confirmed the final (reference ${r.sourceReference}). Recorded as already resolved; PremedFix did not close this permit.`
      : `The permit system does not show this permit finaled (reference ${r.sourceReference}). It is back in the unresolved backlog.`;
  }, "Checked with the permit system");
}

export async function recordFinalizationCheckAction(_: ActionState, fd: FormData) {
  const outcome = str(fd, "outcome") === "confirmed" ? "confirmed" : "not_confirmed";
  return run(async (ctx) => {
    await recordManualFinalizationCheck(ctx, str(fd, "caseId"), { outcome, sourceReference: str(fd, "sourceReference"), sourceFinalAt: str(fd, "sourceFinalAt") || null, note: str(fd, "note") });
    return outcome === "confirmed" ? "Final confirmed and recorded as already resolved" : "Recorded as not finaled; returned to the unresolved backlog";
  }, "Verification recorded");
}

export async function routeFinalizationAction(_: ActionState, fd: FormData) {
  return run((ctx) => routeToFinalizationVerification(ctx, str(fd, "caseId"), str(fd, "reason")).then(() => undefined), "Moved to finalization verification; outreach and evidence collection are paused");
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function mappingFrom(fd: FormData) {
  const mapping: Record<string, string | null> = {};
  for (const f of CANONICAL_FIELDS) mapping[f.key] = str(fd, `map:${f.key}`) || null;
  return mapping;
}

export type PreviewState =
  | null
  | { ok: false; message: string; details?: string[] }
  | {
      ok: true;
      summary: Awaited<ReturnType<typeof previewImport>>["summary"];
      rows: { rowNumber: number; outcome: string; permitNumber: string | null; errors: string[]; warnings: { field: string; message: string }[]; category: string | null; issuedAt: string | null; expiresAt: string | null; status: string; address: string | null }[];
    };

export async function previewImportAction(_: PreviewState, fd: FormData): Promise<PreviewState> {
  const s = await getStaffSession();
  if (!s) redirect("/login");
  try {
    const res = await previewImport(s.ctx, str(fd, "batchId"), { mapping: mappingFrom(fd), jurisdictionId: str(fd, "jurisdictionId") || null });
    const interesting = res.rows.filter((r) => r.outcome !== "create" || r.errors.length || r.warnings.length);
    const shown = [...interesting, ...res.rows.filter((r) => !interesting.includes(r))].slice(0, 150).sort((a, b) => a.rowNumber - b.rowNumber);
    return {
      ok: true,
      summary: res.summary,
      rows: shown.map((r) => ({
        rowNumber: r.rowNumber,
        outcome: r.outcome,
        permitNumber: r.record?.permitNumber ?? null,
        errors: r.errors,
        warnings: r.warnings.map((w) => ({ field: w.field, message: w.message })),
        category: r.record?.category ?? null,
        issuedAt: r.record?.issuedAt ?? null,
        expiresAt: r.record?.expiresAt ?? null,
        status: r.record?.sourceStatus ?? "",
        address: r.record?.address ?? null,
      })),
    };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, message: err.message, details: err.details };
    log.error("import.preview_failed", err);
    return { ok: false, message: "Preview failed" };
  }
}

export async function commitImportAction(_: ActionState, fd: FormData) {
  const batchId = str(fd, "batchId");
  const result = await run(async (ctx) => {
    const r = await commitImport(ctx, batchId, { mapping: mappingFrom(fd), jurisdictionId: str(fd, "jurisdictionId") || null });
    return r.alreadyCommitted ? "This batch was already imported; no changes were made." : `Imported: ${r.batch.createdCount} created, ${r.batch.updatedCount} updated, ${r.batch.unchangedCount} unchanged, ${r.batch.errorCount} rejected.`;
  }, "Import complete");
  if (result?.ok) redirect(`/permits/import/${batchId}`);
  return result;
}

// ---------------------------------------------------------------------------
// Rules and settings
// ---------------------------------------------------------------------------

export async function createRuleVersionAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    let config: unknown;
    try {
      config = JSON.parse(str(fd, "config"));
    } catch {
      throw new ValidationError("Configuration is not valid JSON");
    }
    const row = await createRuleSetVersion(ctx, {
      jurisdictionId: str(fd, "jurisdictionId"),
      name: str(fd, "name"),
      config,
      effectiveDate: str(fd, "effectiveDate"),
      sourceCitation: str(fd, "sourceCitation"),
      sourceUrl: str(fd, "sourceUrl") || null,
      changeSummary: str(fd, "changeSummary"),
    });
    return `Draft v${row.version} created. It does not affect any case until verified and activated.`;
  }, "Draft created");
}

export async function verifyRuleSetAction(_: ActionState, fd: FormData) {
  return run((ctx) => verifyRuleSet(ctx, str(fd, "ruleSetId"), { reviewedByName: str(fd, "reviewedByName"), note: str(fd, "note") }).then(() => undefined), "Source review attested");
}

export async function startRuleDraftAction(_: ActionState, fd: FormData) {
  let id: string | null = null;
  const result = await run(async (ctx) => {
    const row = await createDraftFromVersion(ctx, str(fd, "ruleSetId"), { changeSummary: str(fd, "changeSummary") });
    id = row.id;
    return `Draft v${row.version} created`;
  }, "Draft created");
  if (result?.ok && id) redirect(`/rules/${id}`);
  return result;
}

export async function updateRuleDraftAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    let config: unknown;
    try {
      config = JSON.parse(str(fd, "config"));
    } catch {
      throw new ValidationError("Configuration is not valid JSON");
    }
    const row = await updateRuleSetDraft(ctx, str(fd, "ruleSetId"), {
      name: str(fd, "name"),
      config,
      effectiveDate: str(fd, "effectiveDate"),
      sourceCitation: str(fd, "sourceCitation"),
      sourceUrl: str(fd, "sourceUrl") || null,
      changeSummary: str(fd, "changeSummary"),
    });
    return `Draft v${row.version} saved. The impact preview reflects it.`;
  }, "Draft saved");
}

export async function activateRuleSetAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    const r = await activateAndApply(ctx, str(fd, "ruleSetId"), { retriage: fd.get("retriage") === "on" });
    return r.retriaged
      ? `Rule set v${r.ruleSet.version} activated. Triage re-run on the ${r.retriaged} case(s) it changes; other cases keep their existing results.`
      : `Rule set v${r.ruleSet.version} activated. Existing triage results keep their original version.`;
  }, "Rule set activated");
}

export async function settingsAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    requirePermission(ctx, "settings:manage");
    const minutes = Number(str(fd, "minutes"));
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600) throw new ValidationError("Minutes must be a whole number between 0 and 600");
    const ai = fd.get("aiProcessingAuthorized") === "on";
    const [org] = await db().select().from(organizations).where(eq(organizations.id, ctx.orgId));
    await db()
      .update(organizations)
      .set({ settings: { ...org.settings, manualResearchMinutesPerCase: minutes, aiProcessingAuthorized: ai } })
      .where(eq(organizations.id, ctx.orgId));
    await recordAudit(ctx, {
      action: "settings.updated",
      entityType: "organization",
      entityId: ctx.orgId,
      summary: `Settings updated (estimate assumption ${minutes} min/case; third-party AI processing ${ai ? "AUTHORIZED" : "not authorized"})`,
      metadata: { before: org.settings, after: { manualResearchMinutesPerCase: minutes, aiProcessingAuthorized: ai } },
    });
  }, "Settings saved");
}

export async function retryJobAction(_: ActionState, fd: FormData) {
  return run(async (ctx) => {
    requirePermission(ctx, "settings:manage");
    const job = await retryJob(ctx.orgId, str(fd, "jobId"));
    if (!job) throw new ForbiddenError("Only failed jobs in your organization can be retried");
    return `Job ${job.status}`;
  }, "Job retried");
}
