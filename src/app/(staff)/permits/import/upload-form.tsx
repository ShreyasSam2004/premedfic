"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, FileUp, LoaderCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const res = await fetch("/api/imports", { method: "POST", body: new FormData(e.currentTarget) });
          const body = await res.json();
          if (!res.ok) throw new Error([body.error, ...(body.details ?? [])].join(" — "));
          router.push(`/permits/import/${body.batchId}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
          setBusy(false);
        }
      }}
      className="space-y-3.5"
    >
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-subtle/50 px-6 py-8 text-center hover:border-brand hover:bg-brand-soft/40">
        <FileUp className="mb-2 size-6 text-muted" aria-hidden />
        <span className="text-[13px] font-medium text-ink">{name ?? "Choose a CSV export"}</span>
        <span className="mt-0.5 text-[12px] text-muted">Any column layout. You will map columns in the next step. Max 10 MB / 20,000 rows.</span>
        <input type="file" name="file" accept=".csv,text/csv" required className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} data-testid="csv-input" />
      </label>
      <Field label="Source system" hint="optional — recorded as provenance on every row" htmlFor="sourceSystem">
        <Input id="sourceSystem" name="sourceSystem" placeholder="e.g. Tyler EnerGov export, Oct 2026" />
      </Field>
      {error && (
        <div role="alert" className="flex gap-2 rounded-md bg-tone-critical-bg px-2.5 py-2 text-[12.5px] text-tone-critical-fg">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {error}
        </div>
      )}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy && <LoaderCircle className="size-3.5 animate-spin" />}
        Upload and map columns
      </Button>
    </form>
  );
}
