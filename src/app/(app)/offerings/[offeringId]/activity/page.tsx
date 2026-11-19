import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, Td, Th } from "@/components/ui";
import { EXCEPTION_META, type ExceptionCode } from "@/domain/exceptions";
import { FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { formatMoney } from "@/domain/money";
import { formatDateTime, plural } from "@/lib/format";
import { pageOffering } from "@/server/page";
import { listAudit, type AuditEvent } from "@/server/services/audit";

export const metadata: Metadata = { title: "Activity" };

const DECISION_LABEL: Record<string, string> = {
  acknowledge: "Documented an exception",
  link: "Linked a payment to a subscription",
  exclude: "Excluded a payment from funding",
  accept_incoming: "Accepted a newer source record",
  keep_existing: "Kept the existing source record",
  revoke: "Revoked an earlier decision",
};

const FILE_LABEL: Record<string, string> = {
  register: "ownership register",
  exceptions: "exception report",
  "exceptions-draft": "draft exception report",
};

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Renders an audit event from identifiers and counts only; the trail holds no investor records. */
function describe(event: AuditEvent, currency: string): { title: string; detail: string } {
  const d = event.detail;
  switch (event.action) {
    case "offering.created":
      return { title: "Created the offering", detail: `Currency ${text(d.currency)}` };
    case "import.committed": {
      const n = (key: string) => (typeof d[key] === "number" ? (d[key] as number) : 0);
      return {
        title: `Imported ${(FILE_KIND_LABEL[d.kind as FileKind] ?? "a file").toLowerCase()}`,
        detail: `${text(d.filename)} · ${plural(n("rowCount"), "row")} · ${n("newCount")} new · ${n("unchangedCount") + n("duplicateCount")} already imported · ${plural(n("conflictCount"), "conflict")} · ${n("invalidCount")} invalid`,
      };
    }
    case "decision.recorded": {
      const code = d.exceptionCode as ExceptionCode | null;
      const rowKey = text(d.rowKey).replace("::", " · ").replace(/^FUNDING · /, "Payment ");
      return {
        title: DECISION_LABEL[text(d.decision)] ?? "Recorded a decision",
        detail: [rowKey, code && EXCEPTION_META[code] ? EXCEPTION_META[code].title : null].filter(Boolean).join(" · "),
      };
    }
    case "close.approved": {
      const amount = text(d.registerAmount);
      return {
        title: `Approved the close as version ${text(d.version)}`,
        detail: `${text(d.registerLines)} register lines · ${/^\d+(\.\d+)?$/.test(amount) ? formatMoney(amount, currency) : amount} · SHA-256 ${text(d.registerSha256).slice(0, 12)}…`,
      };
    }
    case "export.downloaded":
      return {
        title: `Downloaded the ${FILE_LABEL[text(d.file)] ?? "export"}`,
        detail: [d.version ? `Version ${text(d.version)}` : "Working data", `SHA-256 ${text(d.sha256).slice(0, 12)}…`].join(" · "),
      };
    case "member.set":
      return { title: `Set a member's role to ${text(d.role)}`, detail: "" };
    case "member.removed":
      return { title: "Removed a member", detail: "" };
    default:
      return { title: event.action, detail: "" };
  }
}

export default async function ActivityPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const { access } = await pageOffering(offeringId);
  const events = await listAudit(access.offering.id, 300);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Activity</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-2">
          Imports, reviewer decisions, approvals and downloads for this offering. Entries are append-only and hold identifiers, counts
          and file hashes, not investor records.
        </p>
      </div>
      <Card>
        <CardHeader title="Audit trail" description={events.length >= 300 ? "The 300 most recent entries." : undefined} />
        {events.length === 0 ? (
          <EmptyState title="No activity yet" description="Entries appear when files are imported or decisions are recorded." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th className="pl-5">When</Th>
                  <Th>Who</Th>
                  <Th>What</Th>
                  <Th className="pr-5">Detail</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => {
                  const { title, detail } = describe(event, access.offering.currency);
                  return (
                    <tr key={event.id}>
                      <Td className="num whitespace-nowrap pl-5 text-ink-2">{formatDateTime(event.createdAt)}</Td>
                      <Td className="text-ink-2">{event.actorEmail ?? "System"}</Td>
                      <Td className="font-medium">{title}</Td>
                      <Td className="num pr-5 text-ink-2">{detail}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
