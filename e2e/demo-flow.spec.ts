import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The first end-to-end journey, driven entirely through the UI against a
 * freshly seeded, isolated database:
 *  1-5   admin signs in, uploads + maps + commits a CSV; rows persist and are triaged
 *  6-7   admin opens the expired roof permit, verifies the owner, drafts and approves a notice
 *  8-10  homeowner verifies on the portal, uploads documents, submits; evidence is processed
 *  11-13 inspector reviews and records an authorized workflow decision (audited)
 *  14    official records a determination; source-of-record confirmation is simulated
 *  15-16 dashboard metrics update; the case packet exports
 */
const PERMIT = "LKM-BLD-2019-04127";
const evidence = (f: string) => path.join(process.cwd(), "demo", "evidence", f);

async function signIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "premedfix-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/overview");
  return page;
}

async function confirmedResolutions(page: Page) {
  await page.goto("/overview");
  const tile = page.getByRole("link", { name: /Confirmed resolutions/ });
  const text = (await tile.innerText()).split("\n").map((s) => s.trim());
  return Number(text.find((t) => /^\d+$/.test(t)));
}

test("permit resolution: import → triage → outreach → portal → review → official closure", async ({ browser }) => {
  // 1. Municipal admin signs in.
  const admin = await signIn(browser, "admin@lakemont.example");
  const resolvedBefore = await confirmedResolutions(admin);

  // 2-3. Upload a CSV in a different export layout; mapping is suggested and validated.
  await admin.goto("/permits/import");
  await admin.getByTestId("csv-input").setInputFiles(path.join(process.cwd(), "demo", "data", "lakemont_new_permits_batch.csv"));
  await admin.getByRole("button", { name: "Upload and map columns" }).click();
  await admin.waitForURL(/\/permits\/import\/[0-9a-f-]{36}$/);
  await expect(admin.getByLabel("Source column for Permit ID")).toHaveValue("Permit Number");
  await admin.getByRole("button", { name: /Validate and preview/ }).click();
  const summary = admin.getByTestId("preview-summary");
  await expect(summary).toContainText("Create");
  await expect(admin.getByText("Missing permit ID; the row cannot be keyed")).toBeVisible();

  // 4-5. Commit: permits are persisted and triaged.
  await admin.getByRole("button", { name: "Commit import" }).click();
  await expect(admin.getByTestId("import-result")).toContainText("Created");
  await expect(admin.getByTestId("import-result")).toContainText("7");

  // 6. Open the expired roof permit.
  await admin.goto(`/permits?q=${PERMIT}`);
  await admin.getByRole("link", { name: PERMIT }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(PERMIT);
  await expect(admin.getByText("Evidence collection").first()).toBeVisible();
  await expect(admin.getByText("No final inspection is recorded for this permit.")).toBeVisible();
  const caseUrl = admin.url();

  // 7. Verify the imported contact, draft the notice, approve it (simulated delivery).
  const contact = admin.getByTestId("contact-card").first();
  await expect(contact).toContainText("Unverified");
  await contact.getByLabel("Verification note").fill("Matched owner name and mailing address to county property appraiser record.");
  await contact.getByRole("button", { name: "Verify against property records" }).click();
  await expect(contact).toContainText("Verified owner of record");
  await admin.getByRole("button", { name: "Draft notice for approval" }).click();
  await expect(admin.getByTestId("draft-notice")).toContainText("may still require administrative resolution");
  await admin.getByRole("button", { name: "Approve and send (simulated)" }).click();
  await expect(admin.getByText("Owner contacted").first()).toBeVisible();

  // 8. Homeowner opens the link from the (simulated) inbox in a separate, unauthenticated browser.
  await admin.goto("/outreach/inbox");
  const message = admin.getByTestId("mailbox-message").filter({ hasText: PERMIT }).first();
  const link = (await message.innerText()).match(/https?:\/\/\S+\/portal\/[A-Za-z0-9_-]+/)![0];
  const owner = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await owner.goto(link);
  await expect(owner.getByText("please confirm it’s you", { exact: false })).toBeVisible();
  await owner.getByRole("button", { name: "Send me a code" }).click();
  const code = (await owner.getByTestId("demo-code").innerText()).match(/\b(\d{6})\b/)![1];
  await owner.locator("input[name=code]").fill(code);
  await owner.locator("input[name=name]").fill("Dana Whitfield");
  await owner.getByRole("button", { name: "Continue" }).click();
  await owner.waitForURL("**/portal");
  await expect(owner.getByTestId("portal-status")).toHaveText("We need information from you");

  // 9. Upload an invoice and photos, describe the work, submit.
  await owner.getByTestId("declared-type").selectOption("invoice");
  await owner.getByTestId("portal-files").setInputFiles(evidence("roof-invoice-418-magnolia.pdf"));
  await owner.getByRole("button", { name: "Upload" }).click();
  await expect(owner.getByTestId("portal-uploaded")).toContainText("roof-invoice-418-magnolia.pdf");
  await owner.getByTestId("declared-type").selectOption("photo");
  await owner.getByTestId("portal-files").setInputFiles([evidence("roof-front-418-magnolia.png"), evidence("roof-rear-418-magnolia.png")]);
  await owner.getByRole("button", { name: "Upload" }).click();
  await expect(owner.getByTestId("portal-uploaded")).toContainText("roof-rear-418-magnolia.png");
  await owner.locator("textarea[name=workDescription]").fill("Sunshine Roofing tore off the old shingles and installed a new architectural shingle roof.");
  await owner.locator("input[name=completionDate]").fill("2020-03-15");
  await owner.locator("input[name=contractorName]").fill("Sunshine Roofing LLC");
  await owner.getByRole("button", { name: "Save my answers" }).click();
  await expect(owner.getByText("Saved.")).toBeVisible();
  await owner.getByRole("button", { name: "Submit for review" }).click();
  // 10. Evidence processed; status updates for the owner.
  await expect(owner.getByTestId("portal-status")).toHaveText("Received — waiting for review");

  // 11. Inspector sees the organized case with extracted, quote-backed facts.
  const inspector = await signIn(browser, "inspector@lakemont.example");
  const reviewUrl = caseUrl.replace("/cases/", "/review/");
  await inspector.goto(reviewUrl);
  await expect(inspector.getByText("permit reference: LKM-BLD-2019-04127")).toBeVisible();
  await expect(inspector.getByText("contractor-invoice.pdf").or(inspector.getByText("roof-invoice-418-magnolia.pdf")).first()).toBeVisible();
  await expect(inspector.getByTestId("finding-conflict")).toHaveCount(0);

  // 12. Authorized workflow decisions: begin review, accept checklist, mark ready.
  await expect(inspector.getByTestId("suggestion")).toContainText("Begin review");
  await inspector.getByRole("radio", { name: /^Begin review/ }).check();
  await inspector.getByRole("button", { name: "Record action" }).click();
  await expect(inspector.getByText("Under staff review").first()).toBeVisible();
  for (const code of ["contractor_invoice", "exterior_photos", "owner_statement"]) {
    const row = inspector.getByTestId(`req-${code}`).last();
    await row.getByRole("button", { name: "Accept" }).click();
    await expect(row).toContainText("Accepted by reviewer");
  }
  await expect(inspector.getByTestId("suggestion")).toContainText("Mark ready for authorized disposition");
  await inspector.getByRole("radio", { name: /^Mark ready for authorized disposition/ }).check();
  await inspector.getByRole("button", { name: "Record action" }).click();
  await expect(inspector.getByText("Ready for authorized disposition").first()).toBeVisible();
  // An inspector cannot record the determination.
  await expect(inspector.getByText("Your role cannot record determinations")).toBeVisible();

  // 13. The audit trail records the decision.
  await inspector.goto(caseUrl);
  await expect(inspector.getByText(/Mark ready for authorized disposition: Under staff review → Ready for authorized disposition/)).toBeVisible();

  // 14. The building official records the determination; the source of record confirms.
  const official = await signIn(browser, "official@lakemont.example");
  await official.goto(caseUrl);
  const determination = official.locator("form", { has: official.getByTestId("determination-select") });
  await determination.getByTestId("determination-select").selectOption("close_requirements_satisfied");
  await determination.locator("textarea[name=reason]").fill("Contractor invoice, two exterior photographs, and the owner's statement are consistent with the permitted roof replacement.");
  await determination.locator("input[name=attest]").check();
  await determination.getByRole("button", { name: "Sign and record determination" }).click();
  await expect(official.getByText("Closure submitted — awaiting system-of-record confirmation")).toBeVisible();
  await expect(official.getByRole("heading", { level: 1 })).not.toContainText("Officially closed");
  await official.getByRole("button", { name: "Simulate confirmation" }).click();
  await expect(official.getByRole("heading", { level: 1 })).toContainText("Officially closed");

  // 15. Dashboard metrics reflect the confirmed resolution.
  expect(await confirmedResolutions(admin)).toBe(resolvedBefore + 1);

  // 16. The case packet exports as a PDF.
  const packet = await admin.request.get(caseUrl.replace("/cases/", "/api/cases/") + "/packet");
  expect(packet.status()).toBe(200);
  expect(packet.headers()["content-type"]).toBe("application/pdf");
  expect((await packet.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Persistence: a reload shows the same confirmed state.
  await admin.goto(caseUrl);
  await admin.reload();
  await expect(admin.getByRole("heading", { level: 1 })).toContainText("Officially closed");
});

test("isolation: a second municipality cannot open Lakemont records", async ({ browser }) => {
  const admin = await signIn(browser, "admin@lakemont.example");
  await admin.goto("/permits");
  const href = await admin.locator("tbody a").first().getAttribute("href");
  const harbor = await signIn(browser, "admin@harbor.example");
  // Pages stream under a loading boundary, so the not-found UI renders with the streamed status;
  // what matters is that no Lakemont data is rendered. The API returns a hard 404.
  await harbor.goto(href!);
  await expect(harbor.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(harbor.getByText(/LKM-/)).toHaveCount(0);
  const api = await harbor.request.get(href!.replace("/cases/", "/api/cases/") + "/packet");
  expect(api.status()).toBe(404);
});
