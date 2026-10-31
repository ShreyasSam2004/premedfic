import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { listOutreach } from "@/server/communications/service";
import { TEMPLATES } from "@/server/communications/templates";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { StatusPill } from "@/components/app/badges";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, fmtDate, Input, LinkButton, PageHeader, relTime, Table, Tag, Td, Th } from "@/components/ui/primitives";
import { approveNoticeAction, cancelDraftAction } from "@/app/(staff)/actions";

export const metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const s = await requireStaffSession();
  const { drafts, sent, followUpsDue, manualQueue } = await listOutreach(s.org.id);
  const canApprove = hasPermission(s.ctx, "comms:approve");
  const canDraft = hasPermission(s.ctx, "comms:draft");
  const demo = process.env.DEMO_MODE === "true";
  return (
    <>
      <PageHeader
        title="Outreach"
        description="Homeowner communication with human approval. Nothing is sent without an authorized approval, and only to contacts verified against property records."
        actions={
          demo && (
            <LinkButton href="/outreach/inbox">
              <Inbox className="size-3.5" /> Simulated recipient inbox
            </LinkButton>
          )
        }
      />
      <Callout tone="info" className="mb-4" title="Delivery is simulated">
        This environment uses the simulated delivery adapter. Messages are recorded locally and never reach a real email address, phone, or mailbox. The adapter interface is ready for an approved provider.
      </Callout>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader title={`Awaiting approval (${drafts.length})`} description="Review each message before it is sent. Approvals cannot be performed in bulk." />
          {drafts.length === 0 ? (
            <EmptyState title="No drafts awaiting approval" />
          ) : (
            <ul className="divide-y divide-line">
              {drafts.map(({ comm, permitNumber, address, createdByName }) => (
                <li key={comm.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_320px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <Link href={`/cases/${comm.caseId}`} className="font-mono font-medium hover:text-brand hover:underline">
                        {permitNumber}
                      </Link>
                      <span className="text-muted">{address}</span>
                      <Tag>{comm.channel}</Tag>
                      <span className="text-[11.5px] text-muted">
                        to {comm.recipientDisplay} · drafted by {createdByName} {relTime(comm.createdAt)} · template {comm.templateId}@{comm.templateVersion}
                      </span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-ink-2">{comm.subject ?? "SMS message"}</summary>
                      <pre className="mt-1.5 rounded bg-subtle px-2.5 py-2 font-sans text-[12px] whitespace-pre-wrap text-ink-2">{comm.body}</pre>
                    </details>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                    {canApprove && (
                      <ActionForm action={approveNoticeAction}>
                        <input type="hidden" name="communicationId" value={comm.id} />
                        <SubmitButton size="sm">Approve and send</SubmitButton>
                      </ActionForm>
                    )}
                    {canDraft && (
                      <ActionForm action={cancelDraftAction} className="flex gap-1.5">
                        <input type="hidden" name="communicationId" value={comm.id} />
                        <Input name="reason" placeholder="Withdraw reason" className="h-7 w-[150px] text-[12px]" required aria-label="Reason" />
                        <SubmitButton size="sm" variant="ghost">
                          Withdraw
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={`Follow-ups due (${followUpsDue.length})`} description="Sent notices with no owner response after 14 days." />
          {followUpsDue.length === 0 ? (
            <EmptyState title="No follow-ups due" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Permit</Th>
                  <Th>Sent</Th>
                  <Th>Due</Th>
                  <Th>Case</Th>
                </tr>
              </thead>
              <tbody>
                {followUpsDue.map(({ comm, permitNumber, caseStatus }) => (
                  <tr key={comm.id}>
                    <Td>
                      <Link href={`/cases/${comm.caseId}`} className="font-mono hover:text-brand hover:underline">
                        {permitNumber}
                      </Link>
                    </Td>
                    <Td>{fmtDate(comm.sentAt)}</Td>
                    <Td className="text-tone-attention-fg">{fmtDate(comm.followUpDueAt)}</Td>
                    <Td>
                      <StatusPill state={caseStatus} short />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={`Manual outreach queue (${manualQueue.length})`} description="No owner contact on file. The system does not guess or contact anyone; staff research the owner of record." />
          {manualQueue.length === 0 ? (
            <EmptyState title="No cases need manual outreach" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Permit</Th>
                  <Th>Address</Th>
                  <Th>Assigned</Th>
                </tr>
              </thead>
              <tbody>
                {manualQueue.map(({ c, permitNumber, address, assignedName }) => (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/cases/${c.id}`} className="font-mono hover:text-brand hover:underline">
                        {permitNumber}
                      </Link>
                    </Td>
                    <Td>{address ?? "—"}</Td>
                    <Td>{assignedName ?? <span className="text-faint">Unassigned</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Delivery history" description="Approved messages and logged manual outreach, with response tracking." />
          {sent.length === 0 ? (
            <EmptyState title="Nothing sent yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Sent</Th>
                  <Th>Permit</Th>
                  <Th>Purpose</Th>
                  <Th>Channel</Th>
                  <Th>Recipient</Th>
                  <Th>Approved by</Th>
                  <Th>Response</Th>
                </tr>
              </thead>
              <tbody>
                {sent.map(({ comm, permitNumber, createdByName }) => (
                  <tr key={comm.id}>
                    <Td className="whitespace-nowrap">{fmtDate(comm.sentAt ?? comm.createdAt, { time: true })}</Td>
                    <Td>
                      <Link href={`/cases/${comm.caseId}`} className="font-mono hover:text-brand hover:underline">
                        {permitNumber}
                      </Link>
                    </Td>
                    <Td>{comm.purpose.replace(/_/g, " ")}</Td>
                    <Td>
                      <Tag>{comm.channel}</Tag>
                    </Td>
                    <Td className="text-ink-2">{comm.recipientDisplay ?? "—"}</Td>
                    <Td className="text-ink-2">{createdByName ?? "—"}</Td>
                    <Td>{comm.responseStatus === "none" ? <span className="text-faint">None yet</span> : <Badge tone="review">{comm.responseStatus}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Templates" description="Versioned, plain-language templates. Every rendered message is checked for threatening, payment, or legal-conclusion language before it can be drafted or sent." />
          <CardBody className="flex flex-wrap gap-2">
            {Object.entries(TEMPLATES).map(([id, t]) => (
              <Tag key={id}>
                {id} v{t.version} · {Object.keys(t.channels).join(", ")}
              </Tag>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
