// Captures the real PremedFix UI, step by step, from an isolated demo server.
// Each shot: a full-page 2x screenshot, the fixed sidebar (desktop), and the
// document-coordinate boxes of the elements the video points at.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3212";
const OUT = path.resolve("brag-output/work/shots");
const PERMIT = "LKM-BLD-2019-04127";
const evidence = (f) => path.resolve("demo/evidence", f);
fs.mkdirSync(OUT, { recursive: true });
const manifest = {};

const DESK = { width: 1440, height: 810 };
const PHONE = { width: 390, height: 844 };

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

async function shot(page, name, boxes = {}, { phone = false } = {}) {
  const vp = phone ? PHONE : DESK;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(vp.width - 4, 4);
  await settle(page);
  let side = null;
  if (!phone) {
    side = `${name}-side.png`;
    await page.screenshot({ path: path.join(OUT, side), clip: { x: 0, y: 0, width: 236, height: vp.height } });
  }
  let h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, h) });
  await page.waitForTimeout(250);
  h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, h) });
  await settle(page);
  const out = {};
  for (const [k, loc] of Object.entries(boxes)) {
    const b = await loc.boundingBox().catch(() => null);
    if (b) out[k] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    else console.warn(`  ! ${name}: no box for ${k}`);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.setViewportSize(vp);
  await page.waitForTimeout(150);
  manifest[name] = { file: `${name}.png`, side, w: vp.width, h: Math.max(vp.height, h), vh: vp.height, phone, boxes: out };
  console.log(`  ${name} (${vp.width}x${Math.max(vp.height, h)})`);
}

const section = (page, title) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first();

async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "premedfix-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/overview");
  return page;
}

const browser = await chromium.launch();

// --- Admin: overview, import, case, outreach -------------------------------
const admin = await signIn(browser, "admin@lakemont.example");
await settle(admin);
await shot(admin, "overview", { tiles: admin.locator("main a").filter({ hasText: "Unresolved permits" }).first(), main: admin.locator("main") });

await admin.goto(`${BASE}/permits/import`);
await admin.getByTestId("csv-input").setInputFiles(path.resolve("demo/data/lakemont_new_permits_batch.csv"));
await admin.getByRole("button", { name: "Upload and map columns" }).click();
await admin.waitForURL(/\/permits\/import\/[0-9a-f-]{36}$/);
await shot(admin, "imp-map", {
  permitSel: admin.getByLabel("Source column for Permit ID"),
  mapCard: section(admin, "1. Map columns").or(admin.locator("main section").first()).first(),
  validate: admin.getByRole("button", { name: /Validate and preview/ }),
});
await admin.getByRole("button", { name: /Validate and preview/ }).click();
await admin.getByTestId("preview-summary").waitFor();
// The rejected row sits inside the preview table's own scroll area.
await admin.getByText("Missing permit ID; the row cannot be keyed").first().scrollIntoViewIfNeeded();
await shot(admin, "imp-preview", {
  summary: admin.getByTestId("preview-summary"),
  missing: admin.getByText("Missing permit ID; the row cannot be keyed").first(),
  commit: admin.getByRole("button", { name: "Commit import" }),
});
await admin.getByRole("button", { name: "Commit import" }).click();
await admin.getByTestId("import-result").filter({ hasText: "Created" }).waitFor();
await shot(admin, "imp-result", { result: admin.getByTestId("import-result") });

await admin.goto(`${BASE}/permits?q=${PERMIT}`);
await admin.getByRole("link", { name: PERMIT }).click();
await admin.getByRole("heading", { level: 1 }).filter({ hasText: PERMIT }).waitFor();
const caseUrl = admin.url();
const contact = admin.getByTestId("contact-card").first();
await shot(admin, "case", {
  h1: admin.getByRole("heading", { level: 1 }),
  flagged: section(admin, "Why this case was flagged"),
  tasks: section(admin, "Outstanding tasks"),
  contact,
});
await contact.getByLabel("Verification note").fill("Matched owner name and mailing address to county property appraiser record.");
await shot(admin, "case-note", { contact, note: contact.getByLabel("Verification note"), verify: contact.getByRole("button", { name: "Verify against property records" }) });
await contact.getByRole("button", { name: "Verify against property records" }).click();
await contact.filter({ hasText: "Verified owner of record" }).waitFor();
await shot(admin, "case-verified", { contact, draft: admin.getByRole("button", { name: "Draft notice for approval" }) });
await admin.getByRole("button", { name: "Draft notice for approval" }).click();
await admin.getByTestId("draft-notice").waitFor();
await shot(admin, "case-draft", { notice: admin.getByTestId("draft-notice"), approve: admin.getByRole("button", { name: "Approve and send (simulated)" }) });
await admin.getByRole("button", { name: "Approve and send (simulated)" }).click();
await admin.getByText("Owner contacted").first().waitFor();
await shot(admin, "case-sent", { h1: admin.getByRole("heading", { level: 1 }), status: admin.getByText("Owner contacted").first(), contact });

// --- Homeowner portal (phone) ----------------------------------------------
await admin.goto(`${BASE}/outreach/inbox`);
const message = admin.getByTestId("mailbox-message").filter({ hasText: PERMIT }).first();
const link = (await message.innerText()).match(/https?:\/\/\S+\/portal\/[A-Za-z0-9_-]+/)[0];
const ownerCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const owner = await ownerCtx.newPage();
await owner.goto(link);
await owner.getByText("please confirm it’s you", { exact: false }).waitFor();
await shot(owner, "p-start", { send: owner.getByRole("button", { name: "Send me a code" }) }, { phone: true });
await owner.getByRole("button", { name: "Send me a code" }).click();
const code = (await owner.getByTestId("demo-code").innerText()).match(/\b(\d{6})\b/)[1];
await owner.locator("input[name=code]").fill(code);
await owner.locator("input[name=name]").fill("Dana Whitfield");
await shot(owner, "p-code", { code: owner.getByTestId("demo-code"), input: owner.locator("input[name=code]"), go: owner.getByRole("button", { name: "Continue" }) }, { phone: true });
await owner.getByRole("button", { name: "Continue" }).click();
await owner.waitForURL("**/portal");
await shot(owner, "p-home", { status: owner.getByTestId("portal-status"), files: owner.getByTestId("portal-files") }, { phone: true });
await owner.getByTestId("declared-type").selectOption("invoice");
await owner.getByTestId("portal-files").setInputFiles(evidence("roof-invoice-418-magnolia.pdf"));
await owner.getByRole("button", { name: "Upload" }).click();
await owner.getByTestId("portal-uploaded").filter({ hasText: "roof-invoice-418-magnolia.pdf" }).waitFor();
await owner.getByTestId("declared-type").selectOption("photo");
await owner.getByTestId("portal-files").setInputFiles([evidence("roof-front-418-magnolia.png"), evidence("roof-rear-418-magnolia.png")]);
await owner.getByRole("button", { name: "Upload" }).click();
await owner.getByTestId("portal-uploaded").filter({ hasText: "roof-rear-418-magnolia.png" }).waitFor();
await owner.locator("textarea[name=workDescription]").fill("Sunshine Roofing tore off the old shingles and installed a new architectural shingle roof.");
await owner.locator("input[name=completionDate]").fill("2020-03-15");
await owner.locator("input[name=contractorName]").fill("Sunshine Roofing LLC");
await owner.getByRole("button", { name: "Save my answers" }).click();
await owner.getByText("Saved.").waitFor();
await shot(owner, "p-uploaded", { uploaded: owner.getByTestId("portal-uploaded"), submit: owner.getByRole("button", { name: "Submit for review" }) }, { phone: true });
await owner.getByRole("button", { name: "Submit for review" }).click();
await owner.getByTestId("portal-status").filter({ hasText: "Received — waiting for review" }).waitFor();
await shot(owner, "p-done", { status: owner.getByTestId("portal-status") }, { phone: true });

// --- Inspector review ------------------------------------------------------
const inspector = await signIn(browser, "inspector@lakemont.example");
const reviewUrl = caseUrl.replace("/cases/", "/review/");
await inspector.goto(reviewUrl);
await inspector.getByText("permit reference: LKM-BLD-2019-04127").first().waitFor();
await shot(inspector, "r-start", {
  quote: inspector.getByText("permit reference: LKM-BLD-2019-04127").first(),
  facts: section(inspector, "Key facts"),
  suggestion: inspector.getByTestId("suggestion"),
  begin: inspector.getByRole("radio", { name: /^Begin review/ }),
  record: inspector.getByRole("button", { name: "Record action" }),
});
await inspector.getByRole("radio", { name: /^Begin review/ }).check();
await inspector.getByRole("button", { name: "Record action" }).click();
await inspector.getByText("Under staff review").first().waitFor();
const reqs = ["contractor_invoice", "exterior_photos", "owner_statement"];
const reqBoxes = () => Object.fromEntries(reqs.flatMap((c) => [[`row_${c}`, inspector.getByTestId(`req-${c}`).last()], [`acc_${c}`, inspector.getByTestId(`req-${c}`).last().getByRole("button", { name: "Accept" })]]));
await shot(inspector, "r-review", reqBoxes());
for (const [i, c] of reqs.entries()) {
  const row = inspector.getByTestId(`req-${c}`).last();
  await row.getByRole("button", { name: "Accept" }).click();
  await row.filter({ hasText: "Accepted by reviewer" }).waitFor();
  await shot(inspector, `r-acc${i + 1}`, {
    ...reqBoxes(),
    suggestion: inspector.getByTestId("suggestion"),
    ready: inspector.getByRole("radio", { name: /^Mark ready for authorized disposition/ }),
    record: inspector.getByRole("button", { name: "Record action" }),
  });
}
await inspector.getByRole("radio", { name: /^Mark ready for authorized disposition/ }).check();
await inspector.getByRole("button", { name: "Record action" }).click();
await inspector.getByText("Ready for authorized disposition").first().waitFor();
await shot(inspector, "r-ready", { cannot: inspector.getByText("Your role cannot record determinations").first(), status: inspector.getByText("Ready for authorized disposition").first() });

// --- Official determination and confirmation --------------------------------
const official = await signIn(browser, "official@lakemont.example");
await official.goto(caseUrl);
const det = official.locator("form", { has: official.getByTestId("determination-select") });
await det.getByTestId("determination-select").selectOption("close_requirements_satisfied");
await det.locator("textarea[name=reason]").fill("Contractor invoice, two exterior photographs, and the owner's statement are consistent with the permitted roof replacement.");
await det.locator("input[name=attest]").check();
await shot(official, "d-form", { form: det, sign: det.getByRole("button", { name: "Sign and record determination" }), h1: official.getByRole("heading", { level: 1 }) });
await det.getByRole("button", { name: "Sign and record determination" }).click();
await official.getByText("Closure submitted — awaiting system-of-record confirmation").first().waitFor();
await shot(official, "d-submitted", {
  h1: official.getByRole("heading", { level: 1 }),
  pending: official.getByText("Closure submitted — awaiting system-of-record confirmation").first(),
  simulate: official.getByRole("button", { name: "Simulate confirmation" }),
});
await official.getByRole("button", { name: "Simulate confirmation" }).click();
await official.getByRole("heading", { level: 1 }).filter({ hasText: "Officially closed" }).waitFor();
await shot(official, "d-closed", { h1: official.getByRole("heading", { level: 1 }), audit: section(official, "Audit timeline") });

await admin.goto(`${BASE}/settings`);
await shot(admin, "settings", { integrity: section(admin, "Audit trail integrity") });

// --- Austin analysis ---------------------------------------------------------
await admin.goto(`${BASE}/austin`);
await shot(admin, "austin", {
  hero: admin.locator("main section").first(),
  big: admin.getByText("9.3%", { exact: true }).first(),
  floor: admin.getByText(/Cautious lower bound/).first(),
  routing: admin.getByText(/Where all .* permits are routed/).first(),
  lever: section(admin, "The biggest policy lever"),
  categories: section(admin, "What counts as remote-eligible"),
  findings: admin.getByText("What the data itself shows").first(),
});

// --- Safeguards --------------------------------------------------------------
async function caseUrlFor(page, permit) {
  await page.goto(`${BASE}/permits?q=${encodeURIComponent(permit)}`);
  await page.getByRole("link", { name: permit, exact: true }).first().click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
  return page.url();
}
// Evidence conflict: the applicant's date and the invoice disagree.
await inspector.goto((await caseUrlFor(inspector, "LKM-BLD-2019-02210")).replace("/cases/", "/review/"));
await inspector.getByTestId("finding-conflict").first().waitFor();
await shot(inspector, "s-conflict", { conflict: inspector.getByTestId("finding-conflict").first(), facts: section(inspector, "Key facts") });
// Electrical service: no path to disposition without a passed site inspection.
await inspector.goto((await caseUrlFor(inspector, "LKM-ELE-2016-00388")).replace("/cases/", "/review/"));
if (await inspector.getByRole("radio", { name: /^Begin review/ }).count()) {
  await inspector.getByRole("radio", { name: /^Begin review/ }).check();
  await inspector.getByRole("button", { name: "Record action" }).click();
  await inspector.getByText("Under staff review").first().waitFor();
}
await shot(inspector, "s-electrical", { lock: inspector.getByText("Jurisdiction rules require a passed site inspection on record").first() });
// Duplicate records from two systems, reconciled by a person.
await caseUrlFor(admin, "LKM-BLD-2018-00412");
await shot(admin, "s-duplicate", { dup: admin.getByTestId("duplicate-candidate").first() });
// Tenant isolation: another municipality cannot open the record.
const harbor = await signIn(browser, "admin@harbor.example");
await harbor.goto(caseUrl);
await harbor.getByRole("heading", { name: "Not found" }).waitFor();
await shot(harbor, "s-isolation", { notfound: harbor.getByRole("heading", { name: "Not found" }) });

// --- Rule editor and impact preview (last: it changes the active rules) ------
await admin.goto(`${BASE}/rules`);
await admin.getByRole("link", { name: "Lakemont Residential Permit Resolution Policy" }).first().click();
await admin.waitForURL(/\/rules\/[0-9a-f-]{36}$/);
await admin.getByLabel("What will this draft change?").fill("Add document-based review for HVAC replacements");
await shot(admin, "rules-v1", { hvac: admin.locator("tr").filter({ hasText: "HVAC replacement" }).first(), start: section(admin, "Start a new draft"), create: admin.getByRole("button", { name: "Create draft and edit" }) });
const v1Url = admin.url();
await admin.getByRole("button", { name: "Create draft and edit" }).click();
await admin.waitForURL((u) => u.href !== v1Url);
await admin.getByRole("heading", { name: "Impact preview" }).waitFor();
const hvacRow = () => admin.locator("li").filter({ has: admin.getByRole("button", { name: "HVAC replacement", exact: true }) }).first();
await shot(admin, "rules-draft", { preview: section(admin, "Impact preview"), hvac: hvacRow(), write: hvacRow().getByRole("button", { name: "Write a rule" }) });
await hvacRow().getByRole("button", { name: "Write a rule" }).click();
await shot(admin, "rules-hvac", { hvac: hvacRow(), save: admin.getByRole("button", { name: "Save draft and refresh preview" }) });
await admin.getByRole("button", { name: "Save draft and refresh preview" }).click();
await admin.getByText("The impact preview reflects it.").waitFor();
await admin.reload();
await admin.getByRole("heading", { name: "Impact preview" }).waitFor();
await shot(admin, "rules-preview", {
  preview: section(admin, "Impact preview"),
  callout: admin.getByText(/would get a less cautious pathway/).first(),
  changed: admin.getByRole("link", { name: "LKM-MEC-2019-00611" }).first(),
  activate: section(admin, "Activate this version"),
});
const attest = section(admin, "Attest source review");
await attest.getByPlaceholder("Reviewer name and title").fill("Avery Chen, Permit Systems Administrator");
await attest.getByPlaceholder(/What was reviewed/).fill("Reviewed against Administrative Policy BD-2026-04 (fictional)");
await attest.getByRole("button", { name: "Record attestation" }).click();
await admin.getByText("Source verified").first().waitFor();
await section(admin, "Activate this version").getByRole("button", { name: /^Activate v/ }).click();
await admin.getByText(/Triage re-run on the 2 open case/).waitFor();
await shot(admin, "rules-activated", { msg: admin.getByText(/Triage re-run on the 2 open case/).first(), activate: section(admin, "Activate this version") });

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`Captured ${Object.keys(manifest).length} shots`);
