"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EXCEPTION_META, type ExceptionCode } from "@/domain/exceptions";
import { explainRow, type AnswerTone } from "@/domain/explain";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { formatMoney, formatSignedMoney, formatUnits } from "@/domain/money";
import type { ConflictView, FundingLine, ReconException, ReconRow } from "@/domain/reconcile";
import type { DecisionRecord, SourceRecord } from "@/domain/types";
import { formatSettledAt, titleCase } from "@/lib/format";
import { SessionError, decisionHistory, recordDecision, type DecisionInput } from "@/session/engine";
import { useSession } from "@/session/store";
import { Button, Callout, Pill, StatusPill, cx, inputClass } from "../ui";
import { stamp } from "./shared";

const TREATMENT: Record<FundingLine["treatment"], { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  counted: { label: "Counted", tone: "ok" },
  reversal_applied: { label: "Reversal applied", tone: "neutral" },
  pending: { label: "Pending, not counted", tone: "neutral" },
  not_cleared: { label: "Not cleared, not counted", tone: "neutral" },
  excluded: { label: "Excluded in review", tone: "warn" },
  invalid_reversal: { label: "Invalid reversal, not netted", tone: "danger" },
  currency_mismatch: { label: "Other currency, not netted", tone: "danger" },
  not_netted: { label: "Not netted", tone: "warn" },
  unmatched: { label: "Not matched", tone: "warn" },
};

const MATCHED_BY: Record<string, string> = {
  subscription_id: "Matched on subscription ID",
  payment_reference: "Matched on the payment reference in the subscriptions file",
  reviewer_link: "Linked in review",
  original_transaction: "Follows the original transaction",
};

const ACTION_LABEL: Record<string, string> = {
  acknowledge: "Reviewed and documented",
  link: "Linked payment",
  exclude: "Excluded payment from funding",
  accept_incoming: "Used the newer version",
  keep_existing: "Kept the existing version",
  revoke: "Withdrew an earlier decision",
};

const STANDING: Record<string, { label: string; tone: "ok" | "neutral" | "warn" }> = {
  in_effect: { label: "In effect", tone: "ok" },
  revoked: { label: "Withdrawn", tone: "neutral" },
  superseded: { label: "No longer applies", tone: "warn" },
};

const ANSWER_TONE: Record<AnswerTone, string> = {
  ok: "border-t-accent",
  warn: "border-t-warn",
  danger: "border-t-danger",
  neutral: "border-t-line-strong",
};

function SourceLine({ record }: { record: SourceRecord }) {
  return (
    <p className="num mt-2 break-all text-xs text-ink-3">
      {record.source.filename}, row {record.source.rowNumber}
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
  /** Throws SessionError when the decision is refused. */
  onSubmit: (note: string, form: FormData) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 10) {
      setError("Write a note of at least 10 characters explaining the decision.");
      document.getElementById(id)?.focus();
      return;
    }
    setError(null);
    try {
      onSubmit(trimmed, new FormData(event.currentTarget));
      setNote("");
    } catch (failure) {
      if (!(failure instanceof SessionError)) throw failure;
      setError(failure.message);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-2.5">
      {children}
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink">
          Review note
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
          {error ?? "Goes into the exceptions report with the time of the decision. Leave out personal details."}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant={variant}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function DecisionSummary({ decision }: { decision: DecisionRecord }) {
  return (
    <div className="mt-2 rounded-md border border-line bg-paper px-3 py-2 text-[13px]">
      <p className="text-ink">{decision.note}</p>
      <p className="num mt-1 text-xs text-ink-3">Recorded {stamp(decision.decidedAt)}</p>
    </div>
  );
}

export interface RowReviewProps {
  row: ReconRow;
  position: { index: number; total: number } | null;
  onStep: (delta: 1 | -1) => void;
  /** Called after a decision is recorded. A link moves the payment onto another row, named here. */
  onDecided: (message: string, next?: { subscriptionId: string }) => void;
  onSelectFiles: () => void;
  footer?: ReactNode;
}

/** One row of the reconciliation: what each file says, what differs, and the decisions that can be recorded. */
export function RowReview({ row, position, onStep, onDecided, onSelectFiles, footer }: RowReviewProps) {
  const { state, view, run } = useSession();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const datalistId = useId();

  // The parent keys this component by row, so mounting means another row was opened.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const currency = row.currency ?? state.currency;
  const money = (value: string | null | undefined, cur: string = currency) => (value == null ? "—" : formatMoney(value, cur));
  const explanation = explainRow(row, state.currency);
  const history = decisionHistory(row, state);
  const subscriptionIds = view.result.rows.flatMap((r) => (r.kind === "subscription" && r.subscriptionId ? [r.subscriptionId] : []));
  const title = row.kind === "funding" ? `Payment ${row.transactionRef}` : `${row.subscriptionId}${row.shareClass ? ` · ${row.shareClass}` : ""}`;
  const hasVariance = row.variance !== null && row.variance !== "0.00";

  function decide(input: Omit<DecisionInput, "rowKey">, message: string, next?: { subscriptionId: string }) {
    const result = run((s) => recordDecision(s, { rowKey: row.key, ...input }).state);
    if (!result.ok) throw result.error;
    setRevoking(null);
    setExcluding(null);
    onDecided(message, next);
  }

  function revokeControl(decision: DecisionRecord, label = "Withdraw this decision") {
    if (revoking !== decision.id) {
      return (
        <button type="button" onClick={() => setRevoking(decision.id)} className="mt-2 rounded text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
          {label}
        </button>
      );
    }
    return (
      <NoteForm
        submitLabel="Withdraw decision"
        variant="danger"
        hint="Why the earlier decision no longer stands"
        onCancel={() => setRevoking(null)}
        onSubmit={(note) => decide({ action: "revoke", decisionId: decision.id, note }, "The decision was withdrawn. The exception is open again.")}
      />
    );
  }

  function conflictBlock(exception: ReconException, conflict: ConflictView) {
    const labels = new Map(IMPORT_FIELDS[conflict.incoming.kind].map((f) => [f.key, f.label]));
    return (
      <div className="mt-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Field
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                In the workspace now
              </th>
              <th scope="col" className="py-1.5 font-medium">
                In the later file
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
        <p className="num mt-2 break-all text-xs text-ink-3">
          Now: {conflict.existing ? `${conflict.existing.source.filename}, row ${conflict.existing.source.rowNumber}` : "no record in use"} · Later file:{" "}
          {conflict.incoming.source.filename}, row {conflict.incoming.source.rowNumber}
        </p>
        <NoteForm
          submitLabel="Record decision"
          hint="Which version is correct, and how you confirmed it"
          onSubmit={(note, form) =>
            decide(
              { action: form.get("choice") === "accept_incoming" ? "accept_incoming" : "keep_existing", exceptionId: exception.id, note },
              "The two versions were resolved. Neither file was changed.",
            )
          }
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-ink">Which version stands?</legend>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="keep_existing" defaultChecked className="accent-[var(--color-accent)]" />
              Keep the record in the workspace
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="accept_incoming" className="accent-[var(--color-accent)]" />
              Use the version from the later file
            </label>
          </fieldset>
        </NoteForm>
      </div>
    );
  }

  function exceptionActions(exception: ReconException) {
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <span>Needs corrected source data. A note cannot clear this.</span>
          <Button onClick={onSelectFiles} size="sm">
            Select a corrected file
          </Button>
        </div>
      );
    }
    if (exception.resolution === "document") {
      return (
        <NoteForm
          submitLabel="Record review decision"
          hint="What you checked and how the difference is being handled"
          onSubmit={(note) => decide({ action: "acknowledge", exceptionId: exception.id, fingerprint: exception.fingerprint, note }, `${exception.title}: review decision recorded.`)}
        />
      );
    }
    if (exception.resolution === "link_or_exclude") {
      return (
        <NoteForm
          submitLabel="Record decision"
          hint="Evidence for the link, or why the payment is not part of this deal"
          onSubmit={(note, form) => {
            const subscriptionId = String(form.get("subscriptionId") ?? "").trim();
            if (form.get("choice") === "link") {
              if (!subscriptionId) throw new SessionError("validation", "Enter the subscription ID to link this payment to.");
              decide({ action: "link", transactionKey: exception.subjectKey, subscriptionId, note }, `Payment linked to ${subscriptionId.toUpperCase()}.`, { subscriptionId });
              return;
            }
            decide({ action: "exclude", transactionKey: exception.subjectKey, note }, "Payment excluded from funding.");
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-ink">Decision</legend>
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="link" defaultChecked className="mt-1 accent-[var(--color-accent)]" />
              <span className="flex-1">
                Link to a subscription I have confirmed
                <input name="subscriptionId" list={datalistId} autoComplete="off" placeholder="SUB-…" aria-label="Subscription ID to link to" className={cx(inputClass, "num mt-1.5")} />
              </span>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="radio" name="choice" value="exclude" className="accent-[var(--color-accent)]" />
              Exclude from this deal&apos;s funding
            </label>
          </fieldset>
        </NoteForm>
      );
    }
    const conflict = row.conflicts.find((c) => c.incoming.id === exception.subjectKey);
    return conflict ? conflictBlock(exception, conflict) : null;
  }

  const canExcludeLines = row.exceptions.some((e) => e.code === "POSSIBLE_DUPLICATE" && e.state === "open");
  const sourceColumn = "min-w-0 rounded-md border border-line border-t-2 bg-surface p-3.5";

  return (
    <article aria-label={title} data-testid="row-review" className="@container min-w-0 rounded-lg border border-line bg-paper">
      <datalist id={datalistId}>
        {subscriptionIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <header className="flex flex-wrap items-start justify-between gap-3 rounded-t-lg border-b border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="num text-base font-semibold text-ink outline-none">
            {title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <StatusPill status={row.status} />
            {row.investorRef ? <span className="num">Investor {row.investorRef}</span> : null}
            {row.inRegister ? <Pill tone="info">In the draft register</Pill> : row.kind !== "funding" ? <Pill tone="neutral">Not in the register</Pill> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {position ? (
            <span className="num mr-1 text-xs text-ink-3">
              {position.index + 1} of {position.total}
            </span>
          ) : null}
          <Button onClick={() => onStep(-1)} disabled={!position || position.index <= 0} aria-label="Previous in the list" size="sm">
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </Button>
          <Button onClick={() => onStep(1)} disabled={!position || position.index >= position.total - 1} aria-label="Next in the list" size="sm">
            <ChevronRight aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="space-y-5 px-5 py-5">
        <section aria-labelledby="sources-heading">
          <h3 id="sources-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            What each file says
          </h3>
          <div className="grid gap-3 @3xl:grid-cols-3">
            <div className={cx(sourceColumn, ANSWER_TONE[explanation.answers[0]?.tone ?? "neutral"])}>
              <p className="text-xs text-ink-3">{explanation.answers[0]?.source}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink">{explanation.answers[0]?.question}</p>
              <p className="num mt-1 text-[13px] leading-relaxed text-ink">{explanation.answers[0]?.answer}</p>
              {row.subscription ? (
                <>
                  <dl className="mt-3 border-t border-line pt-2">
                    <Fact label="Subscription ID">{row.subscription.data.subscription_id}</Fact>
                    <Fact label="Investor ref">{row.subscription.data.investor_ref}</Fact>
                    <Fact label="Share class">{row.subscription.data.share_class}</Fact>
                    <Fact label="Signed for">{money(row.subscription.data.requested_amount, row.subscription.data.currency)}</Fact>
                    <Fact label="Signature">
                      <span className={row.subscription.data.signature_status === "signed" ? "" : "font-medium text-danger"}>{titleCase(row.subscription.data.signature_status)}</span>
                    </Fact>
                    {row.subscription.data.payment_reference ? <Fact label="Payment ref">{row.subscription.data.payment_reference}</Fact> : null}
                  </dl>
                  <SourceLine record={row.subscription} />
                </>
              ) : null}
            </div>

            <div className={cx(sourceColumn, ANSWER_TONE[explanation.answers[1]?.tone ?? "neutral"])}>
              <p className="text-xs text-ink-3">{explanation.answers[1]?.source}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink">{explanation.answers[1]?.question}</p>
              <p className="num mt-1 text-[13px] leading-relaxed text-ink">{explanation.answers[1]?.answer}</p>
              {row.funding.length > 0 ? (
                <ul className="mt-3 space-y-3 border-t border-line pt-3">
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
                              onSubmit={(note) => decide({ action: "exclude", transactionKey: line.record.key, note }, `${d.transaction_ref} excluded from funding.`)}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setExcluding(line.record.key)}
                              aria-label={`Exclude ${d.transaction_ref} from funding`}
                              className="mt-2 rounded text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
                            >
                              Exclude this payment from funding
                            </button>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <div className={cx(sourceColumn, ANSWER_TONE[explanation.answers[2]?.tone ?? "neutral"])}>
              <p className="text-xs text-ink-3">{explanation.answers[2]?.source}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink">{explanation.answers[2]?.question}</p>
              <p className="num mt-1 text-[13px] leading-relaxed text-ink">{explanation.answers[2]?.answer}</p>
              {row.allocation ? (
                <>
                  <dl className="mt-3 border-t border-line pt-2">
                    <Fact label="Subscription ID">{row.allocation.data.subscription_id}</Fact>
                    <Fact label="Share class">{row.allocation.data.share_class}</Fact>
                    <Fact label="Approved amount">{money(row.allocation.data.approved_amount, row.allocation.data.currency)}</Fact>
                    <Fact label="Approved units">{formatUnits(row.allocation.data.approved_units)}</Fact>
                  </dl>
                  <SourceLine record={row.allocation} />
                  <p className="mt-2 border-t border-line pt-2 text-xs text-ink-3">Taken from the allocations file as supplied. Close Desk never changes approved amounts or units.</p>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="difference-heading"
          data-testid="difference"
          className={cx("rounded-md border px-4 py-3.5", explanation.difference ? "border-warn-line bg-warn-soft" : "border-line bg-surface")}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 id="difference-heading" className={cx("text-sm font-semibold", explanation.difference ? "text-warn" : "text-ink")}>
              {explanation.difference ? "What doesn't match" : "The three files agree"}
            </h3>
            {hasVariance && row.variance ? (
              <p className="num text-sm font-semibold text-warn">
                {formatSignedMoney(row.variance, currency)}
                <span className="ml-1.5 text-xs font-normal text-ink-2">net cleared less {row.varianceBasis === "approved" ? "approved" : "signed for"}</span>
              </p>
            ) : null}
          </div>
          {explanation.difference ? <p className="num mt-1 text-sm text-ink">{explanation.difference}</p> : null}
          <p className="num mt-1.5 text-[13px] leading-relaxed text-ink-2">{explanation.outcome}</p>
        </section>

        <section aria-labelledby="exceptions-heading">
          <h3 id="exceptions-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            Exceptions ({row.exceptions.length})
          </h3>
          {row.exceptions.length === 0 ? (
            <p className="rounded-md border border-line bg-surface px-3.5 py-3 text-[13px] text-ink-2">Nothing to resolve on this row.</p>
          ) : (
            <ul className="space-y-3">
              {row.exceptions.map((exception) => (
                <li
                  key={exception.id}
                  data-testid={`exception-${exception.code}`}
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
                      <Pill tone="ok">{exception.state === "documented" ? "Reviewed" : "Resolved"}</Pill>
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

        {history.length > 0 ? (
          <section aria-labelledby="history-heading">
            <h3 id="history-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Decisions in this session ({history.length})
            </h3>
            <ol className="space-y-2">
              {history.map(({ decision, standing }) => {
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
                    <p className="num mt-1 text-xs text-ink-3">{stamp(decision.decidedAt)}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {footer}
      </div>
    </article>
  );
}

export function MissingRow({ onBack }: { onBack: () => void }) {
  return (
    <Callout tone="info" title="That row is no longer in the reconciliation">
      A file or a decision changed it.{" "}
      <button type="button" onClick={onBack} className="font-medium underline underline-offset-2">
        Back to the list
      </button>
    </Callout>
  );
}
