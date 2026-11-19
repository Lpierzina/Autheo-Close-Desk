import type { FileKind } from "@/domain/types";
import { emptySession, setDeal, stageFile, type SessionState } from "./engine";
import { SAMPLE_FILES } from "./sample-files.generated";

/**
 * The synthetic Riverbend Flats files are compiled into the app. Loading the sample
 * session and downloading a sample file both read from this module; neither makes a request.
 */
export const SAMPLE_DEAL_NAME = "Riverbend Flats Apartments";

export const SAMPLE_SOURCE_FILES: Record<FileKind, string> = {
  subscriptions: "subscriptions.csv",
  funding: "funding.csv",
  allocations: "allocations.csv",
};

export const SAMPLE_CORRECTION_FILES: { kind: FileKind; filename: string; label: string }[] = [
  { kind: "subscriptions", filename: "subscriptions-corrections.csv", label: "Subscription corrections" },
  { kind: "funding", filename: "funding-corrections.csv", label: "Funding corrections (bank portal columns)" },
];

const encoder = new TextEncoder();

export function sampleFileText(filename: string): string {
  const text = SAMPLE_FILES[filename];
  if (text === undefined) throw new Error(`Unknown sample file ${filename}`);
  return text;
}

function stageSample(state: SessionState, kind: FileKind, filename: string): SessionState {
  return stageFile(state, kind, { filename, bytes: encoder.encode(sampleFileText(filename)) }, { sample: true });
}

const decoder = new TextDecoder();
const SAMPLE_TEXTS = new Set(Object.values(SAMPLE_FILES));

/** True when a selected file is byte-for-byte one of the bundled sample files, for example one saved from the file guide. */
export function isSampleContent(bytes: Uint8Array): boolean {
  return SAMPLE_TEXTS.has(decoder.decode(bytes));
}

/** Starts a fresh session with the three sample files selected, ready to preview and add. */
export function startSampleSession(): SessionState {
  let state = setDeal(emptySession(), { dealName: SAMPLE_DEAL_NAME, currency: "USD" });
  for (const kind of ["subscriptions", "funding", "allocations"] as const) {
    state = stageSample(state, kind, SAMPLE_SOURCE_FILES[kind]);
  }
  return state;
}

/** Selects the two sample correction files, which clear the blockers in the sample deal. */
export function stageSampleCorrections(state: SessionState): SessionState {
  let next = state;
  for (const file of SAMPLE_CORRECTION_FILES) next = stageSample(next, file.kind, file.filename);
  return next;
}

/** True while the workspace holds only records that came from the bundled sample files. */
export function isSampleSession(state: SessionState): boolean {
  return state.batches.length > 0 ? state.batches.every((b) => b.sample) : Object.values(state.staged).some((s) => s.sample);
}
