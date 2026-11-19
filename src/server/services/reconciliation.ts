import "server-only";
import { createHash } from "node:crypto";
import { reconcile, type ReconResult, type ReconRow } from "@/domain/reconcile";
import { FILE_KINDS, type DecisionRecord, type FileKind, type RecordData, type SourceRecord } from "@/domain/types";
import type { Offering } from "../auth/access";
import { query, type Db } from "../db";
import { listBatches, type BatchInfo } from "./imports";

interface RecordRow {
  id: string;
  kind: FileKind;
  record_key: string;
  state: "active" | "conflict";
  content_hash: string;
  data: RecordData;
  row_number: number;
  batch_id: string;
  filename: string;
  imported_at: Date;
}

interface DecisionRow {
  id: string;
  subject_kind: DecisionRecord["subjectKind"];
  subject_key: string;
  exception_code: string | null;
  action: DecisionRecord["action"];
  note: string;
  fingerprint: string | null;
  payload: DecisionRecord["payload"];
  decided_by: string;
  email: string;
  display_name: string | null;
  decided_at: Date;
}

export interface WorkingState {
  result: ReconResult;
  /** Identifies the exact source records and decisions behind `result`. */
  fingerprint: string;
  decisions: DecisionRecord[];
  latestBatch: Record<FileKind, BatchInfo | null>;
  batches: BatchInfo[];
  filesImported: number;
}

export async function loadRecords(offeringId: string, db?: Db): Promise<SourceRecord[]> {
  const rows = await query<RecordRow>(
    `SELECT r.id, r.kind, r.record_key, r.state, r.content_hash, r.data, r.row_number, r.batch_id,
            b.filename, b.imported_at
       FROM source_records r JOIN import_batches b ON b.id = r.batch_id
      WHERE r.offering_id = $1 AND r.state IN ('active', 'conflict')
      ORDER BY r.kind, r.record_key, r.created_at, r.id`,
    [offeringId],
    db,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.record_key,
    state: r.state,
    contentHash: r.content_hash,
    data: r.data,
    source: {
      recordId: r.id,
      batchId: r.batch_id,
      filename: r.filename,
      rowNumber: r.row_number,
      importedAt: r.imported_at.toISOString(),
    },
  })) as SourceRecord[];
}

export async function loadDecisions(offeringId: string, db?: Db): Promise<DecisionRecord[]> {
  const rows = await query<DecisionRow>(
    `SELECT d.id, d.subject_kind, d.subject_key, d.exception_code, d.action, d.note, d.fingerprint, d.payload,
            d.decided_by, u.email, u.display_name, d.decided_at
       FROM review_decisions d JOIN app_users u ON u.id = d.decided_by
      WHERE d.offering_id = $1 ORDER BY d.seq`,
    [offeringId],
    db,
  );
  return rows.map((r) => ({
    id: r.id,
    subjectKind: r.subject_kind,
    subjectKey: r.subject_key,
    exceptionCode: r.exception_code,
    action: r.action,
    note: r.note,
    fingerprint: r.fingerprint,
    payload: r.payload ?? {},
    decidedBy: { id: r.decided_by, email: r.email, name: r.display_name },
    decidedAt: r.decided_at.toISOString(),
  }));
}

/**
 * Reconciles the offering from what is stored right now. There is no cached result to go
 * stale: every read, and the approval itself, recomputes from source records and decisions.
 */
export async function loadWorkingState(offering: Pick<Offering, "id" | "currency">, db?: Db): Promise<WorkingState> {
  // Sequential on purpose: inside a transaction all three reads share one connection.
  const records = await loadRecords(offering.id, db);
  const decisions = await loadDecisions(offering.id, db);
  const batches = await listBatches(offering.id, db);
  const result = reconcile({ offeringCurrency: offering.currency, records, decisions });

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        offering.currency,
        records.map((r) => `${r.id}:${r.state}`).sort(),
        decisions.map((d) => d.id),
      ]),
    )
    .digest("hex");

  const latestBatch = { subscriptions: null, funding: null, allocations: null } as Record<FileKind, BatchInfo | null>;
  for (const batch of batches) {
    if (!latestBatch[batch.kind]) latestBatch[batch.kind] = batch;
  }
  return {
    result,
    fingerprint,
    decisions,
    latestBatch,
    batches,
    filesImported: FILE_KINDS.filter((k) => latestBatch[k]).length,
  };
}

export type DecisionStanding = "in_effect" | "revoked" | "superseded";

export interface DecisionHistoryItem {
  decision: DecisionRecord;
  standing: DecisionStanding;
}

/** Every decision ever recorded against a row, newest first, with whether it still applies. */
export function decisionHistory(row: ReconRow, state: WorkingState): DecisionHistoryItem[] {
  const fundingKeys = new Set(row.funding.map((l) => l.record.key));
  const revoked = new Set(
    state.decisions.filter((d) => d.action === "revoke").map((d) => d.payload.revokesDecisionId ?? ""),
  );
  const inEffect = new Set<string>();
  for (const exception of row.exceptions) if (exception.decision) inEffect.add(exception.decision.id);
  for (const line of row.funding) if (line.decision) inEffect.add(line.decision.id);

  return state.decisions
    .filter(
      (d) =>
        (d.payload as { rowKey?: string }).rowKey === row.key ||
        (d.subjectKind === "row" && d.subjectKey === row.key) ||
        (d.subjectKind === "funding" && fundingKeys.has(d.subjectKey)),
    )
    .map((decision) => {
      let standing: DecisionStanding;
      if (decision.action === "revoke") standing = "in_effect";
      else if (revoked.has(decision.id)) standing = "revoked";
      else if (decision.action === "accept_incoming" || decision.action === "keep_existing") standing = "in_effect";
      else standing = inEffect.has(decision.id) ? "in_effect" : "superseded";
      return { decision, standing };
    })
    .reverse();
}
