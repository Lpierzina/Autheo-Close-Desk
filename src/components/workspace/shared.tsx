import type { FileKind } from "@/domain/types";

/** The three files, each named by the question it answers. */
export const SLOT: Record<FileKind, { question: string; source: string; rule: string }> = {
  subscriptions: {
    question: "Did they sign?",
    source: "Subscription records",
    rule: "One row per subscription agreement and share class.",
  },
  funding: {
    question: "Did their money clear?",
    source: "Bank or escrow records",
    rule: "One row per transaction. Needs a subscription ID column, a payment reference column, or both.",
  },
  allocations: {
    question: "How many LLC units did the sponsor approve?",
    source: "Approved allocations",
    rule: "One row per approved subscription. Units are taken as supplied, never calculated.",
  },
};

export type Step = "select" | "review" | "resolve" | "export";

export const STEPS: { id: Step; label: string }[] = [
  { id: "select", label: "Select files" },
  { id: "review", label: "Review matches" },
  { id: "resolve", label: "Resolve exceptions" },
  { id: "export", label: "Export" },
];

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const STAMP = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Local time of day. Session events all happen in this tab, so the reviewer's own clock is the natural reference. */
export function clock(iso: string): string {
  return CLOCK.format(new Date(iso));
}

export function stamp(iso: string): string {
  return STAMP.format(new Date(iso));
}
