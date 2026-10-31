/**
 * Finalization verification on the case page: why a reported final still needs
 * checking, the system-of-record check itself, and the evidence once recorded.
 */
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { CaseDetail } from "@/server/cases/queries";
import { reviewReportedFinal } from "@/server/cases/finalization";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Callout, Card, CardBody, CardHeader, DL, Field, fmtDate, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { checkFinalizationAction, recordFinalizationCheckAction, reopenAction, routeFinalizationAction } from "@/app/(staff)/actions";
import { isoDate, now } from "@/server/util";
import type { Perms } from "./panels";

const METHOD = { system_of_record: "Permit system lookup", manual: "Manual check in the permit system" } as const;

export function FinalizationPanel({ d, perms }: { d: CaseDetail; perms: Perms }) {
  const st = d.c.status;
  const checks = d.finalizationChecks;
  const latest = checks[0] ?? null;
  const flagged = d.c.flags.includes("source_reports_final");
  if (st !== "FINALIZATION_VERIFICATION" && st !== "ALREADY_RESOLVED" && !flagged && !checks.length) return null;

  const src = d.sourceRecords[0]?.batch ?? null;
  const review = reviewReportedFinal({
    permit: d.permit,
    source: src ? { filename: src.filename, importedAt: src.createdAt } : null,
    passedInspectionRecords: d.inspections.filter((i) => i.source === "recorded" && i.result === "passed" && (i.inspectionType === "final" || i.inspectionType === "site_assessment")).length,
    openDuplicates: d.duplicates.filter((x) => x.d.status === "open").length,
    latest,
    today: isoDate(now()),
  });

  if (st === "ALREADY_RESOLVED" && latest) {
    return (
      <Card className="border-[#abefc6]">
        <CardHeader title="Already resolved" description="Finalized before PremedFix. The permit system of record confirmed an existing final; PremedFix did not close this permit." />
        <CardBody className="space-y-3">
          <DL
            cols={2}
            items={[
              ["Confirmed by", `${METHOD[latest.method]} · reference ${latest.sourceReference}`],
              ["System of record shows", `${latest.sourceStatus ?? "Final"}${latest.sourceFinalAt ? `, final inspection ${latest.sourceFinalAt}` : ""}`],
              ["Import reported", `${latest.reportedStatus ?? "—"}${latest.reportedFinalAt ? `, final inspection ${latest.reportedFinalAt}` : ""}`],
              ["Checked by", `${latest.actorName}${latest.actorRole ? ` (${latest.actorRole})` : ""}, ${fmtDate(latest.createdAt, { time: true })}`],
              ["Note", latest.note],
              ["Response", latest.response && (latest.response as { simulated?: boolean }).simulated ? "Simulated permit system (demo)" : latest.method === "manual" ? "Recorded by staff" : "Permit system adapter"],
            ]}
          />
          <p className="text-[12px] text-muted">Not counted as a PremedFix resolution or in the unresolved backlog. Reopen only if a separate unresolved issue is established.</p>
          {perms.reopen && (
            <ActionForm action={reopenAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="caseId" value={d.c.id} />
              <Input name="reason" placeholder="Separate issue established (required)" className="h-8 max-w-sm" required aria-label="Reason for reopening" />
              <SubmitButton size="sm" variant="secondary">
                Reopen for review
              </SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>
    );
  }

  if (st === "FINALIZATION_VERIFICATION") {
    return (
      <Card className="border-[#a5f0fc]">
        <CardHeader
          title="Finalization verification"
          description="A source reports this permit finaled. Until the permit system of record confirms it, the record stays out of the unresolved backlog and out of outreach, evidence requests, and inspections."
        />
        <CardBody className="space-y-4">
          <div>
            <SectionLabel>Why verification is still required</SectionLabel>
            <p className="mb-2 text-[12px] text-muted">Reported by: {review.reportedBy}</p>
            <ul className="space-y-1.5" data-testid="finalization-reasons">
              {review.items.map((it) => (
                <li key={it.label} className="flex gap-2 text-[12.5px]">
                  {it.ok === true ? (
                    <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-tone-confirmed-dot" aria-label="Consistent" />
                  ) : it.ok === false ? (
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-tone-attention-dot" aria-label="Unverified or inconsistent" />
                  ) : (
                    <Info className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                  )}
                  <span>
                    <span className="font-medium text-ink">{it.label}.</span> <span className="text-ink-2">{it.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Callout tone="pending" className="mt-3">
              {review.summary}
            </Callout>
          </div>
          {perms.reconcile ? (
            <div className="space-y-3">
              <ActionForm action={checkFinalizationAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-3">
                <input type="hidden" name="caseId" value={d.c.id} />
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <div className="font-medium">Check with the permit system of record</div>
                  <div className="text-muted">Records what the permit system shows, as evidence. Simulated in this demo.</div>
                </div>
                <SubmitButton size="sm">Check permit system (simulated)</SubmitButton>
              </ActionForm>
              <details className="rounded-lg border border-line px-3 py-2.5 text-[12.5px]">
                <summary className="cursor-pointer font-medium">Record a manual check instead</summary>
                <ActionForm action={recordFinalizationCheckAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="caseId" value={d.c.id} />
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-1 font-medium text-ink-2">What the permit system shows</legend>
                    <label className="mr-4 inline-flex items-center gap-1.5">
                      <input type="radio" name="outcome" value="confirmed" defaultChecked /> Finaled, with a passed final inspection
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="outcome" value="not_confirmed" /> Not finaled
                    </label>
                  </fieldset>
                  <Field label="Record reference" htmlFor={`fv-ref-${d.c.id}`}>
                    <Input id={`fv-ref-${d.c.id}`} name="sourceReference" placeholder="e.g. Accela record ACC-60011" required />
                  </Field>
                  <Field label="Final inspection date shown" hint="required when finaled" htmlFor={`fv-date-${d.c.id}`}>
                    <Input id={`fv-date-${d.c.id}`} name="sourceFinalAt" type="date" />
                  </Field>
                  <Field label="What you checked" className="sm:col-span-2" htmlFor={`fv-note-${d.c.id}`}>
                    <Textarea id={`fv-note-${d.c.id}`} name="note" rows={2} placeholder="e.g. Accela inspection history shows the final passed; permit status Finaled." required />
                  </Field>
                  <div className="sm:col-span-2">
                    <SubmitButton size="sm" variant="secondary">
                      Record check
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </div>
          ) : (
            <p className="text-[12px] text-muted">A permit clerk or administrator records the verification.</p>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Reported final" />
      <CardBody className="space-y-3">
        {flagged && (
          <>
            <Callout tone="pending" title="A source now reports this permit finaled">
              The case is already in progress. Pause it for verification so no further owner outreach, evidence requests, or inspections happen while the permit system is checked.
            </Callout>
            {perms.reconcile && (
              <ActionForm action={routeFinalizationAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="caseId" value={d.c.id} />
                <Input name="reason" placeholder="e.g. Re-import reports a final inspection on 2021-12-03" className="h-8 max-w-md" required aria-label="Reason" />
                <SubmitButton size="sm">Pause for finalization verification</SubmitButton>
              </ActionForm>
            )}
          </>
        )}
        {latest?.outcome === "not_confirmed" && (
          <p className="text-[12.5px] text-ink-2">
            The reported final was not confirmed by the permit system ({METHOD[latest.method].toLowerCase()}, reference {latest.sourceReference}, {fmtDate(latest.createdAt)}). The imported final is disregarded and the permit is handled as unresolved.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
