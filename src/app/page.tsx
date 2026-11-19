import Link from "next/link";
import { ArrowRight, Banknote, FileSignature, PieChart } from "lucide-react";
import { PrivacyNote } from "@/components/notes";
import { StartActions } from "@/components/start-actions";
import { Pill } from "@/components/ui";
import { explainRow } from "@/domain/explain";
import { formatMoney, formatSignedMoney, formatUnits } from "@/domain/money";
import { commitStaged, setSkipInvalidRows, viewOf } from "@/session/engine";
import { startSampleSession } from "@/session/sample";

const QUESTIONS = [
  { question: "Did they sign?", source: "Subscription records", icon: FileSignature },
  { question: "Did their money clear?", source: "Bank or escrow records", icon: Banknote },
  { question: "How many LLC units did the sponsor approve?", source: "Approved allocations", icon: PieChart },
] as const;

const STEPS = [
  { title: "Select files", body: "Three CSV files, one per question. Preview row counts and validation errors, and map columns if your headers differ." },
  { title: "Review matches", body: "Signed subscriptions, net cleared funds and approved allocations as three separate totals, with every subscription listed." },
  { title: "Resolve exceptions", body: "Source records side by side, the difference in plain English, and a note for each review decision." },
  { title: "Export", body: "Confirm the reviewed snapshot, then download the register and a separate exceptions report as CSV." },
] as const;

const RULES = [
  {
    title: "Matched on references, never on names",
    body: "A payment is matched by its subscription ID, or by a payment reference your subscriptions file ties to exactly one subscription. A name or an equal amount is never enough.",
  },
  {
    title: "Exact decimal arithmetic",
    body: "Split wires, pending funds, reversals and duplicate rows are netted to the cent. Re-adding a file never counts a wire twice.",
  },
  {
    title: "The sponsor's approved units stand",
    body: "Approved amounts and units come from the allocations file only. A funded amount never overwrites them, and a different version goes to review.",
  },
] as const;

/** The worked example on this page is computed from the bundled sample files when the site is built. */
function guidedExample() {
  const sample = commitStaged(setSkipInvalidRows(startSampleSession(), "funding", true)).state;
  const row = viewOf(sample).result.rows.find((r) => r.key === "SUB-1012::CLASS A");
  if (!row || !row.requestedAmount || !row.netCleared || !row.approvedAmount || !row.approvedUnits || !row.variance) {
    throw new Error("The sample files no longer contain the guided example SUB-1012.");
  }
  const wires = row.funding.filter((line) => line.treatment === "counted").map((line) => formatMoney(line.record.data.amount, "USD"));
  return {
    investor: row.investorRef,
    subscription: row.subscriptionId,
    shareClass: row.shareClass,
    signed: formatMoney(row.requestedAmount, "USD"),
    cleared: formatMoney(row.netCleared, "USD"),
    wires,
    approved: formatMoney(row.approvedAmount, "USD"),
    units: formatUnits(row.approvedUnits),
    variance: formatSignedMoney(row.variance, "USD"),
    difference: explainRow(row, "USD").difference,
  };
}

export default function HomePage() {
  const example = guidedExample();

  return (
    <main>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">Autheo Close Desk</p>
            <h1 className="mt-3 max-w-xl text-[34px] font-semibold leading-[1.12] tracking-tight text-navy-900 sm:text-[44px]">
              Reconcile your apartment equity raise before closing.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-2">
              For multifamily sponsors and investor operations teams. Compare your subscription, funding, and allocation files, review what doesn&apos;t
              match, and download an ownership register for your administrator.
            </p>
            <div className="mt-8">
              <StartActions />
            </div>
            <PrivacyNote className="mt-5 max-w-xl" />
          </div>

          <figure aria-labelledby="example-caption" className="rounded-xl border border-line bg-paper shadow-[0_20px_50px_-30px_rgba(13,27,51,0.35)]">
            <figcaption id="example-caption" className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
              <span className="text-[13px] font-medium text-ink">
                <span className="num">{example.subscription}</span> · {example.shareClass}
                <span className="ml-2 font-normal text-ink-3">Synthetic example</span>
              </span>
              <Pill tone="warn">Needs review</Pill>
            </figcaption>
            <dl className="divide-y divide-line text-sm">
              <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                <dt className="text-ink-2">Signed</dt>
                <dd className="num font-semibold text-ink">{example.signed}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                <dt className="text-ink-2">
                  Cleared
                  <span className="num block text-xs text-ink-3">
                    {example.wires.length} wires: {example.wires.join(" + ")}
                  </span>
                </dt>
                <dd className="num font-semibold text-ink">{example.cleared}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 px-5 py-3">
                <dt className="text-ink-2">
                  Approved by the sponsor
                  <span className="num block text-xs text-ink-3">{example.units} units</span>
                </dt>
                <dd className="num font-semibold text-ink">{example.approved}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 bg-warn-soft px-5 py-3">
                <dt className="font-medium text-warn">Variance to review</dt>
                <dd className="num font-semibold text-warn">{example.variance}</dd>
              </div>
            </dl>
            <p className="border-t border-line px-5 py-4 text-[13px] leading-relaxed text-ink-2">
              {example.difference} Close Desk explains the difference, requires a review, and exports only the approved{" "}
              <span className="num font-medium text-ink">
                {example.approved} · {example.units} units
              </span>
              . It never moves money, issues units, or initiates a refund.
            </p>
          </figure>
        </div>
      </section>

      <section aria-labelledby="questions-heading" className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
        <h2 id="questions-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">
          Three questions, three files
        </h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {QUESTIONS.map(({ question, source, icon: Icon }, index) => (
            <li key={question} className="flex flex-col rounded-lg border border-line bg-surface p-6">
              <div className="flex items-center justify-between">
                <span className="num flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-[13px] font-semibold text-white">{index + 1}</span>
                <Icon aria-hidden className="h-5 w-5 text-accent" />
              </div>
              <p className="mt-5 text-xl font-semibold leading-snug tracking-tight text-navy-900">{question}</p>
              <p className="mt-auto pt-4 text-sm text-ink-2">{source}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="steps-heading" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
          <h2 id="steps-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">
            How a reconciliation runs
          </h2>
          <ol className="mt-5 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-t-2 border-navy-900 pt-4">
                <p className="num text-xs font-medium text-ink-3">Step {index + 1}</p>
                <p className="mt-1 text-[15px] font-semibold text-ink">{step.title}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
          <dl className="mt-12 grid gap-6 border-t border-line pt-8 md:grid-cols-3">
            {RULES.map((rule) => (
              <div key={rule.title}>
                <dt className="text-sm font-semibold text-ink">{rule.title}</dt>
                <dd className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{rule.body}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-paper px-5 py-4">
            <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
              The result is a reviewed register export for your administrator, not the official legal register.
            </p>
            <StartActions size="md" />
          </div>
        </div>
      </section>

      <section aria-labelledby="tokenization-heading" className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-lg border border-dashed border-line-strong px-5 py-4">
          <div className="max-w-2xl">
            <h2 id="tokenization-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              Custom tokenization
              <Pill>Coming soon</Pill>
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              A reviewed ownership register could inform future token issuance. Close Desk itself is an off-chain reconciliation tool.
            </p>
          </div>
          <Link prefetch={false} href="/tokenization" className="inline-flex items-center gap-1 rounded text-sm font-medium text-accent-strong underline-offset-2 hover:underline">
            Learn more
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </main>
  );
}
