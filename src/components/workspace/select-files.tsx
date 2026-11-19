"use client";

import { useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, FileUp, Trash2 } from "lucide-react";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domain/csv";
import { IMPORT_FIELDS } from "@/domain/import-fields";
import { formatMoney, formatUnits } from "@/domain/money";
import { FILE_KINDS, type FileKind } from "@/domain/types";
import { plural, titleCase } from "@/lib/format";
import {
  commitStaged,
  previewStaged,
  removeKind,
  setSkipInvalidRows,
  setStagedMapping,
  stageFile,
  unstageFile,
  type Batch,
  type ImportPreview,
} from "@/session/engine";
import { SAMPLE_SOURCE_FILES, isSampleContent } from "@/session/sample";
import { useSession } from "@/session/store";
import { ConfirmDialog } from "../confirm-dialog";
import { PrivacyNote } from "../notes";
import { SampleDownload } from "../sample-download";
import { Button, Callout, Pill, cx, inputClass } from "../ui";
import { SLOT, clock } from "./shared";

const MAX_MB = Math.floor(MAX_IMPORT_BYTES / (1024 * 1024));

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A collapsible section. `forceOpen` opens it when it needs attention, and it then stays open. */
function Disclosure({ summary, forceOpen = false, children }: { summary: ReactNode; forceOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(forceOpen);
  const id = useId();
  if (forceOpen && !open) setOpen(true);
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-ink hover:bg-paper-2"
      >
        {open ? <ChevronDown aria-hidden className="h-4 w-4 text-ink-3" /> : <ChevronRight aria-hidden className="h-4 w-4 text-ink-3" />}
        {summary}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  const flagged = tone && value > 0;
  return (
    <div data-count={label} className={cx("px-3 py-2", flagged ? (tone === "danger" ? "bg-danger-soft" : "bg-warn-soft") : "bg-surface")}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className={cx("num mt-0.5 text-[15px] font-semibold", flagged ? (tone === "danger" ? "text-danger" : "text-warn") : "text-ink")}>
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}

function StagedPreview({ kind, preview }: { kind: FileKind; preview: ImportPreview }) {
  const { run } = useSession();
  const fields = IMPORT_FIELDS[kind];
  const validation = preview.validation;
  const first = preview.sampleRows[0] ?? {};
  const unmapped = fields.filter((field) => field.required && !preview.mapping[field.key]).length;
  const skipId = useId();

  return (
    <div data-testid={`preview-${kind}`} className="mt-4 overflow-hidden rounded-md border border-line-strong bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-paper px-4 py-2.5">
        <FileSpreadsheet aria-hidden className="h-4 w-4 text-ink-3" />
        <span className="break-all text-[13px] font-medium text-ink">{preview.filename}</span>
        <span className="num text-xs text-ink-3">
          {fileSize(preview.byteSize)} · {plural(preview.rowCount, "row")}
        </span>
        <Pill tone="warn" className="ml-auto">
          Selected, not added yet
        </Pill>
        <Button variant="ghost" size="sm" onClick={() => run((s) => unstageFile(s, kind))}>
          Remove selection
        </Button>
      </div>

      {validation ? (
        <>
          <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
            <Count label="Rows in file" value={validation.counts.rowCount} />
            <Count label="Valid" value={validation.counts.validCount} />
            <Count label="Invalid" value={validation.counts.invalidCount} tone="danger" />
            <Count label="New" value={validation.counts.newCount} />
            <Count label="Already in workspace" value={validation.counts.unchangedCount + validation.counts.duplicateCount} />
            <Count label="Change a record" value={validation.counts.conflictCount} tone="warn" />
          </dl>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-2.5 text-[13px] text-ink-2">
            {validation.totals.totals.map((total) => (
              <span key={`${total.label}-${total.currency}`}>
                {total.label} <span className="num font-medium text-ink">{formatMoney(total.amount, total.currency)}</span>
              </span>
            ))}
            {validation.totals.units.map((unit) => (
              <span key={unit.shareClass}>
                {unit.shareClass} <span className="num font-medium text-ink">{formatUnits(unit.units)} units</span>
              </span>
            ))}
            {validation.totals.breakdown.map((part) => (
              <span key={part.label} className="text-ink-3">
                {titleCase(part.label)} <span className="num">{part.count}</span>
              </span>
            ))}
          </div>
          {validation.counts.duplicateCount > 0 ? (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
              {plural(validation.counts.duplicateCount, "row")} in this file {validation.counts.duplicateCount === 1 ? "repeats" : "repeat"} an earlier row exactly and{" "}
              {validation.counts.duplicateCount === 1 ? "is" : "are"} counted once.
            </p>
          ) : null}
        </>
      ) : null}

      {preview.mappingErrors.length > 0 ? (
        <div role="alert" className="border-t border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          <p className="font-medium">The column headers in this file differ from the expected ones.</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.mappingErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Disclosure
        forceOpen={preview.mappingErrors.length > 0}
        summary={
          <>
            Column mapping
            <span className="font-normal text-ink-3">
              {unmapped > 0 ? `${plural(unmapped, "required column")} to choose` : "every required column is matched; change any that are wrong"}
            </span>
          </>
        }
      >
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead className="bg-paper text-left text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Close Desk field
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Column in your file
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  First value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fields.map((field) => {
                const column = preview.mapping[field.key] ?? "";
                const missing = field.required && !column;
                const selectId = `map-${kind}-${field.key}`;
                return (
                  <tr key={field.key}>
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <label htmlFor={selectId} className="font-medium text-ink">
                        {field.label}
                      </label>
                      <span className={cx("ml-2 text-xs", field.required ? "text-ink-2" : "text-ink-3")}>{field.required ? "Required" : "Optional"}</span>
                    </th>
                    <td className="px-3 py-1.5">
                      <select
                        id={selectId}
                        value={column}
                        aria-invalid={missing}
                        onChange={(event) => run((s) => setStagedMapping(s, kind, { ...preview.mapping, [field.key]: event.target.value || null }))}
                        className={cx(inputClass, "py-1.5!", missing && "border-warn")}
                      >
                        <option value="">{field.required ? "Choose a column" : "Not in this file"}</option>
                        {preview.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num max-w-[220px] truncate px-3 py-2 text-ink-2">{column ? first[column] || <span className="text-ink-3">empty</span> : <span className="text-ink-3">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>

      {validation && validation.invalidRows.length > 0 ? (
        <div className="border-t border-danger-line bg-danger-soft px-4 py-3">
          <p className="text-[13px] font-medium text-danger">
            {plural(validation.counts.invalidCount, "row")} cannot be read and will not be added
          </p>
          <ul className="num mt-1.5 max-h-44 space-y-1 overflow-y-auto text-[13px] text-ink">
            {validation.invalidRows.map((row) => (
              <li key={row.rowNumber}>
                <span className="font-medium">Row {row.rowNumber}:</span> {row.errors.join("; ")}
              </li>
            ))}
          </ul>
          {validation.invalidRowsTruncated ? <p className="mt-1 text-xs text-ink-2">Only the first {validation.invalidRows.length} invalid rows are listed.</p> : null}
          <label htmlFor={skipId} className="mt-3 flex items-start gap-2 text-[13px] text-ink">
            <input
              id={skipId}
              type="checkbox"
              checked={preview.skipInvalidRows}
              onChange={(event) => run((s) => setSkipInvalidRows(s, kind, event.target.checked))}
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>
              Leave out {validation.counts.invalidCount === 1 ? "this row" : `these ${validation.counts.invalidCount} rows`} and add the rest. Correct{" "}
              {validation.counts.invalidCount === 1 ? "it" : "them"} in the source file and select it again later.
            </span>
          </label>
        </div>
      ) : null}

      {validation && validation.conflicts.length > 0 ? (
        <div className="border-t border-warn-line bg-warn-soft px-4 py-3">
          <p className="text-[13px] font-medium text-warn">
            {plural(validation.counts.conflictCount, "row")} {validation.counts.conflictCount === 1 ? "changes" : "change"} a record already in the workspace
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">Nothing is overwritten. Each one goes to Resolve exceptions, where you choose which version stands.</p>
          <ul className="num mt-2 space-y-1 text-[13px] text-ink">
            {validation.conflicts.map((conflict) => (
              <li key={conflict.rowNumber}>
                <span className="font-medium">{conflict.key}</span>
                {conflict.changes.map((change) => (
                  <span key={change.field} className="ml-2 text-ink-2">
                    {change.field}: {change.existing ?? "empty"} → {change.incoming ?? "empty"}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Disclosure summary={<>First rows of the file</>}>
        <div className="overflow-x-auto border-t border-line">
          <table className="num w-full border-collapse text-xs">
            <thead className="bg-paper text-left text-ink-3">
              <tr>
                {preview.headers.map((header) => (
                  <th key={header} scope="col" className="whitespace-nowrap px-3 py-1.5 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.sampleRows.map((row, index) => (
                <tr key={index}>
                  {preview.headers.map((header) => (
                    <td key={header} className="whitespace-nowrap px-3 py-1.5 text-ink-2">
                      {row[header]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>

      {preview.blockedBy ? (
        <p className="border-t border-line bg-paper px-4 py-2.5 text-[13px] font-medium text-ink">Before this file can be added: {preview.blockedBy}</p>
      ) : (
        <p className="flex items-center gap-2 border-t border-line bg-accent-soft px-4 py-2.5 text-[13px] font-medium text-accent-strong">
          <CheckCircle2 aria-hidden className="h-4 w-4" />
          Ready to add to the workspace
        </p>
      )}
    </div>
  );
}

function AddedFiles({ batches }: { batches: Batch[] }) {
  return (
    <ul className="mt-4 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {batches.map((batch) => (
        <li key={batch.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
          <CheckCircle2 aria-hidden className="h-4 w-4 text-accent" />
          <span className="break-all font-medium text-ink">{batch.filename}</span>
          <span className="num text-xs text-ink-3">
            {plural(batch.counts.newCount, "new record")}
            {batch.counts.unchangedCount + batch.counts.duplicateCount > 0 ? ` · ${batch.counts.unchangedCount + batch.counts.duplicateCount} already present` : ""}
            {batch.counts.conflictCount > 0 ? ` · ${batch.counts.conflictCount} sent to review` : ""}
            {batch.counts.invalidCount > 0 ? ` · ${batch.counts.invalidCount} invalid left out` : ""}
            {` · added ${clock(batch.addedAt)}`}
          </span>
          <Pill tone="ok" className="ml-auto">
            In workspace
          </Pill>
        </li>
      ))}
    </ul>
  );
}

function FileSlot({ kind, index }: { kind: FileKind; index: number }) {
  const { state, run } = useSession();
  const slot = SLOT[kind];
  const staged = state.staged[kind];
  const preview = useMemo(() => (staged ? previewStaged(state, kind) : null), [state, staged, kind]);
  const batches = useMemo(() => state.batches.filter((batch) => batch.kind === kind), [state.batches, kind]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = `slot-${kind}`;
  const required = IMPORT_FIELDS[kind].filter((field) => field.required);
  const optional = IMPORT_FIELDS[kind].filter((field) => !field.required);

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`That file is larger than the ${MAX_MB} MB limit. Split it into smaller files.`);
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = run((s) => stageFile(s, kind, { filename: file.name, bytes }, { sample: isSampleContent(bytes) }));
      if (!result.ok) setError(result.error.message);
    } catch {
      setError("The file could not be read. Check that it is still on this device and select it again.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      setError("Drop one file here. Each slot takes one CSV file at a time.");
      return;
    }
    void take(event.dataTransfer.files[0]);
  }

  return (
    <section aria-labelledby={headingId} data-testid={`slot-${kind}`} className="rounded-lg border border-line bg-surface p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">{index + 1}</span>
            <div className="min-w-0">
              <h3 id={headingId} className="text-[15px] font-semibold text-ink">
                {slot.question}
              </h3>
              <p className="text-[13px] text-ink-2">{slot.source}</p>
            </div>
          </div>
          <dl className="mt-3 space-y-1.5 pl-9 text-[13px]">
            <div>
              <dt className="inline text-ink-3">Required columns </dt>
              <dd className="inline text-ink">{required.map((field) => field.label).join(", ")}</dd>
            </div>
            {optional.length > 0 ? (
              <div>
                <dt className="inline text-ink-3">Optional </dt>
                <dd className="inline text-ink-2">{optional.map((field) => field.label).join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-1.5 pl-9 text-xs text-ink-3">{slot.rule}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 pl-9">
            <SampleDownload filename={SAMPLE_SOURCE_FILES[kind]} variant="link">
              Sample CSV
            </SampleDownload>
            <a
              href={`/guide/#${kind}-heading`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            >
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Column details
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            "flex flex-col items-center justify-center rounded-md border border-dashed px-4 py-5 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-paper",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            tabIndex={-1}
            data-testid={`file-input-${kind}`}
            aria-label={`${slot.source} CSV file`}
            onChange={(event) => void take(event.target.files?.[0])}
          />
          <Button variant={batches.length === 0 && !staged ? "primary" : "secondary"} disabled={reading} onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden className="h-4 w-4" />
            {reading ? "Reading…" : staged ? "Select a different file" : batches.length > 0 ? "Select another CSV file" : "Select CSV file"}
          </Button>
          <p className="num mt-2 text-xs text-ink-3">
            or drop a .csv file here · up to {MAX_MB} MB, {MAX_IMPORT_ROWS.toLocaleString("en-US")} rows
          </p>
          {batches.length > 0 && !staged ? <p className="mt-1 text-xs text-ink-3">A second file adds corrections. Rows already present are not counted twice.</p> : null}
        </div>
      </div>

      {error ? (
        <Callout tone="danger" role="alert" className="mt-4" title="That file was not selected">
          {error}
        </Callout>
      ) : null}

      {batches.length > 0 ? (
        <>
          <AddedFiles batches={batches} />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setRemoving(true)}
              className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-ink-2 underline-offset-2 hover:text-danger hover:underline"
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              Remove {slot.source.toLowerCase()} from the workspace
            </button>
          </div>
        </>
      ) : null}

      {preview ? <StagedPreview kind={kind} preview={preview} /> : null}

      <ConfirmDialog
        open={removing}
        title={`Remove ${slot.source.toLowerCase()} from the workspace?`}
        confirmLabel="Remove from workspace"
        danger
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          run((s) => removeKind(s, kind));
        }}
      >
        <p>Every record that came from {plural(batches.length, "file")} in this slot is taken out of the session, with the review decisions that only applied to those records.</p>
        <p>The files on your device are not changed.</p>
      </ConfirmDialog>
    </section>
  );
}

export function SelectFilesStep({ onAdded, onReview }: { onAdded: (message: string) => void; onReview: () => void }) {
  const { state, view, run } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reasons: string[] } | null>(null);
  const stagedKinds = FILE_KINDS.filter((kind) => state.staged[kind]);
  const blocked = stagedKinds.filter((kind) => previewStaged(state, kind)?.blockedBy);
  const canAdd = stagedKinds.length > 0 && blocked.length === 0;

  function add() {
    setBusy(true);
    setError(null);
    // Let the busy state paint before the files are parsed into the workspace.
    window.setTimeout(() => {
      let added = 0;
      const result = run((s) => {
        const committed = commitStaged(s);
        added = committed.results.length;
        return committed.state;
      });
      setBusy(false);
      if (result.ok) onAdded(`${plural(added, "file")} added to the workspace.`);
      else setError({ message: result.error.message, reasons: result.error.reasons });
    }, 30);
  }

  return (
    <section aria-labelledby="select-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-2xl">
          <h2 id="select-heading" className="text-lg font-semibold tracking-tight text-ink">
            Select CSV files
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            One file for each question. Each file is checked and previewed here first; nothing is added to the workspace until you choose to add it.
          </p>
        </div>
        <PrivacyNote className="max-w-sm rounded-md border border-accent-line bg-accent-soft px-3 py-2" />
      </div>

      <div className="mt-5 space-y-4">
        {FILE_KINDS.map((kind, index) => (
          <FileSlot key={kind} kind={kind} index={index} />
        ))}
      </div>

      {error ? (
        <Callout tone="danger" role="alert" className="mt-4" title={error.message}>
          {error.reasons.length > 0 ? (
            <ul className="list-disc pl-4">
              {error.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
        <p role="status" className="text-[13px] text-ink-2">
          {stagedKinds.length > 0
            ? blocked.length > 0
              ? `${plural(blocked.length, "selected file")} ${blocked.length === 1 ? "needs" : "need"} attention above before anything is added.`
              : `${plural(stagedKinds.length, "selected file")} checked and ready.`
            : view.filesAdded === 0
              ? "Select a file to see its preview."
              : view.missingFiles.length > 0
                ? `Still to add: ${view.missingFiles.map((kind) => SLOT[kind].source.toLowerCase()).join(", ")}.`
                : "All three files are in the workspace."}
        </p>
        {stagedKinds.length > 0 ? (
          <Button variant="primary" disabled={!canAdd || busy} onClick={add} data-testid="add-files">
            {busy ? "Adding…" : `Add ${plural(stagedKinds.length, "file")} and review matches`}
            {busy ? null : <ArrowRight aria-hidden className="h-4 w-4" />}
          </Button>
        ) : (
          <Button variant="primary" disabled={view.filesAdded === 0} onClick={onReview}>
            Review matches
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Button>
        )}
      </div>
    </section>
  );
}
