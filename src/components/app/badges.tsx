import { CircleCheck, ShieldAlert } from "lucide-react";
import { STATE_META, type CaseState, type Tone } from "@/domain/workflow";
import { CLASSIFICATION_META, PRIORITY_DISCLAIMER, PRIORITY_META, type Priority, type TriageClassification } from "@/domain/triage";
import { PROVENANCE_META, REQUIREMENT_STATUS_LABELS, type Provenance, type RequirementStatus } from "@/domain/evidence";
import { Badge, cn } from "@/components/ui/primitives";

export function StatusPill({ state, short }: { state: CaseState; short?: boolean }) {
  const meta = STATE_META[state];
  const label = short && state === "DISPOSITION_PENDING_CONFIRMATION" ? "Awaiting source confirmation" : meta.label;
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {state === "OFFICIALLY_CLOSED" && <CircleCheck className="-ml-0.5 size-3" aria-hidden />}
      {label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-faint">—</span>;
  const p = priority as Priority;
  const level = { P1: 4, P2: 3, P3: 2, P4: 1 }[p] ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap text-ink-2" title={`${PRIORITY_META[p]?.description} ${PRIORITY_DISCLAIMER}`}>
      <span aria-hidden className="flex items-end gap-px">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-[1px]", i <= level ? "bg-ink-2" : "bg-line-strong")} style={{ height: 3 + i * 2 }} />
        ))}
      </span>
      {p}
      <span className="sr-only">{PRIORITY_META[p]?.label}</span>
    </span>
  );
}

const CLASS_TONE: Record<TriageClassification, Tone> = {
  DATA_RECONCILIATION: "attention",
  FINALIZATION_CONFIRMATION: "pending",
  SPECIALIST_REVIEW: "critical",
  STAFF_REVIEW: "review",
  EVIDENCE_COLLECTION: "info",
  MONITOR_ACTIVE: "neutral",
};

export function ClassificationBadge({ classification }: { classification: string | null }) {
  if (!classification) return <span className="text-faint">Not triaged</span>;
  const c = classification as TriageClassification;
  return (
    <Badge tone={CLASS_TONE[c] ?? "neutral"} dot={c !== "SPECIALIST_REVIEW"} title={CLASSIFICATION_META[c]?.description}>
      {c === "SPECIALIST_REVIEW" && <ShieldAlert className="-ml-0.5 size-3" aria-hidden />}
      {CLASSIFICATION_META[c]?.label ?? c}
    </Badge>
  );
}

const PROV_STYLE: Record<Provenance, string> = {
  verified_record: "border-ink-2/40 text-ink",
  applicant_claim: "border-dashed border-[#b54708]/50 text-[#93370d]",
  extracted: "border-dotted border-brand/60 text-brand",
  ai_extracted: "border-dotted border-[#7a5af8]/70 text-[#5925dc]",
  inference: "border-line-strong text-muted italic",
  unknown: "border-line-strong bg-subtle text-muted",
};

export function ProvenanceBadge({ provenance }: { provenance: string }) {
  const p = provenance as Provenance;
  return (
    <span title={PROVENANCE_META[p]?.description} className={cn("inline-flex items-center rounded border px-1.5 py-px text-[10.5px] font-semibold tracking-wide whitespace-nowrap uppercase", PROV_STYLE[p])}>
      {PROVENANCE_META[p]?.label ?? provenance}
    </span>
  );
}

const REQ_TONE: Record<RequirementStatus, Tone> = { missing: "neutral", provided: "info", accepted: "review", rejected: "critical", waived: "attention" };

export function RequirementBadge({ status }: { status: string }) {
  const s = status as RequirementStatus;
  return <Badge tone={REQ_TONE[s] ?? "neutral"}>{REQUIREMENT_STATUS_LABELS[s] ?? status}</Badge>;
}
