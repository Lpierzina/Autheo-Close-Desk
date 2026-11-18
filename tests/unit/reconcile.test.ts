import { describe, expect, it } from "vitest";
import { buildExceptionsCsv, buildRegisterCsv } from "@/domain/exports";
import { reconcile, type ReconRow } from "@/domain/reconcile";
import { fundingRowKey, rowKey, type DecisionRecord } from "@/domain/types";
import { ALLOCATIONS_HEADER, csvOf, decision, fixture, FUNDING_HEADER, records, SUBSCRIPTIONS_HEADER } from "../support/build";

function run(input: { subs?: string[]; funding?: string[]; allocs?: string[]; decisions?: DecisionRecord[]; currency?: string }) {
  const result = reconcile({
    offeringCurrency: input.currency ?? "USD",
    records: [
      ...(input.subs?.length ? records("subscriptions", csvOf(SUBSCRIPTIONS_HEADER, input.subs)) : []),
      ...(input.funding?.length ? records("funding", csvOf(FUNDING_HEADER, input.funding)) : []),
      ...(input.allocs?.length ? records("allocations", csvOf(ALLOCATIONS_HEADER, input.allocs)) : []),
    ],
    decisions: input.decisions ?? [],
  });
  const row = (id: string, shareClass = "Class A"): ReconRow => {
    const found = result.rows.find((r) => r.key === rowKey(id, shareClass));
    if (!found) throw new Error(`row ${id} not found; have ${result.rows.map((r) => r.key).join(", ")}`);
    return found;
  };
  const codes = (r: ReconRow) => r.exceptions.map((e) => e.code).sort();
  return { result, row, codes };
}

const SUB = (id: string, amount = "100000.00", status = "signed", ref = "", shareClass = "Class A", currency = "USD") =>
  `${id},INV-${id.slice(-4)},${shareClass},${amount},${currency},${status},${ref}`;
const WIRE = (ref: string, sub: string, amount: string, opts: { status?: string; date?: string; currency?: string; payRef?: string; original?: string } = {}) =>
  `${ref},${sub},${opts.payRef ?? ""},${amount},${opts.currency ?? "USD"},${opts.status ?? "cleared"},${opts.status && opts.status !== "cleared" ? "" : (opts.date ?? "2026-10-20")},${opts.original ?? ""}`;
const ALLOC = (id: string, amount = "100000.00", units = "100", shareClass = "Class A", currency = "USD") => `${id},${shareClass},${amount},${units},${currency}`;

describe("matching", () => {
  it("is ready when signature, cleared funding and allocation agree", () => {
    const { row, result } = run({ subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "100000.00")], allocs: [ALLOC("SUB-0001")] });
    expect(row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00", approvedAmount: "100000.00", variance: "0.00", inRegister: true, exceptions: [] });
    expect(result.register).toEqual([
      { investorRef: "INV-0001", shareClass: "Class A", subscriptionId: "SUB-0001", approvedAmount: "100000.00", approvedUnits: "100", currency: "USD" },
    ]);
  });

  it("sums several cleared payments for one subscription", () => {
    const { row } = run({
      subs: [SUB("SUB-0001")],
      funding: [WIRE("W-1", "SUB-0001", "33333.33"), WIRE("W-2", "SUB-0001", "33333.33", { date: "2026-10-21" }), WIRE("W-3", "SUB-0001", "33333.34", { date: "2026-10-22" })],
      allocs: [ALLOC("SUB-0001")],
    });
    expect(row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00" });
    expect(row("SUB-0001").funding.map((l) => l.treatment)).toEqual(["counted", "counted", "counted"]);
  });

  it("matches on a payment reference only when the subscriptions file maps it to exactly one subscription", () => {
    const { row, result } = run({
      subs: [SUB("SUB-0001", "100000.00", "signed", "REF-A"), SUB("SUB-0002", "50000.00", "signed", "REF-SHARED"), SUB("SUB-0003", "50000.00", "signed", "REF-SHARED")],
      funding: [WIRE("W-1", "", "100000.00", { payRef: "ref-a" }), WIRE("W-2", "", "50000.00", { payRef: "REF-SHARED" }), WIRE("W-3", "", "50000.00", { payRef: "REF-UNKNOWN" })],
      allocs: [ALLOC("SUB-0001")],
    });
    expect(row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00" });
    expect(row("SUB-0001").funding[0]?.matchedBy).toBe("payment_reference");
    expect(row("SUB-0002").netCleared).toBe("0.00");
    expect(row("SUB-0003").netCleared).toBe("0.00");
    const ambiguous = result.rows.find((r) => r.key === fundingRowKey("W-2"));
    const unmatched = result.rows.find((r) => r.key === fundingRowKey("W-3"));
    expect(ambiguous?.exceptions.map((e) => e.code)).toEqual(["AMBIGUOUS_REFERENCE"]);
    expect(unmatched?.exceptions.map((e) => e.code)).toEqual(["UNMATCHED_FUNDING"]);
    expect(result.summary.unmatchedCleared).toBe("100000.00");
  });

  it("never matches on investor or amount: an identical amount with no reference stays unmatched", () => {
    const { row, result } = run({ subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "", "100000.00")], allocs: [ALLOC("SUB-0001")] });
    expect(row("SUB-0001")).toMatchObject({ status: "blocked", netCleared: "0.00" });
    expect(row("SUB-0001").exceptions.map((e) => e.code)).toEqual(["UNFUNDED_ALLOCATION"]);
    expect(result.rows.find((r) => r.key === fundingRowKey("W-1"))?.status).toBe("needs_review");
    expect(result.register).toEqual([]);
  });

  it("does not count pending or failed funding", () => {
    const { row, codes, result } = run({
      subs: [SUB("SUB-0001")],
      funding: [WIRE("W-1", "SUB-0001", "60000.00"), WIRE("W-2", "SUB-0001", "40000.00", { status: "pending" }), WIRE("W-3", "SUB-0001", "40000.00", { status: "failed" })],
      allocs: [ALLOC("SUB-0001")],
    });
    expect(row("SUB-0001")).toMatchObject({ status: "blocked", netCleared: "60000.00", pendingAmount: "40000.00", variance: "-40000.00" });
    expect(codes(row("SUB-0001"))).toEqual(["PARTIAL_FUNDING"]);
    expect(result.summary.pendingFunding).toBe("40000.00");
  });
});

describe("reversals", () => {
  it("nets a linked reversal against the original and counts the replacement payment", () => {
    const { row } = run({
      subs: [SUB("SUB-0001")],
      funding: [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("R-1", "SUB-0001", "100000.00", { original: "W-1", date: "2026-10-21" }), WIRE("W-2", "SUB-0001", "100000.00", { date: "2026-10-23" })],
      allocs: [ALLOC("SUB-0001")],
    });
    expect(row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00" });
    expect(row("SUB-0001").funding.map((l) => [l.record.data.transaction_ref, l.treatment, l.effect])).toEqual([
      ["W-1", "counted", "100000.00"],
      ["R-1", "reversal_applied", "-100000.00"],
      ["W-2", "counted", "100000.00"],
    ]);
  });

  it("supports a partial reversal", () => {
    const { row } = run({
      subs: [SUB("SUB-0001")],
      funding: [WIRE("W-1", "SUB-0001", "110000.00"), WIRE("R-1", "", "10000.00", { original: "W-1", date: "2026-10-21" })],
      allocs: [ALLOC("SUB-0001")],
    });
    expect(row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00" });
  });

  it.each([
    ["an original that is not in the file", [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("R-1", "SUB-0001", "100000.00", { original: "W-404" })]],
    ["more than the original amount", [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("R-1", "SUB-0001", "100000.01", { original: "W-1" })]],
    ["a different currency than the original", [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("R-1", "SUB-0001", "100000.00", { original: "W-1", currency: "CAD" })]],
    ["another reversal", [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("R-1", "SUB-0001", "1000.00", { original: "W-1" }), WIRE("R-2", "SUB-0001", "1000.00", { original: "R-1" })]],
    ["an original that never cleared", [WIRE("W-1", "SUB-0001", "100000.00", { status: "pending" }), WIRE("R-1", "SUB-0001", "100000.00", { original: "W-1" })]],
  ])("blocks a reversal that references %s, and does not net it", (_label, funding) => {
    const { row } = run({ subs: [SUB("SUB-0001")], funding, allocs: [ALLOC("SUB-0001")] });
    const invalid = row("SUB-0001").exceptions.filter((e) => e.code === "INVALID_REVERSAL");
    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid.every((e) => e.severity === "blocker" && e.resolution === "source")).toBe(true);
    expect(row("SUB-0001").status).toBe("blocked");
    expect(row("SUB-0001").inRegister).toBe(false);
  });
});

describe("exceptions", () => {
  it("flags the guided case as a reviewable variance and registers only the approved amount once documented", () => {
    const base = {
      subs: [SUB("SUB-1012")],
      funding: [WIRE("W-1", "SUB-1012", "60000.00"), WIRE("W-2", "SUB-1012", "40000.00", { date: "2026-10-22" })],
      allocs: [ALLOC("SUB-1012", "90000.00", "90")],
    };
    const open = run(base);
    const exception = open.row("SUB-1012").exceptions[0];
    expect(open.row("SUB-1012")).toMatchObject({ status: "needs_review", requestedAmount: "100000.00", netCleared: "100000.00", approvedAmount: "90000.00", approvedUnits: "90", variance: "10000.00", varianceBasis: "approved", inRegister: false });
    expect(exception).toMatchObject({ code: "EXCESS_FUNDING", severity: "review", resolution: "document", state: "open", variance: "10000.00" });

    const documented = run({
      ...base,
      decisions: [decision({ subjectKind: exception!.subjectKind, subjectKey: exception!.subjectKey, exceptionCode: "EXCESS_FUNDING", action: "acknowledge", fingerprint: exception!.fingerprint })],
    });
    expect(documented.row("SUB-1012")).toMatchObject({ status: "ready", inRegister: true });
    expect(documented.result.register).toEqual([
      { investorRef: "INV-1012", shareClass: "Class A", subscriptionId: "SUB-1012", approvedAmount: "90000.00", approvedUnits: "90", currency: "USD" },
    ]);
    expect(documented.result.summary).toMatchObject({ registerAmount: "90000.00", netClearedFunding: "100000.00", excessOverApproved: "10000.00" });
  });

  it("stops applying a documented decision when the figures behind it change", () => {
    const subs = [SUB("SUB-1012")];
    const allocs = [ALLOC("SUB-1012", "90000.00", "90")];
    const before = run({ subs, funding: [WIRE("W-1", "SUB-1012", "100000.00")], allocs });
    const exception = before.row("SUB-1012").exceptions[0]!;
    const note = decision({ subjectKind: exception.subjectKind, subjectKey: exception.subjectKey, exceptionCode: exception.code, action: "acknowledge", fingerprint: exception.fingerprint });
    const after = run({ subs, funding: [WIRE("W-1", "SUB-1012", "100000.00"), WIRE("W-2", "SUB-1012", "5000.00", { date: "2026-10-25" })], allocs, decisions: [note] });
    expect(after.row("SUB-1012")).toMatchObject({ status: "needs_review", variance: "15000.00" });
    expect(after.row("SUB-1012").exceptions[0]).toMatchObject({ state: "open", decision: null });
  });

  it("reopens an exception when its decision is revoked", () => {
    const base = { subs: [SUB("SUB-1012")], funding: [WIRE("W-1", "SUB-1012", "100000.00")], allocs: [ALLOC("SUB-1012", "90000.00", "90")] };
    const exception = run(base).row("SUB-1012").exceptions[0]!;
    const note = decision({ subjectKind: exception.subjectKind, subjectKey: exception.subjectKey, exceptionCode: exception.code, action: "acknowledge", fingerprint: exception.fingerprint });
    const revoke = decision({ subjectKind: exception.subjectKind, subjectKey: exception.subjectKey, exceptionCode: exception.code, action: "revoke", fingerprint: exception.fingerprint, payload: { revokesDecisionId: note.id } });
    expect(run({ ...base, decisions: [note] }).row("SUB-1012").status).toBe("ready");
    expect(run({ ...base, decisions: [note, revoke] }).row("SUB-1012").status).toBe("needs_review");
  });

  it.each([
    ["an unsigned subscription with an allocation", { subs: [SUB("SUB-0001", "100000.00", "pending")], funding: [WIRE("W-1", "SUB-0001", "100000.00")], allocs: [ALLOC("SUB-0001")] }, "UNSIGNED_WITH_ALLOCATION"],
    ["an allocation with no cleared funding", { subs: [SUB("SUB-0001")], funding: [], allocs: [ALLOC("SUB-0001")] }, "UNFUNDED_ALLOCATION"],
    ["cleared funding below the approved amount", { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "99999.99")], allocs: [ALLOC("SUB-0001")] }, "PARTIAL_FUNDING"],
    ["an allocation above the signed commitment", { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "120000.00")], allocs: [ALLOC("SUB-0001", "120000.00", "120")] }, "ALLOCATION_EXCEEDS_COMMITMENT"],
    ["an allocation for a different share class", { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "100000.00")], allocs: [ALLOC("SUB-0001", "100000.00", "80", "Class B")] }, "SHARE_CLASS_MISMATCH"],
    ["funding in another currency", { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "100000.00", { currency: "CAD" })], allocs: [ALLOC("SUB-0001")] }, "CURRENCY_MISMATCH"],
    ["an allocation in another currency", { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "SUB-0001", "100000.00")], allocs: [ALLOC("SUB-0001", "100000.00", "100", "Class A", "EUR")] }, "CURRENCY_MISMATCH"],
  ])("blocks %s, and a reviewer note does not clear it", (_label, input, code) => {
    const first = run(input);
    const affected = first.result.rows.filter((r) => r.exceptions.some((e) => e.code === code));
    expect(affected.length, `${code} not raised; got ${first.result.rows.flatMap((r) => r.exceptions.map((e) => e.code)).join(", ")}`).toBeGreaterThan(0);
    const exception = affected[0]!.exceptions.find((e) => e.code === code)!;
    expect(exception).toMatchObject({ severity: "blocker", resolution: "source", state: "open" });

    const withNote = run({
      ...input,
      decisions: [decision({ subjectKind: exception.subjectKind, subjectKey: exception.subjectKey, exceptionCode: code, action: "acknowledge", fingerprint: exception.fingerprint })],
    });
    const still = withNote.result.rows.find((r) => r.key === affected[0]!.key)!;
    expect(still.status).toBe("blocked");
    expect(still.exceptions.find((e) => e.code === code)?.state).toBe("open");
    expect(withNote.result.register).toEqual([]);
    expect(withNote.result.summary.openBlockers).toBeGreaterThan(0);
  });

  it("blocks an allocation whose subscription is not in the subscriptions file", () => {
    const { result } = run({ subs: [], funding: [], allocs: [ALLOC("SUB-0404")] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ kind: "allocation", status: "blocked", inRegister: false });
    expect(result.rows[0]?.exceptions.map((e) => e.code)).toContain("ALLOCATION_WITHOUT_SUBSCRIPTION");
  });

  it("does not net currencies: other-currency funding is reported apart and adds nothing to the total", () => {
    const { result, row } = run({
      subs: [SUB("SUB-0001"), SUB("SUB-0002")],
      funding: [WIRE("W-1", "SUB-0001", "100000.00"), WIRE("W-2", "SUB-0002", "100000.00", { currency: "CAD" })],
      allocs: [ALLOC("SUB-0001"), ALLOC("SUB-0002")],
    });
    expect(result.summary.netClearedFunding).toBe("100000.00");
    expect(row("SUB-0002").netCleared).toBe("0.00");
    expect(result.summary.otherCurrencies).toEqual([expect.objectContaining({ currency: "CAD", amount: "100000.00" })]);
  });

  it("flags two cleared payments with the same amount and date as a possible duplicate, without dropping either", () => {
    const { row, codes } = run({
      subs: [SUB("SUB-0001", "60000.00")],
      funding: [WIRE("W-1", "SUB-0001", "60000.00"), WIRE("PORTAL-9", "SUB-0001", "60000.00")],
      allocs: [ALLOC("SUB-0001", "60000.00", "60")],
    });
    expect(codes(row("SUB-0001"))).toEqual(["EXCESS_FUNDING", "POSSIBLE_DUPLICATE"]);
    expect(row("SUB-0001")).toMatchObject({ status: "needs_review", netCleared: "120000.00" });
  });

  it("lets a reviewer exclude a duplicate payment, which removes it from funding but not from the record", () => {
    const base = {
      subs: [SUB("SUB-0001", "60000.00")],
      funding: [WIRE("W-1", "SUB-0001", "60000.00"), WIRE("PORTAL-9", "SUB-0001", "60000.00")],
      allocs: [ALLOC("SUB-0001", "60000.00", "60")],
    };
    const line = run(base).row("SUB-0001").funding.find((l) => l.record.data.transaction_ref === "PORTAL-9")!;
    const excluded = run({
      ...base,
      decisions: [decision({ subjectKind: "funding", subjectKey: line.record.key, exceptionCode: "EXCLUDED_FUNDING", action: "exclude", fingerprint: line.record.contentHash })],
    });
    const row = excluded.row("SUB-0001");
    expect(row.netCleared).toBe("60000.00");
    expect(row.funding.map((l) => l.treatment).sort()).toEqual(["counted", "excluded"]);
    expect(row.exceptions.some((e) => e.code === "EXCESS_FUNDING")).toBe(false);
    expect(row.exceptions.filter((e) => e.state === "open")).toEqual([]);
    expect(row.inRegister).toBe(true);
  });

  it("links unmatched funding only through an explicit reviewer decision", () => {
    const base = { subs: [SUB("SUB-0001")], funding: [WIRE("W-1", "", "100000.00", { payRef: "MEMO 123" })], allocs: [ALLOC("SUB-0001")] };
    const before = run(base);
    const line = before.result.rows.find((r) => r.key === fundingRowKey("W-1"))!.funding[0]!;
    const linked = run({
      ...base,
      decisions: [decision({ subjectKind: "funding", subjectKey: line.record.key, exceptionCode: "UNMATCHED_FUNDING", action: "link", fingerprint: line.record.contentHash, payload: { subscriptionKey: "SUB-0001" } })],
    });
    expect(linked.result.rows.find((r) => r.key === fundingRowKey("W-1"))).toBeUndefined();
    expect(linked.row("SUB-0001")).toMatchObject({ status: "ready", netCleared: "100000.00", inRegister: true });
    expect(linked.row("SUB-0001").funding[0]?.matchedBy).toBe("reviewer_link");
  });

  it("leaves signed subscriptions without an allocation, and unsigned ones, out of the register pending review", () => {
    const { row, codes, result } = run({
      subs: [SUB("SUB-0001"), SUB("SUB-0002", "50000.00", "declined")],
      funding: [WIRE("W-1", "SUB-0001", "100000.00")],
      allocs: [],
    });
    expect(codes(row("SUB-0001"))).toEqual(["MISSING_ALLOCATION"]);
    expect(codes(row("SUB-0002"))).toEqual(["UNSIGNED_NO_ALLOCATION"]);
    expect(result.register).toEqual([]);
    expect(result.summary.signedCommitments).toBe("100000.00");
  });
});

describe("demo fixture", () => {
  const result = reconcile({
    offeringCurrency: "USD",
    records: [
      ...records("subscriptions", fixture("subscriptions.csv")),
      ...records("funding", fixture("funding.csv")),
      ...records("allocations", fixture("allocations.csv")),
    ],
    decisions: [],
  });

  it("keeps the three totals distinct", () => {
    expect(result.summary).toMatchObject({
      signedCommitments: "5090000.00",
      netClearedFunding: "4750000.00",
      approvedAllocations: "5000000.00",
      counts: { total: 52, ready: 39, needsReview: 6, blocked: 7 },
    });
  });

  it("writes a register with exactly the required columns and exact decimals", () => {
    const csv = buildRegisterCsv(result.register);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("investor_ref,share_class,subscription_id,approved_amount,approved_units,currency");
    expect(lines).toHaveLength(result.register.length + 1);
    for (const line of lines.slice(1)) expect(line).toMatch(/^INV-\d{4},Class [AB],SUB-\d{4},\d+\.\d{2},\d+(\.\d+)?,USD$/);
  });

  it("writes one exception line per exception, including the guided variance", () => {
    const csv = buildExceptionsCsv(result);
    const guided = csv.split("\r\n").find((line) => line.includes("SUB-1012"));
    expect(guided).toContain("EXCESS_FUNDING");
    expect(guided).toContain("10000.00");
    expect(csv.trimEnd().split("\r\n").length - 1).toBe(result.rows.reduce((n, r) => n + r.exceptions.length, 0));
  });
});
