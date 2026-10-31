import { NextResponse } from "next/server";
import { getPortalContext } from "@/server/auth/session";
import { ingestEvidence } from "@/server/evidence/pipeline";
import { errorResponse, sameOrigin } from "@/server/http";
import { MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES } from "@/domain/evidence";

const DECLARED = new Set(["invoice", "contract", "photo", "inspection_report", "completion_record", "permit_document", "correspondence", "authorization_letter"]);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const ctx = await getPortalContext();
  if (!ctx || ctx.actor.type !== "homeowner") return NextResponse.json({ error: "Your session has ended. Please use the link in your notice again." }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES * MAX_FILES_PER_UPLOAD + 1024 * 1024) return NextResponse.json({ error: "Upload is too large" }, { status: 413 });
  try {
    const fd = await req.formData();
    const declared = String(fd.get("declaredType") ?? "");
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const result = await ingestEvidence(
      ctx,
      ctx.actor.caseId,
      await Promise.all(files.map(async (f) => ({ filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()), declaredType: DECLARED.has(declared) ? declared : null }))),
    );
    return NextResponse.json({ accepted: result.accepted.map((a) => ({ id: a.id, filename: a.originalFilename, status: a.processingStatus })), rejected: result.rejected });
  } catch (err) {
    return errorResponse(err);
  }
}
