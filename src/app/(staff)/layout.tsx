import { and, eq, inArray, sql } from "drizzle-orm";
import { requireStaffSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { cases, communications } from "@/server/db/schema";
import { ROLE_LABELS } from "@/domain/roles";
import { Sidebar } from "@/components/app/sidebar";
import { CommandPalette } from "@/components/app/command-palette";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();
  const orgId = session.org.id;
  const [{ review }] = await db()
    .select({ review: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), inArray(cases.status, ["EVIDENCE_RECEIVED", "UNDER_STAFF_REVIEW", "INSPECTION_REQUIRED", "READY_FOR_AUTHORIZED_DISPOSITION"])));
  const [{ drafts }] = await db()
    .select({ drafts: sql<number>`count(*)::int` })
    .from(communications)
    .where(and(eq(communications.orgId, orgId), eq(communications.status, "draft")));
  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={session.org.name}
        user={{ name: session.user.name, role: ROLE_LABELS[session.user.role] }}
        counts={{ review, outreach: drafts }}
        demo={process.env.DEMO_MODE === "true"}
      />
      <div className="min-w-0 flex-1">
        {/* Below lg the menu button floats top-left, so content starts beneath it. */}
        <main className="mx-auto w-full max-w-[1440px] px-5 pt-16 pb-6 lg:px-8 lg:pt-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
