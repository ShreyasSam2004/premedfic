/**
 * Adapter for the City of Austin's public "Issued Construction Permits"
 * dataset (data.austintexas.gov, 3syk-w9eu).
 *
 * Austin's export is organized by trade permit (BP building, EP electrical,
 * MP mechanical, PP plumbing, DS driveway/sidewalk) and work class, with no
 * work-category field. This adapter derives one, and may only err toward
 * caution: any high-concern signal wins, a standard category is assigned only
 * to a recognizable single-scope job, and everything else is Other, which
 * routes to staff review under every rule set.
 */
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { normalizeCategory, type ColumnMapping } from "./normalize";

export const AUSTIN_DATASET = {
  id: "3syk-w9eu",
  name: "Issued Construction Permits",
  publisher: "City of Austin",
  page: "https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu",
  api: "https://data.austintexas.gov/resource/3syk-w9eu.json",
};

/**
 * Columns downloaded. Contractor and applicant names, phones, and mailing
 * addresses are deliberately excluded: triage does not need them.
 */
export const AUSTIN_COLUMNS = [
  "permit_number",
  "permittype",
  "permit_type_desc",
  "work_class",
  "permit_class",
  "description",
  "original_address1",
  "original_city",
  "original_zip",
  "tcad_id",
  "jurisdiction",
  "council_district",
  "issue_date",
  "expiresdate",
  "status_current",
  "statusdate",
  "completed_date",
  "project_id",
  "masterpermitnum",
] as const;
export type AustinRow = Partial<Record<(typeof AUSTIN_COLUMNS)[number], string>>;

const HIGH_CONCERN = new Set<PermitCategory>(["electrical_service", "gas", "structural", "addition"]);

/** Trade permit and work classes under which each non-high-concern category is a plausible single-scope job. */
const STANDARD_FIT: Partial<Record<PermitCategory, { trades: string[]; workClasses: string[] }>> = {
  roof: { trades: ["BP"], workClasses: ["Repair", "Remodel"] },
  window: { trades: ["BP"], workClasses: ["Repair", "Remodel"] },
  fence: { trades: ["BP"], workClasses: ["New", "Repair", "Remodel"] },
  water_heater: { trades: ["PP"], workClasses: ["Change Out", "Repair", "Remodel"] },
  hvac: { trades: ["MP"], workClasses: ["Change Out", "Repair"] },
  plumbing: { trades: ["PP"], workClasses: ["Repair"] },
  irrigation: { trades: ["PP"], workClasses: ["Irrigation"] },
  door: { trades: ["BP"], workClasses: ["Repair", "Remodel"] },
};

/** A category's own vocabulary, removed before checking a description for other scope. */
const OWN_SCOPE: Partial<Record<PermitCategory, RegExp>> = {
  hvac: /\b(hvac|a\/c|mechanical|duct\w*|heat(ing)?|air|condens\w*|system|unit)\b/gi,
  plumbing: /\b(plumbing|re-?plumb\w*|re-?pip\w*|fixtures?|sinks?|lavator\w*|sewer)\b/gi,
  irrigation: /\b(irrigation|backflow\w*)\b/gi,
};

/**
 * Any of these in a description means the job is broader than one
 * standard-category task. Tuned by reviewing the uncommon words in every
 * Austin description that would otherwise receive a standard category.
 */
const OTHER_SCOPE =
  /\b(remod\w*|rmdl|renovat\w*|additions?|kitchens?|bath(room)?s?|showers?|cabinets?|plumbing|re-?plumb\w*|re-?pip\w*|re-?rout\w*|hvac|a\/c|mechanical|electrical|wiring|rewir\w*|circuits?|recessed|lighting|pools?|spas?|decks?|porch(es)?|patios?|pergolas?|garages?|carports?|foundations?|siding|hardie|stucco|facade|veneer|drywall|sheetrock|interior|flooring|fireplaces?|stair\w*|guard-?rails?|hand-?rails?|ceilings?|walls?|retaining|floodplain|structure|pitch\w*|flat to|rais(e|ed|ing)|bay|convert\w*|conversion|new (construction|residence|home|house|sfr)|demo\w*|framing|fire damage|solar|mobile home|duplex|adu|accessory|sewer|irrigation|softeners?|lavator\w*|sinks?|fixtures?|meters?|relocat\w*|gas|structural|beams?|joists?|rafters?|truss(es)?)\b/i;
/** Other electrical work, except on water heaters, where "electric" names the fuel. */
const ELECTRIC = /\belectric\w*/i;

export interface CategoryDerivation {
  category: PermitCategory;
  basis: string;
}

export function deriveAustinCategory(row: AustinRow): CategoryDerivation {
  const trade = (row.permittype ?? "").trim().toUpperCase();
  const workClass = (row.work_class ?? "").trim();
  const desc = (row.description ?? "").trim();

  // 1. High-concern signals always win.
  if (trade === "EP") return { category: "electrical_service", basis: "electrical permit" };
  const fromDesc = desc ? normalizeCategory(desc).value : null;
  if (fromDesc && HIGH_CONCERN.has(fromDesc)) return { category: fromDesc, basis: `description: ${CATEGORY_LABELS[fromDesc].toLowerCase()}` };
  if (/^addition/i.test(workClass)) return { category: "addition", basis: "work class: addition" };

  // 2. Any other category only for a recognizable single-scope job. A mechanical
  //    change-out is HVAC equipment replacement in Austin's taxonomy, even when
  //    its description names no equipment.
  const cat = fromDesc && fromDesc !== "other" ? fromDesc : trade === "MP" && workClass === "Change Out" ? "hvac" : null;
  if (cat) {
    const label = CATEGORY_LABELS[cat].toLowerCase();
    const fit = STANDARD_FIT[cat];
    if (!fit) return { category: "other", basis: "no single-scope rule" };
    if (!fit.trades.includes(trade)) return { category: "other", basis: `${label} under ${trade || "unknown"} permit` };
    if (!fit.workClasses.includes(workClass)) return { category: "other", basis: `${label} with work class ${workClass || "unknown"}` };
    if (cat === "hvac" && /heater/i.test(desc)) return { category: "other", basis: "heater of unknown fuel" };
    const rest = OWN_SCOPE[cat] ? desc.replace(OWN_SCOPE[cat], " ") : desc;
    if (OTHER_SCOPE.test(rest) || (cat !== "water_heater" && ELECTRIC.test(rest))) return { category: "other", basis: "multi-scope description" };
    return { category: cat, basis: `single-scope ${label}` };
  }
  return { category: "other", basis: "no modeled category" };
}

/** Canonical import mapping: the adapter emits rows keyed by canonical field names. */
export const AUSTIN_MAPPING: ColumnMapping = {
  permitNumber: "permitNumber",
  jurisdiction: "jurisdiction",
  parcelId: "parcelId",
  address: "address",
  city: "city",
  zip: "zip",
  category: "category",
  workDescription: "workDescription",
  issuedAt: "issuedAt",
  expiresAt: "expiresAt",
  status: "status",
  sourceSystem: "sourceSystem",
  sourceRecordId: "sourceRecordId",
};

/**
 * Converts an Austin row into canonical import columns.
 *
 * `completed_date` is intentionally not mapped to the final-inspection date.
 * On expired permits it is almost entirely pre-2007 and usually equals or
 * precedes the expiration date: a legacy lifecycle date, not evidence of a
 * passed final inspection.
 */
export function austinToCanonical(row: AustinRow): { raw: Record<string, string>; derivation: CategoryDerivation } {
  const derivation = deriveAustinCategory(row);
  const raw: Record<string, string> = {
    permitNumber: row.permit_number ?? "",
    jurisdiction: "City of Austin",
    parcelId: row.tcad_id ?? "",
    address: row.original_address1 ?? "",
    city: row.original_city ?? "",
    zip: row.original_zip ?? "",
    category: CATEGORY_LABELS[derivation.category],
    workDescription: row.description ?? "",
    issuedAt: row.issue_date ?? "",
    expiresAt: row.expiresdate ?? "",
    status: row.status_current ?? "",
    sourceSystem: `City of Austin open data (${AUSTIN_DATASET.id})`,
    sourceRecordId: row.project_id ?? "",
  };
  return { raw, derivation };
}
