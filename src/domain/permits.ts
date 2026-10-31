/**
 * Canonical permit vocabulary. Client-safe: no server imports.
 */

export const PERMIT_CATEGORIES = [
  "roof",
  "window",
  "fence",
  "water_heater",
  "electrical_service",
  "gas",
  "structural",
  "addition",
  "hvac",
  "plumbing",
  "irrigation",
  "door",
  "other",
] as const;
export type PermitCategory = (typeof PERMIT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<PermitCategory, string> = {
  roof: "Roof replacement",
  window: "Window replacement",
  fence: "Fence installation",
  water_heater: "Water heater replacement",
  electrical_service: "Electrical service",
  gas: "Gas installation",
  structural: "Structural alteration",
  addition: "Addition",
  hvac: "HVAC replacement",
  plumbing: "Plumbing repair",
  irrigation: "Irrigation system",
  door: "Door replacement",
  other: "Other / unclassified",
};

/** Normalized status of the permit as reported by the source system (not the case workflow). */
export const SOURCE_STATUSES = ["issued", "active", "expired", "finaled", "void", "cancelled", "unknown"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  issued: "Issued",
  active: "Active",
  expired: "Expired",
  finaled: "Finaled",
  void: "Void",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

/** Canonical fields an import may map. `permitNumber` is the only field required to key a record. */
export const CANONICAL_FIELDS = [
  { key: "permitNumber", label: "Permit ID", required: true, essential: true },
  { key: "jurisdiction", label: "Jurisdiction", required: false, essential: false },
  { key: "parcelId", label: "Parcel / property identifier", required: false, essential: false },
  { key: "address", label: "Property address", required: false, essential: true },
  { key: "city", label: "City", required: false, essential: false },
  { key: "zip", label: "ZIP code", required: false, essential: false },
  { key: "category", label: "Permit category", required: false, essential: true },
  { key: "workDescription", label: "Work description", required: false, essential: false },
  { key: "issuedAt", label: "Issuance date", required: false, essential: true },
  { key: "expiresAt", label: "Expiration date", required: false, essential: false },
  { key: "status", label: "Current status", required: false, essential: false },
  { key: "finalInspectionAt", label: "Final inspection date", required: false, essential: false },
  { key: "contractorName", label: "Contractor name", required: false, essential: false },
  { key: "contractorLicense", label: "Contractor license", required: false, essential: false },
  { key: "ownerName", label: "Owner name", required: false, essential: false },
  { key: "ownerEmail", label: "Owner email", required: false, essential: false },
  { key: "ownerPhone", label: "Owner phone", required: false, essential: false },
  { key: "sourceSystem", label: "Source system", required: false, essential: false },
  { key: "sourceRecordId", label: "Source record identifier", required: false, essential: false },
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number]["key"];
export const ESSENTIAL_FIELDS = CANONICAL_FIELDS.filter((f) => f.essential).map((f) => f.key);
