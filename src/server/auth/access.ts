import "server-only";
import { queryOne } from "../db";
import { ForbiddenError, NotFoundError } from "../errors";
import type { AppUser } from "../services/users";

export type MemberRole = "reviewer" | "approver";
export type Permission = "view" | "review" | "approve" | "manage";

export interface Offering {
  id: string;
  name: string;
  propertyName: string | null;
  currency: string;
  targetRaise: string | null;
  isDemo: boolean;
  createdAt: string;
}

export interface OfferingAccess {
  offering: Offering;
  role: MemberRole | null;
  can: Record<Permission, boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

interface AccessRow {
  id: string;
  name: string;
  property_name: string | null;
  currency: string;
  target_raise: string | null;
  is_demo: boolean;
  created_at: Date;
  role: MemberRole | null;
}

/**
 * The single place that decides who may touch an offering.
 *   view     members of the offering and workspace administrators
 *   review   members with the reviewer role: imports and reviewer decisions
 *   approve  members with the approver role: approve and freeze a close
 *   manage   workspace administrators: membership
 * A user with no access gets "not found", so the offering's existence is not disclosed.
 */
export async function getOfferingAccess(user: AppUser, offeringId: string): Promise<OfferingAccess> {
  if (!isUuid(offeringId)) throw new NotFoundError("Offering not found.");
  const row = await queryOne<AccessRow>(
    `SELECT o.id, o.name, o.property_name, o.currency, o.target_raise, o.is_demo, o.created_at, m.role
       FROM offerings o
       LEFT JOIN offering_members m ON m.offering_id = o.id AND m.user_id = $2
      WHERE o.id = $1`,
    [offeringId, user.id],
  );
  if (!row || (!row.role && !user.isAdmin)) throw new NotFoundError("Offering not found.");
  return {
    offering: {
      id: row.id,
      name: row.name,
      propertyName: row.property_name,
      currency: row.currency,
      targetRaise: row.target_raise,
      isDemo: row.is_demo,
      createdAt: row.created_at.toISOString(),
    },
    role: row.role,
    can: {
      view: true,
      review: row.role === "reviewer",
      approve: row.role === "approver",
      manage: user.isAdmin,
    },
  };
}

const DENIED: Record<Permission, string> = {
  view: "You do not have access to this offering.",
  review: "Only reviewers on this offering can import files or record decisions.",
  approve: "Only approvers on this offering can approve a close.",
  manage: "Only workspace administrators can manage access.",
};

export async function requireOfferingAccess(user: AppUser, offeringId: string, permission: Permission): Promise<OfferingAccess> {
  const access = await getOfferingAccess(user, offeringId);
  if (!access.can[permission]) throw new ForbiddenError(DENIED[permission]);
  return access;
}
