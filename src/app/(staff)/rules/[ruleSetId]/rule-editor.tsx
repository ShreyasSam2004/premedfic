"use client";

/**
 * Structured editor for a draft rule set. Builds the configuration the engine
 * reads; the server validates it again on save. Nothing applies until the
 * draft is activated.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { ROLE_LABELS } from "@/domain/roles";
import { APPROVAL_ROLES, EVIDENCE_LIBRARY, RULE_EDITOR_CATEGORIES, defaultCategoryRule, type RequirementSpec } from "@/domain/rule-library";
import type { CategoryRule, RuleSetConfig } from "@/server/rules/config";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, Field, Input, Textarea, cn, inputClass } from "@/components/ui/primitives";
import { updateRuleDraftAction } from "@/app/(staff)/actions";

type Meta = { name: string; effectiveDate: string; sourceCitation: string; sourceUrl: string; changeSummary: string };

const DISCIPLINE: Partial<Record<PermitCategory, string>> = {
  electrical_service: "electrical",
  gas: "gas",
  structural: "structural",
  addition: "building",
  hvac: "mechanical",
  plumbing: "plumbing",
};

function summary(rule: CategoryRule | undefined) {
  if (!rule) return <span className="text-muted">No rule: routes to staff review</span>;
  const path =
    rule.pathway === "evidence_review" ? "Owner documents, staff review" : rule.pathway === "specialist_assessment" ? `${rule.specialistDiscipline ?? "Specialist"} specialist` : "Manual staff assessment";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={rule.concernLevel === "high" ? "critical" : "neutral"}>{rule.concernLevel}</Badge>
      <span className="text-ink-2">{path}</span>
      <span className="text-muted">· {rule.siteInspectionRequired ? "site inspection required" : "no site inspection by rule"}</span>
      <span className="text-muted">· {rule.requiredEvidence.filter((e) => e.required).length} required item(s)</span>
    </span>
  );
}

function CategoryEditor({ cat, rule, onChange }: { cat: PermitCategory; rule: CategoryRule; onChange: (r: CategoryRule) => void }) {
  const set = (patch: Partial<CategoryRule>) => onChange({ ...rule, ...patch });
  const present = new Map(rule.requiredEvidence.map((e) => [e.code, e]));
  const rows: { spec: RequirementSpec; on: boolean }[] = [
    ...EVIDENCE_LIBRARY.map((l) => ({ spec: (present.get(l.code) as RequirementSpec | undefined) ?? l, on: present.has(l.code) })),
    ...rule.requiredEvidence.filter((e) => !EVIDENCE_LIBRARY.some((l) => l.code === e.code)).map((e) => ({ spec: e as RequirementSpec, on: true })),
  ];
  const toggleEvidence = (spec: RequirementSpec, on: boolean) =>
    set({ requiredEvidence: on ? [...rule.requiredEvidence, { ...spec }] : rule.requiredEvidence.filter((e) => e.code !== spec.code) });
  const patchEvidence = (code: string, patch: Partial<RequirementSpec>) => set({ requiredEvidence: rule.requiredEvidence.map((e) => (e.code === code ? { ...e, ...patch } : e)) });
  const forcedInspection = rule.concernLevel === "high" && rule.pathway === "specialist_assessment";

  return (
    <div className="grid gap-4 border-t border-line bg-subtle/40 px-4 py-4 lg:grid-cols-2">
      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Concern level</legend>
          <div className="flex gap-4 text-[12.5px]">
            {(["standard", "high"] as const).map((lvl) => (
              <label key={lvl} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`concern-${cat}`}
                  checked={rule.concernLevel === lvl}
                  onChange={() =>
                    set(
                      lvl === "high"
                        ? { concernLevel: "high", pathway: "specialist_assessment", siteInspectionRequired: true, specialistDiscipline: rule.specialistDiscipline ?? DISCIPLINE[cat] ?? "building" }
                        : { concernLevel: "standard", pathway: "evidence_review", siteInspectionRequired: false, specialistDiscipline: null },
                    )
                  }
                />
                {lvl === "high" ? "High: specialist and inspection" : "Standard"}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Pathway" htmlFor={`pathway-${cat}`}>
          <select
            id={`pathway-${cat}`}
            className={inputClass}
            value={rule.pathway}
            onChange={(e) => {
              const pathway = e.target.value as CategoryRule["pathway"];
              set({ pathway, siteInspectionRequired: rule.concernLevel === "high" && pathway === "specialist_assessment" ? true : rule.siteInspectionRequired });
            }}
          >
            {rule.concernLevel === "standard" && <option value="evidence_review">Owner documents, then staff review</option>}
            {rule.concernLevel === "high" && <option value="specialist_assessment">Specialist assessment</option>}
            <option value="manual_staff_assessment">Manual staff assessment</option>
          </select>
        </Field>
        {rule.concernLevel === "high" && (
          <Field label="Specialist discipline" htmlFor={`discipline-${cat}`}>
            <Input id={`discipline-${cat}`} value={rule.specialistDiscipline ?? ""} onChange={(e) => set({ specialistDiscipline: e.target.value || null })} placeholder="e.g. mechanical" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={rule.siteInspectionRequired} disabled={forcedInspection} onChange={(e) => set({ siteInspectionRequired: e.target.checked })} />
          Require a passed site inspection before any disposition
          {forcedInspection && <span className="text-muted">(always, for high-concern specialist work)</span>}
        </label>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Who may record the determination</legend>
          <div className="flex flex-wrap gap-4 text-[12.5px]">
            {APPROVAL_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={rule.approvalAuthority.includes(role)}
                  onChange={(e) => set({ approvalAuthority: e.target.checked ? [...rule.approvalAuthority, role] : rule.approvalAuthority.filter((r) => r !== role) })}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          {rule.approvalAuthority.length === 0 && <p className="mt-1 text-[12px] text-tone-critical-fg">Choose at least one role.</p>}
        </fieldset>
        <Field label="Base review priority points" hint="0–50; administrative urgency only" htmlFor={`points-${cat}`}>
          <Input id={`points-${cat}`} type="number" min={0} max={50} value={rule.basePriorityPoints} onChange={(e) => set({ basePriorityPoints: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} className="w-28" />
        </Field>
      </div>
      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Evidence the owner is asked for</legend>
          <ul className="space-y-1.5">
            {rows.map(({ spec, on }) => (
              <li key={spec.code} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <label className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input type="checkbox" checked={on} onChange={(e) => toggleEvidence(spec, e.target.checked)} />
                  <span className={cn("truncate", !on && "text-muted")} title={spec.description}>
                    {spec.label}
                  </span>
                </label>
                {on && spec.acceptedTypes.includes("photo") && (
                  <label className="flex items-center gap-1 text-muted">
                    at least
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={present.get(spec.code)?.minCount ?? spec.minCount}
                      onChange={(e) => patchEvidence(spec.code, { minCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                      className={cn(inputClass, "h-7 w-14 px-1.5")}
                      aria-label={`Minimum count for ${spec.label}`}
                    />
                  </label>
                )}
                {on && (
                  <label className="flex items-center gap-1 text-muted">
                    <input type="checkbox" checked={present.get(spec.code)?.required ?? true} onChange={(e) => patchEvidence(spec.code, { required: e.target.checked })} />
                    required
                  </label>
                )}
              </li>
            ))}
          </ul>
          {rule.requiredEvidence.filter((e) => e.required).length === 0 && <p className="mt-1 text-[12px] text-tone-attention-fg">No required evidence: the owner request would be empty.</p>}
        </fieldset>
        <Field label="Procedure note" hint="shown to staff on each case" htmlFor={`note-${cat}`}>
          <Textarea id={`note-${cat}`} rows={3} value={rule.procedureNote} onChange={(e) => set({ procedureNote: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export function RuleEditor({ ruleSetId, meta, config }: { ruleSetId: string; meta: Meta; config: RuleSetConfig }) {
  const [cfg, setCfg] = useState<RuleSetConfig>(() => structuredClone(config));
  const [open, setOpen] = useState<PermitCategory | null>(null);
  const [sample, setSample] = useState("Replace gas furnace and add new circuit");

  const setRule = (cat: PermitCategory, rule: CategoryRule | null) =>
    setCfg((c) => {
      const categories = { ...c.categories };
      if (rule) categories[cat] = rule;
      else delete categories[cat];
      return { ...c, categories };
    });
  const setEsc = (i: number, patch: Partial<RuleSetConfig["descriptionEscalations"][number]>) =>
    setCfg((c) => ({ ...c, descriptionEscalations: c.descriptionEscalations.map((e, k) => (k === i ? { ...e, ...patch } : e)) }));
  const setPriority = (patch: Partial<RuleSetConfig["priority"]>) => setCfg((c) => ({ ...c, priority: { ...c.priority, ...patch } }));
  const validPattern = (p: string) => {
    try {
      new RegExp(p, "i");
      return true;
    } catch {
      return false;
    }
  };
  const matched = cfg.descriptionEscalations.filter((e) => validPattern(e.pattern) && sample && new RegExp(e.pattern, "i").test(sample)).map((e) => e.id);
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  return (
    <ActionForm action={updateRuleDraftAction} className="space-y-4">
      <input type="hidden" name="ruleSetId" value={ruleSetId} />
      <input type="hidden" name="config" value={JSON.stringify(cfg)} />

      <Card>
        <CardHeader title="Category rules" description="Write a rule to give a category its own pathway. A category without a rule routes to staff review. Unclassified permits always do." />
        <ul>
          {RULE_EDITOR_CATEGORIES.map((cat) => {
            const rule = cfg.categories[cat];
            const isOpen = open === cat;
            return (
              <li key={cat} className="border-b border-line last:border-b-0">
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <button type="button" onClick={() => setOpen(isOpen ? null : cat)} className="flex min-w-[190px] items-center gap-1.5 text-left text-[13px] font-medium text-ink" aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                    {CATEGORY_LABELS[cat]}
                  </button>
                  <div className="min-w-0 flex-1 text-[12px]">{summary(rule)}</div>
                  {rule ? (
                    <button type="button" className="text-[12px] text-muted hover:text-tone-critical-fg" onClick={() => setRule(cat, null)}>
                      Remove rule
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
                      onClick={() => {
                        setRule(cat, defaultCategoryRule(cat));
                        setOpen(cat);
                      }}
                    >
                      <Plus className="size-3.5" /> Write a rule
                    </button>
                  )}
                </div>
                {isOpen && rule && <CategoryEditor cat={cat} rule={rule} onChange={(r) => setRule(cat, r)} />}
                {isOpen && !rule && <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">No rule. Permits in this category route to staff review.</p>}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Description escalations" description="A permit whose work description matches a pattern goes to specialist review with a site inspection, whatever its category. Escalations can never clear a permit." />
        <CardBody className="space-y-3">
          {cfg.descriptionEscalations.map((e, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-2.5 md:grid-cols-[110px_130px_minmax(0,1fr)_auto]">
              <Input value={e.id} onChange={(ev) => setEsc(i, { id: ev.target.value })} aria-label="Escalation ID" placeholder="ESC-ID" />
              <Input value={e.discipline} onChange={(ev) => setEsc(i, { discipline: ev.target.value })} aria-label="Discipline" placeholder="discipline" />
              <Input value={e.message} onChange={(ev) => setEsc(i, { message: ev.target.value })} aria-label="Message" placeholder="Shown to staff" />
              <button type="button" className="flex items-center justify-center rounded-md px-2 text-muted hover:bg-subtle hover:text-tone-critical-fg" onClick={() => setCfg((c) => ({ ...c, descriptionEscalations: c.descriptionEscalations.filter((_, k) => k !== i) }))} aria-label={`Remove ${e.id}`}>
                <Trash2 className="size-3.5" />
              </button>
              <div className="md:col-span-4">
                <Input value={e.pattern} onChange={(ev) => setEsc(i, { pattern: ev.target.value })} aria-label="Pattern" className={cn("font-mono text-[11.5px]", !validPattern(e.pattern) && "border-tone-critical-dot")} />
                {!validPattern(e.pattern) && <p className="mt-1 text-[12px] text-tone-critical-fg">This pattern is not a valid regular expression.</p>}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            onClick={() => setCfg((c) => ({ ...c, descriptionEscalations: [...c.descriptionEscalations, { id: `ESC-${c.descriptionEscalations.length + 1}`, pattern: "\\b(keyword)\\b", discipline: "building", message: "Work description references safety-sensitive work" }] }))}
          >
            <Plus className="size-3.5" /> Add escalation
          </button>
          <div className="rounded-md bg-subtle px-3 py-2.5">
            <Field label="Test a work description" htmlFor="esc-sample">
              <Input id="esc-sample" value={sample} onChange={(e) => setSample(e.target.value)} />
            </Field>
            <p className="mt-1.5 text-[12px] text-ink-2">{matched.length ? `Escalates via ${matched.join(", ")}.` : "No escalation matches."}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Review priority" description="Administrative urgency only. A low priority is never a finding that work is safe." />
        <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Points per year expired" htmlFor="prio-year"><Input id="prio-year" type="number" min={0} max={20} value={cfg.priority.pointsPerYearExpired} onChange={(e) => setPriority({ pointsPerYearExpired: num(e.target.value) })} /></Field>
          <Field label="Max age points" htmlFor="prio-maxage"><Input id="prio-maxage" type="number" min={0} max={60} value={cfg.priority.maxAgePoints} onChange={(e) => setPriority({ maxAgePoints: num(e.target.value) })} /></Field>
          <Field label="High-concern points" htmlFor="prio-high"><Input id="prio-high" type="number" min={0} max={60} value={cfg.priority.highConcernPoints} onChange={(e) => setPriority({ highConcernPoints: num(e.target.value) })} /></Field>
          <Field label="Missing-data points" htmlFor="prio-missing"><Input id="prio-missing" type="number" min={0} max={40} value={cfg.priority.missingDataPoints} onChange={(e) => setPriority({ missingDataPoints: num(e.target.value) })} /></Field>
          <Field label="No-contact points" htmlFor="prio-contact"><Input id="prio-contact" type="number" min={0} max={20} value={cfg.priority.noContactPoints} onChange={(e) => setPriority({ noContactPoints: num(e.target.value) })} /></Field>
          {(["P1", "P2", "P3"] as const).map((p) => (
            <Field key={p} label={`${p} threshold`} htmlFor={`prio-${p}`}>
              <Input id={`prio-${p}`} type="number" min={0} max={100} value={cfg.priority.thresholds[p]} onChange={(e) => setPriority({ thresholds: { ...cfg.priority.thresholds, [p]: num(e.target.value) } })} />
            </Field>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Version details" />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <Field label="Name" htmlFor="meta-name"><Input id="meta-name" name="name" defaultValue={meta.name} required /></Field>
          <Field label="Effective date" htmlFor="meta-effective"><Input id="meta-effective" name="effectiveDate" type="date" defaultValue={meta.effectiveDate} required /></Field>
          <Field label="Source citation" htmlFor="meta-citation"><Input id="meta-citation" name="sourceCitation" defaultValue={meta.sourceCitation} required /></Field>
          <Field label="Source URL" hint="optional" htmlFor="meta-url"><Input id="meta-url" name="sourceUrl" defaultValue={meta.sourceUrl} /></Field>
          <Field label="Change summary" className="md:col-span-2" htmlFor="meta-summary"><Input id="meta-summary" name="changeSummary" defaultValue={meta.changeSummary} required /></Field>
          <div className="md:col-span-2">
            <SubmitButton size="sm">Save draft and refresh preview</SubmitButton>
            <p className="mt-1.5 text-[12px] text-muted">Saving clears any source-review attestation on this draft. Nothing changes for any case until the draft is activated.</p>
          </div>
        </CardBody>
      </Card>
    </ActionForm>
  );
}
