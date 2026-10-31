# Next engineering milestones

The vertical slice proves the workflow end to end on synthetic data. These three milestones are ordered by what most limits a real pilot.

## 1. Live system-of-record integration (pilot blocker)

*Why first:* "Officially closed" is only as real as the confirmation from the municipality's permitting system. Today it is simulated or entered manually. No pilot can claim reduced backlog without it.

- Implement `SourceOfRecordAdapter` for one vendor a pilot city uses (e.g. Accela Civic Platform or Tyler EnerGov): submit disposition, receive status via webhook or polling, map statuses, reconcile failures.
- Scheduled read-sync of permit updates, reusing the import reconciliation path (row diffs, provenance, re-triage) instead of manual CSV uploads.
- Contract tests against recorded vendor fixtures; a sandbox tenant per vendor.
- *Done when:* a determination round-trips to the vendor sandbox and its confirmation drives `OFFICIALLY_CLOSED` with no manual step.

## 2. Production identity, delivery, and storage (security blocker)

*Why:* municipalities will require SSO, and real homeowner outreach requires approved delivery providers.

- OIDC/SAML SSO with MFA, SCIM or admin UI for user provisioning, durable login throttling.
- Real `DeliveryAdapter`s for an approved email and SMS provider and a print-mail vendor, with bounce/complaint handling feeding contact verification and opt-outs; `DEMO_MODE` paths removed from production builds.
- Encrypted object storage with short-lived signed URLs, antivirus scanning in the evidence pipeline, managed PostgreSQL with backups, and a dedicated worker process for jobs.
- *Done when:* a pilot city's staff sign in with their identity provider and a test homeowner receives a real (sandbox-recipient) notice.

## 3. Measured extraction with an authorized model provider (product moat)

*Why:* the deterministic extractor misses unfamiliar labels (see `npm run eval`: recall 93.8% on synthetic fixtures, with the misses listed). Real contractor documents are far more varied, and OCR is needed for scans and photos of paperwork.

- Build a de-identified, consented evaluation set from pilot documents with double-labeled ground truth; keep the synthetic gate for regressions.
- Add OCR and an LLM/vision `ExtractionProvider` behind the existing organization authorization and the schema + verbatim-quote acceptance gate; record model version per field.
- Report precision/recall per field and per document type, unsupported-claim rate, and reviewer correction frequency from production overrides; ship only when the model beats the deterministic baseline without increasing critical escalation failures (which must stay at zero).
- *Done when:* the evaluation report on real pilot documents shows a measured improvement over the deterministic baseline, and reviewers can see which provider produced each fact.
