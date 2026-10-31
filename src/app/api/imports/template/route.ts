import { NextResponse } from "next/server";
import { getStaffSession } from "@/server/auth/session";
import { csvTemplate } from "@/server/imports/service";

export async function GET() {
  if (!(await getStaffSession())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return new NextResponse(csvTemplate(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="premedfix_permit_import_template.csv"' },
  });
}
