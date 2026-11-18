import type { ExceptionCode, Severity } from "@/domain/exceptions";
import type { ReconRow, RowStatus } from "@/domain/reconcile";
import type { SignatureStatus } from "@/domain/types";

/** The fields the reconciliation grid needs. Source records and funding lines stay on the server until a row is opened. */
export interface TableRow {
  key: string;
  kind: ReconRow["kind"];
  subscriptionId: string | null;
  investorRef: string | null;
  shareClass: string | null;
  transactionRef: string | null;
  signatureStatus: SignatureStatus | null;
  currency: string | null;
  requestedAmount: string | null;
  netCleared: string | null;
  pendingAmount: string | null;
  approvedAmount: string | null;
  approvedUnits: string | null;
  variance: string | null;
  varianceBasis: ReconRow["varianceBasis"];
  fundingAmount: string | null;
  status: RowStatus;
  inRegister: boolean;
  exceptions: { code: ExceptionCode; title: string; severity: Severity; state: "open" | "documented" | "resolved" }[];
}

export function toTableRow(row: ReconRow): TableRow {
  return {
    key: row.key,
    kind: row.kind,
    subscriptionId: row.subscriptionId,
    investorRef: row.investorRef,
    shareClass: row.shareClass,
    transactionRef: row.transactionRef,
    signatureStatus: row.signatureStatus,
    currency: row.currency,
    requestedAmount: row.requestedAmount,
    netCleared: row.netCleared,
    pendingAmount: row.pendingAmount,
    approvedAmount: row.approvedAmount,
    approvedUnits: row.approvedUnits,
    variance: row.variance,
    varianceBasis: row.varianceBasis,
    fundingAmount: row.kind === "funding" ? (row.funding[0]?.record.data.amount ?? null) : null,
    status: row.status,
    inRegister: row.inRegister,
    exceptions: row.exceptions.map((e) => ({ code: e.code, title: e.title, severity: e.severity, state: e.state })),
  };
}
