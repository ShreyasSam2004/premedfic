import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { listCases, listStaff } from "@/server/cases/queries";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CaseTable } from "@/components/app/case-table";
import { ROLE_LABELS } from "@/domain/roles";
import { qs } from "@/components/app/filters";
import Link from "next/link";
import { cn } from "@/components/ui/primitives";

export const metadata = { title: "Evidence Review" };

const QUEUES = [
  { key: "evidence_review", label: "Evidence to review", status: "evidence_review" },
  { key: "inspection", label: "Inspection required", status: "INSPECTION_REQUIRED" },
  { key: "ready", label: "Ready for disposition", status: "READY_FOR_AUTHORIZED_DISPOSITION" },
  { key: "pending", label: "Awaiting confirmation", status: "DISPOSITION_PENDING_CONFIRMATION" },
  { key: "specialist", label: "Specialist escalations", classification: "SPECIALIST_REVIEW" },
];

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaffSession();
  const sp = await searchParams;
  const active = QUEUES.find((q) => q.key === sp.queue) ?? QUEUES[0];
  const mine = sp.mine === "1";
  const filters = { status: active.status ?? "open", classification: active.classification, assigned: mine ? "me" : undefined, sort: sp.sort ?? "priority", dir: (sp.dir === "asc" ? "asc" : "desc") as "asc" | "desc", pageSize: 100 };
  const [{ rows, total }, staff, counts] = await Promise.all([
    listCases(s.org.id, filters, s.user.id),
    listStaff(s.org.id),
    Promise.all(QUEUES.map((q) => listCases(s.org.id, { status: q.status ?? "open", classification: q.classification, assigned: mine ? "me" : undefined, pageSize: 5 }, s.user.id).then((r) => r.total))),
  ]);
  return (
    <>
      <PageHeader title="Evidence Review" description="Cases organized for human review. Open a case to review documents side by side with the permit record, applicant claims, and rule checks." />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {QUEUES.map((q, i) => (
          <Link
            key={q.key}
            href={qs("/review", { queue: q.key, mine: mine ? "1" : undefined })}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium", q.key === active.key ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-2 hover:bg-subtle")}
          >
            {q.label} <span className="tabular rounded-full bg-subtle px-1.5 text-[11px]">{counts[i]}</span>
          </Link>
        ))}
        <Link href={qs("/review", { queue: active.key, mine: mine ? undefined : "1" })} className="ml-auto text-[12.5px] font-medium text-brand hover:underline">
          {mine ? "Show all reviewers" : "Only cases assigned to me"}
        </Link>
      </div>
      <Card>
        <CardHeader title={`${active.label}`} description={`${total} case(s)`} />
        {rows.length ? (
          <CaseTable rows={rows} staff={staff.map((m) => ({ id: m.id, name: m.name, role: ROLE_LABELS[m.role] }))} canBulk={hasPermission(s.ctx, "cases:assign")} canTriage={false} linkBase="/review" />
        ) : (
          <EmptyState title="Queue is empty" description="Nothing is waiting in this queue." />
        )}
      </Card>
    </>
  );
}
