"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, Eraser, X } from "lucide-react";
import { formatMoney, formatUnits } from "@/domain/money";
import { FILE_KINDS, idKey } from "@/domain/types";
import { plural } from "@/lib/format";
import { isEmptySession, setDeal, type SessionState, type SessionView } from "@/session/engine";
import { SAMPLE_CORRECTION_FILES, isSampleSession, stageSampleCorrections } from "@/session/sample";
import { useSession } from "@/session/store";
import { ConfirmDialog } from "../confirm-dialog";
import { SessionNote } from "../notes";
import { Button, Callout, cx, inputClass } from "../ui";
import { ExportStep } from "./export-step";
import { ResolveStep } from "./resolve-step";
import { RowTable, type StatusFilter } from "./row-table";
import { SelectFilesStep } from "./select-files";
import { STEPS, type Step } from "./shared";

const GUIDED_ROW = "SUB-1012::CLASS A";
const CLEARED_BY_CORRECTION = "SUB-1031::CLASS B";

function Stepper({ step, onStep, state, view }: { step: Step; onStep: (step: Step) => void; state: SessionState; view: SessionView }) {
  const open = view.openBlockers + view.openReviews;
  const staged = Object.keys(state.staged).length;
  const badge: Record<Step, { text: string; tone: "neutral" | "ok" | "warn" | "danger" } | null> = {
    select:
      view.filesAdded === 0 && staged === 0
        ? null
        : staged > 0
          ? { text: `${staged} to add`, tone: "warn" }
          : { text: `${view.filesAdded} of ${FILE_KINDS.length}`, tone: view.filesAdded === FILE_KINDS.length ? "ok" : "neutral" },
    review: view.result.rows.length > 0 ? { text: view.result.rows.length.toLocaleString("en-US"), tone: "neutral" } : null,
    resolve: view.result.rows.length === 0 ? null : open > 0 ? { text: `${open} open`, tone: view.openBlockers > 0 ? "danger" : "warn" } : { text: "None open", tone: "ok" },
    export: view.approved ? { text: "Confirmed", tone: "ok" } : null,
  };
  const tone = {
    neutral: "bg-paper-2 text-ink-2",
    ok: "bg-accent-soft text-accent-strong",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  };
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <nav aria-label="Reconciliation steps">
      <ol className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-4">
        {STEPS.map((item, index) => {
          const current = item.id === step;
          const b = badge[item.id];
          return (
            <li key={item.id} className="border-b border-line md:border-b-0 md:border-r md:last:border-r-0 [&:nth-child(n+3)]:border-b-0 odd:border-r">
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                onClick={() => onStep(item.id)}
                data-testid={`step-${item.id}`}
                className={cx(
                  "flex h-full w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-paper-2 focus-visible:outline-offset-[-2px]",
                  current && "bg-paper shadow-[inset_0_-3px_0_var(--color-navy-900)]",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    current ? "bg-navy-900 text-white" : index < currentIndex ? "bg-navy-200 text-navy-900" : "border border-line-strong text-ink-3",
                  )}
                >
                  {index + 1}
                </span>
                <span className={cx("text-[13px] font-medium", current ? "text-ink" : "text-ink-2")}>{item.label}</span>
                {b ? <span className={cx("num ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", tone[b.tone])}>{b.text}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ReviewStep({
  status,
  onStatus,
  onOpen,
  onSelectFiles,
  onResolve,
  onExport,
}: {
  status: StatusFilter;
  onStatus: (status: StatusFilter) => void;
  onOpen: (key: string) => void;
  onSelectFiles: () => void;
  onResolve: () => void;
  onExport: () => void;
}) {
  const { view } = useSession();
  const { summary, rows } = view.result;
  const money = (value: string) => formatMoney(value, summary.currency);
  const open = view.openBlockers + view.openReviews;
  const isPositive = (value: string) => value !== "0.00" && !value.startsWith("-");

  const totals = [
    {
      id: "signed",
      label: "Signed subscriptions",
      question: "Did they sign?",
      value: money(summary.signedCommitments),
      lines: ["Signed agreements only. Pending and declined subscriptions are not counted."],
      warn: [] as string[],
    },
    {
      id: "cleared",
      label: "Net cleared funds",
      question: "Did their money clear?",
      value: money(summary.netClearedFunding),
      lines: ["Cleared payments matched to a subscription, net of reversals."],
      warn: [
        isPositive(summary.pendingFunding) ? `${money(summary.pendingFunding)} pending, not counted` : "",
        isPositive(summary.unmatchedCleared) ? `${money(summary.unmatchedCleared)} cleared but not matched to a subscription` : "",
        ...summary.otherCurrencies.map((other) => `${formatMoney(other.amount, other.currency)} in ${other.currency}, not netted`),
      ].filter(Boolean),
    },
    {
      id: "approved",
      label: "Approved allocations",
      question: "How many LLC units did the sponsor approve?",
      value: money(summary.approvedAllocations),
      lines: summary.unitsByClass.length > 0 ? summary.unitsByClass.map((c) => `${c.shareClass}: ${formatUnits(c.approvedUnits)} units · ${formatMoney(c.approvedAmount, summary.currency)}`) : ["No allocations in the workspace yet."],
      warn: isPositive(summary.excessOverApproved) ? [`${money(summary.excessOverApproved)} cleared above approved amounts`] : [],
    },
  ];

  return (
    <section aria-labelledby="review-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="review-heading" className="text-lg font-semibold tracking-tight text-ink">
            Review matches
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">Three totals from three files. They are shown separately and never combined.</p>
        </div>
        {rows.length > 0 ? (
          open > 0 ? (
            <Button variant="primary" onClick={onResolve}>
              Resolve {plural(open, "exception")}
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="primary" onClick={onExport}>
              Go to export
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Button>
          )
        ) : null}
      </div>

      <dl className="mt-4 grid gap-4 md:grid-cols-3">
        {totals.map((total) => (
          <div key={total.id} data-testid={`total-${total.id}`} className="rounded-lg border border-line bg-surface px-5 py-4">
            <dt>
              <span className="block text-xs text-ink-3">{total.question}</span>
              <span className="block text-[13px] font-semibold text-ink">{total.label}</span>
            </dt>
            <dd className="num mt-2 text-[26px] font-semibold leading-none tracking-tight text-navy-900">{total.value}</dd>
            <dd className="num mt-2.5 space-y-0.5 text-xs text-ink-3">
              {total.lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {total.warn.map((line) => (
                <span key={line} className="flex items-center gap-1.5 font-medium text-warn">
                  <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
                  {line}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <RowTable rows={rows} summary={summary} status={status} onStatus={onStatus} onOpen={onOpen} onSelectFiles={onSelectFiles} />
      </div>
    </section>
  );
}

function SampleGuide({ onOpenGuided, onCorrections, onStep }: { onOpenGuided: () => void; onCorrections: () => void; onStep: (step: Step) => void }) {
  const { state, view } = useSession();
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const allAdded = view.filesAdded === FILE_KINDS.length;
  const guided = view.result.rows.find((row) => row.key === GUIDED_ROW);
  const guidedDone = Boolean(guided) && guided!.exceptions.every((e) => e.state !== "open");
  const correctionNames = new Set(SAMPLE_CORRECTION_FILES.map((file) => file.filename));
  const correctionsAdded = state.batches.filter((batch) => correctionNames.has(batch.filename)).length === SAMPLE_CORRECTION_FILES.length;
  // SUB-1031 carries a review item that only the corrected funding file clears, so it belongs to the later step.
  const reviewLeft = view.openItems.filter((item) => item.severity === "review" && item.rowKey !== GUIDED_ROW && item.rowKey !== CLEARED_BY_CORRECTION).length;
  const correctionsSelected = Object.values(state.staged).some((staged) => correctionNames.has(staged.filename));

  const items: { done: boolean; title: string; body: string; action?: { label: string; run: () => void } }[] = [
    {
      done: allAdded,
      title: "Add the three sample files",
      body: "The funding file has one row without a settlement date. Tick the box to leave it out, then add the files.",
      action: allAdded ? undefined : { label: "Select files", run: () => onStep("select") },
    },
    {
      done: guidedDone,
      title: "Open SUB-1012",
      body: "Signed for $100,000, cleared $100,000 across two wires, approved for $90,000. Read the $10,000 variance and record a review decision.",
      action: allAdded && !guidedDone ? { label: "Open SUB-1012", run: onOpenGuided } : undefined,
    },
    {
      done: allAdded && reviewLeft === 0,
      title: "Decide the other exceptions that need review",
      body: "Exclude the duplicate portal payment on SUB-1034, link WIRE-20338 to SUB-1038 and WIRE-20341 to SUB-1041, and document SUB-1044 and SUB-1048.",
      action: allAdded && reviewLeft > 0 ? { label: `${reviewLeft} to review`, run: () => onStep("resolve") } : undefined,
    },
    {
      done: correctionsAdded && view.openBlockers + view.openReviews === 0,
      title: "Clear the blockers with corrected files",
      body: "Select the two correction files. The funding one uses a bank portal's headers: map Amount to Credit Amount. Then choose the later version on each changed record.",
      action:
        allAdded && !correctionsAdded && !correctionsSelected
          ? { label: "Select sample correction files", run: onCorrections }
          : correctionsAdded && view.openBlockers + view.openReviews > 0
            ? { label: `${view.openBlockers + view.openReviews} to resolve`, run: () => onStep("resolve") }
            : undefined,
    },
    {
      done: view.approved,
      title: "Confirm and download",
      body: "Confirm the reviewed snapshot, then download the reviewed register export and the exceptions report.",
      action: view.canApprove && !view.approved ? { label: "Go to export", run: () => onStep("export") } : undefined,
    },
  ];
  const done = items.filter((item) => item.done).length;
  const next = items.findIndex((item) => !item.done);

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="rounded text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline">
        Show the sample walkthrough ({done} of {items.length} done)
      </button>
    );
  }

  const current = next >= 0 ? items[next] : undefined;

  return (
    <aside aria-labelledby="sample-guide-heading" data-testid="sample-guide" className="rounded-lg border border-accent-line bg-accent-soft/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="sample-guide-heading" className="text-[13px] font-semibold text-ink">
          Sample walkthrough
        </h2>
        <p className="num text-xs text-ink-2">
          Riverbend Flats Apartments · synthetic data · {done} of {items.length} steps done
        </p>
        <div aria-hidden className="flex items-center gap-1">
          {items.map((item, index) => (
            <span key={item.title} className={cx("h-1.5 w-6 rounded-full", item.done ? "bg-accent" : index === next ? "bg-navy-900" : "bg-line-strong")} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {expanded ? "Hide steps" : "All steps"}
          </button>
          <button type="button" onClick={() => setHidden(true)} aria-label="Hide the sample walkthrough" className="rounded p-1 text-ink-2 hover:bg-accent-soft">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>

      {current ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-[260px] flex-1 text-[13px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">Next: {current.title}.</span> {current.body}
          </p>
          {current.action ? (
            <Button size="sm" onClick={current.action.run}>
              {current.action.label}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-2">Every step is done. Download both files before you leave.</p>
      )}

      {expanded ? (
        <ol className="mt-3 space-y-1.5 border-t border-accent-line pt-3">
          {items.map((item, index) => (
            <li key={item.title} className="flex gap-2 text-[13px]">
              {item.done ? (
                <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              ) : (
                <Circle aria-hidden className={cx("mt-0.5 h-4 w-4 shrink-0", index === next ? "text-navy-900" : "text-ink-3")} />
              )}
              <p className="text-ink-2">
                <span className={cx("font-medium", item.done ? "text-ink-2" : "text-ink")}>
                  {item.title}
                  {item.done ? <span className="sr-only"> (done)</span> : null}.
                </span>{" "}
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}

function DealFields() {
  const { state, run } = useSession();
  const [currency, setCurrency] = useState(state.currency);
  const [seen, setSeen] = useState(state.currency);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const currencyId = useId();

  if (seen !== state.currency) {
    setSeen(state.currency);
    setCurrency(state.currency);
    setError(null);
  }

  function commitCurrency(value: string) {
    const result = run((s) => setDeal(s, { currency: value }));
    setError(result.ok ? null : result.error.message);
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="w-full sm:w-72">
        <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-ink-2">
          Deal name <span className="font-normal text-ink-3">Used in download file names</span>
        </label>
        <input
          id={nameId}
          value={state.dealName}
          onChange={(event) => run((s) => setDeal(s, { dealName: event.target.value }))}
          maxLength={120}
          autoComplete="off"
          placeholder="For example, the property name"
          className={cx(inputClass, "py-1.5!")}
        />
      </div>
      <div className="w-24">
        <label htmlFor={currencyId} className="mb-1 block text-xs font-medium text-ink-2">
          Currency
        </label>
        <input
          id={currencyId}
          value={currency}
          onChange={(event) => {
            const value = event.target.value.toUpperCase().slice(0, 3);
            setCurrency(value);
            if (/^[A-Z]{3}$/.test(value)) commitCurrency(value);
          }}
          onBlur={() => {
            if (currency !== state.currency) commitCurrency(currency);
          }}
          maxLength={3}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${currencyId}-error` : undefined}
          className={cx(inputClass, "num py-1.5! uppercase")}
        />
      </div>
      {error ? (
        <p id={`${currencyId}-error`} role="alert" className="w-full text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Workspace() {
  const { state, view, run, clear } = useSession();
  const [step, setStep] = useState<Step>(() => (state.batches.length > 0 ? "review" : "select"));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selection, setSelection] = useState<{ key: string } | { subscriptionId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const empty = isEmptySession(state);
  const staged = Object.keys(state.staged).length;

  const rows = view.result.rows;
  let selectedKey: string | null = null;
  if (selection && "key" in selection) selectedKey = selection.key;
  else if (selection) {
    const wanted = idKey(selection.subscriptionId);
    selectedKey = rows.find((row) => row.kind !== "funding" && row.subscriptionId !== null && idKey(row.subscriptionId) === wanted)?.key ?? null;
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function go(next: Step) {
    setStep(next);
    topRef.current?.scrollIntoView({ block: "start" });
  }

  function openRow(key: string) {
    setSelection({ key });
    go("resolve");
  }

  return (
    <main className="mx-auto max-w-[1320px] space-y-5 px-4 py-6 sm:px-6">
      <div ref={topRef} className="flex scroll-mt-4 flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Reconciliation</h1>
          <SessionNote className="mt-1" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DealFields />
          <Button onClick={() => setClearing(true)} disabled={empty} data-testid="clear-session">
            <Eraser aria-hidden className="h-4 w-4 text-ink-3" />
            Clear session
          </Button>
        </div>
      </div>

      <Stepper step={step} onStep={go} state={state} view={view} />

      <div aria-live="polite" role="status" data-testid="notice">
        {notice ? (
          <div className="flex items-center gap-2 rounded-md border border-accent-line bg-accent-soft px-4 py-2.5 text-[13px] font-medium text-accent-strong">
            <Check aria-hidden className="h-4 w-4 shrink-0" />
            <span className="num min-w-0 flex-1 break-words">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" className="rounded p-0.5 hover:bg-accent-line/40">
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {isSampleSession(state) ? (
        <SampleGuide
          onOpenGuided={() => openRow(GUIDED_ROW)}
          onStep={go}
          onCorrections={() => {
            const result = run((s) => stageSampleCorrections(s));
            if (result.ok) {
              setNotice("The two sample correction files are selected. Check their previews, then add them.");
              go("select");
            }
          }}
        />
      ) : null}

      {staged > 0 && step !== "select" ? (
        <Callout tone="warn" title={`${plural(staged, "selected file")} not added to the workspace yet`}>
          The figures below do not include {staged === 1 ? "it" : "them"}.{" "}
          <button type="button" onClick={() => go("select")} className="font-medium underline underline-offset-2">
            Go to Select files
          </button>
        </Callout>
      ) : null}

      {step === "select" ? (
        <SelectFilesStep
          onAdded={(message) => {
            setNotice(message);
            go("review");
          }}
          onReview={() => go("review")}
        />
      ) : null}

      {step === "review" ? (
        <ReviewStep status={status} onStatus={setStatus} onOpen={openRow} onSelectFiles={() => go("select")} onResolve={() => { setSelection(null); go("resolve"); }} onExport={() => go("export")} />
      ) : null}

      {step === "resolve" ? (
        <ResolveStep
          selectedKey={selection && !selectedKey && "key" in selection ? selection.key : selectedKey}
          onSelect={(key) => setSelection({ key })}
          onDecided={(message, next) => {
            setNotice(message);
            if (next) setSelection({ subscriptionId: next.subscriptionId });
          }}
          onSelectFiles={() => go("select")}
          onReview={() => go("review")}
          onExport={() => go("export")}
        />
      ) : null}

      {step === "export" ? <ExportStep onResolve={() => { setSelection(null); go("resolve"); }} onSelectFiles={() => go("select")} onNotice={setNotice} /> : null}

      <ConfirmDialog
        open={clearing}
        title="Clear this session?"
        confirmLabel="Clear session"
        danger
        onCancel={() => setClearing(false)}
        onConfirm={() => {
          setClearing(false);
          clear();
          setSelection(null);
          setStatus("all");
          setStep("select");
          setNotice("Session cleared. This tab no longer holds any file contents, mappings, decisions or prepared downloads.");
        }}
      >
        <p>This tab will forget the contents of the selected files, the column mappings, every review decision, the confirmation and the downloads it prepared.</p>
        <p>It does not delete the source files or anything already downloaded. Those stay on your device until you remove them yourself.</p>
      </ConfirmDialog>
    </main>
  );
}
