"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CircleAlert, CircleCheck, LoaderCircle, Upload } from "lucide-react";
import { SubmitButton } from "@/components/app/action-form";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveStatementAction, submitPortalAction, type PortalState } from "./actions";

function Note({ s }: { s: PortalState }) {
  if (!s) return null;
  return (
    <div role={s.ok ? "status" : "alert"} className={`mt-3 flex gap-2 rounded-lg px-3 py-2.5 text-[14px] ${s.ok ? "bg-tone-info-bg text-tone-info-fg" : "bg-tone-critical-bg text-tone-critical-fg"}`}>
      {s.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
      <span>
        {s.message}
        {s.details?.map((d) => (
          <span key={d} className="block">
            {d}
          </span>
        ))}
      </span>
    </div>
  );
}

export function UploadBox({ representative }: { representative: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: string[]; bad: { filename: string; errors: string[] }[]; error?: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        setResult(null);
        try {
          const res = await fetch("/api/portal/upload", { method: "POST", body: new FormData(form) });
          const body = await res.json();
          if (!res.ok) setResult({ ok: [], bad: [], error: body.error ?? "Upload failed" });
          else setResult({ ok: body.accepted.map((a: { filename: string }) => a.filename), bad: body.rejected });
          form.reset();
          router.refresh();
        } catch {
          setResult({ ok: [], bad: [], error: "Upload failed. Check your connection and try again." });
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="mb-1 block text-[14px] font-medium">What are you uploading?</span>
        <Select name="declaredType" className="h-11 text-[15px]" defaultValue="photo" data-testid="declared-type">
          <option value="photo">Photos of the completed work</option>
          <option value="invoice">Contractor invoice or receipt</option>
          <option value="contract">Contract with the contractor</option>
          <option value="inspection_report">Inspection paperwork</option>
          <option value="completion_record">Engineer letter or completion certificate</option>
          <option value="correspondence">Letter or other document</option>
          {representative && <option value="authorization_letter">Owner&rsquo;s written authorization</option>}
        </Select>
      </label>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong bg-surface px-4 py-6 text-center hover:border-brand">
        <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <Camera className="size-5" aria-hidden /> Take or choose photos and PDFs
        </span>
        <span className="text-[13px] text-muted">JPEG, PNG, or PDF · up to 15 MB each · 10 files at a time</span>
        <input type="file" name="files" multiple required accept="image/jpeg,image/png,application/pdf" className="sr-only" data-testid="portal-files" />
      </label>
      <Button type="submit" variant="primary" disabled={busy} className="h-11 w-full text-[15px] sm:w-auto">
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
      </Button>
      {result?.error && <Note s={{ ok: false, message: result.error }} />}
      {result && result.ok.length > 0 && <Note s={{ ok: true, message: `Uploaded: ${result.ok.join(", ")}` }} />}
      {result?.bad.map((b) => <Note key={b.filename} s={{ ok: false, message: `${b.filename} was not accepted`, details: b.errors }} />)}
    </form>
  );
}

export function StatementForm({ defaults }: { defaults: { workDescription: string | null; completionDate: string | null; contractorName: string | null; contractorLicense: string | null; notes: string | null } }) {
  const [state, action] = useActionState(saveStatementAction, null);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[14px] font-medium">What work was done?</span>
        <Textarea name="workDescription" required rows={3} defaultValue={defaults.workDescription ?? ""} placeholder="For example: The old shingles were removed and a new roof was installed." className="text-[15px]" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[14px] font-medium">About when was it finished?</span>
        <Input name="completionDate" type="date" defaultValue={defaults.completionDate ?? ""} className="h-11 text-[15px]" />
        <span className="mt-1 block text-[13px] text-muted">An approximate date is fine. Leave blank if you don&rsquo;t know.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Contractor (if any)</span>
          <Input name="contractorName" defaultValue={defaults.contractorName ?? ""} className="h-11 text-[15px]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Contractor license # (if known)</span>
          <Input name="contractorLicense" defaultValue={defaults.contractorLicense ?? ""} className="h-11 text-[15px]" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[14px] font-medium">Anything else we should know?</span>
        <Textarea name="notes" rows={2} defaultValue={defaults.notes ?? ""} className="text-[15px]" />
      </label>
      <SubmitButton variant="secondary" className="h-11 text-[15px]">
        Save my answers
      </SubmitButton>
      <Note s={state} />
    </form>
  );
}

export function SubmitBox({ ready, reason }: { ready: boolean; reason: string | null }) {
  const [state, action] = useActionState(submitPortalAction, null);
  return (
    <form action={action}>
      <SubmitButton disabled={!ready} className="h-12 w-full text-[16px]">
        Submit for review
      </SubmitButton>
      {!ready && reason && <p className="mt-2 text-[13px] text-muted">{reason}</p>}
      <Note s={state} />
    </form>
  );
}
