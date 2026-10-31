"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { initDatabase } from "@/server/db/client";
import { getPortalContext } from "@/server/auth/session";
import { requestVerificationCode, saveStatement, verifyPortalCode } from "@/server/portal/service";
import { PORTAL_COOKIE, PORTAL_SESSION_TTL_MS, signPortalSession } from "@/server/portal/tokens";
import { submitEvidence } from "@/server/evidence/pipeline";
import { DomainError } from "@/server/errors";
import { log } from "@/server/util";

export type PortalState = { ok: boolean; message: string; details?: string[]; masked?: string; demoCode?: string | null } | null;

function fail(err: unknown): PortalState {
  if (err instanceof DomainError) return { ok: false, message: err.status === 404 ? "This link is no longer valid." : err.message, details: err.details };
  log.error("portal.action_failed", err);
  return { ok: false, message: "Something went wrong. Please try again or contact the building department." };
}

export async function requestCodeAction(_: PortalState, fd: FormData): Promise<PortalState> {
  await initDatabase();
  try {
    const r = await requestVerificationCode(String(fd.get("token") ?? ""));
    return { ok: true, message: `We sent a 6-digit code to ${r.maskedDestination}.`, masked: r.maskedDestination, demoCode: r.demoCode };
  } catch (err) {
    return fail(err);
  }
}

export async function verifyCodeAction(_: PortalState, fd: FormData): Promise<PortalState> {
  await initDatabase();
  try {
    const grant = await verifyPortalCode(String(fd.get("token") ?? ""), {
      code: String(fd.get("code") ?? ""),
      relationship: fd.get("relationship") === "representative" ? "representative" : "owner",
      name: String(fd.get("name") ?? ""),
    });
    (await cookies()).set(PORTAL_COOKIE, signPortalSession(grant.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PORTAL_SESSION_TTL_MS / 1000,
    });
  } catch (err) {
    return fail(err);
  }
  redirect("/portal");
}

export async function saveStatementAction(_: PortalState, fd: FormData): Promise<PortalState> {
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, message: "Your session has ended. Please use the link in your notice again." };
  try {
    await saveStatement(ctx, {
      workDescription: String(fd.get("workDescription") ?? ""),
      completionDate: String(fd.get("completionDate") ?? "") || null,
      contractorName: String(fd.get("contractorName") ?? "") || null,
      contractorLicense: String(fd.get("contractorLicense") ?? "") || null,
      notes: String(fd.get("notes") ?? "") || null,
    });
    revalidatePath("/portal");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function submitPortalAction(_: PortalState): Promise<PortalState> {
  const ctx = await getPortalContext();
  if (!ctx || ctx.actor.type !== "homeowner") return { ok: false, message: "Your session has ended. Please use the link in your notice again." };
  try {
    await submitEvidence(ctx, ctx.actor.caseId);
    revalidatePath("/portal");
    return { ok: true, message: "Submitted. The building department will review your information." };
  } catch (err) {
    return fail(err);
  }
}

export async function portalSignOutAction() {
  (await cookies()).delete(PORTAL_COOKIE);
  redirect("/portal");
}
