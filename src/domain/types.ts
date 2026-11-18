export type FileKind = "subscriptions" | "funding" | "allocations";
export const FILE_KINDS: FileKind[] = ["subscriptions", "funding", "allocations"];

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  subscriptions: "Subscriptions",
  funding: "Funding",
  allocations: "Approved allocations",
};

export type SignatureStatus = "signed" | "pending" | "declined";
export type SettlementStatus = "cleared" | "pending" | "failed" | "reversed";

export interface SubscriptionData {
  subscription_id: string;
  investor_ref: string;
  share_class: string;
  requested_amount: string;
  currency: string;
  signature_status: SignatureStatus;
  payment_reference: string | null;
}

export interface FundingData {
  transaction_ref: string;
  subscription_id: string | null;
  payment_reference: string | null;
  /** Always a positive magnitude. A reversal is identified by original_transaction_ref. */
  amount: string;
  currency: string;
  settlement_status: SettlementStatus;
  settled_at: string | null;
  original_transaction_ref: string | null;
}

export interface AllocationData {
  subscription_id: string;
  share_class: string;
  approved_amount: string;
  approved_units: string;
  currency: string;
}

export type RecordData = SubscriptionData | FundingData | AllocationData;

export interface DataByKind {
  subscriptions: SubscriptionData;
  funding: FundingData;
  allocations: AllocationData;
}

export interface SourceRef {
  recordId: string;
  batchId: string;
  filename: string;
  rowNumber: number;
  importedAt: string;
}

export interface SourceRecord<K extends FileKind = FileKind> {
  id: string;
  kind: K;
  key: string;
  state: "active" | "conflict";
  contentHash: string;
  data: DataByKind[K];
  source: SourceRef;
}

export type DecisionAction = "acknowledge" | "link" | "exclude" | "accept_incoming" | "keep_existing" | "revoke";
export type DecisionSubjectKind = "row" | "funding" | "conflict";

export interface DecisionRecord {
  id: string;
  subjectKind: DecisionSubjectKind;
  subjectKey: string;
  exceptionCode: string | null;
  action: DecisionAction;
  note: string;
  /** Hash of the facts the reviewer saw. A decision only applies while the facts are unchanged. */
  fingerprint: string | null;
  payload: {
    /** Reconciliation row the reviewer was working in. */
    rowKey?: string;
    /** Target of a link decision. */
    subscriptionKey?: string;
    revokesDecisionId?: string;
    /** Record replaced when a conflicting version was accepted. */
    supersededRecordId?: string;
  };
  decidedBy: { id: string; email: string; name: string | null };
  decidedAt: string;
}

/** Normalises an identifier for matching: identifiers match exactly, ignoring case and outer whitespace. */
export function idKey(value: string): string {
  return value.trim().toUpperCase();
}

export function shareClassKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function rowKey(subscriptionId: string, shareClass: string): string {
  return `${idKey(subscriptionId)}::${shareClassKey(shareClass)}`;
}

export function fundingRowKey(transactionRef: string): string {
  return `FUNDING::${idKey(transactionRef)}`;
}
