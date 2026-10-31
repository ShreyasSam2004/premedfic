import { NextResponse } from "next/server";
import { getStaffSession } from "@/server/auth/session";
import { searchCases } from "@/server/cases/queries";

export async function GET(req: Request) {
  const s = await getStaffSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 80) ?? "";
  return NextResponse.json({ results: await searchCases(s.org.id, q) });
}
