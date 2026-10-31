import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getRuleSet } from "@/server/rules/service";
import { getRuleSetApplication, previewRuleSetImpact } from "@/server/rules/impact-service";
import { parseRuleSetConfig, type RuleSetConfig } from "@/server/rules/config";
import { NotFoundError } from "@/server/errors";
import { CATEGORY_LABELS, PERMIT_CATEGORIES } from "@/domain/permits";
import { ROLE_LABELS } from "@/domain/roles";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Badge, Callout, Card, CardBody, CardHeader, DL, Field, fmtDate, Input, PageHeader, Table, Tag, Td, Textarea, Th } from "@/components/ui/primitives";
import { activateRuleSetAction, createRuleVersionAction, startRuleDraftAction, verifyRuleSetAction } from "@/app/(staff)/actions";
import { ImpactPreview } from "./impact-preview";
import { RuleEditor } from "./rule-editor";

export const metadata = { title: "Rule set" };

export default async function RuleSetPage({ params }: { params: Promise<{ ruleSetId: string }> }) {
  const s = await requireStaffSession();
  const { ruleSetId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(ruleSetId)) notFound();
  let row;
  try {
    row = await getRuleSet(s.org.id, ruleSetId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { ruleSet: r, jurisdiction: j } = row;
  const parsed = parseRuleSetConfig(r.config);
  const cfg = parsed.ok ? parsed.config : (r.config as RuleSetConfig);
  const canManage = hasPermission(s.ctx, "rules:manage");
  const isDraft = r.status === "draft";
  const preview = isDraft && parsed.ok ? await previewRuleSetImpact(s.ctx, r.id) : null;
  const applied = isDraft ? null : await getRuleSetApplication(s.org.id, r.id);
  const canRetriage = hasPermission(s.ctx, "cases:triage");
  return (
    <>
      <PageHeader
        eyebrow={
          <span>
            <Link href="/rules" className="hover:text-ink">Jurisdiction Rules</Link> / {j.name}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.name} <span className="font-mono text-muted">v{r.version}</span>
            <Badge tone={r.status === "active" ? "info" : r.status === "draft" ? "attention" : "neutral"}>{r.status}</Badge>
            {r.verificationStatus === "verified" ? <Badge tone="review">Source verified</Badge> : <Badge tone="attention">Unverified</Badge>}
          </span>
        }
        description={r.changeSummary ?? undefined}
      />
      {!parsed.ok && (
        <Callout tone="critical" className="mb-4" title="Stored configuration fails validation">
          The triage engine treats this rule set as absent and forces human review. {parsed.errors.join("; ")}
        </Callout>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {preview && <ImpactPreview p={preview} />}
          {isDraft && canManage && parsed.ok ? (
            <RuleEditor
              ruleSetId={r.id}
              meta={{ name: r.name, effectiveDate: r.effectiveDate, sourceCitation: r.sourceCitation, sourceUrl: r.sourceUrl ?? "", changeSummary: r.changeSummary ?? "" }}
              config={cfg}
            />
          ) : (
            <>
              <Card>
                <CardHeader title="Categories" description="Per-category routing, evidence requirements, and approval authority. Categories without a rule route to staff review." />
                <Table>
                  <thead>
                    <tr>
                      <Th>Category</Th>
                      <Th>Concern</Th>
                      <Th>Pathway</Th>
                      <Th>Site inspection</Th>
                      <Th>Approval authority</Th>
                      <Th>Required evidence</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMIT_CATEGORIES.map((c) => {
                      const rule = cfg.categories?.[c];
                      return (
                        <tr key={c} className="align-top">
                          <Td className="font-medium whitespace-nowrap">{CATEGORY_LABELS[c]}</Td>
                          {rule ? (
                            <>
                              <Td>
                                <Badge tone={rule.concernLevel === "high" ? "critical" : "neutral"}>{rule.concernLevel}</Badge>
                              </Td>
                              <Td className="text-[12px]">
                                {rule.pathway.replace(/_/g, " ")}
                                {rule.specialistDiscipline ? ` (${rule.specialistDiscipline})` : ""}
                              </Td>
                              <Td>{rule.siteInspectionRequired ? "Required" : "Not by rule"}</Td>
                              <Td className="text-[12px]">{rule.approvalAuthority.map((a) => ROLE_LABELS[a]).join(", ")}</Td>
                              <Td className="text-[12px]">
                                {rule.requiredEvidence.map((e) => (
                                  <div key={e.code}>
                                    {e.label}
                                    {e.minCount > 1 ? ` (×${e.minCount})` : ""}
                                    {!e.required ? <span className="text-muted"> — optional</span> : ""}
                                  </div>
                                ))}
                              </Td>
                            </>
                          ) : (
                            <Td colSpan={5} className="text-[12px] text-muted">
                              No rule — routes to staff review
                            </Td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>
              <Card>
                <CardHeader title="Escalation and provisions" />
                <CardBody className="space-y-3 text-[12.5px]">
                  <div>
                    <div className="mb-1 font-medium">Work-description escalations (can only escalate, never clear)</div>
                    {cfg.descriptionEscalations.map((e) => (
                      <div key={e.id} className="mb-1">
                        <Tag>{e.id}</Tag> {e.message} → <strong>{e.discipline}</strong> specialist
                        <div className="font-mono text-[10.5px] break-all text-muted">/{e.pattern}/i</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 font-medium">Aged-permit provision</div>
                    {cfg.agedPermitProvision?.enabled ? (
                      <div className="space-y-1">
                        <div>
                          {cfg.agedPermitProvision.citation} · threshold {cfg.agedPermitProvision.minYearsSinceIssuance} years since issuance
                        </div>
                        <div className="text-muted">{cfg.agedPermitProvision.determinationRequired}</div>
                      </div>
                    ) : (
                      <div className="text-muted">None defined.</div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 font-medium">Review priority (administrative urgency only)</div>
                    <div className="text-muted">
                      {cfg.priority.pointsPerYearExpired} pts / year expired (max {cfg.priority.maxAgePoints}) · high concern +{cfg.priority.highConcernPoints} · missing data +{cfg.priority.missingDataPoints} · no contact +{cfg.priority.noContactPoints} · thresholds P1 ≥ {cfg.priority.thresholds.P1}, P2 ≥ {cfg.priority.thresholds.P2}, P3 ≥ {cfg.priority.thresholds.P3}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </>
          )}
          <Card>
            <details>
              <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-semibold text-ink">Configuration (JSON)</summary>
              <p className="px-4 text-[12.5px] text-muted">Exactly what the engine reads for this version.</p>
              <pre className="max-h-[420px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(r.config, null, 2)}</pre>
            </details>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Provenance" />
            <CardBody>
              <DL
                items={[
                  ["Jurisdiction", j.name],
                  ["Effective", fmtDate(r.effectiveDate)],
                  ["Source", r.sourceCitation],
                  ["Source URL", r.sourceUrl ? <a key="u" href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{r.sourceUrl}</a> : null],
                  ["Verification", r.verificationStatus === "verified" ? `Attested by ${r.reviewedByName}, ${fmtDate(r.reviewedAt)}` : "Not verified"],
                  ["Created", fmtDate(r.createdAt, { time: true })],
                  ["Activated", r.activatedAt ? fmtDate(r.activatedAt, { time: true }) : null],
                  ["Applied", applied ? `Triage re-run on the ${applied.retriaged} open case(s) this version changed` : null],
                  ["Superseded", r.supersededAt ? fmtDate(r.supersededAt, { time: true }) : null],
                ]}
              />
            </CardBody>
          </Card>
          {canManage && r.status !== "superseded" && r.verificationStatus !== "verified" && (
            <Card>
              <CardHeader title="Attest source review" description="Confirms a municipal administrator reviewed this configuration against its cited source. It does not make the rule legally authoritative." />
              <CardBody>
                <ActionForm action={verifyRuleSetAction} className="space-y-2">
                  <input type="hidden" name="ruleSetId" value={r.id} />
                  <Input name="reviewedByName" placeholder="Reviewer name and title" required aria-label="Reviewer" />
                  <Textarea name="note" rows={2} placeholder="What was reviewed (e.g. ordinance section, legal memo)" required aria-label="Review note" />
                  <SubmitButton size="sm" variant="secondary">
                    Record attestation
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canManage && isDraft && (
            <Card>
              <CardHeader
                title="Activate this version"
                description={`The current active version becomes superseded.${r.verificationStatus === "verified" ? "" : " This draft is unverified, so every case triaged under it will require human review."}`}
              />
              <CardBody>
                <ActionForm action={activateRuleSetAction} className="space-y-2.5">
                  <input type="hidden" name="ruleSetId" value={r.id} />
                  {canRetriage && preview && preview.changed > 0 && (
                    <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
                      <input type="checkbox" name="retriage" defaultChecked className="mt-0.5" />
                      <span>
                        Re-run triage on the {preview.changed} case(s) this changes. Other cases keep their existing results.
                      </span>
                    </label>
                  )}
                  <SubmitButton size="sm">Activate v{r.version}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canManage && !isDraft && (
            <Card>
              <CardHeader title="Start a new draft" description="Copies this version into an editable draft. Nothing changes for any case until the draft is activated." />
              <CardBody className="space-y-3">
                <ActionForm action={startRuleDraftAction} className="space-y-2.5">
                  <input type="hidden" name="ruleSetId" value={r.id} />
                  <Field label="What will this draft change?" htmlFor="draft-summary">
                    <Input id="draft-summary" name="changeSummary" placeholder="e.g. Add document-based review for HVAC replacements" required />
                  </Field>
                  <SubmitButton size="sm">Create draft and edit</SubmitButton>
                </ActionForm>
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer text-muted">Advanced: create a version from pasted configuration</summary>
                  <ActionForm action={createRuleVersionAction} className="mt-2.5 space-y-2.5">
                    <input type="hidden" name="jurisdictionId" value={j.id} />
                    <Field label="Name" htmlFor="adv-name">
                      <Input id="adv-name" name="name" defaultValue={r.name} required />
                    </Field>
                    <Field label="Effective date" htmlFor="adv-effective">
                      <Input id="adv-effective" name="effectiveDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
                    </Field>
                    <Field label="Source citation" htmlFor="adv-citation">
                      <Input id="adv-citation" name="sourceCitation" defaultValue={r.sourceCitation} required />
                    </Field>
                    <Field label="Source URL" hint="optional" htmlFor="adv-url">
                      <Input id="adv-url" name="sourceUrl" defaultValue={r.sourceUrl ?? ""} />
                    </Field>
                    <Field label="Change summary" htmlFor="adv-summary">
                      <Input id="adv-summary" name="changeSummary" placeholder="What changed and why" required />
                    </Field>
                    <Field label="Configuration (JSON)" hint="validated against the schema" htmlFor="adv-config">
                      <Textarea id="adv-config" name="config" rows={12} defaultValue={JSON.stringify(r.config, null, 2)} className="font-mono text-[11px]" required />
                    </Field>
                    <SubmitButton size="sm" variant="secondary">
                      Save draft version
                    </SubmitButton>
                  </ActionForm>
                </details>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
