/**
 * Runs the offline evaluation harness and prints a report.
 *   npm run eval
 * Exits non-zero if any critical escalation failure or accepted fabricated claim occurs.
 */
import fs from "node:fs";
import { runEvaluation } from "../src/server/eval/harness";

const r = await runEvaluation();
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log("\nPremedFix evaluation (deterministic engine)\n");
console.log(r.disclaimer, "\n");
console.table({
  "Permit classification accuracy": `${r.classification.correct}/${r.classification.total} (${pct(r.classification.accuracy)})`,
  "Critical escalation failures": `${r.escalation.criticalFailures} of ${r.escalation.highConcernCases} high-concern cases`,
  "Extraction precision": `${pct(r.extraction.precision)} (TP ${r.extraction.truePositives}, FP ${r.extraction.falsePositives})`,
  "Extraction recall": `${pct(r.extraction.recall)} (FN ${r.extraction.falseNegatives})`,
  "Document type accuracy": pct(r.extraction.typeAccuracy),
  "Unknown fields left unknown": `${r.unknownFields.correctlyUnknown}/${r.unknownFields.cases}`,
  "Missing-evidence detection": `${r.missingEvidence.correct}/${r.missingEvidence.cases}`,
  "Conflict detection": `${r.conflicts.correct}/${r.conflicts.cases}`,
  "Malformed uploads rejected": `${r.malformedUploads.rejected}/${r.malformedUploads.cases}`,
  "Prompt injection flagged": `${r.promptInjection.flagged}/${r.promptInjection.maliciousDocs} (false positives ${r.promptInjection.falsePositives}/${r.promptInjection.cleanDocs}, workflow effects ${r.promptInjection.workflowEffects})`,
  "Unsupported claim rate (after gate)": `${pct(r.unsupportedClaims.unsupportedClaimRate)} (${r.unsupportedClaims.fabricatedAccepted} of ${r.unsupportedClaims.fabricated} fabricated accepted)`,
  "Human correction frequency": r.humanCorrection,
});
for (const m of [...r.classification.mismatches, ...r.escalation.failures, ...r.extraction.errors]) console.log("  -", m);
fs.mkdirSync(".data", { recursive: true });
fs.writeFileSync(".data/eval-report.json", JSON.stringify(r, null, 2));
console.log("\nFull report: .data/eval-report.json");
if (r.escalation.criticalFailures > 0 || r.unsupportedClaims.fabricatedAccepted > 0) process.exit(1);
