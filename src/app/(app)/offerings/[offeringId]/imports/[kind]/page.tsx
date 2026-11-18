import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ImportWizard } from "@/components/import-wizard";
import { Callout } from "@/components/ui";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domain/csv";
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { pageOffering } from "@/server/page";

export const metadata: Metadata = { title: "Import file" };

export default async function ImportKindPage({ params }: { params: Promise<{ offeringId: string; kind: string }> }) {
  const { offeringId, kind } = await params;
  if (!(FILE_KINDS as string[]).includes(kind)) notFound();
  const { access } = await pageOffering(offeringId);
  const fileKind = kind as FileKind;
  const base = `/offerings/${access.offering.id}`;
  return (
    <div className="space-y-5">
      <Link href={`${base}/imports`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Imports
      </Link>
      <h1 className="text-lg font-semibold text-ink">Import {FILE_KIND_LABEL[fileKind].toLowerCase()}</h1>
      {access.can.review ? (
        <ImportWizard
          offeringId={access.offering.id}
          offeringCurrency={access.offering.currency}
          kind={fileKind}
          maxBytes={MAX_IMPORT_BYTES}
          maxRows={MAX_IMPORT_ROWS}
        />
      ) : (
        <Callout tone="warn" title="Only reviewers on this offering can import files">
          Ask a workspace administrator to add you as a reviewer.
        </Callout>
      )}
    </div>
  );
}
