import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaffSession } from "@/server/auth/session";
import { listSimulatedMailbox } from "@/server/communications/service";
import { Callout, Card, EmptyState, fmtDate, PageHeader, Tag } from "@/components/ui/primitives";

export const metadata = { title: "Simulated inbox" };

/** Demo-only view of what recipients would receive from the simulated adapter. */
export default async function SimulatedInbox() {
  if (process.env.DEMO_MODE !== "true") notFound();
  const s = await requireStaffSession();
  const messages = await listSimulatedMailbox(s.org.id, 60);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/outreach" className="hover:text-ink">Outreach</Link>}
        title="Simulated recipient inbox"
        description="Demo mode only. Shows messages exactly as a recipient would receive them from the simulated adapter, so the portal flow can be demonstrated. With a real provider this page does not exist."
      />
      <Callout tone="attention" className="mb-4" title="Contains live portal links and verification codes">
        Do not enable demo mode in production. The case record itself stores messages with access tokens redacted.
      </Callout>
      <Card>
        {messages.length === 0 ? (
          <EmptyState title="No simulated deliveries yet" />
        ) : (
          <ul className="divide-y divide-line">
            {messages.map((m) => (
              <li key={m.id} className="px-4 py-3" data-testid="mailbox-message">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <Tag>{m.channel}</Tag>
                  <span className="font-medium">{m.toAddress}</span>
                  <span className="text-muted">{m.subject ?? ""}</span>
                  <span className="ml-auto text-[11.5px] text-muted">{fmtDate(m.deliveredAt, { time: true })}</span>
                </div>
                <pre className="mt-1.5 rounded bg-subtle px-3 py-2 font-sans text-[12px] break-words whitespace-pre-wrap text-ink-2">{m.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
