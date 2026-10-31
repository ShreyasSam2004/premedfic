"use client";

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";
import { SubmitButton } from "@/components/app/action-form";
import { Input, Select } from "@/components/ui/primitives";
import { requestCodeAction, verifyCodeAction, type PortalState } from "../actions";

function Message({ s }: { s: PortalState }) {
  if (!s || s.ok) return null;
  return (
    <div role="alert" className="mt-3 flex gap-2 rounded-lg bg-tone-critical-bg px-3 py-2.5 text-[14px] text-tone-critical-fg">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
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

export function VerifyFlow({ token, channel, masked, department, phone, demo }: { token: string; channel: string | null; masked: string | null; department: string; phone: string | null; demo: boolean }) {
  const [sent, sendAction] = useActionState(requestCodeAction, null);
  const [verified, verifyAction] = useActionState(verifyCodeAction, null);
  if (!channel || !masked) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5">
        <p>We can&rsquo;t verify this link online. Please contact {department}{phone ? ` at ${phone}` : ""} and mention the link you received.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-semibold">Step 1 — Get a code</h2>
        <p className="mt-1 text-ink-2">
          We&rsquo;ll send a 6-digit code by {channel === "email" ? "email" : "text message"} to <strong>{masked}</strong>, the contact on file for this property.
        </p>
        <form action={sendAction} className="mt-3">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="h-11 w-full text-[15px] sm:w-auto">{sent?.ok ? "Send a new code" : "Send me a code"}</SubmitButton>
        </form>
        {sent?.ok && <p className="mt-3 text-[14px] text-ink-2" role="status">{sent.message}</p>}
        {sent?.ok && demo && sent.demoCode && (
          <div className="mt-3 rounded-lg border border-dashed border-[#b54708]/50 bg-tone-attention-bg px-3 py-2.5 text-[13px] text-tone-attention-fg" data-testid="demo-code">
            <strong>Demo mode — simulated delivery.</strong> No message was actually sent. In production this code is delivered only to {masked}. Code: <span className="font-mono text-[15px] font-semibold">{sent.demoCode}</span>
          </div>
        )}
        <Message s={sent} />
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-semibold">Step 2 — Confirm</h2>
        <form action={verifyAction} className="mt-3 space-y-3">
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium">6-digit code</span>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="h-11 font-mono text-[18px] tracking-[0.3em]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium">Your full name</span>
            <Input name="name" autoComplete="name" required className="h-11 text-[15px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium">You are</span>
            <Select name="relationship" className="h-11 text-[15px]">
              <option value="owner">The property owner</option>
              <option value="representative">Someone the owner authorized (for example, a family member or agent)</option>
            </Select>
            <span className="mt-1 block text-[13px] text-muted">If you are an authorized representative, we will ask for the owner&rsquo;s written authorization.</span>
          </label>
          <SubmitButton className="h-11 w-full text-[15px] sm:w-auto">Continue</SubmitButton>
        </form>
        <Message s={verified} />
      </section>
    </div>
  );
}
