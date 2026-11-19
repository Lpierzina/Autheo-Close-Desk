import DecimalJs from "decimal.js";

/**
 * All money and unit values travel through the app as canonical decimal strings.
 * Arithmetic uses arbitrary-precision decimals; binary floating point is never used
 * for a financial figure.
 */
const D = DecimalJs.clone({ precision: 60, rounding: DecimalJs.ROUND_HALF_EVEN, toExpNeg: -40, toExpPos: 60 });

export type DecimalString = string;

export const MONEY_SCALE = 2;
export const UNIT_SCALE = 8;
const MAX_INTEGER_DIGITS = 15;

export type ParseResult = { ok: true; value: DecimalString } | { ok: false; error: string };

const PLAIN = /^\d+(\.\d+)?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

interface ParseOptions {
  scale: number;
  /** Money keeps a fixed scale ("100.00"); units keep their natural scale ("33.3333"). */
  fixed: boolean;
  allowNegative: boolean;
}

function parseDecimal(input: string, label: string, opts: ParseOptions): ParseResult {
  let text = input.trim();
  if (text === "") return { ok: false, error: `${label} is required` };

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("-")) {
    if (negative) return { ok: false, error: `${label} is not a valid number` };
    negative = true;
    text = text.slice(1).trim();
  }
  if (text.startsWith("$")) text = text.slice(1).trim();

  if (!PLAIN.test(text) && !GROUPED.test(text)) {
    return { ok: false, error: `${label} is not a valid number` };
  }
  const digits = text.replace(/,/g, "");
  const [whole = "", fraction = ""] = digits.split(".");
  if (whole.replace(/^0+/, "").length > MAX_INTEGER_DIGITS) {
    return { ok: false, error: `${label} is too large` };
  }
  if (fraction.replace(/0+$/, "").length > opts.scale) {
    return { ok: false, error: `${label} has more than ${opts.scale} decimal places` };
  }
  const value = new D(digits);
  if (negative && !opts.allowNegative && !value.isZero()) {
    return { ok: false, error: `${label} must not be negative` };
  }
  const signed = negative ? value.neg() : value;
  return { ok: true, value: opts.fixed ? signed.toFixed(opts.scale) : signed.toFixed() };
}

export function parseMoney(input: string, label = "Amount", allowNegative = false): ParseResult {
  return parseDecimal(input, label, { scale: MONEY_SCALE, fixed: true, allowNegative });
}

export function parseUnits(input: string, label = "Units"): ParseResult {
  return parseDecimal(input, label, { scale: UNIT_SCALE, fixed: false, allowNegative: false });
}

export const ZERO: DecimalString = "0.00";

export function add(a: DecimalString, b: DecimalString): DecimalString {
  return new D(a).plus(b).toFixed(MONEY_SCALE);
}

export function sub(a: DecimalString, b: DecimalString): DecimalString {
  return new D(a).minus(b).toFixed(MONEY_SCALE);
}

export function sumMoney(values: Iterable<DecimalString>): DecimalString {
  let total = new D(0);
  for (const v of values) total = total.plus(v);
  return total.toFixed(MONEY_SCALE);
}

export function sumUnits(values: Iterable<DecimalString>): DecimalString {
  let total = new D(0);
  for (const v of values) total = total.plus(v);
  return total.toFixed();
}

export function cmp(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  return new D(a).comparedTo(b) as -1 | 0 | 1;
}

export function isZero(a: DecimalString): boolean {
  return new D(a).isZero();
}

export function isPositive(a: DecimalString): boolean {
  return new D(a).greaterThan(0);
}

export function isNegative(a: DecimalString): boolean {
  return new D(a).lessThan(0);
}

export function abs(a: DecimalString): DecimalString {
  return new D(a).abs().toFixed(MONEY_SCALE);
}

export function negate(a: DecimalString): DecimalString {
  return new D(a).neg().toFixed(MONEY_SCALE);
}

/** Canonical money string with exactly two decimals, e.g. "90000.00". */
export function toMoney(a: DecimalString): DecimalString {
  return new D(a).toFixed(MONEY_SCALE);
}

/** Canonical unit string without trailing zeros, e.g. "33.3333". */
export function toUnits(a: DecimalString): DecimalString {
  return new D(a).toFixed();
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const SYMBOLS: Record<string, string> = { USD: "$", CAD: "CA$", EUR: "€", GBP: "£" };

export function formatMoney(value: DecimalString, currency?: string | null): string {
  const d = new D(value);
  const fixed = d.abs().toFixed(MONEY_SCALE);
  const [whole = "0", fraction = "00"] = fixed.split(".");
  const symbol = currency ? (SYMBOLS[currency] ?? "") : "";
  const suffix = currency && !SYMBOLS[currency] ? ` ${currency}` : "";
  const sign = d.isNegative() && !d.isZero() ? "−" : "";
  return `${sign}${symbol}${group(whole)}.${fraction}${suffix}`;
}

export function formatSignedMoney(value: DecimalString, currency?: string | null): string {
  const d = new D(value);
  if (d.isZero()) return formatMoney(value, currency);
  return d.isPositive() ? `+${formatMoney(value, currency)}` : formatMoney(value, currency);
}

export function formatUnits(value: DecimalString): string {
  const d = new D(value);
  const text = d.toFixed();
  const [whole = "0", fraction] = text.split(".");
  return fraction ? `${group(whole)}.${fraction}` : group(whole);
}
