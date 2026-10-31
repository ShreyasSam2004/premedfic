/**
 * Deterministic synthetic permit dataset for the fictional City of Lakemont
 * and the Town of Cedar Bluff (Florida reference jurisdiction).
 *
 * Rows deliberately imitate a messy legacy export: inconsistent date formats,
 * status spellings and category labels, missing values, invalid dates,
 * malformed contact details, and a duplicate record from a second system.
 * All people, companies, and addresses are fictional.
 */
import Papa from "papaparse";

export const LEGACY_HEADERS = [
  "PERMIT_NO",
  "JURIS",
  "PARCEL",
  "SITE_ADDRESS",
  "CITY",
  "ZIP",
  "PERMIT_TYPE",
  "DESCRIPTION",
  "ISSUED",
  "EXPIRES",
  "STATUS",
  "FINAL_DATE",
  "CONTRACTOR",
  "LIC_NO",
  "OWNER_NAME",
  "OWNER_EMAIL",
  "OWNER_PHONE",
  "SOURCE_SYS",
  "RECORD_ID",
] as const;
type Row = Record<(typeof LEGACY_HEADERS)[number], string>;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STREETS = [
  "Magnolia Ave", "Cypress St", "Lakeview Dr", "Heron Ct", "Orange Blossom Ln", "Pinecrest Rd", "Willow Bend Way", "Juniper Pl",
  "Sabal Palm Cir", "Bayhill Blvd", "Kingfisher Ter", "Osprey Ridge Rd", "Elm St", "Cedar Ln", "Maple Ave", "Harbor View Dr",
  "Live Oak Trl", "Bluebird Ln", "Seminole Way", "Palmetto St",
];
const FIRST = ["Dana", "Marcus", "Priya", "Luis", "Grace", "Tomas", "Aisha", "Ben", "Carmen", "Devon", "Elena", "Frank", "Hana", "Isaac", "June", "Kofi", "Leah", "Mateo", "Nora", "Omar", "Paula", "Quentin", "Rosa", "Silas", "Tara", "Victor", "Wren", "Yusuf"];
const LAST = ["Whitfield", "Bell", "Raman", "Ortega", "Kim", "Novak", "Hassan", "Fischer", "Delgado", "Brooks", "Petrova", "Lindqvist", "Sato", "Mensah", "Okafor", "Romero", "Abbott", "Castillo", "Nguyen", "Farrell", "Moreau", "Iverson"];

const CONTRACTORS: Record<string, [string, string][]> = {
  roof: [["Sunshine Roofing LLC", "CCC1331"], ["Lakemont Roof Pros Inc.", "CCC1329"], ["Peak Shingle Co.", "CCC1330"]],
  window: [["Clearview Window & Door Co.", "CGC1517"], ["Bright Pane Installers LLC", "CBC1259"]],
  fence: [["Heritage Fence Company", ""], ["Straightline Fencing LLC", ""]],
  water_heater: [["BlueFlame Plumbing LLC", "CFC1428"], ["Lakemont Plumbing & Drain Inc.", "CFC1426"]],
  electrical_service: [["Brightline Electric Inc.", "EC1300"], ["Volt Masters LLC", "EC1301"]],
  gas: [["Coastal Gas Services LLC", "LP2100"]],
  structural: [["Redwood Structural Corp.", "CGC1520"], ["Keystone Builders Inc.", "CGC1519"]],
  addition: [["Keystone Builders Inc.", "CGC1519"], ["Homestead Construction LLC", "CBC1262"]],
  other: [["Poolside Barriers LLC", ""]],
};

const TYPE_LABELS: Record<string, string[]> = {
  roof: ["RES RE-ROOF", "Re-Roof - Shingle", "Roofing", "REROOF RESIDENTIAL", "Roof Replacement"],
  window: ["WINDOW/DOOR REPL", "Window Replacement", "Windows - Res"],
  fence: ["Fence", "FENCE - RES", "Fence Installation"],
  water_heater: ["WATER HEATER", "Water Heater Replacement", "W/H CHANGE OUT"],
  electrical_service: ["ELEC SVC CHANGE", "Electrical - Service Upgrade", "ELECTRICAL SERVICE"],
  gas: ["GAS PIPING", "Gas Line - Res", "FUEL GAS"],
  structural: ["STRUCT REPAIR", "Structural Alteration", "BLDG ALT - STRUCTURAL"],
  addition: ["Room Addition", "RES ADDITION", "Addition - Bedroom"],
  other: ["Pool Barrier", "Demolition - Shed"],
};

const DESCRIPTIONS: Record<string, string[]> = {
  roof: ["Tear off and replace asphalt shingles", "Re-roof with architectural shingles, replace underlayment", "Replace metal roof panels", "Re-roof, 32 squares, replace drip edge"],
  window: ["Replace 8 windows, same size openings", "Replace sliding glass door and 4 windows", "Impact window replacement, 11 openings"],
  fence: ["Install 6 ft wood privacy fence, rear yard", "Install 4 ft aluminum fence with gate", "Replace existing chain-link fence"],
  water_heater: ["Replace 50 gal electric water heater", "Replace 40 gal electric water heater, same location", "Replace water heater in garage"],
  electrical_service: ["Upgrade service from 100A to 200A, replace meter base and main panel", "Replace main electrical panel", "Service change, relocate meter"],
  gas: ["Install gas line to range and dryer", "New gas piping for tankless water heater", "Replace gas line to pool heater"],
  structural: ["Repair load-bearing wall, install new header beam", "Foundation repair, underpin rear wall", "Replace damaged roof trusses"],
  addition: ["Add 320 sq ft bedroom addition", "Screen room addition on existing slab", "Add second-story bonus room"],
  other: ["Pool safety barrier installation", "Demolish detached shed"],
};

const CATEGORY_WEIGHTS: [string, number][] = [
  ["roof", 30], ["window", 15], ["fence", 11], ["water_heater", 13], ["electrical_service", 9], ["gas", 5], ["structural", 5], ["addition", 5], ["other", 3],
];

const PREFIX: Record<string, string> = { roof: "BLD", window: "BLD", fence: "BLD", structural: "BLD", addition: "BLD", other: "BLD", water_heater: "PLM", electrical_service: "ELE", gas: "GAS" };

type DateFmt = "iso" | "us" | "us2" | "mon" | "compact";
function fmtDate(iso: string, f: DateFmt) {
  const [y, m, d] = iso.split("-");
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(m) - 1];
  switch (f) {
    case "iso":
      return iso;
    case "us":
      return `${Number(m)}/${Number(d)}/${y}`;
    case "us2":
      return `${m}/${d}/${y.slice(2)}`;
    case "mon":
      return `${d}-${mon}-${y}`;
    case "compact":
      return `${y}${m}${d}`;
  }
}

function addDaysIso(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface ScenarioIndex {
  roofForEvidence: string[];
  electrical: string;
  electricalInspection: string;
  duplicateA: string;
  duplicateB: string;
  unreachable: string;
  conflict: string;
  readyForDisposition: string;
  pendingConfirmation: string;
}

export const SCENARIOS: ScenarioIndex = {
  roofForEvidence: [],
  electrical: "LKM-ELE-2016-00388",
  electricalInspection: "LKM-ELE-2017-00502",
  duplicateA: "LKM-BLD-2018-00412",
  duplicateB: "LKMBLD2018-412",
  unreachable: "LKM-BLD-2015-01877",
  conflict: "LKM-BLD-2019-02210",
  readyForDisposition: "LKM-PLM-2017-00915",
  pendingConfirmation: "LKM-BLD-2018-03302",
};

function fixedRows(): Row[] {
  const base = (r: Partial<Row>): Row => ({
    PERMIT_NO: "", JURIS: "LKM", PARCEL: "", SITE_ADDRESS: "", CITY: "Lakemont", ZIP: "32801", PERMIT_TYPE: "", DESCRIPTION: "", ISSUED: "", EXPIRES: "",
    STATUS: "EXPIRED", FINAL_DATE: "", CONTRACTOR: "", LIC_NO: "", OWNER_NAME: "", OWNER_EMAIL: "", OWNER_PHONE: "", SOURCE_SYS: "Accela export 2026-03", RECORD_ID: "",
    ...r,
  });
  return [
    base({ PERMIT_NO: "LKM-ELE-2016-00388", PARCEL: "31-22-05-1180-004", SITE_ADDRESS: "77 HERON CT", PERMIT_TYPE: "ELEC SVC CHANGE", DESCRIPTION: "Upgrade service from 100A to 200A, replace meter base and main panel", ISSUED: "4/2/2016", EXPIRES: "9/29/2016", STATUS: "Expired - No Final", CONTRACTOR: "Brightline Electric Inc.", LIC_NO: "EC13004471", OWNER_NAME: "PRIYA RAMAN", OWNER_EMAIL: "priya.raman@example.com", OWNER_PHONE: "555-010-2231", RECORD_ID: "ACC-88231" }),
    base({ PERMIT_NO: "LKM-ELE-2017-00502", PARCEL: "31-22-08-0412-019", SITE_ADDRESS: "1420 Pinecrest Road", PERMIT_TYPE: "Electrical - Service Upgrade", DESCRIPTION: "Replace main electrical panel", ISSUED: "2017-07-18", EXPIRES: "2018-01-14", STATUS: "EXPIRED", CONTRACTOR: "Volt Masters LLC", LIC_NO: "EC13011020", OWNER_NAME: "Tomas Novak", OWNER_EMAIL: "tnovak@example.com", RECORD_ID: "ACC-90117" }),
    base({ PERMIT_NO: "LKM-BLD-2018-00412", PARCEL: "31-22-04-0907-002", SITE_ADDRESS: "1209 Cypress St", PERMIT_TYPE: "RES RE-ROOF", DESCRIPTION: "Re-roof with architectural shingles, replace underlayment", ISSUED: "2018-05-21", EXPIRES: "2018-11-17", STATUS: "EXPIRED", CONTRACTOR: "Peak Shingle Co.", LIC_NO: "CCC1330187", OWNER_NAME: "Grace Kim", OWNER_EMAIL: "grace.kim@example.com", OWNER_PHONE: "(555) 010-7781", RECORD_ID: "ACC-91402" }),
    base({ PERMIT_NO: "LKMBLD2018-412", PARCEL: "", SITE_ADDRESS: "1209 CYPRESS STREET", PERMIT_TYPE: "Roofing", DESCRIPTION: "REROOF", ISSUED: "05/21/18", EXPIRES: "", STATUS: "Exp", CONTRACTOR: "PEAK SHINGLE CO", LIC_NO: "", OWNER_NAME: "", OWNER_EMAIL: "", SOURCE_SYS: "Legacy permits DB (2009-2019)", RECORD_ID: "LEG-0047761" }),
    base({ PERMIT_NO: "LKM-BLD-2015-01877", PARCEL: "31-22-11-2204-031", SITE_ADDRESS: "3350 Osprey Ridge Rd", PERMIT_TYPE: "Window Replacement", DESCRIPTION: "Replace 8 windows, same size openings", ISSUED: "11-MAR-2015", EXPIRES: "07-SEP-2015", STATUS: "EXPIRED", CONTRACTOR: "Clearview Window & Door Co.", LIC_NO: "CGC1517220", RECORD_ID: "ACC-70219" }),
    base({ PERMIT_NO: "LKM-BLD-2019-02210", PARCEL: "31-22-06-1530-011", SITE_ADDRESS: "56 Juniper Pl", PERMIT_TYPE: "Re-Roof - Shingle", DESCRIPTION: "Tear off and replace asphalt shingles", ISSUED: "2019-05-02", EXPIRES: "2019-10-29", STATUS: "Expired", CONTRACTOR: "Lakemont Roof Pros Inc.", LIC_NO: "CCC1329045", OWNER_NAME: "Marcus Bell", OWNER_EMAIL: "marcus.bell@example.com", OWNER_PHONE: "555.010.4410", RECORD_ID: "ACC-94120" }),
    base({ PERMIT_NO: "LKM-PLM-2017-00915", PARCEL: "31-22-09-0811-007", SITE_ADDRESS: "902 Sabal Palm Cir", PERMIT_TYPE: "WATER HEATER", DESCRIPTION: "Replace 50 gal electric water heater", ISSUED: "2017-02-10", EXPIRES: "2017-08-09", STATUS: "EXPIRED", CONTRACTOR: "BlueFlame Plumbing LLC", LIC_NO: "CFC1428301", OWNER_NAME: "Aisha Hassan", OWNER_EMAIL: "aisha.hassan@example.com", RECORD_ID: "ACC-85530" }),
    base({ PERMIT_NO: "LKM-BLD-2018-03302", PARCEL: "31-22-02-0333-015", SITE_ADDRESS: "18 Bluebird Ln", PERMIT_TYPE: "Fence", DESCRIPTION: "Install 6 ft wood privacy fence, rear yard", ISSUED: "2018-09-04", EXPIRES: "2019-03-03", STATUS: "EXPIRED", CONTRACTOR: "Heritage Fence Company", OWNER_NAME: "Luis Ortega", OWNER_EMAIL: "luis.ortega@example.com", RECORD_ID: "ACC-92288" }),
    // Work types the default rules do not cover (staff review until a rule is written).
    base({ PERMIT_NO: "LKM-MEC-2019-00611", PARCEL: "31-22-06-0611-002", SITE_ADDRESS: "611 Cedar Ln", PERMIT_TYPE: "HVAC CHANGE OUT", DESCRIPTION: "Replace 3-ton condenser and air handler, same location", ISSUED: "2019-04-09", EXPIRES: "2019-10-06", STATUS: "EXPIRED", CONTRACTOR: "Coolbreeze Heating & Air LLC", LIC_NO: "CAC1817420", OWNER_NAME: "Nora Castillo", OWNER_EMAIL: "nora.castillo@example.com", RECORD_ID: "ACC-93611" }),
    base({ PERMIT_NO: "LKM-MEC-2020-00277", PARCEL: "31-22-03-1277-008", SITE_ADDRESS: "1277 Harbor View Dr", PERMIT_TYPE: "Mechanical - HVAC Replacement", DESCRIPTION: "Replace heat pump system, like for like", ISSUED: "2020-02-18", EXPIRES: "2020-08-16", STATUS: "Expired", CONTRACTOR: "Coolbreeze Heating & Air LLC", LIC_NO: "CAC1817420", OWNER_NAME: "Omar Farrell", OWNER_PHONE: "555-010-1277", RECORD_ID: "ACC-95277" }),
    base({ PERMIT_NO: "LKM-PLM-2019-08388", PARCEL: "31-22-10-1388-005", SITE_ADDRESS: "1388 Maple Ave", PERMIT_TYPE: "Plumbing - Repipe", DESCRIPTION: "Repipe house with PEX, replace shutoff valves", ISSUED: "2019-08-12", EXPIRES: "2020-02-08", STATUS: "EXPIRED", CONTRACTOR: "Lakemont Plumbing & Drain Inc.", LIC_NO: "CFC1426770", OWNER_NAME: "Paula Moreau", OWNER_EMAIL: "paula.moreau@example.com", RECORD_ID: "ACC-94388" }),
    base({ PERMIT_NO: "LKM-PLM-2020-08764", PARCEL: "31-22-04-0764-011", SITE_ADDRESS: "764 Seminole Way", PERMIT_TYPE: "Irrigation", DESCRIPTION: "Install lawn irrigation system with backflow preventer", ISSUED: "2020-05-04", EXPIRES: "2020-10-31", STATUS: "EXPIRED", CONTRACTOR: "Greenline Irrigation Co.", LIC_NO: "", OWNER_NAME: "Rosa Iverson", OWNER_EMAIL: "rosa.iverson@example.com", RECORD_ID: "ACC-95764" }),
    base({ PERMIT_NO: "LKM-BLD-2019-08015", PARCEL: "31-22-09-3015-003", SITE_ADDRESS: "3015 Palmetto St", PERMIT_TYPE: "Door Replacement", DESCRIPTION: "Replace front entry door, same size opening", ISSUED: "2019-11-20", EXPIRES: "2020-05-18", STATUS: "EXPIRED", CONTRACTOR: "Clearview Window & Door Co.", LIC_NO: "CGC1517220", OWNER_NAME: "Wren Abbott", OWNER_EMAIL: "wren.abbott@example.com", RECORD_ID: "ACC-93015" }),
    // An export that says Final but carries no final inspection date: the permit system will not confirm it.
    base({ PERMIT_NO: "LKM-BLD-2018-08722", PARCEL: "31-22-07-8722-006", SITE_ADDRESS: "8722 Live Oak Trl", PERMIT_TYPE: "Re-Roof - Shingle", DESCRIPTION: "Tear off and replace asphalt shingles", ISSUED: "2018-03-14", EXPIRES: "2018-09-10", STATUS: "Final", CONTRACTOR: "Peak Shingle Co.", LIC_NO: "CCC1330187", OWNER_NAME: "Tara Lindqvist", OWNER_EMAIL: "tara.lindqvist@example.com", RECORD_ID: "ACC-98722" }),
    // Data-quality edge cases.
    base({ PERMIT_NO: "LKM-BLD-2014-00733", PARCEL: "31-22-12-0101-001", SITE_ADDRESS: "", PERMIT_TYPE: "Roofing", DESCRIPTION: "Re-roof", ISSUED: "2014-06-30", EXPIRES: "2014-12-27", STATUS: "EXPIRED", RECORD_ID: "ACC-60011" }),
    base({ PERMIT_NO: "LKM-BLD-2016-02954", PARCEL: "31-22-03-0440-022", SITE_ADDRESS: "640 Live Oak Trl", PERMIT_TYPE: "", DESCRIPTION: "Misc work per plans", ISSUED: "2016-10-11", EXPIRES: "2017-04-09", STATUS: "EXPIRED", OWNER_NAME: "Silas Moreau", RECORD_ID: "ACC-78010" }),
    base({ PERMIT_NO: "LKM-BLD-2013-01142", PARCEL: "31-22-07-1010-040", SITE_ADDRESS: "221 Seminole Way", PERMIT_TYPE: "Window Replacement", DESCRIPTION: "Replace 3 windows", ISSUED: "", EXPIRES: "13/45/2013", STATUS: "Exp", OWNER_NAME: "June Sato", OWNER_EMAIL: "june.sato@example", RECORD_ID: "ACC-55502" }),
    base({ PERMIT_NO: "", SITE_ADDRESS: "88 Palmetto St", PERMIT_TYPE: "Fence", DESCRIPTION: "Fence", ISSUED: "2017-01-05", STATUS: "EXPIRED", RECORD_ID: "ACC-??" }),
    base({ PERMIT_NO: "LKM-BLD-2017-01560", PARCEL: "31-22-10-0606-010", SITE_ADDRESS: "1500 Bayhill Blvd", PERMIT_TYPE: "Re-Roof - Shingle", DESCRIPTION: "Re-roof and replace rotted rafters over garage", ISSUED: "2017-03-22", EXPIRES: "2017-09-18", STATUS: "Expired - No Final", CONTRACTOR: "Sunshine Roofing LLC", LIC_NO: "CCC1331090", OWNER_NAME: "Elena Petrova", OWNER_EMAIL: "elena.petrova@example.com", RECORD_ID: "ACC-86601" }),
    base({ PERMIT_NO: "LKM-PLM-2018-01204", PARCEL: "31-22-01-0909-003", SITE_ADDRESS: "77 Kingfisher Ter", PERMIT_TYPE: "Water Heater Replacement", DESCRIPTION: "Replace gas water heater in garage", ISSUED: "2018-12-03", EXPIRES: "2019-06-01", STATUS: "EXPIRED", CONTRACTOR: "BlueFlame Plumbing LLC", LIC_NO: "CFC1428301", OWNER_NAME: "Kofi Mensah", OWNER_PHONE: "555-010-9902", RECORD_ID: "ACC-93300" }),
  ];
}

/** Generates the main Lakemont + Cedar Bluff export. */
export function generateLegacyExport(opts: { seed?: number; count?: number } = {}): Row[] {
  const rand = mulberry32(opts.seed ?? 20261030);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const weighted = () => {
    const total = CATEGORY_WEIGHTS.reduce((a, [, w]) => a + w, 0);
    let r = rand() * total;
    for (const [c, w] of CATEGORY_WEIGHTS) if ((r -= w) <= 0) return c;
    return "roof";
  };
  const rows: Row[] = fixedRows();
  const usedAddresses = new Set(rows.map((r) => r.SITE_ADDRESS.toUpperCase()));
  const target = opts.count ?? 112;
  let seq = 1000;
  while (rows.length < target) {
    const cat = weighted();
    const cedar = rand() < 0.14;
    const year = 2012 + Math.floor(rand() * 13);
    const issued = addDaysIso(`${year}-01-01`, Math.floor(rand() * 360));
    const active = rand() < 0.04;
    const issuedFinal = active ? addDaysIso("2026-04-01", Math.floor(rand() * 150)) : issued;
    const expires = addDaysIso(issuedFinal, 180);
    const finaled = !active && rand() < 0.07;
    let address = "";
    do address = `${10 + Math.floor(rand() * 4980)} ${pick(STREETS)}`;
    while (usedAddresses.has(address.toUpperCase()));
    usedAddresses.add(address.toUpperCase());
    const hasContact = rand() < 0.74;
    const hasContractor = rand() < 0.86;
    const [contractor, licPrefix] = pick(CONTRACTORS[cat]);
    const first = pick(FIRST);
    const last = pick(LAST);
    const fmt: DateFmt = pick(["iso", "iso", "us", "us", "us2", "mon", "compact"] as DateFmt[]);
    seq += 1 + Math.floor(rand() * 40);
    const juris = cedar ? "CDB" : "LKM";
    const prefix = cedar ? "CDB" : `LKM-${PREFIX[cat]}`;
    rows.push({
      PERMIT_NO: `${prefix}-${Number(issuedFinal.slice(0, 4))}-${String(seq).padStart(5, "0")}`,
      JURIS: rand() < 0.1 ? (cedar ? "Town of Cedar Bluff (FL reference)" : "City of Lakemont") : juris,
      PARCEL: rand() < 0.9 ? `${cedar ? "04" : "31"}-22-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(Math.floor(rand() * 9999)).padStart(4, "0")}-${String(Math.floor(rand() * 99)).padStart(3, "0")}` : "",
      SITE_ADDRESS: rand() < 0.3 ? address.toUpperCase().replace(/ AVE$/, " AVENUE").replace(/ ST$/, " STREET") : address,
      CITY: cedar ? "Cedar Bluff" : rand() < 0.5 ? "Lakemont" : "LAKEMONT",
      ZIP: cedar ? "32950" : pick(["32801", "32803", "32804"]),
      PERMIT_TYPE: pick(TYPE_LABELS[cat]),
      DESCRIPTION: pick(DESCRIPTIONS[cat]),
      ISSUED: fmtDate(issuedFinal, fmt),
      EXPIRES: rand() < 0.06 ? "" : fmtDate(expires, fmt),
      STATUS: active ? pick(["Issued", "ACTIVE", "Inspections in progress"]) : finaled ? pick(["FINALED", "Final", "C/O Issued"]) : pick(["EXPIRED", "Expired", "Exp - No Final", "EXPIRED", "Lapsed"]),
      FINAL_DATE: finaled ? fmtDate(addDaysIso(issuedFinal, 60 + Math.floor(rand() * 90)), "iso") : "",
      CONTRACTOR: hasContractor ? (rand() < 0.2 ? contractor.toUpperCase() : contractor) : "",
      LIC_NO: hasContractor && licPrefix ? `${licPrefix}${String(Math.floor(rand() * 999999)).padStart(6, "0")}`.slice(0, licPrefix.length + 6) : "",
      OWNER_NAME: hasContact ? (rand() < 0.3 ? `${first} ${last}`.toUpperCase() : `${first} ${last}`) : "",
      OWNER_EMAIL: hasContact && rand() < 0.85 ? `${first}.${last}${Math.floor(rand() * 90)}@example.com`.toLowerCase() : "",
      OWNER_PHONE: hasContact && rand() < 0.6 ? pick([`555-010-${String(Math.floor(rand() * 9999)).padStart(4, "0")}`, `(555) 010-${String(Math.floor(rand() * 9999)).padStart(4, "0")}`]) : "",
      SOURCE_SYS: rand() < 0.85 ? "Accela export 2026-03" : "Legacy permits DB (2009-2019)",
      RECORD_ID: `ACC-${String(100000 + Math.floor(rand() * 899999))}`,
    });
  }
  return rows;
}

export function toCsv(rows: Row[] | Record<string, string>[], headers?: readonly string[]): string {
  return Papa.unparse({ fields: [...(headers ?? LEGACY_HEADERS)], data: rows.map((r) => (headers ?? LEGACY_HEADERS).map((h) => (r as Record<string, string>)[h] ?? "")) }) + "\n";
}

/** A smaller batch in a *different* export format, used for the live upload demo and E2E test. */
export const NEW_BATCH_HEADERS = ["Permit Number", "Address", "Parcel ID", "Type", "Scope of Work", "Issue Date", "Expiration Date", "Status", "Contractor Name", "Contractor License", "Owner", "Owner Email", "Owner Phone", "Record ID"];

export function newPermitBatch(): Record<string, string>[] {
  const r = (v: string[]) => Object.fromEntries(NEW_BATCH_HEADERS.map((h, i) => [h, v[i] ?? ""]));
  return [
    r(["LKM-BLD-2019-04127", "418 Magnolia Ave", "31-22-05-0418-001", "Re-Roof", "Tear off and replace architectural shingles, replace drip edge", "08/12/2019", "02/08/2020", "Expired - No Final", "Sunshine Roofing LLC", "CCC1331234", "Dana Whitfield", "dana.whitfield@example.com", "(555) 010-4127", "TYL-551204"]),
    r(["LKM-BLD-2020-00918", "2207 Willow Bend Way", "31-22-08-2207-004", "Window Replacement", "Replace 6 windows and front door", "03/03/2020", "08/30/2020", "Expired", "Clearview Window & Door Co.", "CGC1517220", "Hana Okafor", "hana.okafor@example.com", "", "TYL-551871"]),
    r(["LKM-PLM-2021-00207", "35 Elm St", "31-22-01-0035-010", "Water Heater", "Replace 50 gal electric water heater", "01/19/2021", "07/18/2021", "Expired", "Lakemont Plumbing & Drain Inc.", "CFC1426770", "Victor Abbott", "", "555-010-3305", "TYL-552090"]),
    r(["LKM-ELE-2020-00644", "910 Lakeview Dr", "31-22-04-0910-002", "Electrical Service", "Service change 150A to 200A", "06/02/2020", "11/29/2020", "Expired", "Brightline Electric Inc.", "EC13004471", "Rosa Castillo", "rosa.castillo@example.com", "", "TYL-552401"]),
    r(["LKM-BLD-2021-01733", "1188 Maple Ave", "", "Fence", "Install 6 ft vinyl fence", "2021-09-14", "2022-03-13", "EXPIRED", "", "", "", "", "", "TYL-553017"]),
    r(["LKM-BLD-2022-00402", "64 Cedar Ln", "31-22-02-0064-001", "Roofing", "Re-roof, replace sheathing as needed", "2022-02-07", "2022-08-06", "Final", "Peak Shingle Co.", "CCC1330187", "Wren Iverson", "wren.iverson@example.com", "", "TYL-553388"]),
    r(["LKM-BLD-2026-00811", "500 Harbor View Dr", "31-22-09-0500-003", "Re-Roof", "Re-roof, metal panels", "2026-06-01", "2026-11-28", "Issued", "Sunshine Roofing LLC", "CCC1331234", "Omar Farrell", "omar.farrell@example.com", "", "TYL-560012"]),
    r(["LKM-BLD-2019-04127", "418 MAGNOLIA AVENUE", "31-22-05-0418-001", "Re-Roof", "Tear off and replace architectural shingles", "8/12/2019", "2/8/2020", "Expired", "Sunshine Roofing LLC", "CCC1331234", "Dana Whitfield", "dana.whitfield@example.com", "", "TYL-551204"]),
    r(["", "77 Unknown Rd", "", "Roofing", "Re-roof", "2020-01-01", "2020-06-30", "Expired", "", "", "", "", "", "TYL-??"]),
  ];
}
