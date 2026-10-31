# PremedFix demo walkthrough

A scripted demonstration of the end-to-end permit resolution flow and the six scenarios in the product brief. Everything shown is backed by persisted data and the same services the automated tests exercise. All people, companies, addresses, and municipalities are fictional; no message is ever actually sent.

**Time:** ~15 minutes for the main flow, ~10 more for the scenarios.

## Before you start

```bash
npm install && cp .env.example .env
# If you will not serve on :3000, set APP_BASE_URL in .env to your URL first.
npm run db:reset && npm run build && npm run start
```

Keep `DEMO_MODE=true` (the default in `.env.example`). It shows simulated message contents (portal links, verification codes) that a real provider would deliver to the recipient.

Use separate browser profiles or private windows for each person: **admin**, **homeowner**, **inspector**, **official**. Password for every staff account: `premedfix-demo`.

Sample files: `demo/data/lakemont_new_permits_batch.csv` and `demo/evidence/`.

---

## Part 1 — The first end-to-end flow (Scenario A, live)

### 1. The command center
Sign in as `admin@lakemont.example`. On **Overview**, point out:
- Every tile is computed from case records; click **Unresolved permits** to land on exactly those cases.
- The backlog chart is derived from permit expiration dates and case closure timestamps. Resolutions per month is a separate chart (different scale, no dual axis).
- Queues show what each role must do next.

### 2. Import a permit export
**Permits → Import permits.** Upload `demo/data/lakemont_new_permits_batch.csv`. It uses a different column layout from the department's main export.
- The mapping screen suggests canonical fields and shows sample values from the file. Nothing missing is filled in.
- Choose **City of Lakemont**, then **Validate and preview**. Point out the row with no permit ID (rejected, with the reason), the row duplicated within the file, and the date/status normalization.
- **Commit import.** 7 permits are created, triaged, and listed with row-level outcomes. The original rows are preserved.
- Optional: upload the same file again. The import screen warns it was imported before, and committing yields 0 created / all unchanged.

### 3. Why was it flagged?
Search `LKM-BLD-2019-04127` (Ctrl+K works anywhere). On the case:
- **Why this case was flagged** lists every triggered rule with its id, version, and the fields it read, under rule set v1.
- The evidence checklist (invoice, two exterior photos, owner statement) came from the jurisdiction's rule set, not from hard-coded logic.
- **Outstanding tasks** names who is responsible for each next step.

### 4. Contact the owner — with human approval
In **Owner contact**, the imported contact is **Unverified — not contactable**. The system never uses imported contact details on its own.
1. Enter a verification note (e.g. "Matched county appraiser owner record") → **Verify against property records**.
2. **Draft notice for approval.** Show the plain, non-threatening template ("may still require administrative resolution… not a finding that anything is wrong").
3. **Approve and send (simulated).** The case moves to **Owner contacted**; the audit timeline records who drafted and who approved.

### 5. The homeowner portal
As admin, open **Outreach → Simulated recipient inbox** and copy the portal link from the newest message for 418 Magnolia Ave. Open it in a **separate private window** (ideally phone-sized).
1. The link alone shows nothing about the case. **Send me a code**; in demo mode the code is shown on screen (labeled as simulated delivery).
2. Enter the code and name, choose *property owner*, **Continue**.
3. Upload `roof-invoice-418-magnolia.pdf` as *Contractor invoice*, then both `roof-*-418-magnolia.png` files as *Photos*.
4. Describe the work, completion date `2020-03-15`, **Save my answers**, **Submit for review**. The status becomes *Received — waiting for review*.

### 6. Inspector review
Sign in as `inspector@lakemont.example`. **Evidence Review** → open the case (it opens the review workspace).
- Each extracted fact shows the verbatim quote, page, and character offsets (e.g. *permit reference: LKM-BLD-2019-04127*). The key-facts grid compares the municipal record, the applicant's claim, and the documents side by side.
- The photo check states what photographs cannot establish.
- **Reviewer actions:** the suggestion is *Begin review* → **Record action**.
- In the checklist, **Accept** each item. "Provided" never meant "accepted": only the reviewer accepts.
- The suggestion becomes *Mark ready for authorized disposition* → **Record action**. Point out the banner: *Nothing has been approved yet.* The inspector cannot record a determination.

### 7. Official determination and confirmation
Sign in as `official@lakemont.example` and open the case.
1. Choose **Close — permit requirements determined satisfied**, state the basis, confirm the attestation, **Sign and record determination**.
2. The case is now **Determination recorded — awaiting source-of-record confirmation**. It is *not* officially closed.
3. **Simulate confirmation** (the stand-in for the permit system's response). The case becomes **Officially closed**.

### 8. Outcomes and the packet
- Back on **Overview** (admin): **Confirmed resolutions** has increased by one.
- On the case, **Export case packet**: every fact is labeled VERIFIED RECORD, APPLICANT CLAIM, EXTRACTED, INFERENCE, or UNKNOWN; page one states the packet is not an inspection report or legal determination; the signature and audit chain head are included.
- Reload any page: everything persists.

---

## Part 2 — The other scenarios (pre-seeded)

| Scenario | Where | What to show |
|---|---|---|
| **B. Electrical service** | `LKM-ELE-2016-00388` (77 Heron Ct) and `LKM-ELE-2017-00502` (1420 Pinecrest Rd) | Classified *Specialist review*, P1, site inspection required, specialist assigned. The second case shows a recorded electrical assessment and is *Inspection required*. As `inspector`, begin review on the first case: *Mark ready for authorized disposition* is locked with "Jurisdiction rules require a passed site inspection on record". As `inspector2` (structural/gas), submitting the electrical assessment on the first case is refused. No determination path exists until an inspection is recorded. |
| **C. Duplicate record** | `LKM-BLD-2018-00412` and `LKMBLD2018-412` (1209 Cypress St) | Two systems, two formats, one permit. Sign in as clerk: the reconciliation panel compares the records side by side. **Confirm duplicate and merge** (with a note): the secondary becomes *Merged as duplicate* (not a closure), the primary returns to *Triaged*. Neither record is deleted. |
| **D. Unreachable owner** | `LKM-BLD-2015-01877` (3350 Osprey Ridge Rd); **Outreach → Manual outreach queue** | No contact in the source data. The system does not guess or contact anyone; the case sits in the manual outreach queue. Staff can log research attempts and add a contact, which must still be verified before outreach. |
| **E. Evidence conflict** | `LKM-BLD-2019-02210` (56 Juniper Pl), as inspector | Applicant says completed 2019-06-01; the invoice says 2020-03-15. Both sources are preserved and linked; the suggestion is *Request corrected documents*; marking ready is blocked until a reviewer resolves the conflict with a note. |
| **F. Verified resolution** | `LKM-BLD-2018-03302` (18 Bluebird Ln) and `LKM-PLM-2017-00915` (902 Sabal Palm Cir) | The first awaits source confirmation: simulate it (official or admin), or record a documented **manual confirmation** with a reference number. The second is ready for an official's determination. Twelve earlier cases show completed history in Analytics. |
| **G. Reported finals** | **Overview → Finalization to verify**; `LKM-BLD-2012-02718` (an addition) and `LKM-BLD-2018-08722` (a re-roof) | The export says *Final*, but an export is not the permit system. Both sit in *Finalization verification pending*: not in *Unresolved permits*, no outreach. The case lists exactly why verification is required (here: imported from the Accela export, date consistent, no inspection record, no confirmation). As clerk, **Check permit system (simulated)**: 02718 is confirmed and becomes *Already resolved* with the evidence recorded (not a PremedFix closure; *Confirmed resolutions* does not change). 08722's export has no final date; the permit system does not confirm it, so it returns to the backlog and triage routes it to evidence collection. `LKM-BLD-2019-01503`, `LKM-BLD-2021-02066`, and `LKM-PLM-2024-01968` show earlier confirmations, one recorded manually with an Accela reference. |

### Safety and trust demonstrations

- **Prompt injection:** as the homeowner on another case, upload `demo/evidence/roof-invoice-with-hidden-instructions.pdf`. The reviewer sees an *untrusted instruction* finding quoting the text. It had no effect on processing or workflow.
- **Malicious upload:** upload `demo/evidence/not-really-a-pdf.pdf`. It is rejected because its bytes are not a PDF.
- **Scanned document:** `scanned-receipt-no-text.pdf` is accepted but reported as having no extractable text (OCR is not configured), so a human must read it.
- **Escalation from text:** `LKM-BLD-2017-01560` is a *roof* permit whose description mentions rafters, and `LKM-PLM-2018-01204` is a *water heater* described as gas. Both are escalated to specialists. Text can escalate; it can never clear.
- **Rule editor and impact preview:** as admin, open **Jurisdiction Rules → City of Lakemont** (active v1) → **Start a new draft** ("Add document-based review for HVAC replacements"). In the editor, **Write a rule** for *HVAC replacement* and save. The impact preview shows the two HVAC permits (`LKM-MEC-2019-00611`, `LKM-MEC-2020-00277`) moving from staff review to owner document review, flagged *less cautious*. Make *Roof replacement* high-concern instead and the preview flags the roof cases as *more cautious*. Attest the source review, then **Activate** with "Re-run triage on the cases this changes": only those cases are re-triaged.
- **Jurisdiction rules:** **Jurisdiction Rules → Town of Cedar Bluff (FL reference)** quotes Fla. Stat. § 553.79(16)(c) and explains why it is modeled only as eligibility for an official's consideration. The rule set is unverified, so every case under it requires human review.
- **Tenant isolation:** sign in as `admin@harbor.example` and paste a Lakemont case URL: *Not found*.
- **Audit integrity:** **Settings → Audit trail integrity** verifies the hash chain. The database rejects any UPDATE or DELETE on audit events.

## Resetting

`npm run db:reset` (stop the server first) restores the demo state. The browser end-to-end test runs the Part 1 flow automatically against an isolated database: `npm run e2e`.
