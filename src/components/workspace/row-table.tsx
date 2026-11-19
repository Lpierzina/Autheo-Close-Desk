"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { cmp, formatMoney, formatSignedMoney, formatUnits } from "@/domain/money";
import type { ReconRow, ReconSummary } from "@/domain/reconcile";
import { plural, titleCase } from "@/lib/format";
import { Button, EmptyState, StatusPill, cx } from "../ui";

export type StatusFilter = "all" | "needs_review" | "blocked" | "ready";
type SortKey = "subscription" | "investor" | "shareClass" | "signature" | "requested" | "cleared" | "approved" | "units" | "variance" | "status";
type SortDir = "asc" | "desc";

const STATUS_RANK = { blocked: 0, needs_review: 1, ready: 2 } as const;
const PAGE_SIZE = 200;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "subscription", label: "Subscription" },
  { key: "investor", label: "Investor ref" },
  { key: "shareClass", label: "Share class" },
  { key: "signature", label: "Signed" },
  { key: "requested", label: "Signed for", numeric: true },
  { key: "cleared", label: "Net cleared", numeric: true },
  { key: "approved", label: "Approved", numeric: true },
  { key: "units", label: "Units", numeric: true },
  { key: "variance", label: "Variance", numeric: true },
  { key: "status", label: "Status" },
];

function text(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** Exact decimal comparison; rows without a value sort last in either direction. */
function amount(a: string | null, b: string | null, dir: SortDir): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return dir === "asc" ? cmp(a, b) : cmp(b, a);
}

const fundingAmount = (row: ReconRow) => (row.kind === "funding" ? (row.funding[0]?.record.data.amount ?? null) : null);

function compare(a: ReconRow, b: ReconRow, key: SortKey, dir: SortDir): number {
  const flip = dir === "asc" ? 1 : -1;
  switch (key) {
    case "subscription":
      return flip * text(a.subscriptionId ?? a.transactionRef, b.subscriptionId ?? b.transactionRef);
    case "investor":
      return flip * text(a.investorRef, b.investorRef);
    case "shareClass":
      return flip * text(a.shareClass, b.shareClass);
    case "signature":
      return flip * text(a.signatureStatus, b.signatureStatus);
    case "requested":
      return amount(a.requestedAmount, b.requestedAmount, dir);
    case "cleared":
      return amount(a.netCleared ?? fundingAmount(a), b.netCleared ?? fundingAmount(b), dir);
    case "approved":
      return amount(a.approvedAmount, b.approvedAmount, dir);
    case "units":
      return amount(a.approvedUnits, b.approvedUnits, dir);
    case "variance":
      return amount(a.variance, b.variance, dir);
    case "status":
      return flip * (STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  }
}

export function rowLabel(row: ReconRow): string {
  if (row.kind === "funding") return `payment ${row.transactionRef}`;
  return `${row.subscriptionId}${row.shareClass ? `, ${row.shareClass}` : ""}`;
}

export function matchesQuery(row: ReconRow, needle: string): boolean {
  if (!needle) return true;
  return [row.subscriptionId, row.investorRef, row.transactionRef, row.shareClass, ...row.funding.map((l) => l.record.data.transaction_ref), ...row.exceptions.map((e) => e.title)].some(
    (value) => value?.toLowerCase().includes(needle),
  );
}

/** Every subscription and share class, searchable and sortable. Opening a row shows its source records. */
export function RowTable({
  rows,
  summary,
  status,
  onStatus,
  onOpen,
  onSelectFiles,
}: {
  rows: ReconRow[];
  summary: ReconSummary;
  status: StatusFilter;
  onStatus: (status: StatusFilter) => void;
  onOpen: (key: string) => void;
  onSelectFiles: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "subscription", dir: "asc" });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const tableRef = useRef<HTMLTableElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => status === "all" || row.status === status)
      .filter((row) => matchesQuery(row, needle))
      .sort((a, b) => compare(a, b, sort.key, sort.dir) || text(a.subscriptionId ?? a.transactionRef, b.subscriptionId ?? b.transactionRef));
  }, [rows, status, query, sort]);
  const shown = visible.slice(0, limit);

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function onGridKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-row-key]");
    if (!target) return;
    const buttons = [...(tableRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row-key]") ?? [])];
    const index = buttons.indexOf(target);
    const move = (to: number) => {
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
  }

  const chips: { id: StatusFilter; label: string; count: number; dot?: string; emphasis?: boolean }[] = [
    { id: "all", label: "All", count: summary.counts.total },
    { id: "needs_review", label: "Needs review", count: summary.counts.needsReview, dot: "bg-warn", emphasis: summary.counts.needsReview > 0 },
    { id: "blocked", label: "Blocked", count: summary.counts.blocked, dot: "bg-danger" },
    { id: "ready", label: "Ready", count: summary.counts.ready, dot: "bg-accent" },
  ];

  const money = (value: string | null, currency: string | null) =>
    value === null ? <span className="text-ink-3">—</span> : formatMoney(value, currency ?? summary.currency);
  const cell = "px-3 py-2.5 align-top text-[13px]";

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={status === chip.id}
              onClick={() => {
                onStatus(chip.id);
                setLimit(PAGE_SIZE);
              }}
              className={cx(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                status === chip.id
                  ? "border-navy-900 bg-navy-900 text-white"
                  : chip.emphasis
                    ? "border-warn-line bg-warn-soft text-warn hover:border-warn"
                    : "border-line-strong bg-surface text-ink-2 hover:bg-paper-2",
              )}
            >
              {chip.dot ? <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", status === chip.id ? "bg-white" : chip.dot)} /> : null}
              {chip.label}
              <span className={cx("num text-xs", status === chip.id ? "text-navy-200" : chip.emphasis ? "text-warn" : "text-ink-3")}>{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-80">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            aria-label="Search by subscription ID, investor reference or transaction reference"
            placeholder="Search subscription, investor, transaction"
            className="block w-full rounded-md border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>
      </div>

      <p role="status" className="num mb-2 text-xs text-ink-3">
        Showing {shown.length.toLocaleString("en-US")} of {plural(visible.length, "row")}
        {visible.length !== rows.length ? ` · ${rows.length.toLocaleString("en-US")} in total` : ""}
      </p>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to review yet"
            description="Select the subscription, funding and allocation files. Rows appear here as soon as the first file is added to the workspace."
            action={
              <Button variant="primary" onClick={onSelectFiles}>
                Select CSV files
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={status === "needs_review" && !query ? "Nothing needs review" : status === "blocked" && !query ? "Nothing is blocked" : "No rows match"}
            description={query ? "Try a different search, or clear the filters." : "Every row in this status has been dealt with."}
            action={
              <Button
                onClick={() => {
                  onStatus("all");
                  setQuery("");
                }}
              >
                Show all rows
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table ref={tableRef} className="w-full min-w-[1040px] border-collapse" aria-label="Matches by subscription and share class">
              <thead className="border-b border-line bg-paper">
                <tr>
                  {COLUMNS.map((column) => {
                    const active = sort.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={cx("whitespace-nowrap px-3 py-0 text-xs font-medium text-ink-3", column.numeric ? "text-right" : "text-left")}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          title={`Sort by ${column.label.toLowerCase()}`}
                          className={cx("inline-flex items-center gap-1 rounded py-2.5 uppercase tracking-wide hover:text-ink", column.numeric && "flex-row-reverse", active && "text-ink")}
                        >
                          {column.label}
                          {active ? sort.dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" /> : null}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line" onKeyDown={onGridKeyDown}>
                {shown.map((row) => {
                  const open = row.exceptions.filter((e) => e.state === "open");
                  const listed = open.length > 0 ? open : row.exceptions;
                  const variance = row.variance !== null && row.variance !== "0.00";
                  return (
                    <tr key={row.key} onClick={() => onOpen(row.key)} className="cursor-pointer bg-surface transition-colors hover:bg-paper-2">
                      <td className={cell}>
                        <button
                          type="button"
                          data-row-key={row.key}
                          aria-label={`Open ${rowLabel(row)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(row.key);
                          }}
                          className="num rounded text-left font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {row.kind === "funding" ? row.transactionRef : row.subscriptionId}
                        </button>
                        {row.kind === "funding" ? <p className="text-xs text-ink-3">Payment without a subscription</p> : null}
                        {row.kind === "allocation" ? <p className="text-xs text-ink-3">Allocation without a subscription</p> : null}
                      </td>
                      <td className={cx(cell, "num text-ink-2")}>{row.investorRef ?? <span className="text-ink-3">—</span>}</td>
                      <td className={cx(cell, "whitespace-nowrap text-ink-2")}>{row.shareClass ?? <span className="text-ink-3">—</span>}</td>
                      <td className={cell}>
                        {row.signatureStatus ? (
                          <span className={row.signatureStatus === "signed" ? "text-ink-2" : "font-medium text-danger"}>{titleCase(row.signatureStatus)}</span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={cx(cell, "num whitespace-nowrap text-right")}>{money(row.requestedAmount, row.currency)}</td>
                      <td className={cx(cell, "num whitespace-nowrap text-right")}>
                        {row.kind === "funding" ? <span className="text-ink-2">{money(fundingAmount(row), row.currency)}</span> : money(row.netCleared, row.currency)}
                        {row.pendingAmount && row.pendingAmount !== "0.00" ? (
                          <p className="text-xs font-normal text-ink-3">+ {formatMoney(row.pendingAmount, row.currency ?? summary.currency)} pending</p>
                        ) : null}
                      </td>
                      <td className={cx(cell, "num whitespace-nowrap text-right font-medium")}>{money(row.approvedAmount, row.currency)}</td>
                      <td className={cx(cell, "num whitespace-nowrap text-right")}>
                        {row.approvedUnits === null ? <span className="text-ink-3">—</span> : formatUnits(row.approvedUnits)}
                      </td>
                      <td className={cx(cell, "num whitespace-nowrap text-right", variance ? "font-medium text-warn" : "text-ink-3")}>
                        {row.variance === null ? "—" : variance ? formatSignedMoney(row.variance, row.currency ?? summary.currency) : "0.00"}
                      </td>
                      <td className={cell}>
                        <StatusPill status={row.status} />
                        {listed.length > 0 ? (
                          <p className="mt-1 max-w-[190px] text-xs leading-snug text-ink-3">
                            {listed[0]?.title}
                            {listed.length > 1 ? ` +${listed.length - 1} more` : ""}
                            {open.length === 0 ? " · reviewed" : ""}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {visible.length > shown.length ? (
          <div className="border-t border-line px-4 py-3 text-center">
            <Button onClick={() => setLimit((n) => n + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more rows</Button>
          </div>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-ink-3">Select a column heading to sort. Use the arrow keys to move between rows and Enter to open one.</p>
      ) : null}
    </div>
  );
}
