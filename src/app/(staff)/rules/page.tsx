import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireStaffSession } from "@/server/auth/session";
import { listRuleSets } from "@/server/rules/service";
import { FLORIDA_STATUTE_URL } from "@/server/rules/defaults";
import { Badge, Callout, Card, CardHeader, fmtDate, PageHeader, Table, Td, Th } from "@/components/ui/primitives";

export const metadata = { title: "Jurisdiction Rules" };

export default async function RulesPage() {
  const s = await requireStaffSession();
  const rows = await listRuleSets(s.org.id);
  const byJ = new Map<string, typeof rows>();
  for (const r of rows) byJ.set(r.jurisdiction.id, [...(byJ.get(r.jurisdiction.id) ?? []), r]);
  return (
    <>
      <PageHeader
        title="Jurisdiction Rules"
        description="Versioned, cited rule sets that drive triage, evidence checklists, escalation, and approval authority. Changes always create a new version; historical triage results and decisions keep the version they were made under."
      />
      <Callout tone="info" className="mb-4" title="Rules inform routing. They never decide a permit's outcome.">
        Unverified, absent, or non-covering rules force human review. Every determination is made by an authorized official.
      </Callout>
      <div className="space-y-4">
        {[...byJ.values()].map((list) => {
          const j = list[0].jurisdiction;
          return (
            <Card key={j.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {j.name} {j.isReferenceExample && <Badge tone="attention">Reference example</Badge>}
                  </span>
                }
                description={`${j.departmentName}${j.state ? ` · ${j.state}` : ""}`}
              />
              {j.isReferenceExample && (
                <div className="border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
                  <p>
                    <strong>Why jurisdiction-specific review matters.</strong> Fla. Stat. § 553.79(16)(c) (2025) provides: “A local enforcement agency <em>may</em> close a building permit 6 years after the issuance of the permit, even in the absence of a final inspection, <em>if the local enforcement agency determines</em> that no apparent safety hazards exist.”
                  </p>
                  <p className="mt-1.5 text-muted">
                    The provision is permissive and conditioned on a local determination. PremedFix models it only as eligibility for an official&rsquo;s consideration — never as automatic closure. This reference rule set is intentionally left unverified.{" "}
                    <a href={FLORIDA_STATUTE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                      Statute text <ExternalLink className="size-3" />
                    </a>
                  </p>
                </div>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th>Source verification</Th>
                    <Th>Effective</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(({ ruleSet: r }) => (
                    <tr key={r.id} className="hover:bg-subtle/60">
                      <Td>
                        <Link href={`/rules/${r.id}`} className="font-mono font-medium hover:text-brand hover:underline">
                          v{r.version}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/rules/${r.id}`} className="hover:text-brand hover:underline">
                          {r.name}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={r.status === "active" ? "info" : r.status === "draft" ? "attention" : "neutral"}>{r.status}</Badge>
                      </Td>
                      <Td>{r.verificationStatus === "verified" ? <span className="text-ink-2">Attested by {r.reviewedByName} · {fmtDate(r.reviewedAt)}</span> : <Badge tone="attention">Unverified — human review forced</Badge>}</Td>
                      <Td className="tabular">{fmtDate(r.effectiveDate)}</Td>
                      <Td className="max-w-[360px] text-[12px] text-muted">{r.sourceCitation}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
