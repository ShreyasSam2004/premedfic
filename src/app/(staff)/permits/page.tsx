import { Search, Upload } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { listCases, listJurisdictions, listStaff } from "@/server/cases/queries";
import { Card, EmptyState, Input, LinkButton, PageHeader } from "@/components/ui/primitives";
import { FilterBar } from "@/components/app/filters";
import { CaseTable } from "@/components/app/case-table";
import { Pagination } from "@/components/app/pagination";
import { ROLE_LABELS } from "@/domain/roles";

export const metadata = { title: "Permits" };

export default async function PermitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaffSession();
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const [{ rows, total, pageSize }, jurisdictions, staff] = await Promise.all([
    listCases(s.org.id, { ...sp, page, dir: sp.dir === "asc" ? "asc" : "desc", pageSize: 25 }, s.user.id),
    listJurisdictions(s.org.id),
    listStaff(s.org.id),
  ]);
  const queueLabel: Record<string, string> = {
    unresolved: "Showing unresolved permits (open cases, excluding active permits).",
    expired: "Showing open cases whose permit has expired.",
    manual_outreach: "Showing cases needing manual outreach research.",
  };
  return (
    <>
      <PageHeader
        title="Permits"
        description="Every imported permit record and its resolution case. Search, filter, and sort; select rows for bulk assignment or re-triage."
        actions={
          hasPermission(s.ctx, "permits:import") && (
            <LinkButton href="/permits/import" variant="primary">
              <Upload className="size-3.5" /> Import permits
            </LinkButton>
          )
        }
      />
      <Card>
        <div className="border-b border-line px-3 py-3">
          <FilterBar
            action="/permits"
            values={sp}
            show={["jurisdictionId", "category", "age", "status", "priority", "evidence", "assigned", "classification"]}
            jurisdictions={jurisdictions}
            staff={staff}
            extra={
              <>
              {sp.queue && <input type="hidden" name="queue" value={sp.queue} />}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Search</span>
                <span className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
                  <Input name="q" defaultValue={sp.q ?? ""} placeholder="Permit, address, parcel, contractor" className="h-8 w-[260px] pl-8 text-[12.5px]" />
                </span>
              </label>
              </>
            }
          />
          {sp.queue && queueLabel[sp.queue] && <p className="mt-2 text-[12px] text-muted">{queueLabel[sp.queue]}</p>}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="No permits match these filters"
            description={total === 0 && !Object.keys(sp).length ? "Import a permit export to get started." : "Try removing a filter."}
            action={<LinkButton href="/permits">Clear filters</LinkButton>}
          />
        ) : (
          <CaseTable
            rows={rows}
            staff={staff.map((m) => ({ id: m.id, name: m.name, role: ROLE_LABELS[m.role] }))}
            canBulk={hasPermission(s.ctx, "cases:assign")}
            canTriage={hasPermission(s.ctx, "cases:triage")}
          />
        )}
        <Pagination base="/permits" params={sp} page={page} pageSize={pageSize} total={total} />
      </Card>
    </>
  );
}
