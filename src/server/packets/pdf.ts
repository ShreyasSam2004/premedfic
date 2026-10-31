/**
 * Case packet PDF. A compilation of administrative records for authorized
 * reviewers, with every fact labeled by provenance. It is not an inspection
 * report, certification, or legal determination, and says so on page one.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { CATEGORY_LABELS, SOURCE_STATUS_LABELS, type PermitCategory, type SourceStatus } from "@/domain/permits";
import { DETERMINATION_META, STATE_META, type DeterminationType } from "@/domain/workflow";
import { CLASSIFICATION_META, PATHWAY_LABELS, PRIORITY_DISCLAIMER, type Pathway, type TriageClassification } from "@/domain/triage";
import { EVIDENCE_TYPE_LABELS, PROVENANCE_META, REQUIREMENT_STATUS_LABELS, type EvidenceType, type Provenance, type RequirementStatus } from "@/domain/evidence";
import type { CaseDetail } from "../cases/queries";
import type { SignatureMeta } from "../db/schema";

const PAGE = { w: 612, h: 792, margin: 54 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const RULE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.16, 0.27, 0.62);

/** Map text to what the standard (WinAnsi) font can encode. */
export function pdfSafe(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[→⇒]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/[\r\t\f]/g, " ")
    .replace(/[^\x20-\x7e\n -ÿ—•…]/g, "?");
}

class Writer {
  doc: PDFDocument;
  page!: PDFPage;
  y = 0;
  constructor(
    doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.doc = doc;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - PAGE.margin;
  }
  ensure(h: number) {
    if (this.y - h < PAGE.margin + 24) this.newPage();
  }
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > width && line) {
          out.push(line);
          line = word;
          while (font.widthOfTextAtSize(line, size) > width && line.length > 8) {
            const cut = Math.floor(line.length * (width / font.widthOfTextAtSize(line, size)));
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        } else line = candidate;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const x = PAGE.margin + (opts.indent ?? 0);
    const lines = this.wrap(text, size, PAGE.w - PAGE.margin - x, font);
    for (const l of lines) {
      this.ensure(size + 3);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 2;
  }
  heading(text: string) {
    this.ensure(40);
    this.y -= 10;
    this.page.drawText(pdfSafe(text).toUpperCase(), { x: PAGE.margin, y: this.y - 11, size: 10.5, font: this.bold, color: ACCENT });
    this.y -= 16;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= 6;
  }
  kv(pairs: [string, string | null | undefined][]) {
    const labelW = 150;
    for (const [k, v] of pairs) {
      const lines = this.wrap(v ?? "Unknown / not recorded", 9.5, PAGE.w - PAGE.margin * 2 - labelW);
      this.ensure(lines.length * 12.5);
      this.page.drawText(pdfSafe(k), { x: PAGE.margin, y: this.y - 9.5, size: 9, font: this.bold, color: MUTED });
      for (const [i, l] of lines.entries()) {
        this.page.drawText(l, { x: PAGE.margin + labelW, y: this.y - 9.5 - i * 12.5, size: 9.5, font: this.font, color: v ? INK : MUTED });
      }
      this.y -= lines.length * 12.5 + 1.5;
    }
  }
  labeled(label: string, text: string) {
    const tag = `[${label.toUpperCase()}]`;
    const tagW = this.bold.widthOfTextAtSize(pdfSafe(tag), 7.5) + 6;
    const lines = this.wrap(text, 9.5, PAGE.w - PAGE.margin * 2 - tagW);
    this.ensure(lines.length * 12.5 + 2);
    this.page.drawText(pdfSafe(tag), { x: PAGE.margin, y: this.y - 9, size: 7.5, font: this.bold, color: MUTED });
    for (const [i, l] of lines.entries()) this.page.drawText(l, { x: PAGE.margin + tagW, y: this.y - 9.5 - i * 12.5, size: 9.5, font: this.font, color: INK });
    this.y -= lines.length * 12.5 + 3;
  }
  finish() {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(pdfSafe(`${this.footer}   |   Page ${i + 1} of ${pages.length}`), { x: PAGE.margin, y: 28, size: 7.5, font: this.font, color: MUTED });
    });
  }
}

const fmtDate = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString().replace("T", " ").slice(0, 16) + " UTC") : null);

export async function buildCasePacket(d: CaseDetail, meta: { generatedBy: string; generatedAt: Date; auditHeadHash: string; auditChainValid: boolean }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Case packet — permit ${d.permit.permitNumber}`);
  doc.setCreator("PremedFix AI");
  doc.setProducer("PremedFix AI case packet generator v1");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `PremedFix case packet · Permit ${d.permit.permitNumber} · Generated ${fmtDate(meta.generatedAt)} by ${meta.generatedBy}`);

  w.text("PremedFix AI — Case Review Packet", { size: 16, bold: true, gap: 2 });
  w.text(`Permit ${d.permit.permitNumber} · ${d.property?.addressLine ?? "Address not recorded"} · ${d.jurisdiction.name}`, { size: 10.5, color: MUTED, gap: 8 });
  w.text(
    "This packet compiles administrative records for review by authorized officials. It is NOT an inspection report, a safety or code-compliance certification, or a legal determination. Information labeled EXTRACTED or AI-EXTRACTED was machine-read from submitted documents and is not verified. Only an authorized official can make a determination, and a permit is officially closed only after confirmation by the municipal system of record.",
    { size: 8.5, color: MUTED, gap: 6 },
  );
  w.text("Provenance labels: " + Object.values(PROVENANCE_META).map((p) => `${p.label.toUpperCase()} = ${p.description}`).join("  "), { size: 7.5, color: MUTED, gap: 4 });

  w.heading("1. Permit identifiers and current status");
  w.kv([
    ["Permit number", d.permit.permitNumber],
    ["Category", d.permit.category ? `${CATEGORY_LABELS[d.permit.category as PermitCategory]} (source: "${d.permit.rawCategory ?? ""}")` : null],
    ["Work description", d.permit.workDescription],
    ["Issued / expires", `${d.permit.issuedAt ?? "unknown"} / ${d.permit.expiresAt ?? "unknown"}`],
    ["Source status", `${SOURCE_STATUS_LABELS[d.permit.sourceStatus as SourceStatus] ?? d.permit.sourceStatus}${d.permit.sourceStatusRaw ? ` (raw: "${d.permit.sourceStatusRaw}")` : ""}`],
    ["Final inspection on record", d.permit.finalInspectionAt],
    ["Contractor", [d.permit.contractorName, d.permit.contractorLicense].filter(Boolean).join(" · ") || null],
    ["Source system / record", [d.permit.sourceSystem, d.permit.sourceRecordId].filter(Boolean).join(" · ") || null],
    ["Workflow state", `${STATE_META[d.c.status].label} (case version ${d.c.version})`],
    ["Assigned", [d.assignedName, d.specialistName ? `specialist: ${d.specialistName}` : null].filter(Boolean).join(" · ") || "Unassigned"],
  ]);

  w.heading("2. Property and jurisdiction");
  w.kv([
    ["Property address", d.property?.addressLine],
    ["Parcel", d.property?.parcelId],
    ["Jurisdiction", `${d.jurisdiction.name}${d.jurisdiction.isReferenceExample ? " (reference example)" : ""}`],
    ["Other permits at property", d.related.length ? d.related.map((r) => `${r.permitNumber} (${STATE_META[r.status].label})`).join("; ") : "None on record"],
  ]);

  w.heading("3. Record history");
  for (const s of d.sourceRecords) {
    w.labeled("verified record", `Imported ${fmtDate(s.record.createdAt)} from "${s.batch.filename}" row ${s.record.rowNumber} (${s.record.outcome}). File SHA-256 ${s.batch.fileSha256.slice(0, 16)}…${s.record.changes ? ` Changes: ${Object.entries(s.record.changes).map(([k, v]) => `${k}: ${v.from ?? "blank"} -> ${v.to}`).join("; ")}` : ""}`);
  }
  for (const wn of d.permit.fieldWarnings) w.labeled("inference", `${wn.field}: ${wn.message}${wn.raw ? ` (raw: "${wn.raw}")` : ""}`);
  for (const i of d.inspections) {
    w.labeled("verified record", `${i.inspectionType} inspection ${i.result} on ${fmtDate(i.inspectedAt)?.slice(0, 10)} (${i.source === "imported" ? "from source system" : `recorded by ${i.inspectorName}`})${i.notes ? ` — ${i.notes}` : ""}`);
  }
  if (!d.inspections.length) w.labeled("unknown", "No inspection records on file for this permit.");

  w.heading("4. Rule checks");
  if (d.triage) {
    w.kv([
      ["Classification", CLASSIFICATION_META[d.triage.classification as TriageClassification]?.label ?? d.triage.classification],
      ["Pathway", PATHWAY_LABELS[d.triage.pathway as Pathway] ?? d.triage.pathway],
      ["Review priority", `${d.triage.priority} (score ${d.triage.priorityScore}). ${PRIORITY_DISCLAIMER}`],
      ["Rule set", d.ruleSet ? `${d.ruleSet.name} v${d.ruleSet.version} — ${d.ruleSet.verificationStatus === "verified" ? `verified by ${d.ruleSet.reviewedByName}` : "UNVERIFIED (human review required)"}; source: ${d.ruleSet.sourceCitation}` : "No rule set (human review required)"],
      ["Engine", `${d.triage.engineVersion}, computed ${fmtDate(d.triage.computedAt)}`],
      ["Human review required", d.triage.humanReviewRequired ? "Yes" : "Before disposition (always)"],
      ["Specialist / site inspection", `${d.triage.specialistRequired ? `Specialist required (${d.triage.specialistDiscipline ?? "general"})` : "No specialist rule triggered"}; ${d.triage.siteInspectionRequired ? "site inspection required" : "site inspection not required by rule"}`],
    ]);
    for (const e of d.evaluations.filter((x) => x.outcome === "triggered")) w.labeled("inference", `${e.ruleId} v${e.ruleVersion}: ${e.explanation}`);
  } else w.labeled("unknown", "Triage has not run.");

  w.heading("5. Evidence inventory");
  if (!d.items.length) w.labeled("unknown", "No evidence submitted.");
  for (const it of d.items) {
    w.labeled(
      "verified record",
      `${it.originalFilename} — ${it.mimeType}, ${(it.sizeBytes / 1024).toFixed(0)} KB, SHA-256 ${it.sha256.slice(0, 20)}…, received ${fmtDate(it.createdAt)} from ${it.uploadedByType}. Classified: ${EVIDENCE_TYPE_LABELS[(it.classifiedType ?? "unknown") as EvidenceType] ?? it.classifiedType} (${it.classificationConfidence ?? "n/a"}, ${it.classificationMethod ?? "n/a"}). Reviewer: ${it.reviewStatus}.`,
    );
  }
  w.text("Checklist", { bold: true, size: 9.5, gap: 1 });
  for (const r of d.requirements) {
    w.labeled(r.status === "accepted" || r.status === "waived" ? "verified record" : r.status === "missing" ? "unknown" : "applicant claim", `${r.label}${r.required ? "" : " (optional)"}: ${REQUIREMENT_STATUS_LABELS[r.status as RequirementStatus]}${r.reviewNote ? ` — ${r.reviewNote}` : ""}`);
  }

  w.heading("6. Extracted facts and applicant claims");
  const sub = d.submissions.find((s) => s.submittedByType === "homeowner");
  if (sub) {
    w.labeled("applicant claim", `Submitted by ${sub.submitterName ?? "homeowner"} (${sub.relationship}) ${fmtDate(sub.submittedAt) ?? "(not yet submitted)"}.`);
    if (sub.workDescription) w.labeled("applicant claim", `Work completed: ${sub.workDescription}`);
    w.labeled(sub.completionDateClaimed ? "applicant claim" : "unknown", `Completion date: ${sub.completionDateClaimed ?? "not stated"}`);
    if (sub.contractorNameClaimed || sub.contractorLicenseClaimed) w.labeled("applicant claim", `Contractor: ${[sub.contractorNameClaimed, sub.contractorLicenseClaimed].filter(Boolean).join(" · ")}`);
  }
  for (const f of d.findings.filter((x) => x.scope === "item" && x.kind === "fact")) {
    const item = d.items.find((i) => i.id === f.evidenceItemId);
    const ref = f.sourceRefs[0];
    w.labeled(PROVENANCE_META[f.provenance as Provenance].label, `${f.field}: ${f.value} — "${ref?.quote ?? ""}" (${item?.originalFilename ?? "document"}, p.${ref?.page ?? "?"}, chars ${ref?.start ?? "?"}-${ref?.end ?? "?"}; ${f.method})`);
  }

  w.heading("7. Missing or conflicting information");
  const issues = d.findings.filter((f) => ["conflict", "unknown", "warning", "untrusted_instruction"].includes(f.kind));
  if (!issues.length) w.labeled("inference", "No conflicts or gaps detected by the deterministic checks. This is not a verification.");
  for (const f of issues) {
    w.labeled(
      f.kind === "unknown" ? "unknown" : PROVENANCE_META[f.provenance as Provenance].label,
      `${f.kind.toUpperCase()}${f.status === "resolved" ? " (RESOLVED)" : ""}: ${f.message}${f.resolutionNote ? ` Resolution: ${f.resolutionNote}` : ""}`,
    );
  }

  w.heading("8. Communication timeline");
  if (!d.comms.length) w.labeled("unknown", "No communications.");
  for (const { comm } of [...d.comms].reverse()) {
    w.labeled("verified record", `${fmtDate(comm.sentAt ?? comm.createdAt)} · ${comm.purpose.replace(/_/g, " ")} · ${comm.channel} · ${comm.status.replace(/_/g, " ")}${comm.recipientDisplay ? ` · to ${comm.recipientDisplay}` : ""}${comm.adapter ? ` · adapter: ${comm.adapter}` : ""}${comm.responseStatus !== "none" ? ` · response: ${comm.responseStatus}` : ""}`);
  }

  w.heading("9. Reviewer notes and decisions");
  if (!d.decisions.length) w.labeled("unknown", "No reviewer decisions recorded.");
  for (const dec of [...d.decisions].reverse()) {
    w.labeled("verified record", `${fmtDate(dec.createdAt)} · ${dec.actorName} (${dec.actorRole}) · ${dec.decisionType.replace(/_/g, " ")}: ${dec.summary}${dec.reason ? ` — Reason: ${dec.reason}` : ""}${dec.overrodeSuggestion ? ` [Overrode system suggestion: ${dec.suggestedAction}]` : ""}`);
  }

  w.heading("10. Required next actions");
  const outstanding = d.requirements.filter((r) => r.required && !["accepted", "waived"].includes(r.status));
  if (d.triage && !["OFFICIALLY_CLOSED", "OTHER_OFFICIAL_OUTCOME", "MERGED_DUPLICATE"].includes(d.c.status)) w.labeled("inference", d.triage.recommendedAction);
  for (const r of outstanding) w.labeled("unknown", `Outstanding: ${r.label}`);
  const openIssues = issues.filter((f) => f.status === "open" && f.kind === "conflict");
  if (openIssues.length) w.labeled("inference", `${openIssues.length} open conflict(s) must be resolved by a reviewer.`);

  w.heading("11. Determination and signature");
  const det = d.decisions.find((x) => x.decisionType === "official_determination");
  if (det) {
    const sig = det.signature as SignatureMeta | null;
    w.kv([
      ["Determination", DETERMINATION_META[det.determination as DeterminationType]?.label ?? det.determination],
      ["Basis", det.reason],
      ["Signed by", sig ? `${sig.name}${sig.title ? `, ${sig.title}` : ""} (${sig.role})` : det.actorName],
      ["Signed at", sig?.signedAt ?? fmtDate(det.createdAt)],
      ["Signature method", sig ? `${sig.method.replace(/_/g, " ")}. Attestation: "${sig.attestation}"` : null],
      ["Rule set at decision", det.ruleSetVersion ? `v${det.ruleSetVersion}` : null],
    ]);
    const s = d.dispositions[0];
    if (s) {
      w.kv([
        ["System-of-record update", `${s.status.toUpperCase()} via ${s.adapter}${s.externalReference ? ` (reference ${s.externalReference})` : ""}`],
        ["Confirmation", s.respondedAt ? `${fmtDate(s.respondedAt)} by ${s.confirmedByType === "user" ? "authorized staff (manual confirmation)" : "source-system response"}${s.responseNote ? ` — ${s.responseNote}` : ""}` : "Awaiting confirmation — the permit is NOT officially closed."],
      ]);
    }
  } else w.labeled("unknown", "No official determination has been recorded.");

  w.heading("Integrity");
  w.kv([
    ["Generated", `${fmtDate(meta.generatedAt)} by ${meta.generatedBy}`],
    ["Audit events for case", String(d.audit.length)],
    ["Audit chain head", `${meta.auditHeadHash.slice(0, 32)}… (${meta.auditChainValid ? "chain verified" : "CHAIN VERIFICATION FAILED"})`],
  ]);
  w.finish();
  return doc.save();
}
