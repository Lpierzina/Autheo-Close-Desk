import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/domain/csv";
import { suggestMapping, type ColumnMapping } from "@/domain/import-fields";
import { normalizeRows } from "@/domain/import-normalize";
import type { DecisionRecord, FileKind, SourceRecord } from "@/domain/types";

export const FIXTURES = path.resolve(__dirname, "../../fixtures/demo");

export function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

/** Builds in-memory source records from CSV text, the same way an import does, without a database. */
export function records<K extends FileKind>(kind: K, csv: string, mapping?: ColumnMapping, filename = `${kind}.csv`): SourceRecord[] {
  const parsed = parseCsv(csv);
  const { valid } = normalizeRows(kind, parsed, mapping ?? suggestMapping(kind, parsed.headers));
  const seen = new Set<string>();
  const out: SourceRecord[] = [];
  for (const row of valid) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push({
      id: `${kind}-${row.rowNumber}`,
      kind,
      key: row.key,
      state: "active",
      contentHash: row.contentHash,
      data: row.data,
      source: { recordId: `${kind}-${row.rowNumber}`, batchId: `batch-${kind}`, filename, rowNumber: row.rowNumber, importedAt: "2026-11-10T00:00:00.000Z" },
    } as SourceRecord);
  }
  return out;
}

let decisionSeq = 0;
export function decision(partial: Partial<DecisionRecord> & Pick<DecisionRecord, "subjectKind" | "subjectKey" | "action">): DecisionRecord {
  decisionSeq += 1;
  return {
    id: `decision-${decisionSeq}`,
    exceptionCode: null,
    note: "Reviewed and documented for the test.",
    fingerprint: null,
    payload: {},
    decidedBy: { id: "user-1", email: "reviewer@example.test", name: "Reviewer" },
    decidedAt: "2026-11-11T00:00:00.000Z",
    ...partial,
  };
}

export const SUBSCRIPTIONS_HEADER = "subscription_id,investor_ref,share_class,requested_amount,currency,signature_status,payment_reference";
export const FUNDING_HEADER = "transaction_ref,subscription_id,payment_reference,amount,currency,settlement_status,settled_at,original_transaction_ref";
export const ALLOCATIONS_HEADER = "subscription_id,share_class,approved_amount,approved_units,currency";

export function csvOf(header: string, rows: string[]): string {
  return [header, ...rows].join("\n") + "\n";
}
