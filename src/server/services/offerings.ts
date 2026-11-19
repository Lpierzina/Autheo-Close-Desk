import "server-only";
import { z } from "zod";
import { parseMoney, isZero } from "@/domain/money";
import { isUuid, requireOfferingAccess, type MemberRole, type Offering } from "../auth/access";
import { lockOffering, query, queryOne, withTransaction } from "../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { recordAudit } from "./audit";
import { findUserByEmail, type AppUser } from "./users";

const createSchema = z.object({
  name: z.string().trim().min(3, "Give the offering a name of at least three characters.").max(160),
  propertyName: z.string().trim().max(160).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code."),
  targetRaise: z.string().trim().optional(),
  addCreatorAsReviewer: z.boolean().default(true),
  isDemo: z.boolean().default(false),
});

export type CreateOfferingInput = z.input<typeof createSchema>;

export async function createOffering(actor: AppUser, input: CreateOfferingInput): Promise<Offering> {
  if (!actor.isAdmin) throw new ForbiddenError("Only workspace administrators can create offerings.");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid offering.");
  const { name, propertyName, currency, targetRaise, addCreatorAsReviewer, isDemo } = parsed.data;

  let target: string | null = null;
  if (targetRaise) {
    const amount = parseMoney(targetRaise, "Target raise");
    if (!amount.ok) throw new ValidationError(amount.error);
    if (isZero(amount.value)) throw new ValidationError("Target raise must be greater than zero.");
    target = amount.value;
  }

  return withTransaction(async (db) => {
    const row = await queryOne<{ id: string; created_at: Date }>(
      `INSERT INTO offerings (name, property_name, currency, target_raise, is_demo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [name, propertyName || null, currency, target, isDemo, actor.id],
      db,
    );
    if (!row) throw new Error("Offering could not be created.");
    if (addCreatorAsReviewer) {
      await query(
        "INSERT INTO offering_members (offering_id, user_id, role, added_by) VALUES ($1, $2, 'reviewer', $2)",
        [row.id, actor.id],
        db,
      );
    }
    await recordAudit(db, {
      offeringId: row.id,
      actor: { id: actor.id, email: actor.email },
      action: "offering.created",
      detail: { currency, creatorRole: addCreatorAsReviewer ? "reviewer" : null },
    });
    return {
      id: row.id,
      name,
      propertyName: propertyName || null,
      currency,
      targetRaise: target,
      isDemo,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export interface OfferingListItem extends Offering {
  role: MemberRole | null;
  filesImported: number;
  lastImportAt: string | null;
  approvedVersion: number | null;
  approvedAt: string | null;
}

/** Offerings the user may see: their memberships, or everything for a workspace administrator. */
export async function listOfferings(user: AppUser): Promise<OfferingListItem[]> {
  const rows = await query<{
    id: string;
    name: string;
    property_name: string | null;
    currency: string;
    target_raise: string | null;
    is_demo: boolean;
    created_at: Date;
    role: MemberRole | null;
    files_imported: number;
    last_import_at: Date | null;
    approved_version: number | null;
    approved_at: Date | null;
  }>(
    `SELECT o.id, o.name, o.property_name, o.currency, o.target_raise, o.is_demo, o.created_at, m.role,
            (SELECT count(DISTINCT kind)::int FROM import_batches b WHERE b.offering_id = o.id) AS files_imported,
            (SELECT max(imported_at) FROM import_batches b WHERE b.offering_id = o.id) AS last_import_at,
            s.version AS approved_version, s.approved_at
       FROM offerings o
       LEFT JOIN offering_members m ON m.offering_id = o.id AND m.user_id = $1
       LEFT JOIN LATERAL (
         SELECT version, approved_at FROM snapshots WHERE offering_id = o.id ORDER BY version DESC LIMIT 1
       ) s ON true
      WHERE $2 OR m.user_id IS NOT NULL
      ORDER BY o.created_at DESC`,
    [user.id, user.isAdmin],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    propertyName: r.property_name,
    currency: r.currency,
    targetRaise: r.target_raise,
    isDemo: r.is_demo,
    createdAt: r.created_at.toISOString(),
    role: r.role,
    filesImported: r.files_imported,
    lastImportAt: r.last_import_at?.toISOString() ?? null,
    approvedVersion: r.approved_version,
    approvedAt: r.approved_at?.toISOString() ?? null,
  }));
}

export interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  status: AppUser["status"];
  role: MemberRole;
  addedAt: string;
}

export async function listMembers(actor: AppUser, offeringId: string): Promise<Member[]> {
  await requireOfferingAccess(actor, offeringId, "view");
  const rows = await query<{
    user_id: string;
    email: string;
    display_name: string | null;
    status: AppUser["status"];
    role: MemberRole;
    created_at: Date;
  }>(
    `SELECT m.user_id, u.email, u.display_name, u.status, m.role, m.created_at
       FROM offering_members m JOIN app_users u ON u.id = m.user_id
      WHERE m.offering_id = $1 ORDER BY m.role, u.email`,
    [offeringId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    status: r.status,
    role: r.role,
    addedAt: r.created_at.toISOString(),
  }));
}

const memberSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  role: z.enum(["reviewer", "approver"]),
});

/** Adds a user to the offering or changes their role. A user holds one role per offering. */
export async function setMember(actor: AppUser, offeringId: string, input: z.input<typeof memberSchema>): Promise<void> {
  await requireOfferingAccess(actor, offeringId, "manage");
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Choose an invited user and a role.");
  await withTransaction(async (db) => {
    await lockOffering(db, offeringId);
    const user = await findUserByEmail(parsed.data.email, db);
    if (!user) throw new ValidationError("That email has not been invited to the workspace. Invite the user first.");
    if (user.status === "disabled") throw new ValidationError("That user is disabled.");
    await query(
      `INSERT INTO offering_members (offering_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (offering_id, user_id) DO UPDATE SET role = EXCLUDED.role, added_by = EXCLUDED.added_by`,
      [offeringId, user.id, parsed.data.role, actor.id],
      db,
    );
    await recordAudit(db, {
      offeringId,
      actor: { id: actor.id, email: actor.email },
      action: "member.set",
      detail: { userId: user.id, role: parsed.data.role },
    });
  });
}

export async function removeMember(actor: AppUser, offeringId: string, userId: string): Promise<void> {
  await requireOfferingAccess(actor, offeringId, "manage");
  if (!isUuid(userId)) throw new NotFoundError("Member not found.");
  await withTransaction(async (db) => {
    await lockOffering(db, offeringId);
    const removed = await query("DELETE FROM offering_members WHERE offering_id = $1 AND user_id = $2 RETURNING user_id", [offeringId, userId], db);
    if (removed.length === 0) throw new NotFoundError("Member not found.");
    await recordAudit(db, {
      offeringId,
      actor: { id: actor.id, email: actor.email },
      action: "member.removed",
      detail: { userId },
    });
  });
}
