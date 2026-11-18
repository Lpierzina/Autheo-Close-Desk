"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { Button, Callout, inputClass } from "./ui";

export function ApproveForm({
  offeringId,
  fingerprint,
  nextVersion,
  registerLines,
  registerAmount,
}: {
  offeringId: string;
  fingerprint: string;
  nextVersion: number;
  registerLines: number;
  registerAmount: string;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reasons: string[] } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) {
      setError({ message: "Confirm that you have reviewed the close summary.", reasons: [] });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/offerings/${offeringId}/approve`, {
        method: "POST",
        json: { expectedFingerprint: fingerprint, note: note.trim() || undefined },
      });
      router.refresh();
    } catch (failure) {
      const details = failure instanceof ApiError ? (failure.details as { reasons?: string[] } | null) : null;
      setError({
        message: failure instanceof ApiError ? failure.message : "The close could not be approved. Nothing was changed.",
        reasons: details?.reasons ?? [],
      });
      // The server may have refused because the data moved on; show the current summary.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
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
      <div>
        <label htmlFor="approval-note" className="mb-1.5 block text-[13px] font-medium text-ink">
          Approval note <span className="ml-1 font-normal text-ink-3">Optional</span>
        </label>
        <textarea
          id="approval-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={2000}
          className={inputClass}
          placeholder="For example, the investment committee meeting this close was approved in"
        />
      </div>
      <label className="flex items-start gap-3 rounded-md border border-line bg-paper px-4 py-3">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="num text-[13px] text-ink">
          I have reviewed the close summary. Approving freezes version {nextVersion} with {registerLines.toLocaleString("en-US")} register lines
          totalling {registerAmount}. Later imports and decisions will not change it.
        </span>
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || !confirmed}>
          <ShieldCheck aria-hidden className="h-4 w-4" />
          {busy ? "Approving…" : `Approve and freeze version ${nextVersion}`}
        </Button>
      </div>
    </form>
  );
}
