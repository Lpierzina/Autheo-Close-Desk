import type { Metadata } from "next";
import { SampleDownload } from "@/components/sample-download";
import { ButtonLink, Callout, Card, CardHeader, PageHeader, Td, Th } from "@/components/ui";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domain/csv";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { SAMPLE_CORRECTION_FILES, SAMPLE_SOURCE_FILES } from "@/session/sample";

export const metadata: Metadata = { title: "File guide" };

const QUESTION: Record<FileKind, string> = {
  subscriptions: "Did they sign?",
  funding: "Did their money clear?",
  allocations: "How many LLC units did the sponsor approve?",
};

const INTRO: Record<FileKind, string> = {
  subscriptions:
    "One row per subscription agreement and share class. This file says who committed, to what, and whether the agreement is signed.",
  funding:
    "One row per bank or escrow transaction. Several payments can belong to one subscription. A reversal is its own row and names the transaction it reverses.",
  allocations:
    "One row per subscription the sponsor approved. Approved amount and approved units are taken exactly as supplied; units are never calculated from money.",
};

const NOTES: Record<FileKind, string[]> = {
  subscriptions: [
    "Signature status accepts signed, pending or declined (also: executed, unsigned, not signed, rejected).",
    "If your bank file carries a payment reference instead of the subscription ID, add it here as the payment reference. That is the only way a payment is matched without a subscription ID.",
  ],
  funding: [
    "Settlement status accepts cleared, pending, failed or reversed (also: settled, completed, returned).",
    "Only cleared rows count. A cleared row needs a settlement date (2026-10-27, 10/27/2026 or an ISO timestamp).",
    "A reversal row carries the original transaction reference and reduces that transaction. Its amount may be written as positive or negative. A negative amount without an original transaction reference is rejected.",
    "The file must have a subscription ID column, a payment reference column, or both. A row whose references match no subscription is added and shown as unmatched, for you to link or exclude.",
  ],
  allocations: [
    "An approved amount of zero with zero units records that nothing was allocated.",
    "The share class must be the one on the subscription.",
  ],
};

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        title="File guide"
        description="What each of the three CSV files must contain, with sample files to download. Your column names can differ: you map them when you select a file."
        actions={
          <ButtonLink href="/reconcile" variant="primary">
            Start a reconciliation
          </ButtonLink>
        }
      />

      <Callout tone="info" title="The sample files are synthetic">
        They describe a fictional $5,000,000 raise, Riverbend Flats Apartments. Investor references, amounts and bank references are invented. The
        files are built into this site, so downloading one makes no request.
      </Callout>

      <Card>
        <CardHeader title="Format rules for every file" />
        <ul className="grid gap-x-10 gap-y-2 px-5 py-4 text-[13px] text-ink-2 md:grid-cols-2">
          <li>CSV with a header row, UTF-8 encoded, .csv extension.</li>
          <li className="num">
            Up to {Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB and {MAX_IMPORT_ROWS.toLocaleString("en-US")} rows per file.
          </li>
          <li className="num">Amounts with at most two decimal places: 100000.00, 100,000.00 or $100,000.00.</li>
          <li className="num">Units with at most eight decimal places: 90 or 1320.4.</li>
          <li>Currency as a three-letter code, such as USD. Amounts in different currencies are never netted.</li>
          <li>Identifiers match exactly, ignoring upper and lower case. Names and amounts are never used to match.</li>
          <li>Adding a file again does not double-count: identical rows are recognised and skipped.</li>
          <li>A row that changes a record already in the workspace goes to review. The original is not overwritten.</li>
        </ul>
      </Card>

      {FILE_KINDS.map((kind, index) => (
        <Card key={kind} aria-labelledby={`${kind}-heading`}>
          <CardHeader
            title={
              <span id={`${kind}-heading`}>
                <span className="num mr-2 text-ink-3">{index + 1}</span>
                {QUESTION[kind]} <span className="font-normal text-ink-3">· {FILE_KIND_LABEL[kind]}</span>
              </span>
            }
            description={INTRO[kind]}
            action={<SampleDownload filename={SAMPLE_SOURCE_FILES[kind]}>Sample CSV</SampleDownload>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th className="w-[20%] pl-5">Field</Th>
                  <Th className="w-[18%]">Column in the sample</Th>
                  <Th className="w-[10%]">Required</Th>
                  <Th>What it means</Th>
                  <Th className="w-[14%] pr-5">Example</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {IMPORT_FIELDS[kind].map((field) => (
                  <tr key={field.key}>
                    <Td className="pl-5 font-medium">{field.label}</Td>
                    <Td>
                      <code className="rounded bg-paper-2 px-1.5 py-0.5 text-xs text-ink-2">{field.key}</code>
                    </Td>
                    <Td className={field.required ? "text-ink" : "text-ink-3"}>{field.required ? "Required" : "Optional"}</Td>
                    <Td className="leading-relaxed text-ink-2">{field.description}</Td>
                    <Td className="num pr-5 text-ink-2">{field.example}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-1 border-t border-line py-4 pl-10 pr-5 text-[13px] text-ink-2">
            {NOTES[kind].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      ))}

      <Card>
        <CardHeader
          title="Correction files for the sample deal"
          description="Select these after the three sample files to see how corrected source data clears blockers. The funding file uses a bank portal's column names, so it also shows column mapping."
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {SAMPLE_CORRECTION_FILES.map((file) => (
            <SampleDownload key={file.filename} filename={file.filename}>
              {file.label}
            </SampleDownload>
          ))}
        </div>
      </Card>
    </main>
  );
}
