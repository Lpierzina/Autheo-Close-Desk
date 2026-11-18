"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { EXCEPTION_META, type ExceptionCode } from "@/domain/exceptions";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { formatMoney, formatSignedMoney, formatUnits } from "@/domain/money";
import type { ConflictView, FundingLine, ReconException, ReconRow } from "@/domain/reconcile";
import type { DecisionRecord, SourceRecord } from "@/domain/types";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatSettledAt, titleCase } from "@/lib/format";
import type { DecisionHistoryItem } from "@/server/services/reconciliation";
import { Button, Callout, Pill, StatusPill, cx, inputClass } from "./ui";

interface RowPayload {
  row: ReconRow;
  history: DecisionHistoryItem[];
  canReview: boolean;
}

type LoadState = { status: "loading" } | { status: "ready"; data: RowPayload } | { status: "missing" } | { status: "error"; message: string };

const TREATMENT: Record<FundingLine["treatment"], { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  counted: { label: "Counted", tone: "ok" },
  reversal_applied: { label: "Reversal applied", tone: "neutral" },
  pending: { label: "Pending, not counted", tone: "neutral" },
  not_cleared: { label: "Not cleared, not counted", tone: "neutral" },
  excluded: { label: "Excluded by reviewer", tone: "warn" },
  invalid_reversal: { label: "Invalid reversal, not netted", tone: "danger" },
  currency_mismatch: { label: "Other currency, not netted", tone: "danger" },
  not_netted: { label: "Not netted", tone: "warn" },
  unmatched: { label: "Not matched", tone: "warn" },
};

const MATCHED_BY: Record<string, string> = {
  subscription_id: "Matched on subscription ID",
  payment_reference: "Matched on mapped payment reference",
  reviewer_link: "Linked by a reviewer",
  original_transaction: "Follows the original transaction",
};

const ACTION_LABEL: Record<string, string> = {
  acknowledge: "Documented exception",
  link: "Linked payment",
  exclude: "Excluded payment from funding",
  accept_incoming: "Accepted the newer version",
  keep_existing: "Kept the existing version",
  revoke: "Revoked an earlier decision",
};

const STANDING: Record<string, { label: string; tone: "ok" | "neutral" | "warn" }> = {
  in_effect: { label: "In effect", tone: "ok" },
  revoked: { label: "Revoked", tone: "neutral" },
  superseded: { label: "No longer applies", tone: "warn" },
};

function SourceLine({ record }: { record: SourceRecord }) {
  return (
    <p className="num mt-2 text-xs text-ink-3">
      Source: {record.source.filename}, row {record.source.rowNumber}
      <span className="block">Imported {formatDateTime(record.source.importedAt)}</span>
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="num text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-line bg-surface p-3.5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function NoteForm({
  submitLabel,
  variant = "primary",
  hint,
  children,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
  hint?: string;
  children?: ReactNode;
  onSubmit: (note: string, form: FormData) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setError("Write a note of at least 10 characters explaining the decision.");
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed, new FormData(event.currentTarget));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The decision could not be recorded. Nothing was changed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-2.5">
      {children}
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink">
          Reviewer note
        </label>
        <textarea
          id={id}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
          className={inputClass}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
          placeholder={hint}
        />
        <p id={`${id}-help`} className={cx("mt-1 text-xs", error ? "font-medium text-danger" : "text-ink-3")} role={error ? "alert" : undefined}>
          {error ?? "Kept permanently with your name and the time. Do not include personal details."}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant={variant} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function DecisionSummary({ decision }: { decision: DecisionRecord }) {
  return (
    <div className="mt-2 rounded-md border border-line bg-paper px-3 py-2 text-[13px]">
      <p className="text-ink">{decision.note}</p>
      <p className="mt-1 text-xs text-ink-3">
        {decision.decidedBy.name ?? decision.decidedBy.email} · {formatDateTime(decision.decidedAt)}
      </p>
    </div>
  );
}

export function RowDetail({
  offeringId,
  rowKey,
  fingerprint,
  subscriptionIds,
  onClose,
  onChanged,
  onStep,
  position,
}: {
  offeringId: string;
  rowKey: string;
  /** Changes whenever source records or decisions change, so the panel reloads. */
  fingerprint: string;
  subscriptionIds: string[];
  onClose: () => void;
  onChanged: (next?: { selectSubscriptionId?: string; message: string }) => void;
  onStep: (delta: 1 | -1) => void;
  position: { index: number; total: number } | null;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const datalistId = useId();

  useEffect(() => {
    let cancelled = false;
    api<RowPayload>(`/api/offerings/${offeringId}/reconciliation/row?key=${encodeURIComponent(rowKey)}`)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 404) setState({ status: "missing" });
        else setState({ status: "error", message: failure instanceof ApiError ? failure.message : "The row could not be loaded." });
      });
    return () => {
      cancelled = true;
    };
  }, [offeringId, rowKey, fingerprint, reload]);

  // The parent keys this component by row, so mounting means a new row was opened.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const decide = useCallback(
    async (input: Record<string, unknown>, done: { selectSubscriptionId?: string; message: string }) => {
      await api(`/api/offerings/${offeringId}/decisions`, { method: "POST", json: { rowKey, ...input } });
      setRevoking(null);
      setExcluding(null);
      onChanged(done);
    },
    [offeringId, rowKey, onChanged],
  );

  const data = state.status === "ready" ? state.data : null;
  const row = data?.row ?? null;
  const currency = row?.currency ?? "USD";
  const money = (value: string | null | undefined, cur: string = currency) => (value == null ? "—" : formatMoney(value, cur));

  const title = row
    ? row.kind === "funding"
      ? `Payment ${row.transactionRef}`
      : `${row.subscriptionId}${row.shareClass ? ` · ${row.shareClass}` : ""}`
    : "Row details";

  function revokeControl(decision: DecisionRecord, label = "Revoke this decision") {
    if (!data?.canReview) return null;
    if (revoking !== decision.id) {
      return (
        <button type="button" onClick={() => setRevoking(decision.id)} className="mt-2 text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
          {label}
        </button>
      );
    }
    return (
      <NoteForm
        submitLabel="Revoke decision"
        variant="danger"
        hint="Why the earlier decision no longer stands"
        onCancel={() => setRevoking(null)}
        onSubmit={(note) => decide({ action: "revoke", decisionId: decision.id, note }, { message: "The decision was revoked. The exception is open again." })}
      />
    );
  }

  function conflictBlock(exception: ReconException, conflict: ConflictView) {
    const kind = conflict.incoming.kind;
    const labels = new Map(IMPORT_FIELDS[kind].map((f) => [f.key, f.label]));
    return (
      <div className="mt-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Field
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Existing record
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Newer import
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {conflict.changedFields.map((change) => (
              <tr key={change.field}>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                  {labels.get(change.field) ?? change.field}
                </th>
                <td className="num py-1.5 pr-3 text-ink">{change.existing ?? "empty"}</td>
                <td className="num py-1.5 font-medium text-ink">{change.incoming ?? "empty"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="num mt-2 text-xs text-ink-3">
          Existing: {conflict.existing ? `${conflict.existing.source.filename}, row ${conflict.existing.source.rowNumber}` : "no active record"} · Newer:{" "}
          {conflict.incoming.source.filename}, row {conflict.incoming.source.rowNumber}
        </p>
        {data?.canReview ? (
          <NoteForm
            submitLabel="Record decision"
            hint="Which version is correct, and how you confirmed it"
            onSubmit={(note, form) =>
              decide(
                { action: form.get("choice") === "accept_incoming" ? "accept_incoming" : "keep_existing", exceptionId: exception.id, note },
                { message: "The conflict was resolved. Both versions remain in the import history." },
              )
            }
          >
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-ink">Which version stands?</legend>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" name="choice" value="keep_existing" defaultChecked className="accent-[var(--color-accent)]" />
                Keep the existing record
              </label>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" name="choice" value="accept_incoming" className="accent-[var(--color-accent)]" />
                Use the newer import
              </label>
            </fieldset>
          </NoteForm>
        ) : null}
      </div>
    );
  }

  function exceptionActions(exception: ReconException) {
    if (!row || !data) return null;
    if (exception.state !== "open") {
      return exception.decision ? (
        <>
          <DecisionSummary decision={exception.decision} />
          {revokeControl(exception.decision)}
        </>
      ) : null;
    }
    if (exception.resolution === "source") {
      return (
        <p className="mt-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
          Needs corrected source data. A reviewer note cannot clear this.{" "}
          <Link href={`/offerings/${offeringId}/imports`} className="font-medium underline underline-offset-2">
            Go to imports
          </Link>
        </p>
      );
    }
    if (!data.canReview) {
      return <p className="mt-3 text-[13px] text-ink-3">A reviewer on this offering can record a decision.</p>;
    }
    if (exception.resolution === "document") {
      return (
        <NoteForm
          submitLabel="Document exception"
          hint="What you checked and how the difference is being handled"
          onSubmit={(note) =>
            decide(
              { action: "acknowledge", exceptionId: exception.id, fingerprint: exception.fingerprint, note },
              { message: `${exception.title} documented.` },
            )
          }
        />
      );
    }
    if (exception.resolution === "link_or_exclude") {
      return (
        <NoteForm
          submitLabel="Record decision"
          hint="Evidence for the link, or why the payment is not part of this offering"
          onSubmit={(note, form) => {
            const choice = form.get("choice");
            const subscriptionId = String(form.get("subscriptionId") ?? "").trim();
            if (choice === "link") {
              if (!subscriptionId) throw new ApiError("Enter the subscription ID to link this payment to.", 422, "validation", null);
              return decide(
                { action: "link", transactionKey: exception.subjectKey, subscriptionId, note },
                { selectSubscriptionId: subscriptionId, message: `Payment linked to ${subscriptionId.toUpperCase()}.` },
              );
            }
            return decide({ action: "exclude", transactionKey: exception.subjectKey, note }, { message: "Payment excluded from funding." });
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-ink">Decision</legend>
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="link" defaultChecked className="mt-1 accent-[var(--color-accent)]" />
              <span className="flex-1">
                Link to subscription
                <input
                  name="subscriptionId"
                  list={datalistId}
                  autoComplete="off"
                  placeholder="SUB-…"
                  aria-label="Subscription ID to link to"
                  className={cx(inputClass, "num mt-1.5")}
                />
              </span>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="exclude" className="accent-[var(--color-accent)]" />
              Exclude from this offering&apos;s funding
            </label>
          </fieldset>
        </NoteForm>
      );
    }
    const conflict = row.conflicts.find((c) => c.incoming.id === exception.subjectKey);
    return conflict ? conflictBlock(exception, conflict) : null;
  }

  const canExcludeLines = Boolean(data?.canReview && row?.exceptions.some((e) => e.code === "POSSIBLE_DUPLICATE" && e.state === "open"));

  return (
    <aside
      aria-label={title}
      className="@container fixed inset-y-0 right-0 z-30 flex w-full max-w-[680px] flex-col border-l border-line-strong bg-paper shadow-[-12px_0_32px_-16px_rgba(13,27,51,0.25)] xl:sticky xl:top-4 xl:z-0 xl:max-h-[calc(100vh-2rem)] xl:max-w-none xl:rounded-lg xl:border xl:border-line xl:shadow-none"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <datalist id={datalistId}>
        {subscriptionIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4 xl:rounded-t-lg">
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="num truncate text-base font-semibold text-ink outline-none">
            {title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            {row ? <StatusPill status={row.status} /> : null}
            {row?.investorRef ? <span className="num">Investor {row.investorRef}</span> : null}
            {row?.inRegister ? <Pill tone="info">In draft register</Pill> : row && row.kind !== "funding" ? <Pill tone="neutral">Not in register</Pill> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {position ? (
            <span className="num mr-1 hidden text-xs text-ink-3 sm:inline">
              {position.index + 1} of {position.total}
            </span>
          ) : null}
          <button type="button" onClick={() => onStep(-1)} disabled={!position || position.index <= 0} aria-label="Previous row" className="rounded-md p-1.5 text-ink-2 hover:bg-paper-2 disabled:opacity-40">
            <ChevronUp aria-hidden className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onStep(1)} disabled={!position || position.index >= position.total - 1} aria-label="Next row" className="rounded-md p-1.5 text-ink-2 hover:bg-paper-2 disabled:opacity-40">
            <ChevronDown aria-hidden className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close details" className="rounded-md p-1.5 text-ink-2 hover:bg-paper-2">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {state.status === "loading" ? (
          <div role="status" aria-label="Loading row" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-md bg-paper-2" />
            ))}
          </div>
        ) : null}

        {state.status === "error" ? (
          <Callout tone="danger" role="alert" title={state.message}>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => { setState({ status: "loading" }); setReload((n) => n + 1); }}>
              Try again
            </button>
          </Callout>
        ) : null}

        {state.status === "missing" ? (
          <Callout tone="info" title="This row is no longer in the reconciliation">
            A new import or a reviewer decision changed it. Close this panel and pick a row from the table.
          </Callout>
        ) : null}

        {row && data ? (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line @md:grid-cols-5">
              {[
                { label: "Requested", value: money(row.requestedAmount) },
                { label: "Net cleared", value: row.kind === "funding" ? "—" : money(row.netCleared) },
                { label: "Approved", value: money(row.approvedAmount) },
                { label: "Approved units", value: row.approvedUnits == null ? "—" : formatUnits(row.approvedUnits) },
              ].map((item) => (
                <div key={item.label} className="bg-surface px-3 py-2.5">
                  <dt className="text-xs text-ink-3">{item.label}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold text-ink">{item.value}</dd>
                </div>
              ))}
              <div className={cx("col-span-2 px-3 py-2.5 @md:col-span-1", row.variance && row.variance !== "0.00" ? "bg-warn-soft" : "bg-surface")}>
                <dt className="text-xs text-ink-3">Variance</dt>
                <dd className={cx("num mt-0.5 text-sm font-semibold", row.variance && row.variance !== "0.00" ? "text-warn" : "text-ink")}>
                  {row.variance == null ? "—" : formatSignedMoney(row.variance, currency)}
                </dd>
                {row.varianceBasis ? (
                  <dd className="text-[11px] leading-tight text-ink-3">Net cleared less {row.varianceBasis === "approved" ? "approved" : "requested"}</dd>
                ) : null}
              </div>
            </dl>

            <div className="grid gap-3 @xl:grid-cols-3">
              <Column title="Subscription">
                {row.subscription ? (
                  <>
                    <dl>
                      <Fact label="Subscription ID">{row.subscription.data.subscription_id}</Fact>
                      <Fact label="Investor ref">{row.subscription.data.investor_ref}</Fact>
                      <Fact label="Share class">{row.subscription.data.share_class}</Fact>
                      <Fact label="Requested">{money(row.subscription.data.requested_amount, row.subscription.data.currency)}</Fact>
                      <Fact label="Signature">
                        <span className={row.subscription.data.signature_status === "signed" ? "" : "font-medium text-danger"}>
                          {titleCase(row.subscription.data.signature_status)}
                        </span>
                      </Fact>
                      {row.subscription.data.payment_reference ? <Fact label="Payment ref">{row.subscription.data.payment_reference}</Fact> : null}
                    </dl>
                    <SourceLine record={row.subscription} />
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">
                    {row.kind === "funding" ? "This payment is not matched to a subscription." : "No subscription with this ID is in the subscriptions file."}
                  </p>
                )}
              </Column>

              <Column title={`Funding records (${row.funding.length})`}>
                {row.funding.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No funding records reference this subscription.</p>
                ) : (
                  <ul className="space-y-3">
                    {row.funding.map((line) => {
                      const d = line.record.data;
                      const treatment = TREATMENT[line.treatment];
                      return (
                        <li key={line.record.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="num min-w-0 break-all text-[13px] font-medium text-ink">{d.transaction_ref}</span>
                            <span className="num whitespace-nowrap text-[13px] font-semibold text-ink">
                              {line.isReversal ? "−" : ""}
                              {formatMoney(d.amount, d.currency)}
                            </span>
                          </div>
                          <p className="num mt-0.5 text-xs text-ink-2">
                            {line.isReversal ? `Reversal of ${d.original_transaction_ref}` : titleCase(d.settlement_status)}
                            {d.settled_at ? ` · ${formatSettledAt(d.settled_at)}` : ""}
                          </p>
                          <div className="mt-1.5">
                            <Pill tone={treatment.tone}>{treatment.label}</Pill>
                          </div>
                          <p className="num mt-1.5 text-xs text-ink-3">
                            {line.matchedBy ? MATCHED_BY[line.matchedBy] : "No match"}
                            {line.effect !== "0.00" ? ` · counts ${formatSignedMoney(line.effect, d.currency)}` : ""}
                          </p>
                          {line.note ? <p className="mt-1 text-xs text-ink-2">{line.note}</p> : null}
                          <SourceLine record={line.record} />
                          {line.decision ? (
                            <>
                              <DecisionSummary decision={line.decision} />
                              {revokeControl(line.decision, line.decision.action === "link" ? "Undo this link" : "Undo this exclusion")}
                            </>
                          ) : null}
                          {canExcludeLines && !line.isReversal && line.treatment === "counted" && !line.decision ? (
                            excluding === line.record.key ? (
                              <NoteForm
                                submitLabel="Exclude payment"
                                variant="danger"
                                hint="Why this payment is a duplicate or does not belong"
                                onCancel={() => setExcluding(null)}
                                onSubmit={(note) => decide({ action: "exclude", transactionKey: line.record.key, note }, { message: `${d.transaction_ref} excluded from funding.` })}
                              />
                            ) : (
                              <button type="button" onClick={() => setExcluding(line.record.key)} className="mt-2 text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
                                Exclude this payment from funding
                              </button>
                            )
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Column>

              <Column title="Approved allocation">
                {row.allocation ? (
                  <>
                    <dl>
                      <Fact label="Subscription ID">{row.allocation.data.subscription_id}</Fact>
                      <Fact label="Share class">{row.allocation.data.share_class}</Fact>
                      <Fact label="Approved amount">{money(row.allocation.data.approved_amount, row.allocation.data.currency)}</Fact>
                      <Fact label="Approved units">{formatUnits(row.allocation.data.approved_units)}</Fact>
                    </dl>
                    <SourceLine record={row.allocation} />
                    <p className="mt-2 border-t border-line pt-2 text-xs text-ink-3">
                      Units come from the allocations file. They are never derived from funded amounts.
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">
                    {row.kind === "funding" ? "Not applicable to an unmatched payment." : "No approved allocation is in the allocations file for this subscription."}
                  </p>
                )}
              </Column>
            </div>

            <section aria-labelledby="exceptions-heading">
              <h3 id="exceptions-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Exceptions ({row.exceptions.length})
              </h3>
              {row.exceptions.length === 0 ? (
                <p className="rounded-md border border-line bg-surface px-3.5 py-3 text-[13px] text-ink-2">
                  No exceptions. Signature, cleared funding and the approved allocation agree.
                </p>
              ) : (
                <ul className="space-y-3">
                  {row.exceptions.map((exception) => (
                    <li
                      key={exception.id}
                      className={cx(
                        "rounded-md border bg-surface px-3.5 py-3",
                        exception.state !== "open" ? "border-line" : exception.severity === "blocker" ? "border-danger-line" : "border-warn-line",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{exception.title}</p>
                        {exception.state === "open" ? (
                          <Pill tone={exception.severity === "blocker" ? "danger" : "warn"}>{exception.severity === "blocker" ? "Blocker" : "Needs review"}</Pill>
                        ) : (
                          <Pill tone="ok">{exception.state === "documented" ? "Documented" : "Resolved"}</Pill>
                        )}
                        {exception.variance ? <span className="num ml-auto text-sm font-semibold text-ink">{formatSignedMoney(exception.variance, exception.currency ?? currency)}</span> : null}
                      </div>
                      <p className="num mt-1.5 text-[13px] text-ink">{exception.message}</p>
                      {exception.details.length > 0 ? (
                        <ul className="num mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                          {exception.details.map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                        </ul>
                      ) : null}
                      {exception.state === "open" ? <p className="mt-2 text-xs leading-relaxed text-ink-3">{exception.guidance}</p> : null}
                      {exceptionActions(exception)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="history-heading">
              <h3 id="history-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Reviewer decisions ({data.history.length})
              </h3>
              {data.history.length === 0 ? (
                <p className="text-[13px] text-ink-3">No reviewer decisions have been recorded for this row.</p>
              ) : (
                <ol className="space-y-2">
                  {data.history.map(({ decision, standing }) => {
                    const meta = STANDING[standing] ?? { label: standing, tone: "neutral" as const };
                    const code = decision.exceptionCode as ExceptionCode | null;
                    return (
                      <li key={decision.id} className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-[13px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">
                            {ACTION_LABEL[decision.action] ?? decision.action}
                            {decision.action === "link" && decision.payload.subscriptionKey ? ` to ${decision.payload.subscriptionKey}` : ""}
                          </span>
                          {code && EXCEPTION_META[code] ? <span className="text-xs text-ink-3">{EXCEPTION_META[code].title}</span> : null}
                          {decision.action !== "revoke" ? (
                            <Pill tone={meta.tone} className="ml-auto">
                              {meta.label}
                            </Pill>
                          ) : null}
                        </div>
                        <p className="mt-1 text-ink-2">{decision.note}</p>
                        <p className="mt-1 text-xs text-ink-3">
                          {decision.decidedBy.name ?? decision.decidedBy.email} · {formatDateTime(decision.decidedAt)}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}
