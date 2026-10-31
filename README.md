# PremedFix

**Permit resolution for building departments.** PremedFix helps cities work through backlogs of expired building permits. It imports messy permit exports, triages each permit with versioned rules the city controls, collects proof from homeowners, organizes that evidence for inspectors, and records decisions by authorized officials, with an audit trail that cannot be rewritten.

No AI approves or closes a permit. A permit is **officially closed** only after an authorized official records a determination **and** the municipal system of record confirms it. Everything works with no AI provider configured.

**Live demo:** https://premedfix.vercel.app (password `premedfix-demo`, accounts [below](#demo-accounts))

> **Status:** pilot-oriented MVP. Demo cases, people, and addresses are fictional; the [Austin analysis](docs/AUSTIN_ANALYSIS.md) uses real public data. Outbound messages and the permit-system integration are simulated. See [What is not implemented yet](#what-is-not-implemented-yet).

---

## Run on real data: Austin, Texas

PremedFix's import pipeline and triage engine, run unmodified on all **127,814** expired residential permits in the City of Austin's open data:

| Result | Share | Permits |
|---|---:|---:|
| Route to document-based resolution under the default rules (single-scope water heater, window, roof, and fence jobs) | **9.3%** | 11,885 |
| On the most cautious reading (water heaters of unstated fuel left out) | **4.7%** | 6,000 |
| With one rule for HVAC replacements, measured with the rule editor's impact preview | **19.5%** | 24,911 |

The rules are PremedFix defaults, not Austin policy; every permit still needs an official's decision. Method and limits: [docs/AUSTIN_ANALYSIS.md](docs/AUSTIN_ANALYSIS.md). In the app: **Austin analysis**.

---

## How a permit moves through PremedFix

1. **Import.** Staff upload a permit export in any column layout. Columns are mapped from the file's headers, rows are validated and normalized, duplicates are flagged, and the original rows are preserved.
2. **Triage.** Eleven versioned rules route each permit and record why: the rule, its version, and the fields it read. Missing values are never filled in.
3. **Outreach.** Staff verify the owner contact against property records and approve every notice before it is sent.
4. **Homeowner portal.** The owner confirms a one-time code, then uploads invoices and photos and describes the work.
5. **Evidence.** Uploads are checked, fingerprinted, and read. Every extracted fact cites the exact quote and page; conflicts with the city's record are flagged.
6. **Review.** An inspector accepts each checklist item. Electrical, gas, structural, and addition work needs a specialist and a passed site inspection.
7. **Decision.** Only a building official records the determination.
8. **Confirmation.** The permit is officially closed when the city's permit system confirms it.

A permit whose export already says *Final* skips all of this: it waits in **finalization verification** until the permit system confirms the final, then becomes **already resolved**, which is not counted as a PremedFix closure.

---

## Demo accounts

Password for every account: **`premedfix-demo`**. The same accounts work on the live demo and locally.

| Email | Role |
|---|---|
| `admin@lakemont.example` | Municipal administrator |
| `clerk@lakemont.example` | Permit clerk |
| `inspector@lakemont.example` | Building inspector (electrical) |
| `inspector2@lakemont.example` | Building inspector (structural, gas) |
| `official@lakemont.example` | Building official (records determinations) |
| `manager@lakemont.example` | Department manager |
| `admin@harbor.example` | Administrator of a **separate municipality** (tenant isolation demo) |

The live demo is public: anyone with the link can sign in and change the fictional data. [DEMO.md](DEMO.md) is a scripted walkthrough.

---

## Quick start

Requirements: **Node.js 20.9+** and npm. No database server or Docker is needed.

```bash
git clone https://github.com/ShreyasSam2004/premedfic.git
cd premedfic
npm install
cp .env.example .env            # defaults work as-is for local use
npm run db:reset                # creates the embedded database and seeds the demo (~20 s)
npm run build
npm run start                   # http://localhost:3000
```

For development with hot reload, use `npm run dev` instead of build and start.

### Running on a different port

Portal links in notices are generated from `APP_BASE_URL`, and **links are minted when a notice is approved, including during seeding**. Set `APP_BASE_URL` to the URL you will actually use *before* running `npm run db:reset`:

```bash
# .env
APP_BASE_URL=http://localhost:3210
```

```bash
npm run db:reset && npm run build && npm run start -- -p 3210
```

### Using a PostgreSQL server

The default database is [PGlite](https://pglite.dev), PostgreSQL compiled to WebAssembly, persisted in `.data/pglite`. The same migrations run against a PostgreSQL server:

```bash
docker compose up -d
# .env: DATABASE_URL=postgres://premedfix:premedfix@localhost:5432/premedfix
npm run db:reset
```

The live demo runs on this path (Neon PostgreSQL). Automated tests run on PGlite.

> The embedded database is single-process. Stop the web server before running `db:seed` or `db:reset`; the scripts refuse to open a data directory another live process holds.

---

## Hosting on Vercel

Serverless functions have no durable local disk, so a hosted deployment keeps both data and uploaded files in PostgreSQL:

| Variable | Value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (for example, a Neon database from the Vercel Marketplace) |
| `STORAGE_DRIVER` | `database`: uploaded evidence and CSV files are stored in the `stored_objects` table |
| `AUTO_MIGRATE` | `false`: migrations run through the demo reset below, or `npm run db:migrate` from your machine, not on cold starts |
| `APP_SECRET` | 32+ random characters (required in production) |
| `APP_BASE_URL` | the deployment's public URL (portal links are minted with it) |
| `DEMO_MODE` | `true` for a demo (shows simulated message contents) |

`vercel.json` pins the Next.js framework and the function region.

Seeding from a machine far from the database is slow (thousands of sequential round trips), so a hosted demo is reset next to the database by `POST /api/admin/reset-demo`. It wipes the database, applies migrations, and re-seeds in under a minute. The endpoint does not exist unless `DEMO_RESET_TOKEN` (32+ characters) is set and `DEMO_MODE=true`:

```bash
vercel env add DEMO_RESET_TOKEN production --sensitive   # paste a long random value
vercel deploy --prod
curl -X POST -H "Authorization: Bearer <token>" https://<host>/api/admin/reset-demo
vercel env rm DEMO_RESET_TOKEN production && vercel deploy --prod   # switch it off again
```

Vercel limits request bodies to 4.5 MB, below the app's 15 MB upload limit.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / server |
| `npm run db:reset` | Wipe `.data/` (embedded database and uploaded files) and re-seed the demo |
| `npm run db:seed` | Seed an empty database |
| `npm run db:migrate` | Apply migrations only |
| `npm run db:generate` | Generate a migration from schema changes (drizzle-kit) |
| `npm test` | Unit, integration, and evaluation-gate tests (Vitest) |
| `npm run e2e` | Browser test of the full demo journey (Playwright; first run `npx playwright install chromium`) |
| `npm run eval` | Evaluation report: classification, extraction precision and recall, escalation, injection, unsupported claims |
| `npm run analyze:austin` | Runs the import pipeline and triage over Austin's public permits (network required; read-only) and refreshes the snapshot behind the **Austin analysis** page |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run demo:assets` | Regenerate sample evidence files in `demo/evidence/` |
| `npm run worker` | Drain queued or failed background jobs (`--watch` to poll) |

---

## Tests

| Suite | Tests | What it covers |
|---|---:|---|
| Unit (`tests/unit`, 10 files) | 126 | Normalization, mapping, duplicate detection, triage rules, the state machine, permissions, uploads, extraction, injection screening, rule-change impact, finalization checks, the Austin category mapping |
| Integration (`tests/integration`, 6 files) | 40 | Import to cases; outreach, portal, evidence, review, determination, and confirmation; rule editing and activation; reported finals; database storage; tenant isolation and the append-only audit trail. Each file runs against a fresh PostgreSQL (PGlite) with all migrations |
| Evaluation gate (`tests/eval`) | 6 | Zero tolerance for critical escalation failures and accepted fabricated claims |
| Browser (`e2e`) | 2 | The full journey through the UI with four identities, and a cross-tenant check |

`npm run lint` and `npm run typecheck` are clean, and `npm run build` succeeds.

---

## What is implemented

| Module | Implemented |
|---|---|
| **Command center** (`/overview`) | Twelve live tiles, each drilling into its cases: the unresolved backlog is counted separately from reported finals awaiting verification and permits already resolved. Backlog trend and monthly resolutions (separate charts, hover and table view), six work queues, filters by municipality, category, review priority, and assignee |
| **Permits and cases** | Search (permit, address, parcel, contractor), sort, filters (category, permit age, workflow status, municipality, assignee, evidence completeness, review priority, triage class), pagination, bulk assign and re-triage. **No bulk approval or closure exists.** Cases browsable by workflow phase |
| **Ingestion** | CSV upload with size, row, and binary checks; header-synonym mapping with live sample values; validated dry-run preview with row-level errors and warnings; normalization that never fabricates values; in-file and cross-system duplicate detection; idempotent commit as a retryable job; re-import reconciliation with field-level diffs; raw rows preserved verbatim; import history; downloadable template |
| **Triage engine** | 11 versioned, independently testable rules; classification with explicit precedence; pathway, review priority (with breakdown), evidence checklist, escalations, and a rule trace (rule id, version, source fields, explanation). Description keywords can only escalate, never clear |
| **Jurisdiction rules** | Versioned rule sets (draft, active, superseded), validated configuration, source citation, administrator attestation; activation never rewrites history. Unverified, absent, or non-covering rules force human review. A Florida reference rule set models Fla. Stat. § 553.79(16)(c) as *eligibility for an official's consideration* |
| **Rule editor and impact preview** | Administrators edit drafts in a structured editor: write a rule for any category (including HVAC, plumbing, irrigation, and doors, which the defaults leave to staff review), and choose concern level, pathway, site inspection, specialist, approval roles, and evidence from a library; escalation patterns have a live tester. Each draft shows an impact preview: the triage engine re-evaluates every open case under the active version and the draft, lists the moves, and flags any case that would get a less cautious pathway. Editing a draft clears its attestation. Activation can re-run triage on exactly the changed cases |
| **Reported finals** | An imported finaled status or final inspection date is a claim, not a closure. Such records wait in *finalization verification*, outside the backlog and outside outreach, evidence requests, and inspections. The case shows exactly why verification is required. A check against the permit system (simulated adapter, or a documented manual check with a reference) is stored as append-only evidence: confirmed means *already resolved*, not counted as a PremedFix closure; not confirmed returns the permit to the backlog with the imported final disregarded |
| **State machine** | 17 states and 24 transitions, each with allowed actors, preconditions, and reason requirements; optimistic locking; idempotency keys; every transition writes a transition row and an audit event. No transition accepts an AI actor |
| **Case graph** (`/cases/[id]`) | Property, permit, inspections, contacts, evidence, communications, review, decision, and confirmed outcome; outstanding tasks with the responsible role; "why flagged" with the full rule trace; related permits; source provenance; audit timeline |
| **Outreach** | Versioned templates (email, SMS, letter) with an automated tone check (no fines, penalties, payment demands, or legal conclusions); staff-verified contacts only; draft, approve, simulated send; delivery history; response tracking; 14-day follow-ups; opt-outs; a manual-outreach queue for unreachable owners |
| **Homeowner portal** | Mobile-first; hashed single-purpose links; one-time code to the staff-verified contact channel; owner or representative declaration (representatives must provide authorization); plain-language status; checklist; reviewer requests; camera-friendly uploads; statement; status tracking |
| **Evidence engine** | File-type detection from content, active-content PDF rejection, size limits, SHA-256 content addressing and integrity checks, PDF text extraction, deterministic classification, field extraction with page, character offsets, and verbatim quote, explicit unknowns, prompt-injection screening, cross-document conflict detection that preserves both sources, checklist evaluation ("provided" is not "accepted") |
| **Review workspace** (`/review/[id]`) | Document viewer, per-document findings, key-facts grid (municipal record, applicant claim, extracted), discrepancy resolution, checklist accept, reject, or waive, an explained suggestion with a mandatory reason to override, specialist assessment (discipline-checked), inspection recording, disposition panel; `[` / `]` keyboard navigation |
| **Disposition** | Officials only; approval authority from the rule set; attestation; signature metadata; submission through a permit-system adapter (simulated); confirmation by the adapter or a documented manual confirmation; reopen with a reason |
| **Case packet** | PDF with identifiers, property, record history, rule checks and versions, evidence inventory with hashes, provenance-labeled facts, conflicts and unknowns, communications, reviewer decisions, next actions, signature, and the audit chain head |
| **Analytics** | Measured: time to next staff action, time in each state, median time to verified resolution, evidence request rate, reopen rate, reviewer override rate, reviewer workload, owner-response aging, stage distribution with drill-down. Estimated, labeled with its assumption: research hours avoided |
| **Austin analysis** (`/austin`) | The import pipeline and triage engine run on Austin's open data, with an Austin-specific category mapping that only errs toward caution; the page reads a committed snapshot of aggregates (no addresses or names) |
| **Security** | Tenant scoping in every query, server-side role checks, scrypt passwords, hashed sessions, append-only and hash-chained audit, signed portal sessions, upload restrictions, authorized file access, same-origin checks, security headers, PII masking. See [docs/SECURITY.md](docs/SECURITY.md) |
| **Evaluation** | 28 labeled triage fixtures (16 high-concern), 8 extraction documents with ground truth (one deliberately hard), plus checklist, conflict, malformed-upload, injection, and unsupported-claim fixtures |

### Demo data

`npm run db:reset` creates two municipalities, imports **112 synthetic rows** (111 permits and 1 deliberately invalid row) through the real import pipeline, then advances cases through the **real services** under a backdated clock, so every record has a consistent audit trail. Seven scenarios are live, including reported finals; see [DEMO.md](DEMO.md).

---

## What is not implemented yet

Stated plainly so nothing is mistaken for a live capability:

- **No real email, SMS, or postal delivery.** Only the simulated adapter exists; nothing leaves the system. In demo mode, a "simulated recipient inbox" shows what recipients would receive.
- **No real permit-system integration** (Accela, Tyler EnerGov, and others). Closure confirmations and finalization checks are simulated or entered manually with a reference number.
- **No LLM or vision provider.** The provider interface, the organization-level authorization gate, and the schema-plus-verbatim-quote acceptance gate exist and are tested; no model is called anywhere.
- **No OCR.** Scanned PDFs and photos yield no text and are reported as unknown for a person to read.
- **No SSO, SAML, or MFA**, password reset, or user administration UI (users are seeded).
- **Not load-tested.** Imports run in one transaction (fine for thousands of rows, not hundreds of thousands); jobs run inline in the web process, with `npm run worker` for draining.
- **Retention** is a configured value with no automated purge.
- **No certifications** (SOC 2, FedRAMP, StateRAMP, CJIS) have been obtained.

---

## Project structure

```
src/
  app/          Next.js routes: staff app, homeowner portal, API route handlers
  components/   UI: case panels, charts, shared primitives
  domain/       Pure, client-safe code: the state machine, roles, triage vocabulary, rule library
  server/       Services: imports, triage, rules, workflow, evidence, reviews, disposition, audit, analytics
  data/         Austin analysis snapshot (aggregates only)
drizzle/        SQL migrations
scripts/        Seed, migrate, worker, evaluation, Austin analysis
tests/          Unit, integration, and evaluation-gate tests
e2e/            Playwright journey
demo/           Sample permit exports and evidence files
docs/           Architecture, security, roadmap, Austin analysis
brag-output/    Demo video storyboard and the scripts that render it (the video itself is not committed)
```

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL (PGlite embedded, or a server), Zod, pdf-lib and unpdf, Vitest, and Playwright.

---

## Documentation

- [DEMO.md](DEMO.md): scripted walkthrough of the end-to-end flow and all seven scenarios
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, data model, workflow, design decisions
- [docs/SECURITY.md](docs/SECURITY.md): security controls, threat model notes, known gaps
- [docs/ROADMAP.md](docs/ROADMAP.md): next engineering milestones
- [docs/AUSTIN_ANALYSIS.md](docs/AUSTIN_ANALYSIS.md): the triage engine run on all 127,814 of Austin's expired residential permits

## Legal and product boundaries

PremedFix organizes records and routes work. It does not make legal determinations, certify safety or code compliance, or infer construction safety from permit type, age, descriptions, or photographs. "Low review priority" means low administrative urgency, never "safe." The Florida statute is included as reference material only; the reference rule set is deliberately left unverified, and a state statute never determines a permit's outcome in this system.

## License

[MIT](LICENSE)
