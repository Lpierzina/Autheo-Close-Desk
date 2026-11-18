import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv";
import { call, signInAs, setupDatabase } from "../support/app";
import { ALLOCATIONS_HEADER, csvOf, fixture, FUNDING_HEADER } from "../support/build";
import {
  acknowledge,
  ADMIN,
  approve,
  APPROVER,
  bootstrapWorkspace,
  decide,
  download,
  getClose,
  getRecon,
  getRow,
  importDemoFiles,
  importFile,
  OUTSIDER,
  previewFile,
  resolveDemoClose,
  REVIEWER,
  routes,
} from "../support/driver";

setupDatabase();

const rowOf = <T extends { key: string }>(rows: T[], key: string): T => {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`Row ${key} not found`);
  return row;
};

describe("1. An invited user reconciles an offering end to end", () => {
  it("imports the three sample files, works the exceptions, approves and exports", async () => {
    const { offeringId } = await bootstrapWorkspace();

    signInAs(REVIEWER);
    const imported = await importDemoFiles(offeringId);
    expect(imported.subscriptions.counts).toMatchObject({ rowCount: 50, validCount: 50, invalidCount: 0, newCount: 50 });
    expect(imported.allocations.counts).toMatchObject({ rowCount: 48, validCount: 48, newCount: 48 });
    // 63 funding rows: one has no settlement date (invalid) and one is an exact repeat (counted once).
    expect(imported.funding.counts).toMatchObject({ rowCount: 63, validCount: 62, invalidCount: 1, newCount: 61, duplicateCount: 1 });
    expect(imported.funding.preview.validation?.invalidRows[0]?.errors).toEqual(["Settled at is required for cleared transactions"]);

    const before = await getRecon(offeringId);
    expect(before.summary.counts).toEqual({ total: 52, ready: 39, needsReview: 6, blocked: 7 });
    expect(before.summary).toMatchObject({
      signedCommitments: "5090000.00",
      netClearedFunding: "4750000.00",
      approvedAllocations: "5000000.00",
    });

    await resolveDemoClose(offeringId);
    const after = await getRecon(offeringId);
    expect(after.summary.counts).toMatchObject({ needsReview: 0, blocked: 0 });
    expect(after.summary).toMatchObject({ registerAmount: "5000000.00", registerLineCount: 47 });

    signInAs(APPROVER);
    const close = await getClose(offeringId);
    expect(close.canApprove).toBe(true);
    const approved = await approve(offeringId, close.readiness.fingerprint);
    expect(approved.status, approved.text).toBe(201);
    expect(approved.body.snapshot).toMatchObject({ version: 1, approvedByEmail: APPROVER });

    const register = await download(offeringId, 1, "register.csv");
    expect(register.status).toBe(200);
    expect(register.headers.get("content-type")).toContain("text/csv");
    expect(register.headers.get("content-disposition")).toContain("riverbend-flats-apartments-ownership-register-v1.csv");
    expect(parseCsv(register.text).rows).toHaveLength(47);
  });

  it("gives nothing to a visitor without a session, or with a session but no invitation", async () => {
    const { offeringId } = await bootstrapWorkspace();
    const r = await routes();

    signInAs(null);
    expect((await call(r.offerings.GET, "GET")).status).toBe(401);
    expect((await call(r.reconciliation.GET, "GET", { params: { offeringId } })).status).toBe(401);

    // Signed in with the identity provider, but never invited to Close Desk.
    signInAs("stranger@elsewhere.example");
    const listed = await call<{ error: { code: string } }>(r.offerings.GET, "GET");
    expect(listed.status).toBe(403);
    expect(listed.body.error.code).toBe("not_invited");
    expect((await download(offeringId, 1, "register.csv")).status).toBe(403);

    // An invitation is only honoured for an email the provider has verified.
    const { inviteUser } = await import("@/server/services/users");
    await inviteUser(null, { email: "pending.person@closedesk.example" });
    signInAs("pending.person@closedesk.example", { verified: false });
    expect((await call(r.offerings.GET, "GET")).status).toBe(403);
    signInAs("pending.person@closedesk.example");
    expect((await call(r.offerings.GET, "GET")).status).toBe(200);
  });
});

describe("2. Funding is counted once and matched only on explicit references", () => {
  it("does not count a wire twice when the funding file is imported again", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    const first = await getRecon(offeringId);

    const again = await importFile(offeringId, "funding", "funding.csv", fixture("funding.csv"), { skipInvalidRows: true });
    expect(again.counts).toMatchObject({ newCount: 0, conflictCount: 0, unchangedCount: 61, duplicateCount: 1 });

    const second = await getRecon(offeringId);
    expect(second.summary).toEqual(first.summary);
    expect(second.fingerprint).toBe(first.fingerprint);
    // The exact repeat of ACH-20505 inside the file is also counted once.
    expect(rowOf(second.rows, "SUB-1003::CLASS A").netCleared).toBe("50000.00");

    const { query } = await import("@/server/db");
    const stored = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM source_records WHERE offering_id = $1 AND kind = 'funding'",
      [offeringId],
    );
    expect(stored[0]?.n).toBe(61);
  });

  it("sums split payments, nets linked reversals, and leaves an invalid reversal un-netted", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    const { rows } = await getRecon(offeringId);

    // Three cleared wires against one subscription.
    expect(rowOf(rows, "SUB-1015::CLASS A")).toMatchObject({ netCleared: "250000.00", approvedAmount: "250000.00", status: "ready" });

    // 75,000 wired, returned, wired again: net 75,000 and no exception.
    const returned = await getRow(offeringId, "SUB-1027::CLASS A");
    expect(returned.row.netCleared).toBe("75000.00");
    expect(returned.row.status).toBe("ready");
    expect(returned.row.funding.map((l) => [l.record.data.transaction_ref, l.treatment, l.effect])).toEqual([
      ["WIRE-20327A", "counted", "75000.00"],
      ["RTN-20327A", "reversal_applied", "-75000.00"],
      ["WIRE-20327B", "counted", "75000.00"],
    ]);

    // The reversal names an original that does not exist: it is flagged, not netted.
    const invalid = await getRow(offeringId, "SUB-1031::CLASS B");
    expect(invalid.row.netCleared).toBe("120000.00");
    expect(invalid.row.status).toBe("blocked");
    expect(invalid.row.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(["INVALID_REVERSAL", "EXCESS_FUNDING"]));

    // A pending wire is not counted.
    expect(rowOf(rows, "SUB-1023::CLASS B")).toMatchObject({ netCleared: "100000.00", pendingAmount: "50000.00", status: "blocked" });

    // Funding in another currency is not netted against a USD subscription.
    expect(rowOf(rows, "SUB-1046::CLASS B")).toMatchObject({ netCleared: "0.00", status: "blocked" });
  });

  it("never auto-matches an ambiguous or unmapped reference; a reviewer links it explicitly", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    let recon = await getRecon(offeringId);

    // RVB-0441 is mapped to two subscriptions, so the 100,000 wire stays unattributed even
    // though its amount equals SUB-1041's commitment exactly.
    expect(rowOf(recon.rows, "FUNDING::WIRE-20341").exceptions[0]).toMatchObject({ code: "AMBIGUOUS_REFERENCE", state: "open" });
    expect(rowOf(recon.rows, "SUB-1041::CLASS A")).toMatchObject({ netCleared: "0.00", status: "blocked" });
    expect(rowOf(recon.rows, "FUNDING::WIRE-20338").exceptions[0]).toMatchObject({ code: "UNMATCHED_FUNDING", state: "open" });
    expect(recon.summary.unmatchedCleared).toBe("220000.00");

    // A uniquely mapped payment reference does match.
    expect(rowOf(recon.rows, "SUB-1007::CLASS A")).toMatchObject({ netCleared: "100000.00", status: "ready" });

    const linked = await decide(offeringId, {
      action: "link",
      rowKey: "FUNDING::WIRE-20341",
      transactionKey: "WIRE-20341",
      subscriptionId: "SUB-1041",
    });
    expect(linked.status).toBe(201);
    recon = await getRecon(offeringId);
    expect(rowOf(recon.rows, "SUB-1041::CLASS A")).toMatchObject({ netCleared: "100000.00", status: "ready" });
    expect(recon.rows.find((r) => r.key === "FUNDING::WIRE-20341")).toBeUndefined();
    const detail = await getRow(offeringId, "SUB-1041::CLASS A");
    expect(detail.row.funding[0]).toMatchObject({ matchedBy: "reviewer_link", treatment: "counted" });
    expect(detail.history[0]?.decision).toMatchObject({ action: "link", decidedBy: { email: REVIEWER } });

    // A link to a subscription that does not exist is refused.
    const bad = await decide(offeringId, {
      action: "link",
      rowKey: "FUNDING::WIRE-20338",
      transactionKey: "WIRE-20338",
      subscriptionId: "SUB-9999",
    });
    expect(bad.status).toBe(422);
  });

  it("shows the 10,000 variance and registers only the approved 90,000", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);

    const { row } = await getRow(offeringId, "SUB-1012::CLASS A");
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
    // Each figure traces to a file and row.
    expect(row.subscription?.source).toMatchObject({ filename: "subscriptions.csv", rowNumber: 13 });
    expect(row.allocation?.source.filename).toBe("allocations.csv");
    expect(row.funding[0]?.record.source.filename).toBe("funding.csv");

    await acknowledge(offeringId, "SUB-1012::CLASS A", "EXCESS_FUNDING");
    const after = await getRow(offeringId, "SUB-1012::CLASS A");
    expect(after.row.status).toBe("ready");
    expect(after.row.inRegister).toBe(true);
    expect(after.row.exceptions[0]).toMatchObject({ state: "documented" });
    // The decision documents the variance; it does not alter any figure.
    expect(after.row).toMatchObject({ netCleared: "100000.00", approvedAmount: "90000.00", variance: "10000.00" });
    expect(after.history[0]).toMatchObject({ standing: "in_effect", decision: { action: "acknowledge" } });
  });

  it("sends a changed record with the same reference to review instead of overwriting it", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);

    // The same transaction reference arrives again with a different amount.
    const changed = csvOf(FUNDING_HEADER, ["WIRE-20503,SUB-1002,,175000.00,USD,cleared,2026-11-05,"]);
    const result = await importFile(offeringId, "funding", "funding-resend.csv", changed);
    expect(result.counts).toMatchObject({ newCount: 0, conflictCount: 1 });
    expect(result.preview.validation?.conflicts[0]?.changes).toEqual([
      { field: "Amount", existing: "100000.00", incoming: "175000.00" },
    ]);

    let detail = await getRow(offeringId, "SUB-1002::CLASS A");
    expect(detail.row.netCleared).toBe("100000.00");
    expect(detail.row.status).toBe("needs_review");
    const conflict = detail.row.exceptions.find((e) => e.code === "SOURCE_CONFLICT");
    expect(conflict?.state).toBe("open");

    // Importing the conflicting file again does not create a second conflict.
    const repeat = await importFile(offeringId, "funding", "funding-resend.csv", changed);
    expect(repeat.counts).toMatchObject({ newCount: 0, conflictCount: 0, unchangedCount: 1 });

    const kept = await decide(offeringId, { action: "keep_existing", rowKey: "SUB-1002::CLASS A", exceptionId: conflict?.id });
    expect(kept.status).toBe(201);
    detail = await getRow(offeringId, "SUB-1002::CLASS A");
    expect(detail.row).toMatchObject({ netCleared: "100000.00", status: "ready" });

    // Both versions are still stored; the original was never modified.
    const { query } = await import("@/server/db");
    const versions = await query<{ state: string; amount: string }>(
      `SELECT state, data->>'amount' AS amount FROM source_records
        WHERE offering_id = $1 AND kind = 'funding' AND record_key = 'WIRE-20503' ORDER BY created_at`,
      [offeringId],
    );
    expect(versions).toEqual([
      { state: "active", amount: "100000.00" },
      { state: "rejected", amount: "175000.00" },
    ]);
  });
});

describe("3. Approval is enforced on the server and snapshots are frozen", () => {
  it("refuses approval while blockers or unreviewed exceptions remain", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);

    signInAs(APPROVER);
    const close = await getClose(offeringId);
    expect(close.canApprove).toBe(false);
    expect(close.readiness.openItems.filter((i) => i.severity === "blocker")).toHaveLength(8);
    const refused = await approve(offeringId, close.readiness.fingerprint);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details.reasons).toEqual([
      "8 blockers need corrected source data.",
      "8 exceptions still need a reviewer decision.",
    ]);

    const { query } = await import("@/server/db");
    expect(await query("SELECT id FROM snapshots")).toHaveLength(0);
    expect((await download(offeringId, 1, "register.csv")).status).toBe(404);
  });

  it("does not let a reviewer note clear an unsigned or unfunded allocation", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);

    for (const [rowKey, code] of [
      ["SUB-1019::CLASS A", "UNSIGNED_WITH_ALLOCATION"],
      ["SUB-1036::CLASS A", "UNFUNDED_ALLOCATION"],
      ["SUB-1023::CLASS B", "PARTIAL_FUNDING"],
    ] as const) {
      const { row } = await getRow(offeringId, rowKey);
      const blocker = row.exceptions.find((e) => e.code === code);
      const attempt = await decide(offeringId, {
        action: "acknowledge",
        rowKey,
        exceptionId: blocker?.id,
        note: "Sponsor confirmed by phone that this is fine, please treat as valid.",
      });
      expect(attempt.status).toBe(422);
      expect((await getRow(offeringId, rowKey)).row.status).toBe("blocked");
    }
  });

  it("separates reviewer and approver permissions", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    const { fingerprint } = await getRecon(offeringId);

    // A reviewer cannot approve, even with everything resolved.
    signInAs(REVIEWER);
    expect((await approve(offeringId, fingerprint)).status).toBe(403);
    // A workspace administrator who is not the approver cannot approve either.
    signInAs(ADMIN);
    expect((await approve(offeringId, fingerprint)).status).toBe(403);

    // An approver cannot import files or record reviewer decisions.
    signInAs(APPROVER);
    expect((await previewFile(offeringId, "funding", "funding.csv", fixture("funding.csv"))).status).toBe(403);
    const decision = await decide(offeringId, { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503" });
    expect(decision.status).toBe(403);

    expect((await approve(offeringId, fingerprint)).status).toBe(201);
  });

  it("refuses approval when the data changed after the approver opened the summary", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    const stale = (await getRecon(offeringId)).fingerprint;

    await decide(offeringId, { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503" });

    signInAs(APPROVER);
    const refused = await approve(offeringId, stale);
    expect(refused.status).toBe(409);
  });

  it("hides one offering from a user who belongs to another", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    signInAs(APPROVER);
    expect((await approve(offeringId, (await getRecon(offeringId)).fingerprint)).status).toBe(201);

    // The outsider is an invited user and a reviewer on a different offering.
    const r = await routes();
    signInAs(ADMIN);
    const other = await call<{ offering: { id: string } }>(r.offerings.POST, "POST", {
      json: { name: "Harbor Point Lofts", currency: "USD", addCreatorAsReviewer: false },
    });
    await call(r.members.POST, "POST", { params: { offeringId: other.body.offering.id }, json: { email: OUTSIDER, role: "reviewer" } });

    signInAs(OUTSIDER);
    const listed = await call<{ offerings: { id: string }[] }>(r.offerings.GET, "GET");
    expect(listed.body.offerings.map((o) => o.id)).toEqual([other.body.offering.id]);

    const params = { offeringId };
    const file = { filename: "funding.csv", content: fixture("funding.csv") };
    const attempts = await Promise.all([
      call(r.reconciliation.GET, "GET", { params }),
      call(r.row.GET, "GET", { params, search: { key: "SUB-1012::CLASS A" } }),
      call(r.close.GET, "GET", { params }),
      call(r.activity.GET, "GET", { params }),
      call(r.members.GET, "GET", { params }),
      call(r.imports.GET, "GET", { params }),
      call(r.preview.POST, "POST", { params, form: { kind: "funding", file } }),
      call(r.imports.POST, "POST", { params, form: { kind: "funding", file, mapping: "{}", expectedSha256: "x" } }),
      call(r.decisions.POST, "POST", { params, json: { action: "exclude", rowKey: "SUB-1002::CLASS A", transactionKey: "WIRE-20503", note: "Trying to reach another offering." } }),
      call(r.approve.POST, "POST", { params, json: { expectedFingerprint: "0".repeat(64) } }),
      call(r.members.POST, "POST", { params, json: { email: OUTSIDER, role: "approver" } }),
      download(offeringId, 1, "register.csv"),
      download(offeringId, 1, "exceptions.csv"),
      call(r.draftExceptions.GET, "GET", { params }),
    ]);
    // "Not found" rather than "forbidden", so the offering's existence is not disclosed.
    expect(attempts.map((a) => a.status)).toEqual(attempts.map(() => 404));
    for (const attempt of attempts) expect(attempt.text).not.toContain("INV-");

    // Only administrators may invite users.
    expect((await call(r.users.POST, "POST", { json: { email: "friend@elsewhere.example" } })).status).toBe(403);
    expect((await call(r.users.GET, "GET")).status).toBe(403);
  });

  it("keeps an approved snapshot byte-for-byte unchanged after later imports and decisions", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    signInAs(APPROVER);
    const approved = await approve(offeringId, (await getRecon(offeringId)).fingerprint);
    expect(approved.status).toBe(201);
    const registerV1 = await download(offeringId, 1, "register.csv");
    const exceptionsV1 = await download(offeringId, 1, "exceptions.csv");

    // Approving the same data twice is refused.
    expect((await approve(offeringId, (await getRecon(offeringId)).fingerprint)).status).toBe(409);

    // New source data arrives after approval: a larger allocation for SUB-1002 and a new wire.
    signInAs(REVIEWER);
    await importFile(offeringId, "allocations", "allocations-late.csv", csvOf(ALLOCATIONS_HEADER, ["SUB-1002,Class A,60000.00,60,USD"]));
    await importFile(offeringId, "funding", "funding-late.csv", csvOf(FUNDING_HEADER, ["WIRE-29001,SUB-1010,,5000.00,USD,cleared,2026-11-12,"]));
    const { resolveConflicts } = await import("../support/driver");
    await resolveConflicts(offeringId, "SUB-1002::CLASS A", "accept_incoming");
    const working = await getRecon(offeringId);
    expect(rowOf(working.rows, "SUB-1002::CLASS A").approvedAmount).toBe("60000.00");

    const registerAgain = await download(offeringId, 1, "register.csv");
    expect(registerAgain.text).toBe(registerV1.text);
    expect(registerAgain.headers.get("x-content-sha256")).toBe(approved.body.snapshot.registerSha256);
    expect((await download(offeringId, 1, "exceptions.csv")).text).toBe(exceptionsV1.text);
    expect(registerV1.text).toContain("INV-0402,Class A,SUB-1002,100000.00,100,USD");

    signInAs(APPROVER);
    const close = await getClose(offeringId);
    expect(close.readiness.workingMatchesLatest).toBe(false);
    expect(close.readiness.latest?.version).toBe(1);

    // The database itself refuses to rewrite history.
    const { query } = await import("@/server/db");
    await expect(query("UPDATE snapshots SET register_csv = 'tampered' WHERE offering_id = $1", [offeringId])).rejects.toThrow(/append-only/);
    await expect(query("DELETE FROM audit_events WHERE offering_id = $1", [offeringId])).rejects.toThrow(/append-only/);
    await expect(
      query("UPDATE source_records SET data = '{}'::jsonb WHERE offering_id = $1 AND record_key = 'SUB-1012'", [offeringId]),
    ).rejects.toThrow(/immutable/);

    // Once the new exceptions are worked, a second version is frozen alongside the first.
    signInAs(REVIEWER);
    await acknowledge(offeringId, "SUB-1002::CLASS A", "EXCESS_FUNDING");
    await acknowledge(offeringId, "SUB-1010::CLASS A", "EXCESS_FUNDING");
    signInAs(APPROVER);
    const second = await approve(offeringId, (await getRecon(offeringId)).fingerprint);
    expect(second.status, second.text).toBe(201);
    expect(second.body.snapshot.version).toBe(2);
    expect((await download(offeringId, 2, "register.csv")).text).toContain("INV-0402,Class A,SUB-1002,60000.00,60,USD");
    expect((await download(offeringId, 1, "register.csv")).text).toBe(registerV1.text);
  });

  it("logs imports, decisions, approvals and exports without investor records", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    signInAs(APPROVER);
    await approve(offeringId, (await getRecon(offeringId)).fingerprint);
    await download(offeringId, 1, "register.csv");

    const r = await routes();
    const activity = await call<{ events: { action: string; actorEmail: string; detail: Record<string, unknown> }[] }>(r.activity.GET, "GET", {
      params: { offeringId },
    });
    const actions = activity.body.events.map((e) => e.action);
    expect(actions.filter((a) => a === "import.committed")).toHaveLength(5);
    expect(actions.filter((a) => a === "decision.recorded")).toHaveLength(10);
    expect(actions).toEqual(expect.arrayContaining(["offering.created", "member.set", "close.approved", "export.downloaded"]));
    expect(activity.body.events.find((e) => e.action === "close.approved")?.actorEmail).toBe(APPROVER);
    expect(activity.text).not.toMatch(/INV-\d{4}/);
  });
});

describe("4. The exported register matches the known-good fixture", () => {
  it("agrees by investor and share class, including units and totals", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    signInAs(APPROVER);
    await approve(offeringId, (await getRecon(offeringId)).fingerprint);

    const exported = parseCsv((await download(offeringId, 1, "register.csv")).text);
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
    const sum = (rows: typeof exported.rows, field: string) =>
      rows.reduce((total, r) => total.plus(r.cells[field] ?? "0"), new Decimal(0));
    expect(exported.rows).toHaveLength(summary.registerLines);
    expect(sum(exported.rows, "approved_amount").toFixed(2)).toBe(summary.approvedAmount);
    expect(summary.approvedAmount).toBe("5000000.00");
    for (const [shareClass, totals] of Object.entries(summary.byShareClass)) {
      const lines = exported.rows.filter((r) => r.cells.share_class === shareClass);
      expect(lines).toHaveLength(totals.lines);
      expect(sum(lines, "approved_amount").toFixed(2)).toBe(totals.approvedAmount);
      expect(sum(lines, "approved_units").toFixed()).toBe(totals.approvedUnits);
    }

    // The typed copy of the register in PostgreSQL carries the same totals.
    const { query } = await import("@/server/db");
    const stored = await query<{ lines: number; amount: string; units: string }>(
      `SELECT count(*)::int AS lines, sum(l.approved_amount)::text AS amount, sum(l.approved_units)::text AS units
         FROM snapshot_register_lines l JOIN snapshots s ON s.id = l.snapshot_id
        WHERE s.offering_id = $1 AND s.version = 1`,
      [offeringId],
    );
    expect(stored[0]).toMatchObject({ lines: 47, amount: "5000000.00" });
    expect(new Decimal(stored[0]?.units ?? "0").toFixed()).toBe("4669.9");
  });

  it("produces an exceptions report with every exception and the decision behind it", async () => {
    const { offeringId } = await bootstrapWorkspace();
    signInAs(REVIEWER);
    await importDemoFiles(offeringId);
    await resolveDemoClose(offeringId);
    signInAs(APPROVER);
    await approve(offeringId, (await getRecon(offeringId)).fingerprint);

    const report = parseCsv((await download(offeringId, 1, "exceptions.csv")).text);
    const variance = report.rows.find((r) => r.cells.subscription_id === "SUB-1012");
    expect(variance?.cells).toMatchObject({
      exception_code: "EXCESS_FUNDING",
      state: "documented",
      net_cleared_amount: "100000.00",
      approved_amount: "90000.00",
      variance_amount: "10000.00",
      decision: "acknowledge",
      decided_by: REVIEWER,
    });
    expect(report.rows.every((r) => r.cells.state !== "open")).toBe(true);
    expect(report.rows.map((r) => r.cells.exception_code)).toEqual(
      expect.arrayContaining(["EXCESS_FUNDING", "MISSING_ALLOCATION", "UNSIGNED_NO_ALLOCATION", "EXCLUDED_FUNDING", "UNMATCHED_FUNDING", "AMBIGUOUS_REFERENCE"]),
    );
  });
});
