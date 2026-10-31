/**
 * Homeowner portal service. Every function derives scope from the grant;
 * a homeowner context can only ever reach its own case.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { PORTAL_SUBMISSION_STATES, type CaseState } from "@/domain/workflow";
import { db, transaction } from "../db/client";
import {
  communications,
  contacts,
  contactVerifications,
  evidenceItems,
  evidenceRequirements,
  evidenceSubmissions,
  portalGrants,
  reviewDecisions,
  type PortalGrant,
} from "../db/schema";
import type { ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { maskEmail, maskPhone, now, randomCode, safeEqual, sha256 } from "../util";
import { transitionCase } from "../workflow/service";
import { deliveryAdapter } from "../communications/adapters";
import { renderTemplate } from "../communications/templates";
import { caseMessageContext } from "../communications/service";
import { codeHash, readPortalSession } from "./tokens";

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_RESEND_MS = 30 * 1000;
const MAX_CODE_ATTEMPTS = 5;

async function grantByToken(token: string): Promise<PortalGrant | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [g] = await db().select().from(portalGrants).where(eq(portalGrants.tokenHash, sha256(token)));
  if (!g || g.revokedAt || g.expiresAt < now()) return null;
  return g;
}

export async function getGrantForToken(token: string) {
  const g = await grantByToken(token);
  if (!g) return null;
  const [contact] = await db().select().from(contacts).where(eq(contacts.id, g.contactId));
  const mc = await caseMessageContext(g.orgId, g.caseId);
  const channel: "email" | "sms" | null = contact.email && !contact.optOutEmail ? "email" : contact.phone && !contact.optOutSms ? "sms" : null;
  return {
    grant: g,
    departmentName: mc.jurisdiction.departmentName,
    departmentPhone: mc.jurisdiction.departmentPhone,
    codeChannel: channel,
    maskedDestination: channel === "email" ? maskEmail(contact.email) : channel === "sms" ? maskPhone(contact.phone) : null,
  };
}

/** Sends a one-time code to the verified contact channel. Returns the code only in demo mode. */
export async function requestVerificationCode(token: string): Promise<{ maskedDestination: string; demoCode: string | null }> {
  return transaction(async () => {
    const info = await getGrantForToken(token);
    if (!info) throw new NotFoundError("Link");
    const { grant } = info;
    if (!info.codeChannel || !info.maskedDestination) {
      throw new ValidationError(`We can't send a code for this link. Please contact ${info.departmentName}${info.departmentPhone ? ` at ${info.departmentPhone}` : ""}.`);
    }
    if (grant.codeExpiresAt && grant.codeExpiresAt.getTime() - CODE_TTL_MS + CODE_RESEND_MS > Date.now()) {
      throw new ConflictError("A code was just sent. Please wait a moment before requesting another.");
    }
    const code = randomCode(6);
    await db()
      .update(portalGrants)
      .set({ codeHash: codeHash(grant.id, code), codeExpiresAt: new Date(Date.now() + CODE_TTL_MS), codeAttempts: 0 })
      .where(eq(portalGrants.id, grant.id));
    const [contact] = await db().select().from(contacts).where(eq(contacts.id, grant.contactId));
    const mc = await caseMessageContext(grant.orgId, grant.caseId);
    const channel = info.codeChannel;
    const msg = renderTemplate("verification_code", channel, {
      ownerName: contact.name,
      permitNumber: mc.permit.permitNumber,
      address: "",
      categoryLabel: "",
      departmentName: mc.jurisdiction.departmentName,
      departmentPhone: null,
      departmentEmail: null,
      portalUrl: "",
      requestedItems: [],
      code,
    });
    const [comm] = await db()
      .insert(communications)
      .values({
        orgId: grant.orgId,
        caseId: grant.caseId,
        contactId: contact.id,
        direction: "outbound",
        channel,
        purpose: "verification_code",
        templateId: "verification_code",
        templateVersion: 1,
        subject: msg.subject,
        body: msg.body.replace(code, "••••••"),
        recipientDisplay: info.maskedDestination,
        status: "sent_simulated",
        sentAt: now(),
        adapter: deliveryAdapter().id,
        createdAt: now(),
      })
      .returning();
    await deliveryAdapter().send({
      orgId: grant.orgId,
      communicationId: comm.id,
      channel,
      to: channel === "email" ? contact.email! : contact.phone!,
      subject: msg.subject,
      body: msg.body,
    });
    if (grant.communicationId) {
      await db()
        .update(communications)
        .set({ responseStatus: "opened", respondedAt: now() })
        .where(and(eq(communications.id, grant.communicationId), eq(communications.responseStatus, "none")));
    }
    return { maskedDestination: info.maskedDestination, demoCode: process.env.DEMO_MODE === "true" ? code : null };
  });
}

export async function verifyPortalCode(token: string, input: { code: string; relationship: "owner" | "representative"; name: string }) {
  const grant = await grantByToken(token);
  if (!grant) throw new NotFoundError("Link");
  if (input.name.trim().length < 2) throw new ValidationError("Please enter your name");
  if (!grant.codeHash || !grant.codeExpiresAt || grant.codeExpiresAt < now()) throw new ValidationError("The code has expired. Request a new code.");
  if (grant.codeAttempts >= MAX_CODE_ATTEMPTS) throw new ForbiddenError("Too many incorrect attempts. Request a new code.");
  const ok = /^\d{6}$/.test(input.code.trim()) && safeEqual(codeHash(grant.id, input.code.trim()), grant.codeHash);
  if (!ok) {
    await db().update(portalGrants).set({ codeAttempts: grant.codeAttempts + 1 }).where(eq(portalGrants.id, grant.id));
    throw new ValidationError("That code is not correct.");
  }
  return transaction(async () => {
    await db()
      .update(portalGrants)
      .set({ verifiedAt: now(), codeHash: null, relationship: input.relationship, lastAccessAt: now() })
      .where(eq(portalGrants.id, grant.id));
    await db().insert(contactVerifications).values({
      orgId: grant.orgId,
      contactId: grant.contactId,
      method: "portal_code",
      status: "verified",
      note: `Portal code confirmed via verified contact channel. Self-declared relationship: ${input.relationship}; name given: ${input.name.trim()}`,
      performedByType: "homeowner",
      performedBy: grant.id,
      createdAt: now(),
    });
    if (input.relationship === "representative") {
      await db()
        .insert(evidenceRequirements)
        .values({
          orgId: grant.orgId,
          caseId: grant.caseId,
          code: "representative_authorization",
          label: "Owner's written authorization for representative",
          description: "A signed letter from the property owner authorizing you to act on their behalf for this permit.",
          acceptedTypes: ["authorization_letter"],
          minCount: 1,
          required: true,
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing();
    }
    if (grant.communicationId) {
      await db().update(communications).set({ responseStatus: "verified", respondedAt: now() }).where(eq(communications.id, grant.communicationId));
    }
    const ctx: ActorContext = { orgId: grant.orgId, actor: { type: "homeowner", grantId: grant.id, contactId: grant.contactId, caseId: grant.caseId, name: input.name.trim() } };
    await recordAudit(ctx, {
      action: "portal.verified",
      entityType: "portal_grant",
      entityId: grant.id,
      caseId: grant.caseId,
      summary: `Portal access verified by one-time code (${input.relationship}). Code proves control of the verified contact channel, not property ownership.`,
      metadata: { relationship: input.relationship },
    });
    const mc = await caseMessageContext(grant.orgId, grant.caseId);
    if (mc.c.status === "OWNER_CONTACTED") {
      await transitionCase(ctx, { caseId: grant.caseId, transition: "owner_verified", idempotencyKey: `portal-verified:${grant.id}` });
    }
    return grant;
  });
}

/** Resolve a portal session cookie into a homeowner actor context, or null. */
export async function resolvePortalContext(cookie: string | undefined | null): Promise<ActorContext | null> {
  const s = readPortalSession(cookie);
  if (!s) return null;
  const [g] = await db().select().from(portalGrants).where(eq(portalGrants.id, s.grantId));
  if (!g || g.revokedAt || !g.verifiedAt || g.expiresAt < now()) return null;
  const [contact] = await db().select({ name: contacts.name }).from(contacts).where(eq(contacts.id, g.contactId));
  return { orgId: g.orgId, actor: { type: "homeowner", grantId: g.id, contactId: g.contactId, caseId: g.caseId, name: contact?.name ?? "Homeowner" } };
}

function requireHomeowner(ctx: ActorContext) {
  if (ctx.actor.type !== "homeowner") throw new ForbiddenError();
  return ctx.actor;
}

const PLAIN_STATUS: Partial<Record<CaseState, { title: string; detail: string }>> = {
  OWNER_CONTACTED: { title: "We need information from you", detail: "Review the items below and upload what you have." },
  AWAITING_EVIDENCE: { title: "We need information from you", detail: "Review the items below and upload what you have." },
  ADDITIONAL_INFORMATION_REQUIRED: { title: "The reviewer asked for more information", detail: "See the reviewer's message below." },
  EVIDENCE_RECEIVED: { title: "Received — waiting for review", detail: "Thank you. A staff member will review your submission." },
  UNDER_STAFF_REVIEW: { title: "Under review", detail: "A staff member is reviewing your submission." },
  INSPECTION_REQUIRED: { title: "A site visit is needed", detail: "The department will contact you to schedule an inspection." },
  READY_FOR_AUTHORIZED_DISPOSITION: { title: "Under review", detail: "Review is complete and awaiting a decision by the building official." },
  DISPOSITION_PENDING_CONFIRMATION: { title: "A decision is being finalized", detail: "The decision has been recorded and is being entered into the official permit system." },
  OFFICIALLY_CLOSED: { title: "Resolved", detail: "The permit has been officially closed." },
  OTHER_OFFICIAL_OUTCOME: { title: "Decision recorded", detail: "The department has recorded a decision. You will receive details separately." },
};

export async function getPortalView(ctx: ActorContext) {
  const h = requireHomeowner(ctx);
  const mc = await caseMessageContext(ctx.orgId, h.caseId);
  const reqs = await db().select().from(evidenceRequirements).where(eq(evidenceRequirements.caseId, h.caseId));
  const items = await db()
    .select({
      id: evidenceItems.id,
      filename: evidenceItems.originalFilename,
      createdAt: evidenceItems.createdAt,
      processingStatus: evidenceItems.processingStatus,
      submissionId: evidenceItems.submissionId,
      declaredType: evidenceItems.declaredType,
    })
    .from(evidenceItems)
    .where(eq(evidenceItems.caseId, h.caseId))
    .orderBy(desc(evidenceItems.createdAt));
  // The reviewer's own words, as recorded on the review decision.
  const requests = await db()
    .select({ id: reviewDecisions.id, body: reviewDecisions.summary, sentAt: reviewDecisions.createdAt })
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.caseId, h.caseId), inArray(reviewDecisions.decisionType, ["request_information", "request_corrected_documents"])))
    .orderBy(desc(reviewDecisions.createdAt));
  const [openSubmission] = await db()
    .select()
    .from(evidenceSubmissions)
    .where(and(eq(evidenceSubmissions.caseId, h.caseId), eq(evidenceSubmissions.grantId, h.grantId), eq(evidenceSubmissions.status, "open")));
  const [grant] = await db().select().from(portalGrants).where(eq(portalGrants.id, h.grantId));
  const status = mc.c.status;
  return {
    permitNumber: mc.permit.permitNumber,
    categoryLabel: CATEGORY_LABELS[(mc.permit.category ?? "other") as PermitCategory],
    address: mc.property?.addressLine ?? null,
    issuedAt: mc.permit.issuedAt,
    expiresAt: mc.permit.expiresAt,
    workDescription: mc.permit.workDescription,
    departmentName: mc.jurisdiction.departmentName,
    departmentPhone: mc.jurisdiction.departmentPhone,
    departmentEmail: mc.jurisdiction.departmentEmail,
    status,
    plainStatus: PLAIN_STATUS[status] ?? { title: "In progress", detail: "The department is working on this permit." },
    canSubmit: PORTAL_SUBMISSION_STATES.includes(status),
    relationship: grant.relationship,
    requirements: reqs
      .filter((r) => r.required || r.status !== "missing")
      .map((r) => ({ code: r.code, label: r.label, description: r.description, status: r.status, acceptedTypes: r.acceptedTypes, minCount: r.minCount })),
    items: items.map((i) => ({ ...i, inCurrentDraft: Boolean(openSubmission && i.submissionId === openSubmission.id) })),
    requests: status === "ADDITIONAL_INFORMATION_REQUIRED" ? requests.slice(0, 1) : [],
    openSubmission: openSubmission ?? null,
  };
}

/** Get or create the open submission (statement + uploads) for this grant. */
export async function ensureOpenSubmission(ctx: ActorContext) {
  const h = requireHomeowner(ctx);
  const [existing] = await db()
    .select()
    .from(evidenceSubmissions)
    .where(and(eq(evidenceSubmissions.caseId, h.caseId), eq(evidenceSubmissions.grantId, h.grantId), eq(evidenceSubmissions.status, "open")));
  if (existing) return existing;
  const [grant] = await db().select().from(portalGrants).where(eq(portalGrants.id, h.grantId));
  const [created] = await db()
    .insert(evidenceSubmissions)
    .values({
      orgId: ctx.orgId,
      caseId: h.caseId,
      grantId: h.grantId,
      submittedByType: "homeowner",
      submittedById: h.grantId,
      submitterName: h.name,
      relationship: grant.relationship ?? "owner",
      status: "open",
      createdAt: now(),
    })
    .returning();
  return created;
}

export async function saveStatement(
  ctx: ActorContext,
  input: { workDescription: string; completionDate: string | null; contractorName: string | null; contractorLicense: string | null; notes: string | null },
) {
  requireHomeowner(ctx);
  const mc = await caseMessageContext(ctx.orgId, (ctx.actor as { caseId: string }).caseId);
  if (!PORTAL_SUBMISSION_STATES.includes(mc.c.status)) throw new ConflictError("This case is not currently accepting submissions");
  if (input.workDescription.trim().length < 10) throw new ValidationError("Please describe the work that was completed (at least a sentence)");
  if (input.completionDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.completionDate)) throw new ValidationError("Completion date must be a valid date");
  if (input.completionDate && input.completionDate > new Date().toISOString().slice(0, 10)) throw new ValidationError("Completion date cannot be in the future");
  const sub = await ensureOpenSubmission(ctx);
  const [updated] = await db()
    .update(evidenceSubmissions)
    .set({
      workDescription: input.workDescription.trim().slice(0, 4000),
      completionDateClaimed: input.completionDate,
      contractorNameClaimed: input.contractorName?.trim().slice(0, 200) || null,
      contractorLicenseClaimed: input.contractorLicense?.trim().toUpperCase().slice(0, 40) || null,
      notes: input.notes?.trim().slice(0, 4000) || null,
    })
    .where(eq(evidenceSubmissions.id, sub.id))
    .returning();
  return updated;
}
