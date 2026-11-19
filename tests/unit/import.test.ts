import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv";
import { suggestMapping, validateMapping } from "@/domain/import-fields";
import { batchTotals, normalizeRows } from "@/domain/import-normalize";
import { SAMPLE_FILES } from "@/session/sample-files.generated";
import { ALLOCATIONS_HEADER, csvOf, fixture, FUNDING_HEADER, SUBSCRIPTIONS_HEADER } from "../support/build";

function normalize<K extends "subscriptions" | "funding" | "allocations">(kind: K, csv: string, mapping?: Record<string, string | null>) {
  const parsed = parseCsv(csv);
  const resolved = mapping ?? suggestMapping(kind, parsed.headers);
  return { parsed, mapping: resolved, errors: validateMapping(kind, parsed.headers, resolved), ...normalizeRows(kind, parsed, resolved) };
}

describe("column mapping", () => {
  it("suggests a mapping for the example headers and for common variations", () => {
    expect(suggestMapping("subscriptions", SUBSCRIPTIONS_HEADER.split(","))).toMatchObject({
      subscription_id: "subscription_id",
      investor_ref: "investor_ref",
      payment_reference: "payment_reference",
    });
    const mapped = suggestMapping("allocations", ["Subscription ID", "Share Class", "Approved Amount", "Approved Units", "Currency"]);
    expect(Object.values(mapped).every(Boolean)).toBe(true);
  });

  it("does not guess a column it does not recognise, and says what is missing", () => {
    const headers = ["Bank Ref", "Subscription No", "Wire Memo", "Credit Amount", "CCY", "Payment Status", "Value Date", "Reverses"];
    const suggested = suggestMapping("funding", headers);
    expect(suggested.amount).toBeNull();
    expect(validateMapping("funding", headers, suggested)).toContain('Choose the column that holds "Amount".');
    const complete = { ...suggested, amount: "Credit Amount", payment_reference: "Wire Memo" };
    expect(validateMapping("funding", headers, complete)).toEqual([]);
  });

  it("refuses one column mapped twice and funding with no way to match", () => {
    const headers = FUNDING_HEADER.split(",");
    const base = suggestMapping("funding", headers);
    expect(validateMapping("funding", headers, { ...base, payment_reference: "subscription_id" }).join(" ")).toMatch(/mapped to both/);
    expect(validateMapping("funding", headers, { ...base, subscription_id: null, payment_reference: null }).join(" ")).toMatch(
      /Subscription ID.*or.*Payment reference/,
    );
    expect(validateMapping("funding", headers, { ...base, amount: "not_a_column" }).join(" ")).toMatch(/not in this file/);
  });

  it("reuses the mapping from the previous import of the same file type", () => {
    const headers = ["Ref", "Sub", "Amt", "Cur", "Status", "Date"];
    const previous = { transaction_ref: "Ref", subscription_id: "Sub", amount: "Amt", currency: "Cur", settlement_status: "Status", settled_at: "Date" };
    expect(suggestMapping("funding", headers, previous)).toMatchObject(previous);
  });
});

describe("row validation", () => {
  it("normalises a bank-portal file through an explicit mapping", () => {
    const { valid, invalid } = normalize("funding", fixture("corrections/funding-corrections.csv"), {
      transaction_ref: "Bank Ref",
      subscription_id: "Subscription No",
      payment_reference: "Wire Memo",
      amount: "Credit Amount",
      currency: "CCY",
      settlement_status: "Payment Status",
      settled_at: "Value Date",
      original_transaction_ref: "Reverses",
    });
    expect(invalid).toEqual([]);
    expect(valid.map((r) => r.data)).toEqual([
      { transaction_ref: "WIRE-PENDING-1023", subscription_id: "SUB-1023", payment_reference: null, amount: "50000.00", currency: "USD", settlement_status: "cleared", settled_at: "2026-11-06", original_transaction_ref: null },
      { transaction_ref: "RTN-20319", subscription_id: "SUB-1031", payment_reference: null, amount: "40000.00", currency: "USD", settlement_status: "cleared", settled_at: "2026-11-03", original_transaction_ref: "WIRE-20319" },
      { transaction_ref: "WIRE-20336", subscription_id: "SUB-1036", payment_reference: null, amount: "40000.00", currency: "USD", settlement_status: "cleared", settled_at: "2026-11-04", original_transaction_ref: null },
      { transaction_ref: "WIRE-20346", subscription_id: "SUB-1046", payment_reference: null, amount: "100000.00", currency: "USD", settlement_status: "cleared", settled_at: "2026-11-05", original_transaction_ref: null },
    ]);
  });

  it("reports each invalid row with its file row number and reason, and keeps the valid rows", () => {
    const { valid, invalid } = normalize(
      "funding",
      csvOf(FUNDING_HEADER, [
        "W-1,SUB-1,,1000.00,USD,cleared,2026-10-01,",
        "W-2,SUB-1,,1000.00,USD,cleared,,",
        "W-3,SUB-1,,abc,USD,cleared,2026-10-01,",
        "W-4,SUB-1,,-50.00,USD,cleared,2026-10-01,",
        "W-5,SUB-1,,10.00,US,cleared,2026-10-01,",
        "W-6,SUB-1,,10.00,USD,wired,2026-10-01,",
        ",SUB-1,,10.00,USD,cleared,2026-10-01,",
        "W-8,SUB-1,,10.00,USD,cleared,31/31/2026,",
        "W-9,SUB-1,,0,USD,cleared,2026-10-01,",
        "W-10,SUB-1,,10.00,USD,cleared,2026-10-01,W-10",
        "W-11,SUB-1,,10.00,USD,pending,,",
      ]),
    );
    expect(valid.map((r) => r.rowNumber)).toEqual([2, 12]);
    expect(invalid.map((r) => r.rowNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const reason = (row: number) => invalid.find((r) => r.rowNumber === row)?.errors.join(" ") ?? "";
    expect(reason(3)).toMatch(/Settled at is required for cleared/);
    expect(reason(5)).toMatch(/negative amount is a reversal/);
    expect(reason(7)).toMatch(/not recognised/);
    expect(reason(11)).toMatch(/cannot reference itself/);
  });

  it("treats a row with the wrong number of cells as invalid instead of shifting values", () => {
    const { valid, invalid } = normalize("allocations", `${ALLOCATIONS_HEADER}\nSUB-1,Class A,1000.00,1,USD\nSUB-2,Class A,1000.00,1\nSUB-3,Class A,1,000.00,1,USD\n`);
    expect(valid.map((r) => r.rowNumber)).toEqual([2]);
    expect(invalid.map((r) => r.rowNumber)).toEqual([3, 4]);
  });

  it("requires amount and units to agree on zero, and never derives one from the other", () => {
    const { valid, invalid } = normalize(
      "allocations",
      csvOf(ALLOCATIONS_HEADER, ["SUB-1,Class B,125000.00,100,USD", "SUB-2,Class A,0.00,0,USD", "SUB-3,Class A,1000.00,0,USD", "SUB-4,Class A,0,5,USD"]),
    );
    expect(valid.map((r) => r.data)).toMatchObject([
      { approved_amount: "125000.00", approved_units: "100" },
      { approved_amount: "0.00", approved_units: "0" },
    ]);
    expect(invalid).toHaveLength(2);
  });

  it("gives identical content the same key and hash however it is formatted", () => {
    const a = normalize("funding", csvOf(FUNDING_HEADER, ["wire-1,sub-9,,\"1,000.00\",usd,Settled,10/02/2026,"])).valid[0];
    const b = normalize("funding", csvOf(FUNDING_HEADER, ["WIRE-1,SUB-9,,1000,USD,cleared,2026-10-02,"])).valid[0];
    const c = normalize("funding", csvOf(FUNDING_HEADER, ["WIRE-1,SUB-9,,1000.01,USD,cleared,2026-10-02,"])).valid[0];
    expect(a?.key).toBe(b?.key);
    expect(a?.contentHash).toBe(b?.contentHash);
    expect(c?.key).toBe(a?.key);
    expect(c?.contentHash).not.toBe(a?.contentHash);
  });

  it("totals a batch per currency without netting currencies", () => {
    const { valid } = normalize(
      "funding",
      csvOf(FUNDING_HEADER, [
        "W-1,SUB-1,,1000.00,USD,cleared,2026-10-01,",
        "W-2,SUB-1,,250.50,USD,cleared,2026-10-02,",
        "W-3,SUB-2,,700.00,CAD,cleared,2026-10-02,",
        "W-4,SUB-2,,90.00,USD,pending,,",
      ]),
    );
    const totals = batchTotals("funding", valid).totals;
    const usdCleared = totals.find((t) => t.currency === "USD" && /cleared payments/i.test(t.label));
    const cadCleared = totals.find((t) => t.currency === "CAD" && /cleared payments/i.test(t.label));
    expect(usdCleared?.amount).toBe("1250.50");
    expect(cadCleared?.amount).toBe("700.00");
  });
});

describe("example files", () => {
  it("are the files the app bundles for the sample session and for download", () => {
    for (const name of ["subscriptions.csv", "funding.csv", "allocations.csv"]) {
      expect(SAMPLE_FILES[name], name).toBe(fixture(name));
    }
    expect(SAMPLE_FILES["funding-corrections.csv"]).toBe(fixture("corrections/funding-corrections.csv"));
    expect(SAMPLE_FILES["subscriptions-corrections.csv"]).toBe(fixture("corrections/subscriptions-corrections.csv"));
  });

  it("contain only synthetic identifiers", () => {
    const all = Object.values(SAMPLE_FILES).join("\n");
    expect(all).not.toMatch(/@/);
    expect(all).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    for (const line of SAMPLE_FILES["subscriptions.csv"]?.trim().split("\n").slice(1) ?? []) {
      expect(line).toMatch(/^SUB-\d{4},INV-\d{4},Class [AB],/);
    }
  });
});
