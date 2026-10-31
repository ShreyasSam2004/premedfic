"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { initDatabase } from "@/server/db/client";
import { authenticate, createSession, LoginThrottledError, SESSION_TTL_MS } from "@/server/auth/service";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { recordAudit } from "@/server/audit/audit";

export type LoginState = { error: string } | null;

export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  await initDatabase();
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  try {
    const res = await authenticate(email, password);
    if (!res) return { error: "Email or password is incorrect." };
    const token = await createSession(res.user.id, res.membership.orgId);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_MS / 1000));
    await recordAudit(
      { orgId: res.membership.orgId, actor: { type: "user", userId: res.user.id, role: res.membership.role, name: res.user.name, title: res.user.title, specialties: res.membership.specialties } },
      { action: "auth.login", entityType: "user", entityId: res.user.id, summary: `${res.user.name} signed in` },
    );
  } catch (err) {
    if (err instanceof LoginThrottledError) return { error: err.message };
    throw err;
  }
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/overview");
}
