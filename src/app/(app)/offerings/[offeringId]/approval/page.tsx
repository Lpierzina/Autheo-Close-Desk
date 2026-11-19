import type { Metadata } from "next";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { ApproveForm } from "@/components/approve-form";
import { Callout, Card, CardHeader, EmptyState, Pill, Td, Th, buttonClass } from "@/components/ui";
import { formatMoney, formatUnits } from "@/domain/money";
import { FILE_KINDS, FILE_KIND_LABEL } from "@/domain/types";
import { formatDateTime, plural } from "@/lib/format";
import { pageOffering, pageReadiness, pageWorkingState } from "@/server/page";

export const metadata: Metadata = { title: "Approval and export" };

const REGISTER_PREVIEW_ROWS = 100;

export default async function ApprovalPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const { access } = await pageOffering(offeringId);
  const { offering } = access;
  const state = await pageWorkingState(offering);
  const readiness = await pageReadiness(offering);
  const { summary } = readiness;
  const base = `/offerings/${offering.id}`;
  const api = `/api/offerings/${offering.id}`;
  const money = (value: string) => formatMoney(value, summary.currency);
  const blockers = readiness.openItems.filter((item) => item.severity === "blocker");
  const reviews = readiness.openItems.filter((item) => item.severity === "review");
  const documented = state.result.rows.flatMap((row) => row.exceptions).filter((e) => e.state !== "open").length;
  const nextVersion = (readiness.latest?.version ?? 0) + 1;
  const upToDate = Boolean(readiness.latest && readiness.workingMatchesLatest);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Approval and export</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-2">
          Approval freezes a numbered version of the register and the exception report. Downloads always serve the frozen files.
        </p>
      </div>

      <Callout tone="info" title="For the sponsor's administrator to accept">
        The export is a reviewed input for the sponsor&apos;s administrator. It is not itself the official legal register, and Close
        Desk does not move money or issue units.
      </Callout>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card aria-labelledby="summary-heading">
          <CardHeader
            title={<span id="summary-heading">{upToDate ? `Close summary · version ${readiness.latest?.version}` : `Close summary · draft of version ${nextVersion}`}</span>}
            description={upToDate ? "The working data matches the approved version." : "What would be frozen if the close were approved now."}
            action={upToDate ? <Pill tone="ok"><Lock aria-hidden className="h-3 w-3" />Frozen</Pill> : <Pill>Draft</Pill>}
          />
          <dl className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
            {[
              { label: "Signed commitments", value: money(summary.signedCommitments) },
              { label: "Net cleared funding", value: money(summary.netClearedFunding) },
              { label: "Approved allocations", value: money(summary.approvedAllocations) },
            ].map((item) => (
              <div key={item.label} className="bg-surface px-5 py-4">
                <dt className="text-xs text-ink-3">{item.label}</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
          <dl className="grid gap-x-8 gap-y-3 border-t border-line px-5 py-4 text-[13px] sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Register total</dt>
              <dd className="num font-semibold text-ink">{money(summary.registerAmount)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Register lines</dt>
              <dd className="num font-semibold text-ink">{summary.registerLineCount.toLocaleString("en-US")}</dd>
            </div>
            {summary.unitsByClass.map((c) => (
              <div key={c.shareClass} className="flex justify-between gap-4">
                <dt className="text-ink-2">{c.shareClass}</dt>
                <dd className="num text-ink">
                  {formatUnits(c.approvedUnits)} units · {money(c.approvedAmount)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Rows ready / needs review / blocked</dt>
              <dd className="num text-ink">
                {summary.counts.ready} / {summary.counts.needsReview} / {summary.counts.blocked}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Exceptions documented or resolved by reviewers</dt>
              <dd className="num text-ink">{documented}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Cleared funding above approved amounts</dt>
              <dd className="num text-ink">{money(summary.excessOverApproved)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Cleared funding not matched</dt>
              <dd className="num text-ink">{money(summary.unmatchedCleared)}</dd>
            </div>
          </dl>
          <div className="border-t border-line px-5 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Source files behind this summary</h3>
            <ul className="mt-2 space-y-1 text-[13px]">
              {FILE_KINDS.map((kind) => {
                const batch = state.latestBatch[kind];
                return (
                  <li key={kind} className="flex flex-wrap justify-between gap-x-4">
                    <span className="text-ink-2">{FILE_KIND_LABEL[kind]}</span>
                    {batch ? (
                      <span className="num text-ink">
                        {batch.filename} · {formatDateTime(batch.importedAt)}
                      </span>
                    ) : (
                      <span className="font-medium text-warn">Not imported</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <div className="space-y-6">
          <Card aria-labelledby="approve-heading">
            <CardHeader title={<span id="approve-heading">Approve the close</span>} description="Approval is checked again on the server when you submit." />
            <div className="space-y-4 px-5 py-5">
              {readiness.canApprove ? (
                access.can.approve ? (
                  <ApproveForm
                    offeringId={offering.id}
                    fingerprint={readiness.fingerprint}
                    nextVersion={nextVersion}
                    registerLines={summary.registerLineCount}
                    registerAmount={money(summary.registerAmount)}
                  />
                ) : (
                  <Callout tone="info" title="Ready for an approver">
                    Every row is ready or documented. Only a member with the approver role on this offering can approve.
                    {access.role === "reviewer" ? " Reviewers cannot approve their own review." : ""}
                  </Callout>
                )
              ) : upToDate ? (
                <Callout tone="ok" title={`Version ${readiness.latest?.version} is approved`}>
                  Nothing has changed since it was approved. A new version becomes possible after a new import or decision.
                </Callout>
              ) : (
                <Callout tone={blockers.length > 0 ? "danger" : "warn"} title="This close cannot be approved yet">
                  <ul className="list-disc pl-4">
                    {readiness.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </Callout>
              )}
              {readiness.latest && !readiness.workingMatchesLatest ? (
                <Callout tone="warn" title={`Data has changed since version ${readiness.latest.version}`}>
                  Version {readiness.latest.version} is unchanged and still downloadable. The changes only take effect in a new approved
                  version.
                </Callout>
              ) : null}
            </div>
          </Card>

          {readiness.openItems.length > 0 ? (
            <Card aria-labelledby="open-heading">
              <CardHeader
                title={<span id="open-heading">Open items</span>}
                description={`${plural(blockers.length, "blocker")} and ${plural(reviews.length, "review item")} stand between this close and approval.`}
              />
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {[...blockers, ...reviews].map((item) => (
                  <li key={`${item.rowKey}-${item.code}-${item.message}`}>
                    <Link href={`${base}/reconciliation?row=${encodeURIComponent(item.rowKey)}`} className="block px-5 py-3 hover:bg-paper-2/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-[13px] font-medium text-ink">{item.label}</span>
                        <Pill tone={item.severity === "blocker" ? "danger" : "warn"}>{item.severity === "blocker" ? "Blocker" : "Needs review"}</Pill>
                      </div>
                      <p className="num mt-0.5 text-[13px] text-ink-2">
                        {item.title}. {item.message}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <Card aria-labelledby="versions-heading">
        <CardHeader
          title={<span id="versions-heading">Approved versions</span>}
          description="Each version is frozen at approval. The files below are the exact bytes stored then."
          action={
            <a href={`${api}/exports/exceptions-draft`} download className={buttonClass("secondary")}>
              <Download aria-hidden className="h-4 w-4" />
              Draft exception report
            </a>
          }
        />
        {readiness.snapshots.length === 0 ? (
          <EmptyState
            icon={<Lock aria-hidden className="h-7 w-7" />}
            title="No approved version yet"
            description="The ownership register can be downloaded once an approver has approved the close. The draft exception report is available now."
          />
        ) : (
          <ul className="divide-y divide-line">
            {readiness.snapshots.map((snapshot) => (
              <li key={snapshot.id} className="grid gap-x-8 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">Version {snapshot.version}</span>
                    {snapshot.id === readiness.latest?.id ? <Pill tone="ok">Latest</Pill> : <Pill>Superseded</Pill>}
                  </div>
                  <p className="mt-1 text-[13px] text-ink-2">
                    Approved by <span className="font-medium text-ink">{snapshot.approvedBy}</span> ({snapshot.approvedByEmail}) on{" "}
                    {formatDateTime(snapshot.approvedAt)}
                  </p>
                  <p className="num mt-0.5 text-[13px] text-ink-2">
                    {plural(snapshot.summary.recon.registerLineCount, "register line")} · {formatMoney(snapshot.summary.recon.registerAmount, snapshot.summary.recon.currency)} ·{" "}
                    {plural(snapshot.summary.documentedExceptions, "documented exception")}
                  </p>
                  {snapshot.approvalNote ? <p className="mt-1 text-[13px] text-ink-2">Note: {snapshot.approvalNote}</p> : null}
                  <p className="num mt-1 break-all text-xs text-ink-3">Register SHA-256 {snapshot.registerSha256}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`${api}/snapshots/${snapshot.version}/register.csv`} download className={buttonClass(snapshot.id === readiness.latest?.id ? "primary" : "secondary")}>
                    <Download aria-hidden className="h-4 w-4" />
                    Ownership register
                    <span className="sr-only"> version {snapshot.version}</span>
                  </a>
                  <a href={`${api}/snapshots/${snapshot.version}/exceptions.csv`} download className={buttonClass("secondary")}>
                    <Download aria-hidden className="h-4 w-4" />
                    Exception report
                    <span className="sr-only"> version {snapshot.version}</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="register-heading">
        <CardHeader
          title={<span id="register-heading">{upToDate ? "Register lines" : "Draft register lines"}</span>}
          description="Approved amount and units come from the allocations file only. Rows with an open blocker are left out."
        />
        {readiness.register.length === 0 ? (
          <EmptyState title="No register lines yet" description="Lines appear when a signed, funded subscription has an approved allocation." />
        ) : (
          <>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead className="sticky top-0 border-b border-line bg-paper">
                  <tr>
                    <Th className="pl-5">Investor ref</Th>
                    <Th>Share class</Th>
                    <Th>Subscription</Th>
                    <Th className="text-right">Approved amount</Th>
                    <Th className="pr-5 text-right">Approved units</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {readiness.register.slice(0, REGISTER_PREVIEW_ROWS).map((line) => (
                    <tr key={`${line.subscriptionId}-${line.shareClass}`}>
                      <Td className="num pl-5 font-medium">{line.investorRef}</Td>
                      <Td>{line.shareClass}</Td>
                      <Td className="num text-ink-2">{line.subscriptionId}</Td>
                      <Td className="num text-right">{formatMoney(line.approvedAmount, line.currency)}</Td>
                      <Td className="num pr-5 text-right">{formatUnits(line.approvedUnits)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="num border-t border-line px-5 py-3 text-xs text-ink-3">
              {readiness.register.length > REGISTER_PREVIEW_ROWS ? `Showing the first ${REGISTER_PREVIEW_ROWS} of ` : ""}
              {plural(readiness.register.length, "line")} · {money(summary.registerAmount)}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
