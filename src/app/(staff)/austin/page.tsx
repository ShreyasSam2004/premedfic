import { ExternalLink } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import report from "@/data/austin-report.json";
import { BarList, ColumnChart } from "@/components/charts/charts";
import { buttonClass, Callout, Card, CardBody, CardHeader, DL, PageHeader, SectionLabel } from "@/components/ui/primitives";

export const metadata = { title: "Austin analysis" };

// Public data, not tenant data: the numbers come from the committed snapshot
// written by `npm run analyze:austin` (aggregates only, no addresses).

const n = (v: number) => v.toLocaleString("en-US");
const share = (part: number, whole: number) => (part > 0 && part / whole < 0.0005 ? "<0.1%" : `${((part / whole) * 100).toFixed(1)}%`);

type ClassKey = keyof typeof report.classification;
const ROUTING: { key: ClassKey; label: string; color: string }[] = [
  { key: "EVIDENCE_COLLECTION", label: "Remote-eligible: documents, staff review, official decides", color: "var(--color-viz)" },
  { key: "SPECIALIST_REVIEW", label: "Specialist review with a site inspection", color: "var(--color-tone-neutral-dot)" },
  { key: "STAFF_REVIEW", label: "Staff review: no rule covers this work yet", color: "var(--color-line-strong)" },
  { key: "DATA_RECONCILIATION", label: "Data cleanup: no property address", color: "var(--color-ink-2)" },
  { key: "MONITOR_ACTIVE", label: "Not yet expired: expiration date is in the future", color: "var(--color-muted)" },
];

export default async function AustinAnalysisPage() {
  await requireStaffSession();
  const r = report;
  const total = r.totals.expiredResidential;
  const remote = r.headline.remoteEligible;
  const snapshot = new Date(r.dataset.fetchedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

  const routing = ROUTING.map((s) => ({ ...s, count: r.classification[s.key]?.count ?? 0 }));
  const specialist = Object.entries(r.specialistReview).reduce<Record<string, number>>((acc, [k, v]) => {
    const discipline = k.split(" — ")[0];
    acc[discipline] = (acc[discipline] ?? 0) + v;
    return acc;
  }, {});
  const specialistLine = Object.entries(specialist)
    .sort((a, b) => b[1] - a[1])
    .map(([d, v]) => `${d === "building" ? "additions" : d} ${n(v)}`)
    .join(" · ");

  const byAge = r.remoteEligibleByIssueYear as Record<string, number>;
  const recent = (byAge["2010-2019"] ?? 0) + (byAge["2020 or later"] ?? 0);
  const withHvac = remote + r.whatIf.likeForLikeHvacChangeOuts;
  const unmodeled = Object.entries(r.largestUnmodeledWorkTypes).slice(0, 9);
  const legacy = r.legacyRecords;
  const related = r.relatedRecordSignals.eitherSignal;

  const findings: { label: string; value: string; detail: string }[] = [
    {
      label: "Carry a “completed” date that isn’t a final inspection",
      value: share(legacy.completedDate, total),
      detail: `${n(legacy.completedDate)} permits. ${share(legacy.completedDatePre2007, legacy.completedDate)} of those dates are before 2007 and usually match the expiration date, so PremedFix does not count them as finals.`,
    },
    {
      label: "Issued before 2007",
      value: share(legacy.issuedBefore2007, total),
      detail: `${n(legacy.issuedBefore2007)} permits. ${n(legacy.statusBulk20070606)} last changed status on one day, June 6, 2007, which looks like a bulk update in the city’s system.`,
    },
    {
      label: "Have a related permit that passed final",
      value: share(related, total),
      detail: `${n(r.parentPermitSignal.parentFinal)} sit under a parent permit with status Final, and ${n(r.repermitSignal.expiredCitedByFinaledRepermit)} are named in a later finaled permit as rolled in. Leads for staff to confirm, not closures.`,
    },
    {
      label: "Have a Travis County parcel ID",
      value: `${r.totals.withParcelIdPct}%`,
      detail: `${n(r.totals.withParcelId)} permits. The public data has no owner contact details, so staff look up the owner of record before any outreach.`,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Public data · City of Austin, Texas"
        title="Austin’s expired residential permits"
        description={`PremedFix’s import cleanup, duplicate check, and triage engine, run unmodified on every expired residential permit in Austin’s open data. Snapshot of ${snapshot}.`}
        actions={
          <a href={r.dataset.page} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            Austin open data
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        }
      />

      <Card>
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] [&>*]:min-w-0">
          <div>
            <div className="text-[12px] font-medium text-muted">Remote-eligible under PremedFix’s default rules</div>
            <div className="tabular mt-1 text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink">{r.headline.remoteEligiblePct}%</div>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
              Of Austin’s <strong className="text-ink">{n(total)}</strong> expired residential permits, <strong className="text-ink">{n(remote)}</strong> are single-scope water heater, window, roof, or
              fence jobs that PremedFix routes to document-based resolution. The owner uploads proof, staff review it, and an authorized official decides. No rule requires a site visit,
              though the official can still order one.
            </p>
            <p className="mt-2 max-w-xl text-[12.5px] text-muted">
              Cautious lower bound: <strong className="text-ink-2">{n(r.headline.conservativeFloor)}</strong> ({r.headline.conservativeFloorPct}%), leaving out water heaters whose description doesn’t say
              electric. Austin’s records don’t note fuel type, and gas-fired units warrant more caution.
            </p>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted">Where all {n(total)} permits are routed</div>
            <div className="mt-2 flex h-7 overflow-hidden rounded-md" role="img" aria-label={routing.map((s) => `${s.label}: ${n(s.count)}`).join("; ")}>
              {routing
                .filter((s) => s.count / total >= 0.005)
                .map((s) => (
                  <div key={s.key} className="h-full border-r-2 border-surface last:border-r-0" style={{ width: share(s.count, total), background: s.color }} title={`${s.label}: ${n(s.count)} (${share(s.count, total)})`} />
                ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {routing.map((s) => (
                <li key={s.key} className="grid grid-cols-[10px_minmax(0,1fr)_auto_52px] items-center gap-2.5 text-[12.5px]">
                  <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-ink-2">{s.label}</span>
                  <span className="tabular text-right font-medium text-ink">{n(s.count)}</span>
                  <span className="tabular text-right text-muted">{share(s.count, total)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11.5px] text-muted">Specialist review by discipline: {specialistLine}. Description text can only escalate a permit, never clear one.</p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader title="What counts as remote-eligible" description={`${share(recent, remote)} were issued in 2010 or later, so owners are more likely to still have invoices.`} />
          <CardBody>
            <BarList rows={Object.entries(r.remoteEligibleByCategory).map(([label, value]) => ({ label, value }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="The biggest policy lever" description="Like-for-like HVAC replacements are the largest kind of work with no rule yet." />
          <CardBody className="space-y-3">
            <BarList
              max={Math.ceil((withHvac / total) * 100)}
              rows={[
                { label: "Default rules today", value: (remote / total) * 100, display: share(remote, total) },
                { label: "Adding HVAC change-outs", value: (withHvac / total) * 100, display: share(withHvac, total) },
              ]}
            />
            <p className="text-[12.5px] text-ink-2">
              The rule editor’s impact preview, run on Austin’s data: one standard-concern HVAC rule moves {n(r.whatIf.likeForLikeHvacChangeOuts)} single-scope HVAC replacements to document-based
              review. Furnaces, boilers, and gas work stay with specialists. That decision belongs to Austin’s building official, and PremedFix does not apply it.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Expired permits by year issued" description={`${share(legacy.issuedBefore2007, total)} of the backlog was issued before 2007.`} />
          <CardBody>
            <ColumnChart data={r.byIssueYear.map((d) => ({ x: String(d.year), y: d.expired }))} xKind="year" valueLabel="expired permits" ariaLabel="Expired residential permits by year issued" height={268} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Work with no rule yet" description="These route to staff review until the city writes a rule for them. Austin’s own permit types." />
          <CardBody>
            <BarList rows={unmodeled.map(([label, value]) => ({ label: label.replace(" — ", ": "), value }))} />
          </CardBody>
        </Card>
      </div>

      <SectionLabel className="mt-6">What the data itself shows</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {findings.map((f) => (
          <div key={f.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]">
            <div className="text-[12px] font-medium text-muted">{f.label}</div>
            <div className="tabular mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{f.value}</div>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{f.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader title="What running on real data changed in PremedFix" />
          <CardBody className="space-y-3 text-[12.5px] text-ink-2">
            <div>
              <div className="font-semibold text-ink">Duplicate detection</div>
              <p className="mt-0.5">
                The first run flagged 25,280 permits (19.8%) as possible duplicates. Austin issues separate building, electrical, mechanical, and plumbing permits for one project, and new subdivisions share
                parcel IDs. Within one system, a different permit number now means a different permit. After the fix, {n((r.dataReconciliationReasons as Record<string, number>)["R-DATA-002: Possible duplicate record"] ?? 0)} are flagged.
              </p>
            </div>
            <div>
              <div className="font-semibold text-ink">Category mapping for Austin</div>
              <p className="mt-0.5">
                Austin’s data has no work category, so PremedFix derives one from the permit type and description, and only errs toward caution. A hand check of 120 permits found 4 that were broader than
                their category, such as a flat-to-pitched roof conversion. The filter was tightened, and a second sample of 120 matched in every case.
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Method and limits" />
          <CardBody className="space-y-3">
            <DL
              items={[
                ["Source", <a key="src" href={r.dataset.page} target="_blank" rel="noreferrer" className="text-brand hover:underline">{`${r.dataset.publisher}, ${r.dataset.name}`}</a>],
                ["Snapshot", snapshot],
                ["Scope", "Status Expired or Expired - License, class Residential"],
                ["Rules", "PremedFix defaults, not Austin policy; unverified for Austin"],
                ["Engine", r.engine],
                ["Re-run", <code key="cmd" className="rounded bg-subtle px-1 py-px text-[11.5px]">npm run analyze:austin</code>],
              ]}
            />
            <Callout tone="neutral">
              Remote-eligible means the rules call for documents rather than a site visit. It is not a finding that the work is safe, and every permit still needs an authorized official’s decision.
            </Callout>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
