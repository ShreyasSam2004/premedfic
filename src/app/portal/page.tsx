import { CircleCheck, Circle, Clock, FileText, Image as ImageIcon } from "lucide-react";
import { getPortalContext } from "@/server/auth/session";
import { getPortalView } from "@/server/portal/service";
import { db } from "@/server/db/client";
import { evidenceSubmissions } from "@/server/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { fmtDate } from "@/components/ui/primitives";
import { StatementForm, SubmitBox, UploadBox } from "./portal-forms";
import { portalSignOutAction } from "./actions";

export const metadata = { title: "Your permit" };

const REQ_PLAIN: Record<string, { label: string; done: boolean }> = {
  missing: { label: "Still needed", done: false },
  provided: { label: "Received", done: true },
  accepted: { label: "Accepted", done: true },
  rejected: { label: "Please provide a replacement", done: false },
  waived: { label: "Not needed", done: true },
};

export default async function PortalHome() {
  const ctx = await getPortalContext();
  if (!ctx || ctx.actor.type !== "homeowner") {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-[19px] font-semibold">Please use your secure link</h1>
        <p className="mt-2 text-ink-2">For your privacy, this page can only be opened from the link in the message the building department sent you. Sessions end after two hours.</p>
      </div>
    );
  }
  const v = await getPortalView(ctx);
  // Pre-fill the statement from the latest saved one, so follow-up submissions don't start blank.
  const [prior] = await db()
    .select()
    .from(evidenceSubmissions)
    .where(and(eq(evidenceSubmissions.caseId, ctx.actor.caseId), isNotNull(evidenceSubmissions.workDescription)))
    .orderBy(desc(evidenceSubmissions.createdAt))
    .limit(1);
  const draftItems = v.items.filter((i) => i.inCurrentDraft);
  const hasStatement = Boolean(prior?.workDescription);
  const processing = draftItems.some((i) => i.processingStatus !== "processed");
  const ready = v.canSubmit && draftItems.length > 0 && hasStatement && !processing;
  const reason = !v.canSubmit
    ? null
    : draftItems.length === 0
      ? "Upload at least one photo or document first."
      : !hasStatement
        ? "Tell us about the work (below) and save your answers first."
        : processing
          ? "Your files are still being processed."
          : null;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="text-[13px] font-medium text-muted">Permit {v.permitNumber}</div>
        <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em]" data-testid="portal-status">
          {v.plainStatus.title}
        </h1>
        <p className="mt-1 text-ink-2">{v.plainStatus.detail}</p>
        <dl className="mt-4 grid gap-2 text-[14px]">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted">Property</dt>
            <dd>{v.address ?? "—"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted">Work</dt>
            <dd>
              {v.categoryLabel}
              {v.workDescription ? ` — ${v.workDescription}` : ""}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted">Permit dates</dt>
            <dd>
              Issued {fmtDate(v.issuedAt)} · expired {fmtDate(v.expiresAt)}
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg bg-subtle px-3 py-2.5 text-[13.5px] text-ink-2">
          This is not a finding that anything is wrong. Our records show the permit may still need administrative resolution, often because a final step was never recorded. Staff review everything you provide; nothing here closes a permit automatically.
        </p>
      </section>

      {v.requests.length > 0 && (
        <section className="rounded-xl border border-[#fedf89] bg-tone-attention-bg/50 p-5">
          <h2 className="text-[16px] font-semibold">Message from the reviewer</h2>
          {v.requests.map((r) => (
            <div key={r.id} className="mt-2">
              <div className="text-[12.5px] text-muted">{fmtDate(r.sentAt, { time: true })}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{r.body}</p>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-semibold">What we need</h2>
        <ul className="mt-3 space-y-3">
          {v.requirements.map((r) => {
            const p = REQ_PLAIN[r.status] ?? REQ_PLAIN.missing;
            return (
              <li key={r.code} className="flex gap-3">
                {p.done ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden />}
                <div>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-[13.5px] text-muted">{r.description}</div>
                  <div className={`mt-0.5 text-[13px] font-medium ${p.done ? "text-ink-2" : "text-tone-attention-fg"}`}>{p.label}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {v.canSubmit ? (
        <>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-[16px] font-semibold">1. Add photos and documents</h2>
            <div className="mt-3">
              <UploadBox representative={v.relationship === "representative"} />
            </div>
            {draftItems.length > 0 && (
              <ul className="mt-4 space-y-2" data-testid="portal-uploaded">
                {draftItems.map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5 text-[14px]">
                    {i.filename.toLowerCase().endsWith(".pdf") ? <FileText className="size-4 text-muted" /> : <ImageIcon className="size-4 text-muted" />}
                    <span className="flex-1 truncate">{i.filename}</span>
                    <span className="text-[13px] text-muted">{i.processingStatus === "processed" ? "Ready" : i.processingStatus === "failed" ? "Could not be read" : "Processing…"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-[16px] font-semibold">2. Tell us about the work</h2>
            <p className="mt-1 text-[13.5px] text-muted">Your own words are fine. We&rsquo;ll compare them with your documents.</p>
            <div className="mt-3">
              <StatementForm
                defaults={{
                  workDescription: prior?.workDescription ?? null,
                  completionDate: prior?.completionDateClaimed ?? null,
                  contractorName: prior?.contractorNameClaimed ?? null,
                  contractorLicense: prior?.contractorLicenseClaimed ?? null,
                  notes: prior?.notes ?? null,
                }}
              />
            </div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-[16px] font-semibold">3. Submit</h2>
            <SubmitBox ready={ready} reason={reason} />
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted" />
            <h2 className="text-[16px] font-semibold">Nothing more is needed right now</h2>
          </div>
          <p className="mt-1 text-ink-2">We&rsquo;ll contact you if the reviewer needs anything else.</p>
        </section>
      )}

      {v.items.filter((i) => !i.inCurrentDraft).length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-semibold">Already submitted</h2>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            {v.items
              .filter((i) => !i.inCurrentDraft)
              .map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="truncate">{i.filename}</span>
                  <span className="text-muted">{fmtDate(i.createdAt)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="flex items-center justify-between gap-3 text-[13.5px] text-ink-2">
        <span>
          Questions? {v.departmentName}
          {v.departmentPhone ? ` · ${v.departmentPhone}` : ""}
          {v.departmentEmail ? ` · ${v.departmentEmail}` : ""}
        </span>
        <form action={portalSignOutAction}>
          <button type="submit" className="text-muted underline hover:text-ink">
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
