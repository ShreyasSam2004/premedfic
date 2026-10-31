# Security notes

PremedFix handles municipal records and homeowner information. This document lists the controls that exist in this MVP, how they are verified, and known gaps. **No certification (SOC 2, FedRAMP, StateRAMP, CJIS, or other) has been obtained.**

## Controls in place

### Tenant isolation
- Every tenant-owned table carries `org_id`. Services take the organization from the authenticated `ActorContext`, never from request input, and filter every query on it.
- Cross-tenant lookups return the same `NotFound` as nonexistent records, so existence is not disclosed.
- Tested: `tests/integration/isolation-and-safety.test.ts` (reads, search, listing, transitions, assignment, rule sets, evidence items) and the Playwright cross-tenant test.

### Authentication and sessions
- Staff passwords: scrypt (N=16384, r=8, p=1, 16-byte salt), constant-time comparison, dummy hash on unknown accounts to equalize timing.
- In-memory throttling after repeated failed logins (per process; see gaps).
- Sessions: 256-bit random tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production); only SHA-256 hashes are stored; 12-hour expiry; revocable; role re-read from the membership on every request.

### Authorization
- A single permission matrix (`src/domain/roles.ts`) is enforced in services, not in the UI. The UI hides controls only to reduce clutter.
- Workflow transitions additionally check actor kind, approval authority from the rule set, and specialist discipline.
- Bulk operations are limited to assignment and re-triage. There is no bulk approval or closure.

### Homeowner portal
- Access links carry a random 256-bit token; only its hash is stored. Links expire after 60 days. Grants carry a revocation flag that every check honors, but there is no staff UI to revoke a link yet.
- **A link alone reveals nothing.** The holder must confirm a 6-digit code delivered to the contact channel staff verified against property records. Codes are HMAC-hashed, expire in 15 minutes, allow 5 attempts, and are throttled on resend.
- Code verification is recorded as proving control of the verified channel, **not** ownership. Representatives must supply the owner's written authorization as a checklist item.
- After verification, the browser receives a 2-hour HMAC-signed session bound to the grant; the token leaves the URL. `Referrer-Policy: no-referrer` prevents link leakage.
- Our communication records store messages with the portal token redacted.

### Uploads and files
- Type determined from file bytes (PDF, JPEG, PNG only); the extension must agree; PDFs containing JavaScript, launch actions, or embedded files are rejected; 15 MB per file, 10 files per request.
- Filenames are sanitized; storage keys are generated and validated against path traversal; files are content-addressed and hash-verified on processing.
- Files are never served statically. `/api/evidence/[id]` authorizes each request (staff in the same organization, or the homeowner for their own case) and responds `no-store` with `nosniff`.

### Untrusted document content
- Document text is treated as data. The deterministic pipeline never interprets it; instruction-like text is flagged to reviewers as an untrusted finding and has no workflow effect (tested).
- Any future model provider must pass the schema + verbatim-quote acceptance gate, and requires explicit organization authorization before any record is sent externally. Government and homeowner data is not used for model training.

### Integrity and audit
- `audit_events`, `workflow_transitions`, `rule_evaluations`, and `finalization_verifications` are append-only, enforced by database triggers that reject UPDATE and DELETE (tested).
- Audit events are hash-chained per organization (SHA-256 over canonical JSON plus the previous hash), serialized with a transaction-scoped advisory lock. Settings shows chain verification; packets include the chain head.
- Official determinations carry signature metadata (identity, role, time, attestation text). This is an authenticated-session attestation, not a cryptographic digital signature.

### Request hygiene
- Server actions use Next.js's built-in origin checks; upload route handlers additionally reject cross-origin requests.
- Security headers: `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, a restrictive `frame-ancestors`/`object-src`/`base-uri` CSP, `Permissions-Policy`.
- Inputs validated with Zod or explicit checks at service boundaries. Errors returned to users are generic unless they are domain errors; logs record identifiers and counts, not record contents, with email/phone masking.
- Secrets come from environment variables. In production, every signing operation (portal codes and sessions) refuses to run unless `APP_SECRET` is set to at least 16 characters.

## Known gaps and next steps

| Gap | Note |
|---|---|
| No SSO/SAML/OIDC or MFA | Required before production pilots with most municipalities |
| Login throttling is per-process memory | Move to the database or an edge rate limiter for multi-instance deployments |
| No full CSP for scripts | Needs nonce support; current CSP covers framing, objects, and base URI only |
| `DEMO_MODE` exposes simulated message contents | Must be off in production; the simulated inbox and on-screen codes exist only for demos |
| Local-filesystem storage | Replace with encrypted object storage (S3-compatible, SSE-KMS) and short-lived signed URLs |
| No at-rest encryption beyond the host | Use managed PostgreSQL with encryption and backups |
| Retention is configuration only | Implement reviewed purge workflows with legal-hold support |
| Malware scanning | Byte-type checks are not antivirus; add a scanning step before processing |
| Dev-dependency advisories | `npm audit` reports moderate issues in drizzle-kit's bundled esbuild (development tooling only, not shipped at runtime) |
| Streaming 404 status | Pages render the not-found UI under a streamed `200` because of the loading boundary; no data is disclosed. API routes return true `404`s |
