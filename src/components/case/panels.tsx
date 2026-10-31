/**
 * Action panels for the case graph. Each form posts to a server action; the
 * domain services enforce role, tenant, and state-machine guards, and any
 * unmet precondition is shown inline. Panels only render for roles that hold
 * the relevant permission, purely to reduce clutter.
 */
import { randomUUID } from "node:crypto";
import { CircleCheck, Lock, ShieldAlert } from "lucide-react";
import { CATEGORY_LABELS, PERMIT_CATEGORIES, type PermitCategory } from "@/domain/permits";
import { DETERMINATION_META, DETERMINATION_TYPES, STATE_META, type DeterminationType } from "@/domain/workflow";
import type { CaseDetail } from "@/server/cases/queries";
import type { ActionAvailability } from "@/server/workflow/service";
import { isContactable } from "@/server/workflow/service";
import { ATTESTATION_TEXT } from "@/server/disposition/service";
import { REVIEW_ACTIONS, type ReviewAction } from "@/server/reviews/service";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Badge, Callout, Card, CardBody, CardHeader, cn, Field, fmtDate, Input, Select, Tag, Textarea } from "@/components/ui/primitives";
import {
  addContactAction,
  approveNoticeAction,
  assignAction,
  cancelDraftAction,
  correctFieldAction,
  determinationAction,
  draftNoticeAction,
  duplicateAction,
  inspectionAction,
  manualConfirmAction,
  manualOutreachAction,
  optOutAction,
  reopenAction,
  reviewAction,
  sourceResponseAction,
  specialistAction,
  verifyContactAction,
} from "@/app/(staff)/actions";

export interface Perms {
  reconcile: boolean;
  contacts: boolean;
  draft: boolean;
  approve: boolean;
  review: boolean;
  inspect: boolean;
  specialist: boolean;
  determine: boolean;
  confirm: boolean;
  reopen: boolean;
  assign: boolean;
}

const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function ReconciliationPanel({ d, perms }: { d: CaseDetail; perms: Perms }) {
  if (d.c.status !== "NEEDS_DATA_RECONCILIATION") return null;
  const open = d.duplicates.filter((x) => x.d.status === "open");
  return (
    <Card>
      <CardHeader title="Data reconciliation" description="Resolve the record's data issues before any outreach. Corrections are attributed; original source rows are never edited." />
      <CardBody className="space-y-4">
        {open.map(({ d: cand, other }) => (
          <div key={cand.id} className="rounded-lg border border-line" data-testid="duplicate-candidate">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[12.5px] font-medium">Possible duplicate · match score {cand.score}</span>
              <span className="text-[11.5px] text-muted">{cand.reasons.join(" · ")}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-line text-[12px]">
              {[d.permit, other].map((p, i) => (
                <div key={p.id} className="space-y-0.5 px-3 py-2">
                  <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{i === 0 ? "This record" : "Other record"}</div>
                  <div className="font-mono font-medium">{p.permitNumber}</div>
                  <div>{p.category ? CATEGORY_LABELS[p.category as PermitCategory] : "No category"} · raw “{p.rawCategory ?? ""}”</div>
                  <div>Issued {p.issuedAt ?? "unknown"} · expires {p.expiresAt ?? "unknown"}</div>
                  <div className="text-muted">{p.workDescription ?? "No description"}</div>
                  <div className="text-muted">
                    {p.sourceSystem ?? "Unknown source"} · {p.sourceRecordId ?? "no record id"}
                  </div>
                </div>
              ))}
            </div>
            {perms.reconcile && (
              <ActionForm action={duplicateAction} className="space-y-2 border-t border-line px-3 py-3">
                <Hidden name="candidateId" value={cand.id} />
                <Field label="Reconciliation note" hint="required — how you confirmed this">
                  <Textarea name="note" rows={2} placeholder="e.g. Same permit in both systems; Accela record is authoritative per records clerk." required />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Select name="primaryPermitId" defaultValue={d.permit.sourceSystem?.startsWith("Accela") ? d.permit.id : other.id} className="h-8 w-auto text-[12.5px]" aria-label="Primary record">
                    <option value={d.permit.id}>Keep {d.permit.permitNumber} as primary</option>
                    <option value={other.id}>Keep {other.permitNumber} as primary</option>
                  </Select>
                  <SubmitButton size="sm" name="op" value="confirm">
                    Confirm duplicate and merge
                  </SubmitButton>
                  <SubmitButton size="sm" variant="secondary" name="op" value="dismiss">
                    Not a duplicate
                  </SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>
        ))}
        {d.permit.missingFields.filter((f) => f !== "address").length > 0 && perms.reconcile && (
          <ActionForm action={correctFieldAction} className="space-y-2 rounded-lg border border-line px-3 py-3">
            <Hidden name="caseId" value={d.c.id} />
            <div className="text-[12.5px] font-medium">Enter a missing value from the system of record</div>
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <Select name="field" aria-label="Field">
                {d.permit.missingFields
                  .filter((f) => f !== "address")
                  .map((f) => (
                    <option key={f} value={f}>
                      {f === "issuedAt" ? "Issuance date" : f === "category" ? "Category" : f}
                    </option>
                  ))}
              </Select>
              {d.permit.missingFields.includes("category") ? (
                <Select name="value" aria-label="Value">
                  {PERMIT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input name="value" type="date" aria-label="Value" required />
              )}
            </div>
            <Field label="Source" hint="required — where the value was verified">
              <Input name="sourceNote" placeholder="e.g. Accela record ACC-60011, permit detail screen" required />
            </Field>
            <SubmitButton size="sm">Save correction and re-triage</SubmitButton>
          </ActionForm>
        )}
        {d.permit.missingFields.includes("address") && (
          <Callout tone="attention" title="Property address missing">
            Address corrections require a parcel lookup in the property system and are not editable here. Re-import the corrected record; it will reconcile against this permit.
          </Callout>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Contacts and outreach
// ---------------------------------------------------------------------------

export function ContactsPanel({ d, perms }: { d: CaseDetail; perms: Perms }) {
  const hasAddr = Boolean(d.property?.addressLine);
  const draft = d.comms.find((c) => c.comm.status === "draft");
  const canDraft = d.c.status === "TRIAGED" && d.triage?.classification !== "MONITOR_ACTIVE" && !draft;
  const contactable = d.contacts.filter((c) => isContactable(c, hasAddr));
  return (
    <Card>
      <CardHeader title="Owner contact" description="Only contacts verified against property records can receive outreach. The system never guesses contacts." />
      <CardBody className="space-y-3">
        {d.contacts.length === 0 && (
          <Callout tone="attention" title="No contact on file">
            No owner contact was provided in the source data. Research the owner of record and add a contact, or log manual outreach.
          </Callout>
        )}
        {d.contacts.map((c) => {
          const v = d.verifications.filter((x) => x.contactId === c.id);
          return (
            <div key={c.id} className="rounded-md border border-line px-3 py-2.5" data-testid="contact-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium">{c.name ?? "Unnamed contact"}</span>
                <Tag>{c.role}</Tag>
                <Tag>source: {c.source}</Tag>
                {c.verificationStatus === "owner_of_record_verified" ? (
                  <Badge tone="review">
                    <CircleCheck className="-ml-0.5 size-3" /> Verified owner of record
                  </Badge>
                ) : (
                  <Badge tone="attention">Unverified — not contactable</Badge>
                )}
              </div>
              <div className="mt-1 text-[12px] text-ink-2">
                {[c.email, c.phone].filter(Boolean).join(" · ") || "No email or phone"}
                {c.optOutEmail || c.optOutSms ? <span className="text-tone-attention-fg"> · opted out of {[c.optOutEmail && "email", c.optOutSms && "SMS"].filter(Boolean).join(" & ")}</span> : null}
              </div>
              {v.map((x) => (
                <div key={x.id} className="mt-1 text-[11.5px] text-muted">
                  {x.method.replace(/_/g, " ")} · {x.status} · {fmtDate(x.createdAt, { time: true })}
                  {x.note ? ` — ${x.note}` : ""}
                </div>
              ))}
              {perms.contacts && c.verificationStatus !== "owner_of_record_verified" && (
                <ActionForm action={verifyContactAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <Hidden name="caseId" value={d.c.id} />
                  <Hidden name="contactId" value={c.id} />
                  <div className="min-w-[240px] flex-1">
                    <Input name="note" placeholder="Property record matched (e.g. appraiser owner name + mailing address)" required aria-label="Verification note" />
                  </div>
                  <SubmitButton size="sm" variant="secondary">
                    Verify against property records
                  </SubmitButton>
                </ActionForm>
              )}
              {perms.contacts && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11.5px] text-muted hover:text-ink">Communication preferences</summary>
                  <ActionForm action={optOutAction} className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]" compact>
                    <Hidden name="contactId" value={c.id} />
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" name="optOutEmail" defaultChecked={c.optOutEmail} className="accent-brand" /> Opted out of email
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" name="optOutSms" defaultChecked={c.optOutSms} className="accent-brand" /> Opted out of SMS
                    </label>
                    <SubmitButton size="sm" variant="ghost">
                      Save
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
            </div>
          );
        })}

        {perms.draft && canDraft && contactable.length > 0 && (
          <ActionForm action={draftNoticeAction} className="space-y-2 rounded-md border border-line bg-subtle/40 px-3 py-3">
            <Hidden name="caseId" value={d.c.id} />
            <div className="text-[12.5px] font-medium">Draft owner notice</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select name="contactId" aria-label="Recipient">
                {contactable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select name="channel" aria-label="Channel" defaultValue={contactable[0]?.email ? "email" : contactable[0]?.phone ? "sms" : "letter"}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="letter">Postal letter</option>
              </Select>
            </div>
            <p className="text-[11.5px] text-muted">Uses the approved, tone-reviewed template. The notice is not sent until an authorized staff member approves it.</p>
            <SubmitButton size="sm">Draft notice for approval</SubmitButton>
          </ActionForm>
        )}

        {draft && <DraftApproval d={d} draft={draft.comm} perms={perms} />}

        {perms.contacts && (
          <details className="rounded-md border border-line px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] font-medium">Add a contact from research</summary>
            <ActionForm action={addContactAction} className="mt-2 grid gap-2 sm:grid-cols-2" resetOnSuccess>
              <Hidden name="caseId" value={d.c.id} />
              <Input name="name" placeholder="Full name" required aria-label="Name" />
              <Select name="role" aria-label="Role">
                <option value="owner">Owner</option>
                <option value="representative">Authorized representative</option>
              </Select>
              <Input name="email" type="email" placeholder="Email" aria-label="Email" />
              <Input name="phone" placeholder="Phone (10 digits)" aria-label="Phone" />
              <div className="sm:col-span-2">
                <SubmitButton size="sm" variant="secondary">
                  Add contact (unverified)
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}
        {perms.contacts && d.c.status === "TRIAGED" && (
          <details className="rounded-md border border-line px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] font-medium">Log manual outreach attempt</summary>
            <ActionForm action={manualOutreachAction} className="mt-2 space-y-2" resetOnSuccess>
              <Hidden name="caseId" value={d.c.id} />
              <Select name="channel" aria-label="Channel">
                <option value="phone">Phone call</option>
                <option value="in_person">Site visit</option>
                <option value="letter">Letter to owner of record</option>
              </Select>
              <Textarea name="note" rows={2} placeholder="What was attempted and the result" required aria-label="Note" />
              <SubmitButton size="sm" variant="secondary">
                Log attempt
              </SubmitButton>
            </ActionForm>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

function DraftApproval({ d, draft, perms }: { d: CaseDetail; draft: CaseDetail["comms"][number]["comm"]; perms: Perms }) {
  return (
    <div className="rounded-md border border-[#fedf89] bg-tone-attention-bg/40 px-3 py-3" data-testid="draft-notice">
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium">
        Draft awaiting approval <Tag>{draft.channel}</Tag> <span className="text-[11.5px] font-normal text-muted">to {draft.recipientDisplay}</span>
      </div>
      {draft.subject && <div className="text-[12px] font-medium text-ink-2">{draft.subject}</div>}
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface px-2.5 py-2 font-sans text-[12px] whitespace-pre-wrap text-ink-2 ring-1 ring-line">{draft.body}</pre>
      {perms.approve ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <ActionForm action={approveNoticeAction}>
            <Hidden name="communicationId" value={draft.id} />
            <SubmitButton size="sm">Approve and send (simulated)</SubmitButton>
          </ActionForm>
          {perms.draft && (
            <ActionForm action={cancelDraftAction} className="flex items-center gap-2">
              <Hidden name="communicationId" value={draft.id} />
              <Input name="reason" placeholder="Reason to withdraw" className="h-7 w-[200px] text-[12px]" aria-label="Reason" required />
              <SubmitButton size="sm" variant="ghost">
                Withdraw
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted">Awaiting approval by an administrator, clerk, or manager.</p>
      )}
      <p className="mt-2 text-[11px] text-muted">Delivery uses the simulated adapter. No email, SMS, or letter is sent to anyone. Case: {STATE_META[d.c.status].label}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const REVIEW_STATES = ["EVIDENCE_RECEIVED", "UNDER_STAFF_REVIEW", "READY_FOR_AUTHORIZED_DISPOSITION", "OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED", "TRIAGED"];

export function ReviewActionsPanel({
  d,
  perms,
  available,
  suggestion,
}: {
  d: CaseDetail;
  perms: Perms;
  available: ActionAvailability[];
  suggestion: { action: ReviewAction; because: string } | null;
}) {
  if (!perms.review || !REVIEW_STATES.includes(d.c.status)) return null;
  const byTransition = new Map(available.map((a) => [a.id, a]));
  const actions = (Object.entries(REVIEW_ACTIONS) as [ReviewAction, (typeof REVIEW_ACTIONS)[ReviewAction]][]).filter(([, spec]) => byTransition.has(spec.transition));
  if (!actions.length) return null;
  const idem = randomUUID();
  return (
    <Card>
      <CardHeader title="Reviewer actions" description="Explicit, attributed decisions. The system's suggestion is advisory; choosing differently requires a recorded reason." />
      <CardBody>
        {suggestion && (
          <div className="mb-3 rounded-md border border-line bg-subtle/60 px-3 py-2 text-[12.5px]" data-testid="suggestion">
            <span className="mr-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Suggested</span>
            <span className="font-medium">{REVIEW_ACTIONS[suggestion.action].label}</span>
            <span className="text-muted"> — {suggestion.because}</span>
          </div>
        )}
        <ActionForm action={reviewAction} className="space-y-3">
          <Hidden name="caseId" value={d.c.id} />
          <Hidden name="version" value={d.c.version} />
          <Hidden name="idempotencyKey" value={idem} />
          <Hidden name="suggestedAction" value={suggestion?.action ?? ""} />
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[12px] font-medium text-ink-2">Action</legend>
            {actions.map(([key, spec]) => {
              const avail = byTransition.get(spec.transition)!;
              const blocked = avail.problems.filter((p) => !p.includes("reason is required"));
              return (
                <label key={key} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12.5px]", blocked.length ? "border-line bg-subtle/40" : "border-line hover:border-line-strong")}>
                  <input type="radio" name="action" value={key} required defaultChecked={suggestion?.action === key && !blocked.length} disabled={blocked.length > 0} className="mt-0.5 accent-brand" />
                  <span className="min-w-0">
                    <span className={cn("font-medium", blocked.length && "text-muted")}>{spec.label}</span>
                    {spec.transition !== "begin_review" && <span className="text-muted"> → {STATE_META[avail.to].label}</span>}
                    {blocked.map((p) => (
                      <span key={p} className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted">
                        <Lock className="size-3 shrink-0" /> {p}
                      </span>
                    ))}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <Field label="Message to owner" hint="for information or corrected-document requests; shown on the portal">
            <Textarea name="message" rows={2} placeholder="e.g. Please upload the final page of the contractor invoice showing the completion date." />
          </Field>
          <Field label="Reason / reviewer note" hint="required when you differ from the suggestion or the action requires it">
            <Textarea name="reason" rows={2} />
          </Field>
          <SubmitButton>Record action</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function InspectionPanel({ d, perms }: { d: CaseDetail; perms: Perms }) {
  const needsSpecialist = Boolean(d.triage?.specialistRequired);
  const showInspection = perms.inspect && ["INSPECTION_REQUIRED", "UNDER_STAFF_REVIEW"].includes(d.c.status);
  const showSpecialist = perms.specialist && needsSpecialist && ["UNDER_STAFF_REVIEW", "INSPECTION_REQUIRED", "TRIAGED"].includes(d.c.status);
  if (!showInspection && !showSpecialist && !d.inspections.length) return null;
  return (
    <Card>
      <CardHeader title="Inspections and specialist assessment" description="Site inspections are recorded by inspectors. Photographs and documents cannot substitute for an inspection where the rules require one." />
      <CardBody className="space-y-3">
        {d.inspections.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone={i.result === "passed" ? "review" : i.result === "failed" ? "critical" : "neutral"}>
              {i.inspectionType.replace("_", " ")} · {i.result}
            </Badge>
            <span>{fmtDate(i.inspectedAt)}</span>
            <span className="text-muted">{i.source === "imported" ? "from source system" : `recorded by ${i.inspectorName}`}</span>
            {i.notes && <span className="w-full text-[11.5px] text-muted">{i.notes}</span>}
          </div>
        ))}
        {showSpecialist && !d.decisions.some((x) => x.decisionType === "specialist_assessment") && (
          <ActionForm action={specialistAction} className="space-y-2 rounded-md border border-[#fecdca] px-3 py-3">
            <Hidden name="caseId" value={d.c.id} />
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
              <ShieldAlert className="size-3.5 text-tone-critical-fg" /> {d.triage?.specialistDiscipline ?? "Specialist"} assessment
            </div>
            <Textarea name="summary" rows={3} placeholder="Assessment of the record and documents. State what cannot be determined without a site visit." required aria-label="Assessment" />
            <Input name="recommendation" placeholder="Recommendation (e.g. schedule site inspection of service equipment)" required aria-label="Recommendation" />
            <SubmitButton size="sm">Record assessment</SubmitButton>
          </ActionForm>
        )}
        {showInspection && (
          <ActionForm action={inspectionAction} className="space-y-2 rounded-md border border-line px-3 py-3">
            <Hidden name="caseId" value={d.c.id} />
            <div className="text-[12.5px] font-medium">Record inspection result</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select name="inspectionType" aria-label="Type">
                <option value="site_assessment">Site assessment</option>
                <option value="final">Final inspection</option>
              </Select>
              <Select name="result" aria-label="Result">
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="partial">Partial / corrections needed</option>
                <option value="not_performed">Could not be performed</option>
              </Select>
              <Input name="inspectedOn" type="date" required aria-label="Inspection date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <Textarea name="notes" rows={2} placeholder="Inspection observations" required aria-label="Notes" />
            <SubmitButton size="sm">Record inspection</SubmitButton>
          </ActionForm>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export function DispositionPanel({ d, perms, available }: { d: CaseDetail; perms: Perms; available: ActionAvailability[] }) {
  const st = d.c.status;
  const sub = d.dispositions[0];
  const det = d.decisions.find((x) => x.decisionType === "official_determination");
  if (st === "READY_FOR_AUTHORIZED_DISPOSITION") {
    const record = available.find((a) => a.id === "record_determination");
    const types = DETERMINATION_TYPES.filter((t) => t !== "close_aged_permit_no_apparent_hazard" || d.triage?.agedPermitEligible);
    return (
      <Card className="border-[#d9d6fe]">
        <CardHeader title="Authorized disposition" description="Ready for review by an authorized official. Nothing has been approved. A determination is recorded only by a building official and takes effect only after the system of record confirms it." />
        <CardBody className="space-y-3">
          {d.triage?.agedPermitEligible && (
            <Callout tone="info" title="Aged-permit provision may be considered">
              The active rule set provides an aged-permit provision this permit meets by age. Eligibility is not entitlement: it requires the official&rsquo;s own determination that no apparent safety hazards exist.
            </Callout>
          )}
          {perms.determine && record ? (
            <ActionForm action={determinationAction} className="space-y-3">
              <Hidden name="caseId" value={d.c.id} />
              <Hidden name="version" value={d.c.version} />
              <Hidden name="idempotencyKey" value={randomUUID()} />
              <Field label="Determination">
                <Select name="determination" required defaultValue="" data-testid="determination-select">
                  <option value="" disabled>
                    Choose a determination…
                  </option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {DETERMINATION_META[t].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Basis for determination" hint="required; recorded verbatim in the case packet">
                <Textarea name="reason" rows={3} required />
              </Field>
              <label className="flex items-start gap-2 rounded-md border border-line bg-subtle/50 px-3 py-2 text-[12px]">
                <input type="checkbox" name="attest" required className="mt-0.5 accent-brand" />
                <span>{ATTESTATION_TEXT}</span>
              </label>
              {record.problems.filter((p) => !p.includes("reason") && !p.includes("determination type")).length > 0 && (
                <ul className="space-y-0.5 text-[11.5px] text-muted">
                  {record.problems
                    .filter((p) => !p.includes("reason") && !p.includes("determination type"))
                    .map((p) => (
                      <li key={p} className="flex items-center gap-1">
                        <Lock className="size-3" /> {p}
                      </li>
                    ))}
                </ul>
              )}
              <SubmitButton>Sign and record determination</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-[12.5px] text-muted">Awaiting a building official. Your role cannot record determinations.</p>
          )}
        </CardBody>
      </Card>
    );
  }
  if (st === "DISPOSITION_PENDING_CONFIRMATION" && sub) {
    return (
      <Card className="border-[#a5f0fc]">
        <CardHeader title="Closure submitted — awaiting system-of-record confirmation" description="The determination has been recorded and submitted. The permit is NOT officially closed until the municipal system of record confirms the update." />
        <CardBody className="space-y-3 text-[12.5px]">
          {det && (
            <div>
              <div className="font-medium">{DETERMINATION_META[det.determination as DeterminationType]?.label}</div>
              <div className="text-muted">
                Signed by {det.signature?.name} ({det.signature?.title}) · {fmtDate(det.createdAt, { time: true })}
              </div>
              <div className="mt-1 text-ink-2">{det.reason}</div>
            </div>
          )}
          <div className="rounded-md bg-subtle px-3 py-2 text-[12px]">
            Submission via <span className="font-mono">{sub.adapter}</span> at {fmtDate(sub.submittedAt, { time: true })} · status <strong>{sub.status}</strong>
          </div>
          {perms.confirm && (
            <div className="grid gap-3 lg:grid-cols-2">
              <ActionForm action={sourceResponseAction} className="space-y-2 rounded-md border border-line px-3 py-3">
                <Hidden name="submissionId" value={sub.id} />
                <div className="font-medium">Simulated permit system response</div>
                <p className="text-[11.5px] text-muted">Demo stand-in for an integration callback (e.g. Accela or EnerGov). The source system, not this button, is the authority in production.</p>
                <div className="flex gap-2">
                  <SubmitButton size="sm" name="outcome" value="confirmed">
                    Simulate confirmation
                  </SubmitButton>
                  <SubmitButton size="sm" variant="secondary" name="outcome" value="rejected">
                    Simulate rejection
                  </SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={manualConfirmAction} className="space-y-2 rounded-md border border-line px-3 py-3">
                <Hidden name="submissionId" value={sub.id} />
                <div className="font-medium">Documented manual confirmation</div>
                <Input name="externalReference" placeholder="Reference shown in the system of record" required aria-label="Reference" />
                <Input name="note" placeholder="How the update was verified" required aria-label="Note" />
                <SubmitButton size="sm" variant="secondary">
                  Record manual confirmation
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }
  if ((st === "OFFICIALLY_CLOSED" || st === "OTHER_OFFICIAL_OUTCOME") && det) {
    return (
      <Card className={st === "OFFICIALLY_CLOSED" ? "border-[#abefc6]" : undefined}>
        <CardHeader title={st === "OFFICIALLY_CLOSED" ? "Officially closed" : "Official outcome confirmed"} description="Authorized determination confirmed by the municipal system of record." />
        <CardBody className="space-y-2 text-[12.5px]">
          <div className="font-medium">{DETERMINATION_META[det.determination as DeterminationType]?.label}</div>
          <div className="text-muted">
            Signed by {det.signature?.name} · {fmtDate(det.createdAt, { time: true })}
            {sub?.externalReference ? ` · source reference ${sub.externalReference}` : ""}
            {sub?.respondedAt ? ` · confirmed ${fmtDate(sub.respondedAt, { time: true })} (${sub.confirmedByType === "user" ? "manual" : "source system"})` : ""}
          </div>
          <div className="text-ink-2">{det.reason}</div>
          {perms.reopen && (
            <ActionForm action={reopenAction} className="mt-2 flex flex-wrap items-center gap-2">
              <Hidden name="caseId" value={d.c.id} />
              <Input name="reason" placeholder="Reason for reopening" className="h-8 max-w-sm" required aria-label="Reason" />
              <SubmitButton size="sm" variant="danger">
                Reopen case
              </SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>
    );
  }
  return null;
}

export function AssignmentPanel({ d, perms, staff, currentUserId }: { d: CaseDetail; perms: Perms; staff: { id: string; name: string; role: string; specialties: string[] }[]; currentUserId: string }) {
  const reviewers = staff.filter((s) => s.role === "inspector" || s.role === "official");
  // A reported final awaiting verification (or already resolved) needs no specialist work.
  const specialistApplies = Boolean(d.triage?.specialistRequired) && !["FINALIZATION_VERIFICATION", "ALREADY_RESOLVED"].includes(d.c.status);
  return (
    <div className="space-y-2.5">
      <div className="text-[12.5px]">
        <div className="text-muted">Assigned</div>
        <div className="font-medium">{d.assignedName ?? "Unassigned"}</div>
      </div>
      {specialistApplies && (
        <div className="text-[12.5px]">
          <div className="text-muted">Specialist ({d.triage?.specialistDiscipline})</div>
          <div className="font-medium">{d.specialistName ?? <span className="text-tone-attention-fg">Not yet assigned</span>}</div>
        </div>
      )}
      {perms.assign && (
        <ActionForm action={assignAction} className="flex gap-1.5" compact>
          <Hidden name="caseId" value={d.c.id} />
          <Hidden name="kind" value="primary" />
          <Select name="userId" aria-label="Assign to" className="h-7 text-[12px]" defaultValue={d.c.assignedUserId ?? ""}>
            <option value="" disabled>
              Assign to…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <SubmitButton size="sm" variant="secondary">
            Assign
          </SubmitButton>
        </ActionForm>
      )}
      {perms.assign && specialistApplies && (
        <ActionForm action={assignAction} className="flex gap-1.5" compact>
          <Hidden name="caseId" value={d.c.id} />
          <Hidden name="kind" value="specialist" />
          <Select name="userId" aria-label="Assign specialist" className="h-7 text-[12px]" defaultValue={d.c.specialistUserId ?? ""}>
            <option value="" disabled>
              Specialist…
            </option>
            {reviewers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.specialties.includes(d.triage?.specialistDiscipline ?? "") ? `(${d.triage?.specialistDiscipline})` : ""}
              </option>
            ))}
          </Select>
          <SubmitButton size="sm" variant="secondary">
            Assign
          </SubmitButton>
        </ActionForm>
      )}
      {!perms.assign && perms.review && d.c.assignedUserId !== currentUserId && (
        <ActionForm action={assignAction} compact>
          <Hidden name="caseId" value={d.c.id} />
          <Hidden name="kind" value="primary" />
          <Hidden name="userId" value={currentUserId} />
          <SubmitButton size="sm" variant="secondary">
            Assign to me
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
