# Architecture

## Shape of the system

One Next.js 16 application (App Router, React 19, TypeScript) with a domain-layered server. No microservices.

```
Browser ──► Server Components (read models)          ┐
        ──► Server Actions / Route Handlers ──► Domain services ──► Drizzle ORM ──► PostgreSQL
                                                     │                             (PGlite embedded, or a server)
                                                     ├─► Storage adapter (local FS; S3-shaped interface)
                                                     ├─► Delivery adapter (simulated email/SMS/letter)
                                                     ├─► Source-of-record adapter (simulated permit system)
                                                     └─► Extraction provider (deterministic; model-ready gate)
```

| Layer | Location | Rule |
|---|---|---|
| Domain vocabulary | `src/domain/` | Pure, client-safe: permit categories, roles + permission matrix, **the state machine**, triage and evidence vocabularies |
| Services | `src/server/<domain>/` | Every mutation. Each takes an explicit `ActorContext { orgId, actor }`, checks permissions, scopes by `org_id`, and writes audit events |
| Pure engines | `triage/engine.ts`, `evidence/analyze.ts`, `evidence/crosscheck.ts`, `imports/normalize.ts`, `imports/dedupe.ts` | No I/O; unit-tested directly |
| UI | `src/app/`, `src/components/` | Server Components render read models; forms post to server actions. No status logic in the UI |

### Domain modules

`auth` (sessions, passwords, actor context) · `rules` (versioned rule sets) · `imports` (CSV staging, normalization, dedupe, commit) · `triage` · `workflow` (the only writer of case status) · `cases` (read models, reconciliation, tasks, suggestions) · `communications` · `portal` · `evidence` · `reviews` · `disposition` · `audit` · `analytics` · `packets` · `jobs` · `seed` · `eval`.

## Data model

Normalized PostgreSQL schema (`src/server/db/schema.ts`, migrations in `drizzle/`). 30 tables:

- **Tenancy and identity:** `organizations`, `jurisdictions`, `users`, `memberships` (role + specialties), `sessions`
- **Records:** `properties`, `permits` (normalized), `permit_import_batches`, `permit_source_records` (the original row, verbatim, per batch), `duplicate_candidates`, `inspection_records`
- **Rules and triage:** `rule_sets` (versioned config + citation + attestation), `triage_results` (one immutable row per run, with input snapshot), `rule_evaluations` (one per rule per run)
- **Case graph:** `cases` (status, version, classification, priority, assignment), `case_assignments`, `contacts`, `contact_verifications`, `communications`, `portal_grants`, `evidence_requirements`, `evidence_submissions` (the applicant's statement), `evidence_items`, `evidence_findings`
- **Decisions:** `review_decisions` (every reviewer action, with suggestion + override flag + signature), `disposition_submissions` (source-of-record sync), `workflow_transitions`
- **Integrity and operations:** `audit_events` (hash-chained), `jobs`, `simulated_mailbox` (the simulated provider's mailbox; absent with real providers)

Roles are a PostgreSQL enum plus a code-defined permission matrix (`src/domain/roles.ts`), rather than a table, so permissions are reviewed and versioned with the code.

## Workflow state machine

`src/domain/workflow.ts` defines 17 states and 24 transitions. Each transition declares `from` states, allowed actors, whether a reason is required, and a guard over a `GuardSnapshot` (facts about the case). `src/server/workflow/service.ts` is the only code that writes `cases.status`:

1. lock the case row (`SELECT … FOR UPDATE`) inside a transaction
2. honor an idempotency key if one is given (unique per case)
3. reject stale writes via `expectedVersion`
4. build the snapshot from the database and run the pure check
5. update the case with a version compare-and-set, insert a `workflow_transitions` row, append an audit event

Key properties enforced by guards (and tested):

- `READY_FOR_AUTHORIZED_DISPOSITION` requires every required checklist item **accepted or waived by a reviewer**, no open conflicts, a specialist assessment when required, and a passed site inspection when required.
- `record_determination` is limited to officials whose role is in the rule set's approval authority for the category. Closures re-check the safety guards; the aged-permit determination requires rule-set eligibility.
- A reported final (imported finaled status or final date) never reaches closure. It routes to `FINALIZATION_VERIFICATION`, which is open but outside `UNRESOLVED_STATES` (the backlog) and offers no outreach, evidence, or inspection transitions. Only a stored system-of-record check (`finalization_verifications`, append-only) moves it: confirmed → `ALREADY_RESOLVED` (closed, not a PremedFix closure), not confirmed → `TRIAGED` with the imported final disregarded by triage. Outreach (`queue_notice`) is blocked for an unverified reported final.
- `OFFICIALLY_CLOSED` is reachable by exactly one transition, which requires a pending source-of-record submission and a closing determination.
- No actor kind represents a model. AI output can only appear as a recommendation attached to a human decision.

## Triage engine

`src/server/triage/engine.ts`: 11 rules, each `{ id, version, title, description, evaluate(input, facts) }`. The engine runs every rule, records every outcome with the source fields it read, and composes a classification by fixed precedence:

`DATA_RECONCILIATION > FINALIZATION_CONFIRMATION > MONITOR_ACTIVE > SPECIALIST_REVIEW > STAFF_REVIEW > EVIDENCE_COLLECTION`

Configuration (categories, evidence requirements, escalation patterns, priority weights, aged-permit provision) comes from the active rule set. Description patterns only escalate. Missing values are never inferred (no default permit term is assumed when an expiration date is absent). Each run is persisted immutably, so later rule changes never rewrite history; re-running triage creates a new result referencing the new version.

## Evidence pipeline

`src/server/evidence/pipeline.ts`, run as an idempotent job per item:

1. validate by magic bytes, extension agreement, size; reject PDFs with active content
2. store content-addressed (`evidence/<org>/<case>/<sha256>`); verify the hash on read
3. extract text (pdf.js); images have no text (no OCR)
4. classify by content signals (abstains below one signal)
5. extract fields; each carries page, character offsets, and the verbatim quote
6. screen for instruction-like text (prompt injection) and record it as an untrusted finding
7. recompute case-level cross-checks (permit reference, address, completion dates vs. applicant claim and issuance, contractor license/name, applicant-asserted inspections) — fingerprinted so reviewer resolutions survive recomputation
8. re-evaluate the checklist (`missing` ↔ `provided`; reviewer statuses are never overwritten)

### Extraction providers and the acceptance gate

`ExtractionProvider` (`evidence/providers.ts`) is the seam for a future LLM or vision model. Two gates apply to any provider:

- **Authorization:** the organization must enable `aiProcessingAuthorized`; otherwise the deterministic provider is used.
- **Acceptance (`acceptProviderOutput`):** output must match a Zod schema, and every value must be supported by a quote that occurs verbatim on the cited page. Unsupported claims are rejected, never repaired. The evaluation harness feeds this gate fabricated claims and requires zero to pass.

No model adapter ships in this MVP.

## Jobs

`jobs` table with a unique idempotency key. Claiming is one conditional `UPDATE` (queued/failed, or running but stale) so two workers cannot run the same job. Handlers are idempotent (evidence processing deletes and rewrites its own item-scope findings). In the web process jobs run inline after enqueue, so users see results immediately; `npm run worker` drains anything left queued or failed. Failed jobs are retryable from Settings.

## Database driver choice

The build environment had no PostgreSQL or running Docker daemon. Rather than fake persistence, the app runs real PostgreSQL in-process via PGlite by default, and node-postgres when `DATABASE_URL` is set; both use the same Drizzle migrations. Services use `db()`, which returns the active transaction when called inside `transaction()` (AsyncLocalStorage), so nested service calls join the outer transaction instead of deadlocking PGlite's single connection. A lock file prevents two processes from opening one PGlite directory.

## Time

Services read time through `now()` (`src/server/util.ts`). The seed replays months of history through the real services under a backdated clock, so seeded audit trails, transitions, and analytics are internally consistent rather than inserted directly.

## Testing

| Suite | Scope |
|---|---|
| `tests/unit` (126) | normalization, mapping, dedupe, triage rules, state machine, permissions, sessions, upload validation, extraction, injection screening, acceptance gate, cross-checks, checklist, rule-set validation, template tone, rule-change impact, finalization checks, Austin category mapping |
| `tests/integration` (40) | import → cases (idempotency, reconciliation, provenance); outreach → portal → evidence → review → determination → confirmation → dashboard; rule editing, preview, and activation; reported finals → verification → already resolved; database storage; audit append-only and hash chain; packet content; tenant and homeowner isolation; electrical escalation guards |
| `tests/eval` (6) | evaluation harness gates |
| `e2e` (2, Playwright) | the full journey through the UI with four identities; cross-tenant access |

Integration tests run each file against a fresh in-memory PostgreSQL with all migrations.
