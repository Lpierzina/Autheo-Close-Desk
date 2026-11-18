import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FolderOpen, Plus } from "lucide-react";
import { ButtonLink, Card, EmptyState, PageHeader, Pill } from "@/components/ui";
import { formatMoney } from "@/domain/money";
import { formatDateTime, timeAgo } from "@/lib/format";
import { pageUser } from "@/server/page";
import { listOfferings, type OfferingListItem } from "@/server/services/offerings";

export const metadata: Metadata = { title: "Offerings" };

function statusOf(o: OfferingListItem): { label: string; tone: "neutral" | "ok" | "warn" } {
  if (o.approvedVersion) return { label: `Approved · v${o.approvedVersion}`, tone: "ok" };
  if (o.filesImported === 0) return { label: "Draft", tone: "neutral" };
  if (o.filesImported < 3) return { label: `Importing · ${o.filesImported} of 3 files`, tone: "neutral" };
  return { label: "In review", tone: "warn" };
}

const ROLE_LABEL = { reviewer: "Reviewer", approver: "Approver" } as const;

export default async function OfferingsPage() {
  const user = await pageUser();
  const offerings = await listOfferings(user);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Offerings"
        description="Each offering is closed from three files: subscriptions, funding and approved allocations."
        actions={
          user.isAdmin ? (
            <ButtonLink href="/offerings/new" variant="primary">
              <Plus aria-hidden className="h-4 w-4" />
              New offering
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        {offerings.length === 0 ? (
          <EmptyState
            icon={<FolderOpen aria-hidden className="h-8 w-8" />}
            title={user.isAdmin ? "No offerings yet" : "You have not been added to an offering"}
            description={
              user.isAdmin
                ? "Create an offering, then import its three source files to start the close."
                : "A workspace administrator adds reviewers and approvers to each offering. Ask them to add you."
            }
            action={
              user.isAdmin ? (
                <ButtonLink href="/offerings/new" variant="primary">
                  <Plus aria-hidden className="h-4 w-4" />
                  New offering
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {offerings.map((o) => {
              const status = statusOf(o);
              return (
                <li key={o.id}>
                  <Link href={`/offerings/${o.id}`} className="group flex items-center gap-6 px-5 py-4 hover:bg-paper-2/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-ink">{o.name}</span>
                        {o.isDemo ? <Pill>Synthetic demo</Pill> : null}
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-3">
                        {[o.propertyName, o.targetRaise ? `${formatMoney(o.targetRaise, o.currency)} target` : null, o.currency]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="hidden w-52 text-[13px] text-ink-2 md:block">
                      {o.lastImportAt ? (
                        <span title={formatDateTime(o.lastImportAt)}>Last import {timeAgo(o.lastImportAt)}</span>
                      ) : (
                        <span className="text-ink-3">No files imported</span>
                      )}
                    </div>
                    <div className="hidden w-28 text-[13px] text-ink-2 sm:block">
                      {o.role ? ROLE_LABEL[o.role] : user.isAdmin ? "Administrator" : ""}
                    </div>
                    <Pill tone={status.tone}>{status.label}</Pill>
                    <ChevronRight aria-hidden className="h-4 w-4 text-ink-3 group-hover:text-ink" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
