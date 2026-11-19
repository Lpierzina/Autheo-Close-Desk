"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, Download, Lock } from "lucide-react";
import { formatMoney, formatUnits, sumUnits } from "@/domain/money";
import { downloadText } from "@/lib/download";
import { plural } from "@/lib/format";
import { approve, exceptionsExport, reviewedRegisterExport } from "@/session/engine";
import { useSession } from "@/session/store";
import { SessionNote } from "../notes";
import { Button, Callout, Card, CardHeader, Pill, cx, inputClass } from "../ui";
import { SLOT, stamp } from "./shared";

const REGISTER_PREVIEW = 12;

export function ExportStep({ onResolve, onSelectFiles, onNotice }: { onResolve: () => void; onSelectFiles: () => void; onNotice: (message: string) => void }) {
  const { state, view, run } = useSession();
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ message: string; reasons: string[] } | null>(null);
  const [saved, setSaved] = useState<{ fingerprint: string; register: boolean; exceptions: boolean }>({ fingerprint: "", register: false, exceptions: false });
  const checkId = useId();
  const noteId = useId();
  const blockedId = useId();

  const { summary, register } = view.result;
  const approval = state.approval;
  const hasRecords = state.records.length > 0;
  const savedHere = saved.fingerprint === view.fingerprint ? saved : { fingerprint: view.fingerprint, register: false, exceptions: false };
  const money = (value: string) => formatMoney(value, summary.currency);
  const classes = [...new Set(register.map((line) => line.shareClass))];
  const unitsInRegister = classes.map((shareClass) => ({
    shareClass,
    units: sumUnits(register.filter((line) => line.shareClass === shareClass).map((line) => line.approvedUnits)),
  }));

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = run((s) => approve(s, { expectedFingerprint: view.fingerprint, note }));
    if (!result.ok) {
      setError({ message: result.error.message, reasons: result.error.reasons });
      return;
    }
    setChecked(false);
    setNote("");
    onNotice("Reviewed snapshot confirmed. The reviewed register export is ready to download.");
  }

  function saveRegister() {
    try {
      const file = reviewedRegisterExport(state);
      downloadText(file.filename, file.content);
      setSaved({ ...savedHere, register: true });
      onNotice(`${file.filename} was handed to your browser to save.`);
    } catch {
      setError({ message: "The reviewed register is available after the snapshot is confirmed.", reasons: view.reasons });
    }
  }

  function saveExceptions() {
    const file = exceptionsExport(state);
    downloadText(file.filename, file.content);
    setSaved({ ...savedHere, exceptions: true });
    onNotice(`${file.filename} was handed to your browser to save.`);
  }

  return (
    <section aria-labelledby="export-heading" className="space-y-5">
      <div>
        <h2 id="export-heading" className="text-lg font-semibold tracking-tight text-ink">
          Approve and export
        </h2>
        <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
          Confirm the reviewed snapshot, then download a reviewed register export for your administrator and a separate exceptions report. This is not
          the official legal register. Close Desk never moves money, issues units or initiates a refund.
        </p>
      </div>

      {state.voidedApproval && !approval ? (
        <Callout tone="warn" role="status" title="The earlier confirmation no longer applies">
          {state.voidedApproval.reason} after the snapshot was confirmed at {stamp(state.voidedApproval.approvedAt)}. A register downloaded before that
          describes the old data. Review the current figures and confirm again.
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" role="alert" title={error.message}>
          {error.reasons.length > 0 ? (
            <ul className="list-disc pl-4">
              {error.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <Card>
          <CardHeader
            title={approval ? "Reviewed register" : "Draft register"}
            description={
              approval
                ? "Frozen when the snapshot was confirmed."
                : "Rows that are ready or reviewed, with the sponsor's approved amounts and units. It becomes the reviewed register when you confirm."
            }
            action={approval ? <Pill tone="ok">Confirmed</Pill> : <Pill tone="neutral">Draft</Pill>}
          />
          <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            {[
              { label: "Register lines", value: (approval?.summary ?? summary).registerLineCount.toLocaleString("en-US") },
              { label: "Approved amount", value: money((approval?.summary ?? summary).registerAmount) },
              { label: "Exceptions reviewed", value: (approval?.documentedExceptions ?? view.documentedExceptions).toLocaleString("en-US") },
              { label: "Still open", value: (view.openBlockers + view.openReviews).toLocaleString("en-US") },
            ].map((item) => (
              <div key={item.label} className="bg-surface px-4 py-3">
                <dt className="text-xs text-ink-3">{item.label}</dt>
                <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
          {register.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-ink-3">
              No row can go in the register yet. A row is included once it is signed, funded and approved, and its exceptions are dealt with.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[13px]" aria-label="Register lines">
                  <thead className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-ink-3">
                    <tr>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Investor ref
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Share class
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Subscription
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Approved amount
                      </th>
                      <th scope="col" className="px-5 py-2 text-right font-medium">
                        Approved units
                      </th>
                    </tr>
                  </thead>
                  <tbody className="num divide-y divide-line">
                    {register.slice(0, REGISTER_PREVIEW).map((line) => (
                      <tr key={`${line.subscriptionId}-${line.shareClass}`}>
                        <td className="px-5 py-2 text-ink-2">{line.investorRef}</td>
                        <td className="px-3 py-2 text-ink-2">{line.shareClass}</td>
                        <td className="px-3 py-2 font-medium text-ink">{line.subscriptionId}</td>
                        <td className="px-3 py-2 text-right text-ink">{formatMoney(line.approvedAmount, line.currency)}</td>
                        <td className="px-5 py-2 text-right text-ink">{formatUnits(line.approvedUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="num border-t border-line px-5 py-2.5 text-xs text-ink-3">
                {register.length > REGISTER_PREVIEW ? `First ${REGISTER_PREVIEW} of ${register.length} lines. ` : ""}
                {unitsInRegister.map((c) => `${c.shareClass}: ${formatUnits(c.units)} units`).join(" · ")}
              </p>
            </>
          )}
        </Card>

        <div className="space-y-4">
          {approval ? (
            <Card data-testid="confirmed" className="border-accent-line">
              <div className="flex items-start gap-3 border-b border-line px-5 py-4">
                <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">Reviewed snapshot confirmed</h3>
                  <p className="num text-[13px] text-ink-2">
                    {stamp(approval.approvedAt)} · {plural(approval.summary.registerLineCount, "line")} · {money(approval.summary.registerAmount)}
                  </p>
                  {approval.note ? <p className="mt-1.5 text-[13px] text-ink-2">Note: {approval.note}</p> : null}
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div>
                  <Button variant="primary" className="w-full" onClick={saveRegister} data-testid="download-register">
                    <Download aria-hidden className="h-4 w-4" />
                    Download reviewed register export
                  </Button>
                  <p className="num mt-1.5 break-all text-[11px] leading-snug text-ink-3">
                    {savedHere.register ? "Handed to your browser. " : ""}SHA-256 {approval.registerSha256}
                  </p>
                </div>
                <div>
                  <Button className="w-full" onClick={saveExceptions} data-testid="download-exceptions">
                    <Download aria-hidden className="h-4 w-4" />
                    Download exceptions report
                  </Button>
                  <p className="num mt-1.5 break-all text-[11px] leading-snug text-ink-3">
                    {savedHere.exceptions ? "Handed to your browser. " : ""}SHA-256 {approval.exceptionsSha256}
                  </p>
                </div>
                <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-ink-2">
                  Both files are written on this device. Send the reviewed register export to your administrator; it is not the official legal register.
                </p>
                <SessionNote />
              </div>
            </Card>
          ) : view.canApprove ? (
            <Card>
              <CardHeader title="Confirm the reviewed snapshot" description="Any later change to files, mappings or decisions cancels this confirmation." />
              <form onSubmit={confirm} noValidate className="space-y-3 px-5 py-4">
                <label htmlFor={checkId} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink">
                  <input id={checkId} type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
                  <span>
                    I have reviewed the matches and every exception, and I confirm this snapshot of {plural(summary.registerLineCount, "register line")} for{" "}
                    <span className="num font-medium">{money(summary.registerAmount)}</span> on behalf of the sponsor.
                  </span>
                </label>
                <div>
                  <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-ink">
                    Note for your own records <span className="font-normal text-ink-3">Optional</span>
                  </label>
                  <textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} className={inputClass} />
                </div>
                <Button type="submit" variant="primary" className="w-full" disabled={!checked} data-testid="confirm-snapshot">
                  Confirm reviewed snapshot
                </Button>
              </form>
            </Card>
          ) : (
            <Card data-testid="export-blocked" className="border-danger-line">
              <div className="flex items-start gap-3 border-b border-line px-5 py-4">
                <Lock aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">The reviewed register cannot be confirmed yet</h3>
                  <ul id={blockedId} className="mt-1.5 list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
                    {view.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  {view.openBlockers + view.openReviews > 0 ? (
                    <Button variant="primary" onClick={onResolve}>
                      Resolve exceptions
                    </Button>
                  ) : null}
                  {view.missingFiles.length > 0 || Object.keys(state.staged).length > 0 ? <Button onClick={onSelectFiles}>Select CSV files</Button> : null}
                </div>
                {view.missingFiles.length > 0 ? (
                  <p className="text-xs text-ink-3">Not in the workspace yet: {view.missingFiles.map((kind) => SLOT[kind].source.toLowerCase()).join(", ")}.</p>
                ) : null}
              </div>
            </Card>
          )}

          {approval ? null : (
            <Card>
              <CardHeader title="Downloads" />
              <div className="space-y-3 px-5 py-4">
                <div>
                  <Button className="w-full" disabled aria-describedby={`${blockedId}-register`} data-testid="download-register">
                    <Lock aria-hidden className="h-4 w-4" />
                    Download reviewed register export
                  </Button>
                  <p id={`${blockedId}-register`} className="mt-1.5 text-xs text-ink-3">
                    {view.canApprove ? "Available as soon as you confirm the snapshot." : "Not available while blockers or unreviewed exceptions remain."}
                  </p>
                </div>
                <div>
                  <Button className={cx("w-full")} disabled={!hasRecords} onClick={saveExceptions} data-testid="download-exceptions">
                    <Download aria-hidden className="h-4 w-4" />
                    Download exceptions report (draft)
                  </Button>
                  <p className="mt-1.5 text-xs text-ink-3">
                    {hasRecords
                      ? "Available at any time. It lists every exception with its state, so you can chase corrections before the register is ready."
                      : "Available once a file is in the workspace."}
                    {savedHere.exceptions ? " Handed to your browser." : ""}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
