/**
 * Extraction providers.
 *
 * The deterministic provider is the default and the only one shipped in this
 * MVP. A model-backed provider (LLM or vision) would implement the same
 * interface and is subject to two gates enforced here:
 *   1. The organization must have explicitly authorized third-party AI
 *      processing (`settings.aiProcessingAuthorized`).
 *   2. Its output passes through `acceptProviderOutput`: schema validation plus
 *      verbatim-quote verification. Unsupported claims are dropped.
 * Document text is passed as data only; provider output can never trigger a
 * workflow transition.
 */
import type { OrgSettings } from "../db/schema";
import { classifyDocument, EXTRACTOR_ID, EXTRACTOR_VERSION, extractFields, type Classification, type ExtractedField } from "./analyze";

export interface ExtractionInput {
  pages: string[];
  mime: string;
  declaredType: string | null;
}

export interface ExtractionOutput {
  classification: Classification;
  fields: ExtractedField[];
  provider: { id: string; version: string; kind: "deterministic" | "model"; model: string | null };
  rejected: { field: unknown; reason: string }[];
}

export interface ExtractionProvider {
  readonly id: string;
  readonly version: string;
  readonly kind: "deterministic" | "model";
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

export const deterministicProvider: ExtractionProvider = {
  id: EXTRACTOR_ID,
  version: EXTRACTOR_VERSION,
  kind: "deterministic",
  async extract(input) {
    return {
      classification: classifyDocument(input),
      fields: input.mime.startsWith("image/") ? [] : extractFields(input.pages),
      provider: { id: EXTRACTOR_ID, version: EXTRACTOR_VERSION, kind: "deterministic", model: null },
      rejected: [],
    };
  },
};

export function selectExtractionProvider(settings: OrgSettings): { provider: ExtractionProvider; note: string | null } {
  if (process.env.AI_PROVIDER && !settings.aiProcessingAuthorized) {
    return { provider: deterministicProvider, note: "AI provider configured but not authorized by this organization; deterministic extraction used." };
  }
  // No model adapter ships in this MVP.
  return { provider: deterministicProvider, note: null };
}
