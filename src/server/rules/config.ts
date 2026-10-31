/**
 * Jurisdiction rule-set configuration schema.
 *
 * A rule set is data, not code: administrators version it, cite its source,
 * and attest that the source was reviewed. The triage engine reads it; nothing
 * in it can directly change a case's state.
 */
import { z } from "zod";
import { PERMIT_CATEGORIES } from "@/domain/permits";
import { STAFF_ROLES } from "@/domain/roles";
import { EVIDENCE_TYPES } from "@/domain/evidence";

export const REQUIREMENT_SOURCE_TYPES = [...EVIDENCE_TYPES, "applicant_statement"] as const;

export const requirementSpecSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores only"),
  label: z.string().min(3),
  description: z.string().min(3),
  acceptedTypes: z.array(z.enum(REQUIREMENT_SOURCE_TYPES)).min(1),
  minCount: z.number().int().min(1).max(20).default(1),
  required: z.boolean().default(true),
});

export const categoryRuleSchema = z.object({
  concernLevel: z.enum(["standard", "high"]),
  pathway: z.enum(["evidence_review", "specialist_assessment", "manual_staff_assessment"]),
  specialistDiscipline: z.string().nullable().default(null),
  siteInspectionRequired: z.boolean(),
  requiredEvidence: z.array(requirementSpecSchema),
  approvalAuthority: z.array(z.enum(STAFF_ROLES)).min(1),
  basePriorityPoints: z.number().int().min(0).max(50),
  procedureNote: z.string().min(3),
});

export const ruleSetConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    essentialFields: z.array(z.enum(["address", "category", "issuedAt"])).min(1),
    categories: z.partialRecord(z.enum(PERMIT_CATEGORIES), categoryRuleSchema),
    descriptionEscalations: z.array(
      z.object({
        id: z.string().min(2),
        pattern: z.string().min(2),
        discipline: z.string().min(2),
        message: z.string().min(3),
      }),
    ),
    agedPermitProvision: z
      .object({
        enabled: z.boolean(),
        minYearsSinceIssuance: z.number().int().min(1).max(50),
        citation: z.string().min(3),
        sourceUrl: z.string().url().nullable(),
        determinationRequired: z.string().min(10),
        excludedConcernLevels: z.array(z.enum(["standard", "high"])),
      })
      .nullable(),
    priority: z.object({
      pointsPerYearExpired: z.number().int().min(0).max(20),
      maxAgePoints: z.number().int().min(0).max(60),
      highConcernPoints: z.number().int().min(0).max(60),
      missingDataPoints: z.number().int().min(0).max(40),
      noContactPoints: z.number().int().min(0).max(20),
      thresholds: z.object({ P1: z.number().int(), P2: z.number().int(), P3: z.number().int() }),
    }),
  })
  .superRefine((cfg, ctx) => {
    for (const e of cfg.descriptionEscalations) {
      try {
        new RegExp(e.pattern, "i");
      } catch {
        ctx.addIssue({ code: "custom", message: `Escalation ${e.id} has an invalid pattern`, path: ["descriptionEscalations"] });
      }
    }
    const t = cfg.priority.thresholds;
    if (!(t.P1 > t.P2 && t.P2 > t.P3)) {
      ctx.addIssue({ code: "custom", message: "Priority thresholds must satisfy P1 > P2 > P3", path: ["priority", "thresholds"] });
    }
    for (const [cat, rule] of Object.entries(cfg.categories)) {
      if (rule && rule.concernLevel === "high" && !rule.siteInspectionRequired && rule.pathway !== "manual_staff_assessment") {
        ctx.addIssue({
          code: "custom",
          message: `High-concern category "${cat}" must require a site inspection or route to manual staff assessment`,
          path: ["categories", cat],
        });
      }
    }
  });

export type RuleSetConfig = z.infer<typeof ruleSetConfigSchema>;
export type CategoryRule = z.infer<typeof categoryRuleSchema>;
export type RequirementSpecConfig = z.infer<typeof requirementSpecSchema>;

export function parseRuleSetConfig(input: unknown): { ok: true; config: RuleSetConfig } | { ok: false; errors: string[] } {
  const r = ruleSetConfigSchema.safeParse(input);
  if (r.success) return { ok: true, config: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}
