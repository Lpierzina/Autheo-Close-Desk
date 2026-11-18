import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { buildExceptionsCsv, buildRegisterCsv } from "@/domain/exports";
import type { ReconSummary, RegisterLine } from "@/domain/reconcile";
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { requireOfferingAccess, type Offering } from "../auth/access";
import { lockOffering, query, queryOne, withTransaction, type Db } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { recordAudit } from "./audit";
import { loadWorkingState, type WorkingState } from "./reconciliation";
import type { AppUser } from "./users";

export interface SnapshotInfo {
  id: string;
  version: number;
  approvedBy: string;
  approvedByEmail: string;
  approvedAt: string;
  approvalNote: string | null;
  stateFingerprint: string;
  summary: SnapshotSummary;
  registerSha256: string;
  exceptionsSha256: string;
}

export interface SnapshotSummary {
  recon: ReconSummary;
  sources: Record<FileKind, { batchId: string; filename: string; importedAt: string } | null>;
  documentedExceptions: number;
}

export interface OpenItem {
  rowKey: string;
  label: string;
  code: string;
  title: string;
  severity: "blocker" | "review";
  message: string;
}

export interface CloseReadiness {
  fingerprint: string;
  summary: ReconSummary;
  missingFiles: FileKind[];
  openItems: OpenItem[];
  canApprove: boolean;
  /** Plain-language reasons the close cannot be approved yet. Empty when it can. */
  reasons: string[];
  register: RegisterLine[];
  snapshots: SnapshotInfo[];
  latest: SnapshotInfo | null;
  /** True when the working data is exactly what the latest snapshot froze. */
  workingMatchesLatest: boolean;
}

interface SnapshotRow {
  id: string;
  version: number;
  approved_by_name: string;
  approved_by_email: string;
  approved_at: Date;
  approval_note: string | null;
  state_fingerprint: string;
  summary: SnapshotSummary;
  register_sha256: string;
  exceptions_sha256: string;
}

export async function listSnapshots(offeringId: string, db?: Db): Promise<SnapshotInfo[]> {
  const rows = await query<SnapshotRow>(
    `SELECT s.id, s.version, COALESCE(u.display_name, u.email) AS approved_by_name, u.email AS approved_by_email,
            s.approved_at, s.approval_note, s.state_fingerprint, s.summary, s.register_sha256, s.exceptions_sha256
       FROM snapshots s JOIN app_users u ON u.id = s.approved_by
      WHERE s.offering_id = $1 ORDER BY s.version DESC`,
    [offeringId],
    db,
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    approvedBy: r.approved_by_name,
    approvedByEmail: r.approved_by_email,
    approvedAt: r.approved_at.toISOString(),
    approvalNote: r.approval_note,
    stateFingerprint: r.state_fingerprint,
    summary: r.summary,
    registerSha256: r.register_sha256,
    exceptionsSha256: r.exceptions_sha256,
  }));
}

function assess(state: WorkingState, snapshots: SnapshotInfo[]): CloseReadiness {
  const { result } = state;
  const missingFiles = FILE_KINDS.filter((kind) => !state.latestBatch[kind]);
  const openItems: OpenItem[] = result.rows.flatMap((row) =>
    row.exceptions
      .filter((e) => e.state === "open")
      .map((e) => ({
        rowKey: row.key,
        label:
          row.kind === "funding"
            ? `Funding ${row.transactionRef ?? ""}`.trim()
            : `${row.subscriptionId ?? ""} · ${row.shareClass ?? ""}`,
        code: e.code,
        title: e.title,
        severity: e.severity,
        message: e.message,
      })),
  );
  const latest = snapshots[0] ?? null;
  const workingMatchesLatest = latest?.stateFingerprint === state.fingerprint;

  const reasons: string[] = [];
  if (missingFiles.length > 0) {
    reasons.push(`Import the ${missingFiles.map((k) => FILE_KIND_LABEL[k].toLowerCase()).join(", ")} file${missingFiles.length > 1 ? "s" : ""}.`);
  }
  const blockers = openItems.filter((i) => i.severity === "blocker").length;
  const reviews = openItems.length - blockers;
  if (blockers > 0) reasons.push(blockers > 1 ? `${blockers} blockers need corrected source data.` : "1 blocker needs corrected source data.");
  if (reviews > 0) reasons.push(reviews > 1 ? `${reviews} exceptions still need a reviewer decision.` : "1 exception still needs a reviewer decision.");
  if (missingFiles.length === 0 && openItems.length === 0 && result.register.length === 0) {
    reasons.push("There are no approved allocations to register.");
  }
  if (workingMatchesLatest && latest) reasons.push(`Nothing has changed since version ${latest.version} was approved.`);

  return {
    fingerprint: state.fingerprint,
    summary: result.summary,
    missingFiles,
    openItems,
    canApprove: reasons.length === 0,
    reasons,
    register: result.register,
    snapshots,
    latest,
    workingMatchesLatest,
  };
}

export async function getCloseReadiness(offering: Offering, state?: WorkingState): Promise<CloseReadiness> {
  const [working, snapshots] = await Promise.all([state ?? loadWorkingState(offering), listSnapshots(offering.id)]);
  return assess(working, snapshots);
}

const approveSchema = z.object({
  /** Fingerprint of the close summary the approver reviewed. */
  expectedFingerprint: z.string().min(16).max(128),
  note: z.string().trim().max(2000).optional(),
});

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Approves the close and freezes a versioned snapshot.
 *
 * Everything is re-checked here, inside one transaction that holds the offering lock:
 * the approver role, the three source files, zero open exceptions, and that the data
 * is still what the approver reviewed. The export bytes are stored with the snapshot,
 * so later imports and decisions cannot alter an approved export.
 */
export async function approveClose(
  actor: AppUser,
  offeringId: string,
  input: z.input<typeof approveSchema>,
): Promise<SnapshotInfo> {
  const access = await requireOfferingAccess(actor, offeringId, "approve");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Open the close summary and review it before approving.");

  return withTransaction(async (db) => {
    await lockOffering(db, offeringId);
    const state = await loadWorkingState(access.offering, db);
    const snapshots = await listSnapshots(offeringId, db);
    const readiness = assess(state, snapshots);

    if (!readiness.canApprove) {
      throw new ConflictError("This close cannot be approved yet.", {
        reasons: readiness.reasons,
        openItems: readiness.openItems.slice(0, 50),
      });
    }
    if (parsed.data.expectedFingerprint !== state.fingerprint) {
      throw new ConflictError("The data changed after you opened the close summary. Review the summary again before approving.");
    }

    const registerCsv = buildRegisterCsv(state.result.register);
    const exceptionsCsv = buildExceptionsCsv(state.result);
    const version = (snapshots[0]?.version ?? 0) + 1;
    const sources = Object.fromEntries(
      FILE_KINDS.map((kind) => {
        const batch = state.latestBatch[kind];
        return [kind, batch ? { batchId: batch.id, filename: batch.filename, importedAt: batch.importedAt } : null];
      }),
    ) as SnapshotSummary["sources"];
    const summary: SnapshotSummary = {
      recon: state.result.summary,
      sources,
      documentedExceptions: state.result.rows.flatMap((r) => r.exceptions).filter((e) => e.state !== "open").length,
    };

    const snapshot = await queryOne<{ id: string }>(
      `INSERT INTO snapshots
         (offering_id, version, state_fingerprint, summary, register_csv, register_sha256,
          exceptions_csv, exceptions_sha256, approval_note, approved_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        offeringId,
        version,
        state.fingerprint,
        JSON.stringify(summary),
        registerCsv,
        sha256(registerCsv),
        exceptionsCsv,
        sha256(exceptionsCsv),
        parsed.data.note || null,
        actor.id,
      ],
      db,
    );
    if (!snapshot) throw new Error("Snapshot could not be created.");

    await query(
      `INSERT INTO snapshot_register_lines
         (snapshot_id, line_no, investor_ref, share_class, subscription_id, approved_amount, approved_units, currency)
       SELECT $1, x.line_no, x.investor_ref, x.share_class, x.subscription_id,
              x.approved_amount::numeric(20, 2), x.approved_units::numeric(28, 8), x.currency
         FROM jsonb_to_recordset($2::jsonb)
           AS x(line_no integer, investor_ref text, share_class text, subscription_id text,
                approved_amount text, approved_units text, currency text)`,
      [
        snapshot.id,
        JSON.stringify(
          state.result.register.map((line, index) => ({
            line_no: index + 1,
            investor_ref: line.investorRef,
            share_class: line.shareClass,
            subscription_id: line.subscriptionId,
            approved_amount: line.approvedAmount,
            approved_units: line.approvedUnits,
            currency: line.currency,
          })),
        ),
      ],
      db,
    );

    await recordAudit(db, {
      offeringId,
      actor: { id: actor.id, email: actor.email },
      action: "close.approved",
      detail: {
        snapshotId: snapshot.id,
        version,
        registerLines: state.result.register.length,
        registerAmount: state.result.summary.registerAmount,
        registerSha256: sha256(registerCsv),
        exceptionsSha256: sha256(exceptionsCsv),
      },
    });

    const created = (await listSnapshots(offeringId, db)).find((s) => s.id === snapshot.id);
    if (!created) throw new Error("Snapshot could not be read back.");
    return created;
  });
}

export type ExportFile = "register" | "exceptions";

export interface ExportDownload {
  filename: string;
  content: string;
  sha256: string;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "offering"
  );
}

/** Serves the bytes frozen at approval. The export is never recomputed. */
export async function getSnapshotExport(actor: AppUser, offeringId: string, version: number, file: ExportFile): Promise<ExportDownload> {
  const access = await requireOfferingAccess(actor, offeringId, "view");
  if (!Number.isInteger(version) || version < 1) throw new NotFoundError("Snapshot not found.");
  const row = await queryOne<{ id: string; content: string; sha: string }>(
    file === "register"
      ? "SELECT id, register_csv AS content, register_sha256 AS sha FROM snapshots WHERE offering_id = $1 AND version = $2"
      : "SELECT id, exceptions_csv AS content, exceptions_sha256 AS sha FROM snapshots WHERE offering_id = $1 AND version = $2",
    [offeringId, version],
  );
  if (!row) throw new NotFoundError("Snapshot not found.");
  await recordAudit(undefined, {
    offeringId,
    actor: { id: actor.id, email: actor.email },
    action: "export.downloaded",
    detail: { snapshotId: row.id, version, file, sha256: row.sha },
  });
  return {
    filename: `${slug(access.offering.name)}-${file === "register" ? "ownership-register" : "exceptions"}-v${version}.csv`,
    content: row.content,
    sha256: row.sha,
  };
}

/** Working exceptions report. It reflects current data and is marked as a draft. */
export async function getDraftExceptionsExport(actor: AppUser, offeringId: string): Promise<ExportDownload> {
  const access = await requireOfferingAccess(actor, offeringId, "view");
  const state = await loadWorkingState(access.offering);
  const content = buildExceptionsCsv(state.result);
  const hash = sha256(content);
  await recordAudit(undefined, {
    offeringId,
    actor: { id: actor.id, email: actor.email },
    action: "export.downloaded",
    detail: { file: "exceptions-draft", sha256: hash },
  });
  return { filename: `${slug(access.offering.name)}-exceptions-DRAFT.csv`, content, sha256: hash };
}
