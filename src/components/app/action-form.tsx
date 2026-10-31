"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { buttonClass, cn } from "@/components/ui/primitives";
import type { ActionState } from "@/app/(staff)/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  compact = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <ActionMessage state={state} compact={compact} />
    </form>
  );
}

export function ActionMessage({ state, compact }: { state: ActionState; compact?: boolean }) {
  if (!state) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cn(
        "mt-2 flex gap-2 rounded-md px-2.5 py-2 text-[12.5px]",
        state.ok ? "bg-tone-info-bg text-tone-info-fg" : "bg-tone-critical-bg text-tone-critical-fg",
        compact && "py-1.5",
      )}
    >
      {state.ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
      <div className="min-w-0">
        <div className="font-medium">{state.message}</div>
        {state.details && state.details.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {state.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
