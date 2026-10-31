import Link from "next/link";
import { CATEGORY_LABELS, type PermitCategory } from "@/domain/permits";
import { CLASSIFICATION_META, TRIAGE_CLASSIFICATIONS } from "@/domain/triage";
import type { previewRuleSetImpact } from "@/server/rules/impact-service";
import { Badge, Callout, Card, CardBody, CardHeader, SectionLabel, Table, Td, Th } from "@/components/ui/primitives";

type Preview = Awaited<ReturnType<typeof previewRuleSetImpact>>;

const n = (v: number) => v.toLocaleString("en-US");
const cls = (c: keyof typeof CLASSIFICATION_META) => CLASSIFICATION_META[c].label;
const cat = (c: string | null) => (c ? (CATEGORY_LABELS[c as PermitCategory] ?? c) : "Missing");
const SAMPLE = 25;

export function ImpactPreview({ p }: { p: Preview }) {
  const less = p.lessCautious;
  const tiles: [string, number, string][] = [
    ["Cases that change routing", p.changed, `of ${n(p.evaluated)} open cases`],
    ["Move to owner document review", less.toDocumentReview, "from staff or specialist review"],
    ["Less cautious", less.total, "fewer human checks than today"],
    ["More cautious", p.moreCautious, "more human checks than today"],
  ];
  return (
    <Card>
      <CardHeader
        title="Impact preview"
        description={`If this draft were active today: the triage engine re-evaluates every open case in ${p.jurisdiction.name} under ${p.baseline ? `the active version (v${p.baseline.version})` : "no active rule set"} and under this draft. Nothing is changed.`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(([label, value, hint]) => (
            <div key={label} className="rounded-lg border border-line px-3 py-2.5">
              <div className="text-[12px] font-medium text-muted">{label}</div>
              <div className={`tabular mt-1 text-[22px] font-semibold tracking-[-0.02em] ${label === "Less cautious" && value > 0 ? "text-tone-attention-fg" : ""}`}>{n(value)}</div>
              <div className="text-[11.5px] text-muted">{hint}</div>
            </div>
          ))}
        </div>

        {less.total > 0 && (
          <Callout tone="attention" title={`${n(less.total)} case(s) would get a less cautious pathway`}>
            {[
              less.toDocumentReview && `${n(less.toDocumentReview)} move to owner document review`,
              less.siteInspectionDropped && `${n(less.siteInspectionDropped)} no longer require a site inspection by rule`,
              less.specialistDropped && `${n(less.specialistDropped)} no longer require a specialist`,
              less.humanReviewDropped && `${n(less.humanReviewDropped)} no longer require human review before outreach`,
            ]
              .filter(Boolean)
              .join("; ")}
            . They are listed first below. Every case still needs an authorized official’s determination.
          </Callout>
        )}
        {p.changed === 0 && (
          <Callout tone="neutral">
            No open case changes routing under this draft.{p.priorityOnly ? ` ${n(p.priorityOnly)} case(s) change review priority only.` : ""}
          </Callout>
        )}

        <div>
          <SectionLabel>What this draft changes</SectionLabel>
          {p.configDiff.length ? (
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
              {p.configDiff.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">No differences from the active version yet.</p>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <SectionLabel>Routing of open cases</SectionLabel>
            <Table>
              <thead>
                <tr>
                  <Th>Pathway</Th>
                  <Th className="text-right">Today</Th>
                  <Th className="text-right">With draft</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {TRIAGE_CLASSIFICATIONS.filter((c) => p.classification[c].before || p.classification[c].after).map((c) => {
                  const d = p.classification[c].after - p.classification[c].before;
                  return (
                    <tr key={c}>
                      <Td>{cls(c)}</Td>
                      <Td className="tabular text-right">{n(p.classification[c].before)}</Td>
                      <Td className="tabular text-right">{n(p.classification[c].after)}</Td>
                      <Td className={`tabular text-right ${d ? "font-medium text-ink" : "text-muted"}`}>{d > 0 ? `+${n(d)}` : d < 0 ? `−${n(-d)}` : "0"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <div>
            <SectionLabel>Moves</SectionLabel>
            {p.transitions.length ? (
              <ul className="space-y-1.5 text-[12.5px]">
                {p.transitions.map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex items-center justify-between gap-3 rounded-md border border-line px-2.5 py-1.5">
                    <span className="text-ink-2">
                      {cls(t.from)} → <span className="font-medium text-ink">{cls(t.to)}</span>
                    </span>
                    <span className="tabular font-medium">{n(t.count)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">No pathway changes.</p>
            )}
            {p.byCategory.length > 0 && (
              <p className="mt-2 text-[12px] text-muted">By category: {p.byCategory.map((b) => `${cat(b.category)} ${n(b.changed)}`).join(" · ")}</p>
            )}
          </div>
        </div>

        {p.changes.length > 0 && (
          <div>
            <SectionLabel>{p.changes.length > SAMPLE ? `First ${SAMPLE} of ${n(p.changes.length)} changed cases` : "Changed cases"}</SectionLabel>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Permit</Th>
                    <Th>Category</Th>
                    <Th>Today</Th>
                    <Th>With draft</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.changes.slice(0, SAMPLE).map((c) => (
                    <tr key={c.key}>
                      <Td className="font-medium whitespace-nowrap">{c.caseId ? <Link href={`/cases/${c.caseId}`} className="text-brand hover:underline">{c.permitNumber}</Link> : c.permitNumber}</Td>
                      <Td>{cat(c.category)}</Td>
                      <Td className="whitespace-nowrap">{cls(c.before.classification)}</Td>
                      <Td className="whitespace-nowrap">{cls(c.after.classification)}</Td>
                      <Td className="text-[12px]">
                        <span className="flex flex-wrap gap-1.5">
                          {c.lessCautious && <Badge tone="attention">Less cautious</Badge>}
                          {c.moreCautious && <Badge tone="review">More cautious</Badge>}
                          {c.before.siteInspectionRequired && !c.after.siteInspectionRequired && <span className="text-muted">site inspection dropped</span>}
                          {!c.before.siteInspectionRequired && c.after.siteInspectionRequired && <span className="text-muted">site inspection added</span>}
                          {c.before.priority !== c.after.priority && <span className="text-muted">{c.before.priority} → {c.after.priority}</span>}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
        <p className="text-[11.5px] text-muted">Both versions are evaluated as source-verified so the preview shows what the rule content changes. An unverified version also sends every case to human review.</p>
      </CardBody>
    </Card>
  );
}
