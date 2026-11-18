import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileSpreadsheet } from "lucide-react";
import { DemoGuide } from "@/components/demo-guide";
import { ButtonLink, Callout, Card, CardHeader, Pill, cx } from "@/components/ui";
import { formatMoney, formatUnits } from "@/domain/money";
import { FILE_KINDS, FILE_KIND_LABEL } from "@/domain/types";
import { formatDateTime, plural, timeAgo } from "@/lib/format";
import { pageOffering, pageReadiness, pageWorkingState } from "@/server/page";

export const metadata: Metadata = { title: "Close overview" };

export default async function OverviewPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const { access } = await pageOffering(offeringId);
  const { offering } = access;
  const state = await pageWorkingState(offering);
  const readiness = await pageReadiness(offering);
  const { summary } = state.result;
  const base = `/offerings/${offering.id}`;
  const money = (value: string) => formatMoney(value, summary.currency);
  const hasData = state.filesImported > 0;
  const { latest, workingMatchesLatest } = readiness;

  const next = (() => {
    if (latest && workingMatchesLatest) {
      return {
        tone: "ok" as const,
        title: `Close approved as version ${latest.version}`,
        body: `Approved by ${latest.approvedBy} on ${formatDateTime(latest.approvedAt)}. The register and exception report are frozen and ready to download.`,
        href: `${base}/approval`,
        action: "Go to downloads",
      };
    }
    if (readiness.missingFiles.length > 0) {
      return {
        tone: "info" as const,
        title: hasData ? `Import the remaining ${plural(readiness.missingFiles.length, "file")}` : "Import the three source files",
        body: `Still needed: ${readiness.missingFiles.map((k) => FILE_KIND_LABEL[k]).join(", ")}.`,
        href: `${base}/imports`,
        action: "Go to imports",
      };
    }
    if (summary.openBlockers > 0 || summary.openReviews > 0) {
      return {
        tone: summary.openBlockers > 0 ? ("danger" as const) : ("warn" as const),
        title: `${plural(summary.openBlockers, "blocker")} and ${plural(summary.openReviews, "item")} to review before approval`,
        body: "Blockers need corrected source data. Review items need a documented reviewer decision.",
        href: `${base}/reconciliation?sort=status`,
        action: "Review exceptions",
      };
    }
    return {
      tone: "ok" as const,
      title: latest ? "Changes since the last approval are ready for a new version" : "Ready for approval",
      body: "Every row is ready or has a documented decision. An approver can review the close summary and freeze the register.",
      href: `${base}/approval`,
      action: "Review close summary",
    };
  })();

  const statusTiles = [
    { label: "Ready", count: summary.counts.ready, filter: "ready", dot: "bg-accent", text: "text-ink", note: "Matched, or documented by a reviewer" },
    { label: "Needs review", count: summary.counts.needsReview, filter: "needs_review", dot: "bg-warn", text: summary.counts.needsReview > 0 ? "text-warn" : "text-ink", note: "Waiting for a reviewer decision" },
    { label: "Blocked", count: summary.counts.blocked, filter: "blocked", dot: "bg-danger", text: summary.counts.blocked > 0 ? "text-danger" : "text-ink", note: "Needs corrected source data" },
  ];

  const totals = [
    {
      label: "Signed commitments",
      value: summary.signedCommitments,
      note: "Requested amounts on signed subscriptions",
      source: "Subscriptions file",
    },
    {
      label: "Net cleared funding",
      value: summary.netClearedFunding,
      note: "Cleared payments matched to a subscription, net of linked reversals",
      source: "Funding file",
    },
    {
      label: "Approved allocations",
      value: summary.approvedAllocations,
      note: "Approved amounts in the allocations file",
      source: "Allocations file",
    },
  ];

  const steps = [
    { label: "Create offering", done: true },
    { label: "Import three files", done: readiness.missingFiles.length === 0 },
    { label: "Reconcile", done: readiness.missingFiles.length === 0 },
    { label: "Review exceptions", done: readiness.missingFiles.length === 0 && readiness.openItems.length === 0 },
    { label: "Approve and freeze", done: Boolean(latest && workingMatchesLatest) },
    { label: "Export", done: Boolean(latest && workingMatchesLatest) },
  ];
  const currentStep = steps.findIndex((s) => !s.done);

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Close overview</h1>

      <ol aria-label="Close progress" className="flex flex-wrap gap-x-2 gap-y-2 text-[13px]">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-2" aria-current={index === currentStep ? "step" : undefined}>
            <span
              className={cx(
                "num flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                step.done ? "border-accent bg-accent text-white" : index === currentStep ? "border-ink text-ink" : "border-line-strong text-ink-3",
              )}
            >
              {step.done ? <Check aria-hidden className="h-3 w-3" /> : index + 1}
            </span>
            <span className={cx(step.done ? "text-ink-2" : index === currentStep ? "font-medium text-ink" : "text-ink-3")}>
              {step.label}
              <span className="sr-only">{step.done ? " (done)" : index === currentStep ? " (current step)" : ""}</span>
            </span>
            {index < steps.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-line-strong" /> : null}
          </li>
        ))}
      </ol>

      <Callout tone={next.tone} title={next.title}>
        <p>{next.body}</p>
        <Link href={next.href} className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-2">
          {next.action}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </Callout>

      {offering.isDemo ? <DemoGuide offeringId={offering.id} state={state} readiness={readiness} /> : null}

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Reconciliation status
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {statusTiles.map((tile) => (
            <Link
              key={tile.label}
              href={`${base}/reconciliation?status=${tile.filter}`}
              className="group rounded-lg border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong"
            >
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
                <span aria-hidden className={cx("h-2 w-2 rounded-full", tile.dot)} />
                {tile.label}
              </div>
              <p className={cx("num mt-2 text-[28px] font-semibold leading-none tracking-tight", tile.text)}>{tile.count.toLocaleString("en-US")}</p>
              <p className="mt-2 text-xs text-ink-3">{tile.note}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="totals-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="totals-heading" className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            Three totals, three sources
          </h2>
          <p className="text-xs text-ink-3">These are different measures. They are shown side by side and never combined.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {totals.map((total) => (
            <Card key={total.label} className="px-5 py-4">
              <p className="text-[13px] font-medium text-ink-2">{total.label}</p>
              <p className="num mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{hasData ? money(total.value) : "—"}</p>
              <p className="mt-2 text-xs text-ink-3">{total.note}</p>
              <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-3">Source: {total.source}</p>
            </Card>
          ))}
        </div>
        {hasData ? (
          <dl className="mt-4 grid gap-x-8 gap-y-3 rounded-lg border border-line bg-surface px-5 py-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-ink-3">Pending funding, not counted</dt>
              <dd className="num mt-0.5 font-medium text-ink">{money(summary.pendingFunding)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Cleared funding not matched to a subscription</dt>
              <dd className={cx("num mt-0.5 font-medium", summary.unmatchedCleared === "0.00" ? "text-ink" : "text-warn")}>{money(summary.unmatchedCleared)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Cleared funding above approved amounts</dt>
              <dd className="num mt-0.5 font-medium text-ink">{money(summary.excessOverApproved)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Draft register</dt>
              <dd className="num mt-0.5 font-medium text-ink">
                {money(summary.registerAmount)} · {plural(summary.registerLineCount, "line")}
              </dd>
            </div>
            {summary.unitsByClass.map((c) => (
              <div key={c.shareClass}>
                <dt className="text-ink-3">{c.shareClass} in draft register</dt>
                <dd className="num mt-0.5 font-medium text-ink">
                  {formatUnits(c.approvedUnits)} units · {money(c.approvedAmount)}
                </dd>
              </div>
            ))}
            {summary.otherCurrencies.map((o) => (
              <div key={`${o.currency}-${o.label}`}>
                <dt className="text-ink-3">{o.label}, not netted</dt>
                <dd className="num mt-0.5 font-medium text-danger">{formatMoney(o.amount, o.currency)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <Card aria-labelledby="files-heading">
        <CardHeader
          title={<span id="files-heading">Source files</span>}
          description="The most recent import of each file. Earlier imports stay in the import history."
          action={
            <ButtonLink href={`${base}/imports`}>
              <FileSpreadsheet aria-hidden className="h-4 w-4" />
              {access.can.review ? "Import a file" : "Import history"}
            </ButtonLink>
          }
        />
        <ul className="divide-y divide-line">
          {FILE_KINDS.map((kind) => {
            const batch = state.latestBatch[kind];
            const staleAgainstSnapshot = Boolean(batch && latest && new Date(batch.importedAt) > new Date(latest.approvedAt));
            return (
              <li key={kind} className="grid items-center gap-x-6 gap-y-1 px-5 py-3.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                <p className="text-sm font-medium text-ink">{FILE_KIND_LABEL[kind]}</p>
                {batch ? (
                  <>
                    <div className="min-w-0 text-[13px]">
                      <p className="truncate text-ink">{batch.filename}</p>
                      <p className="text-ink-3">
                        <span title={formatDateTime(batch.importedAt)}>Imported {timeAgo(batch.importedAt)}</span> by {batch.importedBy} ·{" "}
                        <span className="num">{plural(batch.counts.rowCount, "row")}</span>
                        {batch.counts.invalidCount > 0 ? (
                          <span className="num text-warn"> · {plural(batch.counts.invalidCount, "invalid row")} left out</span>
                        ) : null}
                      </p>
                    </div>
                    {staleAgainstSnapshot ? <Pill tone="warn">Newer than v{latest?.version}</Pill> : <Pill tone="ok">Imported</Pill>}
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-ink-3">Not imported yet</p>
                    <Pill tone="warn">Missing</Pill>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
