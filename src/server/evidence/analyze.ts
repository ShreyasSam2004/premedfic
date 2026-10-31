/**
 * Deterministic document analysis.
 *
 * Every extracted value carries the page, character offsets, and verbatim
 * quote it came from. If a pattern does not match, the field is reported as
 * unknown; nothing is inferred to fill the gap. Document text is untrusted
 * data and is never interpreted as instructions.
 */
import { z } from "zod";
import type { EvidenceType } from "@/domain/evidence";
import { normalizeDate } from "../imports/normalize";

export const EXTRACTOR_ID = "deterministic-patterns";
export const EXTRACTOR_VERSION = "1.0.0";

export interface ExtractedField {
  field: string;
  value: string;
  normalized: string | null;
  page: number;
  start: number;
  end: number;
  quote: string;
  method: string;
}

export interface Classification {
  type: EvidenceType;
  confidence: "high" | "medium" | "low" | "none";
  signals: string[];
  method: string;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const SIGNALS: Record<Exclude<EvidenceType, "photo" | "unknown">, RegExp[]> = {
  invoice: [/\binvoice\b/i, /\bamount due\b|\bbalance due\b/i, /\bbill to\b/i, /\bsubtotal\b/i, /\btotal\b/i, /\bremit\b/i],
  contract: [/\bagreement\b/i, /\bcontract\b/i, /\bscope of work\b/i, /\bowner'?s signature\b|\bsignature of owner\b/i, /\bterms and conditions\b/i],
  inspection_report: [/\binspection report\b/i, /\binspector\b/i, /\binspection (result|date|type)\b/i, /\b(passed|failed) inspection\b|\binspection:\s*(passed|failed)\b/i],
  permit_document: [/\bpermit application\b|\bapplication for (a )?(building )?permit\b/i, /\bbuilding permit\b/i, /\bpermit fee\b/i],
  completion_record: [/\bcertificate of completion\b|\bcompletion certificate\b/i, /\bengineer of record\b/i, /\bsealed\b|\bp\.?e\.?\s*(no|#|license)/i, /\bwork (is|was) complete(d)?\b/i],
  correspondence: [/^\s*dear\b/im, /\bsincerely\b/i, /\bregards\b/i],
  authorization_letter: [/\bauthori[sz]e\b|\bauthori[sz]ation\b/i, /\bon my behalf\b/i, /\bas my (agent|representative)\b/i],
};

export function classifyDocument(input: { mime: string; pages: string[]; declaredType?: string | null }): Classification {
  if (input.mime.startsWith("image/")) {
    return { type: "photo", confidence: "high", signals: [`file content is ${input.mime}`], method: "mime-sniff" };
  }
  const text = input.pages.join("\n");
  if (text.trim().length < 20) return { type: "unknown", confidence: "none", signals: ["no extractable text"], method: `${EXTRACTOR_ID}/${EXTRACTOR_VERSION}` };
  let best: { type: EvidenceType; hits: string[] } = { type: "unknown", hits: [] };
  for (const [type, patterns] of Object.entries(SIGNALS)) {
    const hits = patterns.filter((p) => p.test(text)).map((p) => p.source.slice(0, 40));
    if (hits.length > best.hits.length) best = { type: type as EvidenceType, hits };
  }
  const n = best.hits.length;
  if (n === 0) return { type: "unknown", confidence: "none", signals: [], method: `${EXTRACTOR_ID}/${EXTRACTOR_VERSION}` };
  return {
    type: best.type,
    confidence: n >= 3 ? "high" : n === 2 ? "medium" : "low",
    signals: best.hits,
    method: `${EXTRACTOR_ID}/${EXTRACTOR_VERSION}`,
  };
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

const DATE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})`;

interface FieldPattern {
  field: string;
  re: RegExp;
  all?: boolean;
  normalize?: (v: string) => string | null;
}

const FIELD_PATTERNS: FieldPattern[] = [
  { field: "permit_reference", re: /\bpermit\s*(?:no\.?|number|#|id)?\s*[:#]?\s*([A-Z]{2,}(?:-?[A-Z]{2,})*-?\s?\d{2,4}-?\s?\d{2,7})\b/dgi, all: true },
  { field: "invoice_number", re: /\binvoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,19})\b/dgi },
  { field: "invoice_date", re: new RegExp(String.raw`\binvoice\s+date\s*:?\s*${DATE}`, "dgi"), normalize: (v) => normalizeDate(v).value },
  {
    field: "completion_date",
    re: new RegExp(String.raw`\b(?:date\s+of\s+completion|completion\s+date|work\s+completed(?:\s+on)?|completed\s+on|date\s+completed)\s*:?\s*${DATE}`, "dgi"),
    normalize: (v) => normalizeDate(v).value,
  },
  { field: "contractor_license", re: /\b(?:license|lic\.?)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z]{2,4}\d{5,8})\b/dgi, normalize: (v) => v.toUpperCase() },
  { field: "contractor_name", re: /\b(?:contractor|company|remit\s+to)\s*:\s*([A-Z0-9][A-Za-z0-9&.,' -]{2,60}?)\s*(?:\n|$|\s{2,}|License|Lic\.)/dgm },
  // Letterhead: a line consisting only of a business name with a legal-entity suffix.
  { field: "contractor_name", re: /^([A-Z][A-Za-z0-9&.' -]{2,60}?\s(?:LLC|L\.L\.C\.|Inc\.?|Co\.|Corp\.?|Company|Corporation))\s*$/dgm },
  {
    field: "property_address",
    re: /\b(?:job\s*site|project\s+address|service\s+address|property\s+address|site\s+address|job\s+address)\s*:\s*(\d{1,6}\s+[A-Za-z0-9 .'-]{3,60}?)(?=\s*(?:\n|,|$|\s{2,}))/dgim,
  },
  { field: "total_amount", re: /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\s*:?\s*\$\s?([\d,]+(?:\.\d{2})?)/dgi },
  { field: "inspection_assertion", re: /\b(final\s+inspection[^\n]{0,40}?\b(?:passed|approved|failed|rejected))\b/dgi },
];

export function extractFields(pages: string[]): ExtractedField[] {
  const out: ExtractedField[] = [];
  const method = `${EXTRACTOR_ID}/${EXTRACTOR_VERSION}`;
  for (const p of FIELD_PATTERNS) {
    let found = false;
    for (let page = 0; page < pages.length; page++) {
      const text = pages[page];
      p.re.lastIndex = 0;
      for (const m of text.matchAll(p.re)) {
        const idx = m.indices?.[1];
        if (!idx) continue;
        const value = text.slice(idx[0], idx[1]).trim();
        if (!value) continue;
        const start = idx[0] + text.slice(idx[0], idx[1]).indexOf(value);
        if (out.some((o) => o.field === p.field && o.value === value)) continue;
        out.push({
          field: p.field,
          value,
          normalized: p.normalize ? p.normalize(value) : value,
          page: page + 1,
          start,
          end: start + value.length,
          quote: value,
          method,
        });
        found = true;
        if (!p.all) break;
      }
      if (found && !p.all) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Untrusted-instruction screening (prompt-injection defense)
// ---------------------------------------------------------------------------

const INSTRUCTION_PATTERNS = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|directions|rules)/gi,
  /disregard\s+(?:the|all|any|your)\s+(?:rules|instructions|guidelines)/gi,
  /\b(?:system\s+prompt|you\s+are\s+(?:an?|the)\s+(?:ai|assistant|language\s+model|reviewer))\b/gi,
  /\b(?:approve|close|clear|finali[sz]e|pass)\s+(?:this|the)\s+(?:permit|case|application|inspection)\b/gi,
  /\b(?:mark|set)\s+(?:this|the)\s+(?:case|permit)\s+(?:as\s+)?(?:approved|closed|passed|complete)\b/gi,
  /\bdo\s+not\s+(?:tell|inform|notify)\s+(?:the\s+)?(?:reviewer|inspector|official)\b/gi,
];

export interface InstructionHit {
  page: number;
  start: number;
  end: number;
  quote: string;
}

export function screenForInstructions(pages: string[]): InstructionHit[] {
  const hits: InstructionHit[] = [];
  pages.forEach((text, i) => {
    for (const re of INSTRUCTION_PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) hits.push({ page: i + 1, start: m.index!, end: m.index! + m[0].length, quote: m[0] });
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Provider output acceptance (applies to deterministic AND model providers)
// ---------------------------------------------------------------------------

/** Schema any extraction provider (including future LLM providers) must satisfy. */
export const providerFieldSchema = z.object({
  field: z.enum(["permit_reference", "invoice_number", "invoice_date", "completion_date", "contractor_license", "contractor_name", "property_address", "total_amount", "inspection_assertion"]),
  value: z.string().min(1).max(500),
  page: z.number().int().min(1),
  quote: z.string().min(1).max(500),
});
export const providerOutputSchema = z.object({ fields: z.array(providerFieldSchema).max(100) });

export interface AcceptanceResult {
  accepted: ExtractedField[];
  rejected: { field: unknown; reason: string }[];
}

/**
 * Validate structured provider output and require each value to be supported
 * by a verbatim quote that actually occurs on the cited page. Unsupported
 * claims are rejected, not repaired.
 */
export function acceptProviderOutput(raw: unknown, pages: string[], method: string): AcceptanceResult {
  const parsed = providerOutputSchema.safeParse(raw);
  if (!parsed.success) return { accepted: [], rejected: [{ field: raw, reason: "Output did not match the extraction schema" }] };
  const accepted: ExtractedField[] = [];
  const rejected: AcceptanceResult["rejected"] = [];
  for (const f of parsed.data.fields) {
    const text = pages[f.page - 1];
    if (text === undefined) {
      rejected.push({ field: f, reason: "Cited page does not exist" });
      continue;
    }
    const start = text.indexOf(f.quote);
    if (start < 0) {
      rejected.push({ field: f, reason: "Quote does not appear verbatim on the cited page" });
      continue;
    }
    if (!f.quote.toLowerCase().includes(f.value.toLowerCase().slice(0, 60))) {
      rejected.push({ field: f, reason: "Value is not contained in its supporting quote" });
      continue;
    }
    const normalized = f.field.endsWith("_date") ? normalizeDate(f.value).value : f.value;
    accepted.push({ field: f.field, value: f.value, normalized, page: f.page, start, end: start + f.quote.length, quote: f.quote, method });
  }
  return { accepted, rejected };
}
