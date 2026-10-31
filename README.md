# PremedFix AI — The Permit Resolution Operating System

PremedFix helps municipal building departments resolve backlogs of open and expired building permits. It imports messy permit exports, normalizes and de-duplicates them, triages each permit with deterministic, versioned jurisdiction rules, coordinates homeowner outreach and evidence collection, organizes evidence for human review, and records auditable decisions by authorized officials.

It is an operational system, not a chatbot. Everything works with no AI provider configured. No software decision can approve or close a permit: a permit is **officially closed** only after an authorized official records a determination **and** the municipal system of record confirms it.

> **Status:** pilot-oriented MVP. All data is synthetic and fictional. Outbound messages and the system-of-record integration are **simulated**. See [What is implemented](#what-is-implemented) and [What is not](#what-is-not-implemented-yet).

---

## Quick start

Requirements: **Node.js 20.9+** (developed on Node 25) and npm. No database server or Docker is needed for the default setup.

```bash
npm install
cp .env.example .env            # defaults work as-is for local use
npm run db:reset                # creates the embedded database and seeds the demo (~15 s)
npm run build
npm run start                   # http://localhost:3000
```

Sign in at `/login` with any demo account (password **`premedfix-demo`**):

| Email | Role |
|---|---|
| `admin@lakemont.example` | Municipal administrator |
| `clerk@lakemont.example` | Permit clerk |
| `inspector@lakemont.example` | Building inspector (electrical) |
| `inspector2@lakemont.example` | Building inspector (structural, gas) |
| `official@lakemont.example` | Building official (records determinations) |
| `manager@lakemont.example` | Department manager |
| `admin@harbor.example` | Administrator of a **separate tenant** (isolation demo) |

For development with hot reload use `npm run dev` instead of build + start.

### Running on a different port

Portal links in notices are generated from `APP_BASE_URL`. **Links are minted when a notice is approved, including during seeding**, so set `APP_BASE_URL` to the URL you will actually use *before* running `npm run db:reset`:

```bash
# .env
APP_BASE_URL=http://localhost:3210
```
```bash
npm run db:reset && npm run build && npm run start -- -p 3210
```

### Using PostgreSQL instead of the embedded database

The default database is [PGlite](https://pglite.dev) — PostgreSQL compiled to WebAssembly — persisted in `.data/pglite`. The same migrations run against a real PostgreSQL server:

```bash
docker compose up -d
# .env: DATABASE_URL=postgres://premedfix:premedfix@localhost:5432/premedfix
npm run db:reset
```

The node-postgres code path is implemented but was **not exercised in the build environment** (no Docker daemon was available). All automated tests run on PGlite.

> The embedded database is single-process. Stop the web server before running `db:seed`/`db:reset`; the scripts refuse to open a data directory another live process holds.

### Hosting on Vercel

Serverless functions have no durable local disk, so a hosted deployment uses a PostgreSQL server for both data and uploaded files:

| Variable | Value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. a Neon database from the Vercel Marketplace) |
| `STORAGE_DRIVER` | `database`: uploaded evidence and CSV files are stored in the `stored_objects` table |
| `AUTO_MIGRATE` | `false`: migrations run from your machine, not on cold starts |
| `APP_SECRET` | 32+ random characters (required in production) |
| `APP_BASE_URL` | the deployment's public URL (portal links are minted with it) |
| `DEMO_MODE` | `true` for the demo (shows simulated message contents) |

Seeding from a laptop far from the database is slow (thousands of sequential round trips), so the hosted demo is seeded next to the database by `POST /api/admin/reset-demo`. It wipes, migrates, and re-seeds in under a minute, and does not exist unless `DEMO_RESET_TOKEN` (32+ characters) is set and `DEMO_MODE=true`:

```bash
vercel env add DEMO_RESET_TOKEN production --sensitive   # paste a long random value
vercel deploy --prod
curl -X POST -H "Authorization: Bearer <token>" https://<host>/api/admin/reset-demo
vercel env rm DEMO_RESET_TOKEN production && vercel deploy --prod   # switch it off again
``` `vercel.json` pins the Next.js framework and the function region. Vercel limits request bodies to 4.5 MB, below the app's 15 MB upload limit. A public demo deployment uses the published demo passwords, so anyone with the URL can sign in to the fictional data.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / server |
| `npm run db:reset` | Wipe `.data/` (embedded DB + uploaded files) and re-seed the demo |
| `npm run db:seed` | Seed an empty database |
| `npm run db:migrate` | Apply migrations only |
| `npm run db:generate` | Generate a migration from schema changes (drizzle-kit) |
| `npm test` | Unit, integration, and evaluation-gate tests (Vitest) |
| `npm run e2e` | Browser end-to-end test of the full demo journey (Playwright; first run `npx playwright install chromium`) |
| `npm run eval` | Evaluation report (classification, extraction precision/recall, escalation, injection, unsupported claims) |
| `npm run analyze:austin` | Runs normalization, duplicate detection, and triage over Austin's public expired residential permits (network required; read-only) and refreshes the snapshot behind the in-app **Austin analysis** page |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run demo:assets` | Regenerate sample evidence files in `demo/evidence/` |
| `npm run worker` | Drain queued/failed background jobs (`--watch` to poll) |

### Verified results (this repository, at hand-off)

- `npm test`: **125 tests passing** in 11 files (unit, integration on real PostgreSQL semantics via PGlite, evaluation gate)
- `npm run e2e`: **2 tests passing** — the full 16-step journey through the UI, and a cross-tenant check
- `npm run lint`, `npm run typecheck`: clean
- `npm run build`: succeeds with no warnings

---

## What is implemented

**Vertical slice, end to end, persisted:** sign-in → CSV upload → column mapping → validated preview → commit → triage → case detail → contact verification → notice draft → human approval → simulated delivery → homeowner portal verification → uploads + statement → evidence processing → inspector review → authorized determination → source-of-record confirmation (simulated) → dashboard update → PDF case packet. Reloading never loses state.

| Module | Implemented |
|---|---|
| **Command Center** (`/overview`) | Ten live tiles (each drills into filtered cases), backlog trend and monthly resolutions (separate charts, hover + table view), five work queues, filters by municipality, category, review priority, assignee |
| **Permits / Cases** | Search (permit, address, parcel, contractor), sort, filter (category, permit age, workflow status, municipality, assignee, evidence completeness, review priority, triage class), pagination, bulk assign and re-triage. **No bulk approval or closure exists.** Cases browsable by workflow phase |
| **Ingestion** | CSV upload with size/row/binary checks, header-synonym mapping with live sample values, validated dry-run preview with row-level errors and warnings, date/status/category/address/contact normalization that never fabricates values, in-file and cross-system duplicate detection, idempotent commit as a retryable job, re-import reconciliation with field-level diffs, raw rows preserved verbatim, import history, downloadable template |
| **Triage engine** | 11 versioned, independently testable rules; classification with explicit precedence; pathway, review priority (with breakdown), evidence checklist, escalations, rule trace (rule id, version, source fields, explanation), rule-set version, timestamp, human-review flag. Description keywords can only escalate, never clear |
| **Jurisdiction rules** | Versioned rule sets (draft → active → superseded), Zod-validated configuration, source citation, administrator attestation, activation never rewrites history. Unverified/absent/non-covering rules force human review. Florida reference rule set modeling Fla. Stat. § 553.79(16)(c) as *eligibility for an official's consideration* |
| **Reported finals** | An imported finaled status or final inspection date is a claim, not a closure. Such records go to *Finalization verification pending*: outside the unresolved backlog, outside outreach, evidence requests, and inspections. The case shows exactly why verification is required (provenance, date consistency, missing inspection record, missing confirmation). A check against the permit system of record (simulated adapter, or a documented manual check with a reference) is stored as append-only evidence: confirmed → *Already resolved* (not counted as a PremedFix resolution), not confirmed → back to the backlog with the imported final disregarded. Cases already in progress are flagged when a re-import reports a final |
| **Rule editor + impact preview** | Administrators edit drafts in a structured editor: write a rule for any category (including HVAC, plumbing, irrigation, and doors, which the defaults leave to staff review), choose concern level, pathway, site inspection, specialist, approval roles, and evidence from a library; edit escalation patterns with a live tester. Each draft shows an impact preview: the triage engine re-evaluates every open case under the active version and the draft, lists the moves, and flags any case that would get a less cautious pathway. Editing a draft clears its attestation. Activation can re-run triage on exactly the changed cases |
| **State machine** | 17 states, 24 transitions, each with allowed actors, preconditions, reason requirements; optimistic locking; idempotency keys; every transition writes a transition row and an audit event. No transition accepts a model/AI actor |
| **Case graph** (`/cases/[id]`) | Property → permit → inspections → contacts → evidence → communications → review → decision → confirmed outcome; outstanding tasks with responsible role; "why flagged" with full rule trace; related permits; source provenance; audit timeline |
| **Outreach** | Versioned templates (email/SMS/letter) with automated tone lint (no fines, penalties, payment, legal conclusions), staff-verified contacts only, draft → approve → simulated send, delivery history, response tracking, 14-day follow-ups, opt-outs, manual-outreach queue for unreachable owners |
| **Homeowner portal** | Mobile-first; hashed single-purpose links; one-time code to the staff-verified contact channel; owner vs. representative declaration (representatives get an authorization requirement); plain-language status; checklist; reviewer requests; camera-friendly uploads; statement; submit; status tracking |
| **Evidence engine** | Magic-byte type detection, active-content PDF rejection, size limits, SHA-256 content addressing and integrity check, PDF text extraction, deterministic classification, field extraction with page + character offsets + verbatim quote, explicit unknowns, prompt-injection screening, cross-document conflict detection that preserves both sources, checklist evaluation ("provided" ≠ accepted) |
| **Review workspace** (`/review/[id]`) | Document viewer, per-document findings, key-facts grid (municipal record vs. applicant claim vs. extracted), discrepancy resolution, checklist accept/reject/waive, explained suggestion with mandatory reason to override, specialist assessment (discipline-checked), inspection recording, disposition panel; `[` / `]` keyboard navigation |
| **Disposition** | Officials only, approval authority from the rule set, attestation, signature metadata, submission through a source-of-record adapter (simulated), confirmation by adapter or documented manual confirmation, reopen with reason |
| **Case packet** | PDF with identifiers, property, record history, rule checks + versions, evidence inventory with hashes, provenance-labeled facts, conflicts/unknowns, communications, reviewer decisions, next actions, signature, audit chain head |
| **Analytics** | Measured: time to next staff action, time in each state, median time to verified resolution, evidence request rate, reopen rate, reviewer override rate, reviewer workload, owner-response aging, stage distribution (drill-down). Estimated (labeled, with assumption): research hours avoided |
| **Security** | Tenant scoping in every query, server-side RBAC, scrypt passwords, hashed sessions, append-only + hash-chained audit, signed portal sessions, upload restrictions, authorized file access, same-origin checks, security headers, PII masking. See [docs/SECURITY.md](docs/SECURITY.md) |
| **Evaluation** | 28 labeled triage fixtures (16 high-concern), 8 extraction documents with ground truth (including one deliberately hard document), checklist, conflict, malformed-upload, injection, and unsupported-claim fixtures; CI gate with zero tolerance for critical escalation failures and accepted fabricated claims |

### Demo data

`npm run db:reset` creates two tenants, imports **112 synthetic rows** (111 permits + 1 deliberately invalid row) through the real import pipeline, then advances cases through the **real services** under a backdated clock, so every record has a consistent audit trail. Scenarios A–F from the brief are all live; see [DEMO.md](DEMO.md).

---

## What is not implemented yet

Stated plainly so nothing is mistaken for a live capability:

- **No real email/SMS/postal delivery.** Only the simulated adapter exists; nothing ever leaves the system. In demo mode, a "simulated recipient inbox" shows what recipients would receive.
- **No real system-of-record integration** (Accela, Tyler EnerGov, etc.). Confirmation is simulated or entered manually with a reference number.
- **No LLM or vision provider adapter.** The provider interface, the organization-level authorization gate, and the schema + verbatim-quote acceptance gate exist and are tested; no model is called anywhere.
- **No OCR.** Scanned PDFs and photos yield no text and are reported as unknown for human reading.
- **No SSO/SAML/MFA**, password reset, or user administration UI (users are seeded).
- **Not load-tested.** Imports run in a single transaction (fine for thousands of rows, not hundreds of thousands); jobs run inline in the web process, with `npm run worker` for draining.
- **Retention** is a configured value with no automated purge.
- **No certifications** (SOC 2, FedRAMP, StateRAMP, CJIS) have been obtained.
- The **PostgreSQL** server path is implemented but untested here (see above).

---

## Documentation

- [DEMO.md](DEMO.md) — scripted walkthrough of the end-to-end flow and all six scenarios
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, domain model, workflow, design decisions
- [docs/SECURITY.md](docs/SECURITY.md) — security controls, threat model notes, known gaps
- [docs/ROADMAP.md](docs/ROADMAP.md) — next engineering milestones
- [docs/AUSTIN_ANALYSIS.md](docs/AUSTIN_ANALYSIS.md) — the triage engine run on all 127,814 of Austin's expired residential permits

## Legal and product boundaries

PremedFix organizes records and routes work. It does not make legal determinations, certify safety or code compliance, or infer construction safety from permit type, age, descriptions, or photographs. "Low review priority" means low administrative urgency, never "safe." The Florida statute is included as reference material only; the reference rule set is deliberately left unverified, and a state statute never determines a permit's outcome in this system.
