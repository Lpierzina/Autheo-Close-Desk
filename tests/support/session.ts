import { expect } from "vitest";
import type { ColumnMapping } from "@/domain/import-fields";
import type { ReconRow } from "@/domain/reconcile";
import type { FileKind } from "@/domain/types";
import {
  approve,
  commitStaged,
  emptySession,
  previewStaged,
  recordDecision,
  setDeal,
  setSkipInvalidRows,
  setStagedMapping,
  stageFile,
  viewOf,
  type DecisionInput,
  type ImportCounts,
  type ImportPreview,
  type SessionState,
} from "@/session/engine";
import { fixture } from "./build";

export const NOTE = "Reviewed against the source documents and documented.";

/** The funding corrections file uses a bank portal's headers; only the amount column is not recognised. */
export const BANK_PORTAL_MAPPING: ColumnMapping = {
  transaction_ref: "Bank Ref",
  subscription_id: "Subscription No",
  payment_reference: "Wire Memo",
  amount: "Credit Amount",
  currency: "CCY",
  settlement_status: "Payment Status",
  settled_at: "Value Date",
  original_transaction_ref: "Reverses",
};

const encoder = new TextEncoder();

export function newDeal(name = "Riverbend Flats Apartments"): SessionState {
  return setDeal(emptySession(), { dealName: name, currency: "USD" });
}

/** Selects, previews and adds a file, exactly as the Select files step does. */
export function importFile(
  state: SessionState,
  kind: FileKind,
  filename: string,
  content: string,
  options: { mapping?: ColumnMapping; skipInvalidRows?: boolean } = {},
): { state: SessionState; preview: ImportPreview; counts: ImportCounts } {
  let next = stageFile(state, kind, { filename, bytes: encoder.encode(content) });
  if (options.mapping) next = setStagedMapping(next, kind, options.mapping);
  if (options.skipInvalidRows) next = setSkipInvalidRows(next, kind, true);
  const preview = previewStaged(next, kind);
  if (!preview) throw new Error("No preview");
  expect(preview.mappingErrors).toEqual([]);
  const committed = commitStaged(next);
  const result = committed.results[0];
  if (!result) throw new Error("Nothing was added");
  return { state: committed.state, preview, counts: result.counts };
}

export function importDemoFiles(state: SessionState) {
  const subscriptions = importFile(state, "subscriptions", "subscriptions.csv", fixture("subscriptions.csv"));
  const funding = importFile(subscriptions.state, "funding", "funding.csv", fixture("funding.csv"), { skipInvalidRows: true });
  const allocations = importFile(funding.state, "allocations", "allocations.csv", fixture("allocations.csv"));
  return { state: allocations.state, subscriptions, funding, allocations };
}

export function rowOf(state: SessionState, key: string): ReconRow {
  const row = viewOf(state).result.rows.find((r) => r.key === key);
  if (!row) throw new Error(`Row ${key} not found`);
  return row;
}

export function decide(state: SessionState, input: Omit<DecisionInput, "note"> & { note?: string }): SessionState {
  return recordDecision(state, { note: NOTE, ...input }).state;
}

export function acknowledge(state: SessionState, rowKey: string, code: string): SessionState {
  const exception = rowOf(state, rowKey).exceptions.find((e) => e.code === code && e.state === "open");
  expect(exception, `${code} on ${rowKey}`).toBeDefined();
  return decide(state, { action: "acknowledge", rowKey, exceptionId: exception?.id, fingerprint: exception?.fingerprint });
}

export function resolveConflicts(state: SessionState, rowKey: string, action: "accept_incoming" | "keep_existing"): SessionState {
  const conflicts = rowOf(state, rowKey).exceptions.filter((e) => e.code === "SOURCE_CONFLICT" && e.state === "open");
  expect(conflicts.length, `conflicts on ${rowKey}`).toBeGreaterThan(0);
  let next = state;
  for (const conflict of conflicts) next = decide(next, { action, rowKey, exceptionId: conflict.id });
  return next;
}

/**
 * Works the Riverbend Flats sample to a clean close: documents the reviewable exceptions,
 * links and excludes funding, and adds corrected source data for the hard blockers.
 */
export function resolveDemoClose(start: SessionState): SessionState {
  let state = start;
  state = acknowledge(state, "SUB-1012::CLASS A", "EXCESS_FUNDING");
  state = acknowledge(state, "SUB-1044::CLASS A", "MISSING_ALLOCATION");
  state = acknowledge(state, "SUB-1048::CLASS A", "UNSIGNED_NO_ALLOCATION");

  state = decide(state, { action: "exclude", rowKey: "SUB-1034::CLASS A", transactionKey: "PORTAL-88120" });
  state = decide(state, { action: "link", rowKey: "FUNDING::WIRE-20338", transactionKey: "WIRE-20338", subscriptionId: "SUB-1038" });
  state = decide(state, { action: "link", rowKey: "FUNDING::WIRE-20341", transactionKey: "WIRE-20341", subscriptionId: "SUB-1041" });

  state = importFile(state, "subscriptions", "subscriptions-corrections.csv", fixture("corrections/subscriptions-corrections.csv")).state;
  state = resolveConflicts(state, "SUB-1019::CLASS A", "accept_incoming");

  state = importFile(state, "funding", "funding-corrections.csv", fixture("corrections/funding-corrections.csv"), {
    mapping: BANK_PORTAL_MAPPING,
  }).state;
  for (const rowKey of ["SUB-1023::CLASS B", "SUB-1031::CLASS B", "SUB-1046::CLASS B"]) {
    state = resolveConflicts(state, rowKey, "accept_incoming");
  }
  return state;
}

export function confirm(state: SessionState, note = "Confirmed after review of the summary."): SessionState {
  return approve(state, { expectedFingerprint: viewOf(state).fingerprint, note });
}

export function resolvedDemo(): SessionState {
  return resolveDemoClose(importDemoFiles(newDeal()).state);
}
