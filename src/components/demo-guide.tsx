import Link from "next/link";
import { Check } from "lucide-react";
import { formatMoney, sumMoney } from "@/domain/money";
import { rowKey } from "@/domain/types";
import type { CloseReadiness } from "@/server/services/approvals";
import type { WorkingState } from "@/server/services/reconciliation";
import { Card, CardHeader, cx } from "./ui";

const GUIDED_SUBSCRIPTION = "SUB-1012";
const GUIDED_CLASS = "Class A";

/** Walks the synthetic demo through one case, using the live reconciliation rather than canned numbers. */
export function DemoGuide({ offeringId, state, readiness }: { offeringId: string; state: WorkingState; readiness: CloseReadiness }) {
  const key = rowKey(GUIDED_SUBSCRIPTION, GUIDED_CLASS);
  const row = state.result.rows.find((r) => r.key === key);
  const base = `/offerings/${offeringId}`;
  const rowHref = `${base}/reconciliation?row=${encodeURIComponent(key)}`;

  if (!row) {
    return (
      <Card>
        <CardHeader title="Guided example" description="Import the three sample files to follow the guided example for subscription SUB-1012." />
      </Card>
    );
  }

  const currency = row.currency ?? state.result.summary.currency;
  const money = (value: string | null) => (value === null ? "—" : formatMoney(value, currency));
  const counted = row.funding.filter((line) => line.treatment === "counted" && !line.isReversal);
  const wires = sumMoney(counted.map((line) => line.record.data.amount));
  const excess = row.exceptions.find((e) => e.code === "EXCESS_FUNDING");
  const documented = excess ? excess.state !== "open" : false;
  const frozenLine = readiness.latest && readiness.workingMatchesLatest ? readiness.register.find((l) => l.subscriptionId === GUIDED_SUBSCRIPTION) : null;

  const steps = [
    {
      done: true,
      title: `${row.investorRef} signed for ${money(row.requestedAmount)}`,
      body: `Subscription ${GUIDED_SUBSCRIPTION}, ${row.shareClass}. From the subscriptions file.`,
    },
    {
      done: true,
      title: `${counted.length} cleared wires total ${money(wires)}`,
      body: `${counted.map((line) => `${line.record.data.transaction_ref} ${money(line.record.data.amount)}`).join(" and ")}. Both carry the subscription ID, so they are matched without guessing.`,
    },
    {
      done: true,
      title: `The sponsor approved ${money(row.approvedAmount)}`,
      body: `Cleared funding is ${money(excess?.variance ?? row.variance)} above the approved allocation. The row is flagged as excess funding.`,
    },
    {
      done: documented,
      title: documented ? "A reviewer documented the variance" : "A reviewer documents the variance",
      body: "The note records how the difference is handled outside this system. Close Desk does not initiate a refund or move money.",
    },
    {
      done: Boolean(frozenLine),
      title: `The register carries ${money(row.approvedAmount)} only`,
      body: frozenLine
        ? `Approved version ${readiness.latest?.version} lists ${frozenLine.investorRef} with ${money(frozenLine.approvedAmount)} and ${frozenLine.approvedUnits} units.`
        : "After approval, the export lists the approved amount and units. The funded amount is not used.",
    },
  ];

  return (
    <Card aria-labelledby="demo-guide-heading">
      <CardHeader
        title={<span id="demo-guide-heading">Guided example: a {money(excess?.variance ?? row.variance)} variance</span>}
        description="Synthetic data. One subscription followed from signature to register."
        action={
          <Link href={rowHref} className="whitespace-nowrap rounded-md border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-paper-2">
            Open {GUIDED_SUBSCRIPTION}
          </Link>
        }
      />
      <ol className="grid gap-x-6 gap-y-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 xl:block">
            <span
              className={cx(
                "num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold xl:mb-2.5",
                step.done ? "border-accent bg-accent text-white" : "border-line-strong text-ink-3",
              )}
            >
              {step.done ? <Check aria-hidden className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <div>
              <p className="num text-[13px] font-semibold text-ink">{step.title}</p>
              <p className="num mt-1 text-xs leading-relaxed text-ink-3">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
