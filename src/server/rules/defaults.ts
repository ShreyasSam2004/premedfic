/**
 * Default rule-set configurations used by the seed.
 *
 * LAKEMONT: a fictional municipality's local administrative policy, written for
 * the demo. It is not law and cites no statute.
 *
 * CEDAR BLUFF (FL REFERENCE): illustrates how a Florida jurisdiction might
 * reference Fla. Stat. § 553.79(16). It is seeded as UNVERIFIED so every
 * triage result under it requires human review. The statute is permissive
 * ("may close ... if the local enforcement agency determines ..."); the
 * configuration models it as eligibility for an official's consideration,
 * never as an automatic outcome.
 */
import type { RuleSetConfig, CategoryRule } from "./config";

const ownerStatement = {
  code: "owner_statement",
  label: "Owner statement of completed work",
  description: "A description of the work performed, approximately when it was completed, and who performed it.",
  acceptedTypes: ["applicant_statement" as const],
  minCount: 1,
  required: true,
};

const invoice = (label = "Contractor invoice or contract") => ({
  code: "contractor_invoice",
  label,
  description: "An invoice, contract, or receipt from the contractor that performed the permitted work.",
  acceptedTypes: ["invoice" as const, "contract" as const],
  minCount: 1,
  required: true,
});

const standard = (overrides: Partial<CategoryRule> & Pick<CategoryRule, "requiredEvidence" | "basePriorityPoints" | "procedureNote">): CategoryRule => ({
  concernLevel: "standard",
  pathway: "evidence_review",
  specialistDiscipline: null,
  siteInspectionRequired: false,
  approvalAuthority: ["official"],
  ...overrides,
});

const high = (
  discipline: string,
  overrides: Pick<CategoryRule, "requiredEvidence" | "basePriorityPoints" | "procedureNote">,
): CategoryRule => ({
  concernLevel: "high",
  pathway: "specialist_assessment",
  specialistDiscipline: discipline,
  siteInspectionRequired: true,
  approvalAuthority: ["official"],
  ...overrides,
});

const DESCRIPTION_ESCALATIONS: RuleSetConfig["descriptionEscalations"] = [
  {
    id: "ESC-ELEC",
    pattern:
      "\\b(service (upgrade|change)|upgrad\\w* (the |an? )?(electrical |electric )?service|(main|electrical|electric|breaker|load) (panel|center)|panel (upgrade|replacement|change|swap)|sub-?panel|meter (base|can)|\\d{2,3}\\s?a(mps?)?\\b|rewir\\w*|new circuits?)",
    discipline: "electrical",
    message: "Work description references electrical service or panel work",
  },
  {
    id: "ESC-GAS",
    pattern: "\\b(gas (line|lines|piping|pipe|appliance|water heater|tankless|range|stove|dryer|furnace|meter|fireplace|logs)|propane|lp tank|natural gas)\\b",
    discipline: "gas",
    message: "Work description references gas piping or gas-fired appliances",
  },
  {
    id: "ESC-STRUCT",
    pattern: "\\b(structural|load[- ]bearing|beams?|truss(es)?|joists?|rafters?|foundations?|footings?|headers?|widen\\w* (the |an? )?(window |door )?opening|new (window |door )?opening|remov\\w* (a |the )?wall)\\b",
    discipline: "structural",
    message: "Work description references structural members",
  },
];

const PRIORITY: RuleSetConfig["priority"] = {
  pointsPerYearExpired: 4,
  maxAgePoints: 28,
  highConcernPoints: 25,
  missingDataPoints: 12,
  noContactPoints: 6,
  thresholds: { P1: 60, P2: 40, P3: 22 },
};

function categories(note: (cat: string) => string): RuleSetConfig["categories"] {
  return {
    roof: standard({
      requiredEvidence: [
        invoice(),
        {
          code: "exterior_photos",
          label: "Exterior photographs of the completed roof",
          description: "At least two photographs showing the completed roof from different sides of the property.",
          acceptedTypes: ["photo"],
          minCount: 2,
          required: true,
        },
        ownerStatement,
      ],
      basePriorityPoints: 10,
      procedureNote: note("roof"),
    }),
    window: standard({
      requiredEvidence: [
        invoice(),
        {
          code: "window_photos",
          label: "Photographs of installed windows",
          description: "Photographs of the installed windows, including any product labels that remain visible.",
          acceptedTypes: ["photo"],
          minCount: 1,
          required: true,
        },
        ownerStatement,
      ],
      basePriorityPoints: 8,
      procedureNote: note("window"),
    }),
    fence: standard({
      requiredEvidence: [
        {
          code: "fence_photos",
          label: "Photographs of the completed fence",
          description: "Photographs showing the full fence line, gates, and height relative to the property line markers if present.",
          acceptedTypes: ["photo"],
          minCount: 2,
          required: true,
        },
        { ...invoice("Contractor invoice (if a contractor was used)"), required: false },
        ownerStatement,
      ],
      basePriorityPoints: 5,
      procedureNote: note("fence"),
    }),
    water_heater: standard({
      requiredEvidence: [
        invoice(),
        {
          code: "unit_photo",
          label: "Photograph of the installed water heater",
          description: "A photograph of the installed unit including the relief-valve discharge line.",
          acceptedTypes: ["photo"],
          minCount: 1,
          required: true,
        },
        ownerStatement,
      ],
      basePriorityPoints: 10,
      procedureNote: note("water_heater"),
    }),
    electrical_service: high("electrical", {
      requiredEvidence: [invoice("Licensed electrical contractor invoice"), ownerStatement],
      basePriorityPoints: 25,
      procedureNote: "Electrical service work requires specialist assessment and a passed site inspection before any disposition.",
    }),
    gas: high("gas", {
      requiredEvidence: [invoice("Licensed gas contractor invoice"), ownerStatement],
      basePriorityPoints: 25,
      procedureNote: "Gas installations require specialist assessment and a passed site inspection before any disposition.",
    }),
    structural: high("structural", {
      requiredEvidence: [
        {
          code: "engineer_documentation",
          label: "Engineer-of-record letter or inspection documentation",
          description: "Documentation from the engineer of record or prior inspection records for the structural work.",
          acceptedTypes: ["completion_record", "inspection_report"],
          minCount: 1,
          required: true,
        },
        invoice(),
        ownerStatement,
      ],
      basePriorityPoints: 25,
      procedureNote: "Structural alterations require specialist assessment and a passed site inspection before any disposition.",
    }),
    addition: high("building", {
      requiredEvidence: [invoice(), ownerStatement],
      basePriorityPoints: 20,
      procedureNote: "Additions require specialist assessment and a passed site inspection before any disposition.",
    }),
  };
}

export const LAKEMONT_RULESET: RuleSetConfig = {
  schemaVersion: 1,
  essentialFields: ["address", "category", "issuedAt"],
  categories: categories(
    () =>
      "Lakemont administrative policy (demo): expired standard-concern permits may be resolved through owner evidence review followed by a building official's determination. The official may require a site inspection at any time.",
  ),
  descriptionEscalations: DESCRIPTION_ESCALATIONS,
  agedPermitProvision: null,
  priority: PRIORITY,
};

export const FLORIDA_STATUTE_URL = "https://www.flsenate.gov/Laws/Statutes/2025/553.79";

export const CEDAR_BLUFF_FL_REFERENCE_RULESET: RuleSetConfig = {
  schemaVersion: 1,
  essentialFields: ["address", "category", "issuedAt"],
  categories: categories(
    () =>
      "Reference: Fla. Stat. § 553.79(16)(b) provides that if a permit is expired and its requirements have been substantially completed, as determined by the local enforcement agency, the permit may be closed without a new permit. The determination belongs to the local enforcement agency.",
  ),
  descriptionEscalations: DESCRIPTION_ESCALATIONS,
  agedPermitProvision: {
    enabled: true,
    minYearsSinceIssuance: 6,
    citation: "Fla. Stat. § 553.79(16)(c) (2025)",
    sourceUrl: FLORIDA_STATUTE_URL,
    determinationRequired:
      "The statute provides that a local enforcement agency MAY close a building permit 6 years after issuance, even in the absence of a final inspection, IF the local enforcement agency determines that no apparent safety hazards exist. Eligibility is not entitlement: an authorized official must make that determination.",
    excludedConcernLevels: [],
  },
  priority: PRIORITY,
};
