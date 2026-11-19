import { describe, expect, it } from "vitest";
import { explainRow } from "@/domain/explain";
import { acknowledge, importDemoFiles, newDeal, rowOf } from "../support/session";

describe("plain-English explanation of a row", () => {
  const { state } = importDemoFiles(newDeal());

  it("explains the guided case: signed 100,000, cleared 100,000 across two wires, approved 90,000", () => {
    const before = explainRow(rowOf(state, "SUB-1012::CLASS A"), "USD");
    expect(before.answers.map((a) => a.question)).toEqual(["Did they sign?", "Did their money clear?", "How many LLC units did the sponsor approve?"]);
    expect(before.answers.map((a) => a.answer)).toEqual([
      "Yes. INV-0412 signed for $100,000.00.",
      "Yes. $100,000.00 cleared across 2 payments (WIRE-20517 $60,000.00, WIRE-20518 $40,000.00).",
      "90 units for $90,000.00.",
    ]);
    expect(before.difference).toBe("Cleared funds are $10,000.00 above the approved allocation.");
    expect(before.outcome).toBe(
      "Once you record a review decision, the reviewed register export will carry the approved $90,000.00 and 90 units, never the amount funded. The $10,000.00 difference is settled outside Close Desk, which never moves money, issues units or starts a refund.",
    );

    const after = explainRow(rowOf(acknowledge(state, "SUB-1012::CLASS A", "EXCESS_FUNDING"), "SUB-1012::CLASS A"), "USD");
    expect(after.outcome).toMatch(/^The reviewed register export carries the approved \$90,000\.00 and 90 units\./);
  });

  it("says a blocker keeps the row out of the export, and that a pending wire is not counted", () => {
    const partial = explainRow(rowOf(state, "SUB-1023::CLASS B"), "USD");
    expect(partial.answers[1]?.answer).toBe("Partly. $100,000.00 cleared. $50,000.00 is pending and not counted.");
    expect(partial.difference).toBe("Cleared funds are $50,000.00 below the approved allocation.");
    expect(partial.outcome).toContain("stays out of the reviewed register export");

    const unsigned = explainRow(rowOf(state, "SUB-1019::CLASS A"), "USD");
    expect(unsigned.answers[0]).toMatchObject({ answer: "No. The subscription for $50,000.00 is pending.", tone: "danger" });
  });

  it("shows a reversed wire as gross payments less the reversal, so the listed amounts add up", () => {
    const reversed = explainRow(rowOf(state, "SUB-1027::CLASS A"), "USD");
    expect(reversed.answers[1]?.answer).toBe("Yes. $75,000.00 cleared: 2 payments totalling $150,000.00, less 1 reversal of $75,000.00.");
    expect(reversed.difference).toBeNull();
  });

  it("never suggests a match for a payment without a usable reference", () => {
    const unmatched = explainRow(rowOf(state, "FUNDING::WIRE-20338"), "USD");
    expect(unmatched.outcome).toContain("never matches a payment by name or by amount");
    expect(unmatched.answers[2]?.answer).toBe("Not applicable until the payment is matched.");
  });

  it("covers a subscription with no allocation and one with nothing wrong", () => {
    expect(explainRow(rowOf(state, "SUB-1044::CLASS A"), "USD").outcome).toBe(
      "This row is left out of the reviewed register export, because nothing is approved for it.",
    );
    const clean = explainRow(rowOf(state, "SUB-1001::CLASS A"), "USD");
    expect(clean.difference).toBeNull();
    expect(clean.outcome).toBe("The reviewed register export carries the approved $250,000.00 and 250 units.");
  });
});
