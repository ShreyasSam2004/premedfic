/**
 * Runs PremedFix's import normalization, duplicate detection, and triage
 * engine over the City of Austin's public permit dataset (expired residential
 * permits) and writes a report.
 *   npm run analyze:austin              # reuses the cached download in .data/austin
 *   npm run analyze:austin -- --refresh # downloads again
 *
 * Read-only: nothing is written to the application database and nobody is
 * contacted. Contractor and applicant names and phone numbers are not
 * downloaded. The report contains aggregates only, no addresses.
 */
import fs from "node:fs";
import path from "node:path";
import { CATEGORY_LABELS, type PermitCategory } from "../src/domain/permits";
import type { TriageClassification } from "../src/domain/triage";
import { AUSTIN_COLUMNS, AUSTIN_DATASET, AUSTIN_MAPPING, austinToCanonical, type AustinRow } from "../src/server/imports/austin";
import { findDuplicateCandidates, type DedupeRecord } from "../src/server/imports/dedupe";
import { normalizeRow, type NormalizedPermitRow } from "../src/server/imports/normalize";
import { parseRuleSetConfig } from "../src/server/rules/config";
import { LAKEMONT_RULESET } from "../src/server/rules/defaults";
import { runTriage, type TriageInput, type TriageOutput } from "../src/server/triage/engine";
import { compareRuleSets } from "../src/server/rules/impact";
import { defaultCategoryRule } from "../src/domain/rule-library";

const OUT_DIR = path.resolve(".data/austin");
/** Aggregates only (no addresses or descriptions); committed so the app's Austin page works offline. */
const SNAPSHOT_FILE = path.resolve("src/data/austin-report.json");
const ROWS_FILE = path.join(OUT_DIR, "expired-residential.json");
const MASTERS_FILE = path.join(OUT_DIR, "master-permits.json");
const WHERE = "status_current in('Expired','Expired - License') AND permit_class_mapped='Residential'";
const PAGE = 50_000;
const refresh = process.argv.includes("--refresh");

async function soda<T>(params: Record<string, string>, attempt = 1): Promise<T> {
  const url = `${AUSTIN_DATASET.api}?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return soda(params, attempt + 1);
  }
}

async function loadRows(): Promise<{ fetchedAt: string; rows: AustinRow[] }> {
  if (!refresh && fs.existsSync(ROWS_FILE)) return JSON.parse(fs.readFileSync(ROWS_FILE, "utf8"));
  const rows: AustinRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await soda<AustinRow[]>({ $select: AUSTIN_COLUMNS.join(","), $where: WHERE, $order: ":id", $limit: String(PAGE), $offset: String(offset) });
    rows.push(...page);
    console.log(`  downloaded ${rows.length.toLocaleString()} rows`);
    if (page.length < PAGE) break;
  }
  const data = { fetchedAt: new Date().toISOString(), rows };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(ROWS_FILE, JSON.stringify(data));
  return data;
}

type MasterRow = { project_id: string; permittype?: string; status_current?: string };

async function loadMasters(ids: string[]): Promise<Map<string, MasterRow>> {
  let cache: { looked: string[]; found: MasterRow[] } = { looked: [], found: [] };
  if (!refresh && fs.existsSync(MASTERS_FILE)) cache = JSON.parse(fs.readFileSync(MASTERS_FILE, "utf8"));
  const cached = cache.found;
  const looked = new Set(cache.looked);
  const todo = ids.filter((id) => !looked.has(id) && /^\d+$/.test(id));
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += 250) batches.push(todo.slice(i, i + 250));
  let done = 0;
  const worker = async () => {
    for (let b = batches.shift(); b; b = batches.shift()) {
      cached.push(...(await soda<MasterRow[]>({ $select: "project_id,permittype,status_current", $where: `project_id in(${b.join(",")})`, $limit: "1000" })));
      if (++done % 25 === 0) console.log(`  looked up ${done} of ${Math.ceil(todo.length / 250)} parent-permit batches`);
    }
  };
  if (todo.length) await Promise.all(Array.from({ length: 6 }, worker));
  fs.writeFileSync(MASTERS_FILE, JSON.stringify({ looked: [...looked, ...todo], found: cached }));
  return new Map(cached.map((m) => [m.project_id, m]));
}

const REPERMITS_FILE = path.join(OUT_DIR, "repermits.json");
const REPERMIT_WHERE = ["RE-PERMIT", "REPERMIT", "RE PERMIT", "EXPIRED PERMIT", "EXPIRED BP", "EXPIRED EP", "EXPIRED MP", "EXPIRED PP"]
  .map((p) => `upper(description) like '%${p}%'`)
  .join(" OR ");
type RepermitRow = { permit_number?: string; status_current?: string; description?: string };

/** Later permits (any class or status) whose descriptions cite re-permitting an expired permit. */
async function loadRepermits(): Promise<RepermitRow[]> {
  if (!refresh && fs.existsSync(REPERMITS_FILE)) return JSON.parse(fs.readFileSync(REPERMITS_FILE, "utf8"));
  const rows: RepermitRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await soda<RepermitRow[]>({ $select: "permit_number,status_current,description", $where: REPERMIT_WHERE, $order: ":id", $limit: String(PAGE), $offset: String(offset) });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  fs.writeFileSync(REPERMITS_FILE, JSON.stringify(rows));
  return rows;
}

/** Austin permit numbers are "YYYY-NNNNNN XX"; the year-number base identifies the project. */
const permitBase = (permitNumber: string | undefined) => permitNumber?.match(/^(\d{4}-\d{6})/)?.[1] ?? null;
function citedBases(desc: string): string[] {
  return [...desc.matchAll(/\b((?:19|20)\d{2}|\d{2})-(\d{5,6})\b/g)].map(([, y, n]) => `${y.length === 2 ? (+y <= 30 ? "20" : "19") + y : y}-${n.padStart(6, "0")}`);
}

// ---------------------------------------------------------------------------

const tally = <K extends string>() => new Map<K, number>();
const bump = <K extends string>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sorted = <K extends string>(m: Map<K, number>) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function yearBucket(issuedAt: string | null) {
  const y = issuedAt ? +issuedAt.slice(0, 4) : NaN;
  if (Number.isNaN(y)) return "unknown";
  if (y < 2000) return "before 2000";
  if (y < 2010) return "2000-2009";
  if (y < 2020) return "2010-2019";
  return "2020 or later";
}

/** Deterministic sample for spot checks (same rows on every run). */
function sample<T>(items: T[], n: number, seed = 7): T[] {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  const t0 = Date.now();
  console.log(`\nAustin permit analysis — ${AUSTIN_DATASET.publisher}, "${AUSTIN_DATASET.name}" (${AUSTIN_DATASET.id})`);
  const { fetchedAt, rows } = await loadRows();
  const asOf = fetchedAt.slice(0, 10);
  console.log(`  ${rows.length.toLocaleString()} expired residential permits (downloaded ${fetchedAt})`);

  const parsed = parseRuleSetConfig(LAKEMONT_RULESET);
  if (!parsed.ok) throw new Error(`Default rule set is invalid: ${parsed.errors.join("; ")}`);
  // PremedFix's default rules, NOT Austin policy; unverified for this jurisdiction.
  const ruleSet = { id: "premedfix-default", version: 1, verified: false, config: parsed.config };

  // 1. Normalize through the importer's pipeline.
  type Item = { src: AustinRow; rec: NormalizedPermitRow; basis: string };
  const items: Item[] = [];
  const rejected = tally<string>();
  const warnings = tally<string>();
  for (const src of rows) {
    const { raw, derivation } = austinToCanonical(src);
    const r = normalizeRow(raw, AUSTIN_MAPPING);
    for (const w of r.warnings) if (w.field !== "category") bump(warnings, `${w.field}: ${w.message.replace(/".*"/, "…")}`);
    if (!r.ok || !r.record) {
      for (const e of r.errors) bump(rejected, e);
      continue;
    }
    if (r.record.category !== derivation.category) throw new Error(`Category round-trip failed for ${r.record.permitNumber}`);
    items.push({ src, rec: r.record, basis: derivation.basis });
  }

  // 2. Possible-duplicate detection, as the importer runs it.
  const dedupe: DedupeRecord[] = items.map((it, i) => ({
    id: String(i),
    permitNumber: it.rec.permitNumber,
    permitKey: it.rec.permitKey,
    permitLooseKey: it.rec.permitLooseKey,
    propertyKey: it.rec.parcelId ?? it.rec.addressKey,
    category: it.rec.category,
    issuedAt: it.rec.issuedAt,
    sourceSystem: it.rec.sourceSystem,
  }));
  const dupCount = new Map<number, number>();
  for (const m of findDuplicateCandidates(dedupe, dedupe)) for (const id of [m.a, m.b]) dupCount.set(+id, (dupCount.get(+id) ?? 0) + 1);

  // 3. Triage every record with the real engine.
  const inputs: Omit<TriageInput, "ruleSet">[] = items.map((it, i) => ({
    permit: {
      permitNumber: it.rec.permitNumber,
      category: it.rec.category,
      rawCategory: it.rec.rawCategory,
      workDescription: it.rec.workDescription,
      address: it.rec.address,
      issuedAt: it.rec.issuedAt,
      expiresAt: it.rec.expiresAt,
      sourceStatus: it.rec.sourceStatus,
      finalInspectionAt: it.rec.finalInspectionAt,
      missingFields: it.rec.missingFields,
    },
    passedFinalInspection: false,
    openDuplicateCandidates: dupCount.get(i) ?? 0,
    // Austin's public data carries no owner contact; staff look up the owner of record.
    contacts: { total: 0, contactable: 0 },
    asOf,
  }));
  const results: { it: Item; out: TriageOutput }[] = items.map((it, i) => ({ it, out: runTriage({ ...inputs[i], ruleSet }) }));

  // What-if: the rule editor's impact preview, with a draft that adds a
  // standard-concern HVAC rule. A policy choice for Austin's building official.
  const hvacConfig = parseRuleSetConfig({ ...parsed.config, categories: { ...parsed.config.categories, hvac: defaultCategoryRule("hvac") } });
  if (!hvacConfig.ok) throw new Error(`HVAC draft is invalid: ${hvacConfig.errors.join("; ")}`);
  const hvacImpact = compareRuleSets(
    items.map((it, i) => ({ key: String(i), permitNumber: it.rec.permitNumber, caseId: null, category: it.rec.category, input: inputs[i] })),
    ruleSet,
    { ...ruleSet, id: "premedfix-default-hvac", version: 2, config: hvacConfig.config },
  );

  // 4. Related-record signal (outside the engine): parent permit already finaled.
  const masterIds = [...new Set(rows.map((r) => r.masterpermitnum).filter(Boolean) as string[])];
  console.log(`  looking up ${masterIds.length.toLocaleString()} parent permits`);
  const masters = await loadMasters(masterIds);
  const repermits = await loadRepermits();
  const citedByFinal = new Set<string>();
  for (const rp of repermits) {
    if (rp.status_current !== "Final") continue;
    const own = permitBase(rp.permit_number);
    for (const b of citedBases(rp.description ?? "")) if (b !== own) citedByFinal.add(b);
  }

  // ---------------------------------------------------------------------------
  const total = rows.length;
  const byClass = tally<TriageClassification>();
  const byCategory = tally<string>();
  const evidenceByCategory = tally<string>();
  const evidenceByAge = tally<string>();
  const allByAge = tally<string>();
  const byYear = new Map<number, { expired: number; remoteEligible: number }>();
  const specialistBy = tally<string>();
  const staffReasons = tally<string>();
  const unmodeledWork = tally<string>();
  const reconReasons = tally<string>();
  const priority = tally<string>();
  const basis = tally<string>();
  const legacy = { completedDate: 0, completedDatePre2007: 0, statusBulk20070606: 0, issuedBefore2007: 0 };
  const parent = { withParent: 0, parentFound: 0, parentFinal: 0, parentFinalByClass: tally<TriageClassification>() };
  const repermitted = { count: 0, byClass: tally<TriageClassification>() };
  let eitherSignal = 0;
  const waterHeaters = { fuelNotStated: 0, tankless: 0 };
  let tcad = 0;
  const spot = new Map<string, string[]>();

  for (const { it, out } of results) {
    const s = it.src;
    bump(byClass, out.classification);
    bump(byCategory, CATEGORY_LABELS[it.rec.category as PermitCategory] ?? "Missing");
    bump(basis, it.basis);
    bump(priority, out.priority);
    bump(allByAge, yearBucket(it.rec.issuedAt));
    if (it.rec.issuedAt) {
      const y = byYear.get(+it.rec.issuedAt.slice(0, 4)) ?? { expired: 0, remoteEligible: 0 };
      y.expired++;
      if (out.classification === "EVIDENCE_COLLECTION") y.remoteEligible++;
      byYear.set(+it.rec.issuedAt.slice(0, 4), y);
    }
    if (it.rec.parcelId) tcad++;
    const triggered = out.outcomes.filter((o) => o.outcome === "triggered");

    if (out.classification === "EVIDENCE_COLLECTION") {
      bump(evidenceByCategory, CATEGORY_LABELS[it.rec.category as PermitCategory]);
      bump(evidenceByAge, yearBucket(it.rec.issuedAt));
      const key = `Remote-eligible: ${CATEGORY_LABELS[it.rec.category as PermitCategory]}`;
      spot.set(key, [...(spot.get(key) ?? []), `${s.permittype} ${s.work_class} | ${s.description ?? ""}`]);
      if (it.rec.category === "water_heater") {
        if (!/electric/i.test(s.description ?? "")) waterHeaters.fuelNotStated++;
        if (/tank-?less/i.test(s.description ?? "")) waterHeaters.tankless++;
      }
    }
    if (out.classification === "SPECIALIST_REVIEW") {
      const byCat = triggered.some((o) => o.ruleId === "R-SAFE-001");
      const byText = triggered.some((o) => o.ruleId === "R-SAFE-002");
      bump(specialistBy, `${out.specialistDiscipline ?? "specialist"} — ${byCat && byText ? "category and description" : byCat ? "category" : "description only"}`);
    }
    if (out.classification === "STAFF_REVIEW") {
      for (const o of triggered) if (o.effects.classification === "STAFF_REVIEW") bump(staffReasons, `${o.ruleId}: ${o.title}`);
      if (triggered.some((o) => o.ruleId === "R-RULE-001" && o.effects.classification === "STAFF_REVIEW")) {
        bump(unmodeledWork, `${s.permit_type_desc ?? s.permittype} — ${s.work_class || "(no work class)"}`);
      }
    }
    if (out.classification === "DATA_RECONCILIATION") {
      for (const o of triggered) if (o.effects.classification === "DATA_RECONCILIATION") bump(reconReasons, `${o.ruleId}: ${o.title}`);
    }
    if (s.completed_date) {
      legacy.completedDate++;
      if (s.completed_date < "2007") legacy.completedDatePre2007++;
    }
    if (s.statusdate?.startsWith("2007-06-06")) legacy.statusBulk20070606++;
    if ((it.rec.issuedAt ?? "9999") < "2007") legacy.issuedBefore2007++;
    let parentFinal = false;
    if (s.masterpermitnum) {
      parent.withParent++;
      const m = masters.get(s.masterpermitnum);
      if (m) {
        parent.parentFound++;
        if (m.status_current === "Final") {
          parentFinal = true;
          parent.parentFinal++;
          bump(parent.parentFinalByClass, out.classification);
        }
      }
    }
    const base = permitBase(s.permit_number);
    const cited = Boolean(base && citedByFinal.has(base));
    if (cited) {
      repermitted.count++;
      bump(repermitted.byClass, out.classification);
    }
    if (cited || parentFinal) eitherSignal++;
  }
  for (const [k, v] of [...spot]) spot.set(k, sample(v, 30));

  const evidence = byClass.get("EVIDENCE_COLLECTION") ?? 0;
  const report = {
    dataset: { ...AUSTIN_DATASET, filter: WHERE, fetchedAt, asOf },
    ruleSet: "PremedFix default rule set (same configuration as the Lakemont demo). Not Austin policy; unverified for Austin.",
    engine: results[0]?.out.engineVersion,
    totals: { expiredResidential: total, normalized: items.length, rejected: sorted(rejected), withParcelId: tcad, withParcelIdPct: pct(tcad, items.length) },
    headline: {
      remoteEligible: evidence,
      remoteEligiblePct: pct(evidence, total),
      definition:
        "Classified EVIDENCE_COLLECTION: owner submits documents, staff review, an authorized official decides. The rules require no specialist and no site inspection; the official may still require one.",
      conservativeFloor: evidence - waterHeaters.fuelNotStated,
      conservativeFloorPct: pct(evidence - waterHeaters.fuelNotStated, total),
      conservativeFloorNote: "Excludes water-heater replacements whose description does not say electric. Austin's data does not record fuel type, and gas-fired units warrant more caution.",
      waterHeaters,
    },
    classification: Object.fromEntries([...byClass].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { count: v, pct: pct(v, total) }])),
    remoteEligibleByCategory: sorted(evidenceByCategory),
    remoteEligibleByIssueYear: sorted(evidenceByAge),
    allByIssueYear: sorted(allByAge),
    byIssueYear: [...byYear].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v })),
    specialistReview: sorted(specialistBy),
    staffReviewReasons: sorted(staffReasons),
    largestUnmodeledWorkTypes: Object.fromEntries(Object.entries(sorted(unmodeledWork)).slice(0, 12)),
    dataReconciliationReasons: sorted(reconReasons),
    priority: sorted(priority),
    derivedCategory: sorted(byCategory),
    derivationBasis: sorted(basis),
    whatIf: {
      likeForLikeHvacChangeOuts: hvacImpact.lessCautious.toDocumentReview,
      remoteEligiblePctIfIncluded: pct(hvacImpact.classification.EVIDENCE_COLLECTION.after, total),
      lessCautious: hvacImpact.lessCautious.total,
      note: "Engine run with a draft rule set that adds a standard-concern HVAC rule (the rule editor's impact preview). Single-scope mechanical change-outs only; furnaces, boilers, heaters, gas, and electrical work stay excluded. A policy choice for Austin's building official, not applied.",
    },
    legacyRecords: { ...legacy, completedDatePct: pct(legacy.completedDate, total), issuedBefore2007Pct: pct(legacy.issuedBefore2007, total) },
    parentPermitSignal: {
      withParent: parent.withParent,
      parentFound: parent.parentFound,
      parentFinal: parent.parentFinal,
      parentFinalPct: pct(parent.parentFinal, total),
      parentFinalByClassification: sorted(parent.parentFinalByClass),
      note: "Expired permits whose parent permit (masterpermitnum) has status Final. A related-record signal for staff, not used by the triage engine and not proof the child work was inspected.",
    },
    repermitSignal: {
      finaledRepermitsScanned: repermits.filter((r) => r.status_current === "Final").length,
      expiredCitedByFinaledRepermit: repermitted.count,
      pct: pct(repermitted.count, total),
      byClassification: sorted(repermitted.byClass),
      note: "Expired permits whose project number is cited in the description of a later permit with status Final that mentions re-permitting or an expired permit. Likely superseded; staff confirm against AMANDA. Not used by the triage engine.",
    },
    relatedRecordSignals: { eitherSignal, pct: pct(eitherSignal, total) },
    normalizationWarnings: sorted(warnings),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  const spotMd = [...spot].map(([k, v]) => `## ${k}\n\n${v.map((d) => `- ${d.replace(/\s+/g, " ").slice(0, 220)}`).join("\n")}`).join("\n\n");
  fs.writeFileSync(path.join(OUT_DIR, "spot-check.md"), `# Spot check (deterministic sample of 30 per category)\n\n${spotMd}\n`);

  console.log(`\n  Remote-eligible (document-based pathway): ${evidence.toLocaleString()} of ${total.toLocaleString()} = ${report.headline.remoteEligiblePct}%`);
  console.table(Object.fromEntries(Object.entries(report.classification).map(([k, v]) => [k, `${v.count.toLocaleString()} (${v.pct}%)`])));
  console.table(report.remoteEligibleByCategory);
  console.log(`  Report: ${path.relative(process.cwd(), path.join(OUT_DIR, "report.json"))}  Spot check: ${path.relative(process.cwd(), path.join(OUT_DIR, "spot-check.md"))}`);
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await main();
