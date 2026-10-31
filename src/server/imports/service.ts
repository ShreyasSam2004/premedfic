/**
 * Permit CSV ingestion.
 *
 * stage   -> file validated, stored, headers parsed, mapping suggested
 * preview -> dry run: every row normalized and compared against existing data
 * commit  -> idempotent job: rows upserted, raw rows preserved, duplicates
 *            flagged, cases created and triaged, all in one transaction
 *
 * Re-importing the same records reconciles: unchanged rows are recorded as
 * unchanged, changed rows update the permit with a recorded field diff, and no
 * duplicate permits or cases are created.
 */
import Papa from "papaparse";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CANONICAL_FIELDS } from "@/domain/permits";
import { db, transaction } from "../db/client";
import {
  cases,
  contacts,
  duplicateCandidates,
  inspectionRecords,
  jurisdictions,
  memberships,
  permitImportBatches,
  permits,
  permitSourceRecords,
  properties,
  users,
  type FieldWarning,
  type Jurisdiction,
} from "../db/schema";
import { requirePermission, systemContext, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { canonicalJson, now, sha256 } from "../util";
import { storage } from "../storage";
import { enqueueJob, registerJobHandler, runJob } from "../jobs/queue";
import { triageCase } from "../triage/service";
import { suggestMapping, validateMapping } from "./mapping";
import { COMPARABLE_FIELDS, normalizeRow, type ColumnMapping, type NormalizedPermitRow } from "./normalize";
import { findDuplicateCandidates, type DedupeRecord } from "./dedupe";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 20_000;

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  parseErrors: { row: number; message: string }[];
}

export function parseCsv(text: string): ParsedCsv {
  const body = text.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = (res.meta.fields ?? []).filter((h) => h.length > 0);
  const rows = res.data.map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = r[h] == null ? "" : String(r[h]);
    return out;
  });
  const parseErrors = res.errors.map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  return { headers, rows, parseErrors };
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function loadBatch(orgId: string, batchId: string) {
  const [batch] = await db()
    .select()
    .from(permitImportBatches)
    .where(and(eq(permitImportBatches.id, batchId), eq(permitImportBatches.orgId, orgId)));
  if (!batch) throw new NotFoundError("Import batch");
  return batch;
}

async function loadParsed(storageKey: string) {
  return parseCsv(decode(await storage().get(storageKey)));
}

export async function stageImport(ctx: ActorContext, input: { filename: string; bytes: Uint8Array; sourceSystem?: string | null }) {
  const user = requirePermission(ctx, "permits:import");
  const filename = input.filename.replace(/[^\w.\- ]/g, "_").slice(0, 120);
  if (!/\.(csv|txt)$/i.test(filename)) throw new ValidationError("Only .csv files are accepted");
  if (input.bytes.byteLength === 0) throw new ValidationError("The file is empty");
  if (input.bytes.byteLength > MAX_CSV_BYTES) throw new ValidationError(`File exceeds ${MAX_CSV_BYTES / 1024 / 1024} MB`);
  const text = decode(input.bytes);
  if (text.includes("\u0000")) throw new ValidationError("File appears to be binary, not CSV");
  const parsed = parseCsv(text);
  if (parsed.headers.length < 2) throw new ValidationError("Could not find a header row with at least two columns");
  if (parsed.rows.length === 0) throw new ValidationError("The file has a header but no data rows");
  if (parsed.rows.length > MAX_CSV_ROWS) throw new ValidationError(`File exceeds ${MAX_CSV_ROWS.toLocaleString()} rows; split it into smaller batches`);
  const dupHeaders = parsed.headers.filter((h, i) => parsed.headers.indexOf(h) !== i);
  if (dupHeaders.length) throw new ValidationError(`Duplicate column headers: ${[...new Set(dupHeaders)].join(", ")}`);

  const fileSha256 = sha256(input.bytes);
  const storageKey = `imports/${ctx.orgId}/${fileSha256}.csv`;
  await storage().put(storageKey, input.bytes);

  return transaction(async () => {
    const [batch] = await db()
      .insert(permitImportBatches)
      .values({
        orgId: ctx.orgId,
        filename,
        fileSha256,
        storageKey,
        sourceSystem: input.sourceSystem?.trim() || null,
        uploadedBy: user.userId,
        status: "uploaded",
        headers: parsed.headers,
        columnMapping: suggestMapping(parsed.headers),
        rowCount: parsed.rows.length,
        createdAt: now(),
      })
      .returning();
    await recordAudit(ctx, {
      action: "import.staged",
      entityType: "import_batch",
      entityId: batch.id,
      summary: `Uploaded ${filename} (${parsed.rows.length} rows)`,
      metadata: { fileSha256, rows: parsed.rows.length },
    });
    return batch;
  });
}

export async function getPriorImportOfFile(orgId: string, fileSha256: string, excludeBatchId: string) {
  const rows = await db()
    .select()
    .from(permitImportBatches)
    .where(and(eq(permitImportBatches.orgId, orgId), eq(permitImportBatches.fileSha256, fileSha256), eq(permitImportBatches.status, "completed")))
    .orderBy(desc(permitImportBatches.createdAt));
  return rows.find((r) => r.id !== excludeBatchId) ?? null;
}

// ---------------------------------------------------------------------------
// Row planning (shared by preview and commit)
// ---------------------------------------------------------------------------

export interface PlannedRow {
  rowNumber: number;
  raw: Record<string, string>;
  record: NormalizedPermitRow | null;
  jurisdiction: Jurisdiction | null;
  outcome: "create" | "update" | "unchanged" | "error" | "duplicate_in_file";
  errors: string[];
  warnings: FieldWarning[];
  changes: Record<string, { from: unknown; to: unknown }> | null;
  existingPermitId: string | null;
}

function resolveJurisdiction(list: Jurisdiction[], value: string | null, fallbackId: string | null): Jurisdiction | null {
  if (value) {
    const v = value.trim().toLowerCase();
    return list.find((j) => j.code.toLowerCase() === v || j.name.toLowerCase() === v) ?? null;
  }
  return list.find((j) => j.id === fallbackId) ?? null;
}

function diff(existing: typeof permits.$inferSelect, rec: NormalizedPermitRow) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of COMPARABLE_FIELDS) {
    const incoming = rec[f];
    const current = existing[f as keyof typeof existing];
    // A field absent from this export never erases a known value.
    if (incoming === null || incoming === undefined) continue;
    if (incoming !== current) changes[f] = { from: current ?? null, to: incoming };
  }
  return changes;
}

async function planRows(orgId: string, parsed: ParsedCsv, mapping: ColumnMapping, jurisdictionId: string | null, sourceSystem: string | null) {
  const juris = await db().select().from(jurisdictions).where(eq(jurisdictions.orgId, orgId));
  const parseErrorsByRow = new Map<number, string[]>();
  for (const e of parsed.parseErrors) parseErrorsByRow.set(e.row, [...(parseErrorsByRow.get(e.row) ?? []), e.message]);

  const normalized = parsed.rows.map((raw, i) => ({ rowNumber: i + 2, raw, result: normalizeRow(raw, mapping, { sourceSystem }) }));
  const keys = [...new Set(normalized.map((n) => n.result.record?.permitKey).filter(Boolean) as string[])];
  const existing = keys.length
    ? await db()
        .select()
        .from(permits)
        .where(and(eq(permits.orgId, orgId), inArray(permits.permitKey, keys)))
    : [];

  const seen = new Map<string, number>();
  const planned: PlannedRow[] = [];
  for (const { rowNumber, raw, result } of normalized) {
    const errors = [...result.errors, ...(parseErrorsByRow.get(rowNumber) ?? [])];
    const rec = result.record;
    const base = { rowNumber, raw, record: rec, warnings: result.warnings, changes: null, existingPermitId: null };
    if (!rec || result.errors.length) {
      planned.push({ ...base, jurisdiction: null, outcome: "error", errors });
      continue;
    }
    const j = resolveJurisdiction(juris, rec.jurisdiction, jurisdictionId);
    if (!j) {
      planned.push({
        ...base,
        jurisdiction: null,
        outcome: "error",
        errors: [...errors, rec.jurisdiction ? `Unknown jurisdiction "${rec.jurisdiction}"` : "No jurisdiction mapped or selected for this row"],
      });
      continue;
    }
    const fileKey = `${j.id}:${rec.permitKey}`;
    if (seen.has(fileKey)) {
      planned.push({
        ...base,
        jurisdiction: j,
        outcome: "duplicate_in_file",
        errors,
        warnings: [...result.warnings, { field: "permitNumber", message: `Same permit ID as row ${seen.get(fileKey)}; first occurrence used` }],
      });
      continue;
    }
    seen.set(fileKey, rowNumber);
    const match = existing.find((p) => p.jurisdictionId === j.id && p.permitKey === rec.permitKey);
    if (!match) {
      planned.push({ ...base, jurisdiction: j, outcome: "create", errors });
      continue;
    }
    const changes = diff(match, rec);
    planned.push({
      ...base,
      jurisdiction: j,
      outcome: Object.keys(changes).length ? "update" : "unchanged",
      errors,
      changes: Object.keys(changes).length ? changes : null,
      existingPermitId: match.id,
    });
  }
  return planned;
}

function summarize(planned: PlannedRow[]) {
  const count = (o: PlannedRow["outcome"]) => planned.filter((p) => p.outcome === o).length;
  return {
    total: planned.length,
    create: count("create"),
    update: count("update"),
    unchanged: count("unchanged"),
    error: count("error"),
    duplicateInFile: count("duplicate_in_file"),
    withWarnings: planned.filter((p) => p.warnings.length > 0).length,
    missingEssential: planned.filter((p) => (p.record?.missingFields.length ?? 0) > 0 && p.outcome !== "error").length,
  };
}

export interface ImportOptions {
  mapping: ColumnMapping;
  jurisdictionId: string | null;
}

function checkOptions(headers: string[], opts: ImportOptions) {
  const allowed = new Set<string>(CANONICAL_FIELDS.map((f) => f.key));
  const mapping: ColumnMapping = {};
  for (const [k, v] of Object.entries(opts.mapping)) if (allowed.has(k) && v) mapping[k] = v;
  const problems = validateMapping(mapping, headers);
  if (!mapping.jurisdiction && !opts.jurisdictionId) problems.push("Select a jurisdiction or map a jurisdiction column");
  if (problems.length) throw new ValidationError("Column mapping is invalid", problems);
  return mapping;
}

export async function previewImport(ctx: ActorContext, batchId: string, opts: ImportOptions) {
  requirePermission(ctx, "permits:import");
  const batch = await loadBatch(ctx.orgId, batchId);
  const parsed = await loadParsed(batch.storageKey);
  const mapping = checkOptions(batch.headers, opts);
  const planned = await planRows(ctx.orgId, parsed, mapping, opts.jurisdictionId, batch.sourceSystem);
  return { batch, summary: summarize(planned), rows: planned };
}

export async function commitImport(ctx: ActorContext, batchId: string, opts: ImportOptions) {
  const user = requirePermission(ctx, "permits:import");
  const batch = await loadBatch(ctx.orgId, batchId);
  if (batch.status === "completed") return { batch, job: null, alreadyCommitted: true };
  const mapping = checkOptions(batch.headers, opts);
  if (opts.jurisdictionId) {
    const [j] = await db()
      .select()
      .from(jurisdictions)
      .where(and(eq(jurisdictions.id, opts.jurisdictionId), eq(jurisdictions.orgId, ctx.orgId)));
    if (!j) throw new NotFoundError("Jurisdiction");
  }
  await db()
    .update(permitImportBatches)
    .set({ columnMapping: mapping as Record<string, string | null>, jurisdictionId: opts.jurisdictionId })
    .where(eq(permitImportBatches.id, batch.id));
  const job = await enqueueJob({
    orgId: ctx.orgId,
    type: "import.process",
    payload: { orgId: ctx.orgId, batchId: batch.id, userId: user.userId },
    idempotencyKey: `import:${batch.id}`,
    maxAttempts: 3,
  });
  const finished = await runJob(job.id);
  const updated = await loadBatch(ctx.orgId, batch.id);
  if (finished.status === "failed") throw new ConflictError(`Import failed: ${finished.lastError ?? "unknown error"}. It can be retried from Settings → Jobs.`);
  return { batch: updated, job: finished, alreadyCommitted: false };
}

async function findOrCreateProperty(orgId: string, j: Jurisdiction, rec: NormalizedPermitRow) {
  if (rec.parcelId) {
    const [p] = await db()
      .select()
      .from(properties)
      .where(and(eq(properties.orgId, orgId), eq(properties.jurisdictionId, j.id), eq(properties.parcelId, rec.parcelId)));
    if (p) {
      if (!p.addressLine && rec.address) {
        await db().update(properties).set({ addressLine: rec.address, normalizedAddress: rec.addressKey, zip: rec.zip ?? p.zip }).where(eq(properties.id, p.id));
      }
      return p.id;
    }
  }
  if (rec.addressKey) {
    const [p] = await db()
      .select()
      .from(properties)
      .where(and(eq(properties.orgId, orgId), eq(properties.jurisdictionId, j.id), eq(properties.normalizedAddress, rec.addressKey)));
    if (p && (!rec.parcelId || !p.parcelId)) {
      if (!p.parcelId && rec.parcelId) await db().update(properties).set({ parcelId: rec.parcelId }).where(eq(properties.id, p.id));
      return p.id;
    }
  }
  if (!rec.parcelId && !rec.addressKey) return null;
  const [created] = await db()
    .insert(properties)
    .values({
      orgId,
      jurisdictionId: j.id,
      parcelId: rec.parcelId,
      addressLine: rec.address,
      city: rec.city ?? j.name.replace(/^(City|Town|Village) of /, ""),
      state: j.state,
      zip: rec.zip,
      normalizedAddress: rec.addressKey,
      createdAt: now(),
    })
    .returning();
  return created.id;
}

async function upsertImportedContact(orgId: string, propertyId: string, rec: NormalizedPermitRow) {
  if (!rec.ownerName && !rec.ownerEmail && !rec.ownerPhone) return;
  const existing = await db().select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.propertyId, propertyId)));
  const match = existing.find(
    (c) => (rec.ownerEmail && c.email === rec.ownerEmail) || (rec.ownerPhone && c.phone === rec.ownerPhone) || (rec.ownerName && c.name === rec.ownerName),
  );
  if (match) return;
  // Imported contact details are never trusted for outreach until verified by staff.
  await db().insert(contacts).values({
    orgId,
    propertyId,
    name: rec.ownerName,
    email: rec.ownerEmail,
    phone: rec.ownerPhone,
    role: "owner",
    source: "import",
    verificationStatus: "unverified",
    createdAt: now(),
    updatedAt: now(),
  });
}

async function processImportJob(payload: Record<string, unknown>) {
  const orgId = String(payload.orgId);
  const batchId = String(payload.batchId);
  const userId = String(payload.userId);
  const [member] = await db()
    .select({ role: memberships.role, name: users.name, title: users.title, specialties: memberships.specialties })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  if (!member) throw new Error("Importing user no longer has access to this organization");
  const ctx: ActorContext = { orgId, actor: { type: "user", userId, role: member.role, name: member.name, title: member.title, specialties: member.specialties } };
  const triageCtx = systemContext(orgId, "triage-engine");

  return transaction(async () => {
    const batch = await loadBatch(orgId, batchId);
    if (batch.status === "completed") return { skipped: true };
    await db().update(permitImportBatches).set({ status: "processing" }).where(eq(permitImportBatches.id, batch.id));
    const parsed = await loadParsed(batch.storageKey);
    const mapping = (batch.columnMapping ?? {}) as ColumnMapping;
    const planned = await planRows(orgId, parsed, mapping, batch.jurisdictionId, batch.sourceSystem);
    const at = now();
    const touchedPermitIds: string[] = [];
    const firstOccurrence = new Map<string, string>();

    for (const row of planned) {
      let permitId: string | null = row.existingPermitId;
      const rec = row.record;
      if (row.outcome === "create" && rec && row.jurisdiction) {
        const propertyId = await findOrCreateProperty(orgId, row.jurisdiction, rec);
        const [p] = await db()
          .insert(permits)
          .values({
            orgId,
            jurisdictionId: row.jurisdiction.id,
            propertyId,
            permitNumber: rec.permitNumber,
            permitKey: rec.permitKey,
            permitLooseKey: rec.permitLooseKey,
            category: rec.category,
            rawCategory: rec.rawCategory,
            workDescription: rec.workDescription,
            issuedAt: rec.issuedAt,
            expiresAt: rec.expiresAt,
            sourceStatusRaw: rec.sourceStatusRaw,
            sourceStatus: rec.sourceStatus,
            finalInspectionAt: rec.finalInspectionAt,
            contractorName: rec.contractorName,
            contractorLicense: rec.contractorLicense,
            sourceSystem: rec.sourceSystem,
            sourceRecordId: rec.sourceRecordId,
            missingFields: rec.missingFields,
            fieldWarnings: row.warnings,
            lastImportBatchId: batch.id,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        permitId = p.id;
        await db().insert(cases).values({ orgId, permitId: p.id, status: "IMPORTED", openedAt: at, lastTransitionAt: at, createdAt: at, updatedAt: at });
        if (rec.finalInspectionAt) {
          await db().insert(inspectionRecords).values({
            orgId,
            permitId: p.id,
            inspectionType: "final",
            result: "passed",
            inspectedAt: new Date(`${rec.finalInspectionAt}T12:00:00Z`),
            source: "imported",
            notes: `Final inspection date from ${rec.sourceSystem ?? "source system"} record`,
            createdAt: at,
          });
        }
        if (propertyId) await upsertImportedContact(orgId, propertyId, rec);
        touchedPermitIds.push(p.id);
      } else if (row.outcome === "update" && rec && permitId && row.changes) {
        const set: Record<string, unknown> = { updatedAt: at, lastImportBatchId: batch.id, fieldWarnings: row.warnings };
        for (const [field, change] of Object.entries(row.changes)) set[field] = change.to;
        const [p] = await db().select().from(permits).where(eq(permits.id, permitId));
        const merged = { ...p, ...set } as typeof p;
        set.missingFields = [...(p.propertyId ? [] : ["address"]), ...(["category", "issuedAt"] as const).filter((f) => merged[f] === null)];
        await db().update(permits).set(set).where(eq(permits.id, permitId));
        if (row.changes.finalInspectionAt && rec.finalInspectionAt) {
          await db().insert(inspectionRecords).values({
            orgId,
            permitId,
            inspectionType: "final",
            result: "passed",
            inspectedAt: new Date(`${rec.finalInspectionAt}T12:00:00Z`),
            source: "imported",
            notes: "Final inspection date added by re-import",
            createdAt: at,
          });
        }
        touchedPermitIds.push(permitId);
      } else if (row.outcome === "duplicate_in_file" && rec && row.jurisdiction) {
        permitId = firstOccurrence.get(`${row.jurisdiction.id}:${rec.permitKey}`) ?? null;
      }
      if (rec && row.jurisdiction && permitId && !firstOccurrence.has(`${row.jurisdiction.id}:${rec.permitKey}`)) {
        firstOccurrence.set(`${row.jurisdiction.id}:${rec.permitKey}`, permitId);
      }
      await db()
        .insert(permitSourceRecords)
        .values({
          orgId,
          batchId: batch.id,
          rowNumber: row.rowNumber,
          raw: row.raw,
          rowHash: sha256(canonicalJson(row.raw)),
          sourceSystem: rec?.sourceSystem ?? batch.sourceSystem,
          sourceRecordId: rec?.sourceRecordId ?? null,
          permitId,
          outcome: row.outcome === "create" ? "created" : row.outcome === "update" ? "updated" : row.outcome,
          errors: row.errors,
          warnings: row.warnings,
          changes: row.changes,
          createdAt: at,
        })
        .onConflictDoNothing();
    }

    // Possible-duplicate detection against the whole organization's permits.
    let duplicateFlagCount = 0;
    if (touchedPermitIds.length) {
      const pool = await db()
        .select({
          id: permits.id,
          permitNumber: permits.permitNumber,
          permitKey: permits.permitKey,
          permitLooseKey: permits.permitLooseKey,
          category: permits.category,
          issuedAt: permits.issuedAt,
          sourceSystem: permits.sourceSystem,
          parcelId: properties.parcelId,
          propertyId: permits.propertyId,
        })
        .from(permits)
        .leftJoin(properties, eq(properties.id, permits.propertyId))
        .where(eq(permits.orgId, orgId));
      const toRecord = (r: (typeof pool)[number]): DedupeRecord => ({ ...r, propertyKey: r.propertyId });
      const touched = new Set(touchedPermitIds);
      const matches = findDuplicateCandidates(pool.filter((r) => touched.has(r.id)).map(toRecord), pool.map(toRecord));
      for (const m of matches) {
        const inserted = await db()
          .insert(duplicateCandidates)
          .values({ orgId, permitId: m.a, candidatePermitId: m.b, score: m.score, reasons: m.reasons, createdAt: at })
          .onConflictDoNothing()
          .returning();
        duplicateFlagCount += inserted.length;
        // A newly flagged pair forces both records back through triage.
        if (inserted.length) for (const id of [m.a, m.b]) if (!touched.has(id)) touchedPermitIds.push(id);
      }
    }

    const caseRows = touchedPermitIds.length
      ? await db()
          .select({ id: cases.id })
          .from(cases)
          .where(and(eq(cases.orgId, orgId), inArray(cases.permitId, [...new Set(touchedPermitIds)])))
      : [];
    for (const c of caseRows) await triageCase(triageCtx, c.id);

    const s = summarize(planned);
    const [done] = await db()
      .update(permitImportBatches)
      .set({
        status: "completed",
        createdCount: s.create,
        updatedCount: s.update,
        unchangedCount: s.unchanged,
        errorCount: s.error + s.duplicateInFile,
        duplicateFlagCount,
        completedAt: now(),
      })
      .where(eq(permitImportBatches.id, batch.id))
      .returning();
    await recordAudit(ctx, {
      action: "import.completed",
      entityType: "import_batch",
      entityId: batch.id,
      summary: `Imported ${batch.filename}: ${s.create} created, ${s.update} updated, ${s.unchanged} unchanged, ${s.error} rejected, ${duplicateFlagCount} possible duplicates`,
      metadata: { ...s, duplicateFlagCount },
    });
    return { created: done.createdCount, updated: done.updatedCount, unchanged: done.unchangedCount, errors: done.errorCount, duplicates: duplicateFlagCount };
  });
}

registerJobHandler("import.process", processImportJob);

export async function listImportBatches(orgId: string) {
  return db()
    .select({ batch: permitImportBatches, uploader: users.name, jurisdiction: jurisdictions.name })
    .from(permitImportBatches)
    .leftJoin(users, eq(users.id, permitImportBatches.uploadedBy))
    .leftJoin(jurisdictions, eq(jurisdictions.id, permitImportBatches.jurisdictionId))
    .where(eq(permitImportBatches.orgId, orgId))
    .orderBy(desc(permitImportBatches.createdAt));
}

export async function getImportBatch(orgId: string, batchId: string) {
  const batch = await loadBatch(orgId, batchId);
  const records = await db()
    .select({ record: permitSourceRecords, permitNumber: permits.permitNumber, caseId: cases.id })
    .from(permitSourceRecords)
    .leftJoin(permits, eq(permits.id, permitSourceRecords.permitId))
    .leftJoin(cases, eq(cases.permitId, permitSourceRecords.permitId))
    .where(eq(permitSourceRecords.batchId, batch.id))
    .orderBy(permitSourceRecords.rowNumber);
  return { batch, records };
}

export const CSV_TEMPLATE_HEADERS = [
  "permit_number",
  "jurisdiction",
  "parcel_id",
  "property_address",
  "city",
  "zip",
  "permit_type",
  "work_description",
  "issue_date",
  "expiration_date",
  "status",
  "final_inspection_date",
  "contractor_name",
  "contractor_license",
  "owner_name",
  "owner_email",
  "owner_phone",
  "source_system",
  "source_record_id",
];

export function csvTemplate(): string {
  const example = [
    "BLD-2019-00001",
    "LKM",
    "12-34-56-7890-000",
    "123 EXAMPLE ST",
    "Lakemont",
    "32801",
    "Re-Roof",
    "Tear off and replace asphalt shingles",
    "2019-03-14",
    "2019-09-10",
    "Expired",
    "",
    "Example Roofing LLC",
    "CCC1330000",
    "Pat Example",
    "pat@example.com",
    "555-010-0000",
    "Legacy permit system",
    "LEG-000001",
  ];
  return Papa.unparse({ fields: CSV_TEMPLATE_HEADERS, data: [example] }) + "\n";
}

/** First rows of a staged file, for showing sample values beside each column during mapping. */
export async function sampleRows(orgId: string, batchId: string, n = 3) {
  const batch = await loadBatch(orgId, batchId);
  const parsed = await loadParsed(batch.storageKey);
  return { batch, headers: parsed.headers, rows: parsed.rows.slice(0, n), parseErrors: parsed.parseErrors.length };
}
