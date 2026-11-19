import { sha256 } from "./sha256";
import type { ParsedCsv } from "./csv";
import { IMPORT_FIELDS, type ColumnMapping } from "./import-fields";
import { cmp, isZero, negate, parseMoney, parseUnits, sumMoney, sumUnits, isNegative } from "./money";
import {
  idKey,
  shareClassKey,
  type AllocationData,
  type DataByKind,
  type FileKind,
  type FundingData,
  type SettlementStatus,
  type SignatureStatus,
  type SubscriptionData,
} from "./types";

export interface NormalizedRow<K extends FileKind = FileKind> {
  rowNumber: number;
  key: string;
  contentHash: string;
  data: DataByKind[K];
  raw: Record<string, string>;
}

export interface InvalidRow {
  rowNumber: number;
  errors: string[];
  raw: Record<string, string>;
}

export interface NormalizeResult<K extends FileKind = FileKind> {
  valid: NormalizedRow<K>[];
  invalid: InvalidRow[];
}

const SIGNATURE_ALIASES: Record<string, SignatureStatus> = {
  signed: "signed",
  executed: "signed",
  complete: "signed",
  completed: "signed",
  pending: "pending",
  sent: "pending",
  unsigned: "pending",
  not_signed: "pending",
  awaiting: "pending",
  awaiting_signature: "pending",
  in_progress: "pending",
  declined: "declined",
  voided: "declined",
  rejected: "declined",
};

const SETTLEMENT_ALIASES: Record<string, SettlementStatus> = {
  cleared: "cleared",
  settled: "cleared",
  completed: "cleared",
  posted: "cleared",
  pending: "pending",
  processing: "pending",
  in_transit: "pending",
  failed: "failed",
  rejected: "failed",
  returned: "failed",
  cancelled: "failed",
  canceled: "failed",
  reversed: "reversed",
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function statusKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function readText(value: string, label: string, max: number, errors: string[], required = true): string | null {
  const text = value.trim();
  if (text === "") {
    if (required) errors.push(`${label} is required`);
    return null;
  }
  if (text.length > max) {
    errors.push(`${label} is longer than ${max} characters`);
    return null;
  }
  if (CONTROL_CHARS.test(text)) {
    errors.push(`${label} contains control characters`);
    return null;
  }
  return text;
}

function readCurrency(value: string, errors: string[]): string | null {
  const text = value.trim().toUpperCase();
  if (text === "") {
    errors.push("Currency is required");
    return null;
  }
  if (!/^[A-Z]{3}$/.test(text)) {
    errors.push("Currency must be a three-letter ISO code");
    return null;
  }
  return text;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts ISO 8601 dates and timestamps, or US month/day/year. Returns a canonical ISO string. */
export function parseSettledAt(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const text = value.trim();
  const fail = {
    ok: false as const,
    error: "Settled at must be an ISO date (2026-03-14), ISO timestamp, or US date (03/14/2026)",
  };

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const [month, day, year] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (!validCalendarDate(year, month, day)) return fail;
    return { ok: true, value: `${year}-${pad(month)}-${pad(day)}` };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!iso) return fail;
  const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  if (!validCalendarDate(year, month, day)) return fail;
  if (iso[4] === undefined) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` };

  const [hour, minute, second] = [Number(iso[4]), Number(iso[5]), Number(iso[6] ?? "0")];
  if (hour > 23 || minute > 59 || second > 59) return fail;
  const naive = `${iso[1]}-${iso[2]}-${iso[3]}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  const zone = iso[7];
  if (!zone) return { ok: true, value: naive };
  const offset = zone === "Z" ? "Z" : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(`${naive}${offset}`);
  if (Number.isNaN(instant.getTime())) return fail;
  return { ok: true, value: instant.toISOString().replace(".000Z", "Z") };
}

function hashContent(parts: (string | null)[]): string {
  return sha256(JSON.stringify(parts));
}

export function recordKey<K extends FileKind>(kind: K, data: DataByKind[K]): string {
  if (kind === "subscriptions") return idKey((data as SubscriptionData).subscription_id);
  if (kind === "funding") return idKey((data as FundingData).transaction_ref);
  const allocation = data as AllocationData;
  return `${idKey(allocation.subscription_id)}::${shareClassKey(allocation.share_class)}`;
}

/** Hash of the normalised business content. Two rows with the same hash are the same record. */
export function contentHash<K extends FileKind>(kind: K, data: DataByKind[K]): string {
  if (kind === "subscriptions") {
    const d = data as SubscriptionData;
    return hashContent([
      "subscriptions",
      idKey(d.subscription_id),
      idKey(d.investor_ref),
      shareClassKey(d.share_class),
      d.requested_amount,
      d.currency,
      d.signature_status,
      d.payment_reference ? idKey(d.payment_reference) : null,
    ]);
  }
  if (kind === "funding") {
    const d = data as FundingData;
    return hashContent([
      "funding",
      idKey(d.transaction_ref),
      d.subscription_id ? idKey(d.subscription_id) : null,
      d.payment_reference ? idKey(d.payment_reference) : null,
      d.amount,
      d.currency,
      d.settlement_status,
      d.settled_at,
      d.original_transaction_ref ? idKey(d.original_transaction_ref) : null,
    ]);
  }
  const d = data as AllocationData;
  return hashContent([
    "allocations",
    idKey(d.subscription_id),
    shareClassKey(d.share_class),
    d.approved_amount,
    d.approved_units,
    d.currency,
  ]);
}

type Cells = Record<string, string>;

function normalizeSubscription(cells: Cells, errors: string[]): SubscriptionData | null {
  const subscription_id = readText(cells.subscription_id ?? "", "Subscription ID", 64, errors);
  const investor_ref = readText(cells.investor_ref ?? "", "Investor reference", 64, errors);
  const share_class = readText(cells.share_class ?? "", "Share class", 64, errors);
  const amount = parseMoney(cells.requested_amount ?? "", "Requested amount");
  if (!amount.ok) errors.push(amount.error);
  else if (isZero(amount.value)) errors.push("Requested amount must be greater than zero");
  const currency = readCurrency(cells.currency ?? "", errors);
  const statusText = statusKey(cells.signature_status ?? "");
  const signature_status = SIGNATURE_ALIASES[statusText];
  if (statusText === "") errors.push("Signature status is required");
  else if (!signature_status) errors.push(`Signature status "${cells.signature_status?.trim()}" is not recognised`);
  const payment_reference = readText(cells.payment_reference ?? "", "Payment reference", 140, errors, false);

  if (errors.length > 0 || !subscription_id || !investor_ref || !share_class || !amount.ok || !currency || !signature_status) {
    return null;
  }
  return {
    subscription_id,
    investor_ref,
    share_class,
    requested_amount: amount.value,
    currency,
    signature_status,
    payment_reference,
  };
}

function normalizeFunding(cells: Cells, errors: string[]): FundingData | null {
  const transaction_ref = readText(cells.transaction_ref ?? "", "Transaction reference", 100, errors);
  const subscription_id = readText(cells.subscription_id ?? "", "Subscription ID", 64, errors, false);
  const payment_reference = readText(cells.payment_reference ?? "", "Payment reference", 140, errors, false);
  const original_transaction_ref = readText(
    cells.original_transaction_ref ?? "",
    "Original transaction reference",
    100,
    errors,
    false,
  );
  const parsed = parseMoney(cells.amount ?? "", "Amount", true);
  let amount: string | null = null;
  if (!parsed.ok) errors.push(parsed.error);
  else if (isZero(parsed.value)) errors.push("Amount must not be zero");
  else if (isNegative(parsed.value)) {
    if (!original_transaction_ref) {
      errors.push("A negative amount is a reversal and needs the original transaction reference");
    } else amount = negate(parsed.value);
  } else amount = parsed.value;

  const currency = readCurrency(cells.currency ?? "", errors);
  const statusText = statusKey(cells.settlement_status ?? "");
  const settlement_status = SETTLEMENT_ALIASES[statusText];
  if (statusText === "") errors.push("Settlement status is required");
  else if (!settlement_status) errors.push(`Settlement status "${cells.settlement_status?.trim()}" is not recognised`);

  let settled_at: string | null = null;
  const settledText = (cells.settled_at ?? "").trim();
  if (settledText === "") {
    if (settlement_status === "cleared") errors.push("Settled at is required for cleared transactions");
  } else {
    const date = parseSettledAt(settledText);
    if (date.ok) settled_at = date.value;
    else errors.push(date.error);
  }

  if (transaction_ref && original_transaction_ref && idKey(transaction_ref) === idKey(original_transaction_ref)) {
    errors.push("A reversal cannot reference itself as the original transaction");
  }

  if (errors.length > 0 || !transaction_ref || !amount || !currency || !settlement_status) return null;
  return {
    transaction_ref,
    subscription_id,
    payment_reference,
    amount,
    currency,
    settlement_status,
    settled_at,
    original_transaction_ref,
  };
}

function normalizeAllocation(cells: Cells, errors: string[]): AllocationData | null {
  const subscription_id = readText(cells.subscription_id ?? "", "Subscription ID", 64, errors);
  const share_class = readText(cells.share_class ?? "", "Share class", 64, errors);
  const amount = parseMoney(cells.approved_amount ?? "", "Approved amount");
  if (!amount.ok) errors.push(amount.error);
  const units = parseUnits(cells.approved_units ?? "", "Approved units");
  if (!units.ok) errors.push(units.error);
  if (amount.ok && units.ok && isZero(amount.value) !== isZero(units.value)) {
    errors.push("Approved amount and approved units must both be zero or both be greater than zero");
  }
  const currency = readCurrency(cells.currency ?? "", errors);

  if (errors.length > 0 || !subscription_id || !share_class || !amount.ok || !units.ok || !currency) return null;
  return {
    subscription_id,
    share_class,
    approved_amount: amount.value,
    approved_units: units.value,
    currency,
  };
}

/** Applies the confirmed column mapping, validates each row and returns valid and invalid rows separately. */
export function normalizeRows<K extends FileKind>(kind: K, parsed: ParsedCsv, mapping: ColumnMapping): NormalizeResult<K> {
  const valid: NormalizedRow<K>[] = [];
  const invalid: InvalidRow[] = [];

  for (const row of parsed.rows) {
    const cells: Cells = {};
    for (const field of IMPORT_FIELDS[kind]) {
      const source = mapping[field.key];
      cells[field.key] = source ? (row.cells[source] ?? "") : "";
    }
    const errors: string[] = [];
    if (row.columnCount !== parsed.headers.length) {
      invalid.push({
        rowNumber: row.rowNumber,
        errors: [
          `Row has ${row.columnCount} columns but the header has ${parsed.headers.length}. Quote values that contain commas.`,
        ],
        raw: row.cells,
      });
      continue;
    }
    const data =
      kind === "subscriptions"
        ? normalizeSubscription(cells, errors)
        : kind === "funding"
          ? normalizeFunding(cells, errors)
          : normalizeAllocation(cells, errors);

    if (!data || errors.length > 0) {
      invalid.push({ rowNumber: row.rowNumber, errors: errors.length ? errors : ["Row could not be read"], raw: row.cells });
      continue;
    }
    const typed = data as DataByKind[K];
    valid.push({
      rowNumber: row.rowNumber,
      key: recordKey(kind, typed),
      contentHash: contentHash(kind, typed),
      data: typed,
      raw: row.cells,
    });
  }
  return { valid, invalid };
}

export interface CurrencyTotal {
  currency: string;
  label: string;
  amount: string;
}

export interface BatchTotals {
  totals: CurrencyTotal[];
  units: { shareClass: string; units: string }[];
  breakdown: { label: string; count: number }[];
}

function countBy<T>(items: T[], pick: (item: T) => string): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count }));
}

function byCurrency<T>(items: T[], currency: (item: T) => string, amount: (item: T) => string, label: string): CurrencyTotal[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const list = groups.get(currency(item)) ?? [];
    list.push(amount(item));
    groups.set(currency(item), list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, amounts]) => ({ currency: code, label, amount: sumMoney(amounts) }));
}

/** Control totals shown to the reviewer before a batch is committed. Currencies are never combined. */
export function batchTotals<K extends FileKind>(kind: K, rows: NormalizedRow<K>[]): BatchTotals {
  if (kind === "subscriptions") {
    const data = rows.map((r) => r.data as SubscriptionData);
    return {
      totals: [
        ...byCurrency(data, (d) => d.currency, (d) => d.requested_amount, "Requested"),
        ...byCurrency(
          data.filter((d) => d.signature_status === "signed"),
          (d) => d.currency,
          (d) => d.requested_amount,
          "Signed commitments",
        ),
      ],
      units: [],
      breakdown: countBy(data, (d) => d.signature_status),
    };
  }
  if (kind === "funding") {
    const data = rows.map((r) => r.data as FundingData);
    const cleared = data.filter((d) => d.settlement_status === "cleared");
    return {
      totals: [
        ...byCurrency(cleared.filter((d) => !d.original_transaction_ref), (d) => d.currency, (d) => d.amount, "Cleared payments"),
        ...byCurrency(cleared.filter((d) => d.original_transaction_ref), (d) => d.currency, (d) => d.amount, "Cleared reversals"),
        ...byCurrency(
          data.filter((d) => d.settlement_status === "pending"),
          (d) => d.currency,
          (d) => d.amount,
          "Pending (not counted)",
        ),
      ],
      units: [],
      breakdown: countBy(data, (d) => (d.original_transaction_ref ? `reversal · ${d.settlement_status}` : d.settlement_status)),
    };
  }
  const data = rows.map((r) => r.data as AllocationData);
  const classes = new Map<string, { label: string; units: string[] }>();
  for (const d of data) {
    const entry = classes.get(shareClassKey(d.share_class)) ?? { label: d.share_class, units: [] };
    entry.units.push(d.approved_units);
    classes.set(shareClassKey(d.share_class), entry);
  }
  return {
    totals: byCurrency(data, (d) => d.currency, (d) => d.approved_amount, "Approved"),
    units: [...classes.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((c) => ({ shareClass: c.label, units: sumUnits(c.units) })),
    breakdown: countBy(data, (d) => (cmp(d.approved_amount, "0") === 0 ? "declined (zero)" : "approved")),
  };
}
