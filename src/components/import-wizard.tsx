"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { IMPORT_FIELDS, validateMapping, type ColumnMapping } from "@/domain/import-fields";
import { formatMoney, formatUnits } from "@/domain/money";
import { FILE_KIND_LABEL, type FileKind } from "@/domain/types";
import { api, ApiError } from "@/lib/api-client";
import { plural, titleCase } from "@/lib/format";
import type { CommitResult, ImportPreview } from "@/server/services/imports";
import { Button, ButtonLink, Callout, Card, Pill, Td, Th, cx, inputClass } from "./ui";

type Step = "choose" | "map" | "review" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "choose", label: "Choose file" },
  { id: "map", label: "Map columns" },
  { id: "review", label: "Review and commit" },
];

const DISPOSITION: Record<string, { label: string; tone: "ok" | "neutral" | "warn" }> = {
  new: { label: "New", tone: "ok" },
  unchanged: { label: "Already imported", tone: "neutral" },
  duplicate: { label: "Repeated in file", tone: "neutral" },
  conflict: { label: "Conflict", tone: "warn" },
};

function StepHeading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
      {children}
    </h2>
  );
}

export function ImportWizard({
  offeringId,
  offeringCurrency,
  kind,
  maxBytes,
  maxRows,
}: {
  offeringId: string;
  offeringCurrency: string;
  kind: FileKind;
  maxBytes: number;
  maxRows: number;
}) {
  const router = useRouter();
  const fileInputId = useId();
  const [step, setStep] = useState<Step>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const fields = IMPORT_FIELDS[kind];
  const base = `/offerings/${offeringId}`;
  const label = FILE_KIND_LABEL[kind].toLowerCase();
  const maxMb = Math.floor(maxBytes / (1024 * 1024));

  async function requestPreview(target: File, withMapping: ColumnMapping | null): Promise<ImportPreview | null> {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", target);
      if (withMapping) body.set("mapping", JSON.stringify(withMapping));
      const { preview: next } = await api<{ preview: ImportPreview }>(`/api/offerings/${offeringId}/imports/preview`, { method: "POST", body });
      setPreview(next);
      setMapping(next.mapping);
      return next;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The file could not be read.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(chosen: File | null) {
    setError(null);
    setPreview(null);
    setSkipInvalid(false);
    setFile(chosen);
    if (!chosen) return;
    if (!/\.csv$/i.test(chosen.name)) {
      setError("Choose a .csv file. Export spreadsheets as CSV (UTF-8) first.");
      return;
    }
    if (chosen.size === 0) {
      setError("That file is empty.");
      return;
    }
    if (chosen.size > maxBytes) {
      setError(`That file is larger than the ${maxMb} MB import limit. Split it into smaller files.`);
      return;
    }
    const next = await requestPreview(chosen, null);
    if (next) setStep("map");
  }

  const mappingErrors = preview ? validateMapping(kind, preview.headers, mapping) : [];

  async function confirmMapping() {
    if (!file || mappingErrors.length > 0) return;
    const next = await requestPreview(file, mapping);
    if (next?.validation) {
      setSkipInvalid(false);
      setStep("review");
    }
  }

  async function commit() {
    if (!file || !preview?.validation) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      body.set("mapping", JSON.stringify(mapping));
      body.set("expectedSha256", preview.sha256);
      body.set("skipInvalidRows", String(skipInvalid));
      const committed = await api<CommitResult>(`/api/offerings/${offeringId}/imports`, { method: "POST", body });
      setResult(committed);
      setStep("done");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The import could not be committed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep("choose");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setSkipInvalid(false);
  }

  const validation = preview?.validation ?? null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-5">
      {step !== "done" ? (
        <ol aria-label="Import steps" className="flex flex-wrap gap-x-2 gap-y-2 text-[13px]">
          {STEPS.map((s, index) => (
            <li key={s.id} className="flex items-center gap-2" aria-current={s.id === step ? "step" : undefined}>
              <span
                className={cx(
                  "num flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                  index < stepIndex ? "border-accent bg-accent text-white" : index === stepIndex ? "border-ink text-ink" : "border-line-strong text-ink-3",
                )}
              >
                {index + 1}
              </span>
              <span className={cx(index === stepIndex ? "font-medium text-ink" : "text-ink-3")}>{s.label}</span>
              {index < STEPS.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-line-strong" /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {busy ? "Working…" : ""}
      </div>
      {error ? <Callout tone="danger" role="alert" title={error} /> : null}

      {step === "choose" ? (
        <Card className="p-6">
          <StepHeading>{`Choose the ${label} file`}</StepHeading>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-2">
            CSV, UTF-8, with a header row. Up to {maxMb} MB and {maxRows.toLocaleString("en-US")} rows. Your column names can
            differ from ours; you map them in the next step. Nothing is saved until you commit.
          </p>
          <label
            htmlFor={fileInputId}
            className={cx(
              "mt-5 flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-line-strong bg-paper px-6 py-10 text-center transition-colors hover:border-accent hover:bg-accent-soft/40",
              "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
              busy && "pointer-events-none opacity-60",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void chooseFile(event.dataTransfer.files[0] ?? null);
            }}
          >
            <FileUp aria-hidden className="h-7 w-7 text-ink-3" />
            <span className="mt-3 text-sm font-medium text-ink">{busy ? "Reading file…" : "Choose a CSV file, or drop it here"}</span>
            <span className="mt-1 text-xs text-ink-3">{file ? file.name : "The file is read in memory and is not stored on the server."}</span>
            <input
              id={fileInputId}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void chooseFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="text-[13px] font-semibold text-ink">Columns this file needs</h3>
            <ul className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              {fields.map((field) => (
                <li key={field.key} className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2">
                  <span className="text-ink">{field.label}</span>
                  <span className={cx("text-xs", field.required ? "text-ink-2" : "text-ink-3")}>{field.required ? "Required" : "Optional"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-ink-3">
              <Link href="/guide" className="font-medium text-accent-strong underline underline-offset-2">
                Field guide
              </Link>{" "}
              explains each column and has sample files to download.
            </p>
          </div>
        </Card>
      ) : null}

      {step === "map" && preview ? (
        <Card>
          <div className="border-b border-line px-6 py-5">
            <StepHeading>Map your columns</StepHeading>
            <p className="mt-1 text-[13px] text-ink-2">
              <span className="font-medium text-ink">{preview.filename}</span> has {plural(preview.headers.length, "column")}. Confirm which
              column holds each field. Suggestions come from the header names and from the last import of this file type.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="border-b border-line bg-paper">
                <tr>
                  <Th className="w-[30%] pl-6">Close Desk field</Th>
                  <Th className="w-[28%]">Column in your file</Th>
                  <Th>First values in that column</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fields.map((field) => {
                  const selected = mapping[field.key] ?? "";
                  const samples = selected ? preview.sampleRows.map((row) => row[selected] ?? "").filter((v) => v !== "").slice(0, 3) : [];
                  const missing = field.required && !selected;
                  return (
                    <tr key={field.key}>
                      <Td className="pl-6">
                        <label htmlFor={`map-${field.key}`} className="font-medium text-ink">
                          {field.label}
                        </label>
                        <span className={cx("ml-2 text-xs", field.required ? "text-ink-2" : "text-ink-3")}>{field.required ? "Required" : "Optional"}</span>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{field.description}</p>
                      </Td>
                      <Td>
                        <select
                          id={`map-${field.key}`}
                          className={cx(inputClass, missing && "border-danger-line")}
                          value={selected}
                          aria-invalid={missing}
                          onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value || null })}
                        >
                          <option value="">{field.required ? "Choose a column" : "Not in this file"}</option>
                          {preview.headers.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td className="num text-ink-2">
                        {samples.length > 0 ? samples.join("  ·  ") : <span className="text-ink-3">{selected ? "No values in the first rows" : "—"}</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 border-t border-line px-6 py-5">
            {mappingErrors.length > 0 ? (
              <Callout tone="warn" title="Finish the mapping to continue">
                <ul className="list-disc space-y-0.5 pl-4">
                  {mappingErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={restart} disabled={busy}>
                Choose a different file
              </Button>
              <Button variant="primary" onClick={confirmMapping} disabled={busy || mappingErrors.length > 0}>
                {busy ? "Checking rows…" : "Preview import"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "review" && preview && validation ? (
        <>
          <Card>
            <div className="border-b border-line px-6 py-5">
              <StepHeading>Review before committing</StepHeading>
              <p className="mt-1 text-[13px] text-ink-2">
                This is what committing <span className="font-medium text-ink">{preview.filename}</span> will do. Nothing has been saved yet.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Rows in file", value: validation.counts.rowCount, tone: "" },
                { label: "Valid rows", value: validation.counts.validCount, tone: "" },
                { label: "Invalid rows", value: validation.counts.invalidCount, tone: validation.counts.invalidCount > 0 ? "text-danger" : "" },
                { label: "New records", value: validation.counts.newCount, tone: "" },
                { label: "Already imported", value: validation.counts.unchangedCount + validation.counts.duplicateCount, tone: "" },
                { label: "Conflicts", value: validation.counts.conflictCount, tone: validation.counts.conflictCount > 0 ? "text-warn" : "" },
              ].map((item) => (
                <div key={item.label} className="bg-surface px-5 py-4">
                  <dt className="text-xs text-ink-3">{item.label}</dt>
                  <dd className={cx("num mt-1 text-xl font-semibold text-ink", item.tone)}>{item.value.toLocaleString("en-US")}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-x-10 gap-y-4 border-t border-line px-6 py-5 md:grid-cols-2">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Totals of valid rows</h3>
                {validation.totals.totals.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-3">No valid rows to total.</p>
                ) : (
                  <dl className="mt-2 space-y-1.5 text-[13px]">
                    {validation.totals.totals.map((total) => (
                      <div key={`${total.label}-${total.currency}`} className="flex justify-between gap-4">
                        <dt className="text-ink-2">
                          {total.label}
                          {total.currency !== offeringCurrency ? <span className="ml-2 text-warn">{total.currency}, not the offering currency</span> : null}
                        </dt>
                        <dd className="num font-medium text-ink">{formatMoney(total.amount, total.currency)}</dd>
                      </div>
                    ))}
                    {validation.totals.units.map((u) => (
                      <div key={u.shareClass} className="flex justify-between gap-4">
                        <dt className="text-ink-2">{u.shareClass} units</dt>
                        <dd className="num font-medium text-ink">{formatUnits(u.units)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Rows by status</h3>
                <dl className="mt-2 space-y-1.5 text-[13px]">
                  {validation.totals.breakdown.map((item) => (
                    <div key={item.label} className="flex justify-between gap-4">
                      <dt className="text-ink-2">{titleCase(item.label)}</dt>
                      <dd className="num font-medium text-ink">{item.count}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            {validation.counts.unchangedCount + validation.counts.duplicateCount > 0 ? (
              <p className="border-t border-line px-6 py-3 text-[13px] text-ink-2">
                <span className="num">{plural(validation.counts.unchangedCount + validation.counts.duplicateCount, "row")}</span> match records that
                are already imported or are repeated in this file. They are counted once and nothing is written for them.
              </p>
            ) : null}
          </Card>

          {validation.invalidRows.length > 0 ? (
            <Card aria-labelledby="invalid-heading" className="border-danger-line">
              <div className="border-b border-line px-6 py-4">
                <h3 id="invalid-heading" className="text-[15px] font-semibold text-danger">
                  {plural(validation.counts.invalidCount, "invalid row")}
                </h3>
                <p className="mt-0.5 text-[13px] text-ink-2">
                  These rows cannot be imported as they are. Fix them in the source file and import again, or leave them out of this batch.
                </p>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead className="sticky top-0 border-b border-line bg-paper">
                    <tr>
                      <Th className="pl-6">File row</Th>
                      <Th>Problem</Th>
                      <Th>Values in the row</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {validation.invalidRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <Td className="num pl-6">{row.rowNumber}</Td>
                        <Td className="text-danger">
                          {row.errors.map((message) => (
                            <p key={message}>{message}</p>
                          ))}
                        </Td>
                        <Td className="num text-xs text-ink-3">
                          {Object.values(row.raw)
                            .filter((v) => v !== "")
                            .join("  ·  ")}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {validation.invalidRowsTruncated ? (
                <p className="border-t border-line px-6 py-3 text-xs text-ink-3">Showing the first {validation.invalidRows.length} invalid rows.</p>
              ) : null}
            </Card>
          ) : null}

          {validation.conflicts.length > 0 ? (
            <Card aria-labelledby="conflicts-heading" className="border-warn-line">
              <div className="border-b border-line px-6 py-4">
                <h3 id="conflicts-heading" className="text-[15px] font-semibold text-warn">
                  {plural(validation.counts.conflictCount, "conflict")} with records already imported
                </h3>
                <p className="mt-0.5 text-[13px] text-ink-2">
                  These rows use a reference that already exists with different content. The existing record is not overwritten. Both
                  versions go to review, where a reviewer chooses which one stands.
                </p>
              </div>
              <ul className="divide-y divide-line">
                {validation.conflicts.map((conflict) => (
                  <li key={`${conflict.rowNumber}-${conflict.key}`} className="px-6 py-3 text-[13px]">
                    <p className="font-medium text-ink">
                      {conflict.key} <span className="num font-normal text-ink-3">· file row {conflict.rowNumber}</span>
                    </p>
                    <ul className="mt-1 space-y-0.5 text-ink-2">
                      {conflict.changes.map((change) => (
                        <li key={change.field} className="num">
                          {change.field}: <span className="text-ink-3">{change.existing ?? "empty"}</span> → <span className="text-ink">{change.incoming ?? "empty"}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card aria-labelledby="rows-heading">
            <div className="border-b border-line px-6 py-4">
              <h3 id="rows-heading" className="text-[15px] font-semibold text-ink">
                Preview of valid rows
              </h3>
              <p className="mt-0.5 text-[13px] text-ink-2">
                The first {validation.rows.length} of {validation.counts.validCount.toLocaleString("en-US")} valid rows, as they will be stored.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="border-b border-line bg-paper">
                  <tr>
                    <Th className="pl-6">Row</Th>
                    {fields.map((field) => (
                      <Th key={field.key}>{field.label}</Th>
                    ))}
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {validation.rows.map((row) => {
                    const data = row.data as unknown as Record<string, string | null>;
                    const disposition = DISPOSITION[row.disposition] ?? { label: row.disposition, tone: "neutral" as const };
                    return (
                      <tr key={row.rowNumber}>
                        <Td className="num pl-6 text-ink-3">{row.rowNumber}</Td>
                        {fields.map((field) => (
                          <Td key={field.key} className="num whitespace-nowrap">
                            {data[field.key] ?? <span className="text-ink-3">—</span>}
                          </Td>
                        ))}
                        <Td>
                          <Pill tone={disposition.tone}>{disposition.label}</Pill>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            {validation.counts.invalidCount > 0 ? (
              <label className="flex items-start gap-3 rounded-md border border-warn-line bg-warn-soft px-4 py-3">
                <input
                  type="checkbox"
                  checked={skipInvalid}
                  onChange={(event) => setSkipInvalid(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-[13px] text-warn">
                  <span className="block font-medium">
                    Leave out {plural(validation.counts.invalidCount, "invalid row")} and import the {plural(validation.counts.validCount, "valid row")}
                  </span>
                  <span className="block">The rows left out are listed in the import history. They are not part of the reconciliation.</span>
                </span>
              </label>
            ) : null}
            {validation.counts.newCount + validation.counts.conflictCount === 0 ? (
              <Callout tone="info" title="This file adds nothing new">
                Every valid row is already imported. Committing records the batch in the history and changes no totals.
              </Callout>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("map")} disabled={busy}>
                Back to mapping
              </Button>
              <Button
                variant="primary"
                onClick={commit}
                disabled={busy || validation.counts.validCount === 0 || (validation.counts.invalidCount > 0 && !skipInvalid)}
              >
                {busy ? "Committing…" : `Commit ${plural(validation.counts.validCount, "row")}`}
              </Button>
            </div>
            {validation.counts.validCount === 0 ? (
              <p role="alert" className="text-right text-[13px] font-medium text-danger">
                There are no valid rows to import. Fix the file and try again.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}

      {step === "done" && result ? (
        <Card className="p-8">
          <div role="status" className="flex flex-col items-center text-center">
            <CheckCircle2 aria-hidden className="h-9 w-9 text-accent" />
            <StepHeading>{`${FILE_KIND_LABEL[kind]} imported`}</StepHeading>
            <p className="num mt-2 max-w-lg text-sm text-ink-2">
              {plural(result.counts.newCount, "new record")} added, {plural(result.counts.unchangedCount + result.counts.duplicateCount, "row")} already
              imported
              {result.counts.conflictCount > 0 ? `, ${plural(result.counts.conflictCount, "conflict")} sent to review` : ""}
              {result.counts.invalidCount > 0 ? `, ${plural(result.counts.invalidCount, "invalid row")} left out` : ""}. The reconciliation has been
              updated.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <ButtonLink href={`${base}/imports`}>Back to imports</ButtonLink>
              <ButtonLink href={`${base}/reconciliation`} variant="primary">
                Open reconciliation
              </ButtonLink>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
