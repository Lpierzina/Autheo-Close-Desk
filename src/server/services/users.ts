import "server-only";
import { z } from "zod";
import { appBaseUrl, getAuthConfig } from "../auth/config";
import { query, queryOne, withTransaction, type Db } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { recordAudit } from "./audit";

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  status: "invited" | "active" | "disabled";
  createdAt: string;
  activatedAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  status: AppUser["status"];
  created_at: Date;
  activated_at: Date | null;
}

const COLUMNS = "id, email, display_name, is_admin, status, created_at, activated_at";

function toUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    activatedAt: row.activated_at?.toISOString() ?? null,
  };
}

export async function findUserBySubject(subject: string): Promise<AppUser | null> {
  const row = await queryOne<UserRow>(`SELECT ${COLUMNS} FROM app_users WHERE auth_subject = $1`, [subject]);
  return row ? toUser(row) : null;
}

export async function findUserByEmail(email: string, db?: Db): Promise<AppUser | null> {
  const row = await queryOne<UserRow>(`SELECT ${COLUMNS} FROM app_users WHERE email = $1`, [email.trim().toLowerCase()], db);
  return row ? toUser(row) : null;
}

export async function findUserById(id: string, db?: Db): Promise<AppUser | null> {
  const row = await queryOne<UserRow>(`SELECT ${COLUMNS} FROM app_users WHERE id = $1`, [id], db);
  return row ? toUser(row) : null;
}

/**
 * First sign-in of an invited user: binds the provider subject to the invitation whose
 * email the provider has verified. Returns null when no open invitation matches.
 */
export async function bindInvitedUser(subject: string, verifiedEmails: string[], displayName: string | null): Promise<AppUser | null> {
  const emails = verifiedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) return null;
  return withTransaction(async (db) => {
    const row = await queryOne<UserRow>(
      `UPDATE app_users
          SET auth_subject = $1, status = 'active', activated_at = now(),
              display_name = COALESCE(display_name, $3)
        WHERE id = (
          SELECT id FROM app_users
           WHERE email = ANY($2::text[]) AND auth_subject IS NULL AND status = 'invited'
           ORDER BY created_at LIMIT 1 FOR UPDATE)
        RETURNING ${COLUMNS}`,
      [subject, emails, displayName],
      db,
    );
    if (!row) return null;
    await recordAudit(db, { offeringId: null, actor: { id: row.id, email: row.email }, action: "user.activated" });
    return toUser(row);
  });
}

export async function listUsers(): Promise<AppUser[]> {
  const rows = await query<UserRow>(`SELECT ${COLUMNS} FROM app_users ORDER BY created_at`);
  return rows.map(toUser);
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254)),
  displayName: z.string().trim().max(120).optional(),
  isAdmin: z.boolean().default(false),
});

export type InviteInput = z.input<typeof inviteSchema>;

export interface InviteResult {
  user: AppUser;
  created: boolean;
  invitation: { sent: boolean; message: string };
}

/**
 * Asks the identity provider to email an invitation. The app-side user record is what
 * grants access; the provider invitation only lets the person create their login.
 */
export async function sendProviderInvitation(email: string): Promise<{ sent: boolean; message: string }> {
  const config = getAuthConfig();
  if (config.mode !== "clerk" || !config.secretKey) {
    return { sent: false, message: "No invitation email was sent: Clerk is not configured in this environment." };
  }
  const base = appBaseUrl();
  if (!base) {
    return { sent: false, message: "No invitation email was sent: APP_BASE_URL is not set." };
  }
  try {
    const { createClerkClient } = await import("@clerk/nextjs/server");
    const clerk = createClerkClient({ secretKey: config.secretKey });
    await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${base}/accept-invitation`,
      notify: true,
      ignoreExisting: true,
    });
    return { sent: true, message: "Invitation email sent." };
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.error(`[auth] Clerk invitation request failed${status ? ` (status ${status})` : ""}`);
    return {
      sent: false,
      message:
        "The user was added, but Clerk did not send the invitation email. Check the Clerk dashboard and send the invitation again.",
    };
  }
}

/** Creates the user record that grants access. Pass `actor: null` only from the operator CLI. */
export async function inviteUser(actor: AppUser | null, input: InviteInput): Promise<InviteResult> {
  if (actor && !actor.isAdmin) throw new ForbiddenError("Only workspace administrators can invite users.");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid invitation.");
  const { email, displayName, isAdmin } = parsed.data;

  const { user, created } = await withTransaction(async (db) => {
    const existing = await findUserByEmail(email, db);
    if (existing) return { user: existing, created: false };
    const row = await queryOne<UserRow>(
      `INSERT INTO app_users (email, display_name, is_admin, invited_by)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [email, displayName || null, isAdmin, actor?.id ?? null],
      db,
    );
    if (!row) throw new Error("User could not be created.");
    await recordAudit(db, {
      offeringId: null,
      actor: { id: actor?.id ?? null, email: actor?.email ?? "operator-cli" },
      action: "user.invited",
      detail: { userId: row.id, isAdmin },
    });
    return { user: toUser(row), created: true };
  });

  if (user.status === "disabled") throw new ConflictError("This user is disabled. Re-enable the user instead of inviting again.");
  const invitation =
    user.status === "active"
      ? { sent: false, message: "This user already has access." }
      : await sendProviderInvitation(user.email);
  return { user, created, invitation };
}

export async function setUserDisabled(actor: AppUser, userId: string, disabled: boolean): Promise<AppUser> {
  if (!actor.isAdmin) throw new ForbiddenError("Only workspace administrators can change user access.");
  if (actor.id === userId) throw new ValidationError("You cannot change your own access.");
  return withTransaction(async (db) => {
    const row = await queryOne<UserRow>(
      `UPDATE app_users
          SET status = CASE WHEN $2 THEN 'disabled' WHEN auth_subject IS NULL THEN 'invited' ELSE 'active' END
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [userId, disabled],
      db,
    );
    if (!row) throw new NotFoundError("User not found.");
    await recordAudit(db, {
      offeringId: null,
      actor: { id: actor.id, email: actor.email },
      action: disabled ? "user.disabled" : "user.enabled",
      detail: { userId },
    });
    return toUser(row);
  });
}
