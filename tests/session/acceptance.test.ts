import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv";
import {
  approve,
  commitStaged,
  decisionHistory,
  emptySession,
  exceptionsExport,
  isEmptySession,
  previewStaged,
  recordDecision,
  removeKind,
  reviewedRegisterExport,
  SessionError,
  setDeal,
  setSkipInvalidRows,
  setStagedMapping,
  stageFile,
  unstageFile,
  viewOf,
  type SessionState,
} from "@/session/engine";
import { isSampleSession, stageSampleCorrections, startSampleSession } from "@/session/sample";
import { ALLOCATIONS_HEADER, csvOf, fixture, FUNDING_HEADER, SUBSCRIPTIONS_HEADER } from "../support/build";
import {
  acknowledge,
  BANK_PORTAL_MAPPING,
  confirm,
  decide,
  importDemoFiles,
  importFile,
  newDeal,
  NOTE,
  resolveConflicts,
  resolvedDemo,
  resolveDemoClose,
  rowOf,
} from "../support/session";

const encoder = new TextEncoder();

function refusal(run: () => unknown): SessionError {
  try {
    run();
  } catch (error) {
    if (error instanceof SessionError) return error;
    throw error;
  }
  throw new Error("Expected the session to refuse");
}

describe("1. The sample deal reconciles end to end in memory", () => {
  it("adds the three sample files, works the exceptions, confirms and exports", () => {
    const imported = importDemoFiles(newDeal());
    expect(imported.subscriptions.counts).toMatchObject({ rowCount: 50, validCount: 50, invalidCount: 0, newCount: 50 });
    expect(imported.allocations.counts).toMatchObject({ rowCount: 48, validCount: 48, newCount: 48 });
    // 63 funding rows: one has no settlement date (invalid) and one is an exact repeat (counted once).
    expect(imported.funding.counts).toMatchObject({ rowCount: 63, validCount: 62, invalidCount: 1, newCount: 61, duplicateCount: 1 });
    expect(imported.funding.preview.validation?.invalidRows[0]?.errors).toEqual(["Settled at is required for cleared transactions"]);

    const before = viewOf(imported.state);
    expect(before.result.summary.counts).toEqual({ total: 52, ready: 39, needsReview: 6, blocked: 7 });
    expect(before.result.summary).toMatchObject({
      signedCommitments: "5090000.00",
      netClearedFunding: "4750000.00",
      approvedAllocations: "5000000.00",
    });

    const resolved = resolveDemoClose(imported.state);
    const after = viewOf(resolved);
    expect(after.result.summary.counts).toMatchObject({ needsReview: 0, blocked: 0 });
    expect(after.result.summary).toMatchObject({ registerAmount: "5000000.00", registerLineCount: 47 });
    expect(after.canApprove).toBe(true);

    const approved = confirm(resolved);
    expect(viewOf(approved).approved).toBe(true);
    const register = reviewedRegisterExport(approved);
    expect(register.filename).toBe("riverbend-flats-apartments-reviewed-ownership-register.csv");
    expect(parseCsv(register.content).rows).toHaveLength(47);
    expect(exceptionsExport(approved).filename).toBe("riverbend-flats-apartments-exceptions-report.csv");
  });

  it("starts the sample session with three previews and nothing in the workspace until they are added", () => {
    let state = startSampleSession();
    expect(isSampleSession(state)).toBe(true);
    expect(viewOf(state).result.rows).toHaveLength(0);
    expect(previewStaged(state, "subscriptions")?.validation?.counts).toMatchObject({ rowCount: 50, validCount: 50 });
    expect(previewStaged(state, "funding")?.validation?.counts).toMatchObject({ rowCount: 63, invalidCount: 1 });
    expect(previewStaged(state, "funding")?.blockedBy).toBe("Confirm that the invalid row should be left out.");

    // The invalid row has to be acknowledged before anything is added, and nothing is added half-way.
    expect(refusal(() => commitStaged(state)).message).toContain("Funding");
    expect(viewOf(state).result.rows).toHaveLength(0);

    state = setSkipInvalidRows(state, "funding", true);
    state = commitStaged(state).state;
    expect(viewOf(state).result.summary.counts).toEqual({ total: 52, ready: 39, needsReview: 6, blocked: 7 });
    expect(Object.keys(state.staged)).toEqual([]);

    // The bank-portal corrections file needs its amount column mapped by hand.
    state = stageSampleCorrections(state);
    expect(previewStaged(state, "funding")?.mappingErrors).toEqual(['Choose the column that holds "Amount".']);
    state = setStagedMapping(state, "funding", { ...previewStaged(state, "funding")?.mapping, amount: "Credit Amount" });
    expect(previewStaged(state, "funding")?.validation?.counts).toMatchObject({ rowCount: 4, validCount: 4, newCount: 1, conflictCount: 3 });
    expect(previewStaged(state, "subscriptions")?.validation?.counts).toMatchObject({ conflictCount: 1 });
  });
});

describe("2. Funding is counted once and matched only on explicit references", () => {
  it("does not count a wire twice when the funding file is added again", () => {
    const { state } = importDemoFiles(newDeal());
    const first = viewOf(state);

    const again = importFile(state, "funding", "funding.csv", fixture("funding.csv"), { skipInvalidRows: true });
    expect(again.counts).toMatchObject({ newCount: 0, conflictCount: 0, unchangedCount: 61, duplicateCount: 1 });

    const second = viewOf(again.state);
    expect(second.result.summary).toEqual(first.result.summary);
    expect(second.fingerprint).toBe(first.fingerprint);
    // The exact repeat of ACH-20505 inside the file is also counted once.
    expect(rowOf(again.state, "SUB-1003::CLASS A").netCleared).toBe("50000.00");
    expect(again.state.records.filter((r) => r.kind === "funding")).toHaveLength(61);
  });

  it("sums split payments, nets linked reversals, and leaves an invalid reversal un-netted", () => {
    const { state } = importDemoFiles(newDeal());

    // Three cleared wires against one subscription.
    expect(rowOf(state, "SUB-1015::CLASS A")).toMatchObject({ netCleared: "250000.00", approvedAmount: "250000.00", status: "ready" });

    // 75,000 wired, returned, wired again: net 75,000 and no exception.
    const returned = rowOf(state, "SUB-1027::CLASS A");
    expect(returned.netCleared).toBe("75000.00");
    expect(returned.status).toBe("ready");
    expect(returned.funding.map((l) => [l.record.data.transaction_ref, l.treatment, l.effect])).toEqual([
      ["WIRE-20327A", "counted", "75000.00"],
      ["RTN-20327A", "reversal_applied", "-75000.00"],
      ["WIRE-20327B", "counted", "75000.00"],
    ]);

    // The reversal names an original that does not exist: it is flagged, not netted.
    const invalid = rowOf(state, "SUB-1031::CLASS B");
    expect(invalid.netCleared).toBe("120000.00");
    expect(invalid.status).toBe("blocked");
    expect(invalid.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(["INVALID_REVERSAL", "EXCESS_FUNDING"]));

    // A pending wire is not counted.
    expect(rowOf(state, "SUB-1023::CLASS B")).toMatchObject({ netCleared: "100000.00", pendingAmount: "50000.00", status: "blocked" });

    // Funding in another currency is not netted against a USD subscription.
    expect(rowOf(state, "SUB-1046::CLASS B")).toMatchObject({ netCleared: "0.00", status: "blocked" });
  });

  it("never auto-matches an ambiguous or unmapped reference; a reviewer links it explicitly", () => {
    let { state } = importDemoFiles(newDeal());

    // RVB-0441 is mapped to two subscriptions, so the 100,000 wire stays unattributed even
    // though its amount equals SUB-1041's commitment exactly.
    expect(rowOf(state, "FUNDING::WIRE-20341").exceptions[0]).toMatchObject({ code: "AMBIGUOUS_REFERENCE", state: "open" });
    expect(rowOf(state, "SUB-1041::CLASS A")).toMatchObject({ netCleared: "0.00", status: "blocked" });
    expect(rowOf(state, "FUNDING::WIRE-20338").exceptions[0]).toMatchObject({ code: "UNMATCHED_FUNDING", state: "open" });
    expect(viewOf(state).result.summary.unmatchedCleared).toBe("220000.00");

    // A uniquely mapped payment reference does match.
    expect(rowOf(state, "SUB-1007::CLASS A")).toMatchObject({ netCleared: "100000.00", status: "ready" });

    state = decide(state, { action: "link", rowKey: "FUNDING::WIRE-20341", transactionKey: "WIRE-20341", subscriptionId: "SUB-1041" });
    expect(rowOf(state, "SUB-1041::CLASS A")).toMatchObject({ netCleared: "100000.00", status: "ready" });
    expect(viewOf(state).result.rows.find((r) => r.key === "FUNDING::WIRE-20341")).toBeUndefined();
    const linked = rowOf(state, "SUB-1041::CLASS A");
    expect(linked.funding[0]).toMatchObject({ matchedBy: "reviewer_link", treatment: "counted" });
    expect(decisionHistory(linked, state)[0]).toMatchObject({ standing: "in_effect", decision: { action: "link" } });

    // A link to a subscription that does not exist is refused.
    const bad = refusal(() =>
      decide(state, { action: "link", rowKey: "FUNDING::WIRE-20338", transactionKey: "WIRE-20338", subscriptionId: "SUB-9999" }),
    );
    expect(bad.code).toBe("validation");
  });

  it("shows the 10,000 variance and registers only the approved 90,000", () => {
    let { state } = importDemoFiles(newDeal());

    const row = rowOf(state, "SUB-1012::CLASS A");
    expect(row).toMatchObject({
      investorRef: "INV-0412",
      requestedAmount: "100000.00",
      netCleared: "100000.00",
      approvedAmount: "90000.00",
      approvedUnits: "90",
      variance: "10000.00",
      status: "needs_review",
    });
    expect(row.funding.map((l) => l.record.data.amount)).toEqual(["60000.00", "40000.00"]);
    expect(row.exceptions).toHaveLength(1);
    expect(row.exceptions[0]).toMatchObject({ code: "EXCESS_FUNDING", severity: "review", variance: "10000.00" });
    expect(row.exceptions[0]?.message).toContain("$10,000.00");
    // Each figure traces to a file and row.
    expect(row.subscription?.source).toMatchObject({ filename: "subscriptions.csv", rowNumber: 13 });
    expect(row.allocation?.source.filename).toBe("allocations.csv");
    expect(row.funding[0]?.record.source.filename).toBe("funding.csv");
    // Until it is reviewed, the row is not part of the register.
    expect(row.inRegister).toBe(false);

    state = acknowledge(state, "SUB-1012::CLASS A", "EXCESS_FUNDING");
    const after = rowOf(state, "SUB-1012::CLASS A");
    expect(after.status).toBe("ready");
    expect(after.inRegister).toBe(true);
    expect(after.exceptions[0]).toMatchObject({ state: "documented" });
    // The decision documents the variance; it does not alter any figure.
    expect(after).toMatchObject({ netCleared: "100000.00", approvedAmount: "90000.00", approvedUnits: "90", variance: "10000.00" });
    expect(decisionHistory(after, state)[0]).toMatchObject({ standing: "in_effect", decision: { action: "acknowledge" } });
    expect(viewOf(state).result.register.find((l) => l.subscriptionId === "SUB-1012")).toEqual({
      investorRef: "INV-0412",
      shareClass: "Class A",
      subscriptionId: "SUB-1012",
      approvedAmount: "90000.00",
      approvedUnits: "90",
      currency: "USD",
    });
  });

  it("sends a changed record with the same reference to review instead of overwriting it", () => {
    let { state } = importDemoFiles(newDeal());

    // The same transaction reference arrives again with a different amount.
    const changed = csvOf(FUNDING_HEADER, ["WIRE-20503,SUB-1002,,175000.00,USD,cleared,2026-11-05,"]);
    const result = importFile(state, "funding", "funding-resend.csv", changed);
    expect(result.counts).toMatchObject({ newCount: 0, conflictCount: 1 });
    expect(result.preview.validation?.conflicts[0]?.changes).toEqual([{ field: "Amount", existing: "100000.00", incoming: "175000.00" }]);
    state = result.state;

    let row = rowOf(state, "SUB-1002::CLASS A");
    expect(row.netCleared).toBe("100000.00");
    expect(row.status).toBe("needs_review");
    const conflict = row.exceptions.find((e) => e.code === "SOURCE_CONFLICT");
    expect(conflict?.state).toBe("open");

    // Adding the conflicting file again does not create a second conflict.
    const repeat = importFile(state, "funding", "funding-resend.csv", changed);
    expect(repeat.counts).toMatchObject({ newCount: 0, conflictCount: 0, unchangedCount: 1 });
    state = repeat.state;

    state = decide(state, { action: "keep_existing", rowKey: "SUB-1002::CLASS A", exceptionId: conflict?.id });
    row = rowOf(state, "SUB-1002::CLASS A");
    expect(row).toMatchObject({ netCleared: "100000.00", status: "ready" });

    // Both versions are still held; the original was never modified.
    const versions = state.records
      .filter((r) => r.kind === "funding" && r.key === "WIRE-20503")
      .map((r) => ({ state: r.state, amount: (r.data as { amount: string }).amount }));
    expect(versions).toEqual([
      { state: "active", amount: "100000.00" },
      { state: "rejected", amount: "175000.00" },
    ]);

    // Revoking the decision puts the conflict back in front of the reviewer.
    const keep = state.decisions.at(-1);
    state = decide(state, { action: "revoke", rowKey: "SUB-1002::CLASS A", decisionId: keep?.id });
    expect(rowOf(state, "SUB-1002::CLASS A").status).toBe("needs_review");
  });
});

describe("3. The reviewed register is blocked until every exception is dealt with", () => {
  it("refuses confirmation and the register export while blockers remain, but allows the exceptions report", () => {
    const { state } = importDemoFiles(newDeal());
    const view = viewOf(state);
    expect(view.canApprove).toBe(false);
    expect(view.openBlockers).toBe(8);
    expect(view.reasons).toEqual(["8 blockers need corrected source data.", "8 exceptions still need a review decision."]);

    const refused = refusal(() => approve(state, { expectedFingerprint: view.fingerprint }));
    expect(refused.code).toBe("conflict");
    expect(refused.reasons).toEqual(view.reasons);
    expect(refusal(() => reviewedRegisterExport(state)).reasons).toEqual(view.reasons);

    const draft = exceptionsExport(state);
    expect(draft.filename).toBe("riverbend-flats-apartments-exceptions-report-DRAFT.csv");
    const report = parseCsv(draft.content);
    expect(report.rows.filter((r) => r.cells.state === "open" && r.cells.severity === "blocker")).toHaveLength(8);
  });

  it("still refuses when only review items are left, and when a file is missing", () => {
    let state = resolvedDemo();
    // Undo one documented variance: no blocker remains, but the row needs review again.
    const documented = state.decisions.find((d) => d.action === "acknowledge" && d.payload.rowKey === "SUB-1012::CLASS A");
    state = decide(state, { action: "revoke", rowKey: "SUB-1012::CLASS A", decisionId: documented?.id });
    expect(viewOf(state)).toMatchObject({ openBlockers: 0, openReviews: 1, canApprove: false });
    expect(refusal(() => confirm(state)).reasons).toEqual(["1 exception still needs a review decision."]);

    const partial = importFile(newDeal(), "subscriptions", "subscriptions.csv", fixture("subscriptions.csv")).state;
    expect(viewOf(partial).reasons[0]).toBe("Add the funding, approved allocations files.");
    expect(refusal(() => confirm(partial)).code).toBe("conflict");
  });

  it("does not let a review note clear an unsigned or unfunded allocation", () => {
    const { state } = importDemoFiles(newDeal());
    for (const [rowKey, code] of [
      ["SUB-1019::CLASS A", "UNSIGNED_WITH_ALLOCATION"],
      ["SUB-1036::CLASS A", "UNFUNDED_ALLOCATION"],
      ["SUB-1023::CLASS B", "PARTIAL_FUNDING"],
    ] as const) {
      const blocker = rowOf(state, rowKey).exceptions.find((e) => e.code === code);
      const attempt = refusal(() =>
        recordDecision(state, {
          action: "acknowledge",
          rowKey,
          exceptionId: blocker?.id,
          note: "Sponsor confirmed by phone that this is fine, please treat as valid.",
        }),
      );
      expect(attempt.code).toBe("validation");
      expect(attempt.message).toBe("A note cannot clear this blocker. Select a corrected source file.");
    }
    expect(refusal(() => decide(state, { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503", note: "short" })).message).toContain(
      "at least 10 characters",
    );
  });

  it("refuses confirmation when the data changed after the summary was opened", () => {
    const resolved = resolvedDemo();
    const stale = viewOf(resolved).fingerprint;
    const changed = decide(resolved, { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503" });
    expect(refusal(() => approve(changed, { expectedFingerprint: stale })).code).toBe("conflict");
  });

  it("never lets a decision or a newer funding file change the sponsor's approved amount or units", () => {
    const allocations = new Map(parseCsv(fixture("allocations.csv")).rows.map((r) => [r.cells.subscription_id, r.cells]));
    const resolved = resolvedDemo();
    const register = viewOf(resolved).result.register;
    expect(register).toHaveLength(47);
    for (const line of register) {
      const source = allocations.get(line.subscriptionId);
      expect(line.approvedAmount, line.subscriptionId).toBe(source?.approved_amount);
      expect(new Decimal(line.approvedUnits).equals(source?.approved_units ?? "NaN"), line.subscriptionId).toBe(true);
    }

    // A different approved amount for the same subscription is a conflict to review, not an overwrite.
    const late = importFile(resolved, "allocations", "allocations-late.csv", csvOf(ALLOCATIONS_HEADER, ["SUB-1012,Class A,100000.00,100,USD"]));
    expect(late.counts).toMatchObject({ newCount: 0, conflictCount: 1 });
    expect(rowOf(late.state, "SUB-1012::CLASS A")).toMatchObject({ approvedAmount: "90000.00", approvedUnits: "90", status: "needs_review" });
  });
});

describe("4. Any change discards the confirmation", () => {
  const approved = () => confirm(resolvedDemo());

  const invalidates = (label: string, change: (state: SessionState) => SessionState) =>
    it(`discards it when ${label}`, () => {
      const before = approved();
      const registerBefore = reviewedRegisterExport(before).content;
      expect(registerBefore).toContain("INV-0412,Class A,SUB-1012,90000.00,90,USD");

      const after = change(before);
      expect(after.approval).toBeNull();
      expect(after.voidedApproval?.approvedAt).toBe(before.approval?.approvedAt);
      expect(viewOf(after).approved).toBe(false);
      expect(refusal(() => reviewedRegisterExport(after)).code).toBe("conflict");
      // The exceptions report is still available, marked as a draft again.
      expect(exceptionsExport(after).filename).toMatch(/DRAFT\.csv$/);
      // The confirmed session itself was not mutated.
      expect(reviewedRegisterExport(before).content).toBe(registerBefore);
    });

  const late = csvOf(FUNDING_HEADER, ["WIRE-29001,SUB-1010,,5000.00,USD,cleared,2026-11-12,"]);

  invalidates("a file is selected", (s) => stageFile(s, "funding", { filename: "funding-late.csv", bytes: encoder.encode(late) }));
  invalidates("a file is added", (s) => importFile(s, "funding", "funding-late.csv", late).state);
  invalidates("the same file is added again", (s) => importFile(s, "allocations", "allocations.csv", fixture("allocations.csv")).state);
  invalidates("a column mapping is changed", (s) =>
    setStagedMapping(stageFile(s, "funding", { filename: "funding-late.csv", bytes: encoder.encode(late) }), "funding", BANK_PORTAL_MAPPING),
  );
  invalidates("a decision is recorded", (s) => decide(s, { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503" }));
  invalidates("a decision is revoked", (s) => {
    const documented = s.decisions.find((d) => d.action === "acknowledge" && d.payload.rowKey === "SUB-1012::CLASS A");
    return decide(s, { action: "revoke", rowKey: "SUB-1012::CLASS A", decisionId: documented?.id });
  });
  invalidates("a file's records are removed", (s) => removeKind(s, "funding"));
  invalidates("the deal currency is changed", (s) => setDeal(s, { currency: "CAD" }));

  it("keeps the confirmation when nothing changes, and refuses to confirm twice", () => {
    const state = approved();
    expect(unstageFile(state, "funding")).toBe(state);
    expect(setDeal(state, { currency: "usd" })).toBe(state);
    expect(refusal(() => confirm(state)).message).toBe("This snapshot is already confirmed.");
  });

  it("freezes a new export only after the new exceptions are worked", () => {
    let state = approved();
    const first = reviewedRegisterExport(state).content;
    expect(first).toContain("INV-0402,Class A,SUB-1002,100000.00,100,USD");

    // New source data arrives: a smaller allocation for SUB-1002 and a late wire.
    state = importFile(state, "allocations", "allocations-late.csv", csvOf(ALLOCATIONS_HEADER, ["SUB-1002,Class A,60000.00,60,USD"])).state;
    state = importFile(state, "funding", "funding-late.csv", late).state;
    state = resolveConflicts(state, "SUB-1002::CLASS A", "accept_incoming");
    expect(rowOf(state, "SUB-1002::CLASS A").approvedAmount).toBe("60000.00");
    expect(viewOf(state).canApprove).toBe(false);
    expect(refusal(() => reviewedRegisterExport(state)).code).toBe("conflict");

    state = acknowledge(state, "SUB-1002::CLASS A", "EXCESS_FUNDING");
    state = acknowledge(state, "SUB-1010::CLASS A", "EXCESS_FUNDING");
    state = confirm(state);
    const second = reviewedRegisterExport(state).content;
    expect(second).toContain("INV-0402,Class A,SUB-1002,60000.00,60,USD");
    expect(second).not.toBe(first);
    expect(state.voidedApproval).toBeNull();
  });

  it("removing a file's records leaves the rest of the workspace usable", () => {
    let state = removeKind(resolvedDemo(), "funding");
    expect(state.records.some((r) => r.kind === "funding")).toBe(false);
    expect(state.decisions.some((d) => d.subjectKind === "funding")).toBe(false);
    expect(viewOf(state).missingFiles).toEqual(["funding"]);
    expect(viewOf(state).result.summary.netClearedFunding).toBe("0.00");

    state = importFile(state, "funding", "funding.csv", fixture("funding.csv"), { skipInvalidRows: true }).state;
    expect(viewOf(state).result.summary.netClearedFunding).toBe("4750000.00");
  });
});

describe("5. The exported register matches the known-good fixture", () => {
  it("agrees by investor and share class, including units and totals", () => {
    const exported = parseCsv(reviewedRegisterExport(confirm(resolvedDemo())).content);
    const expected = parseCsv(fixture("expected/ownership-register.csv"));
    expect(exported.headers).toEqual(["investor_ref", "share_class", "subscription_id", "approved_amount", "approved_units", "currency"]);

    const group = (rows: typeof exported.rows) => {
      const totals = new Map<string, { amount: Decimal; units: Decimal }>();
      for (const { cells } of rows) {
        const key = `${cells.investor_ref}|${cells.share_class}`;
        const entry = totals.get(key) ?? { amount: new Decimal(0), units: new Decimal(0) };
        entry.amount = entry.amount.plus(cells.approved_amount ?? "0");
        entry.units = entry.units.plus(cells.approved_units ?? "0");
        totals.set(key, entry);
      }
      return Object.fromEntries([...totals.entries()].sort().map(([k, v]) => [k, `${v.amount.toFixed(2)} / ${v.units.toFixed()}`]));
    };
    expect(group(exported.rows)).toEqual(group(expected.rows));
    // Line for line as well, not only in aggregate.
    expect(exported.rows.map((r) => r.cells)).toEqual(expected.rows.map((r) => r.cells));

    // An investor with two subscriptions in one class holds the sum of both.
    expect(group(exported.rows)["INV-0405|Class A"]).toBe("130000.00 / 130");
    // The guided case is registered at the approved 90,000, not the 100,000 funded.
    expect(group(exported.rows)["INV-0412|Class A"]).toBe("90000.00 / 90");
    // Not in the register: no allocation, never signed, declined.
    for (const absent of ["INV-0444", "INV-0448", "INV-0450"]) {
      expect(exported.rows.some((r) => r.cells.investor_ref === absent)).toBe(false);
    }

    const summary = JSON.parse(fixture("expected/summary.json")) as {
      registerLines: number;
      approvedAmount: string;
      byShareClass: Record<string, { lines: number; approvedAmount: string; approvedUnits: string }>;
    };
    const sum = (rows: typeof exported.rows, field: string) => rows.reduce((total, r) => total.plus(r.cells[field] ?? "0"), new Decimal(0));
    expect(exported.rows).toHaveLength(summary.registerLines);
    expect(sum(exported.rows, "approved_amount").toFixed(2)).toBe(summary.approvedAmount);
    expect(summary.approvedAmount).toBe("5000000.00");
    for (const [shareClass, totals] of Object.entries(summary.byShareClass)) {
      const lines = exported.rows.filter((r) => r.cells.share_class === shareClass);
      expect(lines).toHaveLength(totals.lines);
      expect(sum(lines, "approved_amount").toFixed(2)).toBe(totals.approvedAmount);
      expect(sum(lines, "approved_units").toFixed()).toBe(totals.approvedUnits);
    }
  });

  it("is byte for byte the known-good file, apart from spreadsheet line endings", () => {
    const content = reviewedRegisterExport(confirm(resolvedDemo())).content;
    expect(content.replace(/\r\n/g, "\n")).toBe(fixture("expected/ownership-register.csv"));
  });

  it("produces an exceptions report with every exception and the decision behind it", () => {
    const report = parseCsv(exceptionsExport(confirm(resolvedDemo())).content);
    const variance = report.rows.find((r) => r.cells.subscription_id === "SUB-1012");
    expect(variance?.cells).toMatchObject({
      exception_code: "EXCESS_FUNDING",
      state: "documented",
      net_cleared_amount: "100000.00",
      approved_amount: "90000.00",
      variance_amount: "10000.00",
      decision: "acknowledge",
      decision_note: NOTE,
    });
    expect(report.rows.every((r) => r.cells.state !== "open")).toBe(true);
    expect(report.rows.map((r) => r.cells.exception_code)).toEqual(
      expect.arrayContaining(["EXCESS_FUNDING", "MISSING_ALLOCATION", "UNSIGNED_NO_ALLOCATION", "EXCLUDED_FUNDING", "UNMATCHED_FUNDING", "AMBIGUOUS_REFERENCE"]),
    );
  });

  it("neutralises spreadsheet formulas that arrive in a source file", () => {
    let state = newDeal("=cmd|' /C calc'!A0");
    state = importFile(state, "subscriptions", "s.csv", csvOf(SUBSCRIPTIONS_HEADER, ['SUB-1,"=HYPERLINK(""http://evil.example"")",Class A,1000.00,USD,signed,'])).state;
    state = importFile(state, "funding", "f.csv", csvOf(FUNDING_HEADER, ["W-1,SUB-1,,1000.00,USD,cleared,2026-11-01,"])).state;
    state = importFile(state, "allocations", "a.csv", csvOf(ALLOCATIONS_HEADER, ["SUB-1,Class A,1000.00,1,USD"])).state;
    const file = reviewedRegisterExport(confirm(state));
    expect(file.content).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(file.content).not.toMatch(/(^|,)=/m);
    expect(file.filename).toBe("cmd-c-calc-a0-reviewed-ownership-register.csv");
  });
});

describe("6. A session holds nothing once it is cleared", () => {
  it("starts empty and is empty again after Clear session", () => {
    expect(isEmptySession(emptySession())).toBe(true);
    const worked = confirm(resolvedDemo());
    expect(isEmptySession(worked)).toBe(false);

    const cleared = emptySession();
    expect(cleared).toEqual({
      nextSeq: 1,
      dealName: "",
      currency: "USD",
      staged: {},
      batches: [],
      records: [],
      decisions: [],
      approval: null,
      voidedApproval: null,
    });
    expect(viewOf(cleared).result.rows).toHaveLength(0);
    expect(refusal(() => reviewedRegisterExport(cleared)).code).toBe("conflict");
  });

  it("rejects files it cannot read, without changing the session", () => {
    const state = newDeal();
    expect(refusal(() => stageFile(state, "funding", { filename: "funding.xlsx", bytes: encoder.encode("a,b\n1,2\n") })).message).toBe(
      "Select a .csv file. Export spreadsheets as CSV (UTF-8) first.",
    );
    expect(refusal(() => stageFile(state, "funding", { filename: "funding.csv", bytes: new Uint8Array() })).message).toBe("That file is empty.");
    expect(refusal(() => stageFile(state, "wires", { filename: "funding.csv", bytes: encoder.encode("a\n1\n") })).message).toBe("Unknown file type.");
    expect(refusal(() => setDeal(state, { currency: "dollars" })).code).toBe("validation");
  });
});
