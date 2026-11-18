import { toCsv, type CsvColumn } from "./csv";
import type { ReconException, ReconResult, ReconRow, RegisterLine } from "./reconcile";

const REGISTER_COLUMNS: CsvColumn<RegisterLine>[] = [
  { header: "investor_ref", type: "text", value: (l) => l.investorRef },
  { header: "share_class", type: "text", value: (l) => l.shareClass },
  { header: "subscription_id", type: "text", value: (l) => l.subscriptionId },
  { header: "approved_amount", type: "number", value: (l) => l.approvedAmount },
  { header: "approved_units", type: "number", value: (l) => l.approvedUnits },
  { header: "currency", type: "text", value: (l) => l.currency },
];

/** Ownership register: one line per subscription and share class, approved figures only. */
export function buildRegisterCsv(lines: RegisterLine[]): string {
  return toCsv(REGISTER_COLUMNS, lines);
}

interface ExceptionLine {
  row: ReconRow;
  exception: ReconException;
}

const STATE_LABEL: Record<ReconException["state"], string> = {
  open: "open",
  documented: "documented",
  resolved: "resolved",
};

const EXCEPTION_COLUMNS: CsvColumn<ExceptionLine>[] = [
  { header: "record_type", type: "text", value: ({ row }) => (row.kind === "funding" ? "funding" : "subscription") },
  { header: "subscription_id", type: "text", value: ({ row }) => row.subscriptionId },
  { header: "investor_ref", type: "text", value: ({ row }) => row.investorRef },
  { header: "share_class", type: "text", value: ({ row }) => row.shareClass },
  { header: "transaction_ref", type: "text", value: ({ row, exception }) => exception.transactionRef ?? row.transactionRef },
  { header: "exception_code", type: "text", value: ({ exception }) => exception.code },
  { header: "exception", type: "text", value: ({ exception }) => exception.title },
  { header: "severity", type: "text", value: ({ exception }) => exception.severity },
  { header: "state", type: "text", value: ({ exception }) => STATE_LABEL[exception.state] },
  { header: "detail", type: "text", value: ({ exception }) => [exception.message, ...exception.details.slice(1)].join(" ") },
  { header: "requested_amount", type: "number", value: ({ row }) => row.requestedAmount },
  { header: "net_cleared_amount", type: "number", value: ({ row }) => row.netCleared },
  { header: "approved_amount", type: "number", value: ({ row }) => row.approvedAmount },
  { header: "variance_amount", type: "number", value: ({ exception }) => exception.variance },
  { header: "currency", type: "text", value: ({ row, exception }) => exception.currency ?? row.currency },
  { header: "decision", type: "text", value: ({ exception }) => exception.decision?.action ?? "" },
  { header: "decision_note", type: "text", value: ({ exception }) => exception.decision?.note ?? "" },
  { header: "decided_by", type: "text", value: ({ exception }) => exception.decision?.decidedBy.email ?? "" },
  { header: "decided_at", type: "text", value: ({ exception }) => exception.decision?.decidedAt ?? "" },
];

export function exceptionLines(result: ReconResult): ExceptionLine[] {
  return result.rows.flatMap((row) => row.exceptions.map((exception) => ({ row, exception })));
}

/** Every exception raised in the reconciliation, with its state and the reviewer decision behind it. */
export function buildExceptionsCsv(result: ReconResult): string {
  return toCsv(EXCEPTION_COLUMNS, exceptionLines(result));
}
