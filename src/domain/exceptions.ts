export type ExceptionCode =
  | "UNSIGNED_WITH_ALLOCATION"
  | "UNSIGNED_NO_ALLOCATION"
  | "UNFUNDED_ALLOCATION"
  | "PARTIAL_FUNDING"
  | "EXCESS_FUNDING"
  | "MISSING_ALLOCATION"
  | "ALLOCATION_EXCEEDS_COMMITMENT"
  | "ALLOCATION_WITHOUT_SUBSCRIPTION"
  | "SHARE_CLASS_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "INVALID_REVERSAL"
  | "POSSIBLE_DUPLICATE"
  | "UNMATCHED_FUNDING"
  | "AMBIGUOUS_REFERENCE"
  | "EXCLUDED_FUNDING"
  | "SOURCE_CONFLICT";

/** blocker: only corrected source data clears it. review: a reviewer action clears it. */
export type Severity = "blocker" | "review";

/**
 * source: import corrected source data.
 * document: record a reviewer note (the figures do not change).
 * link_or_exclude: link the transaction to a subscription or exclude it from funding.
 * conflict: choose which imported version of the record stands.
 */
export type Resolution = "source" | "document" | "link_or_exclude" | "conflict";

export interface ExceptionMeta {
  title: string;
  severity: Severity;
  resolution: Resolution;
  guidance: string;
}

export const EXCEPTION_META: Record<ExceptionCode, ExceptionMeta> = {
  UNSIGNED_WITH_ALLOCATION: {
    title: "Unsigned subscription with allocation",
    severity: "blocker",
    resolution: "source",
    guidance:
      "An allocation cannot stand on an unsigned subscription. Import a subscriptions file showing the signed agreement, or an allocations file that removes the allocation.",
  },
  UNSIGNED_NO_ALLOCATION: {
    title: "Unsigned subscription",
    severity: "review",
    resolution: "document",
    guidance: "The subscription is not signed and has no allocation, so it is left out of the register. Document why.",
  },
  UNFUNDED_ALLOCATION: {
    title: "Unfunded allocation",
    severity: "blocker",
    resolution: "source",
    guidance:
      "No cleared funding supports this allocation. Import funding that shows the cleared payment, or an allocations file that removes the allocation. A note cannot make it valid.",
  },
  PARTIAL_FUNDING: {
    title: "Partial funding",
    severity: "blocker",
    resolution: "source",
    guidance:
      "Cleared funding is below the approved amount. Import the remaining cleared funding, or an allocations file with the amount actually funded.",
  },
  EXCESS_FUNDING: {
    title: "Excess funding",
    severity: "review",
    resolution: "document",
    guidance:
      "Cleared funding is above the approved amount. The register uses the approved amount only. Document how the difference is handled; Close Desk does not initiate refunds.",
  },
  MISSING_ALLOCATION: {
    title: "Missing allocation",
    severity: "review",
    resolution: "document",
    guidance:
      "There is no approved allocation for this signed subscription, so it is left out of the register. Import the allocation if one was approved, or document why none exists.",
  },
  ALLOCATION_EXCEEDS_COMMITMENT: {
    title: "Allocation exceeds commitment",
    severity: "blocker",
    resolution: "source",
    guidance:
      "The approved amount is above what the investor signed for. Import the amended subscription or a corrected allocation.",
  },
  ALLOCATION_WITHOUT_SUBSCRIPTION: {
    title: "Allocation without subscription",
    severity: "blocker",
    resolution: "source",
    guidance:
      "The allocation names a subscription ID that is not in the subscriptions file. Import the missing subscription or a corrected allocations file.",
  },
  SHARE_CLASS_MISMATCH: {
    title: "Share class mismatch",
    severity: "blocker",
    resolution: "source",
    guidance:
      "The allocation is for a different share class than the subscription. Import a corrected subscriptions or allocations file.",
  },
  CURRENCY_MISMATCH: {
    title: "Currency mismatch",
    severity: "blocker",
    resolution: "source",
    guidance: "Amounts in different currencies are not netted or compared. Import source data in the offering currency.",
  },
  INVALID_REVERSAL: {
    title: "Invalid reversal",
    severity: "blocker",
    resolution: "source",
    guidance:
      "The reversal cannot be applied as supplied, so it is not netted. Import funding with a corrected reference to the original transaction.",
  },
  POSSIBLE_DUPLICATE: {
    title: "Possible duplicate transaction",
    severity: "review",
    resolution: "document",
    guidance:
      "Two cleared payments share the same amount and settlement date under different references. Confirm they are distinct payments, or exclude the duplicate from funding.",
  },
  UNMATCHED_FUNDING: {
    title: "Unmatched funding",
    severity: "review",
    resolution: "link_or_exclude",
    guidance:
      "The payment carries no subscription ID or mapped payment reference. Link it to a subscription, or exclude it if it does not belong to this offering.",
  },
  AMBIGUOUS_REFERENCE: {
    title: "Ambiguous reference",
    severity: "review",
    resolution: "link_or_exclude",
    guidance:
      "The payment's references point to more than one subscription. It is not matched automatically. Link it to the right subscription, or exclude it.",
  },
  EXCLUDED_FUNDING: {
    title: "Funding excluded by reviewer",
    severity: "review",
    resolution: "link_or_exclude",
    guidance: "A reviewer excluded this transaction, so it does not count toward funding.",
  },
  SOURCE_CONFLICT: {
    title: "Conflicting source record",
    severity: "review",
    resolution: "conflict",
    guidance:
      "A later import supplied different content under the same reference. The original record is unchanged. Choose which version stands.",
  },
};

export function isDocumentable(code: ExceptionCode): boolean {
  return EXCEPTION_META[code].resolution === "document";
}
