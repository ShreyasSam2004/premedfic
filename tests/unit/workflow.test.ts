import { describe, expect, it } from "vitest";
import { availableTransitions, CASE_STATES, checkTransition, emptySnapshot, TRANSITIONS, type ActorKind } from "@/domain/workflow";

describe("state machine", () => {
  it("rejects transitions from the wrong state", () => {
    const r = checkTransition("mark_ready_for_disposition", "TRIAGED", "inspector", emptySnapshot());
    expect(r.allowed).toBe(false);
    expect(r.problems[0]).toMatch(/not available from state/);
  });

  it("rejects unauthorized actors", () => {
    expect(checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "inspector", emptySnapshot({ proposedDetermination: "void_permit" }), "reason text").allowed).toBe(false);
    expect(checkTransition("send_notice", "AWAITING_CONTACT_APPROVAL", "inspector", emptySnapshot({ approvedNoticeDispatched: true })).allowed).toBe(false);
    expect(checkTransition("send_notice", "AWAITING_CONTACT_APPROVAL", "homeowner", emptySnapshot({ approvedNoticeDispatched: true })).allowed).toBe(false);
  });

  it("no transition can be performed by an AI or model actor", () => {
    const actors = new Set(Object.values(TRANSITIONS).flatMap((t) => t.actors as readonly string[]));
    for (const a of actors) expect(["admin", "clerk", "inspector", "official", "manager", "system", "homeowner"]).toContain(a);
    expect(checkTransition("complete_triage", "IMPORTED", "ai" as ActorKind, emptySnapshot({ classification: "EVIDENCE_COLLECTION" })).allowed).toBe(false);
  });

  it("requires reasons where specified", () => {
    const r = checkTransition("require_inspection", "UNDER_STAFF_REVIEW", "inspector", emptySnapshot());
    expect(r.problems).toContain("A reason is required for this action");
    expect(checkTransition("require_inspection", "UNDER_STAFF_REVIEW", "inspector", emptySnapshot(), "Electrical service requires inspection").allowed).toBe(true);
  });

  it("blocks 'ready for disposition' until evidence, conflicts, specialist and inspection guards pass", () => {
    const blocked = checkTransition(
      "mark_ready_for_disposition",
      "UNDER_STAFF_REVIEW",
      "inspector",
      emptySnapshot({ requirementsOutstanding: ["Contractor invoice"], openConflicts: 1, specialistRequired: true, siteInspectionRequired: true }),
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.problems).toHaveLength(4);
    expect(
      checkTransition(
        "mark_ready_for_disposition",
        "UNDER_STAFF_REVIEW",
        "inspector",
        emptySnapshot({ specialistRequired: true, siteInspectionRequired: true, specialistAssessmentRecorded: true, passedInspectionRecorded: true }),
      ).allowed,
    ).toBe(true);
  });

  it("only officials with approval authority may record determinations, with closure safeguards", () => {
    const base = emptySnapshot({ approvalAuthority: ["official"], proposedDetermination: "close_requirements_satisfied" });
    expect(checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "official", base, "Basis for the determination").allowed).toBe(true);
    const noAuthority = emptySnapshot({ approvalAuthority: ["manager"], proposedDetermination: "close_requirements_satisfied" });
    expect(checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "official", noAuthority, "Basis").allowed).toBe(false);
    const highConcern = emptySnapshot({ proposedDetermination: "close_requirements_satisfied", siteInspectionRequired: true, specialistRequired: true });
    const r = checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "official", highConcern, "Basis");
    expect(r.allowed).toBe(false);
    expect(r.problems.join(" ")).toMatch(/site inspection/);
  });

  it("aged-permit closure requires rule-set eligibility", () => {
    const s = emptySnapshot({ proposedDetermination: "close_aged_permit_no_apparent_hazard" });
    expect(checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "official", s, "Basis").allowed).toBe(false);
    expect(checkTransition("record_determination", "READY_FOR_AUTHORIZED_DISPOSITION", "official", { ...s, agedPermitEligible: true }, "Basis").allowed).toBe(true);
  });

  it("official closure requires a pending submission and a closing determination", () => {
    expect(checkTransition("confirm_source_closure", "DISPOSITION_PENDING_CONFIRMATION", "system", emptySnapshot(), "confirmed").allowed).toBe(false);
    expect(
      checkTransition("confirm_source_closure", "DISPOSITION_PENDING_CONFIRMATION", "system", emptySnapshot({ pendingSubmission: true, recordedDetermination: "void_permit" }), "confirmed").allowed,
    ).toBe(false);
    expect(
      checkTransition("confirm_source_closure", "DISPOSITION_PENDING_CONFIRMATION", "system", emptySnapshot({ pendingSubmission: true, recordedDetermination: "close_requirements_satisfied" }), "confirmed").allowed,
    ).toBe(true);
    expect(
      checkTransition("confirm_source_other_outcome", "DISPOSITION_PENDING_CONFIRMATION", "system", emptySnapshot({ pendingSubmission: true, recordedDetermination: "void_permit" }), "confirmed").allowed,
    ).toBe(true);
  });

  it("keeps 'ready', 'pending confirmation', and 'officially closed' distinct", () => {
    expect(TRANSITIONS.mark_ready_for_disposition.to).toBe("READY_FOR_AUTHORIZED_DISPOSITION");
    expect(TRANSITIONS.record_determination.to).toBe("DISPOSITION_PENDING_CONFIRMATION");
    expect(TRANSITIONS.confirm_source_closure.to).toBe("OFFICIALLY_CLOSED");
    const toClosed = Object.values(TRANSITIONS).filter((t) => t.to === "OFFICIALLY_CLOSED");
    expect(toClosed.map((t) => t.id)).toEqual(["confirm_source_closure"]);
  });

  it("homeowners can only submit evidence after verification", () => {
    const s = emptySnapshot({ submittedEvidenceCount: 2 });
    expect(checkTransition("submit_evidence", "AWAITING_EVIDENCE", "homeowner", s).allowed).toBe(false);
    expect(checkTransition("submit_evidence", "AWAITING_EVIDENCE", "homeowner", { ...s, homeownerVerified: true }).allowed).toBe(true);
    expect(checkTransition("submit_evidence", "AWAITING_EVIDENCE", "homeowner", emptySnapshot({ homeownerVerified: true })).allowed).toBe(false);
  });

  it("notices require a verified contact and a draft", () => {
    expect(checkTransition("queue_notice", "TRIAGED", "clerk", emptySnapshot({ classification: "EVIDENCE_COLLECTION", pendingDraftNotice: true })).allowed).toBe(false);
    expect(checkTransition("queue_notice", "TRIAGED", "clerk", emptySnapshot({ classification: "EVIDENCE_COLLECTION", pendingDraftNotice: true, contactable: true })).allowed).toBe(true);
  });

  it("every state is reachable and terminal states only reopen", () => {
    const reachable = new Set(["IMPORTED"]);
    for (const t of Object.values(TRANSITIONS)) reachable.add(t.to);
    for (const s of CASE_STATES) expect(reachable.has(s)).toBe(true);
    expect(availableTransitions("OFFICIALLY_CLOSED", "official").map((t) => t.id)).toEqual(["reopen_case"]);
    expect(availableTransitions("MERGED_DUPLICATE", "admin")).toHaveLength(0);
  });
});
