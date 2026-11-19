/**
 * The whole reconciliation session, held in memory.
 *
 * Every function here is pure: it takes the current session and returns a new one. There
 * is no network call, no storage API and no clock other than the timestamp passed in, so
 * the same code runs in a browser tab and under the test runner, and a session that is
 * dropped (refresh, close, Clear session) leaves nothing behind.
 *
 * Any change to files, mappings, decisions or deal settings goes through `changed()`,
 * which discards the approval. An approved export therefore always describes exactly the
 * data on screen.
 */
import { CsvFormatError, decodeCsvBytes, MAX_IMPORT_BYTES, parseCsv, type ParsedCsv } from "@/domain/csv";
import { buildExceptionsCsv, buildRegisterCsv } from "@/domain/exports";
import { IMPORT_FIELDS, suggestMapping, validateMapping, type ColumnMapping } from "@/domain/import-fields";
import { batchTotals, normalizeRows, type BatchTotals, type InvalidRow, type NormalizedRow } from "@/domain/import-normalize";
import { reconcile, type ReconException, type ReconResult, type ReconRow, type ReconSummary } from "@/domain/reconcile";
import { sha256, sha256Bytes } from "@/domain/sha256";
import {
  FILE_KINDS,
  FILE_KIND_LABEL,
  idKey,
  type DecisionAction,
  type DecisionRecord,
  type FileKind,
  type RecordData,
  type SourceRecord,
} from "@/domain/types";

export type SessionErrorCode = "validation" | "conflict" | "not_found";

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly reasons: string[];

  constructor(code: SessionErrorCode, message: string, reasons: string[] = []) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.reasons = reasons;
  }
}

export type RecordState = "active" | "conflict" | "superseded" | "rejected";
export type RowDisposition = "new" | "unchanged" | "conflict" | "duplicate";

export interface StoredRecord {
  id: string;
  seq: number;
  kind: FileKind;
  key: string;
  state: RecordState;
  contentHash: string;
  data: RecordData;
  batchId: string;
  rowNumber: number;
}

export interface ImportCounts {
  rowCount: number;
  validCount: number;
  invalidCount: number;
  /** Records not seen before; they become the active version. */
  newCount: number;
  /** Rows identical to a record already in the workspace. Nothing is added for them. */
  unchangedCount: number;
  /** Rows whose content differs from the record with the same reference. They go to review. */
  conflictCount: number;
  /** Identical rows repeated inside this file. Counted once. */
  duplicateCount: number;
}

export interface Batch {
  id: string;
  kind: FileKind;
  filename: string;
  byteSize: number;
  sha256: string;
  addedAt: string;
  mapping: ColumnMapping;
  counts: ImportCounts;
  totals: BatchTotals;
  invalidRows: { rowNumber: number; errors: string[] }[];
  sample: boolean;
}

/** A file that has been read and previewed but not yet added to the workspace. */
export interface StagedFile {
  kind: FileKind;
  filename: string;
  byteSize: number;
  sha256: string;
  parsed: ParsedCsv;
  mapping: ColumnMapping;
  /** Must be true to add a file that has invalid rows; those rows are left out. */
  skipInvalidRows: boolean;
  sample: boolean;
}

export interface Approval {
  approvedAt: string;
  /** Identifies the exact records and decisions that were confirmed. */
  fingerprint: string;
  note: string | null;
  summary: ReconSummary;
  documentedExceptions: number;
  sources: Record<FileKind, { filename: string; addedAt: string } | null>;
  registerCsv: string;
  registerSha256: string;
  exceptionsCsv: string;
  exceptionsSha256: string;
}

export interface SessionState {
  nextSeq: number;
  dealName: string;
  currency: string;
  staged: Partial<Record<FileKind, StagedFile>>;
  batches: Batch[];
  records: StoredRecord[];
  decisions: DecisionRecord[];
  approval: Approval | null;
  /** Set when a change discarded an approval, so the screen can say why the export is gone. */
  voidedApproval: { approvedAt: string; reason: string } | null;
}

export const DEFAULT_CURRENCY = "USD";
const NOTE_MIN = 10;
const NOTE_MAX = 2000;
const PREVIEW_ROW_LIMIT = 25;
const INVALID_ROW_LIMIT = 200;
const STORED_INVALID_ROW_LIMIT = 500;

/** Decisions carry no identity: this build has no accounts, and nothing is sent anywhere. */
const SESSION_REVIEWER = { id: "this-session", email: "", name: null } as const;

export function emptySession(): SessionState {
  return {
    nextSeq: 1,
    dealName: "",
    currency: DEFAULT_CURRENCY,
    staged: {},
    batches: [],
    records: [],
    decisions: [],
    approval: null,
    voidedApproval: null,
  };
}

export function isEmptySession(state: SessionState): boolean {
  return (
    state.batches.length === 0 &&
    state.records.length === 0 &&
    state.decisions.length === 0 &&
    Object.keys(state.staged).length === 0 &&
    state.approval === null &&
    state.dealName === ""
  );
}

function now(at?: string): string {
  return at ?? new Date().toISOString();
}

/** Applies a change to the workspace and discards any approval that described the old data. */
function changed(state: SessionState, patch: Partial<SessionState>, reason: string): SessionState {
  return {
    ...state,
    ...patch,
    approval: null,
    voidedApproval: state.approval ? { approvedAt: state.approval.approvedAt, reason } : state.voidedApproval,
  };
}

function assertKind(kind: string): asserts kind is FileKind {
  if (!(FILE_KINDS as string[]).includes(kind)) throw new SessionError("validation", "Unknown file type.");
}

function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  if (!/\.csv$/i.test(safe)) throw new SessionError("validation", "Select a .csv file. Export spreadsheets as CSV (UTF-8) first.");
  return safe;
}

function cleanMapping(kind: FileKind, mapping: ColumnMapping): ColumnMapping {
  const clean: ColumnMapping = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const value = mapping[field.key];
    clean[field.key] = typeof value === "string" && value !== "" ? value : null;
  }
  return clean;
}

function latestBatchOf(state: SessionState, kind: FileKind): Batch | null {
  for (let i = state.batches.length - 1; i >= 0; i -= 1) {
    const batch = state.batches[i];
    if (batch && batch.kind === kind) return batch;
  }
  return null;
}

export interface SelectedFile {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Reads a selected file into the session as a staged preview. Nothing is added to the
 * workspace until `commitStaged`.
 */
export function stageFile(state: SessionState, kind: string, file: SelectedFile, options: { sample?: boolean } = {}): SessionState {
  assertKind(kind);
  const filename = cleanFilename(file.filename);
  if (file.bytes.byteLength === 0) throw new SessionError("validation", "That file is empty.");
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new SessionError(
      "validation",
      `That file is larger than the ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB limit. Split it into smaller files.`,
    );
  }
  let parsed: ParsedCsv;
  try {
    parsed = parseCsv(decodeCsvBytes(file.bytes));
  } catch (error) {
    if (error instanceof CsvFormatError) throw new SessionError("validation", error.message);
    throw error;
  }
  const staged: StagedFile = {
    kind,
    filename,
    byteSize: file.bytes.byteLength,
    sha256: sha256Bytes(file.bytes),
    parsed,
    mapping: suggestMapping(kind, parsed.headers, latestBatchOf(state, kind)?.mapping ?? null),
    skipInvalidRows: false,
    sample: options.sample ?? false,
  };
  return changed(state, { staged: { ...state.staged, [kind]: staged } }, "A file was selected");
}

export function setStagedMapping(state: SessionState, kind: FileKind, mapping: ColumnMapping): SessionState {
  const staged = state.staged[kind];
  if (!staged) throw new SessionError("not_found", "Select a file first.");
  return changed(
    state,
    { staged: { ...state.staged, [kind]: { ...staged, mapping: cleanMapping(kind, mapping), skipInvalidRows: false } } },
    "A column mapping was changed",
  );
}

export function setSkipInvalidRows(state: SessionState, kind: FileKind, skip: boolean): SessionState {
  const staged = state.staged[kind];
  if (!staged) throw new SessionError("not_found", "Select a file first.");
  return changed(state, { staged: { ...state.staged, [kind]: { ...staged, skipInvalidRows: skip } } }, "A file selection was changed");
}

export function unstageFile(state: SessionState, kind: FileKind): SessionState {
  if (!state.staged[kind]) return state;
  const staged = { ...state.staged };
  delete staged[kind];
  return changed(state, { staged }, "A file selection was removed");
}

interface Classified<K extends FileKind> {
  fresh: NormalizedRow<K>[];
  unchanged: NormalizedRow<K>[];
  conflicts: NormalizedRow<K>[];
  duplicates: NormalizedRow<K>[];
  disposition: Map<number, RowDisposition>;
}

/**
 * Decides what each valid row means against what is already in the workspace.
 * The same content under the same reference is never added or counted twice;
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

function storedVersions(records: StoredRecord[], kind: FileKind): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.kind !== kind) continue;
    const set = map.get(record.key) ?? new Set<string>();
    set.add(record.contentHash);
    map.set(record.key, set);
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

export interface ImportPreview {
  kind: FileKind;
  filename: string;
  byteSize: number;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, string>[];
  mapping: ColumnMapping;
  mappingErrors: string[];
  skipInvalidRows: boolean;
  /** Null until the mapping is complete. */
  validation: null | {
    counts: ImportCounts;
    totals: BatchTotals;
    invalidRows: InvalidRow[];
    invalidRowsTruncated: boolean;
    conflicts: { rowNumber: number; key: string; changes: { field: string; existing: string | null; incoming: string | null }[] }[];
    rows: { rowNumber: number; disposition: RowDisposition; data: RecordData }[];
  };
  /** Why the file cannot be added yet, in plain language. Null when it can. */
  blockedBy: string | null;
}

interface Analysis<K extends FileKind = FileKind> {
  mappingErrors: string[];
  valid: NormalizedRow<K>[];
  invalid: InvalidRow[];
  classified: Classified<K> | null;
}

const analysisCache = new WeakMap<StagedFile, { records: StoredRecord[]; analysis: Analysis }>();

function analyse(state: SessionState, staged: StagedFile): Analysis {
  const cached = analysisCache.get(staged);
  if (cached && cached.records === state.records) return cached.analysis;
  const mappingErrors = validateMapping(staged.kind, staged.parsed.headers, staged.mapping);
  let analysis: Analysis;
  if (mappingErrors.length > 0) {
    analysis = { mappingErrors, valid: [], invalid: [], classified: null };
  } else {
    const { valid, invalid } = normalizeRows(staged.kind, staged.parsed, staged.mapping);
    analysis = { mappingErrors, valid, invalid, classified: classify(valid, storedVersions(state.records, staged.kind)) };
  }
  analysisCache.set(staged, { records: state.records, analysis });
  return analysis;
}

function blockedBy(staged: StagedFile, analysis: Analysis): string | null {
  if (analysis.mappingErrors.length > 0) return "Finish the column mapping.";
  if (analysis.valid.length === 0) return "There are no valid rows in this file.";
  if (analysis.invalid.length > 0 && !staged.skipInvalidRows) {
    return `Confirm that the ${analysis.invalid.length === 1 ? "invalid row" : `${analysis.invalid.length} invalid rows`} should be left out.`;
  }
  return null;
}

/** Reports exactly what adding the staged file would do. Nothing is changed. */
export function previewStaged(state: SessionState, kind: FileKind): ImportPreview | null {
  const staged = state.staged[kind];
  if (!staged) return null;
  const analysis = analyse(state, staged);
  const preview: ImportPreview = {
    kind,
    filename: staged.filename,
    byteSize: staged.byteSize,
    headers: staged.parsed.headers,
    rowCount: staged.parsed.rows.length,
    sampleRows: staged.parsed.rows.slice(0, 5).map((r) => r.cells),
    mapping: staged.mapping,
    mappingErrors: analysis.mappingErrors,
    skipInvalidRows: staged.skipInvalidRows,
    validation: null,
    blockedBy: blockedBy(staged, analysis),
  };
  const { classified, valid, invalid } = analysis;
  if (!classified) return preview;

  const activeByKey = new Map<string, RecordData>();
  for (const record of state.records) {
    if (record.kind === kind && record.state === "active") activeByKey.set(record.key, record.data);
  }
  const firstInFile = new Map<string, NormalizedRow>();
  for (const row of valid) if (!firstInFile.has(row.key)) firstInFile.set(row.key, row);
  const labels = new Map(IMPORT_FIELDS[kind].map((f) => [f.key, f.label]));

  preview.validation = {
    counts: countsOf(staged.parsed.rows.length, invalid.length, classified),
    totals: batchTotals(
      kind,
      valid.filter((r) => classified.disposition.get(r.rowNumber) !== "duplicate"),
    ),
    invalidRows: invalid.slice(0, INVALID_ROW_LIMIT),
    invalidRowsTruncated: invalid.length > INVALID_ROW_LIMIT,
    conflicts: classified.conflicts.slice(0, 50).map((row) => {
      const existing = (activeByKey.get(row.key) ?? firstInFile.get(row.key)?.data ?? {}) as unknown as Record<string, string | null>;
      const incoming = row.data as unknown as Record<string, string | null>;
      return {
        rowNumber: row.rowNumber,
        key: row.key.replace("::", " · "),
        changes: Object.keys(incoming)
          .filter((field) => (existing[field] ?? null) !== (incoming[field] ?? null))
          .map((field) => ({ field: labels.get(field) ?? field, existing: existing[field] ?? null, incoming: incoming[field] ?? null })),
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

export interface CommitResult {
  batchId: string;
  kind: FileKind;
  filename: string;
  counts: ImportCounts;
}

function commitOne(state: SessionState, staged: StagedFile, at: string): { state: SessionState; result: CommitResult } {
  const analysis = analyse(state, staged);
  const reason = blockedBy(staged, analysis);
  if (reason || !analysis.classified) {
    throw new SessionError("validation", `${FILE_KIND_LABEL[staged.kind]}: ${reason ?? "the file cannot be added."}`, analysis.mappingErrors);
  }
  const { classified, valid, invalid } = analysis;
  let seq = state.nextSeq;
  const batchId = `batch-${seq++}`;
  const counts = countsOf(staged.parsed.rows.length, invalid.length, classified);
  const batch: Batch = {
    id: batchId,
    kind: staged.kind,
    filename: staged.filename,
    byteSize: staged.byteSize,
    sha256: staged.sha256,
    addedAt: at,
    mapping: staged.mapping,
    counts,
    totals: batchTotals(
      staged.kind,
      valid.filter((r) => classified.disposition.get(r.rowNumber) !== "duplicate"),
    ),
    invalidRows: invalid.slice(0, STORED_INVALID_ROW_LIMIT).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    sample: staged.sample,
  };
  const added: StoredRecord[] = [
    ...classified.fresh.map((row) => ({ row, state: "active" as const })),
    ...classified.conflicts.map((row) => ({ row, state: "conflict" as const })),
  ].map(({ row, state: recordState }) => {
    const n = seq++;
    return {
      id: `record-${n}`,
      seq: n,
      kind: staged.kind,
      key: row.key,
      state: recordState,
      contentHash: row.contentHash,
      data: row.data,
      batchId,
      rowNumber: row.rowNumber,
    };
  });
  const remaining = { ...state.staged };
  delete remaining[staged.kind];
  return {
    state: changed(
      state,
      { nextSeq: seq, staged: remaining, batches: [...state.batches, batch], records: [...state.records, ...added] },
      "A file was added to the workspace",
    ),
    result: { batchId, kind: staged.kind, filename: staged.filename, counts },
  };
}

/** Adds every staged file to the workspace. Either all of them are added or none is. */
export function commitStaged(state: SessionState, at?: string): { state: SessionState; results: CommitResult[] } {
  const kinds = FILE_KINDS.filter((kind) => state.staged[kind]);
  if (kinds.length === 0) throw new SessionError("validation", "Select a CSV file first.");
  const stamp = now(at);
  let next = state;
  const results: CommitResult[] = [];
  for (const kind of kinds) {
    const staged = next.staged[kind];
    if (!staged) continue;
    const committed = commitOne(next, staged, stamp);
    next = committed.state;
    results.push(committed.result);
  }
  return { state: next, results };
}

/**
 * Removes every record of one file type, with the decisions that only made sense for
 * those records. Notes written against a row stay in the history and apply again only if
 * the same figures come back.
 */
export function removeKind(state: SessionState, kind: FileKind): SessionState {
  const removedIds = new Set(state.records.filter((r) => r.kind === kind).map((r) => r.id));
  const staged = { ...state.staged };
  delete staged[kind];
  if (removedIds.size === 0 && !state.staged[kind] && !state.batches.some((b) => b.kind === kind)) return state;

  const dropped = new Set<string>();
  for (const decision of state.decisions) {
    const onConflict = decision.subjectKind === "conflict" && removedIds.has(decision.subjectKey);
    const onFunding = kind === "funding" && decision.subjectKind === "funding";
    if (onConflict || onFunding) dropped.add(decision.id);
  }
  return changed(
    state,
    {
      staged,
      batches: state.batches.filter((b) => b.kind !== kind),
      records: state.records.filter((r) => r.kind !== kind),
      decisions: state.decisions.filter((d) => !dropped.has(d.id)),
    },
    `The ${FILE_KIND_LABEL[kind].toLowerCase()} records were removed`,
  );
}

export function setDeal(state: SessionState, patch: { dealName?: string; currency?: string }): SessionState {
  const dealName = patch.dealName === undefined ? state.dealName : patch.dealName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  let currency = state.currency;
  if (patch.currency !== undefined) {
    currency = patch.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new SessionError("validation", "Use a three-letter currency code, such as USD.");
  }
  if (dealName === state.dealName && currency === state.currency) return state;
  return changed(state, { dealName, currency }, "The deal settings were changed");
}

function toSourceRecord(record: StoredRecord, batches: Map<string, Batch>): SourceRecord {
  const batch = batches.get(record.batchId);
  return {
    id: record.id,
    kind: record.kind,
    key: record.key,
    state: record.state,
    contentHash: record.contentHash,
    data: record.data,
    source: {
      recordId: record.id,
      batchId: record.batchId,
      filename: batch?.filename ?? "",
      rowNumber: record.rowNumber,
      importedAt: batch?.addedAt ?? "",
    },
  } as SourceRecord;
}

export interface OpenItem {
  rowKey: string;
  label: string;
  code: string;
  title: string;
  severity: "blocker" | "review";
  message: string;
}

export interface SessionView {
  result: ReconResult;
  /** Identifies the exact source records and decisions behind `result`. */
  fingerprint: string;
  latestBatch: Record<FileKind, Batch | null>;
  filesAdded: number;
  missingFiles: FileKind[];
  openItems: OpenItem[];
  openBlockers: number;
  openReviews: number;
  documentedExceptions: number;
  canApprove: boolean;
  /** Plain-language reasons the reviewed register cannot be confirmed yet. Empty when it can. */
  reasons: string[];
  approved: boolean;
}

interface Working {
  result: ReconResult;
  fingerprint: string;
}

let lastWorking: { records: StoredRecord[]; batches: Batch[]; decisions: DecisionRecord[]; currency: string; working: Working } | null = null;

function working(state: SessionState): Working {
  if (
    lastWorking &&
    lastWorking.records === state.records &&
    lastWorking.batches === state.batches &&
    lastWorking.decisions === state.decisions &&
    lastWorking.currency === state.currency
  ) {
    return lastWorking.working;
  }
  const batches = new Map(state.batches.map((b) => [b.id, b]));
  const live = state.records
    .filter((r) => r.state === "active" || r.state === "conflict")
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : a.seq - b.seq));
  const result = reconcile({
    offeringCurrency: state.currency,
    records: live.map((r) => toSourceRecord(r, batches)),
    decisions: state.decisions,
  });
  const fingerprint = sha256(JSON.stringify([state.currency, live.map((r) => `${r.id}:${r.state}`).sort(), state.decisions.map((d) => d.id)]));
  const value = { result, fingerprint };
  lastWorking = { records: state.records, batches: state.batches, decisions: state.decisions, currency: state.currency, working: value };
  return value;
}

const viewCache = new WeakMap<SessionState, SessionView>();

/** Reconciles the session from what it holds right now. Nothing is cached across changes. */
export function viewOf(state: SessionState): SessionView {
  const cached = viewCache.get(state);
  if (cached) return cached;
  const { result, fingerprint } = working(state);

  const latestBatch = { subscriptions: null, funding: null, allocations: null } as Record<FileKind, Batch | null>;
  for (const batch of state.batches) latestBatch[batch.kind] = batch;
  const missingFiles = FILE_KINDS.filter((kind) => !latestBatch[kind]);

  const openItems: OpenItem[] = result.rows.flatMap((row) =>
    row.exceptions
      .filter((e) => e.state === "open")
      .map((e) => ({
        rowKey: row.key,
        label: row.kind === "funding" ? `Payment ${row.transactionRef ?? ""}`.trim() : `${row.subscriptionId ?? ""} · ${row.shareClass ?? ""}`,
        code: e.code,
        title: e.title,
        severity: e.severity,
        message: e.message,
      })),
  );
  const openBlockers = openItems.filter((i) => i.severity === "blocker").length;
  const openReviews = openItems.length - openBlockers;

  const reasons: string[] = [];
  if (missingFiles.length > 0) {
    reasons.push(`Add the ${missingFiles.map((k) => FILE_KIND_LABEL[k].toLowerCase()).join(", ")} file${missingFiles.length > 1 ? "s" : ""}.`);
  }
  if (Object.keys(state.staged).length > 0) reasons.push("A selected file has not been added to the workspace yet. Add it or remove it.");
  if (openBlockers > 0) reasons.push(openBlockers > 1 ? `${openBlockers} blockers need corrected source data.` : "1 blocker needs corrected source data.");
  if (openReviews > 0) reasons.push(openReviews > 1 ? `${openReviews} exceptions still need a review decision.` : "1 exception still needs a review decision.");
  if (missingFiles.length === 0 && openItems.length === 0 && result.register.length === 0) {
    reasons.push("There are no approved allocations to put in a register.");
  }

  const view: SessionView = {
    result,
    fingerprint,
    latestBatch,
    filesAdded: FILE_KINDS.length - missingFiles.length,
    missingFiles,
    openItems,
    openBlockers,
    openReviews,
    documentedExceptions: result.rows.flatMap((r) => r.exceptions).filter((e) => e.state !== "open").length,
    canApprove: reasons.length === 0 && state.approval === null,
    reasons,
    approved: state.approval !== null,
  };
  viewCache.set(state, view);
  return view;
}

export interface DecisionInput {
  action: DecisionAction;
  rowKey: string;
  exceptionId?: string;
  transactionKey?: string;
  subscriptionId?: string;
  decisionId?: string;
  /** Fingerprint of the exception as the reviewer saw it. */
  fingerprint?: string;
  note: string;
}

function setRecordState(records: StoredRecord[], recordId: string, from: RecordState, to: RecordState): StoredRecord[] {
  let found = false;
  const next = records.map((record) => {
    if (record.id !== recordId || record.state !== from) return record;
    found = true;
    return { ...record, state: to };
  });
  if (!found) throw new SessionError("conflict", "That record changed while you were reviewing it. Open the row again.");
  return next;
}

function findOpenException(row: ReconRow, exceptionId: string | undefined): ReconException {
  const exception = row.exceptions.find((e) => e.id === exceptionId);
  if (!exception) throw new SessionError("not_found", "That exception no longer exists. Open the row again.");
  if (exception.state !== "open") throw new SessionError("conflict", "That exception has already been dealt with.");
  return exception;
}

/**
 * Records a review decision. Decisions are kept apart from source records and can only
 * do four things: document a reviewable exception, link or exclude a funding transaction,
 * choose between two versions of a record, or revoke an earlier decision. None of them
 * can clear a blocker, and none of them changes an approved amount or approved units:
 * only corrected source data does that.
 */
export function recordDecision(state: SessionState, input: DecisionInput, at?: string): { state: SessionState; decisionId: string } {
  const note = (input.note ?? "").trim();
  if (note.length < NOTE_MIN) throw new SessionError("validation", "Write a note of at least 10 characters explaining the decision.");
  if (note.length > NOTE_MAX) throw new SessionError("validation", "Keep the note under 2,000 characters.");

  const { result } = working(state);
  const row = result.rows.find((r) => r.key === input.rowKey);
  if (!row) throw new SessionError("not_found", "That row is no longer in the reconciliation.");

  let records = state.records;
  let decision: Pick<DecisionRecord, "subjectKind" | "subjectKey" | "exceptionCode" | "action" | "fingerprint" | "payload">;

  if (input.action === "acknowledge") {
    const exception = findOpenException(row, input.exceptionId);
    if (exception.resolution !== "document") {
      throw new SessionError(
        "validation",
        exception.severity === "blocker"
          ? "A note cannot clear this blocker. Select a corrected source file."
          : "This exception needs a different action than a note.",
      );
    }
    if (input.fingerprint && input.fingerprint !== exception.fingerprint) {
      throw new SessionError("conflict", "The figures behind this exception changed. Review it again before recording a decision.");
    }
    decision = {
      subjectKind: exception.subjectKind,
      subjectKey: exception.subjectKey,
      exceptionCode: exception.code,
      action: "acknowledge",
      fingerprint: exception.fingerprint,
      payload: { rowKey: row.key },
    };
  } else if (input.action === "link" || input.action === "exclude") {
    const line = row.funding.find((l) => l.record.key === input.transactionKey);
    if (!line) throw new SessionError("not_found", "That payment is not on this row. Open the row again.");
    if (line.isReversal) {
      throw new SessionError("validation", "Reversals cannot be linked or excluded. Select a funding file with a corrected reference.");
    }
    if (line.treatment === "excluded") throw new SessionError("conflict", "That payment is already excluded.");
    const open = row.exceptions.find(
      (e) => e.subjectKind === "funding" && e.subjectKey === line.record.key && e.state === "open" && e.resolution === "link_or_exclude",
    );
    if (input.action === "link") {
      if (!open) throw new SessionError("validation", "Only unmatched or ambiguous payments can be linked to a subscription.");
      const target = idKey(input.subscriptionId ?? "");
      const exists = result.rows.some((r) => r.kind === "subscription" && idKey(r.subscriptionId ?? "") === target);
      if (!target || !exists) throw new SessionError("validation", "Enter a subscription ID that is in the subscriptions file.");
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
  } else if (input.action === "accept_incoming" || input.action === "keep_existing") {
    const exception = findOpenException(row, input.exceptionId);
    const conflict = row.conflicts.find((c) => c.incoming.id === exception.subjectKey);
    if (exception.code !== "SOURCE_CONFLICT" || !conflict) throw new SessionError("validation", "That exception is not a conflict between two versions.");
    if (input.action === "accept_incoming") {
      if (conflict.existing) records = setRecordState(records, conflict.existing.id, "active", "superseded");
      records = setRecordState(records, conflict.incoming.id, "conflict", "active");
    } else {
      records = setRecordState(records, conflict.incoming.id, "conflict", "rejected");
    }
    decision = {
      subjectKind: "conflict",
      subjectKey: conflict.incoming.id,
      exceptionCode: "SOURCE_CONFLICT",
      action: input.action,
      fingerprint: conflict.incoming.contentHash,
      payload: { rowKey: row.key, supersededRecordId: conflict.existing?.id },
    };
  } else if (input.action === "revoke") {
    const target = state.decisions.find((d) => d.id === input.decisionId);
    if (!target || target.action === "revoke") throw new SessionError("not_found", "That decision was not found.");
    if (state.decisions.some((d) => d.action === "revoke" && d.payload.revokesDecisionId === target.id)) {
      throw new SessionError("conflict", "That decision has already been revoked.");
    }
    if (target.action === "keep_existing") {
      records = setRecordState(records, target.subjectKey, "rejected", "conflict");
    } else if (target.action === "accept_incoming") {
      if (!records.some((r) => r.id === target.subjectKey && r.state === "active")) {
        throw new SessionError(
          "conflict",
          "This decision can no longer be reversed here: the accepted record has since been replaced. Select a corrected source file instead.",
        );
      }
      records = setRecordState(records, target.subjectKey, "active", "conflict");
      if (target.payload.supersededRecordId) records = setRecordState(records, target.payload.supersededRecordId, "superseded", "active");
    }
    decision = {
      subjectKind: target.subjectKind,
      subjectKey: target.subjectKey,
      exceptionCode: target.exceptionCode,
      action: "revoke",
      fingerprint: target.fingerprint,
      payload: { rowKey: target.payload.rowKey ?? row.key, revokesDecisionId: target.id },
    };
  } else {
    throw new SessionError("validation", "Unknown decision.");
  }

  const decisionId = `decision-${state.nextSeq}`;
  const record: DecisionRecord = { id: decisionId, ...decision, note, decidedBy: { ...SESSION_REVIEWER }, decidedAt: now(at) };
  return {
    state: changed(state, { nextSeq: state.nextSeq + 1, records, decisions: [...state.decisions, record] }, "A review decision was recorded"),
    decisionId,
  };
}

export type DecisionStanding = "in_effect" | "revoked" | "superseded";

export interface DecisionHistoryItem {
  decision: DecisionRecord;
  standing: DecisionStanding;
}

/** Every decision recorded against a row in this session, newest first, with whether it still applies. */
export function decisionHistory(row: ReconRow, state: SessionState): DecisionHistoryItem[] {
  const fundingKeys = new Set(row.funding.map((l) => l.record.key));
  const revoked = new Set(state.decisions.filter((d) => d.action === "revoke").map((d) => d.payload.revokesDecisionId ?? ""));
  const inEffect = new Set<string>();
  for (const exception of row.exceptions) if (exception.decision) inEffect.add(exception.decision.id);
  for (const line of row.funding) if (line.decision) inEffect.add(line.decision.id);

  return state.decisions
    .filter(
      (d) =>
        d.payload.rowKey === row.key ||
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

/**
 * Confirms the reviewed snapshot and freezes the two exports as text.
 *
 * Everything is checked again here: the three files, no staged file waiting, no open
 * exception, and that the data is still what was on screen when the reviewer confirmed.
 */
export function approve(state: SessionState, input: { expectedFingerprint: string; note?: string }, at?: string): SessionState {
  const view = viewOf(state);
  if (state.approval) throw new SessionError("conflict", "This snapshot is already confirmed.");
  if (!view.canApprove) throw new SessionError("conflict", "The reviewed register cannot be confirmed yet.", view.reasons);
  if (input.expectedFingerprint !== view.fingerprint) {
    throw new SessionError("conflict", "The data changed after you opened the summary. Review it again before confirming.");
  }
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) throw new SessionError("validation", "Keep the note under 2,000 characters.");

  const registerCsv = buildRegisterCsv(view.result.register);
  const exceptionsCsv = buildExceptionsCsv(view.result);
  const sources = Object.fromEntries(
    FILE_KINDS.map((kind) => {
      const batch = view.latestBatch[kind];
      return [kind, batch ? { filename: batch.filename, addedAt: batch.addedAt } : null];
    }),
  ) as Approval["sources"];

  return {
    ...state,
    voidedApproval: null,
    approval: {
      approvedAt: now(at),
      fingerprint: view.fingerprint,
      note: note || null,
      summary: view.result.summary,
      documentedExceptions: view.documentedExceptions,
      sources,
      registerCsv,
      registerSha256: sha256(registerCsv),
      exceptionsCsv,
      exceptionsSha256: sha256(exceptionsCsv),
    },
  };
}

export interface ExportFile {
  filename: string;
  content: string;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "close-desk"
  );
}

/** The reviewed register, exactly as frozen at confirmation. Refused while there is no confirmation. */
export function reviewedRegisterExport(state: SessionState): ExportFile {
  if (!state.approval) {
    const { reasons } = viewOf(state);
    throw new SessionError("conflict", "The reviewed register is available after the snapshot is confirmed.", reasons);
  }
  return { filename: `${slug(state.dealName)}-reviewed-ownership-register.csv`, content: state.approval.registerCsv };
}

/** The exceptions report. Before confirmation it reflects the working data and is marked as a draft. */
export function exceptionsExport(state: SessionState): ExportFile {
  if (state.approval) return { filename: `${slug(state.dealName)}-exceptions-report.csv`, content: state.approval.exceptionsCsv };
  return { filename: `${slug(state.dealName)}-exceptions-report-DRAFT.csv`, content: buildExceptionsCsv(viewOf(state).result) };
}
