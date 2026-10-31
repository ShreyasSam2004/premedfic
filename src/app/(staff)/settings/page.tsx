import { eq } from "drizzle-orm";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { listStaff, listJurisdictions } from "@/server/cases/queries";
import { listJobs } from "@/server/jobs/queue";
import { listAuditEvents, verifyAuditChain } from "@/server/audit/audit";
import { PERMISSIONS, ROLE_LABELS, STAFF_ROLES } from "@/domain/roles";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Badge, Callout, Card, CardBody, CardHeader, Field, fmtDate, Input, PageHeader, Table, Tag, Td, Th } from "@/components/ui/primitives";
import { retryJobAction, settingsAction } from "@/app/(staff)/actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await requireStaffSession();
  const [org] = await db().select().from(organizations).where(eq(organizations.id, s.org.id));
  const canManage = hasPermission(s.ctx, "settings:manage");
  const canAudit = hasPermission(s.ctx, "audit:view");
  const [staff, jurisdictions, jobs, chain, audit] = await Promise.all([
    listStaff(s.org.id),
    listJurisdictions(s.org.id),
    listJobs(s.org.id, 40),
    canAudit ? verifyAuditChain(s.org.id) : Promise.resolve(null),
    canAudit ? listAuditEvents(s.org.id, { limit: 60 }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Settings" description={`${org.name} · tenant ${org.slug}`} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Data processing and estimates" />
          <CardBody>
            <ActionForm action={settingsAction} className="space-y-3">
              <label className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-[12.5px]">
                <input type="checkbox" name="aiProcessingAuthorized" defaultChecked={org.settings.aiProcessingAuthorized} disabled={!canManage} className="mt-0.5 accent-brand" />
                <span>
                  <span className="font-medium">Authorize third-party AI processing of documents</span>
                  <span className="mt-0.5 block text-muted">
                    Off by default. While off, no record or document is sent to any external AI provider. This MVP ships no AI provider adapter; all extraction is deterministic. Government and homeowner data is never used for model training.
                  </span>
                </span>
              </label>
              <Field label="Manual research minutes per case" hint="assumption used only for the labeled time-saved estimate">
                <Input name="minutes" type="number" min={0} max={600} defaultValue={org.settings.manualResearchMinutesPerCase} disabled={!canManage} className="w-32" />
              </Field>
              <p className="text-[12px] text-muted">Evidence retention policy: {org.settings.evidenceRetentionDays} days (hook only; nothing is deleted automatically).</p>
              {canManage && <SubmitButton size="sm">Save settings</SubmitButton>}
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Audit trail integrity" description="Audit events are append-only (enforced by database triggers) and hash-chained per organization." />
          <CardBody className="space-y-2 text-[12.5px]">
            {chain ? (
              chain.valid ? (
                <Callout tone="review" icon={<ShieldCheck className="size-3.5" />} title={`Chain verified: ${chain.count.toLocaleString()} events`}>
                  <span className="font-mono text-[11px] break-all">head {chain.headHash}</span>
                </Callout>
              ) : (
                <Callout tone="critical" icon={<TriangleAlert className="size-3.5" />} title={`Chain broken at event #${chain.brokenAtSeq}`}>
                  The audit trail has been altered. Investigate immediately.
                </Callout>
              )
            ) : (
              <p className="text-muted">Your role cannot view the audit trail.</p>
            )}
            <p className="text-muted">PremedFix has not obtained SOC 2, FedRAMP, StateRAMP, or CJIS certification. See docs/SECURITY.md for current controls.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Staff and roles" description="Roles are enforced on the server for every action." />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Specialties</Th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-[11px] text-muted">{m.title}</div>
                  </Td>
                  <Td className="text-ink-2">{m.email}</Td>
                  <Td>{ROLE_LABELS[m.role]}</Td>
                  <Td>{m.specialties.length ? m.specialties.map((x) => <Tag key={x} className="mr-1">{x}</Tag>) : <span className="text-faint">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <details className="border-t border-line px-4 py-3 text-[12px]">
            <summary className="cursor-pointer text-muted hover:text-ink">Permission matrix</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="text-[11.5px]">
                <thead>
                  <tr>
                    <th className="pr-3 text-left font-medium text-muted">Permission</th>
                    {STAFF_ROLES.map((r) => (
                      <th key={r} className="px-1.5 font-medium text-muted">
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(PERMISSIONS).map(([perm, roles]) => (
                    <tr key={perm}>
                      <td className="pr-3 font-mono">{perm}</td>
                      {STAFF_ROLES.map((r) => (
                        <td key={r} className="px-1.5 text-center">
                          {(roles as readonly string[]).includes(r) ? "●" : <span className="text-faint">·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>

        <Card>
          <CardHeader title="Jurisdictions" />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Department</Th>
              </tr>
            </thead>
            <tbody>
              {jurisdictions.map((j) => (
                <tr key={j.id}>
                  <Td>
                    {j.name} {j.isReferenceExample && <Badge tone="attention">Reference</Badge>}
                  </Td>
                  <Td className="font-mono">{j.code}</Td>
                  <Td className="text-ink-2">
                    {j.departmentName}
                    <div className="text-[11px] text-muted">{[j.departmentPhone, j.departmentEmail].filter(Boolean).join(" · ")}</div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Background jobs" description="Imports and evidence processing run as idempotent, retryable jobs." />
          <Table>
            <thead>
              <tr>
                <Th>Created</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempts</Th>
                <Th>Result / error</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <Td className="whitespace-nowrap">{fmtDate(j.createdAt, { time: true })}</Td>
                  <Td className="font-mono text-[11.5px]">{j.type}</Td>
                  <Td>
                    <Badge tone={j.status === "failed" ? "critical" : j.status === "succeeded" ? "neutral" : "info"}>{j.status}</Badge>
                  </Td>
                  <Td className="tabular text-right">
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td className="max-w-[420px] truncate font-mono text-[11px] text-muted">{j.lastError ?? (j.result ? JSON.stringify(j.result) : "")}</Td>
                  <Td>
                    {j.status === "failed" && canManage && (
                      <ActionForm action={retryJobAction} compact>
                        <input type="hidden" name="jobId" value={j.id} />
                        <SubmitButton size="sm" variant="secondary">
                          Retry
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {canAudit && (
          <Card className="xl:col-span-2">
            <CardHeader title="Recent audit events" description="Latest 60 events across the organization." />
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Time</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Summary</Th>
                  <Th>Hash</Th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    <Td className="tabular text-muted">{e.seq}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(e.occurredAt, { time: true })}</Td>
                    <Td className="whitespace-nowrap">
                      {e.actorName}
                      <div className="text-[11px] text-muted">{e.actorRole}</div>
                    </Td>
                    <Td className="font-mono text-[11px]">{e.action}</Td>
                    <Td className="max-w-[460px] text-[12px]">{e.summary}</Td>
                    <Td className="font-mono text-[10.5px] text-faint">{e.hash.slice(0, 10)}…</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
