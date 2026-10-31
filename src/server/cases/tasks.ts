/**
 * Derives the outstanding tasks for a case, and who is responsible for each,
 * from its recorded state. Pure: no queries.
 */
import type { CaseDetail } from "./queries";
import { isContactable } from "../workflow/service";

export interface Task {
  label: string;
  responsible: string;
  detail?: string;
}

export function outstandingTasks(d: CaseDetail): Task[] {
  const t: Task[] = [];
  const st = d.c.status;
  const hasAddr = Boolean(d.property?.addressLine);
  const contactable = d.contacts.some((c) => isContactable(c, hasAddr));
  const openDup = d.duplicates.filter((x) => x.d.status === "open");
  const reqOutstanding = d.requirements.filter((r) => r.required && !["accepted", "waived"].includes(r.status));
  const openConflicts = d.findings.filter((f) => f.kind === "conflict" && f.status === "open");
  const specialistNeeded = Boolean(d.triage?.specialistRequired) && !d.decisions.some((x) => x.decisionType === "specialist_assessment");
  const inspectionNeeded =
    Boolean(d.triage?.siteInspectionRequired) && !d.inspections.some((i) => i.source === "recorded" && i.result === "passed" && (i.inspectionType === "final" || i.inspectionType === "site_assessment"));

  if (d.c.flags.includes("source_reports_final")) {
    t.push({ label: "A source now reports this permit finaled: pause it for finalization verification", responsible: "Permit clerk" });
  }
  switch (st) {
    case "NEEDS_DATA_RECONCILIATION":
      for (const x of openDup) t.push({ label: `Confirm or dismiss possible duplicate ${x.other.permitNumber}`, responsible: "Permit clerk" });
      for (const f of d.permit.missingFields) t.push({ label: `Obtain missing ${f} from the system of record`, responsible: "Permit clerk" });
      if (!openDup.length && !d.permit.missingFields.length && d.triage?.classification === "DATA_RECONCILIATION")
        t.push({ label: "Reconcile the record's status against the system of record", responsible: "Permit clerk" });
      break;
    case "FINALIZATION_VERIFICATION":
      t.push({
        label: "Verify the reported final with the permit system of record",
        responsible: "Permit clerk",
        detail: "No owner outreach, evidence requests, or inspections while verification is pending.",
      });
      break;
    case "ALREADY_RESOLVED":
      t.push({ label: "No action: the permit system confirmed an existing final", responsible: "—" });
      break;
    case "TRIAGED":
      if (d.triage?.classification === "MONITOR_ACTIVE") {
        t.push({ label: "No action: permit has not expired", responsible: "—" });
        break;
      }
      if (specialistNeeded && !d.c.specialistUserId) t.push({ label: `Assign a ${d.triage?.specialistDiscipline ?? "qualified"} specialist`, responsible: "Permit clerk / manager" });
      if (!contactable)
        t.push(
          d.contacts.length
            ? { label: "Verify owner contact against property records", responsible: "Permit clerk", detail: "Imported contact details are never used until verified." }
            : { label: "Research the owner of record (manual outreach)", responsible: "Permit clerk", detail: "No contact on file. The system will not guess." },
        );
      else t.push({ label: "Draft owner notice for approval", responsible: "Permit clerk" });
      break;
    case "AWAITING_CONTACT_APPROVAL":
      t.push({ label: "Review and approve (or withdraw) the drafted notice", responsible: "Administrator / clerk / manager" });
      break;
    case "OWNER_CONTACTED":
      t.push({ label: "Awaiting owner to verify on the portal", responsible: "Property owner" });
      break;
    case "AWAITING_EVIDENCE":
    case "ADDITIONAL_INFORMATION_REQUIRED":
      t.push({ label: st === "AWAITING_EVIDENCE" ? "Awaiting owner's evidence submission" : "Awaiting owner's response to the reviewer's request", responsible: "Property owner" });
      break;
    case "EVIDENCE_RECEIVED":
      t.push({ label: "Begin staff review of submitted evidence", responsible: "Inspector / official" });
      break;
    case "UNDER_STAFF_REVIEW":
      for (const r of reqOutstanding) t.push({ label: `Review checklist item: ${r.label} (${r.status})`, responsible: "Reviewer" });
      for (const f of openConflicts) t.push({ label: "Resolve discrepancy", responsible: "Reviewer", detail: f.message });
      if (specialistNeeded) t.push({ label: `Record ${d.triage?.specialistDiscipline ?? "specialist"} assessment`, responsible: "Specialist inspector" });
      if (inspectionNeeded) t.push({ label: "A passed site inspection is required before disposition", responsible: "Inspector" });
      if (!reqOutstanding.length && !openConflicts.length && !specialistNeeded && !inspectionNeeded) t.push({ label: "Mark ready for authorized disposition", responsible: "Reviewer" });
      break;
    case "INSPECTION_REQUIRED":
      t.push({ label: "Conduct and record the site inspection", responsible: "Inspector" });
      break;
    case "READY_FOR_AUTHORIZED_DISPOSITION":
      t.push({ label: "Record an official determination", responsible: "Building official" });
      break;
    case "DISPOSITION_PENDING_CONFIRMATION":
      t.push({ label: "Await confirmation from the municipal system of record", responsible: "System of record / administrator" });
      break;
  }
  return t;
}
