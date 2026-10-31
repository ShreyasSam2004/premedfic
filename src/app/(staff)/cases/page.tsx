import Link from "next/link";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { listCases, listStaff, STATUS_GROUPS } from "@/server/cases/queries";
import { statusCounts } from "@/server/analytics/service";
import { STATE_META, type CaseState } from "@/domain/workflow";
import { ROLE_LABELS } from "@/domain/roles";
import { Card, cn, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CaseTable } from "@/components/app/case-table";
import { Pagination } from "@/components/app/pagination";
import { qs } from "@/components/app/filters";

export const metadata = { title: "Cases" };

const TABS: { key: string; label: string; states: CaseState[] }[] = [
  { key: "intake", label: "Intake & triage", states: STATUS_GROUPS.intake },
  { key: "verification", label: "Finalization verification", states: STATUS_GROUPS.verification },
  { key: "outreach", label: "Outreach", states: ["AWAITING_CONTACT_APPROVAL", "OWNER_CONTACTED"] },
  { key: "evidence", label: "Evidence", states: ["AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED", "EVIDENCE_RECEIVED"] },
  { key: "review", label: "Staff review", states: ["UNDER_STAFF_REVIEW", "INSPECTION_REQUIRED"] },
  { key: "disposition", label: "Disposition", states: STATUS_GROUPS.disposition },
  { key: "resolved", label: "Resolved", states: ["OFFICIALLY_CLOSED", "OTHER_OFFICIAL_OUTCOME", "MERGED_DUPLICATE"] },
  { key: "already_resolved", label: "Already resolved", states: STATUS_GROUPS.already_resolved },
];

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaffSession();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const state = sp.state && tab.states.includes(sp.state as CaseState) ? sp.state : undefined;
  const page = Number(sp.page ?? 1) || 1;
  const { counts } = await statusCounts(s.org.id);
  const statusParam = state;
  const [{ rows, total, pageSize }, staff] = await Promise.all([
    statusParam
      ? listCases(s.org.id, { ...sp, status: statusParam, page, dir: sp.dir === "asc" ? "asc" : "desc" }, s.user.id)
      : listCasesForStates(s.org.id, tab.states, sp, page, s.user.id),
    listStaff(s.org.id),
  ]);
  return (
    <>
      <PageHeader title="Cases" description="Each permit is an organized, actionable case. Browse the workflow by phase; every case moves only through validated, audited transitions." />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => {
          const n = t.states.reduce((a, st) => a + counts[st], 0);
          return (
            <Link
              key={t.key}
              role="tab"
              aria-selected={t.key === tab.key}
              href={qs("/cases", { tab: t.key })}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium", t.key === tab.key ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-2 hover:bg-subtle")}
            >
              {t.label} <span className="tabular rounded-full bg-subtle px-1.5 text-[11px]">{n}</span>
            </Link>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href={qs("/cases", { tab: tab.key })} className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", !state ? "border-ink-2 bg-surface text-ink" : "border-line text-ink-2 hover:bg-subtle")}>
          All in phase
        </Link>
        {tab.states.map((st) => (
          <Link
            key={st}
            href={qs("/cases", { tab: tab.key, state: st })}
            className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", state === st ? "border-ink-2 bg-surface text-ink" : "border-line text-ink-2 hover:bg-subtle")}
          >
            {STATE_META[st].label} <span className="tabular text-muted">{counts[st]}</span>
          </Link>
        ))}
      </div>
      <Card>
        {rows.length ? (
          <CaseTable rows={rows} staff={staff.map((m) => ({ id: m.id, name: m.name, role: ROLE_LABELS[m.role] }))} canBulk={hasPermission(s.ctx, "cases:assign")} canTriage={hasPermission(s.ctx, "cases:triage")} />
        ) : (
          <EmptyState title="No cases in this phase" />
        )}
        <Pagination base="/cases" params={{ tab: tab.key, state }} page={page} pageSize={pageSize} total={total} />
      </Card>
    </>
  );
}

async function listCasesForStates(orgId: string, states: CaseState[], sp: Record<string, string | undefined>, page: number, userId: string) {
  // Phase tabs map to status groups; reuse the group key when one matches exactly.
  const group = Object.entries(STATUS_GROUPS).find(([, v]) => v.length === states.length && v.every((x) => states.includes(x)))?.[0];
  if (group) return listCases(orgId, { ...sp, status: group, page, dir: sp.dir === "asc" ? "asc" : "desc" }, userId);
  const results = await Promise.all(states.map((st) => listCases(orgId, { ...sp, status: st, page: 1, pageSize: 200 }, userId)));
  const all = results.flatMap((r) => r.rows).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  return { rows: all.slice((page - 1) * 25, page * 25), total: all.length, page, pageSize: 25 };
}
