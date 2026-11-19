import { expect } from "vitest";
import type { ColumnMapping } from "@/domain/import-fields";
import type { ReconRow, ReconSummary } from "@/domain/reconcile";
import type { FileKind } from "@/domain/types";
import type { CloseReadiness, SnapshotInfo } from "@/server/services/approvals";
import type { ImportCounts, ImportPreview } from "@/server/services/imports";
import type { DecisionHistoryItem } from "@/server/services/reconciliation";
import type { TableRow } from "@/server/view-models";
import { call, signInAs } from "./app";
import { fixture } from "./build";

export const ADMIN = "avery.admin@closedesk.example";
export const REVIEWER = "riley.reviewer@closedesk.example";
export const APPROVER = "morgan.approver@closedesk.example";
/** Invited to the workspace, but not a member of the offering under test. */
export const OUTSIDER = "olu.outsider@closedesk.example";

export const BANK_PORTAL_MAPPING: ColumnMapping = {
  transaction_ref: "Bank Ref",
  subscription_id: "Subscription No",
  payment_reference: "Wire Memo",
  amount: "Credit Amount",
  currency: "CCY",
  settlement_status: "Payment Status",
  settled_at: "Value Date",
  original_transaction_ref: "Reverses",
};

async function routes() {
  return {
    users: await import("@/app/api/users/route"),
    offerings: await import("@/app/api/offerings/route"),
    members: await import("@/app/api/offerings/[offeringId]/members/route"),
    preview: await import("@/app/api/offerings/[offeringId]/imports/preview/route"),
    imports: await import("@/app/api/offerings/[offeringId]/imports/route"),
    reconciliation: await import("@/app/api/offerings/[offeringId]/reconciliation/route"),
    row: await import("@/app/api/offerings/[offeringId]/reconciliation/row/route"),
    decisions: await import("@/app/api/offerings/[offeringId]/decisions/route"),
    close: await import("@/app/api/offerings/[offeringId]/close/route"),
    approve: await import("@/app/api/offerings/[offeringId]/approve/route"),
    snapshotFile: await import("@/app/api/offerings/[offeringId]/snapshots/[version]/[file]/route"),
    draftExceptions: await import("@/app/api/offerings/[offeringId]/exports/exceptions-draft/route"),
    activity: await import("@/app/api/offerings/[offeringId]/activity/route"),
  };
}

export { routes };

/**
 * Sets up a workspace the way an operator would: the first administrator is invited from
 * the command line, signs in, invites the team and creates the offering.
 */
export async function bootstrapWorkspace(name = "Riverbend Flats Apartments"): Promise<{ offeringId: string }> {
  const r = await routes();
  const { inviteUser } = await import("@/server/services/users");
  await inviteUser(null, { email: ADMIN, isAdmin: true });

  signInAs(ADMIN);
  for (const email of [REVIEWER, APPROVER, OUTSIDER]) {
    const invited = await call(r.users.POST, "POST", { json: { email } });
    expect(invited.status).toBe(201);
  }
  const created = await call<{ offering: { id: string } }>(r.offerings.POST, "POST", {
    json: { name, propertyName: "Riverbend Flats", currency: "USD", targetRaise: "5000000", addCreatorAsReviewer: false },
  });
  expect(created.status).toBe(201);
  const offeringId = created.body.offering.id;
  for (const [email, role] of [
    [REVIEWER, "reviewer"],
    [APPROVER, "approver"],
  ] as const) {
    const added = await call(r.members.POST, "POST", { params: { offeringId }, json: { email, role } });
    expect(added.status).toBe(201);
  }
  return { offeringId };
}

export async function previewFile(offeringId: string, kind: FileKind, filename: string, content: string, mapping?: ColumnMapping) {
  const r = await routes();
  return call<{ preview: ImportPreview }>(r.preview.POST, "POST", {
    params: { offeringId },
    form: { kind, file: { filename, content }, ...(mapping ? { mapping: JSON.stringify(mapping) } : {}) },
  });
}

/** Previews, then commits, exactly as the import wizard does. */
export async function importFile(
  offeringId: string,
  kind: FileKind,
  filename: string,
  content: string,
  options: { mapping?: ColumnMapping; skipInvalidRows?: boolean } = {},
): Promise<{ preview: ImportPreview; counts: ImportCounts }> {
  const r = await routes();
  const previewed = await previewFile(offeringId, kind, filename, content, options.mapping);
  expect(previewed.status).toBe(200);
  const preview = previewed.body.preview;
  expect(preview.mappingErrors).toEqual([]);
  const committed = await call<{ batchId: string; counts: ImportCounts }>(r.imports.POST, "POST", {
    params: { offeringId },
    form: {
      kind,
      file: { filename, content },
      mapping: JSON.stringify(preview.mapping),
      expectedSha256: preview.sha256,
      skipInvalidRows: String(options.skipInvalidRows ?? false),
    },
  });
  expect(committed.status, committed.text).toBe(201);
  return { preview, counts: committed.body.counts };
}

export async function importDemoFiles(offeringId: string) {
  return {
    subscriptions: await importFile(offeringId, "subscriptions", "subscriptions.csv", fixture("subscriptions.csv")),
    funding: await importFile(offeringId, "funding", "funding.csv", fixture("funding.csv"), { skipInvalidRows: true }),
    allocations: await importFile(offeringId, "allocations", "allocations.csv", fixture("allocations.csv")),
  };
}

export async function getRecon(offeringId: string) {
  const r = await routes();
  const result = await call<{ fingerprint: string; summary: ReconSummary; rows: TableRow[] }>(r.reconciliation.GET, "GET", {
    params: { offeringId },
  });
  expect(result.status).toBe(200);
  return result.body;
}

export async function getRow(offeringId: string, key: string) {
  const r = await routes();
  const result = await call<{ row: ReconRow; history: DecisionHistoryItem[]; canReview: boolean }>(r.row.GET, "GET", {
    params: { offeringId },
    search: { key },
  });
  expect(result.status, result.text).toBe(200);
  return result.body;
}

export async function decide(offeringId: string, input: Record<string, unknown>) {
  const r = await routes();
  return call<{ decisionId: string }>(r.decisions.POST, "POST", {
    params: { offeringId },
    json: { note: "Reviewed against the source documents and documented.", ...input },
  });
}

export async function acknowledge(offeringId: string, rowKey: string, code: string) {
  const { row } = await getRow(offeringId, rowKey);
  const exception = row.exceptions.find((e) => e.code === code && e.state === "open");
  expect(exception, `${code} on ${rowKey}`).toBeDefined();
  const result = await decide(offeringId, {
    action: "acknowledge",
    rowKey,
    exceptionId: exception?.id,
    fingerprint: exception?.fingerprint,
  });
  expect(result.status, result.text).toBe(201);
}

export async function resolveConflicts(offeringId: string, rowKey: string, action: "accept_incoming" | "keep_existing") {
  const { row } = await getRow(offeringId, rowKey);
  const conflicts = row.exceptions.filter((e) => e.code === "SOURCE_CONFLICT" && e.state === "open");
  expect(conflicts.length, `conflicts on ${rowKey}`).toBeGreaterThan(0);
  for (const conflict of conflicts) {
    const result = await decide(offeringId, { action, rowKey, exceptionId: conflict.id });
    expect(result.status, result.text).toBe(201);
  }
}

/**
 * Works the Riverbend Flats demo to a clean close: documents the reviewable exceptions,
 * links and excludes funding, and imports corrected source data for the hard blockers.
 */
export async function resolveDemoClose(offeringId: string): Promise<void> {
  signInAs(REVIEWER);
  await acknowledge(offeringId, "SUB-1012::CLASS A", "EXCESS_FUNDING");
  await acknowledge(offeringId, "SUB-1044::CLASS A", "MISSING_ALLOCATION");
  await acknowledge(offeringId, "SUB-1048::CLASS A", "UNSIGNED_NO_ALLOCATION");

  const excluded = await decide(offeringId, { action: "exclude", rowKey: "SUB-1034::CLASS A", transactionKey: "PORTAL-88120" });
  expect(excluded.status, excluded.text).toBe(201);
  const linked1038 = await decide(offeringId, {
    action: "link",
    rowKey: "FUNDING::WIRE-20338",
    transactionKey: "WIRE-20338",
    subscriptionId: "SUB-1038",
  });
  expect(linked1038.status, linked1038.text).toBe(201);
  const linked1041 = await decide(offeringId, {
    action: "link",
    rowKey: "FUNDING::WIRE-20341",
    transactionKey: "WIRE-20341",
    subscriptionId: "SUB-1041",
  });
  expect(linked1041.status, linked1041.text).toBe(201);

  await importFile(offeringId, "subscriptions", "subscriptions-corrections.csv", fixture("corrections/subscriptions-corrections.csv"));
  await resolveConflicts(offeringId, "SUB-1019::CLASS A", "accept_incoming");

  await importFile(offeringId, "funding", "funding-corrections.csv", fixture("corrections/funding-corrections.csv"), {
    mapping: BANK_PORTAL_MAPPING,
  });
  for (const rowKey of ["SUB-1023::CLASS B", "SUB-1031::CLASS B", "SUB-1046::CLASS B"]) {
    await resolveConflicts(offeringId, rowKey, "accept_incoming");
  }
}

export async function getClose(offeringId: string) {
  const r = await routes();
  const result = await call<{ readiness: CloseReadiness; canApprove: boolean }>(r.close.GET, "GET", { params: { offeringId } });
  expect(result.status).toBe(200);
  return result.body;
}

export async function approve(offeringId: string, expectedFingerprint: string) {
  const r = await routes();
  return call<{ snapshot: SnapshotInfo; error?: { code: string; message: string; details: { reasons: string[] } } }>(
    r.approve.POST,
    "POST",
    { params: { offeringId }, json: { expectedFingerprint, note: "Approved after review of the close summary." } },
  );
}

export async function download(offeringId: string, version: number, file: "register.csv" | "exceptions.csv") {
  const r = await routes();
  return call(r.snapshotFile.GET, "GET", { params: { offeringId, version: String(version), file } });
}
