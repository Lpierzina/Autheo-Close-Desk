import "server-only";
import { query, type Db } from "../db";

export interface AuditActor {
  id: string | null;
  email: string | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  actorEmail: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * Appends to the audit trail. `detail` holds identifiers, counts and hashes only;
 * investor records are never written here or to the process log.
 */
export async function recordAudit(
  db: Db | undefined,
  event: { offeringId: string | null; actor: AuditActor; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await query(
    `INSERT INTO audit_events (offering_id, actor_id, actor_email, action, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [event.offeringId, event.actor.id, event.actor.email, event.action, JSON.stringify(event.detail ?? {})],
    db,
  );
}

export async function listAudit(offeringId: string, limit = 200): Promise<AuditEvent[]> {
  const rows = await query<{ id: string; action: string; actor_email: string | null; detail: Record<string, unknown>; created_at: Date }>(
    `SELECT id, action, actor_email, detail, created_at
       FROM audit_events WHERE offering_id = $1 ORDER BY id DESC LIMIT $2`,
    [offeringId, limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    action: r.action,
    actorEmail: r.actor_email,
    detail: r.detail,
    createdAt: r.created_at.toISOString(),
  }));
}
