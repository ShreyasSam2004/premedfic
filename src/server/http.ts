import { NextResponse } from "next/server";
import { DomainError } from "./errors";
import { log } from "./util";

/** Reject cross-site state-changing requests (defense in depth with SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof DomainError) return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  log.error("http.unhandled", err);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
