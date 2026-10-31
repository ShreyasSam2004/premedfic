/**
 * Duplicate detection between permit records.
 *
 * Exact identity (same normalized permit number in the same jurisdiction) is
 * handled by the import upsert. This module finds *possible* duplicates that
 * need human reconciliation: records that differ in their identifiers but
 * likely describe the same permit.
 */
export interface DedupeRecord {
  id: string;
  permitNumber: string;
  permitKey: string;
  permitLooseKey: string;
  propertyKey: string | null;
  category: string | null;
  issuedAt: string | null;
  sourceSystem?: string | null;
}

export interface DuplicateMatch {
  a: string;
  b: string;
  score: number;
  reasons: string[];
}

export const DUPLICATE_THRESHOLD = 70;

function dayDiff(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

export function scorePair(x: DedupeRecord, y: DedupeRecord): { score: number; reasons: string[] } {
  if (x.id === y.id || x.permitKey === y.permitKey) return { score: 0, reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  if (x.permitLooseKey === y.permitLooseKey) {
    score += 80;
    reasons.push(`Permit IDs match after normalizing formatting (${x.permitNumber} vs ${y.permitNumber})`);
  }
  const sameProperty = Boolean(x.propertyKey && x.propertyKey === y.propertyKey);
  if (sameProperty) {
    score += 20;
    reasons.push("Same property");
  }
  // Within one source system a different permit number is a different permit
  // (separate trade permits for one project, separate units on one parcel), so
  // the property/category/date heuristic only applies across systems. "other"
  // means unclassified, which is not evidence of the same work.
  const sameSystem = Boolean(x.sourceSystem && x.sourceSystem === y.sourceSystem);
  if (sameProperty && !sameSystem && x.category && x.category !== "other" && x.category === y.category) {
    score += 15;
    reasons.push("Same permit category");
    if (x.issuedAt && y.issuedAt && dayDiff(x.issuedAt, y.issuedAt) <= 7) {
      score += 40;
      reasons.push("Issued within 7 days of each other");
    }
  }
  return { score: Math.min(score, 100), reasons };
}

/** Compare `targets` against `pool` (which may include targets). Returns each unordered pair once. */
export function findDuplicateCandidates(targets: DedupeRecord[], pool: DedupeRecord[]): DuplicateMatch[] {
  const byLoose = new Map<string, DedupeRecord[]>();
  const byProperty = new Map<string, DedupeRecord[]>();
  for (const r of pool) {
    byLoose.set(r.permitLooseKey, [...(byLoose.get(r.permitLooseKey) ?? []), r]);
    if (r.propertyKey) byProperty.set(r.propertyKey, [...(byProperty.get(r.propertyKey) ?? []), r]);
  }
  const seen = new Set<string>();
  const out: DuplicateMatch[] = [];
  for (const t of targets) {
    const candidates = new Map<string, DedupeRecord>();
    for (const c of byLoose.get(t.permitLooseKey) ?? []) candidates.set(c.id, c);
    for (const c of t.propertyKey ? (byProperty.get(t.propertyKey) ?? []) : []) candidates.set(c.id, c);
    for (const c of candidates.values()) {
      const pair = [t.id, c.id].sort().join(":");
      if (seen.has(pair)) continue;
      const { score, reasons } = scorePair(t, c);
      if (score >= DUPLICATE_THRESHOLD) {
        seen.add(pair);
        const [a, b] = [t.id, c.id].sort();
        out.push({ a, b, score, reasons });
      }
    }
  }
  return out;
}
