import { sha256 } from "./sha256";
import { EXCEPTION_META, type ExceptionCode, type Resolution, type Severity } from "./exceptions";
import { add, cmp, formatMoney, isPositive, sub, sumMoney, sumUnits, ZERO } from "./money";
import {
  fundingRowKey,
  idKey,
  rowKey,
  shareClassKey,
  type AllocationData,
  type DecisionRecord,
  type FundingData,
  type SignatureStatus,
  type SourceRecord,
  type SubscriptionData,
} from "./types";

export type RowStatus = "ready" | "needs_review" | "blocked";
export type ExceptionState = "open" | "documented" | "resolved";

export interface ReconException {
  id: string;
  code: ExceptionCode;
  title: string;
  severity: Severity;
  resolution: Resolution;
  guidance: string;
  state: ExceptionState;
  subjectKind: "row" | "funding" | "conflict";
  subjectKey: string;
  /** Hash of the facts behind the exception. A decision applies only while this is unchanged. */
  fingerprint: string;
  message: string;
  details: string[];
  variance: string | null;
  currency: string | null;
  transactionRef: string | null;
  decision: DecisionRecord | null;
}

export type FundingTreatment =
  | "counted"
  | "reversal_applied"
  | "pending"
  | "not_cleared"
  | "excluded"
  | "invalid_reversal"
  | "currency_mismatch"
  | "not_netted"
  | "unmatched";

export type MatchBasis = "subscription_id" | "payment_reference" | "reviewer_link" | "original_transaction" | null;

export interface FundingLine {
  record: SourceRecord<"funding">;
  isReversal: boolean;
  treatment: FundingTreatment;
  matchedBy: MatchBasis;
  /** Signed contribution to net cleared funding. "0.00" when the line is not counted. */
  effect: string;
  note: string | null;
  decision: DecisionRecord | null;
}

export interface ConflictView {
  incoming: SourceRecord;
  existing: SourceRecord | null;
  changedFields: { field: string; existing: string | null; incoming: string | null }[];
}

export interface ReconRow {
  key: string;
  kind: "subscription" | "allocation" | "funding";
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
  varianceBasis: "approved" | "requested" | null;
  status: RowStatus;
  inRegister: boolean;
  exceptions: ReconException[];
  subscription: SourceRecord<"subscriptions"> | null;
  allocation: SourceRecord<"allocations"> | null;
  funding: FundingLine[];
  conflicts: ConflictView[];
  factsHash: string;
}

export interface RegisterLine {
  investorRef: string;
  shareClass: string;
  subscriptionId: string;
  approvedAmount: string;
  approvedUnits: string;
  currency: string;
}

export interface ReconSummary {
  currency: string;
  counts: { total: number; ready: number; needsReview: number; blocked: number };
  openBlockers: number;
  openReviews: number;
  signedCommitments: string;
  netClearedFunding: string;
  approvedAllocations: string;
  pendingFunding: string;
  unmatchedCleared: string;
  excessOverApproved: string;
  registerAmount: string;
  registerLineCount: number;
  unitsByClass: { shareClass: string; approvedAmount: string; approvedUnits: string }[];
  otherCurrencies: { currency: string; label: string; amount: string }[];
}

export interface ReconResult {
  rows: ReconRow[];
  summary: ReconSummary;
  register: RegisterLine[];
}

export interface ReconcileInput {
  offeringCurrency: string;
  records: SourceRecord[];
  decisions: DecisionRecord[];
}

function hash(parts: unknown[]): string {
  return sha256(JSON.stringify(parts));
}

interface TxnState {
  rec: SourceRecord<"funding">;
  data: FundingData;
  key: string;
  isReversal: boolean;
  target: string | null;
  matchedBy: MatchBasis;
  issue: { code: "UNMATCHED_FUNDING" | "AMBIGUOUS_REFERENCE"; message: string } | null;
  decision: DecisionRecord | null;
  excluded: boolean;
  invalidReason: string | null;
  reversalApplied: boolean;
  note: string | null;
}

function currentDecisions(decisions: DecisionRecord[]) {
  const revoked = new Set<string>();
  for (const d of decisions) {
    if (d.action === "revoke" && d.payload.revokesDecisionId) revoked.add(d.payload.revokesDecisionId);
  }
  const acknowledgements = new Map<string, DecisionRecord>();
  const fundingDecisions = new Map<string, DecisionRecord>();
  for (const d of decisions) {
    if (d.action === "revoke" || revoked.has(d.id)) continue;
    if (d.action === "acknowledge" && d.exceptionCode) {
      acknowledgements.set(`${d.subjectKind}|${d.subjectKey}|${d.exceptionCode}`, d);
    } else if ((d.action === "link" || d.action === "exclude") && d.subjectKind === "funding") {
      fundingDecisions.set(d.subjectKey, d);
    }
  }
  return { acknowledgements, fundingDecisions };
}

const FIELD_LABELS: Record<string, string> = {
  subscription_id: "Subscription ID",
  investor_ref: "Investor reference",
  share_class: "Share class",
  requested_amount: "Requested amount",
  currency: "Currency",
  signature_status: "Signature status",
  payment_reference: "Payment reference",
  transaction_ref: "Transaction reference",
  amount: "Amount",
  settlement_status: "Settlement status",
  settled_at: "Settled at",
  original_transaction_ref: "Original transaction reference",
  approved_amount: "Approved amount",
  approved_units: "Approved units",
};

function diffRecords(existing: SourceRecord | null, incoming: SourceRecord): ConflictView["changedFields"] {
  const before = (existing?.data ?? {}) as unknown as Record<string, string | null>;
  const after = incoming.data as unknown as Record<string, string | null>;
  const changed: ConflictView["changedFields"] = [];
  for (const field of Object.keys(after)) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (a !== b) changed.push({ field: FIELD_LABELS[field] ?? field, existing: a, incoming: b });
  }
  return changed;
}

/**
 * Deterministic reconciliation of one offering. A pure function of the current source
 * records and reviewer decisions: nothing here reads a clock, a database or a float.
 */
export function reconcile(input: ReconcileInput): ReconResult {
  const { offeringCurrency } = input;
  const active = input.records.filter((r) => r.state === "active");
  const pendingConflicts = input.records.filter((r) => r.state === "conflict");

  const subs = new Map<string, SourceRecord<"subscriptions">>();
  const allocations: SourceRecord<"allocations">[] = [];
  const txns: SourceRecord<"funding">[] = [];
  for (const record of active) {
    if (record.kind === "subscriptions") subs.set(record.key, record as SourceRecord<"subscriptions">);
    else if (record.kind === "allocations") allocations.push(record as SourceRecord<"allocations">);
    else txns.push(record as SourceRecord<"funding">);
  }

  const { acknowledgements, fundingDecisions } = currentDecisions(input.decisions);

  // Explicit payment-reference mapping, taken from the subscriptions file.
  const referenceMap = new Map<string, Set<string>>();
  for (const [key, record] of subs) {
    const reference = record.data.payment_reference;
    if (!reference) continue;
    const set = referenceMap.get(idKey(reference)) ?? new Set<string>();
    set.add(key);
    referenceMap.set(idKey(reference), set);
  }

  const states = new Map<string, TxnState>();
  for (const rec of txns) {
    const data = rec.data;
    const state: TxnState = {
      rec,
      data,
      key: rec.key,
      isReversal: Boolean(data.original_transaction_ref),
      target: null,
      matchedBy: null,
      issue: null,
      decision: null,
      excluded: false,
      invalidReason: null,
      reversalApplied: false,
      note: null,
    };
    states.set(rec.key, state);
    if (state.isReversal) continue;

    const subKey = data.subscription_id ? idKey(data.subscription_id) : null;
    const mapped = data.payment_reference ? referenceMap.get(idKey(data.payment_reference)) : undefined;

    if (subKey) {
      if (!subs.has(subKey)) {
        state.issue = {
          code: "UNMATCHED_FUNDING",
          message: `Subscription ID ${data.subscription_id} is not in the subscriptions file.`,
        };
      } else if (mapped && mapped.size > 0 && !mapped.has(subKey)) {
        state.issue = {
          code: "AMBIGUOUS_REFERENCE",
          message: `Subscription ID ${data.subscription_id} and payment reference ${data.payment_reference} point to different subscriptions.`,
        };
      } else {
        state.target = subKey;
        state.matchedBy = "subscription_id";
      }
    } else if (data.payment_reference) {
      if (!mapped || mapped.size === 0) {
        state.issue = {
          code: "UNMATCHED_FUNDING",
          message: `Payment reference ${data.payment_reference} is not mapped to a subscription.`,
        };
      } else if (mapped.size > 1) {
        const ids = [...mapped].map((k) => subs.get(k)?.data.subscription_id ?? k).sort();
        state.issue = {
          code: "AMBIGUOUS_REFERENCE",
          message: `Payment reference ${data.payment_reference} is mapped to ${ids.length} subscriptions (${ids.join(", ")}).`,
        };
      } else {
        state.target = [...mapped][0] ?? null;
        state.matchedBy = "payment_reference";
      }
    } else {
      state.issue = { code: "UNMATCHED_FUNDING", message: "The payment has no subscription ID and no payment reference." };
    }

    const decision = fundingDecisions.get(rec.key);
    if (decision && decision.fingerprint === rec.contentHash) {
      if (decision.action === "exclude") {
        state.decision = decision;
        state.excluded = true;
      } else if (decision.action === "link" && state.issue && decision.payload.subscriptionKey) {
        if (subs.has(decision.payload.subscriptionKey)) {
          state.decision = decision;
          state.target = decision.payload.subscriptionKey;
          state.matchedBy = "reviewer_link";
        }
      }
    }
  }

  // Reversals net against their original transaction, never against a subscription directly.
  const reversalsByOriginal = new Map<string, TxnState[]>();
  for (const state of states.values()) {
    if (!state.isReversal) continue;
    const data = state.data;
    const originalKey = idKey(data.original_transaction_ref ?? "");
    const original = states.get(originalKey);
    const ownTarget = data.subscription_id && subs.has(idKey(data.subscription_id)) ? idKey(data.subscription_id) : null;
    state.matchedBy = "original_transaction";
    state.target = original && !original.isReversal ? (original.target ?? ownTarget) : ownTarget;

    if (data.settlement_status !== "cleared") {
      state.note = `Reversal is ${data.settlement_status}; it is not netted.`;
      continue;
    }
    if (!original) {
      state.invalidReason = `Original transaction ${data.original_transaction_ref} is not in this deal's funding.`;
    } else if (original.isReversal) {
      state.invalidReason = `Original transaction ${data.original_transaction_ref} is itself a reversal.`;
    } else if (original.data.currency !== data.currency) {
      state.invalidReason = `Reversal is in ${data.currency} but the original transaction is in ${original.data.currency}.`;
    } else if (data.subscription_id && original.target && idKey(data.subscription_id) !== original.target) {
      state.invalidReason = `Reversal names subscription ${data.subscription_id}, but the original transaction belongs to another subscription.`;
    } else if (original.excluded) {
      state.note = "The original transaction was excluded in review, so this reversal has no effect.";
    } else if (original.data.settlement_status !== "cleared") {
      state.invalidReason = `Original transaction ${data.original_transaction_ref} is ${original.data.settlement_status}, not cleared.`;
    } else {
      const list = reversalsByOriginal.get(originalKey) ?? [];
      list.push(state);
      reversalsByOriginal.set(originalKey, list);
    }
  }
  const reversedByOriginal = new Map<string, string>();
  for (const [originalKey, list] of reversalsByOriginal) {
    const original = states.get(originalKey);
    if (!original) continue;
    list.sort((a, b) => (a.data.settled_at ?? "").localeCompare(b.data.settled_at ?? "") || a.key.localeCompare(b.key));
    let reversed = ZERO;
    for (const state of list) {
      const next = add(reversed, state.data.amount);
      if (cmp(next, original.data.amount) > 0) {
        state.invalidReason = `Reversals of ${original.data.transaction_ref} would exceed its amount of ${formatMoney(original.data.amount, original.data.currency)}.`;
      } else {
        reversed = next;
        state.reversalApplied = true;
      }
    }
    reversedByOriginal.set(originalKey, reversed);
  }
  const fullyReversed = (state: TxnState) => cmp(reversedByOriginal.get(state.key) ?? ZERO, state.data.amount) === 0;

  const statesByTarget = new Map<string, TxnState[]>();
  const untargeted: TxnState[] = [];
  for (const state of states.values()) {
    if (state.target) {
      const list = statesByTarget.get(state.target) ?? [];
      list.push(state);
      statesByTarget.set(state.target, list);
    } else untargeted.push(state);
  }

  const conflictsBySubject = new Map<string, ConflictView[]>();
  const activeByKindKey = new Map<string, SourceRecord>();
  for (const record of active) activeByKindKey.set(`${record.kind}|${record.key}`, record);
  for (const incoming of pendingConflicts) {
    const existing = activeByKindKey.get(`${incoming.kind}|${incoming.key}`) ?? null;
    const view: ConflictView = { incoming, existing, changedFields: diffRecords(existing, incoming) };
    let subject: string;
    if (incoming.kind === "subscriptions") {
      const data = (existing ?? incoming).data as SubscriptionData;
      subject = rowKey(data.subscription_id, data.share_class);
    } else if (incoming.kind === "allocations") {
      const data = incoming.data as AllocationData;
      subject = rowKey(data.subscription_id, data.share_class);
    } else {
      const state = states.get(incoming.key);
      const targetSub = state?.target ? subs.get(state.target) : undefined;
      subject = targetSub
        ? rowKey(targetSub.data.subscription_id, targetSub.data.share_class)
        : fundingRowKey((incoming.data as FundingData).transaction_ref);
    }
    const list = conflictsBySubject.get(subject) ?? [];
    list.push(view);
    conflictsBySubject.set(subject, list);
  }

  const makeException = (
    code: ExceptionCode,
    subjectKind: ReconException["subjectKind"],
    subjectKey: string,
    fingerprint: string,
    message: string,
    extra: Partial<Pick<ReconException, "details" | "variance" | "currency" | "transactionRef" | "state" | "decision">> = {},
  ): ReconException => {
    const meta = EXCEPTION_META[code];
    let state: ExceptionState = extra.state ?? "open";
    let decision = extra.decision ?? null;
    if (state === "open" && meta.resolution === "document") {
      const ack = acknowledgements.get(`${subjectKind}|${subjectKey}|${code}`);
      if (ack && ack.fingerprint === fingerprint) {
        state = "documented";
        decision = ack;
      }
    }
    return {
      id: `${subjectKind}|${subjectKey}|${code}`,
      code,
      title: meta.title,
      severity: meta.severity,
      resolution: meta.resolution,
      guidance: meta.guidance,
      state,
      subjectKind,
      subjectKey,
      fingerprint,
      message,
      details: extra.details ?? [],
      variance: extra.variance ?? null,
      currency: extra.currency ?? null,
      transactionRef: extra.transactionRef ?? null,
      decision,
    };
  };

  const statusOf = (exceptions: ReconException[]): RowStatus => {
    const open = exceptions.filter((e) => e.state === "open");
    if (open.some((e) => e.severity === "blocker")) return "blocked";
    return open.length > 0 ? "needs_review" : "ready";
  };

  const conflictExceptions = (views: ConflictView[]): ReconException[] =>
    views.map((view) =>
      makeException(
        "SOURCE_CONFLICT",
        "conflict",
        view.incoming.id,
        view.incoming.contentHash,
        `${view.incoming.source.filename}, row ${view.incoming.source.rowNumber} supplies different content for ${view.incoming.kind === "funding" ? "transaction" : view.incoming.kind === "subscriptions" ? "subscription" : "allocation"} ${view.incoming.key.replace("::", " · ")}.`,
        {
          details: view.changedFields.map((c) => `${c.field}: ${c.existing ?? "—"} → ${c.incoming ?? "—"}`),
          transactionRef: view.incoming.kind === "funding" ? (view.incoming.data as FundingData).transaction_ref : null,
        },
      ),
    );

  const allocationsBySub = new Map<string, SourceRecord<"allocations">[]>();
  for (const allocation of allocations) {
    const key = idKey(allocation.data.subscription_id);
    const list = allocationsBySub.get(key) ?? [];
    list.push(allocation);
    allocationsBySub.set(key, list);
  }

  const rows: ReconRow[] = [];

  for (const [subKey, subscription] of subs) {
    const s = subscription.data;
    const key = rowKey(s.subscription_id, s.share_class);
    const allocation =
      (allocationsBySub.get(subKey) ?? []).find((a) => shareClassKey(a.data.share_class) === shareClassKey(s.share_class)) ?? null;
    const a = allocation?.data ?? null;
    const txnStates = (statesByTarget.get(subKey) ?? []).sort(
      (x, y) => (x.data.settled_at ?? "9999").localeCompare(y.data.settled_at ?? "9999") || x.key.localeCompare(y.key),
    );

    const lines: FundingLine[] = [];
    const currencyIssues: string[] = [];
    const invalidReversals: string[] = [];
    const counted: TxnState[] = [];
    const resolvedInfo: ReconException[] = [];
    let net = ZERO;
    let pending = ZERO;

    for (const state of txnStates) {
      const d = state.data;
      let treatment: FundingTreatment;
      let effect = ZERO;
      let note = state.note;

      if (!state.isReversal) {
        if (state.excluded) {
          treatment = "excluded";
          note = "Excluded in review; not counted.";
        } else if (d.currency !== s.currency) {
          treatment = "currency_mismatch";
          note = `In ${d.currency}; the subscription is in ${s.currency}. Not netted.`;
          if (d.settlement_status === "cleared" || d.settlement_status === "pending") {
            currencyIssues.push(
              `${d.transaction_ref} is ${formatMoney(d.amount, d.currency)} in ${d.currency}; the subscription is in ${s.currency}.`,
            );
          }
        } else if (d.settlement_status === "cleared") {
          treatment = "counted";
          effect = d.amount;
          net = add(net, d.amount);
          counted.push(state);
        } else if (d.settlement_status === "pending") {
          treatment = "pending";
          pending = add(pending, d.amount);
          note = "Pending; not counted until cleared.";
        } else {
          treatment = "not_cleared";
          note = `Status is ${d.settlement_status}; not counted.`;
        }
        if (state.decision) {
          resolvedInfo.push(
            makeException(
              state.decision.action === "exclude" ? "EXCLUDED_FUNDING" : (state.issue?.code ?? "UNMATCHED_FUNDING"),
              "funding",
              state.key,
              state.rec.contentHash,
              state.decision.action === "exclude"
                ? `${d.transaction_ref} (${formatMoney(d.amount, d.currency)}) was excluded from funding in review.`
                : `${d.transaction_ref} (${formatMoney(d.amount, d.currency)}) was linked to this subscription in review. ${state.issue?.message ?? ""}`.trim(),
              { state: "resolved", decision: state.decision, transactionRef: d.transaction_ref, currency: d.currency },
            ),
          );
        }
      } else if (state.invalidReason) {
        treatment = "invalid_reversal";
        note = state.invalidReason;
        invalidReversals.push(`${d.transaction_ref}: ${state.invalidReason}`);
      } else if (state.reversalApplied) {
        const original = states.get(idKey(d.original_transaction_ref ?? ""));
        if (original && original.data.currency === s.currency && original.target === subKey) {
          treatment = "reversal_applied";
          effect = sub(ZERO, d.amount);
          net = sub(net, d.amount);
          note = `Reverses ${original.data.transaction_ref}.`;
        } else {
          treatment = "not_netted";
          note = "The original transaction is not counted toward this subscription, so this reversal is not netted.";
        }
      } else {
        treatment = "not_cleared";
      }
      lines.push({ record: state.rec, isReversal: state.isReversal, treatment, matchedBy: state.matchedBy, effect, note, decision: state.decision });
    }

    const factsHash = hash([
      subscription.contentHash,
      allocation?.contentHash ?? null,
      lines.map((l) => [l.record.contentHash, l.treatment]).sort(),
    ]);
    const fp = (code: ExceptionCode) => hash([code, key, factsHash]);
    const exceptions: ReconException[] = [];
    const signed = s.signature_status === "signed";
    const hasAllocation = a !== null && isPositive(a.approved_amount);
    const comparable = a === null || a.currency === s.currency;

    if (s.currency !== offeringCurrency) {
      currencyIssues.unshift(`The subscription is in ${s.currency}; the deal closes in ${offeringCurrency}.`);
    }
    if (a && a.currency !== s.currency) {
      currencyIssues.push(`The allocation is in ${a.currency}; the subscription is in ${s.currency}.`);
    }
    if (currencyIssues.length > 0) {
      exceptions.push(
        makeException("CURRENCY_MISMATCH", "row", key, fp("CURRENCY_MISMATCH"), currencyIssues[0] ?? "", {
          details: currencyIssues,
        }),
      );
    }
    if (invalidReversals.length > 0) {
      exceptions.push(
        makeException("INVALID_REVERSAL", "row", key, fp("INVALID_REVERSAL"), invalidReversals[0] ?? "", {
          details: invalidReversals,
        }),
      );
    }
    if (!signed) {
      exceptions.push(
        hasAllocation
          ? makeException(
              "UNSIGNED_WITH_ALLOCATION",
              "row",
              key,
              fp("UNSIGNED_WITH_ALLOCATION"),
              `Signature status is ${s.signature_status}, but ${formatMoney(a?.approved_amount ?? ZERO, a?.currency)} is approved.`,
            )
          : makeException(
              "UNSIGNED_NO_ALLOCATION",
              "row",
              key,
              fp("UNSIGNED_NO_ALLOCATION"),
              isPositive(net)
                ? `Signature status is ${s.signature_status}. ${formatMoney(net, s.currency)} of cleared funding is held with no allocation.`
                : `Signature status is ${s.signature_status}. No allocation is approved.`,
            ),
      );
    }

    let variance: string | null = null;
    let varianceBasis: ReconRow["varianceBasis"] = null;
    if (a && comparable) {
      variance = sub(net, a.approved_amount);
      varianceBasis = "approved";
      if (cmp(a.approved_amount, s.requested_amount) > 0) {
        exceptions.push(
          makeException(
            "ALLOCATION_EXCEEDS_COMMITMENT",
            "row",
            key,
            fp("ALLOCATION_EXCEEDS_COMMITMENT"),
            `Approved ${formatMoney(a.approved_amount, a.currency)} is above the signed commitment of ${formatMoney(s.requested_amount, s.currency)}.`,
            { variance: sub(a.approved_amount, s.requested_amount), currency: s.currency },
          ),
        );
      }
      if (hasAllocation && !isPositive(net)) {
        exceptions.push(
          makeException(
            "UNFUNDED_ALLOCATION",
            "row",
            key,
            fp("UNFUNDED_ALLOCATION"),
            isPositive(pending)
              ? `No cleared funding against ${formatMoney(a.approved_amount, a.currency)} approved. ${formatMoney(pending, s.currency)} is pending and not counted.`
              : `No cleared funding against ${formatMoney(a.approved_amount, a.currency)} approved.`,
            { variance, currency: s.currency },
          ),
        );
      } else if (hasAllocation && cmp(net, a.approved_amount) < 0) {
        exceptions.push(
          makeException(
            "PARTIAL_FUNDING",
            "row",
            key,
            fp("PARTIAL_FUNDING"),
            `Net cleared ${formatMoney(net, s.currency)} is ${formatMoney(sub(a.approved_amount, net), s.currency)} short of the approved ${formatMoney(a.approved_amount, a.currency)}.${isPositive(pending) ? ` ${formatMoney(pending, s.currency)} is pending and not counted.` : ""}`,
            { variance, currency: s.currency },
          ),
        );
      } else if (cmp(net, a.approved_amount) > 0) {
        exceptions.push(
          makeException(
            "EXCESS_FUNDING",
            "row",
            key,
            fp("EXCESS_FUNDING"),
            `Net cleared ${formatMoney(net, s.currency)} is ${formatMoney(variance, s.currency)} above the approved ${formatMoney(a.approved_amount, a.currency)}. The register uses the approved amount.`,
            { variance, currency: s.currency },
          ),
        );
      }
    } else if (!a) {
      variance = sub(net, s.requested_amount);
      varianceBasis = "requested";
      if (signed) {
        exceptions.push(
          makeException(
            "MISSING_ALLOCATION",
            "row",
            key,
            fp("MISSING_ALLOCATION"),
            isPositive(net)
              ? `No approved allocation. ${formatMoney(net, s.currency)} of cleared funding is held against this subscription.`
              : "No approved allocation for this signed subscription.",
            { currency: s.currency },
          ),
        );
      }
    }

    const duplicateGroups = new Map<string, TxnState[]>();
    for (const state of counted) {
      if (fullyReversed(state)) continue;
      const groupKey = `${state.data.amount}|${state.data.currency}|${(state.data.settled_at ?? "").slice(0, 10)}`;
      const list = duplicateGroups.get(groupKey) ?? [];
      list.push(state);
      duplicateGroups.set(groupKey, list);
    }
    const duplicates = [...duplicateGroups.values()].filter((g) => g.length > 1);
    if (duplicates.length > 0) {
      const details = duplicates.map(
        (g) =>
          `${g.map((t) => t.data.transaction_ref).join(" and ")}: ${formatMoney(g[0]?.data.amount ?? ZERO, g[0]?.data.currency)} each, settled ${(g[0]?.data.settled_at ?? "").slice(0, 10)}.`,
      );
      exceptions.push(
        makeException("POSSIBLE_DUPLICATE", "row", key, fp("POSSIBLE_DUPLICATE"), details[0] ?? "", { details }),
      );
    }

    const conflicts = conflictsBySubject.get(key) ?? [];
    exceptions.push(...conflictExceptions(conflicts), ...resolvedInfo);

    const status = statusOf(exceptions);
    rows.push({
      key,
      kind: "subscription",
      subscriptionId: s.subscription_id,
      investorRef: s.investor_ref,
      shareClass: s.share_class,
      transactionRef: null,
      signatureStatus: s.signature_status,
      currency: s.currency,
      requestedAmount: s.requested_amount,
      netCleared: net,
      pendingAmount: pending,
      approvedAmount: a?.approved_amount ?? null,
      approvedUnits: a?.approved_units ?? null,
      variance,
      varianceBasis,
      status,
      inRegister: status === "ready" && hasAllocation,
      exceptions,
      subscription,
      allocation,
      funding: lines,
      conflicts,
      factsHash,
    });
  }

  // Allocations that do not sit on a subscription in the same share class.
  for (const allocation of allocations) {
    const a = allocation.data;
    const subscription = subs.get(idKey(a.subscription_id)) ?? null;
    if (subscription && shareClassKey(subscription.data.share_class) === shareClassKey(a.share_class)) continue;
    const key = rowKey(a.subscription_id, a.share_class);
    const factsHash = hash([allocation.contentHash, subscription?.contentHash ?? null]);
    const exceptions: ReconException[] = [
      subscription
        ? makeException(
            "SHARE_CLASS_MISMATCH",
            "row",
            key,
            hash(["SHARE_CLASS_MISMATCH", key, factsHash]),
            `The allocation is for ${a.share_class}, but subscription ${subscription.data.subscription_id} is for ${subscription.data.share_class}.`,
          )
        : makeException(
            "ALLOCATION_WITHOUT_SUBSCRIPTION",
            "row",
            key,
            hash(["ALLOCATION_WITHOUT_SUBSCRIPTION", key, factsHash]),
            `Subscription ${a.subscription_id} is not in the subscriptions file.`,
          ),
    ];
    const conflicts = conflictsBySubject.get(key) ?? [];
    exceptions.push(...conflictExceptions(conflicts));
    rows.push({
      key,
      kind: "allocation",
      subscriptionId: a.subscription_id,
      investorRef: subscription?.data.investor_ref ?? null,
      shareClass: a.share_class,
      transactionRef: null,
      signatureStatus: subscription?.data.signature_status ?? null,
      currency: a.currency,
      requestedAmount: null,
      netCleared: null,
      pendingAmount: null,
      approvedAmount: a.approved_amount,
      approvedUnits: a.approved_units,
      variance: null,
      varianceBasis: null,
      status: statusOf(exceptions),
      inRegister: false,
      exceptions,
      subscription,
      allocation,
      funding: [],
      conflicts,
      factsHash,
    });
  }

  // Funding that is not attributed to any subscription.
  let unmatchedCleared = ZERO;
  for (const state of untargeted) {
    const d = state.data;
    const key = fundingRowKey(d.transaction_ref);
    const exceptions: ReconException[] = [];
    let treatment: FundingTreatment = "unmatched";
    let note = state.note;
    const live = d.settlement_status === "cleared" || d.settlement_status === "pending";

    if (state.isReversal) {
      if (state.invalidReason) {
        treatment = "invalid_reversal";
        note = state.invalidReason;
        exceptions.push(
          makeException("INVALID_REVERSAL", "funding", state.key, state.rec.contentHash, state.invalidReason, {
            transactionRef: d.transaction_ref,
            currency: d.currency,
          }),
        );
      } else if (state.reversalApplied) {
        treatment = "not_netted";
        note = "Nets against its original transaction, which is not matched to a subscription.";
        const original = states.get(idKey(d.original_transaction_ref ?? ""));
        if (original && !original.target && original.issue && d.currency === offeringCurrency) {
          unmatchedCleared = sub(unmatchedCleared, d.amount);
        }
      } else treatment = "not_cleared";
    } else if (state.excluded && state.decision) {
      treatment = "excluded";
      note = "Excluded in review; not counted.";
      exceptions.push(
        makeException(
          "EXCLUDED_FUNDING",
          "funding",
          state.key,
          state.rec.contentHash,
          `${d.transaction_ref} (${formatMoney(d.amount, d.currency)}) was excluded from funding in review. ${state.issue?.message ?? ""}`.trim(),
          { state: "resolved", decision: state.decision, transactionRef: d.transaction_ref, currency: d.currency },
        ),
      );
    } else if (state.issue && live) {
      exceptions.push(
        makeException(state.issue.code, "funding", state.key, state.rec.contentHash, state.issue.message, {
          transactionRef: d.transaction_ref,
          currency: d.currency,
        }),
      );
      if (d.settlement_status === "cleared" && d.currency === offeringCurrency) {
        unmatchedCleared = add(unmatchedCleared, d.amount);
      }
    } else if (!live) {
      treatment = "not_cleared";
      note = `Status is ${d.settlement_status}; not counted.`;
    }

    const conflicts = conflictsBySubject.get(key) ?? [];
    exceptions.push(...conflictExceptions(conflicts));
    rows.push({
      key,
      kind: "funding",
      subscriptionId: null,
      investorRef: null,
      shareClass: null,
      transactionRef: d.transaction_ref,
      signatureStatus: null,
      currency: d.currency,
      requestedAmount: null,
      netCleared: null,
      pendingAmount: null,
      approvedAmount: null,
      approvedUnits: null,
      variance: null,
      varianceBasis: null,
      status: statusOf(exceptions),
      inRegister: false,
      exceptions,
      subscription: null,
      allocation: null,
      funding: [
        { record: state.rec, isReversal: state.isReversal, treatment, matchedBy: null, effect: ZERO, note, decision: state.decision },
      ],
      conflicts,
      factsHash: state.rec.contentHash,
    });
  }

  rows.sort((x, y) => {
    const order = { subscription: 0, allocation: 1, funding: 2 } as const;
    return order[x.kind] - order[y.kind] || x.key.localeCompare(y.key, "en", { numeric: true });
  });

  const register: RegisterLine[] = rows
    .filter((r) => r.inRegister && r.subscription && r.allocation)
    .map((r) => ({
      investorRef: r.investorRef ?? "",
      shareClass: r.shareClass ?? "",
      subscriptionId: r.subscriptionId ?? "",
      approvedAmount: r.approvedAmount ?? ZERO,
      approvedUnits: r.approvedUnits ?? "0",
      currency: r.currency ?? offeringCurrency,
    }))
    .sort(
      (x, y) =>
        x.investorRef.localeCompare(y.investorRef, "en", { numeric: true }) ||
        x.shareClass.localeCompare(y.shareClass) ||
        x.subscriptionId.localeCompare(y.subscriptionId, "en", { numeric: true }),
    );

  const subscriptionRows = rows.filter((r) => r.kind === "subscription");
  const inCurrency = subscriptionRows.filter((r) => r.currency === offeringCurrency);
  const allExceptions = rows.flatMap((r) => r.exceptions).filter((e) => e.state === "open");

  const classTotals = new Map<string, { shareClass: string; amounts: string[]; units: string[] }>();
  const other = new Map<string, string[]>();
  const pushOther = (currency: string, label: string, amount: string) => {
    const k = `${currency}|${label}`;
    other.set(k, [...(other.get(k) ?? []), amount]);
  };
  for (const allocation of allocations) {
    const a = allocation.data;
    if (a.currency !== offeringCurrency) {
      pushOther(a.currency, "Approved allocations", a.approved_amount);
      continue;
    }
    const k = shareClassKey(a.share_class);
    const entry = classTotals.get(k) ?? { shareClass: a.share_class, amounts: [], units: [] };
    entry.amounts.push(a.approved_amount);
    entry.units.push(a.approved_units);
    classTotals.set(k, entry);
  }
  for (const row of subscriptionRows) {
    if (row.currency !== offeringCurrency && row.currency && row.signatureStatus === "signed" && row.requestedAmount) {
      pushOther(row.currency, "Signed commitments", row.requestedAmount);
    }
  }
  for (const state of states.values()) {
    const d = state.data;
    if (d.currency !== offeringCurrency && d.settlement_status === "cleared" && !state.isReversal && !state.excluded) {
      pushOther(d.currency, "Cleared funding (not netted)", d.amount);
    }
  }

  const summary: ReconSummary = {
    currency: offeringCurrency,
    counts: {
      total: rows.length,
      ready: rows.filter((r) => r.status === "ready").length,
      needsReview: rows.filter((r) => r.status === "needs_review").length,
      blocked: rows.filter((r) => r.status === "blocked").length,
    },
    openBlockers: allExceptions.filter((e) => e.severity === "blocker").length,
    openReviews: allExceptions.filter((e) => e.severity === "review").length,
    signedCommitments: sumMoney(
      inCurrency.filter((r) => r.signatureStatus === "signed").map((r) => r.requestedAmount ?? ZERO),
    ),
    netClearedFunding: sumMoney(inCurrency.map((r) => r.netCleared ?? ZERO)),
    approvedAllocations: sumMoney([...classTotals.values()].flatMap((c) => c.amounts)),
    pendingFunding: sumMoney(inCurrency.map((r) => r.pendingAmount ?? ZERO)),
    unmatchedCleared,
    excessOverApproved: sumMoney(
      inCurrency
        .filter((r) => r.varianceBasis === "approved" && r.variance !== null && isPositive(r.variance))
        .map((r) => r.variance ?? ZERO),
    ),
    registerAmount: sumMoney(register.map((l) => l.approvedAmount)),
    registerLineCount: register.length,
    unitsByClass: [...classTotals.values()]
      .sort((x, y) => x.shareClass.localeCompare(y.shareClass))
      .map((c) => ({ shareClass: c.shareClass, approvedAmount: sumMoney(c.amounts), approvedUnits: sumUnits(c.units) })),
    otherCurrencies: [...other.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, amounts]) => {
        const [currency = "", label = ""] = k.split("|");
        return { currency, label, amount: sumMoney(amounts) };
      }),
  };

  return { rows, summary, register };
}
