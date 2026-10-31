/**
 * Pure normalization of messy municipal permit data.
 *
 * Principle: never fabricate. A value that cannot be confidently normalized
 * becomes `null` with a warning that preserves the raw input. The raw row is
 * stored verbatim in permit_source_records regardless.
 */
import type { PermitCategory, SourceStatus } from "@/domain/permits";
import type { FieldWarning } from "../db/schema";

const BLANKS = new Set(["", "n/a", "na", "null", "none", "-", "--", "0000-00-00", "00/00/0000", "unknown", "tbd"]);

export function clean(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).replace(/\s+/g, " ").trim();
  return BLANKS.has(v.toLowerCase()) ? null : v;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(name: string): number | null {
  const key = name.toLowerCase().replace(/\./g, "");
  return MONTHS[key] ?? MONTHS[key.slice(0, 3)] ?? null;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function expandYear(yy: number, pivotYear: number): number {
  const pivot = pivotYear % 100;
  return yy <= pivot + 1 ? 2000 + yy : 1900 + yy;
}

export interface NormalizedValue<T> {
  value: T | null;
  warning?: string;
}

export function normalizeDate(raw: string | null | undefined, pivotYear = new Date().getUTCFullYear()): NormalizedValue<string> {
  const v = clean(raw);
  if (!v) return { value: null };
  let m: RegExpMatchArray | null;

  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
    const out = validYmd(+m[1], +m[2], +m[3]);
    return out ? { value: out } : { value: null, warning: `Invalid calendar date "${v}"` };
  }
  if ((m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s.*)?$/))) {
    // US convention: month first.
    const year = m[3].length === 2 ? expandYear(+m[3], pivotYear) : +m[3];
    const out = validYmd(year, +m[1], +m[2]);
    return out ? { value: out } : { value: null, warning: `Invalid calendar date "${v}" (expected month/day/year)` };
  }
  if ((m = v.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const out = validYmd(+m[1], +m[2], +m[3]);
    return out ? { value: out } : { value: null, warning: `Invalid compact date "${v}"` };
  }
  if ((m = v.match(/^(\d{1,2})[-\s]([A-Za-z.]{3,10})[-\s,]+(\d{2}|\d{4})$/))) {
    const month = monthFromName(m[2]);
    const year = m[3].length === 2 ? expandYear(+m[3], pivotYear) : +m[3];
    const out = month ? validYmd(year, month, +m[1]) : null;
    return out ? { value: out } : { value: null, warning: `Unrecognized date "${v}"` };
  }
  if ((m = v.match(/^([A-Za-z.]{3,10})\s+(\d{1,2}),?\s+(\d{4})$/))) {
    const month = monthFromName(m[1]);
    const out = month ? validYmd(+m[3], month, +m[2]) : null;
    return out ? { value: out } : { value: null, warning: `Unrecognized date "${v}"` };
  }
  if ((m = v.match(/^(\d{5})(?:\.0+)?$/))) {
    const serial = +m[1];
    if (serial > 18000 && serial < 73000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return { value: d.toISOString().slice(0, 10), warning: `Interpreted "${v}" as a spreadsheet serial date` };
    }
  }
  return { value: null, warning: `Unrecognized date format "${v}"` };
}

// ---------------------------------------------------------------------------
// Status and category
// ---------------------------------------------------------------------------

const STATUS_PATTERNS: [RegExp, SourceStatus][] = [
  [/\b(void(ed)?)\b/i, "void"],
  [/\b(cancel+ed|cancel|withdrawn|withdraw)\b/i, "cancelled"],
  [/\b(final(ed|ized)?|c\.?\s?\/?\s?o\.?\s+issued|certificate of (occupancy|completion)|completed?|closed)\b/i, "finaled"],
  [/\b(exp(ired)?|lapsed|stale)\b/i, "expired"],
  [/\b(active|in progress|inspections? (in progress|scheduled)|open)\b/i, "active"],
  [/\b(issued|approved|permit issued)\b/i, "issued"],
];

export function normalizeStatus(raw: string | null | undefined): NormalizedValue<SourceStatus> & { value: SourceStatus } {
  const v = clean(raw);
  if (!v) return { value: "unknown" };
  // "Expired - no final" must read as expired, not finaled.
  if (/\bexp(ired)?\b/i.test(v) && /\bno\s+final\b/i.test(v)) return { value: "expired" };
  for (const [re, status] of STATUS_PATTERNS) if (re.test(v)) return { value: status };
  return { value: "unknown", warning: `Unrecognized status "${v}"` };
}

const CATEGORY_PATTERNS: [RegExp, PermitCategory][] = [
  [/\b(electric(al)?|elec)\b.*\b(service|svc|panel|meter|upgrade|change)\b|\b(service|svc)\s+(change|upgrade)\b/i, "electrical_service"],
  [/\b(elec(trical)?)\b/i, "electrical_service"],
  // Furnaces (including the common misspelling "furnance") and boilers may burn
  // gas; treated as gas work unless a person reclassifies them.
  [/\b(gas|fuel gas|lp|propane|furn[ae]n?ces?|boilers?)\b/i, "gas"],
  [/\b(water\s*heater|w\/?h\b|hot water heater|whtr)\b/i, "water_heater"],
  [/\b(re-?roof(ing)?|roof(ing)?|shingle)\b/i, "roof"],
  [/\b(window|windows|wndw|door\/window|fenestration)\b/i, "window"],
  [/\b(fence|fencing)\b/i, "fence"],
  [/\b(addition|room add(ition)?|add-on)\b/i, "addition"],
  [/\b(structural|struct|foundation|load[- ]bearing)\b/i, "structural"],
  // Categories with no rule in the default rule sets: they route to staff review
  // until a jurisdiction writes one. Fire sprinklers are not irrigation.
  [/\b(hvac|a\/c|air[- ]condition\w*|heat pump|condens(er|ing unit)|mini[- ]?split|air handler|duct\w*|heat(ing)? (and|&) air|central air|mechanical change[- ]?out)\b/i, "hvac"],
  [/\b(irrigation|lawn sprinklers?)\b/i, "irrigation"],
  [/\b(plumbing|re-?pip\w*|sewer|water (service|supply) line|fixtures?|faucets?|toilets?|lavator\w*)\b/i, "plumbing"],
  [/\b(doors?)\b/i, "door"],
];

export function normalizeCategory(raw: string | null | undefined): NormalizedValue<PermitCategory> {
  const v = clean(raw);
  if (!v) return { value: null };
  for (const [re, cat] of CATEGORY_PATTERNS) if (re.test(v)) return { value: cat };
  return { value: "other", warning: `Category "${v}" is not a modeled category; recorded as Other` };
}

// ---------------------------------------------------------------------------
// Identifiers and addresses
// ---------------------------------------------------------------------------

export interface PermitNumberKeys {
  display: string;
  key: string;
  looseKey: string;
}

export function normalizePermitNumber(raw: string | null | undefined): PermitNumberKeys | null {
  const v = clean(raw);
  if (!v) return null;
  const display = v.toUpperCase();
  const key = display.replace(/\s+/g, "");
  // Loose key: all letters merged, then each numeric run without leading zeros.
  // "LKM-BLD-2016-00412" and "LKMBLD2016-412" both become "LKMBLD|2016|412".
  const letters = display.replace(/[^A-Z]/g, "");
  const numbers = (display.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));
  const looseKey = [letters, ...numbers].join("|");
  return { display, key, looseKey };
}

const SUFFIXES: Record<string, string> = {
  STREET: "ST", STR: "ST", AVENUE: "AVE", AV: "AVE", ROAD: "RD", DRIVE: "DR", DRV: "DR", LANE: "LN", COURT: "CT",
  BOULEVARD: "BLVD", BLVRD: "BLVD", CIRCLE: "CIR", PLACE: "PL", TERRACE: "TER", PARKWAY: "PKWY", HIGHWAY: "HWY",
  TRAIL: "TRL", WAY: "WAY", SQUARE: "SQ", POINT: "PT",
};
const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

export function normalizeAddressKey(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  let s = v.toUpperCase().replace(/[.,]/g, " ");
  s = s.replace(/\b(APT|APARTMENT|UNIT|STE|SUITE)\s*#?\s*/g, "UNIT ").replace(/#\s*/g, "UNIT ");
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIXES[w] ?? DIRECTIONS[w] ?? w);
  return words.join(" ");
}

export function normalizeParcel(raw: string | null | undefined): string | null {
  const v = clean(raw);
  if (!v) return null;
  const p = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return p.length >= 4 ? p : null;
}

export function normalizeZip(raw: string | null | undefined): NormalizedValue<string> {
  const v = clean(raw);
  if (!v) return { value: null };
  const m = v.match(/^(\d{5})(?:-?(\d{4}))?$/);
  if (!m) return { value: null, warning: `Invalid ZIP code "${v}"` };
  return { value: m[2] ? `${m[1]}-${m[2]}` : m[1] };
}

export function normalizeEmail(raw: string | null | undefined): NormalizedValue<string> {
  const v = clean(raw);
  if (!v) return { value: null };
  const e = v.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? { value: e } : { value: null, warning: `Invalid email address "${v}"` };
}

export function normalizePhone(raw: string | null | undefined): NormalizedValue<string> {
  const v = clean(raw);
  if (!v) return { value: null };
  let d = v.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return { value: null, warning: `Invalid phone number "${v}"` };
  return { value: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` };
}

export function titleCaseName(raw: string | null): string | null {
  if (!raw) return null;
  if (raw !== raw.toUpperCase()) return raw;
  return raw.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

export interface NormalizedPermitRow {
  permitNumber: string;
  permitKey: string;
  permitLooseKey: string;
  jurisdiction: string | null;
  parcelId: string | null;
  address: string | null;
  addressKey: string | null;
  city: string | null;
  zip: string | null;
  category: PermitCategory | null;
  rawCategory: string | null;
  workDescription: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  sourceStatusRaw: string | null;
  sourceStatus: SourceStatus;
  finalInspectionAt: string | null;
  contractorName: string | null;
  contractorLicense: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  missingFields: string[];
}

export type ColumnMapping = Partial<Record<string, string | null>>;

export interface RowResult {
  ok: boolean;
  record: NormalizedPermitRow | null;
  errors: string[];
  warnings: FieldWarning[];
}

const ESSENTIAL: (keyof NormalizedPermitRow)[] = ["address", "category", "issuedAt"];

export function normalizeRow(raw: Record<string, string>, mapping: ColumnMapping, defaults: { sourceSystem?: string | null } = {}): RowResult {
  const get = (field: string) => {
    const col = mapping[field];
    return col ? (raw[col] ?? null) : null;
  };
  const errors: string[] = [];
  const warnings: FieldWarning[] = [];
  const warn = (field: string, w: string | undefined, rawValue: string | null) => {
    if (w) warnings.push({ field, message: w, raw: rawValue });
  };

  const pn = normalizePermitNumber(get("permitNumber"));
  if (!pn) {
    errors.push("Missing permit ID; the row cannot be keyed and was not imported");
    return { ok: false, record: null, errors, warnings };
  }
  if (pn.key.length > 64) {
    errors.push("Permit ID exceeds 64 characters");
    return { ok: false, record: null, errors, warnings };
  }

  const issued = normalizeDate(get("issuedAt"));
  warn("issuedAt", issued.warning, get("issuedAt"));
  const expires = normalizeDate(get("expiresAt"));
  warn("expiresAt", expires.warning, get("expiresAt"));
  const finalAt = normalizeDate(get("finalInspectionAt"));
  warn("finalInspectionAt", finalAt.warning, get("finalInspectionAt"));
  const status = normalizeStatus(get("status"));
  warn("status", status.warning, get("status"));
  const category = normalizeCategory(get("category"));
  warn("category", category.warning, get("category"));
  const zip = normalizeZip(get("zip"));
  warn("zip", zip.warning, get("zip"));
  const email = normalizeEmail(get("ownerEmail"));
  warn("ownerEmail", email.warning, get("ownerEmail"));
  const phone = normalizePhone(get("ownerPhone"));
  warn("ownerPhone", phone.warning, get("ownerPhone"));

  if (issued.value && expires.value && expires.value < issued.value) {
    warnings.push({ field: "expiresAt", message: "Expiration date precedes issuance date", raw: get("expiresAt") });
  }
  if (issued.value && finalAt.value && finalAt.value < issued.value) {
    warnings.push({ field: "finalInspectionAt", message: "Final inspection date precedes issuance date", raw: get("finalInspectionAt") });
  }

  const address = clean(get("address"));
  const record: NormalizedPermitRow = {
    permitNumber: pn.display,
    permitKey: pn.key,
    permitLooseKey: pn.looseKey,
    jurisdiction: clean(get("jurisdiction")),
    parcelId: normalizeParcel(get("parcelId")),
    address: address ? address.toUpperCase() : null,
    addressKey: normalizeAddressKey(address),
    city: titleCaseName(clean(get("city"))),
    zip: zip.value,
    category: category.value,
    rawCategory: clean(get("category")),
    workDescription: clean(get("workDescription")),
    issuedAt: issued.value,
    expiresAt: expires.value,
    sourceStatusRaw: clean(get("status")),
    sourceStatus: status.value,
    finalInspectionAt: finalAt.value,
    contractorName: clean(get("contractorName")),
    contractorLicense: clean(get("contractorLicense"))?.toUpperCase() ?? null,
    ownerName: titleCaseName(clean(get("ownerName"))),
    ownerEmail: email.value,
    ownerPhone: phone.value,
    sourceSystem: clean(get("sourceSystem")) ?? defaults.sourceSystem ?? null,
    sourceRecordId: clean(get("sourceRecordId")),
    missingFields: [],
  };
  record.missingFields = ESSENTIAL.filter((f) => record[f] === null) as string[];
  return { ok: true, record, errors, warnings };
}

/** Fields compared on re-import to decide created / updated / unchanged. */
export const COMPARABLE_FIELDS = [
  "permitNumber",
  "category",
  "rawCategory",
  "workDescription",
  "issuedAt",
  "expiresAt",
  "sourceStatusRaw",
  "sourceStatus",
  "finalInspectionAt",
  "contractorName",
  "contractorLicense",
  "sourceSystem",
  "sourceRecordId",
] as const;
