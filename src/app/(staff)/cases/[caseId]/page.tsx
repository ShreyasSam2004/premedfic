import { FinalizationPanel } from "@/components/case/finalization-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, FileDown } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getCaseDetail, listStaff } from "@/server/cases/queries";
import { outstandingTasks } from "@/server/cases/tasks";
import { suggestReviewAction } from "@/server/cases/suggest";
import { getAvailableTransitions } from "@/server/workflow/service";
import { REVIEW_ACTIONS } from "@/server/reviews/service";
import { NotFoundError } from "@/server/errors";
import { CATEGORY_LABELS, SOURCE_STATUS_LABELS, type PermitCategory, type SourceStatus } from "@/domain/permits";
import { REVIEW_QUEUE_STATES, STATE_META } from "@/domain/workflow";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { ClassificationBadge, PriorityBadge, StatusPill } from "@/components/app/badges";
import { ApplicantStatement, AuditTimeline, ChecklistList, CommsTimeline, DecisionsList, EvidenceList, FindingsList, StageTracker, TasksCard, TriageCard } from "@/components/case/parts";
import { AssignmentPanel, ContactsPanel, DispositionPanel, InspectionPanel, ReconciliationPanel, ReviewActionsPanel, type Perms } from "@/components/case/panels";
import { buttonClass, Card, CardBody, CardHeader, DL, fmtDate, LinkButton, SectionLabel, Tag } from "@/components/ui/primitives";
import { retriageAction, staffSubmitEvidenceAction } from "@/app/(staff)/actions";
import { ROLE_LABELS } from "@/domain/roles";

export const metadata = { title: "Case" };

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const s = await requireStaffSession();
  const { caseId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound();
  let d;
  try {
    d = await getCaseDetail(s.org.id, caseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [available, staff] = await Promise.all([getAvailableTransitions(s.ctx, caseId), listStaff(s.org.id)]);
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
  const tasks = outstandingTasks(d);
  const suggestion = suggestReviewAction(d);
  const inReview = REVIEW_QUEUE_STATES.includes(d.c.status);
  const staffOpenSubmission = d.submissions.find((x) => x.submittedByType === "staff" && x.status === "open");
  const { permit, property } = d;

  return (
    <>
      <div className="mb-4">
        <div className="mb-1 text-[12px] text-muted">
          <Link href="/permits" className="hover:text-ink">Permits</Link> / {d.jurisdiction.name}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-[20px] font-semibold tracking-[-0.01em]">
              <span className="font-mono">{permit.permitNumber}</span>
              <StatusPill state={d.c.status} />
            </h1>
            <p className="mt-1 text-[13px] text-ink-2">
              {property?.addressLine ?? <span className="text-tone-attention-fg">No address on record</span>}
              <span className="text-muted">
                {" "}
                · {permit.category ? CATEGORY_LABELS[permit.category as PermitCategory] : "No category"} · issued {fmtDate(permit.issuedAt)} · expires {fmtDate(permit.expiresAt)}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ClassificationBadge classification={d.c.classification} />
              <PriorityBadge priority={d.c.priority} />
              {d.c.flags.includes("retriaged_during_review") && <Tag title="Source data or rules changed after review began">Re-triaged during review</Tag>}
              <span className="text-[11.5px] text-muted">Case version {d.c.version}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {inReview && (
              <LinkButton href={`/review/${d.c.id}`} variant="primary">
                <ClipboardCheck className="size-3.5" /> Open review workspace
              </LinkButton>
            )}
            <a href={`/api/cases/${d.c.id}/packet`} className={buttonClass("secondary")} data-testid="export-packet">
              <FileDown className="size-3.5" /> Export case packet
            </a>
            {p("cases:triage") && (
              <ActionForm action={retriageAction}>
                <input type="hidden" name="caseId" value={d.c.id} />
                <SubmitButton variant="ghost">Re-run triage</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
        <div className="mt-4">
          <StageTracker d={d} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <TasksCard
            tasks={tasks}
            recommended={
              d.triage && ["IMPORTED", "NEEDS_DATA_RECONCILIATION", "FINALIZATION_VERIFICATION", "TRIAGED"].includes(d.c.status)
                ? d.triage.recommendedAction
                : suggestion
                  ? `${REVIEW_ACTIONS[suggestion.action].label} — ${suggestion.because}`
                  : null
            }
          />
          <FinalizationPanel d={d} perms={perms} />
          <DispositionPanel d={d} perms={perms} available={available} />
          <ReconciliationPanel d={d} perms={perms} />
          {["TRIAGED", "AWAITING_CONTACT_APPROVAL", "OWNER_CONTACTED", "NEEDS_DATA_RECONCILIATION"].includes(d.c.status) && <ContactsPanel d={d} perms={perms} />}
          <ReviewActionsPanel d={d} perms={perms} available={available} suggestion={suggestion} />
          <InspectionPanel d={d} perms={perms} />
          <TriageCard d={d} />

          <Card>
            <CardHeader
              title="Evidence"
              description="Checklist from the active rule set, submitted items with content hashes, and cross-document findings."
              actions={inReview && <Link href={`/review/${d.c.id}`} className="text-[12px] font-medium text-brand hover:underline">Review evidence</Link>}
            />
            <CardBody className="grid gap-5 lg:grid-cols-2">
              <div>
                <SectionLabel>Checklist</SectionLabel>
                <ChecklistList d={d} />
              </div>
              <div className="space-y-4">
                <div>
                  <SectionLabel>Items</SectionLabel>
                  <EvidenceList d={d} />
                  {staffOpenSubmission && p("evidence:upload") && (
                    <ActionForm action={staffSubmitEvidenceAction} className="mt-2">
                      <input type="hidden" name="caseId" value={d.c.id} />
                      <SubmitButton size="sm" variant="secondary">Submit staff-uploaded documents</SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <div>
                  <SectionLabel>Applicant statement</SectionLabel>
                  <ApplicantStatement d={d} />
                </div>
              </div>
              <div className="lg:col-span-2">
                <SectionLabel>Cross-document findings</SectionLabel>
                <FindingsList d={d} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Communications" description="Every notice and request, with approval and delivery history. All delivery in this environment is simulated." />
            <CardBody>
              <CommsTimeline d={d} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Permit record" />
            <CardBody>
              <DL
                items={[
                  ["Permit number", <span key="pn" className="font-mono">{permit.permitNumber}</span>],
                  ["Category", permit.category ? `${CATEGORY_LABELS[permit.category as PermitCategory]}${permit.rawCategory ? ` (“${permit.rawCategory}”)` : ""}` : null],
                  ["Description", permit.workDescription],
                  ["Source status", `${SOURCE_STATUS_LABELS[permit.sourceStatus as SourceStatus] ?? permit.sourceStatus}${permit.sourceStatusRaw ? ` (“${permit.sourceStatusRaw}”)` : ""}`],
                  ["Issued", permit.issuedAt ? fmtDate(permit.issuedAt) : null],
                  ["Expires", permit.expiresAt ? fmtDate(permit.expiresAt) : null],
                  ["Final inspection", permit.finalInspectionAt ? fmtDate(permit.finalInspectionAt) : <span key="fi" className="text-muted">None recorded</span>],
                  ["Contractor", [permit.contractorName, permit.contractorLicense].filter(Boolean).join(" · ") || null],
                  ["Source", [permit.sourceSystem, permit.sourceRecordId].filter(Boolean).join(" · ") || null],
                ]}
              />
              {permit.fieldWarnings.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-line pt-2.5">
                  <SectionLabel>Normalization notes</SectionLabel>
                  {permit.fieldWarnings.map((w, i) => (
                    <p key={i} className="text-[11.5px] text-tone-attention-fg">
                      {w.field}: {w.message}
                    </p>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Assignment" />
            <CardBody>
              <AssignmentPanel d={d} perms={perms} staff={staff.map((m) => ({ id: m.id, name: m.name, role: m.role, specialties: m.specialties }))} currentUserId={s.user.id} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Property" />
            <CardBody className="space-y-3">
              <DL items={[["Address", property?.addressLine], ["Parcel", property?.parcelId], ["Jurisdiction", d.jurisdiction.name]]} />
              <div>
                <SectionLabel>Other permits at this property</SectionLabel>
                {d.related.length === 0 ? (
                  <p className="text-[12px] text-muted">None on record.</p>
                ) : (
                  <ul className="space-y-1">
                    {d.related.map((r) => (
                      <li key={r.permitId} className="flex items-center justify-between gap-2 text-[12px]">
                        <Link href={`/cases/${r.caseId}`} className="font-mono hover:text-brand hover:underline">
                          {r.permitNumber}
                        </Link>
                        <span className="text-muted">{STATE_META[r.status].label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
          {!["TRIAGED", "AWAITING_CONTACT_APPROVAL", "OWNER_CONTACTED", "NEEDS_DATA_RECONCILIATION"].includes(d.c.status) && <ContactsPanel d={d} perms={{ ...perms, draft: false }} />}
          <Card>
            <CardHeader title="Review decisions" />
            <CardBody>
              <DecisionsList d={d} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Source provenance" description="Original imported rows for this permit." />
            <CardBody>
              <ul className="space-y-2">
                {d.sourceRecords.map(({ record: r, batch }) => (
                  <li key={r.id} className="text-[12px]">
                    <Link href={`/permits/import/${batch.id}`} className="font-medium hover:text-brand hover:underline">
                      {batch.filename}
                    </Link>{" "}
                    <span className="text-muted">
                      row {r.rowNumber} · {r.outcome}
                    </span>
                    <details>
                      <summary className="cursor-pointer text-[11.5px] text-muted hover:text-ink">Original row</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-subtle p-2 font-mono text-[10.5px] whitespace-pre-wrap">{JSON.stringify(r.raw, null, 1)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Audit timeline" description={`${d.audit.length} append-only, hash-chained events`} />
            <CardBody>
              <AuditTimeline d={d} />
            </CardBody>
          </Card>
          <p className="px-1 text-[11px] text-muted">Viewing as {ROLE_LABELS[s.user.role]}. Actions shown depend on your role; every action is re-authorized on the server.</p>
        </aside>
      </div>
    </>
  );
}
