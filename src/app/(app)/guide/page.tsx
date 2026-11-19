import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Callout, Card, CardHeader, PageHeader, Td, Th, buttonClass } from "@/components/ui";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domain/csv";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { pageUser } from "@/server/page";

export const metadata: Metadata = { title: "File guide" };

const INTRO: Record<FileKind, string> = {
  subscriptions:
    "One row per subscription agreement and share class. This file says who committed, to what, and whether the agreement is signed.",
  funding:
    "One row per bank transaction. Several payments can belong to one subscription. A reversal is its own row and names the transaction it reverses.",
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
    "The file must have a subscription ID column, a payment reference column, or both. A row whose references match no subscription is imported and shown as unmatched for a reviewer to link or exclude.",
  ],
  allocations: [
    "An approved amount of zero with zero units records that nothing was allocated.",
    "The share class must be the one on the subscription.",
  ],
};

const SAMPLES: Record<FileKind, string> = {
  subscriptions: "subscriptions.csv",
  funding: "funding.csv",
  allocations: "allocations.csv",
};

function SampleLink({ name, children, primary }: { name: string; children: string; primary?: boolean }) {
  return (
    <a href={`/api/samples/${name}`} download className={buttonClass(primary ? "primary" : "secondary")}>
      <Download aria-hidden className="h-4 w-4" />
      {children}
    </a>
  );
}

export default async function GuidePage() {
  await pageUser();
  return (
    <div className="space-y-6">
      <PageHeader
        title="File guide"
        description="What each of the three files must contain, with example files to download. Your column names can differ: you map them during import."
      />

      <Callout tone="info" title="The example files are synthetic">
        They describe a fictional $5,000,000 offering, Riverbend Flats Apartments. Investor references, amounts and bank references
        are invented. Do not use them as a template for real identifiers.
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
          <li>Importing a file again does not double-count: identical rows are recognised and skipped.</li>
          <li>A row that changes an already imported record goes to review. The original is not overwritten.</li>
        </ul>
      </Card>

      {FILE_KINDS.map((kind) => (
        <Card key={kind} aria-labelledby={`${kind}-heading`}>
          <CardHeader
            title={<span id={`${kind}-heading`}>{FILE_KIND_LABEL[kind]}</span>}
            description={INTRO[kind]}
            action={<SampleLink name={SAMPLES[kind]}>Example CSV</SampleLink>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th className="w-[20%] pl-5">Field</Th>
                  <Th className="w-[18%]">Column in the example</Th>
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
          title="Correction files for the example offering"
          description="Import these after the three example files to see how corrected source data clears blockers. The funding file uses a bank portal's column names, so it also shows column mapping."
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <SampleLink name="subscriptions-corrections.csv">Subscription corrections</SampleLink>
          <SampleLink name="funding-corrections.csv">Funding corrections (bank portal columns)</SampleLink>
        </div>
      </Card>
    </div>
  );
}
