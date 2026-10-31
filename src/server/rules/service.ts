/**
 * Versioned jurisdiction rule sets.
 *
 * - Versions are immutable once created; changes always create a new version.
 * - Activating a version supersedes the prior active version. Historical triage
 *   results keep referencing the version they were computed under.
 * - Verification is an explicit attestation by an administrator that the
 *   rule's cited source was reviewed. Unverified rules force human review.
 */
import { and, desc, eq, max } from "drizzle-orm";
import { db, transaction } from "../db/client";
import { jurisdictions, ruleSets, type RuleSetRow } from "../db/schema";
import { requirePermission, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { now } from "../util";
import { parseRuleSetConfig, type RuleSetConfig } from "./config";

export async function getActiveRuleSet(orgId: string, jurisdictionId: string): Promise<(RuleSetRow & { config: RuleSetConfig }) | null> {
  const [row] = await db()
    .select()
    .from(ruleSets)
    .where(and(eq(ruleSets.orgId, orgId), eq(ruleSets.jurisdictionId, jurisdictionId), eq(ruleSets.status, "active")))
    .limit(1);
  if (!row) return null;
  const parsed = parseRuleSetConfig(row.config);
  // A stored config that no longer validates is treated as absent (forces human review).
  return parsed.ok ? { ...row, config: parsed.config } : null;
}

export async function listRuleSets(orgId: string) {
  return db()
    .select({ ruleSet: ruleSets, jurisdiction: jurisdictions })
    .from(ruleSets)
    .innerJoin(jurisdictions, eq(jurisdictions.id, ruleSets.jurisdictionId))
    .where(eq(ruleSets.orgId, orgId))
    .orderBy(jurisdictions.name, desc(ruleSets.version));
}

export async function getRuleSet(orgId: string, id: string) {
  const [row] = await db()
    .select({ ruleSet: ruleSets, jurisdiction: jurisdictions })
    .from(ruleSets)
    .innerJoin(jurisdictions, eq(jurisdictions.id, ruleSets.jurisdictionId))
    .where(and(eq(ruleSets.orgId, orgId), eq(ruleSets.id, id)));
  if (!row) throw new NotFoundError("Rule set");
  return row;
}

export interface NewRuleSetInput {
  jurisdictionId: string;
  name: string;
  config: unknown;
  effectiveDate: string;
  sourceCitation: string;
  sourceUrl?: string | null;
  changeSummary: string;
}

export async function createRuleSetVersion(ctx: ActorContext, input: NewRuleSetInput) {
  const user = requirePermission(ctx, "rules:manage");
  const parsed = parseRuleSetConfig(input.config);
  if (!parsed.ok) throw new ValidationError("Rule set configuration is invalid", parsed.errors);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ValidationError("Effective date must be YYYY-MM-DD");
  if (input.sourceCitation.trim().length < 3) throw new ValidationError("A source citation is required");
  return transaction(async () => {
    const [j] = await db()
      .select()
      .from(jurisdictions)
      .where(and(eq(jurisdictions.id, input.jurisdictionId), eq(jurisdictions.orgId, ctx.orgId)));
    if (!j) throw new NotFoundError("Jurisdiction");
    const [{ v }] = await db().select({ v: max(ruleSets.version) }).from(ruleSets).where(eq(ruleSets.jurisdictionId, j.id));
    const [row] = await db()
      .insert(ruleSets)
      .values({
        orgId: ctx.orgId,
        jurisdictionId: j.id,
        version: (v ?? 0) + 1,
        name: input.name.trim(),
        status: "draft",
        verificationStatus: "unverified",
        effectiveDate: input.effectiveDate,
        sourceCitation: input.sourceCitation.trim(),
        sourceUrl: input.sourceUrl?.trim() || null,
        changeSummary: input.changeSummary.trim(),
        config: parsed.config,
        createdBy: user.userId,
        createdAt: now(),
      })
      .returning();
    await recordAudit(ctx, {
      action: "rules.version_created",
      entityType: "rule_set",
      entityId: row.id,
      summary: `Created ${j.name} rule set v${row.version} (draft)`,
      metadata: { version: row.version, changeSummary: row.changeSummary },
    });
    return row;
  });
}

/** Starts a draft from an existing version's configuration and provenance. */
export async function createDraftFromVersion(ctx: ActorContext, sourceId: string, input: { changeSummary: string }) {
  const { ruleSet } = await getRuleSet(ctx.orgId, sourceId);
  if (input.changeSummary.trim().length < 3) throw new ValidationError("Describe what this draft will change");
  return createRuleSetVersion(ctx, {
    jurisdictionId: ruleSet.jurisdictionId,
    name: ruleSet.name,
    config: ruleSet.config,
    effectiveDate: now().toISOString().slice(0, 10),
    sourceCitation: ruleSet.sourceCitation,
    sourceUrl: ruleSet.sourceUrl,
    changeSummary: input.changeSummary,
  });
}

/**
 * Edits a draft in place. Active and superseded versions never change. Any
 * edit clears a prior source-review attestation, which covered the old content.
 */
export async function updateRuleSetDraft(ctx: ActorContext, id: string, input: Omit<NewRuleSetInput, "jurisdictionId">) {
  requirePermission(ctx, "rules:manage");
  const parsed = parseRuleSetConfig(input.config);
  if (!parsed.ok) throw new ValidationError("Rule set configuration is invalid", parsed.errors);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ValidationError("Effective date must be YYYY-MM-DD");
  if (input.name.trim().length < 3) throw new ValidationError("A name is required");
  if (input.sourceCitation.trim().length < 3) throw new ValidationError("A source citation is required");
  if (input.changeSummary.trim().length < 3) throw new ValidationError("A change summary is required");
  return transaction(async () => {
    const { ruleSet } = await getRuleSet(ctx.orgId, id);
    if (ruleSet.status !== "draft") throw new ConflictError("Only drafts can be edited; create a new version instead");
    const wasVerified = ruleSet.verificationStatus === "verified";
    const [row] = await db()
      .update(ruleSets)
      .set({
        name: input.name.trim(),
        effectiveDate: input.effectiveDate,
        sourceCitation: input.sourceCitation.trim(),
        sourceUrl: input.sourceUrl?.trim() || null,
        changeSummary: input.changeSummary.trim(),
        config: parsed.config,
        verificationStatus: "unverified",
        reviewedByName: null,
        reviewedAt: null,
      })
      .where(eq(ruleSets.id, id))
      .returning();
    await recordAudit(ctx, {
      action: "rules.draft_updated",
      entityType: "rule_set",
      entityId: id,
      summary: `Edited draft rule set v${row.version}${wasVerified ? "; prior source-review attestation cleared" : ""}`,
      metadata: { version: row.version, changeSummary: row.changeSummary, attestationCleared: wasVerified },
    });
    return row;
  });
}

export async function verifyRuleSet(ctx: ActorContext, id: string, attestation: { reviewedByName: string; note: string }) {
  requirePermission(ctx, "rules:manage");
  if (attestation.reviewedByName.trim().length < 3 || attestation.note.trim().length < 3) {
    throw new ValidationError("Reviewer name and review note are required");
  }
  return transaction(async () => {
    const { ruleSet } = await getRuleSet(ctx.orgId, id);
    if (ruleSet.status === "superseded") throw new ConflictError("Superseded rule sets cannot be re-verified");
    const [row] = await db()
      .update(ruleSets)
      .set({ verificationStatus: "verified", reviewedByName: attestation.reviewedByName.trim(), reviewedAt: now() })
      .where(eq(ruleSets.id, id))
      .returning();
    await recordAudit(ctx, {
      action: "rules.verified",
      entityType: "rule_set",
      entityId: id,
      summary: `Rule set v${row.version} source review attested by ${row.reviewedByName}`,
      metadata: { note: attestation.note.trim() },
    });
    return row;
  });
}

export async function activateRuleSet(ctx: ActorContext, id: string) {
  requirePermission(ctx, "rules:manage");
  return transaction(async () => {
    const { ruleSet } = await getRuleSet(ctx.orgId, id);
    if (ruleSet.status !== "draft") throw new ConflictError("Only draft rule sets can be activated");
    const at = now();
    await db()
      .update(ruleSets)
      .set({ status: "superseded", supersededAt: at })
      .where(and(eq(ruleSets.jurisdictionId, ruleSet.jurisdictionId), eq(ruleSets.status, "active")));
    const [row] = await db()
      .update(ruleSets)
      .set({ status: "active", activatedAt: at, activatedBy: ctx.actor.type === "user" ? ctx.actor.userId : null })
      .where(eq(ruleSets.id, id))
      .returning();
    await recordAudit(ctx, {
      action: "rules.activated",
      entityType: "rule_set",
      entityId: id,
      summary: `Activated rule set v${row.version}; prior version superseded. Existing triage results are unchanged.`,
      metadata: { version: row.version, verificationStatus: row.verificationStatus },
    });
    return row;
  });
}
