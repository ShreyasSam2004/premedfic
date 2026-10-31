/**
 * Evidence processing pipeline.
 *
 *  1. validate type (magic bytes) and size     -> validate.ts
 *  2. store content-addressed                   -> storage
 *  3. SHA-256 content hash                      -> evidence_items.sha256
 *  4. extract text                              -> extract.ts
 *  5. classify document type                    -> provider
 *  6. extract relevant fields with quotes       -> provider (+ acceptance gate)
 *  7. compare against the required checklist    -> evaluateChecklist
 *  8. flag contradictions / missing information -> crossCheck
 *  9. persist traceable findings                -> evidence_findings
 * 10. the case detail / packet assemble the review packet
 *
 * Processing runs as an idempotent job keyed by evidence item id.
 */
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { MAX_FILES_PER_UPLOAD, PHOTO_LIMITATION } from "@/domain/evidence";
import { PORTAL_SUBMISSION_STATES } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import {
  communications,
  evidenceFindings,
  evidenceItems,
  evidenceRequirements,
  evidenceSubmissions,
  inspectionRecords,
  organizations,
  permits,
  portalGrants,
  properties,
  type SourceRef,
} from "../db/schema";
import { requirePermission, systemContext, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { now, sha256 } from "../util";
import { storage } from "../storage";
import { enqueueJob, registerJobHandler, runJob } from "../jobs/queue";
import { loadCaseForOrg, transitionCase } from "../workflow/service";
import { ensureOpenSubmission } from "../portal/service";
import { validateUpload } from "./validate";
import { extractText } from "./extract";
import { screenForInstructions, type ExtractedField } from "./analyze";
import { selectExtractionProvider } from "./providers";
import { crossCheck, evaluateChecklist } from "./crosscheck";

export interface IncomingFile {
  filename: string;
  bytes: Uint8Array;
  declaredType?: string | null;
}

export async function ingestEvidence(ctx: ActorContext, caseId: string, files: IncomingFile[]) {
  const c = await loadCaseForOrg(ctx.orgId, caseId);
  let submissionId: string;
  if (ctx.actor.type === "homeowner") {
    if (ctx.actor.caseId !== c.id) throw new NotFoundError("Case");
    if (!PORTAL_SUBMISSION_STATES.includes(c.status)) throw new ConflictError("This case is not currently accepting uploads");
    submissionId = (await ensureOpenSubmission(ctx)).id;
  } else if (ctx.actor.type === "user") {
    const user = requirePermission(ctx, "evidence:upload");
    const [open] = await db()
      .select()
      .from(evidenceSubmissions)
      .where(and(eq(evidenceSubmissions.caseId, c.id), eq(evidenceSubmissions.submittedByType, "staff"), eq(evidenceSubmissions.status, "open")));
    submissionId =
      open?.id ??
      (
        await db()
          .insert(evidenceSubmissions)
          .values({
            orgId: ctx.orgId,
            caseId: c.id,
            submittedByType: "staff",
            submittedById: user.userId,
            submitterName: user.name,
            relationship: "staff",
            status: "open",
            createdAt: now(),
          })
          .returning()
      )[0].id;
  } else {
    throw new ForbiddenError();
  }
  if (files.length === 0) throw new ValidationError("No files were provided");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new ValidationError(`Upload at most ${MAX_FILES_PER_UPLOAD} files at a time`);

  const uploaderId = ctx.actor.type === "homeowner" ? ctx.actor.grantId : ctx.actor.type === "user" ? ctx.actor.userId : "system";
  const accepted: (typeof evidenceItems.$inferSelect)[] = [];
  const rejected: { filename: string; errors: string[] }[] = [];
  for (const file of files) {
    const v = validateUpload(file);
    if (!v.ok || !v.mime) {
      rejected.push({ filename: v.filename, errors: v.errors });
      continue;
    }
    const hash = sha256(file.bytes);
    const [dup] = await db()
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(and(eq(evidenceItems.caseId, c.id), eq(evidenceItems.sha256, hash)));
    if (dup) {
      rejected.push({ filename: v.filename, errors: ["This exact file was already uploaded for this case"] });
      continue;
    }
    const storageKey = `evidence/${ctx.orgId}/${c.id}/${hash}`;
    await storage().put(storageKey, file.bytes);
    const item = await transaction(async () => {
      const [row] = await db()
        .insert(evidenceItems)
        .values({
          orgId: ctx.orgId,
          caseId: c.id,
          submissionId,
          uploadedByType: ctx.actor.type === "homeowner" ? "homeowner" : "staff",
          uploadedById: uploaderId,
          originalFilename: v.filename,
          mimeType: v.mime!,
          sizeBytes: file.bytes.byteLength,
          sha256: hash,
          storageKey,
          declaredType: file.declaredType ?? null,
          processingStatus: "received",
          createdAt: now(),
        })
        .returning();
      await recordAudit(ctx, {
        action: "evidence.received",
        entityType: "evidence_item",
        entityId: row.id,
        caseId: c.id,
        summary: `Evidence received: ${row.originalFilename} (${row.mimeType}, ${row.sizeBytes} bytes)`,
        metadata: { sha256: hash, declaredType: row.declaredType },
      });
      return row;
    });
    const job = await enqueueJob({ orgId: ctx.orgId, type: "evidence.process", payload: { evidenceItemId: item.id }, idempotencyKey: `evidence:${item.id}` });
    await runJob(job.id);
    const [fresh] = await db().select().from(evidenceItems).where(eq(evidenceItems.id, item.id));
    accepted.push(fresh);
  }
  return { accepted, rejected, submissionId };
}

async function processEvidenceJob(payload: Record<string, unknown>) {
  const itemId = String(payload.evidenceItemId);
  const [item] = await db().select().from(evidenceItems).where(eq(evidenceItems.id, itemId));
  if (!item) throw new Error("Evidence item not found");
  await db().update(evidenceItems).set({ processingStatus: "processing" }).where(eq(evidenceItems.id, item.id));
  try {
    const bytes = await storage().get(item.storageKey);
    if (sha256(bytes) !== item.sha256) throw new Error("Stored file failed integrity check (hash mismatch)");
    const text = await extractText(bytes, item.mimeType);
    const [org] = await db().select().from(organizations).where(eq(organizations.id, item.orgId));
    const { provider, note } = selectExtractionProvider(org.settings);
    const out = await provider.extract({ pages: text.pages, mime: item.mimeType, declaredType: item.declaredType });
    const injections = screenForInstructions(text.pages);
    const method = `${out.provider.id}/${out.provider.version}`;
    const provenance = out.provider.kind === "model" ? ("ai_extracted" as const) : ("extracted" as const);
    const at = now();

    await transaction(async () => {
      await db().delete(evidenceFindings).where(and(eq(evidenceFindings.evidenceItemId, item.id), eq(evidenceFindings.scope, "item")));
      const rows: (typeof evidenceFindings.$inferInsert)[] = [];
      const base = { orgId: item.orgId, caseId: item.caseId, evidenceItemId: item.id, scope: "item" as const, createdAt: at };
      for (const f of out.fields) {
        rows.push({
          ...base,
          kind: "fact",
          field: f.field,
          value: f.normalized ?? f.value,
          provenance,
          method,
          modelVersion: out.provider.model,
          confidence: "verbatim-quote",
          sourceRefs: [{ evidenceItemId: item.id, page: f.page, start: f.start, end: f.end, quote: f.quote }],
          message: `${f.field.replace(/_/g, " ")}: ${f.value}`,
        });
      }
      if (item.mimeType === "application/pdf" && text.pages.join("").trim().length < 20) {
        rows.push({
          ...base,
          kind: "unknown",
          field: "text",
          provenance: "unknown",
          method: text.method,
          message: "No extractable text (possibly a scanned image). OCR is not configured; a reviewer must read this document directly.",
          severity: "warning",
        });
      }
      if (item.mimeType.startsWith("image/")) {
        rows.push({ ...base, kind: "check", field: "photo", provenance: "verified_record", method: "mime-sniff", message: `Photograph present (${item.mimeType}). ${PHOTO_LIMITATION}` });
      }
      if (item.declaredType && out.classification.type !== "unknown" && item.declaredType !== out.classification.type) {
        rows.push({
          ...base,
          kind: "warning",
          field: "document_type",
          value: out.classification.type,
          provenance: "inference",
          method: out.classification.method,
          confidence: out.classification.confidence,
          message: `Uploaded as "${item.declaredType}" but content resembles "${out.classification.type}".`,
          severity: "info",
        });
      }
      if (out.classification.type === "unknown" && item.declaredType) {
        rows.push({
          ...base,
          kind: "warning",
          field: "document_type",
          value: item.declaredType,
          provenance: "applicant_claim",
          method: out.classification.method,
          message: `Classifier abstained; the checklist uses the uploader's declared type "${item.declaredType}" until a reviewer confirms it.`,
          severity: "info",
        });
      }
      for (const hit of injections) {
        rows.push({
          ...base,
          kind: "untrusted_instruction",
          field: "document_text",
          value: hit.quote,
          provenance: "extracted",
          method: "instruction-screen/1.0.0",
          sourceRefs: [{ evidenceItemId: item.id, page: hit.page, start: hit.start, end: hit.end, quote: hit.quote }],
          message: `Document contains instruction-like text ("${hit.quote}"). Treated strictly as untrusted content; it has no effect on processing or workflow.`,
          severity: "warning",
        });
      }
      for (const r of out.rejected) {
        rows.push({ ...base, kind: "warning", field: "extraction", provenance: "unknown", method, message: `Extraction output rejected: ${r.reason}`, severity: "info" });
      }
      if (note) rows.push({ ...base, kind: "warning", field: "provider", provenance: "inference", method, message: note, severity: "info" });
      if (rows.length) await db().insert(evidenceFindings).values(rows);
      await db()
        .update(evidenceItems)
        .set({
          classifiedType: out.classification.type,
          classificationMethod: out.classification.method,
          classificationConfidence: out.classification.confidence,
          classificationSignals: out.classification.signals,
          pageCount: text.pageCount,
          extractedText: text.pages.length ? text.pages.join("\n\f\n").slice(0, 200_000) : null,
          textExtractionMethod: text.method,
          processingStatus: "processed",
          processingError: null,
          processedAt: at,
        })
        .where(eq(evidenceItems.id, item.id));
      await refreshCaseEvidence(item.orgId, item.caseId);
      await recordAudit(systemContext(item.orgId, "evidence-processor"), {
        action: "evidence.processed",
        entityType: "evidence_item",
        entityId: item.id,
        caseId: item.caseId,
        summary: `Processed ${item.originalFilename}: classified ${out.classification.type} (${out.classification.confidence}), ${out.fields.length} field(s) extracted${injections.length ? `, ${injections.length} untrusted-instruction flag(s)` : ""}`,
        metadata: { provider: method, classification: out.classification.type, fields: out.fields.length, injections: injections.length },
      });
    });
    return { classifiedType: out.classification.type, fields: out.fields.length };
  } catch (err) {
    await db()
      .update(evidenceItems)
      .set({ processingStatus: "failed", processingError: err instanceof Error ? err.message.slice(0, 300) : "Processing failed" })
      .where(eq(evidenceItems.id, item.id));
    throw err;
  }
}

registerJobHandler("evidence.process", processEvidenceJob);

/** Effective type used for checklist matching. */
function effectiveType(i: typeof evidenceItems.$inferSelect) {
  return i.classifiedType && i.classifiedType !== "unknown" ? i.classifiedType : (i.declaredType ?? "unknown");
}

/** Recompute case-level cross-check findings and the evidence checklist. Idempotent. */
export async function refreshCaseEvidence(orgId: string, caseId: string) {
  return transaction(async () => {
    const c = await loadCaseForOrg(orgId, caseId);
    const [permit] = await db().select().from(permits).where(eq(permits.id, c.permitId));
    const [prop] = permit.propertyId ? await db().select().from(properties).where(eq(properties.id, permit.propertyId)) : [];
    const inspections = await db().select().from(inspectionRecords).where(eq(inspectionRecords.permitId, permit.id));
    const items = await db()
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.caseId, caseId), eq(evidenceItems.processingStatus, "processed")));
    const facts = items.length
      ? await db()
          .select()
          .from(evidenceFindings)
          .where(and(inArray(evidenceFindings.evidenceItemId, items.map((i) => i.id)), eq(evidenceFindings.scope, "item"), eq(evidenceFindings.kind, "fact")))
      : [];
    const [submission] = await db()
      .select()
      .from(evidenceSubmissions)
      // Claims come from the latest submission that carries an applicant statement.
      .where(and(eq(evidenceSubmissions.caseId, caseId), ne(evidenceSubmissions.submittedByType, "staff"), isNotNull(evidenceSubmissions.workDescription)))
      .orderBy(desc(evidenceSubmissions.createdAt))
      .limit(1);

    const findings = crossCheck({
      permit: { id: permit.id, permitNumber: permit.permitNumber, issuedAt: permit.issuedAt, contractorName: permit.contractorName, contractorLicense: permit.contractorLicense },
      propertyAddress: prop?.addressLine ?? null,
      passedFinalOnRecord: inspections.some((i) => i.inspectionType === "final" && i.result === "passed"),
      claims: submission
        ? { submissionId: submission.id, completionDate: submission.completionDateClaimed, contractorName: submission.contractorNameClaimed, contractorLicense: submission.contractorLicenseClaimed }
        : null,
      items: items.map((i) => ({
        id: i.id,
        filename: i.originalFilename,
        type: effectiveType(i),
        fields: facts
          .filter((f) => f.evidenceItemId === i.id)
          .map(
            (f): ExtractedField => {
              const r = (f.sourceRefs[0] ?? {}) as SourceRef;
              return { field: f.field!, value: r.quote ?? f.value ?? "", normalized: f.value, page: r.page ?? 1, start: r.start ?? 0, end: r.end ?? 0, quote: r.quote ?? "", method: f.method };
            },
          ),
      })),
    });

    const existing = await db()
      .select()
      .from(evidenceFindings)
      .where(and(eq(evidenceFindings.caseId, caseId), eq(evidenceFindings.scope, "case")));
    const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
    const produced = new Set(findings.map((f) => f.fingerprint));
    const toInsert = findings.filter((f) => !byFp.has(f.fingerprint));
    if (toInsert.length) {
      await db()
        .insert(evidenceFindings)
        .values(
          toInsert.map((f) => ({
            orgId,
            caseId,
            scope: "case" as const,
            kind: f.kind,
            field: f.field,
            value: f.value,
            provenance: f.provenance,
            method: "crosscheck/1.0.0",
            sourceRefs: f.sourceRefs,
            message: f.message,
            severity: f.severity,
            fingerprint: f.fingerprint,
            createdAt: now(),
          })),
        );
    }
    // Open findings that no longer apply are removed; resolved ones remain as history.
    const obsolete = existing.filter((e) => e.fingerprint && !produced.has(e.fingerprint) && e.status === "open").map((e) => e.id);
    if (obsolete.length) await db().delete(evidenceFindings).where(inArray(evidenceFindings.id, obsolete));

    const reqs = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, caseId));
    const statementComplete = Boolean(submission?.workDescription && submission.workDescription.length >= 10);
    const evaluated = evaluateChecklist(
      reqs,
      items.map((i) => ({ id: i.id, type: effectiveType(i), reviewStatus: i.reviewStatus })),
      statementComplete,
    );
    for (const e of evaluated) {
      const prior = reqs.find((r) => r.id === e.id)!;
      if (prior.status !== e.status || JSON.stringify(prior.satisfiedBy) !== JSON.stringify(e.satisfiedBy)) {
        await db().update(evidenceRequirements).set({ status: e.status as typeof prior.status, satisfiedBy: e.satisfiedBy, updatedAt: now() }).where(eq(evidenceRequirements.id, e.id));
      }
    }
    return { findings: findings.length };
  });
}

/** Finalize the open submission and move the case to EVIDENCE_RECEIVED. */
export async function submitEvidence(ctx: ActorContext, caseId: string, opts: { idempotencyKey?: string } = {}) {
  return transaction(async () => {
    const c = await loadCaseForOrg(ctx.orgId, caseId);
    let filter;
    if (ctx.actor.type === "homeowner") {
      if (ctx.actor.caseId !== c.id) throw new NotFoundError("Case");
      filter = and(eq(evidenceSubmissions.caseId, c.id), eq(evidenceSubmissions.grantId, ctx.actor.grantId), eq(evidenceSubmissions.status, "open"));
    } else {
      requirePermission(ctx, "evidence:upload");
      filter = and(eq(evidenceSubmissions.caseId, c.id), eq(evidenceSubmissions.submittedByType, "staff"), eq(evidenceSubmissions.status, "open"));
    }
    const [sub] = await db().select().from(evidenceSubmissions).where(filter);
    if (!sub) throw new ValidationError("Upload at least one document before submitting");
    const pending = await db()
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(and(eq(evidenceItems.submissionId, sub.id), inArray(evidenceItems.processingStatus, ["received", "processing"])));
    if (pending.length) throw new ConflictError("Some files are still being processed. Try again in a moment.");
    if (ctx.actor.type === "homeowner" && !(sub.workDescription && sub.workDescription.length >= 10)) {
      const [prior] = await db()
        .select({ id: evidenceSubmissions.id })
        .from(evidenceSubmissions)
        .where(and(eq(evidenceSubmissions.caseId, c.id), eq(evidenceSubmissions.status, "submitted"), isNotNull(evidenceSubmissions.workDescription)))
        .limit(1);
      if (!prior) throw new ValidationError("Please describe the work that was completed before submitting");
    }
    await transitionCase(ctx, { caseId: c.id, transition: "submit_evidence", submissionId: sub.id, idempotencyKey: opts.idempotencyKey ?? `submit:${sub.id}` });
    await db().update(evidenceSubmissions).set({ status: "submitted", submittedAt: now() }).where(eq(evidenceSubmissions.id, sub.id));
    if (ctx.actor.type === "homeowner") {
      const [grant] = await db().select().from(portalGrants).where(eq(portalGrants.id, ctx.actor.grantId));
      if (grant?.communicationId) await db().update(communications).set({ responseStatus: "submitted", respondedAt: now() }).where(eq(communications.id, grant.communicationId));
    }
    await refreshCaseEvidence(ctx.orgId, c.id);
    await recordAudit(ctx, {
      action: "evidence.submitted",
      entityType: "evidence_submission",
      entityId: sub.id,
      caseId: c.id,
      summary: `Evidence submission finalized by ${ctx.actor.type === "homeowner" ? "homeowner" : "staff"}`,
    });
    return sub;
  });
}
