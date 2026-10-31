import { NextResponse } from "next/server";
import { getStaffSession } from "@/server/auth/session";
import { stageImport, MAX_CSV_BYTES } from "@/server/imports/service";
import { errorResponse, sameOrigin } from "@/server/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_CSV_BYTES + 64 * 1024) return NextResponse.json({ error: "File exceeds 10 MB" }, { status: 413 });
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    const batch = await stageImport(s.ctx, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), sourceSystem: String(fd.get("sourceSystem") ?? "") || null });
    return NextResponse.json({ batchId: batch.id });
  } catch (err) {
    return errorResponse(err);
  }
}
