import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, FolderOpen } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getCaseDetail } from "@/server/cases/queries";
import { suggestReviewAction } from "@/server/cases/suggest";
import { getAvailableTransitions } from "@/server/workflow/service";
import { NotFoundError } from "@/server/errors";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { EVIDENCE_TYPE_LABELS, PHOTO_LIMITATION, type EvidenceType } from "@/domain/evidence";
import { ClassificationBadge, PriorityBadge, ProvenanceBadge, StatusPill } from "@/components/app/badges";
import { ApplicantStatement, ChecklistList, EvidenceList, FindingsList, TriageCard } from "@/components/case/parts";
import { DispositionPanel, InspectionPanel, ReviewActionsPanel, type Perms } from "@/components/case/panels";
import { FindingControls, ItemControls, RequirementControls } from "@/components/case/review-forms";
import { KeyNav } from "@/components/case/key-nav";
import { buttonClass, Callout, Card, CardBody, CardHeader, cn, Kbd, LinkButton, SectionLabel } from "@/components/ui/primitives";

export const metadata = { title: "Review workspace" };

export default async function ReviewWorkspace({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<{ item?: string }> }) {
  const s = await requireStaffSession();
  const { caseId } = await params;
  const { item: itemParam } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound();
  let d;
  try {
    d = await getCaseDetail(s.org.id, caseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const available = await getAvailableTransitions(s.ctx, caseId);
  const p = (perm: Parameters<typeof hasPermission>[1]) => hasPermission(s.ctx, perm);
  const perms: Perms = {
    reconcile: p("cases:reconcile"),
    contacts: p("contacts:manage"),
    draft: p("comms:draft"),
    approve: p("comms:approve"),
    review: p("review:act"),
    inspect: p("inspections:record"),
    specialist: p("review:specialist"),
    determine: p("disposition:record"),
    confirm: p("disposition:confirm"),
    reopen: p("cases:reopen"),
    assign: p("cases:assign"),
  };
  const items = d.items;
  const idx = Math.max(0, items.findIndex((i) => i.id === itemParam));
  const item = items[idx] ?? null;
  const href = (id: string) => `/review/${caseId}?item=${id}`;
  const suggestion = suggestReviewAction(d);
  const sub = d.submissions.find((x) => x.submittedByType === "homeowner" && x.workDescription);
  const facts = (field: string) => d.findings.filter((f) => f.scope === "item" && f.kind === "fact" && f.field === field);
  const docVals = (field: string) =>
    facts(field).map((f) => ({ v: f.value, file: items.find((i) => i.id === f.evidenceItemId)?.originalFilename ?? "document" }));
  const rows: { label: string; record: string | null; claim: string | null; docs: { v: string | null; file: string }[] }[] = [
    { label: "Permit number", record: d.permit.permitNumber, claim: null, docs: docVals("permit_reference") },
    { label: "Job-site address", record: d.property?.addressLine ?? null, claim: null, docs: docVals("property_address") },
    { label: "Contractor", record: d.permit.contractorName, claim: sub?.contractorNameClaimed ?? null, docs: docVals("contractor_name") },
    { label: "Contractor license", record: d.permit.contractorLicense, claim: sub?.contractorLicenseClaimed ?? null, docs: docVals("contractor_license") },
    { label: "Work completed", record: null, claim: sub?.completionDateClaimed ?? null, docs: docVals("completion_date") },
    { label: "Invoice date", record: null, claim: null, docs: docVals("invoice_date") },
    { label: "Permit issued", record: d.permit.issuedAt, claim: null, docs: [] },
    { label: "Final inspection", record: d.permit.finalInspectionAt ?? "None recorded", claim: null, docs: docVals("inspection_assertion") },
  ];
  const openConflicts = d.findings.filter((f) => f.scope === "case" && f.kind === "conflict" && f.status === "open").length;

  return (
    <>
      <KeyNav prev={idx > 0 ? href(items[idx - 1].id) : null} next={idx < items.length - 1 ? href(items[idx + 1].id) : null} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-[12px] text-muted">
            <Link href="/review" className="hover:text-ink">Evidence Review</Link> / Workspace
          </div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-[19px] font-semibold">
            <span className="font-mono">{d.permit.permitNumber}</span> <StatusPill state={d.c.status} />
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {d.property?.addressLine ?? "No address"} · {d.permit.category ? CATEGORY_LABELS[d.permit.category as PermitCategory] : "No category"} · {d.permit.workDescription}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <ClassificationBadge classification={d.c.classification} />
            <PriorityBadge priority={d.c.priority} />
            {openConflicts > 0 && <span className="text-[12px] font-medium text-tone-critical-fg">{openConflicts} open conflict(s)</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/cases/${caseId}`}>
            <FolderOpen className="size-3.5" /> Full case
          </LinkButton>
          <a href={`/api/cases/${caseId}/packet`} className={buttonClass("secondary")}>
            <FileDown className="size-3.5" /> Packet
          </a>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_380px] 2xl:grid-cols-[260px_minmax(0,1fr)_440px]">
        <aside className="space-y-4">
          <Card>
            <CardHeader title={`Evidence (${items.length})`} description={<span>Navigate with <Kbd>[</Kbd> <Kbd>]</Kbd></span>} />
            <CardBody>
              <EvidenceList d={d} selectedId={item?.id} hrefFor={href} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Applicant statement" />
            <CardBody>
              <ApplicantStatement d={d} />
            </CardBody>
          </Card>
        </aside>

        <section className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Key facts" description="Each value is shown with its source. Differences are not resolved automatically." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line text-[10.5px] text-muted">
                    <th className="px-3 py-1.5 font-medium">Fact</th>
                    <th className="px-2 py-1.5 font-medium"><ProvenanceBadge provenance="verified_record" /></th>
                    <th className="px-2 py-1.5 font-medium"><ProvenanceBadge provenance="applicant_claim" /></th>
                    <th className="px-2 py-1.5 font-medium"><ProvenanceBadge provenance="extracted" /></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-1.5 text-muted">{r.label}</td>
                      <td className="px-2 py-1.5">{r.record ?? <span className="text-faint">—</span>}</td>
                      <td className="px-2 py-1.5">{r.claim ?? <span className="text-faint">—</span>}</td>
                      <td className={cn("px-2 py-1.5", r.docs.length > 1 && "text-ink")}>
                        {r.docs.length === 0 ? (
                          <span className="text-faint">Not found</span>
                        ) : (
                          r.docs.map((x, i) => (
                            <div key={i} title={x.file}>
                              {x.v}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            {item ? (
              <>
                <CardHeader
                  title={item.originalFilename}
                  description={`${EVIDENCE_TYPE_LABELS[(item.classifiedType ?? "unknown") as EvidenceType]} · classified by ${item.classificationMethod ?? "n/a"} (${item.classificationConfidence ?? "n/a"}) · text: ${item.textExtractionMethod ?? "n/a"}`}
                  actions={
                    <a href={`/api/evidence/${item.id}`} target="_blank" rel="noopener" className="text-[12px] font-medium text-brand hover:underline">
                      Open original
                    </a>
                  }
                />
                <div className="border-b border-line bg-subtle/50 p-3">
                  {item.mimeType === "application/pdf" ? (
                    <iframe title={item.originalFilename} src={`/api/evidence/${item.id}`} className="h-[520px] w-full rounded-md border border-line bg-surface" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/evidence/${item.id}`} alt={`Submitted photograph: ${item.originalFilename}`} className="mx-auto max-h-[520px] rounded-md border border-line" />
                  )}
                </div>
                <CardBody className="space-y-3">
                  {item.mimeType.startsWith("image/") && <Callout tone="neutral">{PHOTO_LIMITATION}</Callout>}
                  <div className="font-mono text-[10.5px] text-faint">
                    SHA-256 {item.sha256} · {item.sizeBytes.toLocaleString()} bytes{item.pageCount ? ` · ${item.pageCount} page(s)` : ""}
                    {item.classificationSignals?.length ? ` · signals: ${item.classificationSignals.join(", ")}` : ""}
                  </div>
                  <div>
                    <SectionLabel>Findings in this document</SectionLabel>
                    <FindingsList d={d} itemId={item.id} renderActions={(f) => perms.review && <FindingControls id={f.id} kind={f.kind} status={f.status} />} />
                  </div>
                  {perms.review && <ItemControls id={item.id} reviewStatus={item.reviewStatus} />}
                </CardBody>
              </>
            ) : (
              <CardBody>
                <p className="py-10 text-center text-[12.5px] text-muted">No evidence has been submitted for this case.</p>
              </CardBody>
            )}
          </Card>
          <TriageCard d={d} compact />
        </section>

        <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card>
            <CardHeader title="Discrepancies and checks" />
            <CardBody>
              <FindingsList d={d} renderActions={(f) => perms.review && <FindingControls id={f.id} kind={f.kind} status={f.status} />} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Evidence checklist" description={`From rule set ${d.ruleSet ? `v${d.ruleSet.version}` : "(none)"}. “Provided” means present, not verified.`} />
            <CardBody>
              <ChecklistList d={d} renderActions={(r) => perms.review && d.c.status === "UNDER_STAFF_REVIEW" && <RequirementControls id={r.id} status={r.status} />} />
            </CardBody>
          </Card>
          <ReviewActionsPanel d={d} perms={perms} available={available} suggestion={suggestion} />
          <InspectionPanel d={d} perms={perms} />
          <DispositionPanel d={d} perms={perms} available={available} />
        </aside>
      </div>
    </>
  );
}
