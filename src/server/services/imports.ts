import "server-only";
import { createHash } from "node:crypto";
import { CsvFormatError, decodeCsvBytes, MAX_IMPORT_BYTES, parseCsv } from "@/domain/csv";
import { IMPORT_FIELDS, suggestMapping, validateMapping, type ColumnMapping } from "@/domain/import-fields";
import { batchTotals, normalizeRows, type BatchTotals, type NormalizedRow } from "@/domain/import-normalize";
import { FILE_KINDS, type FileKind, type RecordData } from "@/domain/types";
import { requireOfferingAccess } from "../auth/access";
import { lockOffering, query, queryOne, withTransaction, type Db } from "../db";
import { ConflictError, ValidationError } from "../errors";
import { recordAudit } from "./audit";
import type { AppUser } from "./users";

export interface UploadedFile {
  filename: string;
  bytes: Uint8Array;
}

export type RowDisposition = "new" | "unchanged" | "conflict" | "duplicate";

export interface ImportCounts {
  rowCount: number;
  validCount: number;
  invalidCount: number;
  /** Records not seen before; they become the active version. */
  newCount: number;
  /** Rows identical to a record already imported. Nothing is written for them. */
  unchangedCount: number;
  /** Rows whose content differs from the active record with the same reference. They go to review. */
  conflictCount: number;
  /** Identical rows repeated inside this file. Counted once. */
  duplicateCount: number;
}

export interface ImportPreview {
  kind: FileKind;
  filename: string;
  byteSize: number;
  sha256: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  mapping: ColumnMapping;
  mappingErrors: string[];
  validation: null | {
    counts: ImportCounts;
    totals: BatchTotals;
    invalidRows: { rowNumber: number; errors: string[]; raw: Record<string, string> }[];
    invalidRowsTruncated: boolean;
    conflicts: { rowNumber: number; key: string; changes: { field: string; existing: string | null; incoming: string | null }[] }[];
    rows: { rowNumber: number; disposition: RowDisposition; data: RecordData }[];
  };
}

const PREVIEW_ROW_LIMIT = 25;
const INVALID_ROW_LIMIT = 200;
const STORED_INVALID_ROW_LIMIT = 500;

function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  if (!/\.csv$/i.test(safe)) throw new ValidationError("Upload a .csv file. Export spreadsheets as CSV (UTF-8) first.");
  return safe;
}

function assertKind(kind: string): asserts kind is FileKind {
  if (!(FILE_KINDS as string[]).includes(kind)) throw new ValidationError("Unknown file type.");
}

function readFile(file: UploadedFile) {
  const filename = cleanFilename(file.filename);
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ValidationError(`The file is larger than the ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.`);
  }
  try {
    const parsed = parseCsv(decodeCsvBytes(file.bytes));
    return { filename, parsed, sha256: createHash("sha256").update(file.bytes).digest("hex") };
  } catch (error) {
    if (error instanceof CsvFormatError) throw new ValidationError(error.message);
    throw error;
  }
}

function cleanMapping(kind: FileKind, mapping: ColumnMapping): ColumnMapping {
  const clean: ColumnMapping = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const value = mapping[field.key];
    clean[field.key] = typeof value === "string" && value !== "" ? value : null;
  }
  return clean;
}

interface Classified<K extends FileKind> {
  fresh: NormalizedRow<K>[];
  unchanged: NormalizedRow<K>[];
  conflicts: NormalizedRow<K>[];
  duplicates: NormalizedRow<K>[];
  disposition: Map<number, RowDisposition>;
}

/**
 * Decides what each valid row means against what is already stored.
 * The same content under the same reference is never stored or counted twice;
 * different content under an existing reference never overwrites it.
 */
function classify<K extends FileKind>(rows: NormalizedRow<K>[], stored: Map<string, Set<string>>): Classified<K> {
  const known = new Map<string, Set<string>>();
  for (const [key, hashes] of stored) known.set(key, new Set(hashes));
  const seenInFile = new Set<string>();
  const out: Classified<K> = { fresh: [], unchanged: [], conflicts: [], duplicates: [], disposition: new Map() };

  for (const row of rows) {
    const versionId = `${row.key}\u0000${row.contentHash}`;
    const hashes = known.get(row.key);
    let disposition: RowDisposition;
    if (!hashes) {
      known.set(row.key, new Set([row.contentHash]));
      out.fresh.push(row);
      disposition = "new";
    } else if (hashes.has(row.contentHash)) {
      if (seenInFile.has(versionId)) {
        out.duplicates.push(row);
        disposition = "duplicate";
      } else {
        out.unchanged.push(row);
        disposition = "unchanged";
      }
    } else {
      hashes.add(row.contentHash);
      out.conflicts.push(row);
      disposition = "conflict";
    }
    seenInFile.add(versionId);
    out.disposition.set(row.rowNumber, disposition);
  }
  return out;
}

async function storedVersions(db: Db | undefined, offeringId: string, kind: FileKind): Promise<Map<string, Set<string>>> {
  const rows = await query<{ record_key: string; content_hash: string }>(
    "SELECT record_key, content_hash FROM source_records WHERE offering_id = $1 AND kind = $2",
    [offeringId, kind],
    db,
  );
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.record_key) ?? new Set<string>();
    set.add(row.content_hash);
    map.set(row.record_key, set);
  }
  return map;
}

function countsOf<K extends FileKind>(total: number, invalid: number, c: Classified<K>): ImportCounts {
  return {
    rowCount: total,
    validCount: total - invalid,
    invalidCount: invalid,
    newCount: c.fresh.length,
    unchangedCount: c.unchanged.length,
    conflictCount: c.conflicts.length,
    duplicateCount: c.duplicates.length,
  };
}

async function previousMapping(offeringId: string, kind: FileKind): Promise<ColumnMapping | null> {
  const row = await queryOne<{ column_mapping: ColumnMapping }>(
    "SELECT column_mapping FROM import_batches WHERE offering_id = $1 AND kind = $2 ORDER BY imported_at DESC LIMIT 1",
    [offeringId, kind],
  );
  return row?.column_mapping ?? null;
}

/**
 * Reads an uploaded file and reports exactly what committing it would do.
 * Nothing is written, and the file is not kept: the commit step receives it again.
 */
export async function previewImport(
  actor: AppUser,
  offeringId: string,
  kind: string,
  file: UploadedFile,
  mapping?: ColumnMapping | null,
): Promise<ImportPreview> {
  await requireOfferingAccess(actor, offeringId, "review");
  assertKind(kind);
  const { filename, parsed, sha256 } = readFile(file);

  const resolved = mapping
    ? cleanMapping(kind, mapping)
    : suggestMapping(kind, parsed.headers, await previousMapping(offeringId, kind));
  const mappingErrors = validateMapping(kind, parsed.headers, resolved);

  const preview: ImportPreview = {
    kind,
    filename,
    byteSize: file.bytes.byteLength,
    sha256,
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, 5).map((r) => r.cells),
    mapping: resolved,
    mappingErrors,
    validation: null,
  };
  if (mappingErrors.length > 0) return preview;

  const { valid, invalid } = normalizeRows(kind, parsed, resolved);
  const classified = classify(valid, await storedVersions(undefined, offeringId, kind));

  const conflictKeys = classified.conflicts.map((r) => r.key);
  const activeRows = conflictKeys.length
    ? await query<{ record_key: string; data: Record<string, string | null> }>(
        `SELECT record_key, data FROM source_records
          WHERE offering_id = $1 AND kind = $2 AND state = 'active' AND record_key = ANY($3::text[])`,
        [offeringId, kind, conflictKeys],
      )
    : [];
  const activeByKey = new Map(activeRows.map((r) => [r.record_key, r.data]));
  const firstInFile = new Map<string, NormalizedRow>();
  for (const row of valid) if (!firstInFile.has(row.key)) firstInFile.set(row.key, row);

  preview.validation = {
    counts: countsOf(parsed.rows.length, invalid.length, classified),
    totals: batchTotals(
      kind,
      valid.filter((r) => classified.disposition.get(r.rowNumber) !== "duplicate"),
    ),
    invalidRows: invalid.slice(0, INVALID_ROW_LIMIT),
    invalidRowsTruncated: invalid.length > INVALID_ROW_LIMIT,
    conflicts: classified.conflicts.slice(0, 50).map((row) => {
      const existing =
        activeByKey.get(row.key) ?? (firstInFile.get(row.key)?.data as unknown as Record<string, string | null> | undefined) ?? {};
      const incoming = row.data as unknown as Record<string, string | null>;
      const labels = new Map(IMPORT_FIELDS[kind].map((f) => [f.key, f.label]));
      return {
        rowNumber: row.rowNumber,
        key: row.key.replace("::", " · "),
        changes: Object.keys(incoming)
          .filter((field) => (existing[field] ?? null) !== (incoming[field] ?? null))
          .map((field) => ({
            field: labels.get(field) ?? field,
            existing: existing[field] ?? null,
            incoming: incoming[field] ?? null,
          })),
      };
    }),
    rows: valid.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
      rowNumber: row.rowNumber,
      disposition: classified.disposition.get(row.rowNumber) ?? "new",
      data: row.data,
    })),
  };
  return preview;
}

export interface CommitInput {
  kind: string;
  file: UploadedFile;
  mapping: ColumnMapping;
  /** Hash returned by the preview. The commit is refused if the file is not the one previewed. */
  expectedSha256: string;
  /** Must be true to commit a file that has invalid rows; those rows are left out. */
  skipInvalidRows: boolean;
}

export interface CommitResult {
  batchId: string;
  counts: ImportCounts;
}

export async function commitImport(actor: AppUser, offeringId: string, input: CommitInput): Promise<CommitResult> {
  await requireOfferingAccess(actor, offeringId, "review");
  const kind = input.kind;
  assertKind(kind);
  const { filename, parsed, sha256 } = readFile(input.file);
  if (sha256 !== input.expectedSha256) {
    throw new ConflictError("This is not the file that was previewed. Preview the file again before committing.");
  }
  const mapping = cleanMapping(kind, input.mapping);
  const mappingErrors = validateMapping(kind, parsed.headers, mapping);
  if (mappingErrors.length > 0) throw new ValidationError(mappingErrors[0] ?? "The column mapping is incomplete.", mappingErrors);

  const { valid, invalid } = normalizeRows(kind, parsed, mapping);
  if (valid.length === 0) throw new ValidationError("No valid rows to import. Fix the file and try again.");
  if (invalid.length > 0 && !input.skipInvalidRows) {
    throw new ValidationError(
      `${invalid.length} row(s) are invalid. Fix the file, or confirm that the invalid rows should be left out.`,
    );
  }

  return withTransaction(async (db) => {
    await lockOffering(db, offeringId);
    const classified = classify(valid, await storedVersions(db, offeringId, kind));
    const counts = countsOf(parsed.rows.length, invalid.length, classified);
    const totals = batchTotals(
      kind,
      valid.filter((r) => classified.disposition.get(r.rowNumber) !== "duplicate"),
    );

    const batch = await queryOne<{ id: string }>(
      `INSERT INTO import_batches
         (offering_id, kind, filename, file_sha256, byte_size, row_count, valid_count, invalid_count,
          new_count, unchanged_count, conflict_count, duplicate_count, column_mapping, totals, invalid_rows, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16)
       RETURNING id`,
      [
        offeringId,
        kind,
        filename,
        sha256,
        input.file.bytes.byteLength,
        counts.rowCount,
        counts.validCount,
        counts.invalidCount,
        counts.newCount,
        counts.unchangedCount,
        counts.conflictCount,
        counts.duplicateCount,
        JSON.stringify(mapping),
        JSON.stringify(totals),
        JSON.stringify(invalid.slice(0, STORED_INVALID_ROW_LIMIT).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }))),
        actor.id,
      ],
      db,
    );
    if (!batch) throw new Error("Import batch could not be created.");

    const records = [
      ...classified.fresh.map((row) => ({ row, state: "active" })),
      ...classified.conflicts.map((row) => ({ row, state: "conflict" })),
    ].map(({ row, state }) => ({
      record_key: row.key,
      state,
      content_hash: row.contentHash,
      data: row.data,
      raw: row.raw,
      row_number: row.rowNumber,
    }));
    if (records.length > 0) {
      await query(
        `INSERT INTO source_records (offering_id, kind, record_key, state, content_hash, data, raw, batch_id, row_number)
         SELECT $1, $2, x.record_key, x.state, x.content_hash, x.data, x.raw, $3, x.row_number
           FROM jsonb_to_recordset($4::jsonb)
             AS x(record_key text, state text, content_hash text, data jsonb, raw jsonb, row_number integer)`,
        [offeringId, kind, batch.id, JSON.stringify(records)],
        db,
      );
    }

    await recordAudit(db, {
      offeringId,
      actor: { id: actor.id, email: actor.email },
      action: "import.committed",
      detail: { batchId: batch.id, kind, filename, fileSha256: sha256, ...counts },
    });
    return { batchId: batch.id, counts };
  });
}

export interface BatchInfo {
  id: string;
  kind: FileKind;
  filename: string;
  importedAt: string;
  importedBy: string;
  counts: ImportCounts;
  totals: BatchTotals;
  invalidRows: { rowNumber: number; errors: string[] }[];
}

export async function listBatches(offeringId: string, db?: Db): Promise<BatchInfo[]> {
  const rows = await query<{
    id: string;
    kind: FileKind;
    filename: string;
    imported_at: Date;
    imported_by: string;
    row_count: number;
    valid_count: number;
    invalid_count: number;
    new_count: number;
    unchanged_count: number;
    conflict_count: number;
    duplicate_count: number;
    totals: BatchTotals;
    invalid_rows: { rowNumber: number; errors: string[] }[];
  }>(
    `SELECT b.id, b.kind, b.filename, b.imported_at, COALESCE(u.display_name, u.email) AS imported_by,
            b.row_count, b.valid_count, b.invalid_count, b.new_count, b.unchanged_count, b.conflict_count,
            b.duplicate_count, b.totals, b.invalid_rows
       FROM import_batches b JOIN app_users u ON u.id = b.imported_by
      WHERE b.offering_id = $1 ORDER BY b.imported_at DESC, b.id`,
    [offeringId],
    db,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    filename: r.filename,
    importedAt: r.imported_at.toISOString(),
    importedBy: r.imported_by,
    counts: {
      rowCount: r.row_count,
      validCount: r.valid_count,
      invalidCount: r.invalid_count,
      newCount: r.new_count,
      unchangedCount: r.unchanged_count,
      conflictCount: r.conflict_count,
      duplicateCount: r.duplicate_count,
    },
    totals: r.totals,
    invalidRows: r.invalid_rows,
  }));
}
