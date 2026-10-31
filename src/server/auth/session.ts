import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { initDatabase } from "../db/client";
import { resolveSession, type StaffSession } from "./service";
import { resolvePortalContext } from "../portal/service";
import { PORTAL_COOKIE } from "../portal/tokens";

export const SESSION_COOKIE = "pf_session";

export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  await initDatabase();
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
});

export async function requireStaffSession(): Promise<StaffSession> {
  const s = await getStaffSession();
  if (!s) redirect("/login");
  return s;
}

export const getPortalContext = cache(async () => {
  await initDatabase();
  const jar = await cookies();
  return resolvePortalContext(jar.get(PORTAL_COOKIE)?.value);
});

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
