import Link from "next/link";
import { ArrowUpRight, Upload } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { backlogSeries, getOverview } from "@/server/analytics/service";
import { listCases, listJurisdictions, listStaff, type CaseFilters } from "@/server/cases/queries";
import { Card, CardBody, CardHeader, cn, LinkButton, PageHeader, relTime } from "@/components/ui/primitives";
import { ColumnChart, LineChart } from "@/components/charts/charts";
import { FilterBar, qs } from "@/components/app/filters";
import { PriorityBadge, StatusPill } from "@/components/app/badges";
import { PRIORITY_DISCLAIMER } from "@/domain/triage";

export const metadata = { title: "Overview" };

type SP = Promise<Record<string, string | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const s = await requireStaffSession();
  const sp = await searchParams;
  const f: CaseFilters = { jurisdictionId: sp.jurisdictionId, category: sp.category, priority: sp.priority, assigned: sp.assigned };
  const [{ tiles }, series, jurisdictions, staff] = await Promise.all([
    getOverview(s.org.id, f, s.user.id),
    backlogSeries(s.org.id, { jurisdictionId: f.jurisdictionId, category: f.category }),
    listJurisdictions(s.org.id),
    listStaff(s.org.id),
  ]);
  const queue = (extra: CaseFilters) => listCases(s.org.id, { ...f, ...extra, pageSize: 5, sort: "priority" }, s.user.id);
  const [recon, verify, approvals, review, ready, pending] = await Promise.all([
    queue({ status: "NEEDS_DATA_RECONCILIATION" }),
    queue({ status: "FINALIZATION_VERIFICATION" }),
    queue({ status: "AWAITING_CONTACT_APPROVAL" }),
    queue({ status: "evidence_review" }),
    queue({ status: "READY_FOR_AUTHORIZED_DISPOSITION" }),
    queue({ status: "DISPOSITION_PENDING_CONFIRMATION" }),
  ]);
  const base = { jurisdictionId: f.jurisdictionId, category: f.category, priority: f.priority, assigned: f.assigned };
  const link = (extra: Record<string, string>) => qs("/permits", { ...base, ...extra });
  const first = series[0]?.backlog ?? 0;
  const last = series[series.length - 1]?.backlog ?? 0;

  const tileRows: { label: string; value: string | number; sub?: string; href?: string; emphasis?: boolean }[] = [
    { label: "Unresolved permits", value: tiles.unresolved, sub: `Not counted: ${tiles.monitorOpen} active, reported finals, already resolved`, href: link({ queue: "unresolved" }), emphasis: true },
    { label: "Finalization to verify", value: tiles.finalizationToVerify, sub: "A source reports Final; not yet confirmed by the permit system", href: link({ status: "verification" }) },
    { label: "Already resolved", value: tiles.alreadyResolved, sub: "Final confirmed by the permit system; not a PremedFix closure", href: link({ status: "already_resolved" }) },
    { label: "Expired permits", value: tiles.expired, sub: "Open cases past expiration", href: link({ queue: "expired" }) },
    { label: "Requires staff action", value: tiles.needsAttention, sub: "Reconciliation, triaged, notice approval", href: "/cases?tab=intake" },
    { label: "Awaiting homeowner", value: tiles.awaitingHomeowner, sub: "Contacted, verifying, or info requested", href: link({ status: "awaiting_owner" }) },
    { label: "Evidence awaiting review", value: tiles.evidenceAwaitingReview, sub: "Received or under staff review", href: "/review" },
    { label: "Specialist escalations", value: tiles.specialistOpen, sub: "Safety-sensitive work; no automated clearance", href: link({ classification: "SPECIALIST_REVIEW", status: "open" }) },
    { label: "Inspection required", value: tiles.inspectionRequired, sub: "Awaiting a recorded site inspection", href: link({ status: "INSPECTION_REQUIRED" }) },
    { label: "Ready for authorized disposition", value: tiles.readyForDisposition, sub: `${tiles.pendingConfirmation} awaiting source confirmation`, href: link({ status: "disposition" }) },
    { label: "Confirmed resolutions", value: tiles.confirmedResolutions, sub: `${tiles.resolvedLast30} in the last 30 days`, href: link({ status: "resolved" }) },
    {
      label: "Avg. processing duration",
      value: tiles.avgProcessingDays === null ? "—" : `${tiles.avgProcessingDays.toFixed(0)} days`,
      sub: tiles.resolvedSample ? `Measured: case opened → confirmed outcome (n=${tiles.resolvedSample})` : "No resolved cases yet",
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Live operational state for ${s.org.name}. Every figure is computed from case records; select a figure to see the underlying cases.`}
        actions={
          <LinkButton href="/permits/import" variant="primary">
            <Upload className="size-3.5" /> Import permits
          </LinkButton>
        }
      />
      <div className="mb-5">
        <FilterBar action="/overview" values={sp} show={["jurisdictionId", "category", "priority", "assigned"]} jurisdictions={jurisdictions} staff={staff} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tileRows.map((t) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-2 text-[12px] font-medium text-muted">
                {t.label}
                {t.href && <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-ink-2" aria-hidden />}
              </div>
              <div className={cn("tabular mt-1.5 font-semibold tracking-[-0.02em] text-ink", t.emphasis ? "text-[30px] leading-9" : "text-[24px] leading-8")}>{t.value}</div>
              {t.sub && <div className="mt-1 text-[11.5px] leading-snug text-muted">{t.sub}</div>}
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="group rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">
              {inner}
            </Link>
          ) : (
            <div key={t.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
              {inner}
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="Expired-permit backlog"
            description="Expired permits without a confirmed resolution, at each month end. Reported finals awaiting verification and permits already finalized before PremedFix are not counted."
            actions={
              <span className={cn("tabular text-[12px] font-medium", last < first ? "text-ink-2" : "text-muted")}>
                {last - first <= 0 ? "−" : "+"}
                {Math.abs(last - first)} over 18 months
              </span>
            }
          />
          <CardBody>
            <LineChart data={series.map((d) => ({ x: d.monthEnd, y: d.backlog }))} valueLabel="unresolved expired permits" ariaLabel="Backlog of unresolved expired permits by month" />
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-muted hover:text-ink">View as table</summary>
              <TableView rows={series.map((d) => [d.monthEnd, d.backlog, d.resolved])} headers={["Month end", "Backlog", "Resolved in month"]} />
            </details>
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Confirmed resolutions per month" description="Cases confirmed by the system of record (closures and other official outcomes)." />
          <CardBody>
            <ColumnChart data={series.map((d) => ({ x: d.monthEnd, y: d.resolved }))} valueLabel="confirmed resolutions" ariaLabel="Confirmed resolutions per month" />
            <p className="mt-2 text-[11.5px] text-muted">Separate chart from the backlog because the two measures differ in scale.</p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <QueueCard title="Needs data reconciliation" description="Incomplete or possibly duplicated records" rows={recon.rows} total={recon.total} href={link({ status: "NEEDS_DATA_RECONCILIATION" })} />
        <QueueCard title="Finalization verification" description="A source reports Final. Check the permit system; no owner outreach." rows={verify.rows} total={verify.total} href={link({ status: "verification" })} />
        <QueueCard title="Notices awaiting approval" description="Drafted owner notices; nothing is sent until approved" rows={approvals.rows} total={approvals.total} href="/outreach" />
        <QueueCard title="Evidence awaiting review" description="Submitted evidence, organized for staff review" rows={review.rows} total={review.total} href="/review" reviewLinks />
        <QueueCard title="Ready for authorized disposition" description="Review complete. Nothing has been approved yet." rows={ready.rows} total={ready.total} href={link({ status: "READY_FOR_AUTHORIZED_DISPOSITION" })} reviewLinks />
        <QueueCard title="Awaiting source-of-record confirmation" description="Determination recorded and submitted; not yet officially closed" rows={pending.rows} total={pending.total} href={link({ status: "DISPOSITION_PENDING_CONFIRMATION" })} />
      </div>
      <p className="mt-5 text-[11.5px] text-muted">{PRIORITY_DISCLAIMER}</p>
    </>
  );
}

function QueueCard({
  title,
  description,
  rows,
  total,
  href,
  reviewLinks,
}: {
  title: string;
  description: string;
  rows: Awaited<ReturnType<typeof listCases>>["rows"];
  total: number;
  href: string;
  reviewLinks?: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title} <span className="tabular rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-ink-2">{total}</span>
          </span>
        }
        description={description}
        actions={
          <Link href={href} className="text-[12px] font-medium text-brand hover:underline">
            View all
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted">Nothing in this queue.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={reviewLinks ? `/review/${r.id}` : `/cases/${r.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-subtle/60">
                <PriorityBadge priority={r.priority} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px] font-medium">{r.permitNumber}</div>
                  <div className="truncate text-[11.5px] text-muted">{r.address ?? "No address on record"}</div>
                </div>
                <div className="hidden text-right sm:block">
                  <StatusPill state={r.status} short />
                  <div className="mt-0.5 text-[11px] text-faint">{relTime(r.lastTransitionAt)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TableView({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="tabular mt-2 w-full text-[12px]">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className="border-b border-line py-1 text-left font-medium text-muted">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className="border-b border-line py-1">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
