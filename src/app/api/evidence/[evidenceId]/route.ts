import { NextResponse } from "next/server";
import { getPortalContext, getStaffSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/context";
import { getEvidenceItemForOrg } from "@/server/cases/queries";
import { storage } from "@/server/storage";
import { NotFoundError } from "@/server/errors";

/**
 * Authorized evidence download. Staff: same organization + evidence:view.
 * Homeowner: only items belonging to their own case. Every response is
 * no-store and served with the sniffed (validated) content type.
 */
export async function GET(_: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const { evidenceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(evidenceId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const staff = await getStaffSession();
    let item;
    if (staff && hasPermission(staff.ctx, "evidence:view")) {
      item = await getEvidenceItemForOrg(staff.org.id, evidenceId);
    } else {
      const portal = await getPortalContext();
      if (!portal || portal.actor.type !== "homeowner") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      item = await getEvidenceItemForOrg(portal.orgId, evidenceId);
      if (item.caseId !== portal.actor.caseId) throw new NotFoundError("Evidence item");
    }
    const bytes = await storage().get(item.storageKey);
    const safeName = item.originalFilename.replace(/[^\w.\- ]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": item.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
