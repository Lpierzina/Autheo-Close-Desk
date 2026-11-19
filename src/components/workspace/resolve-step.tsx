"use client";

import { useMemo, useRef } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { formatSignedMoney } from "@/domain/money";
import type { ReconRow } from "@/domain/reconcile";
import { plural } from "@/lib/format";
import { useSession } from "@/session/store";
import { Button, EmptyState, cx } from "../ui";
import { MissingRow, RowReview } from "./row-review";

interface Group {
  id: "decide" | "source" | "done";
  label: string;
  hint: string;
  rows: ReconRow[];
}

function queueLabel(row: ReconRow): string {
  if (row.kind === "funding") return `Payment ${row.transactionRef}`;
  return `${row.subscriptionId}${row.shareClass ? ` · ${row.shareClass}` : ""}`;
}

/** Rows with exceptions, in the order a reviewer can act on them. */
export function buildQueue(rows: ReconRow[]): Group[] {
  const decide: ReconRow[] = [];
  const source: ReconRow[] = [];
  const done: ReconRow[] = [];
  for (const row of rows) {
    if (row.exceptions.length === 0) continue;
    const open = row.exceptions.filter((e) => e.state === "open");
    if (open.length === 0) done.push(row);
    else if (open.some((e) => e.resolution !== "source")) decide.push(row);
    else source.push(row);
  }
  return [
    { id: "decide", label: "Needs your decision", hint: "Review the difference and record a note.", rows: decide },
    { id: "source", label: "Needs corrected source data", hint: "A note cannot clear these. Select a corrected file.", rows: source },
    { id: "done", label: "Reviewed", hint: "Decisions recorded in this session.", rows: done },
  ];
}

export function ResolveStep({
  selectedKey,
  onSelect,
  onDecided,
  onSelectFiles,
  onReview,
  onExport,
}: {
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onDecided: (message: string, next?: { subscriptionId: string }) => void;
  onSelectFiles: () => void;
  onReview: () => void;
  onExport: () => void;
}) {
  const { view } = useSession();
  const rows = view.result.rows;
  const groups = useMemo(() => buildQueue(rows), [rows]);
  const queue = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const listRef = useRef<HTMLElement>(null);
  const open = (groups[0]?.rows.length ?? 0) + (groups[1]?.rows.length ?? 0);

  const currentKey = selectedKey ?? queue[0]?.key ?? null;
  const row = currentKey ? (rows.find((r) => r.key === currentKey) ?? null) : null;
  const index = row ? queue.findIndex((r) => r.key === row.key) : -1;
  const nextOpen = queue.find((r) => r.key !== currentKey && r.exceptions.some((e) => e.state === "open")) ?? null;

  function onListKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-queue-key]");
    if (!target) return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-queue-key]") ?? [])];
    const at = buttons.indexOf(target);
    const move = (to: number) => {
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          title="No exceptions yet"
          description="Exceptions appear here once the subscription, funding and allocation files are in the workspace."
          action={
            <Button variant="primary" onClick={onSelectFiles}>
              Select CSV files
            </Button>
          }
        />
      </div>
    );
  }

  const rowDone = row ? row.exceptions.every((e) => e.state !== "open") : false;
  const footer =
    row && rowDone ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-line bg-accent-soft px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] font-medium text-accent-strong">
          <CheckCircle2 aria-hidden className="h-4 w-4" />
          {row.exceptions.length === 0 ? "This row has no exceptions." : "Nothing left to decide on this row."}
        </p>
        {nextOpen ? (
          <Button variant="primary" onClick={() => onSelect(nextOpen.key)}>
            Next open exception
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="primary" onClick={onExport}>
            Go to export
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Button>
        )}
      </div>
    ) : null;

  return (
    <section aria-labelledby="resolve-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="resolve-heading" className="text-lg font-semibold tracking-tight text-ink">
            Resolve exceptions
          </h2>
          <p role="status" className="num mt-1 text-[13px] text-ink-2">
            {open === 0
              ? "Every exception has been dealt with."
              : `${plural(view.openReviews, "exception")} to review · ${plural(view.openBlockers, "blocker")} needing corrected source data`}
          </p>
        </div>
        <Button variant="ghost" onClick={onReview}>
          Back to all matches
        </Button>
      </div>

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        <nav ref={listRef} aria-label="Rows with exceptions" onKeyDown={onListKeyDown} className="rounded-lg border border-line bg-surface lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {queue.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-3">No row has an exception. Signatures, cleared funds and approved allocations agree.</p>
          ) : (
            groups
              .filter((group) => group.rows.length > 0)
              .map((group) => (
                <div key={group.id} className="border-b border-line last:border-0">
                  <div className="bg-paper px-4 py-2">
                    <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-2">
                      {group.label}
                      <span className="num font-medium text-ink-3">{group.rows.length}</span>
                    </p>
                    <p className="text-xs text-ink-3">{group.hint}</p>
                  </div>
                  <ul>
                    {group.rows.map((item) => {
                      const openItems = item.exceptions.filter((e) => e.state === "open");
                      const shown = openItems.length > 0 ? openItems : item.exceptions;
                      const current = item.key === currentKey;
                      const variance = item.variance !== null && item.variance !== "0.00" ? item.variance : null;
                      return (
                        <li key={item.key} className="border-t border-line first:border-0">
                          <button
                            type="button"
                            data-queue-key={item.key}
                            aria-current={current ? "true" : undefined}
                            onClick={() => onSelect(item.key)}
                            className={cx(
                              "flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-paper-2",
                              current && "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]",
                            )}
                          >
                            <span
                              aria-hidden
                              className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", group.id === "done" ? "bg-accent" : group.id === "source" ? "bg-danger" : "bg-warn")}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="num block text-[13px] font-medium text-ink">{queueLabel(item)}</span>
                              <span className="block text-xs leading-snug text-ink-3">
                                {shown[0]?.title}
                                {shown.length > 1 ? ` +${shown.length - 1} more` : ""}
                              </span>
                            </span>
                            {variance ? <span className="num whitespace-nowrap text-xs font-medium text-ink-2">{formatSignedMoney(variance, item.currency ?? view.result.summary.currency)}</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
          )}
        </nav>

        <div className="min-w-0">
          {row ? (
            <RowReview
              key={row.key}
              row={row}
              position={index >= 0 ? { index, total: queue.length } : null}
              onStep={(delta) => {
                const target = queue[index + delta];
                if (target) onSelect(target.key);
              }}
              onDecided={onDecided}
              onSelectFiles={onSelectFiles}
              footer={footer}
            />
          ) : currentKey ? (
            <MissingRow onBack={onReview} />
          ) : (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState
                icon={<CheckCircle2 aria-hidden className="h-6 w-6 text-accent" />}
                title="No exceptions to resolve"
                description="Signatures, cleared funds and approved allocations agree on every row."
                action={
                  <Button variant="primary" onClick={onExport}>
                    Go to export
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
