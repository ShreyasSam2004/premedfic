import { CATEGORY_LABELS, PERMIT_CATEGORIES } from "@/domain/permits";
import { CASE_STATES, STATE_META } from "@/domain/workflow";
import { CLASSIFICATION_META, TRIAGE_CLASSIFICATIONS } from "@/domain/triage";
import { buttonClass, Select } from "@/components/ui/primitives";

export function qs(base: string, params: Record<string, string | number | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export type FilterKey = "jurisdictionId" | "category" | "status" | "priority" | "assigned" | "age" | "evidence" | "classification";

export function FilterBar({
  action,
  values,
  show,
  jurisdictions,
  staff,
  extra,
}: {
  action: string;
  values: Record<string, string | undefined>;
  show: FilterKey[];
  jurisdictions: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  extra?: React.ReactNode;
}) {
  const sel = (name: string, label: string, options: [string, string][]) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <Select name={name} defaultValue={values[name] ?? ""} className="h-8 w-auto min-w-[140px] text-[12.5px]">
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2.5">
      {extra}
      {show.includes("jurisdictionId") && sel("jurisdictionId", "Municipality", jurisdictions.map((j) => [j.id, j.name]))}
      {show.includes("category") && sel("category", "Category", [...PERMIT_CATEGORIES.map((c) => [c, CATEGORY_LABELS[c]] as [string, string]), ["uncategorized", "Missing category"]])}
      {show.includes("status") &&
        sel("status", "Workflow status", [
          ["unresolved", "Unresolved backlog"],
          ["open", "All open"],
          ["intake", "Intake"],
          ["verification", "Finalization to verify"],
          ["awaiting_owner", "Awaiting owner"],
          ["review", "In review"],
          ["disposition", "Disposition"],
          ["resolved", "Resolved by PremedFix"],
          ["already_resolved", "Already resolved (prior final)"],
          ...CASE_STATES.map((s) => [s, STATE_META[s].label] as [string, string]),
        ])}
      {show.includes("classification") && sel("classification", "Triage", TRIAGE_CLASSIFICATIONS.map((c) => [c, CLASSIFICATION_META[c].label]))}
      {show.includes("priority") && sel("priority", "Review priority", [["P1", "P1 — urgent"], ["P2", "P2 — high"], ["P3", "P3 — normal"], ["P4", "P4 — low"]])}
      {show.includes("age") && sel("age", "Permit age", [["lt2", "Under 2 years"], ["2to5", "2–5 years"], ["5to10", "5–10 years"], ["gt10", "Over 10 years"]])}
      {show.includes("evidence") && sel("evidence", "Evidence", [["none", "None provided"], ["partial", "Partial"], ["complete", "All required provided"]])}
      {show.includes("assigned") && sel("assigned", "Assigned", [["me", "Me"], ["unassigned", "Unassigned"], ...staff.map((s) => [s.id, s.name] as [string, string])])}
      <button type="submit" className={buttonClass("secondary", "sm", "h-8")}>
        Apply
      </button>
      <a href={action} className={buttonClass("ghost", "sm", "h-8")}>
        Reset
      </a>
    </form>
  );
}
