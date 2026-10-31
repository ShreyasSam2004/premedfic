import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission, STAFF_ROLES } from "@/domain/roles";
import { requirePermission, type ActorContext } from "@/server/auth/context";
import { ForbiddenError } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { readPortalSession, signPortalSession } from "@/server/portal/tokens";

describe("permission matrix", () => {
  it("only building officials record determinations", () => {
    expect(STAFF_ROLES.filter((r) => roleHasPermission(r, "disposition:record"))).toEqual(["official"]);
  });

  it("inspectors cannot approve outreach or import data; clerks cannot review or decide", () => {
    expect(roleHasPermission("inspector", "comms:approve")).toBe(false);
    expect(roleHasPermission("inspector", "permits:import")).toBe(false);
    expect(roleHasPermission("clerk", "review:act")).toBe(false);
    expect(roleHasPermission("clerk", "disposition:record")).toBe(false);
    expect(roleHasPermission("manager", "rules:manage")).toBe(false);
  });

  it("every permission is held by at least one role", () => {
    for (const [perm, roles] of Object.entries(PERMISSIONS)) expect(roles.length, perm).toBeGreaterThan(0);
  });

  it("requirePermission rejects homeowner and system actors for staff permissions", () => {
    const homeowner: ActorContext = { orgId: "o", actor: { type: "homeowner", grantId: "g", contactId: "c", caseId: "k", name: "H" } };
    const system: ActorContext = { orgId: "o", actor: { type: "system", name: "triage-engine" } };
    const clerk: ActorContext = { orgId: "o", actor: { type: "user", userId: "u", role: "clerk", name: "C", title: null, specialties: [] } };
    expect(() => requirePermission(homeowner, "evidence:view")).toThrow(ForbiddenError);
    expect(() => requirePermission(system, "disposition:record")).toThrow(ForbiddenError);
    expect(() => requirePermission(clerk, "disposition:record")).toThrow(ForbiddenError);
    expect(requirePermission(clerk, "permits:import").userId).toBe("u");
  });
});

describe("credentials and sessions", () => {
  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("portal sessions are HMAC-signed and expire", () => {
    const v = signPortalSession("grant-1");
    expect(readPortalSession(v)).toEqual({ grantId: "grant-1" });
    const [g, exp, sig] = v.split(".");
    expect(readPortalSession(`grant-2.${exp}.${sig}`)).toBeNull();
    expect(readPortalSession(`${g}.${Number(exp) + 1000}.${sig}`)).toBeNull();
    expect(readPortalSession(signPortalSession("grant-1", Date.now() - 3 * 60 * 60 * 1000))).toBeNull();
    expect(readPortalSession("garbage")).toBeNull();
  });
});
