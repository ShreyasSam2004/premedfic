/**
 * Building blocks for the rule editor. Client-safe: no server imports.
 *
 * The library holds the evidence requirements a jurisdiction can attach to a
 * category rule. A rule set may still carry its own wording for a code; the
 * editor keeps that wording when the requirement is already present.
 */
import type { EvidenceType } from "./evidence";
import type { PermitCategory } from "./permits";
import type { StaffRole } from "./roles";

export type RequirementSource = EvidenceType | "applicant_statement";

export interface RequirementSpec {
  code: string;
  label: string;
  description: string;
  acceptedTypes: RequirementSource[];
  minCount: number;
  required: boolean;
}

export const EVIDENCE_LIBRARY: RequirementSpec[] = [
  {
    code: "contractor_invoice",
    label: "Contractor invoice or contract",
    description: "An invoice, contract, or receipt from the contractor that performed the permitted work.",
    acceptedTypes: ["invoice", "contract"],
    minCount: 1,
    required: true,
  },
  {
    code: "owner_statement",
    label: "Owner statement of completed work",
    description: "A description of the work performed, approximately when it was completed, and who performed it.",
    acceptedTypes: ["applicant_statement"],
    minCount: 1,
    required: true,
  },
  {
    code: "completion_photos",
    label: "Photographs of the completed work",
    description: "Photographs that show the completed work in place.",
    acceptedTypes: ["photo"],
    minCount: 2,
    required: true,
  },
  {
    code: "equipment_photo",
    label: "Photograph of the installed equipment and its data plate",
    description: "A photograph of the installed unit with its manufacturer data plate legible.",
    acceptedTypes: ["photo"],
    minCount: 1,
    required: true,
  },
  {
    code: "exterior_photos",
    label: "Exterior photographs of the completed roof",
    description: "At least two photographs showing the completed roof from different sides of the property.",
    acceptedTypes: ["photo"],
    minCount: 2,
    required: true,
  },
  {
    code: "unit_photo",
    label: "Photograph of the installed water heater",
    description: "A photograph of the installed unit including the relief-valve discharge line.",
    acceptedTypes: ["photo"],
    minCount: 1,
    required: true,
  },
  {
    code: "inspection_report",
    label: "Prior inspection report",
    description: "Any inspection report already issued for this permit.",
    acceptedTypes: ["inspection_report"],
    minCount: 1,
    required: true,
  },
  {
    code: "engineer_documentation",
    label: "Engineer-of-record letter or inspection documentation",
    description: "Documentation from the engineer of record or prior inspection records for the structural work.",
    acceptedTypes: ["completion_record", "inspection_report"],
    minCount: 1,
    required: true,
  },
];

export const RULE_EDITOR_CATEGORIES: PermitCategory[] = [
  "roof",
  "window",
  "fence",
  "water_heater",
  "door",
  "hvac",
  "plumbing",
  "irrigation",
  "electrical_service",
  "gas",
  "structural",
  "addition",
];

export const APPROVAL_ROLES: StaffRole[] = ["official", "manager", "admin"];

const byCode = (code: string) => EVIDENCE_LIBRARY.find((e) => e.code === code)!;

/** Starting point when a jurisdiction writes a rule for a category it did not cover. */
export function defaultCategoryRule(category: PermitCategory) {
  const photos = category === "hvac" || category === "water_heater" ? byCode("equipment_photo") : byCode("completion_photos");
  return {
    concernLevel: "standard" as const,
    pathway: "evidence_review" as const,
    specialistDiscipline: null as string | null,
    siteInspectionRequired: false,
    requiredEvidence: [byCode("contractor_invoice"), photos, byCode("owner_statement")].map((e) => ({ ...e })),
    approvalAuthority: ["official"] as StaffRole[],
    basePriorityPoints: 10,
    procedureNote:
      "Expired permits in this category may be resolved through owner evidence review followed by a building official's determination. The official may require a site inspection at any time.",
  };
}
