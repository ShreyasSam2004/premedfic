/**
 * Role-based permission matrix. The server is the only enforcement point;
 * the client uses this solely to hide controls a user cannot use.
 */

export const STAFF_ROLES = ["admin", "clerk", "inspector", "official", "manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Municipal administrator",
  clerk: "Permit clerk",
  inspector: "Building inspector",
  official: "Building official",
  manager: "Department manager",
};

export const PERMISSIONS = {
  "permits:view": ["admin", "clerk", "inspector", "official", "manager"],
  "permits:import": ["admin", "clerk"],
  "cases:assign": ["admin", "clerk", "manager"],
  "cases:triage": ["admin", "clerk"],
  "cases:reconcile": ["admin", "clerk"],
  "contacts:manage": ["admin", "clerk"],
  "contacts:verify": ["admin", "clerk"],
  "comms:draft": ["admin", "clerk"],
  "comms:approve": ["admin", "clerk", "manager"],
  "evidence:view": ["admin", "clerk", "inspector", "official", "manager"],
  "evidence:upload": ["admin", "clerk", "inspector"],
  "review:act": ["inspector", "official"],
  "review:specialist": ["inspector", "official"],
  "inspections:record": ["inspector"],
  "disposition:record": ["official"],
  "disposition:confirm": ["admin", "official"],
  "cases:reopen": ["admin", "official"],
  "rules:view": ["admin", "clerk", "inspector", "official", "manager"],
  "rules:manage": ["admin"],
  "analytics:view": ["admin", "clerk", "inspector", "official", "manager"],
  "audit:view": ["admin", "official", "manager"],
  "settings:manage": ["admin"],
  "packets:export": ["admin", "clerk", "inspector", "official", "manager"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: StaffRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}
