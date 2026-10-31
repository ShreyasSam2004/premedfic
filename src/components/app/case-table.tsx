"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { CaseState } from "@/domain/workflow";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { ActionForm, SubmitButton } from "./action-form";
import { ClassificationBadge, PriorityBadge, StatusPill } from "./badges";
import { ageLabel, cn, fmtDate, Select, Td, Th } from "@/components/ui/primitives";
import { bulkCaseAction } from "@/app/(staff)/actions";

export interface CaseRow {
  id: string;
  status: CaseState;
  priority: string | null;
  classification: string | null;
  manualOutreachRequired: boolean;
  permitNumber: string;
  category: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  address: string | null;
  jurisdiction: string;
  assignedName: string | null;
  reqRequired: number | null;
  reqSatisfied: number | null;
  evidenceItems: number | null;
}

function SortHeader({ col, children, className }: { col: string; children: React.ReactNode; className?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const current = sp.get("sort") ?? "priority";
  const dir = sp.get("dir") ?? "desc";
  const next = new URLSearchParams(sp.toString());
  next.set("sort", col);
  next.set("dir", current === col && dir === "desc" ? "asc" : "desc");
  next.delete("page");
  const Icon = current === col ? (dir === "desc" ? ArrowDown : ArrowUp) : ChevronsUpDown;
  return (
    <Th className={className} aria-sort={current === col ? (dir === "desc" ? "descending" : "ascending") : "none"}>
      <Link href={`${path}?${next}`} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <Icon className="size-3" aria-hidden />
      </Link>
    </Th>
  );
}

export function CaseTable({ rows, staff, canBulk, canTriage, linkBase = "/cases" }: { rows: CaseRow[]; staff: { id: string; name: string; role: string }[]; canBulk: boolean; canTriage: boolean; linkBase?: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div>
      {canBulk && selected.size > 0 && (
        <ActionForm action={bulkCaseAction} className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft px-3 py-2" compact>
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="caseId" value={id} />
          ))}
          <span className="text-[12.5px] font-medium text-ink">{selected.size} selected</span>
          <Select name="assignee" aria-label="Assign to" className="h-7 w-auto text-[12px]" defaultValue="">
            <option value="">Assign to…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role})
              </option>
            ))}
          </Select>
          <SubmitButton size="sm" variant="secondary" name="op" value="assign">
            Assign
          </SubmitButton>
          {canTriage && (
            <SubmitButton size="sm" variant="secondary" name="op" value="triage">
              Re-run triage
            </SubmitButton>
          )}
          <span className="text-[11.5px] text-muted">Approvals and closures are never available in bulk.</span>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[12px] text-muted hover:text-ink">
            Clear
          </button>
        </ActionForm>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr>
              {canBulk && (
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={all}
                    onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="size-3.5 accent-brand"
                  />
                </Th>
              )}
              <SortHeader col="priority">Priority</SortHeader>
              <SortHeader col="permit">Permit</SortHeader>
              <Th>Property</Th>
              <Th>Category</Th>
              <SortHeader col="issued">Age</SortHeader>
              <SortHeader col="expires">Expired</SortHeader>
              <Th>Triage</Th>
              <SortHeader col="status">Workflow</SortHeader>
              <Th>Evidence</Th>
              <Th>Assigned</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-subtle/60", selected.has(r.id) && "bg-brand-soft/50")}>
                {canBulk && (
                  <Td>
                    <input type="checkbox" aria-label={`Select ${r.permitNumber}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="size-3.5 accent-brand" />
                  </Td>
                )}
                <Td>
                  <PriorityBadge priority={r.priority} />
                </Td>
                <Td>
                  <Link href={`${linkBase}/${r.id}`} className="font-mono text-[12px] font-medium whitespace-nowrap text-ink hover:text-brand hover:underline">
                    {r.permitNumber}
                  </Link>
                </Td>
                <Td className="max-w-[220px]">
                  <div className="truncate">{r.address ?? <span className="text-tone-attention-fg">Missing address</span>}</div>
                  <div className="truncate text-[11px] text-muted">{r.jurisdiction}</div>
                </Td>
                <Td className="whitespace-nowrap">{r.category ? CATEGORY_LABELS[r.category as PermitCategory] : <span className="text-tone-attention-fg">Missing</span>}</Td>
                <Td className="tabular whitespace-nowrap text-ink-2">{ageLabel(r.issuedAt)}</Td>
                <Td className="tabular whitespace-nowrap text-ink-2">{r.expiresAt ? fmtDate(r.expiresAt) : <span className="text-faint">Unknown</span>}</Td>
                <Td>
                  <ClassificationBadge classification={r.classification} />
                  {r.manualOutreachRequired && r.status === "TRIAGED" && <div className="mt-0.5 text-[11px] text-tone-attention-fg">Manual outreach</div>}
                </Td>
                <Td>
                  <StatusPill state={r.status} short />
                </Td>
                <Td className="tabular whitespace-nowrap">
                  {r.reqRequired ? (
                    <span className={cn(r.reqSatisfied === r.reqRequired ? "text-ink" : "text-ink-2")}>
                      {r.reqSatisfied ?? 0}/{r.reqRequired}
                      <span className="text-muted"> items</span>
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.assignedName ?? <span className="text-faint">Unassigned</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
