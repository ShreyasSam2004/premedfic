import Link from "next/link";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getImportBatch, getPriorImportOfFile, sampleRows } from "@/server/imports/service";
import { listJurisdictions } from "@/server/cases/queries";
import { AccessDenied } from "@/components/app/access-denied";
import { Badge, Card, CardHeader, fmtDate, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { Mapper } from "./mapper";

export const metadata = { title: "Import batch" };

export default async function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const s = await requireStaffSession();
  if (!hasPermission(s.ctx, "permits:import")) return <AccessDenied what="import permit records" />;
  const { batchId } = await params;
  const { batch, records } = await getImportBatch(s.org.id, batchId);
  const eyebrow = (
    <span>
      <Link href="/permits" className="hover:text-ink">Permits</Link> / <Link href="/permits/import" className="hover:text-ink">Import</Link>
    </span>
  );

  if (batch.status !== "completed") {
    const [{ headers, rows }, jurisdictions, prior] = await Promise.all([sampleRows(s.org.id, batchId), listJurisdictions(s.org.id), getPriorImportOfFile(s.org.id, batch.fileSha256, batch.id)]);
    return (
      <>
        <PageHeader eyebrow={eyebrow} title={batch.filename} description={`${batch.rowCount} data rows · ${headers.length} columns · SHA-256 ${batch.fileSha256.slice(0, 16)}…`} />
        <Mapper
          batchId={batch.id}
          headers={headers}
          samples={rows}
          suggested={batch.columnMapping ?? {}}
          jurisdictions={jurisdictions.map((j) => ({ id: j.id, name: j.name, code: j.code }))}
          priorImport={prior ? `${prior.filename}, ${fmtDate(prior.createdAt, { time: true })}` : null}
        />
      </>
    );
  }

  const tone = { created: "info", updated: "attention", unchanged: "neutral", error: "critical", duplicate_in_file: "attention" } as const;
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={batch.filename}
        description={`Imported ${fmtDate(batch.completedAt, { time: true })} · SHA-256 ${batch.fileSha256.slice(0, 16)}…`}
        actions={<LinkButton href="/permits?sort=updated">View permits</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6" data-testid="import-result">
        {[
          ["Rows", batch.rowCount],
          ["Created", batch.createdCount],
          ["Updated", batch.updatedCount],
          ["Unchanged", batch.unchangedCount],
          ["Rejected", batch.errorCount],
          ["Possible duplicates", batch.duplicateFlagCount],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-card)]">
            <div className="text-[11.5px] text-muted">{k}</div>
            <div className="tabular text-[20px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title="Row outcomes" description="The original row is preserved for every outcome, including rejected rows." />
        <Table>
          <thead>
            <tr>
              <Th>Row</Th>
              <Th>Outcome</Th>
              <Th>Permit</Th>
              <Th>Source record</Th>
              <Th>Errors, warnings, changes</Th>
            </tr>
          </thead>
          <tbody>
            {records.map(({ record: r, permitNumber, caseId }) => (
              <tr key={r.id}>
                <Td className="tabular text-muted">{r.rowNumber}</Td>
                <Td>
                  <Badge tone={tone[r.outcome]}>{r.outcome.replace(/_/g, " ")}</Badge>
                </Td>
                <Td>
                  {caseId ? (
                    <Link href={`/cases/${caseId}`} className="font-mono text-[12px] hover:text-brand hover:underline">
                      {permitNumber}
                    </Link>
                  ) : (
                    <span className="text-faint">not created</span>
                  )}
                </Td>
                <Td className="font-mono text-[11.5px] text-muted">{[r.sourceSystem, r.sourceRecordId].filter(Boolean).join(" · ") || "—"}</Td>
                <Td className="max-w-[520px] text-[12px]">
                  {r.errors.map((e) => (
                    <div key={e} className="text-tone-critical-fg">{e}</div>
                  ))}
                  {r.warnings.map((w, i) => (
                    <div key={i} className="text-tone-attention-fg">
                      {w.field}: {w.message}
                    </div>
                  ))}
                  {r.changes &&
                    Object.entries(r.changes).map(([k, v]) => (
                      <div key={k} className="text-ink-2">
                        {k}: {String(v.from ?? "blank")} → {String(v.to)}
                      </div>
                    ))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
