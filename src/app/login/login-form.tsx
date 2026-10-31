"use client";

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/app/action-form";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, null);
  return (
    <form action={action} className="mt-5 space-y-3.5">
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.error && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-tone-critical-bg px-2.5 py-2 text-[12.5px] text-tone-critical-fg">
          <CircleAlert className="size-3.5" />
          {state.error}
        </div>
      )}
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </form>
  );
}
