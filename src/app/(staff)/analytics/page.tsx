import { requireStaffSession } from "@/server/auth/session";
import { backlogSeries, getAnalytics } from "@/server/analytics/service";
import { CASE_STATES, STATE_META } from "@/domain/workflow";
import { BarList, ColumnChart, LineChart } from "@/components/charts/charts";
import { Callout, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { qs } from "@/components/app/filters";

export const metadata = { title: "Analytics" };

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
const hrs = (h: number | null) => (h === null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

export default async function AnalyticsPage() {
  const s = await requireStaffSession();
  const [a, series] = await Promise.all([getAnalytics(s.org.id), backlogSeries(s.org.id, { months: 18 })]);
  const m = a.measured;
  const stages = CASE_STATES.filter((st) => a.counts[st] > 0 || st === "INSPECTION_REQUIRED").map((st) => ({ label: STATE_META[st].label, value: a.counts[st], href: qs("/permits", { status: st }) }));
  const tiles: [string, string, string][] = [
    ["Avg. time to next staff action", hrs(m.avgHoursToNextHumanAction), `Mean gap before each staff-performed transition (n=${m.nextActionSample})`],
    ["Median time to verified resolution", m.medianDaysToVerifiedResolution === null ? "—" : `${m.medianDaysToVerifiedResolution.toFixed(0)} days`, `Case opened → officially closed (n=${m.resolutionSample})`],
    ["Evidence request rate", pct(m.evidenceRequestRate), `Cases with an information request ÷ cases with submitted evidence (n=${m.evidenceRequestSample})`],
    ["Reopened case rate", pct(m.reopenRate), `Reopened ÷ cases that reached a confirmed outcome (n=${m.reopenSample})`],
    ["Reviewer override rate", pct(m.overrideRate), `Review actions that differed from the system suggestion (n=${m.overrideSample})`],
    ["Cases triaged", String(m.triagedCases), `${m.triageRuns} deterministic triage runs recorded`],
  ];
  return (
    <>
      <PageHeader title="Analytics" description="Operational outcomes measured from the case record. Estimates are shown separately with their assumptions." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {tiles.map(([label, value, basis]) => (
          <div key={label} className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
            <div className="text-[12px] font-medium text-muted">{label}</div>
            <div className="tabular mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
            <div className="mt-1 text-[11px] leading-snug text-muted">
              <span className="mr-1 rounded bg-subtle px-1 py-px text-[10px] font-semibold tracking-wide uppercase">Measured</span>
              {basis}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Backlog over time" description="Expired permits without a recorded final or confirmed resolution at each month end." />
          <CardBody>
            <LineChart data={series.map((d) => ({ x: d.monthEnd, y: d.backlog }))} valueLabel="unresolved expired permits" ariaLabel="Backlog over time" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Confirmed resolutions per month" />
          <CardBody>
            <ColumnChart data={series.map((d) => ({ x: d.monthEnd, y: d.resolved }))} valueLabel="confirmed resolutions" ariaLabel="Confirmed resolutions per month" height={200} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Cases by workflow stage" description="Select a stage to see its cases." />
          <CardBody>
            <BarList rows={stages} />
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Awaiting homeowner action" description="Time since the case last moved, for cases waiting on the owner." />
            <CardBody>
              <BarList rows={["Under 14 days", "14–30 days", "Over 30 days"].map((b) => ({ label: b, value: m.awaitingAging.find((x) => x.bucket === b)?.n ?? 0, href: qs("/permits", { status: "awaiting_owner", sort: "updated", dir: "asc" }) }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Reviewer workload" description="Open review-stage cases per assigned reviewer or specialist." />
            <CardBody>
              <BarList
                rows={[
                  ...m.workload.map((w) => ({ label: w.name, value: w.n, href: qs("/permits", { assigned: w.userId, status: "open" }) })),
                  { label: "Unassigned", value: m.unassignedReview, href: qs("/permits", { assigned: "unassigned", status: "review" }) },
                ]}
              />
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Time in each state" description="Mean time a case spent in a state before its next transition (measured from the transition log)." />
          <Table>
            <thead>
              <tr>
                <Th>State</Th>
                <Th className="text-right">Transitions</Th>
                <Th className="text-right">Mean time in state</Th>
              </tr>
            </thead>
            <tbody>
              {m.timeInState
                .sort((x, y) => CASE_STATES.indexOf(x.state) - CASE_STATES.indexOf(y.state))
                .map((r) => (
                  <tr key={r.state}>
                    <Td>{STATE_META[r.state].label}</Td>
                    <Td className="tabular text-right">{r.n}</Td>
                    <Td className="tabular text-right">{hrs(r.avgHours)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Estimated administrative time saved" description="An estimate, not a measurement." />
          <CardBody className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[26px] font-semibold">{a.estimates.researchHoursAvoided.toFixed(0)} hours</span>
              <span className="rounded bg-tone-attention-bg px-1.5 py-px text-[10.5px] font-semibold tracking-wide text-tone-attention-fg uppercase">Estimate</span>
            </div>
            <p className="text-[12.5px] text-ink-2">{a.estimates.basis}</p>
            <Callout tone="neutral">Validate this assumption during a pilot with time studies before using it in any report. Change it under Settings.</Callout>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
