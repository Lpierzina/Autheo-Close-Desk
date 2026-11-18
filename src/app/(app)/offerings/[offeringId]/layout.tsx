import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { OfferingTabs, type OfferingTab } from "@/components/offering-tabs";
import { Pill } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { offeringStatus, pageOffering, pageReadiness, pageWorkingState } from "@/server/page";

const ROLE_LABEL = { reviewer: "Reviewer", approver: "Approver" } as const;

export default async function OfferingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const { access } = await pageOffering(offeringId);
  const { offering } = access;
  const [state, readiness] = [await pageWorkingState(offering), await pageReadiness(offering)];
  const status = offeringStatus(readiness, state.filesImported);
  const { counts } = state.result.summary;
  const attention = counts.needsReview + counts.blocked;

  const tabs: OfferingTab[] = [
    { segment: "", label: "Overview" },
    { segment: "imports", label: "Imports" },
    {
      segment: "reconciliation",
      label: "Reconciliation",
      badge: attention > 0 ? { count: attention, tone: counts.blocked > 0 ? "danger" : "warn", label: "rows need attention" } : null,
    },
    { segment: "approval", label: "Approval and export" },
    { segment: "activity", label: "Activity" },
    { segment: "access", label: "Access" },
  ];

  return (
    <div>
      <div className="border-b border-line">
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[13px] text-ink-3">
          <Link href="/offerings" className="rounded hover:text-ink">
            Offerings
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
          <span className="text-ink-2">{offering.name}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-[22px] font-semibold tracking-tight text-ink">{offering.name}</p>
              <Pill tone={status.tone}>{status.label}</Pill>
              {offering.isDemo ? <Pill>Synthetic demo data</Pill> : null}
            </div>
            <p className="mt-0.5 text-[13px] text-ink-3">
              {[
                offering.propertyName,
                offering.targetRaise ? `${formatMoney(offering.targetRaise, offering.currency)} target` : null,
                offering.currency,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <p className="text-[13px] text-ink-2">
            Your role:{" "}
            <span className="font-medium text-ink">
              {access.role ? ROLE_LABEL[access.role] : "Administrator (view only)"}
            </span>
          </p>
        </div>
        <OfferingTabs offeringId={offering.id} tabs={tabs} />
      </div>
      <div className="pt-7">{children}</div>
    </div>
  );
}
