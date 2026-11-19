import { cmp, formatMoney, formatUnits, isPositive, isZero, sub, sumMoney } from "./money";
import type { ReconRow } from "./reconcile";

export type AnswerTone = "ok" | "warn" | "danger" | "neutral";

export interface Explanation {
  /** The three questions, answered from the three files. */
  answers: { question: string; source: string; answer: string; tone: AnswerTone }[];
  /** What does not match or was flagged, in one sentence. Null when the three files agree and nothing was flagged. */
  difference: string | null;
  /** What the reviewed register export will carry for this row, and what Close Desk will not do. */
  outcome: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Describes a reconciliation row in plain English. Wording only: every figure is read
 * from the row, and nothing here changes a status or an amount.
 */
export function explainRow(row: ReconRow, dealCurrency: string): Explanation {
  const currency = row.currency ?? dealCurrency;
  const money = (value: string) => formatMoney(value, currency);

  if (row.kind === "funding") {
    const line = row.funding[0];
    const amount = line ? formatMoney(line.record.data.amount, line.record.data.currency) : "This payment";
    const linkable = row.exceptions.some((e) => e.state === "open" && e.resolution === "link_or_exclude");
    return {
      answers: [
        { question: "Did they sign?", source: "Subscription records", answer: "Not known. This payment is not matched to a subscription.", tone: "warn" },
        {
          question: "Did their money clear?",
          source: "Bank or escrow records",
          answer: line ? `${amount} is ${line.record.data.settlement_status} under reference ${line.record.data.transaction_ref}.` : "No payment record.",
          tone: "neutral",
        },
        { question: "How many LLC units did the sponsor approve?", source: "Approved allocations", answer: "Not applicable until the payment is matched.", tone: "neutral" },
      ],
      difference: `${amount} arrived without a reference that identifies exactly one subscription.`,
      outcome: linkable
        ? "It counts toward no investor until you link it to a subscription or exclude it. Close Desk never matches a payment by name or by amount."
        : "It counts toward no investor. Close Desk never matches a payment by name or by amount.",
    };
  }

  const subscription = row.subscription?.data ?? null;
  const allocation = row.allocation?.data ?? null;
  const counted = row.funding.filter((line) => line.treatment === "counted" && !line.isReversal);
  const reversals = row.funding.filter((line) => line.treatment === "reversal_applied");
  const net = row.netCleared ?? "0.00";
  const pending = row.pendingAmount ?? "0.00";

  let signed: Explanation["answers"][number];
  if (!subscription) {
    signed = { question: "Did they sign?", source: "Subscription records", answer: "There is no subscription with this ID in the subscriptions file.", tone: "danger" };
  } else if (subscription.signature_status === "signed") {
    signed = {
      question: "Did they sign?",
      source: "Subscription records",
      answer: `Yes. ${subscription.investor_ref} signed for ${formatMoney(subscription.requested_amount, subscription.currency)}.`,
      tone: "ok",
    };
  } else {
    signed = {
      question: "Did they sign?",
      source: "Subscription records",
      answer: `No. The subscription for ${formatMoney(subscription.requested_amount, subscription.currency)} is ${subscription.signature_status}.`,
      tone: "danger",
    };
  }

  const pendingNote = isPositive(pending) ? ` ${money(pending)} is pending and not counted.` : "";
  let cleared: Explanation["answers"][number];
  if (!isPositive(net)) {
    cleared = {
      question: "Did their money clear?",
      source: "Bank or escrow records",
      answer: `No cleared funds.${pendingNote}`,
      tone: allocation && isPositive(allocation.approved_amount) ? "danger" : "neutral",
    };
  } else {
    let parts = "";
    if (reversals.length > 0) {
      const gross = sumMoney(counted.map((l) => l.record.data.amount));
      const reversed = sumMoney(reversals.map((l) => l.record.data.amount));
      parts = `: ${plural(counted.length, "payment")} totalling ${money(gross)}, less ${plural(reversals.length, "reversal")} of ${money(reversed)}`;
    } else if (counted.length > 1) {
      parts = ` across ${plural(counted.length, "payment")} (${counted.map((l) => `${l.record.data.transaction_ref} ${formatMoney(l.record.data.amount, l.record.data.currency)}`).join(", ")})`;
    }
    const target = allocation && isPositive(allocation.approved_amount) ? allocation.approved_amount : (subscription?.requested_amount ?? net);
    const short = cmp(net, target) < 0;
    cleared = {
      question: "Did their money clear?",
      source: "Bank or escrow records",
      answer: `${short ? "Partly" : "Yes"}. ${money(net)} cleared${parts}.${pendingNote}`,
      tone: short ? "danger" : "ok",
    };
  }

  let approved: Explanation["answers"][number];
  if (!allocation) {
    approved = { question: "How many LLC units did the sponsor approve?", source: "Approved allocations", answer: "None. There is no approved allocation for this subscription.", tone: "warn" };
  } else if (isZero(allocation.approved_amount)) {
    approved = { question: "How many LLC units did the sponsor approve?", source: "Approved allocations", answer: "None. The sponsor recorded an allocation of zero.", tone: "neutral" };
  } else {
    approved = {
      question: "How many LLC units did the sponsor approve?",
      source: "Approved allocations",
      answer: `${formatUnits(allocation.approved_units)} units for ${formatMoney(allocation.approved_amount, allocation.currency)}.`,
      tone: "ok",
    };
  }

  let difference: string | null = null;
  if (allocation && row.variance !== null && row.varianceBasis === "approved" && !isZero(row.variance)) {
    const gap = formatMoney(isPositive(row.variance) ? row.variance : sub("0.00", row.variance), currency);
    difference = isPositive(row.variance)
      ? `Cleared funds are ${gap} above the approved allocation.`
      : `Cleared funds are ${gap} below the approved allocation.`;
  } else if (!allocation && subscription && isPositive(net)) {
    difference = `${money(net)} has cleared, but no allocation is approved.`;
  } else if (subscription && allocation && cmp(allocation.approved_amount, subscription.requested_amount) > 0) {
    difference = `The approved ${formatMoney(allocation.approved_amount, allocation.currency)} is above the ${formatMoney(subscription.requested_amount, subscription.currency)} the investor signed for.`;
  }

  const open = row.exceptions.filter((e) => e.state === "open");
  // Not every exception is a difference in amounts (an unsigned subscription, a payment in another currency).
  if (difference === null) difference = (open[0] ?? row.exceptions[0])?.message ?? null;
  const blocked = open.some((e) => e.severity === "blocker");
  const hasAllocation = allocation !== null && isPositive(allocation.approved_amount);
  const carries = hasAllocation ? `the approved ${formatMoney(allocation.approved_amount, allocation.currency)} and ${formatUnits(allocation.approved_units)} units` : "";
  const handsOff =
    row.variance !== null && row.varianceBasis === "approved" && isPositive(row.variance)
      ? ` The ${money(row.variance)} difference is settled outside Close Desk, which never moves money, issues units or starts a refund.`
      : "";

  let outcome: string;
  if (!hasAllocation) {
    outcome = "This row is left out of the reviewed register export, because nothing is approved for it.";
  } else if (blocked) {
    outcome = "This row stays out of the reviewed register export until corrected source data clears the blocker. A note cannot clear it.";
  } else if (open.length > 0) {
    outcome = `Once you record a review decision, the reviewed register export will carry ${carries}, never the amount funded.${handsOff}`;
  } else {
    outcome = `The reviewed register export carries ${carries}.${handsOff}`;
  }

  return { answers: [signed, cleared, approved], difference, outcome };
}
