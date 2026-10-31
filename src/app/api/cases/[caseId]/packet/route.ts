import { NextResponse } from "next/server";
import { getStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getCaseDetail } from "@/server/cases/queries";
import { buildCasePacket } from "@/server/packets/pdf";
import { recordAudit, verifyAuditChain } from "@/server/audit/audit";
import { NotFoundError } from "@/server/errors";

export async function GET(_: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!hasPermission(s.ctx, "packets:export")) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { caseId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(caseId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await getCaseDetail(s.org.id, caseId); // tenant check before anything is recorded
    await recordAudit(s.ctx, { action: "packet.exported", entityType: "case", entityId: caseId, caseId, summary: `Case packet exported by ${s.user.name}` });
    const [detail, chain] = await Promise.all([getCaseDetail(s.org.id, caseId), verifyAuditChain(s.org.id)]);
    const pdf = await buildCasePacket(detail, { generatedBy: `${s.user.name} (${s.user.role})`, generatedAt: new Date(), auditHeadHash: chain.headHash, auditChainValid: chain.valid });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="case-packet-${detail.permit.permitNumber.replace(/[^\w-]/g, "_")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
