import type { Metadata } from "next";
import { ReconciliationWorkspace, type StatusFilter } from "@/components/reconciliation-workspace";
import { pageOffering, pageWorkingState } from "@/server/page";
import { toTableRow } from "@/server/view-models";

export const metadata: Metadata = { title: "Reconciliation" };

const STATUSES = ["all", "needs_review", "blocked", "ready"] as const;
const SORTS = ["subscription", "investor", "shareClass", "signature", "requested", "cleared", "approved", "units", "variance", "status"] as const;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ offeringId }, search] = await Promise.all([params, searchParams]);
  const { access } = await pageOffering(offeringId);
  const state = await pageWorkingState(access.offering);
  const status = one(search.status);
  const sort = one(search.sort);
  const row = one(search.row);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Reconciliation</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-2">
          One row per subscription and share class. Funding is matched on the subscription ID or a mapped payment reference only,
          never on names or amounts.
        </p>
      </div>
      <ReconciliationWorkspace
        offeringId={access.offering.id}
        rows={state.result.rows.map(toTableRow)}
        summary={state.result.summary}
        fingerprint={state.fingerprint}
        initial={{
          status: (STATUSES as readonly string[]).includes(status) ? (status as StatusFilter) : "all",
          query: one(search.q).slice(0, 100),
          row: row && state.result.rows.some((r) => r.key === row) ? row : null,
          sort: (SORTS as readonly string[]).includes(sort) ? (sort as (typeof SORTS)[number]) : null,
        }}
      />
    </div>
  );
}
