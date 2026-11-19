import "server-only";
import { z } from "zod";
import type { ReconException, ReconRow } from "@/domain/reconcile";
import { idKey, type DecisionAction } from "@/domain/types";
import { requireOfferingAccess } from "../auth/access";
import { lockOffering, query, queryOne, withTransaction, type Db } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recordAudit } from "./audit";
import { loadWorkingState } from "./reconciliation";
import type { AppUser } from "./users";

const decisionSchema = z.object({
  action: z.enum(["acknowledge", "link", "exclude", "accept_incoming", "keep_existing", "revoke"]),
  rowKey: z.string().min(1).max(400),
  exceptionId: z.string().max(600).optional(),
  transactionKey: z.string().max(200).optional(),
  subscriptionId: z.string().trim().max(64).optional(),
  decisionId: z.uuid().optional(),
  /** Fingerprint of the exception as the reviewer saw it. */
  fingerprint: z.string().max(128).optional(),
  note: z
    .string()
    .trim()
    .min(10, "Write a note of at least 10 characters explaining the decision.")
    .max(2000, "Keep the note under 2,000 characters."),
});

export type DecisionInput = z.input<typeof decisionSchema>;

interface NewDecision {
  subjectKind: "row" | "funding" | "conflict";
  subjectKey: string;
  exceptionCode: string | null;
  action: DecisionAction;
  fingerprint: string | null;
  payload: Record<string, unknown>;
}

async function setRecordState(db: Db, recordId: string, from: string, to: string, actorId: string): Promise<void> {
  const updated = await query(
    `UPDATE source_records SET state = $3, state_changed_at = now(), state_changed_by = $4
      WHERE id = $1 AND state = $2 RETURNING id`,
    [recordId, from, to, actorId],
    db,
  );
  if (updated.length !== 1) {
    throw new ConflictError("The record changed while you were reviewing it. Reload and try again.");
  }
}

function findOpenException(row: ReconRow, exceptionId: string | undefined): ReconException {
  const exception = row.exceptions.find((e) => e.id === exceptionId);
  if (!exception) throw new NotFoundError("That exception no longer exists. Reload the row.");
  if (exception.state !== "open") throw new ConflictError("That exception has already been dealt with.");
  return exception;
}

/**
 * Records a reviewer decision. Decisions are stored apart from source records and can
 * only do four things: document a reviewable exception, link or exclude a funding
 * transaction, choose between two imported versions of a record, or revoke an earlier
 * decision. None of them can clear a blocker; only corrected source data does that.
 */
export async function recordDecision(actor: AppUser, offeringId: string, input: DecisionInput): Promise<{ decisionId: string }> {
  const access = await requireOfferingAccess(actor, offeringId, "review");
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const data = parsed.data;

  return withTransaction(async (db) => {
    await lockOffering(db, offeringId);
    const state = await loadWorkingState(access.offering, db);
    const row = state.result.rows.find((r) => r.key === data.rowKey);
    if (!row) throw new NotFoundError("That row no longer exists. Reload the reconciliation.");

    let decision: NewDecision;

    if (data.action === "acknowledge") {
      const exception = findOpenException(row, data.exceptionId);
      if (exception.resolution !== "document") {
        throw new ValidationError(
          exception.severity === "blocker"
            ? "A note cannot clear this blocker. Import corrected source data."
            : "This exception needs a different action than a note.",
        );
      }
      if (data.fingerprint && data.fingerprint !== exception.fingerprint) {
        throw new ConflictError("The figures behind this exception changed. Review it again before recording a decision.");
      }
      decision = {
        subjectKind: exception.subjectKind,
        subjectKey: exception.subjectKey,
        exceptionCode: exception.code,
        action: "acknowledge",
        fingerprint: exception.fingerprint,
        payload: { rowKey: row.key },
      };
    } else if (data.action === "link" || data.action === "exclude") {
      const line = row.funding.find((l) => l.record.key === data.transactionKey);
      if (!line) throw new NotFoundError("That transaction is not on this row. Reload the row.");
      if (line.isReversal) {
        throw new ValidationError("Reversals cannot be linked or excluded. Import funding with a corrected reference.");
      }
      if (line.treatment === "excluded") throw new ConflictError("That transaction is already excluded.");
      const open = row.exceptions.find(
        (e) => e.subjectKind === "funding" && e.subjectKey === line.record.key && e.state === "open" && e.resolution === "link_or_exclude",
      );
      if (data.action === "link") {
        if (!open) throw new ValidationError("Only unmatched or ambiguous funding can be linked to a subscription.");
        const target = idKey(data.subscriptionId ?? "");
        const exists = state.result.rows.some((r) => r.kind === "subscription" && idKey(r.subscriptionId ?? "") === target);
        if (!target || !exists) throw new ValidationError("Choose a subscription ID from the subscriptions file.");
        decision = {
          subjectKind: "funding",
          subjectKey: line.record.key,
          exceptionCode: open.code,
          action: "link",
          fingerprint: line.record.contentHash,
          payload: { rowKey: row.key, subscriptionKey: target },
        };
      } else {
        decision = {
          subjectKind: "funding",
          subjectKey: line.record.key,
          exceptionCode: open?.code ?? "EXCLUDED_FUNDING",
          action: "exclude",
          fingerprint: line.record.contentHash,
          payload: { rowKey: row.key },
        };
      }
    } else if (data.action === "accept_incoming" || data.action === "keep_existing") {
      const exception = findOpenException(row, data.exceptionId);
      const conflict = row.conflicts.find((c) => c.incoming.id === exception.subjectKey);
      if (exception.code !== "SOURCE_CONFLICT" || !conflict) throw new ValidationError("That exception is not a source conflict.");
      if (data.action === "accept_incoming") {
        if (conflict.existing) await setRecordState(db, conflict.existing.id, "active", "superseded", actor.id);
        await setRecordState(db, conflict.incoming.id, "conflict", "active", actor.id);
      } else {
        await setRecordState(db, conflict.incoming.id, "conflict", "rejected", actor.id);
      }
      decision = {
        subjectKind: "conflict",
        subjectKey: conflict.incoming.id,
        exceptionCode: "SOURCE_CONFLICT",
        action: data.action,
        fingerprint: conflict.incoming.contentHash,
        payload: { rowKey: row.key, supersededRecordId: conflict.existing?.id },
      };
    } else {
      const target = state.decisions.find((d) => d.id === data.decisionId);
      if (!target || target.action === "revoke") throw new NotFoundError("That decision was not found.");
      const alreadyRevoked = state.decisions.some((d) => d.action === "revoke" && d.payload.revokesDecisionId === target.id);
      if (alreadyRevoked) throw new ConflictError("That decision has already been revoked.");

      if (target.action === "keep_existing") {
        await setRecordState(db, target.subjectKey, "rejected", "conflict", actor.id);
      } else if (target.action === "accept_incoming") {
        const supersededId = target.payload.supersededRecordId;
        const stillActive = await queryOne<{ id: string }>(
          "SELECT id FROM source_records WHERE id = $1 AND state = 'active'",
          [target.subjectKey],
          db,
        );
        if (!stillActive) {
          throw new ConflictError(
            "This decision can no longer be reversed here: the accepted record has since been replaced. Import corrected source data instead.",
          );
        }
        await setRecordState(db, target.subjectKey, "active", "conflict", actor.id);
        if (supersededId) await setRecordState(db, supersededId, "superseded", "active", actor.id);
      }
      decision = {
        subjectKind: target.subjectKind,
        subjectKey: target.subjectKey,
        exceptionCode: target.exceptionCode,
        action: "revoke",
        fingerprint: target.fingerprint,
        payload: { rowKey: target.payload.rowKey ?? row.key, revokesDecisionId: target.id },
      };
    }

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO review_decisions
         (offering_id, subject_kind, subject_key, exception_code, action, note, fingerprint, payload, decided_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
      [
        offeringId,
        decision.subjectKind,
        decision.subjectKey,
        decision.exceptionCode,
        decision.action,
        data.note,
        decision.fingerprint,
        JSON.stringify(decision.payload),
        actor.id,
      ],
      db,
    );
    if (!inserted) throw new Error("Decision could not be recorded.");

    await recordAudit(db, {
      offeringId,
      actor: { id: actor.id, email: actor.email },
      action: "decision.recorded",
      detail: {
        decisionId: inserted.id,
        decision: decision.action,
        exceptionCode: decision.exceptionCode,
        subjectKind: decision.subjectKind,
        rowKey: decision.payload.rowKey,
      },
    });
    return { decisionId: inserted.id };
  });
}
