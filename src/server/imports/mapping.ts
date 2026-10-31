/**
 * Column-mapping suggestions for arbitrary municipal CSV exports.
 */
import { CANONICAL_FIELDS, type CanonicalField } from "@/domain/permits";

const SYNONYMS: Record<CanonicalField, string[]> = {
  permitNumber: ["permitnumber", "permitno", "permitnum", "permit", "permitid", "permit#", "recordnumber", "casenumber", "applicationnumber"],
  jurisdiction: ["jurisdiction", "municipality", "agency", "juris"],
  parcelId: ["parcelid", "parcel", "parcelnumber", "apn", "pin", "folio", "folionumber", "taxid"],
  address: ["address", "propertyaddress", "siteaddress", "location", "streetaddress", "situsaddress", "addr"],
  city: ["city", "sitecity"],
  zip: ["zip", "zipcode", "postalcode", "sitezip"],
  category: ["category", "permittype", "type", "worktype", "worktypecode", "permitcategory", "subtype"],
  workDescription: ["description", "workdescription", "scope", "scopeofwork", "projectdescription", "desc"],
  issuedAt: ["issued", "issuedate", "issueddate", "dateissued", "issuancedate", "issuedon"],
  expiresAt: ["expires", "expiration", "expirationdate", "expiredate", "expdate", "dateexpired"],
  status: ["status", "permitstatus", "currentstatus"],
  finalInspectionAt: ["finalinspection", "finalinspectiondate", "finaldate", "finaled", "finaledon", "datefinaled"],
  contractorName: ["contractor", "contractorname", "contractorbusiness", "businessname"],
  contractorLicense: ["contractorlicense", "licensenumber", "license", "licenseno", "contractorlic", "licno", "lic"],
  ownerName: ["owner", "ownername", "propertyowner", "applicantname"],
  ownerEmail: ["owneremail", "email", "applicantemail"],
  ownerPhone: ["ownerphone", "phone", "applicantphone", "phonenumber"],
  sourceSystem: ["sourcesystem", "sourcesys", "system", "source"],
  sourceRecordId: ["sourcerecordid", "recordid", "rowid", "objectid", "legacyid", "id"],
};

function norm(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9#]/g, "");
}

export function suggestMapping(headers: string[]): Record<CanonicalField, string | null> {
  const used = new Set<string>();
  const result = {} as Record<CanonicalField, string | null>;
  const normalized = headers.map((h) => ({ h, n: norm(h) }));
  // Pass 1: exact synonym matches, in canonical-field order.
  for (const f of CANONICAL_FIELDS) {
    const hit = normalized.find(({ h, n }) => !used.has(h) && SYNONYMS[f.key].includes(n));
    result[f.key] = hit ? hit.h : null;
    if (hit) used.add(hit.h);
  }
  // Pass 2: prefix/contains matches for still-unmapped fields.
  for (const f of CANONICAL_FIELDS) {
    if (result[f.key]) continue;
    const hit = normalized.find(({ h, n }) => !used.has(h) && SYNONYMS[f.key].some((s) => s.length >= 5 && n.includes(s)));
    result[f.key] = hit ? hit.h : null;
    if (hit) used.add(hit.h);
  }
  return result;
}

export function validateMapping(mapping: Partial<Record<string, string | null>>, headers: string[]): string[] {
  const problems: string[] = [];
  if (!mapping.permitNumber) problems.push("Permit ID must be mapped to a column");
  const seen = new Map<string, string>();
  for (const f of CANONICAL_FIELDS) {
    const col = mapping[f.key];
    if (!col) continue;
    if (!headers.includes(col)) problems.push(`Column "${col}" mapped to ${f.label} does not exist in the file`);
    const prior = seen.get(col);
    if (prior) problems.push(`Column "${col}" is mapped to both ${prior} and ${f.label}`);
    seen.set(col, f.label);
  }
  return problems;
}
