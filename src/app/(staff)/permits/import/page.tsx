import Link from "next/link";
import { Download } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { AccessDenied } from "@/components/app/access-denied";
import { listImportBatches } from "@/server/imports/service";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, fmtDate, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Import permits" };

export default async function ImportPage() {
  const s = await requireStaffSession();
  if (!hasPermission(s.ctx, "permits:import")) return <AccessDenied what="import permit records" />;
  const batches = await listImportBatches(s.org.id);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/permits" className="hover:text-ink">Permits</Link>}
        title="Import permit records"
        description="Upload a CSV export from any permitting system. Rows are validated, normalized, de-duplicated, and triaged. Original rows are preserved verbatim for provenance, and re-importing the same records reconciles instead of duplicating."
        actions={
          <a href="/api/imports/template" className={buttonClass("secondary")}>
            <Download className="size-3.5" /> CSV template
          </a>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader title="Upload" />
          <CardBody>
            <UploadForm />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Import history" description="Every batch, with row-level outcomes and the file's SHA-256 fingerprint." />
          {batches.length === 0 ? (
            <EmptyState title="No imports yet" description="Upload your first export to create permit cases." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Rows</Th>
                  <Th className="text-right">Created</Th>
                  <Th className="text-right">Updated</Th>
                  <Th className="text-right">Unchanged</Th>
                  <Th className="text-right">Rejected</Th>
                  <Th className="text-right">Dup. flags</Th>
                  <Th>Uploaded</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map(({ batch: b, uploader, jurisdiction }) => (
                  <tr key={b.id} className="hover:bg-subtle/60">
                    <Td>
                      <Link href={`/permits/import/${b.id}`} className="font-medium hover:text-brand hover:underline">
                        {b.filename}
                      </Link>
                      <div className="font-mono text-[10.5px] text-faint">
                        sha256 {b.fileSha256.slice(0, 12)}… {jurisdiction ? `· ${jurisdiction}` : ""}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={b.status === "completed" ? "neutral" : b.status === "failed" ? "critical" : "info"}>{b.status === "uploaded" ? "Awaiting mapping" : b.status}</Badge>
                    </Td>
                    <Td className="tabular text-right">{b.rowCount}</Td>
                    <Td className="tabular text-right">{b.createdCount}</Td>
                    <Td className="tabular text-right">{b.updatedCount}</Td>
                    <Td className="tabular text-right">{b.unchangedCount}</Td>
                    <Td className="tabular text-right">{b.errorCount}</Td>
                    <Td className="tabular text-right">{b.duplicateFlagCount}</Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {fmtDate(b.createdAt, { time: true })}
                      <div className="text-[11px] text-muted">{uploader}</div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
