import { describe, expect, it } from "vitest";
import { DUPLICATE_THRESHOLD, findDuplicateCandidates, scorePair, type DedupeRecord } from "@/server/imports/dedupe";

const rec = (id: string, permitNumber: string, extra: Partial<DedupeRecord> = {}): DedupeRecord => {
  const key = permitNumber.replace(/\s+/g, "").toUpperCase();
  const letters = key.replace(/[^A-Z]/g, "");
  const nums = (key.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));
  return { id, permitNumber, permitKey: key, permitLooseKey: [letters, ...nums].join("|"), propertyKey: null, category: null, issuedAt: null, ...extra };
};

describe("duplicate detection", () => {
  it("flags the same permit formatted differently across systems", () => {
    const a = rec("a", "LKM-BLD-2018-00412", { propertyKey: "p1", category: "roof", issuedAt: "2018-05-21" });
    const b = rec("b", "LKMBLD2018-412", { propertyKey: "p1", category: "roof", issuedAt: "2018-05-21" });
    const m = findDuplicateCandidates([b], [a, b]);
    expect(m).toHaveLength(1);
    expect(m[0].score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(m[0].reasons.join(" ")).toMatch(/normalizing formatting/);
  });

  it("flags same property + category + near-identical issue date even with different IDs", () => {
    const a = rec("a", "BLD-1", { propertyKey: "p1", category: "fence", issuedAt: "2020-01-01" });
    const b = rec("b", "OLD-99", { propertyKey: "p1", category: "fence", issuedAt: "2020-01-04" });
    expect(scorePair(a, b).score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("does not flag distinct permits at the same property", () => {
    const a = rec("a", "BLD-1", { propertyKey: "p1", category: "roof", issuedAt: "2015-01-01" });
    const b = rec("b", "BLD-2", { propertyKey: "p1", category: "roof", issuedAt: "2021-06-01" });
    const c = rec("c", "BLD-3", { propertyKey: "p1", category: "fence", issuedAt: "2015-01-02" });
    expect(findDuplicateCandidates([a, b, c], [a, b, c])).toHaveLength(0);
  });

  it("does not treat two unclassified permits at one property as the same work", () => {
    // Austin issues separate mechanical and plumbing permits for one new house on the same day.
    const a = rec("a", "2021-101 MP", { propertyKey: "p1", category: "other", issuedAt: "2021-03-01" });
    const b = rec("b", "2021-102 PP", { propertyKey: "p1", category: "other", issuedAt: "2021-03-01" });
    expect(scorePair(a, b).score).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it("treats different permit numbers from the same source system as distinct permits", () => {
    const sys = { sourceSystem: "City of Austin open data (3syk-w9eu)" };
    const a = rec("a", "2019-238152 BP", { propertyKey: "p1", category: "window", issuedAt: "2019-10-01", ...sys });
    const b = rec("b", "2019-238211 BP", { propertyKey: "p1", category: "window", issuedAt: "2019-10-01", ...sys });
    expect(scorePair(a, b).score).toBeLessThan(DUPLICATE_THRESHOLD);
    // The same permit number reformatted is still flagged within one system.
    const c = rec("c", "2019-0238152 BP", { propertyKey: "p1", category: "window", issuedAt: "2019-10-01", ...sys });
    expect(scorePair(a, c).score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("ignores exact identity (handled by upsert) and reports each pair once", () => {
    const a = rec("a", "X-1");
    expect(scorePair(a, { ...a, id: "z" }).score).toBe(0);
    const p = rec("p", "Q-0001");
    const q = rec("q", "Q1");
    expect(findDuplicateCandidates([p, q], [p, q])).toHaveLength(1);
  });
});
