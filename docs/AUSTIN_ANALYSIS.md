# Austin's expired residential permits, through PremedFix

PremedFix's import normalization and triage engine were run, unmodified, on every expired residential permit in the City of Austin's public permit data.

- **Source:** City of Austin, [Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu) (`3syk-w9eu`, 2,382,939 permits). Downloaded 2026-10-30, the same day the city last updated it.
- **Scope:** status `Expired` or `Expired - License`, class `Residential`. That is **127,814 permits**, issued between 1978 and 2026.
- **Rules:** PremedFix's default rule set (the Lakemont demo configuration). **This is not Austin policy**, so every result is provisional and needs human confirmation.
- **Reproduce:** `npm run analyze:austin` (add `-- --refresh` to download again). It writes `.data/austin/report.json` and the committed snapshot `src/data/austin-report.json` (counts only, no addresses), which the app's **Austin analysis** page (`/austin`) reads. Rebuild the app after re-running.

## Headline

> **Of Austin's 127,814 expired residential permits, 11,885 (9.3%) are single-scope water heater, window, roof, or fence jobs that PremedFix's rules route to document-based resolution.** The owner submits documents online, staff review them, and an authorized official decides. No rule requires a specialist or a site visit, though the official may still order one.
>
> A cautious lower bound is **6,000 (4.7%)**. It excludes water-heater replacements whose description doesn't say "electric": Austin's data doesn't record fuel type, and gas-fired units warrant more caution.

| Remote-eligible category | Permits |
|---|---:|
| Water heater replacement | 5,990 |
| Window replacement (doors included when replaced alongside) | 4,474 |
| Roof replacement | 1,349 |
| Fence | 72 |
| **Total** | **11,885** |

82% of these were issued in 2010 or later. Owners are more likely to still have invoices, and contractors are more likely to still be in business.

## Where the other 90% go

| Engine routing | Permits | Share | Why |
|---|---:|---:|---|
| Staff review | 70,543 | 55.2% | No rule in the default set covers the work type |
| Specialist review with site inspection | 45,240 | 35.4% | Electrical 28,944 · additions 9,179 · gas 4,266 · structural 2,851 |
| Remote-eligible (document-based) | 11,885 | 9.3% | |
| Data reconciliation | 113 | 0.1% | No property address in the record |
| Not yet expired | 33 | 0.0% | Status says Expired but the expiration date is in the future |

The engine treats every electrical permit as high-concern, and any furnace or boiler as possible gas work. Description wording can only escalate a permit, never clear it. 8,180 permits were escalated by their description text, 514 of them where the category alone wouldn't have flagged them.

### The biggest policy lever

The largest work type with no rule is **HVAC change-outs** (12,689 mechanical change-out permits).

PremedFix's rule editor previews a change like this before it is switched on. Running the engine with a draft that adds one standard-concern HVAC rule moves **13,026** single-scope HVAC replacements to document-based review, and the remote-eligible share roughly doubles, to **19.5%**. Furnaces, boilers, heaters, gas, and electrical work stay with specialists. That is a policy decision for Austin's building official. PremedFix does not apply it.

The other large uncovered groups:

| Work type | Permits |
|---|---:|
| Mechanical remodel | 10,908 |
| Plumbing remodel | 10,295 |
| Building remodel | 7,535 |
| New building | 7,164 |
| Building repair | 5,658 |
| Irrigation | 4,797 |
| Plumbing repair | 4,140 |
| Demolition | 3,279 |

Many of the mechanical and plumbing remodel permits are trade permits issued alongside a new house.

## What the data itself shows

- **The backlog is old.** 40.8% of the permits (52,091) were issued before 2007, and 29.8% before 2000.
  - 38,157 permits (29.9%) last changed status on a single day, 2007-06-06. That looks like a bulk status update in the source system.
- **"Completed" dates are not finals.** 41,459 expired permits (32.4%) carry a `completed_date`.
  - 98% of those dates are before 2007, and they usually fall on or before the expiration date.
  - PremedFix does **not** treat them as final inspections. Doing so would have marked about a third of the backlog as already finaled on the strength of a legacy field.
- **Related records already passed final.**
  - 4,436 expired permits (3.5%) belong to a parent permit whose status is Final.
  - 440 expired permits are cited by a later permit that passed final. Austin routinely "rolls in" expired permits during later renovations, for example "Rolling in expired permit 2002-018829 BP (replacement windows)".
  - Together these cover 4,870 permits (3.8%). They are leads for staff to confirm in the city's permit system, not closures.
- **No owner contact data.** The public data has no owner contact details. 97% of records (123,987) carry a Travis Central Appraisal District (TCAD) parcel ID, so staff can look up the owner of record. PremedFix never contacts anyone from imported data without staff verification.
- **Data quality is good.** No row was rejected. Six records have an expiration date before their issue date.

## What running on real data changed in PremedFix

1. **Duplicate detection was wrong for single-system data.**
   - The first run flagged 25,280 permits (19.8%) as possible duplicates, which would have buried the real work.
   - Austin issues separate building, electrical, mechanical, and plumbing permits for one project, and many lots share one parcel ID before platting.
   - The fix has two parts:
     - Two *unclassified* permits are no longer treated as the same work.
     - The property, category, and date match now applies only *across* source systems. Within one system, a different permit number is a different permit.
   - Permit numbers that match after formatting cleanup are still flagged. Both rules have unit tests (`tests/unit/dedupe.test.ts`).
   - After the fix, 0 permits are flagged as duplicates.
2. **Austin needs a category adapter** (`src/server/imports/austin.ts`). Austin's data is organized by trade, with no work-category field. The adapter derives a category and may only err toward caution:
   - Any high-concern signal wins.
   - A standard category requires a single-scope job under the right trade permit.
   - Everything else is Other, which goes to staff review.

   A 120-record spot check of the first version found 4 jobs that were broader than their category: a roof pitch change, a roof raise, a window job that also rebuilt a stair and guardrail, and a remodel described as "Remod.". The scope filter was tightened from a review of the uncommon words in every remote-eligible description. A second 120-record sample matched its category in every case. The cases found are unit tests (`tests/unit/austin.test.ts`).

## Limits

- **The rules are PremedFix's demo defaults, not Austin's.** Austin's building official decides what can be resolved with documents. The engine output is a routing suggestion, and every permit still needs an official's determination.
- **"Remote-eligible" is not "safe".** It means the rules call for documentary evidence rather than a site visit. Low review priority is administrative urgency only.
- **Categories come from free-text descriptions.** Spot checks are samples, not a full audit, though errors in either direction send a permit to human review rather than closing it.
- **No state-law shortcut was applied.** The Florida aged-permit provision in the reference rule set has no bearing on Texas.
- **Data handling.** Only public fields were downloaded. Contractor and applicant names and phone numbers were excluded. This document reports aggregates only.
