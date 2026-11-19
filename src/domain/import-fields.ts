import type { FileKind } from "./types";

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  description: string;
  example: string;
  aliases: string[];
}

export const IMPORT_FIELDS: Record<FileKind, FieldSpec[]> = {
  subscriptions: [
    {
      key: "subscription_id",
      label: "Subscription ID",
      required: true,
      description:
        "Stable identifier of the subscription agreement. One ID covers one share class; an investor subscribing to two classes has two IDs. Funding and allocations are matched on this value.",
      example: "SUB-1012",
      aliases: ["subscription_id", "subscription", "sub_id", "subscription_no", "subscription_number", "agreement_id"],
    },
    {
      key: "investor_ref",
      label: "Investor reference",
      required: true,
      description:
        "The sponsor's reference code for the investor. Use an internal code, not a name or tax ID. It is carried into the register.",
      example: "INV-0412",
      aliases: ["investor_ref", "investor_reference", "investor_id", "investor", "investor_code", "lp_ref", "lp_id"],
    },
    {
      key: "share_class",
      label: "Share class",
      required: true,
      description: "Class of interests subscribed for. Must match the class on the approved allocation.",
      example: "Class A",
      aliases: ["share_class", "class", "unit_class", "interest_class", "series"],
    },
    {
      key: "requested_amount",
      label: "Requested amount",
      required: true,
      description: "Commitment the investor signed for. Positive, at most two decimal places.",
      example: "100000.00",
      aliases: ["requested_amount", "commitment", "commitment_amount", "subscription_amount", "amount", "requested"],
    },
    {
      key: "currency",
      label: "Currency",
      required: true,
      description: "Three-letter ISO currency code. Amounts in different currencies are never netted.",
      example: "USD",
      aliases: ["currency", "ccy", "currency_code"],
    },
    {
      key: "signature_status",
      label: "Signature status",
      required: true,
      description:
        "signed, pending or declined. Only signed subscriptions can carry an approved allocation. Accepted synonyms: executed, completed (signed); sent, unsigned, awaiting (pending); voided, rejected (declined).",
      example: "signed",
      aliases: ["signature_status", "signature", "signing_status", "esign_status", "docs_status", "document_status"],
    },
    {
      key: "payment_reference",
      label: "Payment reference",
      required: false,
      description:
        "Optional. The wire reference this investor was told to use. Funding rows without a subscription ID are matched through this explicit mapping, and only when it points to exactly one subscription.",
      example: "RVB-1012",
      aliases: ["payment_reference", "payment_ref", "wire_reference", "wire_ref", "reference", "memo"],
    },
  ],
  funding: [
    {
      key: "transaction_ref",
      label: "Transaction reference",
      required: true,
      description:
        "Unique reference of the bank transaction. Re-importing a row with the same reference never counts it twice; a changed row with the same reference goes to review.",
      example: "WIRE-20311",
      aliases: ["transaction_ref", "transaction_reference", "transaction_id", "txn_ref", "txn_id", "bank_reference", "bank_ref", "trace_number"],
    },
    {
      key: "subscription_id",
      label: "Subscription ID",
      required: false,
      description:
        "Subscription the payment belongs to. Leave empty only when a payment reference is supplied. Rows with neither are imported as unmatched funding for a reviewer to link.",
      example: "SUB-1012",
      aliases: ["subscription_id", "subscription", "sub_id", "subscription_no", "subscription_number"],
    },
    {
      key: "payment_reference",
      label: "Payment reference",
      required: false,
      description:
        "Reference carried on the payment. Used only when it is mapped to exactly one subscription in the subscriptions file. Names and amounts are never used to match.",
      example: "RVB-1012",
      aliases: ["payment_reference", "payment_ref", "wire_reference", "wire_ref", "reference", "memo", "remittance_info"],
    },
    {
      key: "amount",
      label: "Amount",
      required: true,
      description:
        "Transaction amount, at most two decimal places. Reversal rows may be entered as a positive or negative figure; the magnitude is netted against the original.",
      example: "60000.00",
      aliases: ["amount", "transaction_amount", "credit", "value", "amt"],
    },
    {
      key: "currency",
      label: "Currency",
      required: true,
      description: "Three-letter ISO currency code of the transaction.",
      example: "USD",
      aliases: ["currency", "ccy", "currency_code"],
    },
    {
      key: "settlement_status",
      label: "Settlement status",
      required: true,
      description:
        "cleared, pending, failed or reversed. Only cleared rows count toward funding. Accepted synonyms: settled, completed, posted (cleared); processing, in_transit (pending); rejected, returned, cancelled (failed).",
      example: "cleared",
      aliases: ["settlement_status", "status", "payment_status", "transaction_status", "state"],
    },
    {
      key: "settled_at",
      label: "Settled at",
      required: true,
      description:
        "Settlement date or timestamp. Required for cleared rows. ISO 8601 (2026-03-14 or 2026-03-14T15:20:00Z) or US month/day/year (03/14/2026).",
      example: "2026-03-14",
      aliases: ["settled_at", "settlement_date", "settled_date", "value_date", "cleared_date", "date", "posted_date"],
    },
    {
      key: "original_transaction_ref",
      label: "Original transaction reference",
      required: false,
      description:
        "Only for reversals: the transaction reference of the payment being reversed. A cleared reversal reduces net cleared funding for the original's subscription.",
      example: "WIRE-20298",
      aliases: ["original_transaction_ref", "original_transaction", "original_ref", "reverses", "reversal_of", "related_transaction"],
    },
  ],
  allocations: [
    {
      key: "subscription_id",
      label: "Subscription ID",
      required: true,
      description: "Subscription the allocation was approved against.",
      example: "SUB-1012",
      aliases: ["subscription_id", "subscription", "sub_id", "subscription_no", "subscription_number"],
    },
    {
      key: "share_class",
      label: "Share class",
      required: true,
      description: "Class of interests allocated. Must equal the class on the subscription.",
      example: "Class A",
      aliases: ["share_class", "class", "unit_class", "interest_class", "series"],
    },
    {
      key: "approved_amount",
      label: "Approved amount",
      required: true,
      description:
        "Amount the sponsor approved. Zero records a declined allocation. This figure, not the funded amount, goes into the register.",
      example: "90000.00",
      aliases: ["approved_amount", "allocation_amount", "allocated_amount", "accepted_amount", "amount"],
    },
    {
      key: "approved_units",
      label: "Approved units",
      required: true,
      description:
        "Units approved, up to eight decimal places. Taken exactly as supplied; units are never derived from dollars.",
      example: "90",
      aliases: ["approved_units", "units", "allocated_units", "unit_count", "shares", "interests"],
    },
    {
      key: "currency",
      label: "Currency",
      required: true,
      description: "Three-letter ISO currency code of the approved amount.",
      example: "USD",
      aliases: ["currency", "ccy", "currency_code"],
    },
  ],
};

export type ColumnMapping = Record<string, string | null>;

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Suggests a source column for each field from header names only. The reviewer confirms it before import. */
export function suggestMapping(kind: FileKind, headers: string[], previous?: ColumnMapping | null): ColumnMapping {
  const normalized = headers.map((header) => ({ header, norm: normalizeHeader(header) }));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};

  for (const field of IMPORT_FIELDS[kind]) {
    const prior = previous?.[field.key];
    if (prior && headers.includes(prior) && !used.has(prior)) {
      mapping[field.key] = prior;
      used.add(prior);
      continue;
    }
    mapping[field.key] = null;
  }
  for (const field of IMPORT_FIELDS[kind]) {
    if (mapping[field.key]) continue;
    for (const alias of field.aliases) {
      const match = normalized.find((h) => h.norm === alias && !used.has(h.header));
      if (match) {
        mapping[field.key] = match.header;
        used.add(match.header);
        break;
      }
    }
  }
  return mapping;
}

export function validateMapping(kind: FileKind, headers: string[], mapping: ColumnMapping): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const field of IMPORT_FIELDS[kind]) {
    const source = mapping[field.key] ?? null;
    if (!source) {
      if (field.required) errors.push(`Choose the column that holds "${field.label}".`);
      continue;
    }
    if (!headers.includes(source)) {
      errors.push(`"${field.label}" is mapped to a column that is not in this file.`);
      continue;
    }
    const other = seen.get(source);
    if (other) errors.push(`The column "${source}" is mapped to both "${other}" and "${field.label}".`);
    seen.set(source, field.label);
  }
  if (kind === "funding" && !mapping.subscription_id && !mapping.payment_reference) {
    errors.push('Map "Subscription ID" or "Payment reference" so funding can be matched to subscriptions.');
  }
  return errors;
}
