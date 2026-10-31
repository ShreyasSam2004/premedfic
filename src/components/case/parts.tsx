/**
 * Server-rendered sections of the case graph, shared by the case detail page,
 * the inspector workspace, and (structurally) the PDF packet.
 */
import { Check, CircleAlert, FileText, Image as ImageIcon, ShieldAlert, TriangleAlert } from "lucide-react";
import { STATE_META, type Phase } from "@/domain/workflow";
import { CLASSIFICATION_META, PATHWAY_LABELS, PRIORITY_DISCLAIMER, type Pathway, type TriageClassification } from "@/domain/triage";
import { EVIDENCE_TYPE_LABELS, type EvidenceType } from "@/domain/evidence";
import type { CaseDetail } from "@/server/cases/queries";
import type { Task } from "@/server/cases/tasks";
import { ClassificationBadge, PriorityBadge, ProvenanceBadge, RequirementBadge } from "@/components/app/badges";
import { Badge, Callout, Card, CardBody, CardHeader, cn, DL, fmtDate, SectionLabel, Tag } from "@/components/ui/primitives";

const PHASES: { key: Phase; label: string }[] = [
  { key: "intake", label: "Intake & triage" },
  { key: "outreach", label: "Outreach" },
  { key: "evidence", label: "Evidence" },
  { key: "review", label: "Staff review" },
  { key: "disposition", label: "Disposition" },
  { key: "resolved", label: "Confirmed outcome" },
];

const FINAL_PATH: { key: string; label: string }[] = [
  { key: "intake", label: "Intake & triage" },
  { key: "verification", label: "Finalization verification" },
  { key: "resolved", label: "Already resolved" },
];

export function StageTracker({ d }: { d: CaseDetail }) {
  // A reported final never passes through outreach, evidence, or review, so it gets its own path.
  if (d.c.status === "FINALIZATION_VERIFICATION" || d.c.status === "ALREADY_RESOLVED") {
    const idx = d.c.status === "ALREADY_RESOLVED" ? 2 : 1;
    return (
      <ol className="flex flex-wrap items-center gap-y-2" aria-label="Case progress">
        {FINAL_PATH.map((p, i) => {
          const done = i < idx || (idx === 2 && i === 2);
          const current = i === idx && idx !== 2;
          return (
            <li key={p.key} className="flex items-center">
              <span
                className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium", current ? "bg-brand text-white" : done ? "bg-subtle text-ink-2" : "text-faint")}
                aria-current={current ? "step" : undefined}
              >
                {done && <Check className="size-3" aria-hidden />}
                {p.label}
              </span>
              {i < FINAL_PATH.length - 1 && <span aria-hidden className={cn("mx-1 h-px w-5", i < idx ? "bg-line-strong" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
    );
  }
  const phase = STATE_META[d.c.status].phase;
  const idx = PHASES.findIndex((p) => p.key === phase);
  return (
    <ol className="flex flex-wrap items-center gap-y-2" aria-label="Case progress">
      {PHASES.map((p, i) => {
        const done = i < idx || (phase === "resolved" && i === idx);
        const current = i === idx && phase !== "resolved";
        return (
          <li key={p.key} className="flex items-center">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
                current ? "bg-brand text-white" : done ? "bg-subtle text-ink-2" : "text-faint",
              )}
              aria-current={current ? "step" : undefined}
            >
              {done && <Check className="size-3" aria-hidden />}
              {p.label}
            </span>
            {i < PHASES.length - 1 && <span aria-hidden className={cn("mx-1 h-px w-5", i < idx ? "bg-line-strong" : "bg-line")} />}
          </li>
        );
      })}
    </ol>
  );
}

export function TasksCard({ tasks, recommended }: { tasks: Task[]; recommended: string | null }) {
  return (
    <Card>
      <CardHeader title="Outstanding tasks" description="Derived from the case's recorded state. Each task names who is responsible." />
      <CardBody className="space-y-3">
        {recommended && (
          <div className="rounded-md border border-line bg-subtle/60 px-3 py-2 text-[12.5px]">
            <span className="mr-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">System suggestion</span>
            {recommended}
          </div>
        )}
        {tasks.length === 0 ? (
          <p className="text-[12.5px] text-muted">No outstanding tasks.</p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0 flex-1">
                  <div className="text-ink">{t.label}</div>
                  {t.detail && <div className="text-[11.5px] text-muted">{t.detail}</div>}
                </div>
                <Tag>{t.responsible}</Tag>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function TriageCard({ d, compact }: { d: CaseDetail; compact?: boolean }) {
  const t = d.triage;
  if (!t) return null;
  const triggered = d.evaluations.filter((e) => e.outcome === "triggered");
  const other = d.evaluations.filter((e) => e.outcome !== "triggered");
  return (
    <Card>
      <CardHeader
        title="Why this case was flagged"
        description={`Deterministic triage · ${t.engineVersion} · computed ${fmtDate(t.computedAt, { time: true })} by ${t.computedBy.startsWith("user:") ? "staff re-run" : t.computedBy}`}
        actions={<ClassificationBadge classification={t.classification} />}
      />
      <CardBody className="space-y-3.5">
        {!t.ruleSetVerified && (
          <Callout tone="attention" icon={<TriangleAlert className="size-3.5" />} title="Rule set not verified by municipal administrators">
            Routing under this rule set is provisional. Every step requires human confirmation.
          </Callout>
        )}
        {t.specialistRequired && (
          <Callout tone="critical" icon={<ShieldAlert className="size-3.5" />} title={`Specialist review required${t.specialistDiscipline ? ` — ${t.specialistDiscipline}` : ""}`}>
            No automated clearance pathway exists. {t.siteInspectionRequired ? "A passed site inspection must be on record before any disposition." : ""}
          </Callout>
        )}
        <DL
          cols={compact ? 1 : 2}
          items={[
            ["Pathway", PATHWAY_LABELS[t.pathway as Pathway] ?? t.pathway],
            [
              "Review priority",
              <span key="p" className="inline-flex items-center gap-2">
                <PriorityBadge priority={t.priority} /> <span className="text-muted">score {t.priorityScore}</span>
              </span>,
            ],
            ["Rule set", d.ruleSet ? `${d.ruleSet.name} · v${d.ruleSet.version}` : "None (human review required)"],
            ["Human review", t.humanReviewRequired ? "Required before the next step" : "Required before any disposition"],
            ["Permit age", t.permitAgeDays !== null ? `${(t.permitAgeDays / 365.25).toFixed(1)} years since issuance` : "Unknown (no issuance date)"],
            ["Data completeness", `${t.completeness.score}%${t.completeness.missing.length ? ` — missing ${t.completeness.missing.join(", ")}` : ""}`],
          ]}
        />
        <div>
          <SectionLabel>Triggered rules</SectionLabel>
          {triggered.length === 0 ? (
            <p className="text-[12.5px] text-muted">No rule triggered; standard evidence collection pathway.</p>
          ) : (
            <ul className="space-y-2">
              {triggered.map((e) => (
                <li key={e.id} className="rounded-md border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11.5px] font-semibold text-ink">{e.ruleId}</span>
                    <span className="text-[11px] text-muted">v{e.ruleVersion}</span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">{e.explanation}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(e.sourceFields).map(([k, v]) => (
                      <span key={k} className="rounded bg-subtle px-1.5 py-px font-mono text-[10.5px] text-muted">
                        {k}={v === null || v === undefined ? "null" : Array.isArray(v) ? v.join("|") : String(v).slice(0, 60)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!compact && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted hover:text-ink">
              {other.length} rules evaluated without triggering · {d.triageHistory.length} triage run(s) on record
            </summary>
            <ul className="mt-2 space-y-1">
              {other.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-[86px] shrink-0 font-mono text-[11px] text-muted">{e.ruleId}</span>
                  <span className="text-ink-2">{e.explanation}</span>
                </li>
              ))}
            </ul>
            {d.triageHistory.length > 1 && (
              <ul className="mt-3 space-y-0.5 border-t border-line pt-2">
                {d.triageHistory.map((h) => (
                  <li key={h.id} className="flex gap-3 text-[11.5px] text-muted">
                    <span className="tabular w-[150px]">{fmtDate(h.computedAt, { time: true })}</span>
                    <span>{CLASSIFICATION_META[h.classification as TriageClassification]?.label}</span>
                    <span>{h.priority}</span>
                    <span>rule set v{h.ruleSetVersion ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        <p className="text-[11px] text-muted">{PRIORITY_DISCLAIMER}</p>
      </CardBody>
    </Card>
  );
}

export function ChecklistList({ d, renderActions }: { d: CaseDetail; renderActions?: (r: CaseDetail["requirements"][number]) => React.ReactNode }) {
  const reqs = d.requirements.filter((r) => r.required || r.status !== "missing");
  if (!reqs.length) return <p className="text-[12.5px] text-muted">No evidence requirements under the active rule set.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {reqs.map((r) => {
        const items = d.items.filter((i) => r.satisfiedBy.includes(i.id));
        return (
          <li key={r.id} className="px-3 py-2.5" data-testid={`req-${r.code}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-medium text-ink">{r.label}</span>
              {!r.required && <Tag>Optional</Tag>}
              {r.minCount > 1 && <span className="text-[11px] text-muted">min. {r.minCount}</span>}
              <span className="ml-auto">
                <RequirementBadge status={r.status} />
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted">{r.description}</p>
            {items.length > 0 && <p className="mt-1 text-[11.5px] text-ink-2">Satisfied by: {items.map((i) => i.originalFilename).join(", ")}</p>}
            {r.reviewNote && <p className="mt-1 text-[11.5px] text-ink-2">Reviewer: {r.reviewNote}</p>}
            {renderActions?.(r)}
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceList({ d, selectedId, hrefFor }: { d: CaseDetail; selectedId?: string; hrefFor?: (id: string) => string }) {
  if (!d.items.length) return <p className="text-[12.5px] text-muted">No evidence submitted.</p>;
  return (
    <ul className="space-y-1.5">
      {d.items.map((i) => {
        const Icon = i.mimeType.startsWith("image/") ? ImageIcon : FileText;
        const body = (
          <>
            <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-ink">{i.originalFilename}</div>
              <div className="text-[11px] text-muted">
                {EVIDENCE_TYPE_LABELS[(i.classifiedType ?? "unknown") as EvidenceType] ?? i.classifiedType}
                {i.classificationConfidence && i.classificationConfidence !== "none" ? ` · ${i.classificationConfidence} confidence` : ""} · {(i.sizeBytes / 1024).toFixed(0)} KB · {i.uploadedByType}
              </div>
              <div className="font-mono text-[10px] text-faint">sha256 {i.sha256.slice(0, 16)}…</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {i.processingStatus !== "processed" && <Badge tone={i.processingStatus === "failed" ? "critical" : "info"}>{i.processingStatus}</Badge>}
              {i.reviewStatus !== "pending" && <Badge tone={i.reviewStatus === "rejected" ? "critical" : "review"}>{i.reviewStatus}</Badge>}
            </div>
          </>
        );
        return (
          <li key={i.id}>
            {hrefFor ? (
              <a href={hrefFor(i.id)} className={cn("flex items-start gap-2.5 rounded-md border px-2.5 py-2 hover:bg-subtle/60", selectedId === i.id ? "border-brand bg-brand-soft/40" : "border-line")}>
                {body}
              </a>
            ) : (
              <a href={`/api/evidence/${i.id}`} target="_blank" rel="noopener" className="flex items-start gap-2.5 rounded-md border border-line px-2.5 py-2 hover:bg-subtle/60">
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function FindingsList({ d, itemId, renderActions }: { d: CaseDetail; itemId?: string; renderActions?: (f: CaseDetail["findings"][number]) => React.ReactNode }) {
  const fs = d.findings.filter((f) => (itemId ? f.evidenceItemId === itemId : f.scope === "case"));
  if (!fs.length) return <p className="text-[12.5px] text-muted">{itemId ? "No findings for this document." : "No cross-document findings."}</p>;
  const order = { conflict: 0, untrusted_instruction: 1, warning: 2, unknown: 3, check: 4, fact: 5 } as const;
  return (
    <ul className="space-y-1.5">
      {[...fs]
        .sort((a, b) => order[a.kind] - order[b.kind])
        .map((f) => {
          const ref = f.sourceRefs.find((r) => r.quote);
          const icon =
            f.kind === "conflict" || f.kind === "untrusted_instruction" ? (
              <CircleAlert className={cn("size-3.5", f.status === "resolved" ? "text-faint" : "text-tone-critical-fg")} />
            ) : f.kind === "warning" || f.kind === "unknown" ? (
              <TriangleAlert className="size-3.5 text-tone-attention-fg" />
            ) : (
              <Check className="size-3.5 text-muted" />
            );
          return (
            <li key={f.id} className={cn("rounded-md border px-2.5 py-2", f.kind === "conflict" && f.status === "open" ? "border-[#fecdca] bg-tone-critical-bg/30" : "border-line")} data-testid={`finding-${f.kind}`}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{f.kind.replace("_", " ")}</span>
                    <ProvenanceBadge provenance={f.provenance} />
                    {f.status === "resolved" && <Badge tone="neutral">Resolved</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink">{f.kind === "fact" ? `${f.field?.replace(/_/g, " ")}: ${f.value}` : f.message}</p>
                  {ref?.quote && f.kind === "fact" && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted">
                      “{ref.quote}” · p.{ref.page} · chars {ref.start}–{ref.end}
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-[10px] text-faint">{f.method}</p>
                  {f.resolutionNote && <p className="mt-1 text-[11.5px] text-ink-2">Resolution: {f.resolutionNote}</p>}
                  {renderActions?.(f)}
                </div>
              </div>
            </li>
          );
        })}
    </ul>
  );
}

export function ApplicantStatement({ d }: { d: CaseDetail }) {
  const sub = d.submissions.find((s) => s.submittedByType === "homeowner" && s.workDescription);
  if (!sub) return <p className="text-[12.5px] text-muted">No applicant statement yet.</p>;
  return (
    <div className="rounded-md border border-dashed border-[#b54708]/40 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ProvenanceBadge provenance="applicant_claim" />
        <span className="text-[11.5px] text-muted">
          {sub.submitterName} ({sub.relationship}) · {sub.submittedAt ? `submitted ${fmtDate(sub.submittedAt, { time: true })}` : "draft"}
        </span>
      </div>
      <DL
        stacked
        items={[
          ["Work completed", sub.workDescription],
          ["Completion date", sub.completionDateClaimed ? fmtDate(sub.completionDateClaimed) : <span className="text-muted">Not stated</span>],
          ["Contractor", [sub.contractorNameClaimed, sub.contractorLicenseClaimed].filter(Boolean).join(" · ") || null],
          ["Notes", sub.notes],
        ]}
      />
    </div>
  );
}

export function CommsTimeline({ d }: { d: CaseDetail }) {
  if (!d.comms.length) return <p className="text-[12.5px] text-muted">No communications.</p>;
  return (
    <ul className="space-y-2">
      {d.comms.map(({ comm: c, createdByName }) => (
        <li key={c.id} className="rounded-md border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-medium text-ink">{c.purpose.replace(/_/g, " ")}</span>
            <Tag>{c.channel}</Tag>
            <Badge tone={c.status === "draft" ? "attention" : c.status === "cancelled" || c.status === "failed" ? "neutral" : "info"}>{c.status === "sent_simulated" ? "Sent (simulated)" : c.status}</Badge>
            {c.responseStatus !== "none" && <Badge tone="review">Response: {c.responseStatus}</Badge>}
            <span className="ml-auto text-[11.5px] text-muted">{fmtDate(c.sentAt ?? c.createdAt, { time: true })}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            {c.recipientDisplay ? `To ${c.recipientDisplay}` : ""}
            {createdByName ? ` · drafted by ${createdByName}` : ""}
            {c.adapter ? ` · adapter: ${c.adapter} (no real message sent)` : ""}
            {c.followUpDueAt && c.responseStatus === "none" ? ` · follow-up due ${fmtDate(c.followUpDueAt)}` : ""}
          </div>
          {c.purpose !== "verification_code" && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11.5px] text-muted hover:text-ink">{c.subject ?? "Message"}</summary>
              <pre className="mt-1.5 rounded bg-subtle px-2.5 py-2 font-sans text-[12px] whitespace-pre-wrap text-ink-2">{c.body}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AuditTimeline({ d, limit = 12 }: { d: CaseDetail; limit?: number }) {
  const head = d.audit.slice(0, limit);
  const rest = d.audit.slice(limit);
  return (
    <>
      <AuditList events={head} />
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">Show {rest.length} earlier event(s)</summary>
          <div className="mt-3">
            <AuditList events={rest} />
          </div>
        </details>
      )}
    </>
  );
}

function AuditList({ events }: { events: CaseDetail["audit"] }) {
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span aria-hidden className={cn("absolute top-1.5 -left-[20.5px] size-2 rounded-full ring-2 ring-surface", e.action === "case.transition" ? "bg-brand" : "bg-line-strong")} />
          <div className="text-[12.5px] text-ink">{e.summary}</div>
          <div className="text-[11px] text-muted">
            {fmtDate(e.occurredAt, { time: true })} · {e.actorName}
            {e.actorRole && e.actorRole !== "system" ? ` (${e.actorRole})` : ""} · <span className="font-mono">{e.action}</span>
            {e.metadata && typeof e.metadata === "object" && "reason" in e.metadata && e.metadata.reason ? <span className="text-ink-2"> · “{String(e.metadata.reason)}”</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DecisionsList({ d }: { d: CaseDetail }) {
  if (!d.decisions.length) return <p className="text-[12.5px] text-muted">No review decisions recorded.</p>;
  return (
    <ul className="space-y-2">
      {d.decisions.map((x) => (
        <li key={x.id} className="text-[12.5px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-ink">{x.decisionType.replace(/_/g, " ")}</span>
            {x.overrodeSuggestion && <Badge tone="attention">Overrode suggestion</Badge>}
            {x.signature && <Badge tone="review">Signed</Badge>}
          </div>
          <div className="text-ink-2">{x.summary}</div>
          {x.reason && <div className="text-[11.5px] text-muted">Reason: {x.reason}</div>}
          <div className="text-[11px] text-faint">
            {x.actorName} ({x.actorRole}) · {fmtDate(x.createdAt, { time: true })}
            {x.ruleSetVersion ? ` · rule set v${x.ruleSetVersion}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
