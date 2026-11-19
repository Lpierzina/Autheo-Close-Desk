import type { Metadata } from "next";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { ButtonLink, Callout, Card, CardHeader, EmptyState, Pill, Td, Th } from "@/components/ui";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { formatMoney } from "@/domain/money";
import { FILE_KINDS, FILE_KIND_LABEL } from "@/domain/types";
import { formatDateTime, plural, timeAgo } from "@/lib/format";
import { pageOffering, pageWorkingState } from "@/server/page";

export const metadata: Metadata = { title: "Imports" };

const KIND_SUMMARY = {
  subscriptions: "What each investor signed for, by subscription and share class.",
  funding: "Payments received, with settlement status. Reversals reference the original transaction.",
  allocations: "What the sponsor approved for each subscription, in amount and units.",
} as const;

export default async function ImportsPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const { access } = await pageOffering(offeringId);
  const state = await pageWorkingState(access.offering);
  const base = `/offerings/${access.offering.id}`;
  const leftOut = state.batches.filter((batch) => batch.invalidRows.length > 0);
  // The first total of a file in the offering currency: requested, gross cleared payments, or approved.
  const batchTotal = (totals: { currency: string; amount: string }[]) => {
    const total = totals.find((t) => t.currency === access.offering.currency) ?? totals[0];
    return total ? formatMoney(total.amount, total.currency) : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Imports</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-ink-2">
            Import each CSV file, map its columns, and check the preview before anything is saved. Importing the same file
            again never counts a record twice.
          </p>
        </div>
        <ButtonLink href="/guide">
          <Download aria-hidden className="h-4 w-4" />
          Field guide and sample files
        </ButtonLink>
      </div>

      {!access.can.review ? (
        <Callout tone="info" title="Only reviewers on this offering can import files">
          You can see the import history. Ask a workspace administrator to add you as a reviewer to import.
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {FILE_KINDS.map((kind) => {
          const batch = state.latestBatch[kind];
          const required = IMPORT_FIELDS[kind].filter((f) => f.required).length;
          return (
            <Card key={kind} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-ink">{FILE_KIND_LABEL[kind]}</h2>
                {batch ? <Pill tone="ok">Imported</Pill> : <Pill tone="warn">Missing</Pill>}
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{KIND_SUMMARY[kind]}</p>
              <div className="mt-4 flex-1 border-t border-line pt-4 text-[13px]">
                {batch ? (
                  <dl className="space-y-1.5">
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-3">Latest file</dt>
                      <dd className="truncate text-ink">{batch.filename}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-3">Imported</dt>
                      <dd className="text-ink" title={formatDateTime(batch.importedAt)}>
                        {timeAgo(batch.importedAt)} by {batch.importedBy}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-3">Rows</dt>
                      <dd className="num text-ink">
                        {batch.counts.rowCount.toLocaleString("en-US")}
                        {batch.counts.invalidCount > 0 ? <span className="text-warn"> · {batch.counts.invalidCount} invalid</span> : null}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-ink-3">
                    Not imported yet. {required} required {required === 1 ? "column" : "columns"}; your column names can differ.
                  </p>
                )}
              </div>
              {access.can.review ? (
                <ButtonLink href={`${base}/imports/${kind}`} variant={batch ? "secondary" : "primary"} className="mt-5">
                  <Upload aria-hidden className="h-4 w-4" />
                  {batch ? "Import a newer file" : `Import ${FILE_KIND_LABEL[kind].toLowerCase()}`}
                </ButtonLink>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Card aria-labelledby="history-heading">
        <CardHeader
          title={<span id="history-heading">Import history</span>}
          description="Every committed batch. Batches are never edited or deleted."
        />
        {state.batches.length === 0 ? (
          <EmptyState
            title="No files imported yet"
            description="Start with the subscriptions file. Sample files with synthetic data are available in the field guide."
            action={
              <Link href="/guide" className="text-sm font-medium text-accent-strong underline underline-offset-2">
                Open the field guide
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th>Imported</Th>
                  <Th>File</Th>
                  <Th>Type</Th>
                  <Th>By</Th>
                  <Th className="text-right">Rows</Th>
                  <Th className="text-right">New</Th>
                  <Th className="text-right">Unchanged</Th>
                  <Th className="text-right">Conflicts</Th>
                  <Th className="text-right">Invalid</Th>
                  <Th className="text-right">Batch total</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {state.batches.map((batch) => (
                  <tr key={batch.id}>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(batch.importedAt)}</Td>
                    <Td className="max-w-[260px] truncate font-medium">{batch.filename}</Td>
                    <Td>{FILE_KIND_LABEL[batch.kind]}</Td>
                    <Td className="text-ink-2">{batch.importedBy}</Td>
                    <Td className="num text-right">{batch.counts.rowCount}</Td>
                    <Td className="num text-right">{batch.counts.newCount}</Td>
                    <Td className="num text-right text-ink-2">{batch.counts.unchangedCount + batch.counts.duplicateCount}</Td>
                    <Td className={`num text-right ${batch.counts.conflictCount > 0 ? "font-medium text-warn" : "text-ink-2"}`}>{batch.counts.conflictCount}</Td>
                    <Td className={`num text-right ${batch.counts.invalidCount > 0 ? "font-medium text-warn" : "text-ink-2"}`}>{batch.counts.invalidCount}</Td>
                    <Td className="num whitespace-nowrap text-right">{batchTotal(batch.totals.totals)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.batches.length > 0 ? (
          <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
            {plural(state.batches.length, "batch", "batches")}. Batch total is in {access.offering.currency}: requested amounts, gross
            cleared payments, or approved amounts.
          </p>
        ) : null}
      </Card>

      {leftOut.length > 0 ? (
        <Card aria-labelledby="left-out-heading">
          <CardHeader
            title={<span id="left-out-heading">Rows left out of imports</span>}
            description="Invalid rows a reviewer chose to leave out. They are not part of the reconciliation until a corrected file is imported."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th className="pl-5">File</Th>
                  <Th>Imported</Th>
                  <Th className="text-right">File row</Th>
                  <Th className="pr-5">Problem</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leftOut.flatMap((batch) =>
                  batch.invalidRows.map((row) => (
                    <tr key={`${batch.id}-${row.rowNumber}`}>
                      <Td className="pl-5 font-medium">{batch.filename}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{formatDateTime(batch.importedAt)}</Td>
                      <Td className="num text-right">{row.rowNumber}</Td>
                      <Td className="pr-5 text-warn">{row.errors.join(". ")}</Td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
