/**
 * Actor context passed explicitly into every service call.
 * Services derive tenant scope (`orgId`) and authority (`actor`) only from here,
 * never from request parameters.
 */
import { roleHasPermission, type Permission, type StaffRole } from "@/domain/roles";
import type { ActorKind } from "@/domain/workflow";
import { ForbiddenError } from "../errors";

export type Actor =
  | { type: "user"; userId: string; role: StaffRole; name: string; title: string | null; specialties: string[] }
  | { type: "homeowner"; grantId: string; contactId: string; caseId: string; name: string }
  | { type: "system"; name: string };

export interface ActorContext {
  orgId: string;
  actor: Actor;
}

export type UserActor = Extract<Actor, { type: "user" }>;

export function requirePermission(ctx: ActorContext, permission: Permission): UserActor {
  if (ctx.actor.type !== "user" || !roleHasPermission(ctx.actor.role, permission)) {
    throw new ForbiddenError();
  }
  return ctx.actor;
}

export function hasPermission(ctx: ActorContext, permission: Permission): boolean {
  return ctx.actor.type === "user" && roleHasPermission(ctx.actor.role, permission);
}

export function actorKind(actor: Actor): ActorKind {
  if (actor.type === "user") return actor.role;
  return actor.type;
}

export function actorIdentity(actor: Actor) {
  switch (actor.type) {
    case "user":
      return { actorType: "user" as const, actorId: actor.userId, actorName: actor.name, actorRole: actor.role };
    case "homeowner":
      return { actorType: "homeowner" as const, actorId: actor.grantId, actorName: actor.name, actorRole: "homeowner" };
    case "system":
      return { actorType: "system" as const, actorId: actor.name, actorName: actor.name, actorRole: "system" };
  }
}

export function systemContext(orgId: string, name: string): ActorContext {
  return { orgId, actor: { type: "system", name } };
}
