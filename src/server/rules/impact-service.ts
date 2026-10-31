/**
 * Previews what a rule-set version would change on today's open cases, and
 * applies an activated version to exactly the cases it changes.
 */
import { and, desc, eq } from "drizzle-orm";
import { requirePermission, type ActorContext } from "../auth/context";
import { recordAudit } from "../audit/audit";
import { db } from "../db/client";
import { auditEvents } from "../db/schema";
import { ValidationError } from "../errors";
import { loadOpenCaseInputs, triageCases } from "../triage/service";
import { parseRuleSetConfig, type RuleSetConfig } from "./config";
import { compareRuleSets, diffConfigs } from "./impact";
import { activateRuleSet, getActiveRuleSet, getRuleSet } from "./service";

export async function previewRuleSetImpact(ctx: ActorContext, ruleSetId: string) {
  requirePermission(ctx, "rules:view");
  const { ruleSet, jurisdiction } = await getRuleSet(ctx.orgId, ruleSetId);
  const parsed = parseRuleSetConfig(ruleSet.config);
  if (!parsed.ok) throw new ValidationError("Rule set configuration is invalid", parsed.errors);
  const active = await getActiveRuleSet(ctx.orgId, ruleSet.jurisdictionId);
  const baseline = active && active.id !== ruleSet.id ? active : null;
  const subjects = await loadOpenCaseInputs(ctx.orgId, ruleSet.jurisdictionId);
  // Both versions are evaluated as verified, so the preview isolates what the
  // rule content changes. (An unverified version also forces human review.)
  const ref = (r: { id: string; version: number }, config: RuleSetConfig) => ({ id: r.id, version: r.version, verified: true, config });
  const report = compareRuleSets(subjects, baseline ? ref(baseline, baseline.config) : null, ref(ruleSet, parsed.config));
  return {
    ...report,
    jurisdiction: { id: jurisdiction.id, name: jurisdiction.name },
    baseline: baseline ? { id: baseline.id, version: baseline.version, name: baseline.name } : null,
    configDiff: diffConfigs(baseline?.config ?? null, parsed.config),
  };
}

/**
 * Activates a draft and, when asked, re-runs triage on the open cases whose
 * routing the change affects. Other cases keep their existing triage results.
 */
export async function activateAndApply(ctx: ActorContext, ruleSetId: string, opts: { retriage: boolean }) {
  requirePermission(ctx, "rules:manage");
  let caseIds: string[] = [];
  if (opts.retriage) {
    requirePermission(ctx, "cases:triage");
    const preview = await previewRuleSetImpact(ctx, ruleSetId);
    caseIds = preview.changes.map((c) => c.caseId).filter((id): id is string => Boolean(id));
  }
  const row = await activateRuleSet(ctx, ruleSetId);
  if (opts.retriage) {
    if (caseIds.length) await triageCases(ctx, caseIds);
    await recordAudit(ctx, {
      action: "rules.applied",
      entityType: "rule_set",
      entityId: ruleSetId,
      summary: `Re-ran triage under v${row.version} on the ${caseIds.length} open case(s) the change affects`,
      metadata: { version: row.version, retriaged: caseIds.length },
    });
  }
  return { ruleSet: row, retriaged: caseIds.length };
}

/** How an activated version was applied, from its audit record (null if triage was not re-run). */
export async function getRuleSetApplication(orgId: string, ruleSetId: string) {
  const [row] = await db()
    .select({ at: auditEvents.occurredAt, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.entityType, "rule_set"), eq(auditEvents.entityId, ruleSetId), eq(auditEvents.action, "rules.applied")))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1);
  return row ? { at: row.at, retriaged: Number((row.metadata as { retriaged?: number }).retriaged ?? 0) } : null;
}
