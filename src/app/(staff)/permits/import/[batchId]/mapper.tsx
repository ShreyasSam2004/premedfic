"use client";

import { useActionState, useState } from "react";
import { CircleAlert, Eye } from "lucide-react";
import { CANONICAL_FIELDS } from "@/domain/permits";
import { Badge, Card, CardBody, CardHeader, cn, Select, Td, Th } from "@/components/ui/primitives";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { commitImportAction, previewImportAction, type PreviewState } from "@/app/(staff)/actions";

const OUTCOME: Record<string, { label: string; tone: "neutral" | "info" | "attention" | "critical" }> = {
  create: { label: "Will create", tone: "info" },
  update: { label: "Will update", tone: "attention" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  error: { label: "Rejected", tone: "critical" },
  duplicate_in_file: { label: "Duplicate in file", tone: "attention" },
};

export function Mapper({
  batchId,
  headers,
  samples,
  suggested,
  jurisdictions,
  priorImport,
}: {
  batchId: string;
  headers: string[];
  samples: Record<string, string>[];
  suggested: Record<string, string | null>;
  jurisdictions: { id: string; name: string; code: string }[];
  priorImport: string | null;
}) {
  const [preview, previewAction, previewPending] = useActionState<PreviewState, FormData>(previewImportAction, null);
  const [mapping, setMapping] = useState<Record<string, string | null>>(suggested);
  const [jurisdictionId, setJurisdictionId] = useState(jurisdictions[0]?.id ?? "");
  // Commit exactly what was previewed: changing the mapping afterwards requires a new preview.
  const current = JSON.stringify({ mapping, jurisdictionId });
  const [previewed, setPreviewed] = useState<string | null>(null);
  const fields = (
    <>
      <input type="hidden" name="batchId" value={batchId} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Jurisdiction for rows without a jurisdiction column</span>
          <Select name="jurisdictionId" value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)} className="w-[320px]" data-testid="jurisdiction-select">
            {jurisdictions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.code})
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr>
              <Th className="w-[210px]">Canonical field</Th>
              <Th className="w-[260px]">Source column</Th>
              <Th>Sample values from file</Th>
            </tr>
          </thead>
          <tbody>
            {CANONICAL_FIELDS.map((f) => (
              <tr key={f.key}>
                <Td>
                  <div className="font-medium text-ink">
                    {f.label}
                    {f.required && <span className="ml-1 text-tone-critical-fg">*</span>}
                  </div>
                  {f.essential && !f.required && <div className="text-[11px] text-muted">Essential — missing values route to reconciliation</div>}
                </Td>
                <Td>
                  <Select name={`map:${f.key}`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))} aria-label={`Source column for ${f.label}`} className="h-8 text-[12.5px]">
                    <option value="">— Not in this file —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="font-mono text-[11.5px] text-muted">
                  <SampleCell field={f.key} mapping={mapping} samples={samples} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      {priorImport && (
        <div className="flex gap-2 rounded-lg border border-[#fedf89] bg-tone-attention-bg px-3 py-2.5 text-[12.5px] text-tone-attention-fg">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          This exact file was already imported ({priorImport}). Committing again reconciles: unchanged rows stay unchanged and no duplicate permits are created.
        </div>
      )}
      <Card>
        <CardHeader title="1. Map columns" description="Suggested from the file's headers. Fields not present stay empty — the system never fills them in." />
        <CardBody>
          <form action={previewAction} onSubmit={() => setPreviewed(current)}>
            {fields}
            <div className="mt-4 flex items-center gap-2">
              <button type="submit" disabled={previewPending} className="inline-flex h-8.5 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-[13px] font-medium hover:bg-subtle disabled:opacity-60">
                <Eye className="size-3.5" /> {previewPending ? "Validating…" : "Validate and preview"}
              </button>
              <span className="text-[12px] text-muted">Dry run. Nothing is saved until you commit.</span>
            </div>
          </form>
        </CardBody>
      </Card>

      {preview && !preview.ok && (
        <div role="alert" className="rounded-lg border border-[#fecdca] bg-tone-critical-bg px-3 py-2.5 text-[12.5px] text-tone-critical-fg">
          <div className="font-medium">{preview.message}</div>
          {preview.details && (
            <ul className="mt-1 list-disc pl-4">
              {preview.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview?.ok && (
        <Card>
          <CardHeader title="2. Preview" description="Row-level validation against existing records. Rejected rows are recorded with their reasons; they are never silently dropped." />
          <CardBody>
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-7" data-testid="preview-summary">
              {[
                ["Rows", preview.summary.total],
                ["Create", preview.summary.create],
                ["Update", preview.summary.update],
                ["Unchanged", preview.summary.unchanged],
                ["Rejected", preview.summary.error],
                ["Dup. in file", preview.summary.duplicateInFile],
                ["Missing essentials", preview.summary.missingEssential],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-md border border-line px-2.5 py-2">
                  <div className="text-[11px] text-muted">{k}</div>
                  <div className="tabular text-[17px] font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Outcome</Th>
                    <Th>Permit</Th>
                    <Th>Address</Th>
                    <Th>Category</Th>
                    <Th>Issued</Th>
                    <Th>Expires</Th>
                    <Th>Status</Th>
                    <Th>Errors and warnings</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber} className={cn(r.outcome === "error" && "bg-tone-critical-bg/40")}>
                      <Td className="tabular text-muted">{r.rowNumber}</Td>
                      <Td>
                        <Badge tone={OUTCOME[r.outcome]?.tone ?? "neutral"}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Badge>
                      </Td>
                      <Td className="font-mono">{r.permitNumber ?? <span className="text-faint">—</span>}</Td>
                      <Td className="max-w-[180px] truncate">{r.address ?? <span className="text-tone-attention-fg">missing</span>}</Td>
                      <Td>{r.category ?? <span className="text-tone-attention-fg">missing</span>}</Td>
                      <Td className="tabular">{r.issuedAt ?? <span className="text-faint">—</span>}</Td>
                      <Td className="tabular">{r.expiresAt ?? <span className="text-faint">—</span>}</Td>
                      <Td>{r.status}</Td>
                      <Td className="max-w-[340px]">
                        {[...r.errors.map((e) => ({ t: "error", m: e })), ...r.warnings.map((w) => ({ t: "warn", m: `${w.field}: ${w.message}` }))].map((x, i) => (
                          <div key={i} className={x.t === "error" ? "text-tone-critical-fg" : "text-tone-attention-fg"}>
                            {x.m}
                          </div>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewed === current ? (
              <ActionForm action={commitImportAction} className="mt-4">
                <input type="hidden" name="batchId" value={batchId} />
                <input type="hidden" name="jurisdictionId" value={jurisdictionId} />
                {Object.entries(mapping).map(([k, v]) => (v ? <input key={k} type="hidden" name={`map:${k}`} value={v} /> : null))}
                <div className="flex items-center gap-3">
                  <SubmitButton>Commit import</SubmitButton>
                  <span className="text-[12px] text-muted">Creates or updates permits, opens cases, detects duplicates, and runs triage in one transaction.</span>
                </div>
              </ActionForm>
            ) : (
              <p className="mt-4 text-[12.5px] text-tone-attention-fg">The mapping changed since this preview. Validate again before committing.</p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SampleCell({ field, mapping, samples }: { field: string; mapping: Record<string, string | null>; samples: Record<string, string>[] }) {
  const col = mapping[field];
  if (!col) return <span className="text-faint">—</span>;
  const vals = samples.map((s) => s[col]).filter((v) => v !== undefined);
  return (
    <span className="line-clamp-2">
      {vals.map((v, i) => (
        <span key={i}>
          {i > 0 && <span className="text-faint"> · </span>}
          {v === "" ? <span className="text-faint italic">blank</span> : v}
        </span>
      ))}
    </span>
  );
}
