# PremedFix — YC demo video plan

**Format:** landscape 1920×1080, 30 fps, 159 s. The user asked for a Y Combinator demo that shows everything, overriding the 15–25 s default.
**Tone:** polished. Calm, institutional, confident. Long holds, soft dips, no gimmicks.

## What it is

- **One sentence:** PremedFix helps building departments resolve backlogs of expired permits: import the export, triage with auditable rules, collect homeowner evidence, and route it to the official who decides.
- **For whom:** municipal building departments (administrators, clerks, inspectors, building officials).
- **What sets it apart:** deterministic rules with a trace for every flag; every extracted fact cites a verbatim quote and page; a permit closes only after an authorized official decides *and* the city's system of record confirms. No AI approves or closes anything.
- **Most impressive claim:** run on Austin's real open data, 11,886 of 127,814 expired residential permits (9.3%) route to document-based resolution under default rules; 4.7% on the most cautious reading; 19.2% if the city adds one HVAC rule.
- **Visual hook:** the number 127,814 counting up on a dark field.
- **Real UI shown:** import mapper and preview, case rule trace, owner contact and notice approval, homeowner portal on a phone, inspector review with quoted facts, official determination and confirmation, audit trail, the Austin analysis page.
- **Share caption:** "Austin has 127,814 expired residential permits. PremedFix gets each one to a decision, with the evidence attached, and never lets software close a permit."

## Angle

Start with a real, specific number from a real city. Show the full resolution loop in the working product, step by step, with the human checkpoints visible. Land on the Austin result and the principle: people decide.

## Visual identity

- PremedFix's own tokens: brand blue `#2f4fd8`, logo accent `#a9b8f5`, ink `#101828`, canvas `#f6f7f9`. Geist Sans (the app's font).
- Stage: deep navy field with a soft brand-blue glow; the app sits in a clean window on the right, a numbered step column on the left (the steps are a real sequence, so numbers carry information).
- Real screens captured at 2× from an isolated, freshly seeded demo server; camera moves (scroll, zoom to the element), a cursor with click ripples, and state changes from real before/after captures.
- Demo people and addresses are fictional seed data (Lakemont is a fictional city). The Austin figures are real aggregates from Austin's open data; no personal data appears.

## Storyboard

| # | Time | Scene | On screen | Motion / sound |
|---|---|---|---|---|
| 1 | 0.0–7.0 | Hook | "127,814" counts up; "expired residential permits in Austin, Texas"; source line | Count-up with soft ticks; pad swell and riser |
| 2 | 7.0–12.0 | Reveal | PremedFix mark + name; "Resolves expired permit backlogs for building departments." | Soft impact on 7.0, groove begins |
| 3 | 12.0–17.0 | The loop | Six steps appear in order: Import · Triage · Contact · Evidence · Review · Decide | Steps stagger in, light clicks |
| 4 | 17.0–22.0 | Command center | Overview dashboard rises in a window; "The whole backlog in one place" | Window rise, whoosh |
| 5 | 22.0–35.0 | 01 Import | Mapper (Permit ID ← "Permit Number" with sample values) → Validate → preview with the rejected row and its reason → Commit → "7 created" | Zooms to mapping and reason; two clicks |
| 6 | 35.0–46.0 | 02 Triage | Case LKM-BLD-2019-04127 → zoom into "Why this case was flagged" rule trace | Scroll + zoom |
| 7 | 46.0–57.0 | 03 Contact | Unverified contact → verify → draft notice (plain template) → "Approve and send (simulated)" → Owner contacted | Three clicks |
| 8 | 57.0–70.0 | 04 Evidence | Phone portal: confirm it's you → code → checklist → invoice + photos uploaded → "Received — waiting for review" | Taps, phone rise |
| 9 | 70.0–84.0 | 05 Review | Inspector workspace: quote "permit reference: LKM-BLD-2019-04127" zoomed; Begin review; Accept ×3; Mark ready; "Your role cannot record determinations" | Zoom, five clicks |
| 10 | 84.0–96.0 | 06 Decide | Official signs the determination → "Closure submitted — awaiting system-of-record confirmation" → Simulate confirmation → "Officially closed" | Chime on closed |
| 11 | 96.0–101.0 | Audit | Audit timeline on the closed case; "append-only, hash-chained" | Slow scroll |
| 12 | 101.0–116.0 | Safeguards | Evidence conflict (applicant 2019-06-01 vs invoice 2020-03-15), electrical site-inspection lock, duplicate records side by side, another municipality gets "Not found"; a four-item list lights up in step | Dips between shots, whoosh |
| 13 | 116.0–136.0 | Rule editor | HVAC has no rule → start a draft → "Write a rule" → impact preview: 2 of the open cases move to owner document review, flagged less cautious → attest → activate → "Applied: triage re-run on the 2 open cases" | Four clicks, chimes on preview and applied |
| 14 | 136.0–151.0 | Austin | /austin page; left column: 9.3% (11,885 permits), 4.7% cautious floor, 19.5% with one HVAC rule (the same preview, run on Austin's data); "Every number traces to Austin's open data." | Camera to hero, floor line, lever card; counters |
| 15 | 151.0–159.0 | Outro | "No AI approves or closes a permit." → "PremedFix gets each permit to a decision, evidence attached." → mark + name | Resolve chord, fade |

Total: 159 s.

## Copy (left column)

1. **01 Import** — "Import any permit export." Columns are mapped from the file's own headers. Every row is validated, and rejected rows keep their reason.
2. **02 Triage** — "Triage with rules you can audit." Each flag names its rule, version, and the fields it read. Missing values are never filled in.
3. **03 Contact** — "Reach owners, with approval." Staff verify the contact against property records and approve every notice before it goes out.
4. **04 Evidence** — "Homeowners send proof from their phone." A one-time code confirms the verified contact. Then an invoice, photos, and a short statement.
5. **05 Review** — "Every fact cites its source." Extracted values show the exact quote and page. The inspector accepts each checklist item.
6. **06 Decide** — "Officials decide. Not software." Only a building official records the decision, and the permit closes when the city's system confirms it.

## Sound

One synthesized piece in D major at 92 BPM: warm pad and soft electric-piano arpeggio, sine bass, light kick and shaker from the first product scene, a lift for the Austin section, a resolve for the outro. UI clicks, whooshes, and the closing chime are tuned to the same key and sit under the music.
