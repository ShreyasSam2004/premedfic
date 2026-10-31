import { describe, expect, it } from "vitest";
import { runEvaluation } from "@/server/eval/harness";

/**
 * Regression gate over the synthetic evaluation fixtures. Safety-critical
 * metrics are hard zero-tolerance gates; extraction metrics have floors that
 * reflect the known limitations of the deterministic extractor.
 */
describe("evaluation harness", async () => {
  const r = await runEvaluation();

  it("has zero critical escalation failures", () => {
    expect(r.escalation.failures).toEqual([]);
    expect(r.escalation.highConcernCases).toBeGreaterThanOrEqual(10);
  });

  it("accepts zero fabricated claims through the provider gate", () => {
    expect(r.unsupportedClaims.fabricatedAccepted).toBe(0);
    expect(r.unsupportedClaims.unsupportedClaimRate).toBe(0);
  });

  it("classifies every labeled permit fixture as its rule set specifies", () => {
    expect(r.classification.mismatches).toEqual([]);
  });

  it("rejects every malformed upload and flags every injection attempt without workflow effects", () => {
    expect(r.malformedUploads.rejected).toBe(r.malformedUploads.cases);
    expect(r.promptInjection.flagged).toBe(r.promptInjection.maliciousDocs);
    expect(r.promptInjection.workflowEffects).toBe(0);
    expect(r.promptInjection.falsePositives).toBe(0);
  });

  it("keeps unknown fields unknown and detects missing evidence and conflicts", () => {
    expect(r.unknownFields.correctlyUnknown).toBe(r.unknownFields.cases);
    expect(r.missingEvidence.correct).toBe(r.missingEvidence.cases);
    expect(r.conflicts.correct).toBe(r.conflicts.cases);
  });

  it("meets extraction floors on synthetic documents", () => {
    expect(r.extraction.precision).toBeGreaterThanOrEqual(0.9);
    expect(r.extraction.recall).toBeGreaterThanOrEqual(0.85);
  });
});
