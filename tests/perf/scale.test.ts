import { describe, expect, it } from "vitest";
import { commitStaged, emptySession, previewStaged, recordDecision, stageFile, viewOf } from "@/session/engine";
import { ALLOCATIONS_HEADER, FUNDING_HEADER, SUBSCRIPTIONS_HEADER } from "../support/build";

const N = 20_000;
const encoder = new TextEncoder();
const time = <T,>(label: string, run: () => T): T => {
  const start = performance.now();
  const value = run();
  console.log(`${label}: ${(performance.now() - start).toFixed(0)} ms`);
  return value;
};

describe("scale", () => {
  it("handles the row limit", () => {
    const subs = [SUBSCRIPTIONS_HEADER];
    const funding = [FUNDING_HEADER];
    const allocs = [ALLOCATIONS_HEADER];
    for (let i = 0; i < N; i += 1) {
      const id = `SUB-${String(i).padStart(6, "0")}`;
      subs.push(`${id},INV-${String(i).padStart(6, "0")},Class A,100000.00,USD,signed,`);
      allocs.push(`${id},Class A,${i % 50 === 0 ? "90000.00" : "100000.00"},${i % 50 === 0 ? "90" : "100"},USD`);
    }
    for (let i = 0; i < N; i += 1) {
      const id = `SUB-${String(Math.floor(i / 2)).padStart(6, "0")}`;
      funding.push(`WIRE-${i},${id},,50000.00,USD,cleared,2026-10-20,`);
    }
    let state = emptySession();
    state = time("stage subs", () => stageFile(state, "subscriptions", { filename: "s.csv", bytes: encoder.encode(subs.join("\n")) }));
    state = time("stage funding", () => stageFile(state, "funding", { filename: "f.csv", bytes: encoder.encode(funding.join("\n")) }));
    state = time("stage allocs", () => stageFile(state, "allocations", { filename: "a.csv", bytes: encoder.encode(allocs.join("\n")) }));
    time("preview subs", () => previewStaged(state, "subscriptions"));
    time("preview funding", () => previewStaged(state, "funding"));
    time("preview allocs", () => previewStaged(state, "allocations"));
    state = time("commit", () => commitStaged(state).state);
    const view = time("reconcile", () => viewOf(state));
    console.log(view.result.summary.counts);
    const row = view.result.rows.find((r) => r.status === "needs_review");
    const exception = row?.exceptions[0];
    state = time("decision", () => recordDecision(state, { action: "acknowledge", rowKey: row?.key ?? "", exceptionId: exception?.id, note: "Documented for the scale test." }).state);
    time("reconcile after decision", () => viewOf(state));
    expect(view.result.rows.length).toBe(N);
  });
});
