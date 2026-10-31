/**
 * Homeowner communication workflow: contacts, verification against property
 * records, notice drafting, human approval, simulated dispatch, follow-ups.
 *
 * Nothing is ever sent without an authorized staff approval, and nothing is
 * sent to a contact that staff have not verified as the owner of record.
 */
import { and, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { db, transaction } from "../db/client";
import {
  cases,
  communications,
  contacts,
  contactVerifications,
  evidenceRequirements,
  jurisdictions,
  permits,
  portalGrants,
  properties,
  simulatedMailbox,
  users,
} from "../db/schema";
import { requirePermission, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays, maskEmail, maskPhone, now } from "../util";
import { isContactable, loadCaseForOrg, transitionCase } from "../workflow/service";
import { triageCase } from "../triage/service";
import { createPortalGrant, portalUrlFor } from "../portal/tokens";
import { deliveryAdapter } from "./adapters";
import { lintMessage, PORTAL_LINK_PLACEHOLDER, renderTemplate, type Channel, type TemplateContext, type TemplateId } from "./templates";

export const FOLLOW_UP_DAYS = 14;

export async function caseMessageContext(orgId: string, caseId: string) {
  const [row] = await db()
    .select({ c: cases, permit: permits, property: properties, jurisdiction: jurisdictions })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, permits.jurisdictionId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .where(and(eq(cases.id, caseId), eq(cases.orgId, orgId)));
  if (!row) throw new NotFoundError("Case");
  const reqs = await db()
    .select({ label: evidenceRequirements.label, required: evidenceRequirements.required, status: evidenceRequirements.status })
    .from(evidenceRequirements)
    .where(eq(evidenceRequirements.caseId, caseId));
  return { ...row, requirements: reqs };
}

function templateContext(mc: Awaited<ReturnType<typeof caseMessageContext>>, contactName: string | null, portalUrl: string, extra: Partial<TemplateContext> = {}): TemplateContext {
  const outstanding = mc.requirements.filter((r) => r.required && (r.status === "missing" || r.status === "rejected")).map((r) => r.label);
  return {
    ownerName: contactName,
    permitNumber: mc.permit.permitNumber,
    address: mc.property?.addressLine ?? "your property",
    categoryLabel: CATEGORY_LABELS[(mc.permit.category ?? "other") as PermitCategory],
    departmentName: mc.jurisdiction.departmentName,
    departmentPhone: mc.jurisdiction.departmentPhone,
    departmentEmail: mc.jurisdiction.departmentEmail,
    portalUrl,
    requestedItems: outstanding.length ? outstanding : ["Any documentation showing the permitted work was completed"],
    ...extra,
  };
}

function recipientFor(contact: typeof contacts.$inferSelect, channel: Channel, propertyAddress: string | null) {
  if (channel === "email") {
    if (!contact.email) throw new ValidationError("Contact has no email address");
    if (contact.optOutEmail) throw new ValidationError("Contact has opted out of email");
    return { to: contact.email, display: maskEmail(contact.email)! };
  }
  if (channel === "sms") {
    if (!contact.phone) throw new ValidationError("Contact has no phone number");
    if (contact.optOutSms) throw new ValidationError("Contact has opted out of text messages");
    return { to: contact.phone, display: maskPhone(contact.phone)! };
  }
  if (!propertyAddress) throw new ValidationError("No mailing address on file");
  return { to: propertyAddress, display: `Postal mail: ${propertyAddress}` };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function addContact(
  ctx: ActorContext,
  caseId: string,
  input: { name: string; email?: string | null; phone?: string | null; role: "owner" | "representative"; preferredChannel?: Channel | null },
) {
  const user = requirePermission(ctx, "contacts:manage");
  const mc = await caseMessageContext(ctx.orgId, caseId);
  if (!mc.property) throw new ValidationError("Case has no property record; reconcile the address first");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) throw new ValidationError("Invalid email address");
  const digits = input.phone?.replace(/\D/g, "") ?? "";
  const phone = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : null;
  if (input.phone && !phone) throw new ValidationError("Phone must have 10 digits");
  if (input.name.trim().length < 2) throw new ValidationError("Contact name is required");
  return transaction(async () => {
    const [c] = await db()
      .insert(contacts)
      .values({
        orgId: ctx.orgId,
        propertyId: mc.property!.id,
        name: input.name.trim(),
        email,
        phone,
        role: input.role,
        source: "staff",
        preferredChannel: input.preferredChannel ?? null,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    await recordAudit(ctx, {
      action: "contact.added",
      entityType: "contact",
      entityId: c.id,
      caseId,
      summary: `Contact added by ${user.name} (unverified)`,
      metadata: { role: c.role, email: maskEmail(email), phone: maskPhone(phone) },
    });
    return c;
  });
}

export async function verifyContact(ctx: ActorContext, caseId: string, contactId: string, input: { note: string }) {
  const user = requirePermission(ctx, "contacts:verify");
  if (input.note.trim().length < 5) throw new ValidationError("Describe the property record the contact was matched against");
  return transaction(async () => {
    const mc = await caseMessageContext(ctx.orgId, caseId);
    const [c] = await db()
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)));
    if (!c || c.propertyId !== mc.property?.id) throw new NotFoundError("Contact");
    await db().update(contacts).set({ verificationStatus: "owner_of_record_verified", updatedAt: now() }).where(eq(contacts.id, c.id));
    await db().insert(contactVerifications).values({
      orgId: ctx.orgId,
      contactId: c.id,
      method: "property_records_match",
      status: "verified",
      note: input.note.trim(),
      performedByType: "user",
      performedBy: user.userId,
      createdAt: now(),
    });
    await recordAudit(ctx, {
      action: "contact.verified",
      entityType: "contact",
      entityId: c.id,
      caseId,
      summary: `Contact verified as owner of record against property records by ${user.name}`,
      metadata: { method: "property_records_match", note: input.note.trim() },
    });
    // Contact availability is a triage input; re-run triage so the recommendation reflects it.
    if (["TRIAGED", "NEEDS_DATA_RECONCILIATION"].includes(mc.c.status)) await triageCase(ctx, caseId);
  });
}

export async function setContactOptOut(ctx: ActorContext, contactId: string, input: { email: boolean; sms: boolean }) {
  requirePermission(ctx, "contacts:manage");
  const [c] = await db()
    .update(contacts)
    .set({ optOutEmail: input.email, optOutSms: input.sms, updatedAt: now() })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)))
    .returning();
  if (!c) throw new NotFoundError("Contact");
  await recordAudit(ctx, {
    action: "contact.preferences_updated",
    entityType: "contact",
    entityId: c.id,
    summary: `Opt-out preferences updated (email: ${input.email ? "opted out" : "allowed"}, sms: ${input.sms ? "opted out" : "allowed"})`,
  });
  return c;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export async function draftNotice(ctx: ActorContext, caseId: string, input: { contactId: string; channel: Channel; purpose?: "initial_notice" | "follow_up" }) {
  const user = requirePermission(ctx, "comms:draft");
  const purpose = input.purpose ?? "initial_notice";
  return transaction(async () => {
    const mc = await caseMessageContext(ctx.orgId, caseId);
    const [contact] = await db()
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, ctx.orgId)));
    if (!contact || contact.propertyId !== mc.property?.id) throw new NotFoundError("Contact");
    if (!isContactable(contact, Boolean(mc.property?.addressLine))) {
      throw new ValidationError("This contact has not been verified as the owner of record. Verify it against property records first.");
    }
    if (purpose === "initial_notice" && mc.c.status !== "TRIAGED") throw new ConflictError("An initial notice can only be drafted for a triaged case");
    const existingDraft = await db()
      .select({ id: communications.id })
      .from(communications)
      .where(and(eq(communications.caseId, caseId), eq(communications.status, "draft")));
    if (existingDraft.length) throw new ConflictError("A draft is already awaiting approval for this case");

    const recipient = recipientFor(contact, input.channel, mc.property?.addressLine ?? null);
    const rendered = renderTemplate(purpose as TemplateId, input.channel, templateContext(mc, contact.name, PORTAL_LINK_PLACEHOLDER));
    const problems = lintMessage(rendered.body);
    if (problems.length) throw new ValidationError("Message failed tone review", problems);
    const [comm] = await db()
      .insert(communications)
      .values({
        orgId: ctx.orgId,
        caseId,
        contactId: contact.id,
        direction: "outbound",
        channel: input.channel,
        purpose,
        templateId: rendered.templateId,
        templateVersion: rendered.templateVersion,
        subject: rendered.subject,
        body: rendered.body,
        recipientDisplay: recipient.display,
        status: "draft",
        createdBy: user.userId,
        createdAt: now(),
      })
      .returning();
    await recordAudit(ctx, {
      action: "communication.drafted",
      entityType: "communication",
      entityId: comm.id,
      caseId,
      summary: `${purpose === "initial_notice" ? "Owner notice" : "Follow-up"} drafted (${input.channel}) — awaiting approval`,
      metadata: { channel: input.channel, template: `${rendered.templateId}@${rendered.templateVersion}` },
    });
    if (purpose === "initial_notice") await transitionCase(ctx, { caseId, transition: "queue_notice", idempotencyKey: `draft:${comm.id}` });
    return comm;
  });
}

export async function approveAndSend(ctx: ActorContext, communicationId: string) {
  const user = requirePermission(ctx, "comms:approve");
  return transaction(async () => {
    const [comm] = await db()
      .select()
      .from(communications)
      .where(and(eq(communications.id, communicationId), eq(communications.orgId, ctx.orgId)))
      .for("update");
    if (!comm) throw new NotFoundError("Communication");
    if (comm.status !== "draft") throw new ConflictError("Only drafts can be approved");
    const mc = await caseMessageContext(ctx.orgId, comm.caseId);
    const [contact] = await db().select().from(contacts).where(eq(contacts.id, comm.contactId!));
    if (!isContactable(contact, Boolean(mc.property?.addressLine))) throw new ValidationError("Contact is no longer verified or reachable");
    const recipient = recipientFor(contact, comm.channel as Channel, mc.property?.addressLine ?? null);

    const { token } = await createPortalGrant({ orgId: ctx.orgId, caseId: comm.caseId, contactId: contact.id, communicationId: comm.id });
    const delivered = renderTemplate(comm.templateId as TemplateId, comm.channel as Channel, templateContext(mc, contact.name, portalUrlFor(token)));
    const problems = lintMessage(delivered.body);
    if (problems.length) throw new ValidationError("Message failed tone review", problems);

    const result = await deliveryAdapter().send({
      orgId: ctx.orgId,
      communicationId: comm.id,
      channel: comm.channel as Channel,
      to: recipient.to,
      subject: delivered.subject,
      body: delivered.body,
    });
    const at = now();
    const [sent] = await db()
      .update(communications)
      .set({
        status: result.accepted ? "sent_simulated" : "failed",
        approvedBy: user.userId,
        approvedAt: at,
        sentAt: at,
        adapter: result.adapter,
        adapterMessageId: result.messageId,
        followUpDueAt: addDays(at, FOLLOW_UP_DAYS),
      })
      .where(eq(communications.id, comm.id))
      .returning();
    await recordAudit(ctx, {
      action: "communication.approved_sent",
      entityType: "communication",
      entityId: comm.id,
      caseId: comm.caseId,
      summary: `Notice approved by ${user.name} and delivered via ${result.adapter} adapter (no real message sent)`,
      metadata: { adapter: result.adapter, live: deliveryAdapter().live, channel: comm.channel, to: recipient.display },
    });
    if (mc.c.status === "AWAITING_CONTACT_APPROVAL") {
      await transitionCase(ctx, { caseId: comm.caseId, transition: "send_notice", idempotencyKey: `send:${comm.id}` });
    }
    return sent;
  });
}

export async function cancelDraft(ctx: ActorContext, communicationId: string, reason: string) {
  requirePermission(ctx, "comms:draft");
  if (reason.trim().length < 3) throw new ValidationError("A reason is required");
  return transaction(async () => {
    const [comm] = await db()
      .update(communications)
      .set({ status: "cancelled", cancelledReason: reason.trim() })
      .where(and(eq(communications.id, communicationId), eq(communications.orgId, ctx.orgId), eq(communications.status, "draft")))
      .returning();
    if (!comm) throw new NotFoundError("Draft");
    await recordAudit(ctx, { action: "communication.cancelled", entityType: "communication", entityId: comm.id, caseId: comm.caseId, summary: `Draft withdrawn: ${reason.trim()}` });
    const c = await loadCaseForOrg(ctx.orgId, comm.caseId);
    if (c.status === "AWAITING_CONTACT_APPROVAL") {
      await transitionCase(ctx, { caseId: comm.caseId, transition: "withdraw_notice", reason, idempotencyKey: `withdraw:${comm.id}` });
    }
    return comm;
  });
}

export async function logManualOutreach(ctx: ActorContext, caseId: string, input: { channel: "phone" | "in_person" | "letter"; note: string }) {
  const user = requirePermission(ctx, "contacts:manage");
  if (input.note.trim().length < 5) throw new ValidationError("Describe the outreach attempt");
  await loadCaseForOrg(ctx.orgId, caseId);
  return transaction(async () => {
    const [comm] = await db()
      .insert(communications)
      .values({
        orgId: ctx.orgId,
        caseId,
        direction: "outbound",
        channel: input.channel,
        purpose: "manual_outreach",
        body: input.note.trim(),
        status: "logged",
        createdBy: user.userId,
        createdAt: now(),
      })
      .returning();
    await recordAudit(ctx, { action: "communication.manual_logged", entityType: "communication", entityId: comm.id, caseId, summary: `Manual outreach logged (${input.channel})` });
    return comm;
  });
}

/** Reviewer-initiated request for more information; delivered with a fresh portal link. */
export async function sendInfoRequest(ctx: ActorContext, caseId: string, message: string) {
  const user = requirePermission(ctx, "review:act");
  const mc = await caseMessageContext(ctx.orgId, caseId);
  const [grant] = await db()
    .select()
    .from(portalGrants)
    .where(and(eq(portalGrants.caseId, caseId), isNull(portalGrants.revokedAt)))
    .orderBy(desc(portalGrants.createdAt))
    .limit(1);
  const contactRows = mc.property ? await db().select().from(contacts).where(eq(contacts.propertyId, mc.property.id)) : [];
  const contact = contactRows.find((c) => c.id === grant?.contactId) ?? contactRows.find((c) => isContactable(c, Boolean(mc.property?.addressLine)));
  if (!contact) throw new ValidationError("No verified owner contact to receive the request");
  const problems = lintMessage(message);
  if (problems.length) throw new ValidationError("Message failed tone review", problems);
  const channel: Channel = contact.email && !contact.optOutEmail ? "email" : contact.phone && !contact.optOutSms ? "sms" : "letter";
  const recipient = recipientFor(contact, channel, mc.property?.addressLine ?? null);
  const at = now();
  const [comm] = await db()
    .insert(communications)
    .values({
      orgId: ctx.orgId,
      caseId,
      contactId: contact.id,
      direction: "outbound",
      channel,
      purpose: "info_request",
      templateId: "info_request",
      templateVersion: 1,
      subject: `Building permit ${mc.permit.permitNumber} — the reviewer has a question`,
      body: renderTemplate("info_request", channel, templateContext(mc, contact.name, PORTAL_LINK_PLACEHOLDER, { requestMessage: message })).body,
      recipientDisplay: recipient.display,
      status: "approved",
      createdBy: user.userId,
      approvedBy: user.userId,
      approvedAt: at,
      createdAt: at,
    })
    .returning();
  const { token } = await createPortalGrant({ orgId: ctx.orgId, caseId, contactId: contact.id, communicationId: comm.id });
  const delivered = renderTemplate("info_request", channel, templateContext(mc, contact.name, portalUrlFor(token), { requestMessage: message }));
  const result = await deliveryAdapter().send({ orgId: ctx.orgId, communicationId: comm.id, channel, to: recipient.to, subject: delivered.subject, body: delivered.body });
  await db()
    .update(communications)
    .set({ status: "sent_simulated", sentAt: at, adapter: result.adapter, adapterMessageId: result.messageId, followUpDueAt: addDays(at, FOLLOW_UP_DAYS) })
    .where(eq(communications.id, comm.id));
  return comm;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listOutreach(orgId: string) {
  const base = db()
    .select({ comm: communications, permitNumber: permits.permitNumber, address: properties.addressLine, caseStatus: cases.status, createdByName: users.name })
    .from(communications)
    .innerJoin(cases, eq(cases.id, communications.caseId))
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(users, eq(users.id, communications.createdBy));
  const drafts = await base.where(and(eq(communications.orgId, orgId), eq(communications.status, "draft"))).orderBy(desc(communications.createdAt));
  const sent = await db()
    .select({ comm: communications, permitNumber: permits.permitNumber, address: properties.addressLine, caseStatus: cases.status, createdByName: users.name })
    .from(communications)
    .innerJoin(cases, eq(cases.id, communications.caseId))
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(users, eq(users.id, communications.approvedBy))
    .where(and(eq(communications.orgId, orgId), inArray(communications.status, ["sent_simulated", "logged", "failed"]), ne(communications.purpose, "verification_code")))
    .orderBy(desc(communications.sentAt), desc(communications.createdAt))
    .limit(200);
  const followUpsDue = sent.filter(
    (s) =>
      s.comm.followUpDueAt &&
      s.comm.followUpDueAt < now() &&
      s.comm.responseStatus === "none" &&
      ["OWNER_CONTACTED", "AWAITING_EVIDENCE", "ADDITIONAL_INFORMATION_REQUIRED"].includes(s.caseStatus),
  );
  const manualQueue = await db()
    .select({ c: cases, permitNumber: permits.permitNumber, address: properties.addressLine, category: permits.category, assignedName: users.name })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .leftJoin(users, eq(users.id, cases.assignedUserId))
    .where(and(eq(cases.orgId, orgId), eq(cases.manualOutreachRequired, true), eq(cases.status, "TRIAGED")))
    .orderBy(desc(cases.priorityScore));
  return { drafts, sent, followUpsDue, manualQueue };
}

export async function listSimulatedMailbox(orgId: string, limit = 50) {
  return db().select().from(simulatedMailbox).where(eq(simulatedMailbox.orgId, orgId)).orderBy(desc(simulatedMailbox.deliveredAt)).limit(limit);
}

export async function overdueFollowUps(orgId: string) {
  return db()
    .select({ id: communications.id })
    .from(communications)
    .where(and(eq(communications.orgId, orgId), eq(communications.responseStatus, "none"), lt(communications.followUpDueAt, now())));
}
