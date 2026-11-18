import { describe, expect, it } from "vitest";
import { add, cmp, formatMoney, formatSignedMoney, formatUnits, parseMoney, parseUnits, sub, sumMoney, sumUnits } from "@/domain/money";

const ok = (r: ReturnType<typeof parseMoney>) => (r.ok ? r.value : `error: ${r.error}`);

describe("exact decimal money", () => {
  it("adds cents without floating-point drift", () => {
    expect(add("0.10", "0.20")).toBe("0.30");
    expect(sumMoney(Array.from({ length: 1000 }, () => "0.01"))).toBe("10.00");
    expect(sumMoney(["33333.33", "33333.33", "33333.34"])).toBe("100000.00");
    expect(sub("100000.00", "90000.00")).toBe("10000.00");
  });

  it("keeps values beyond the safe range of a double exact", () => {
    expect(add("9007199254740993.01", "0.01")).toBe("9007199254740993.02");
    expect(cmp("9007199254740993.01", "9007199254740993.02")).toBe(-1);
  });

  it("parses the formats sponsors export", () => {
    expect(ok(parseMoney("100000"))).toBe("100000.00");
    expect(ok(parseMoney(" $100,000.5 "))).toBe("100000.50");
    expect(ok(parseMoney("(40,000.00)", "Amount", true))).toBe("-40000.00");
    expect(ok(parseMoney("-40000", "Amount", true))).toBe("-40000.00");
  });

  it("rejects anything it would have to round or guess", () => {
    for (const bad of ["", "abc", "100.005", "1e5", "1,00.00", "100.00.00", "NaN", "Infinity", "12 34", "=100"]) {
      expect(parseMoney(bad).ok, bad).toBe(false);
    }
    expect(parseMoney("-5").ok).toBe(false);
  });

  it("parses units separately from money, to eight decimal places", () => {
    expect(ok(parseUnits("90"))).toBe("90");
    expect(ok(parseUnits("1320.40"))).toBe("1320.4");
    expect(ok(parseUnits("0.12345678"))).toBe("0.12345678");
    expect(parseUnits("0.123456789").ok).toBe(false);
    expect(parseUnits("-1").ok).toBe(false);
    expect(sumUnits(["0.1", "0.2", "1320.4"])).toBe("1320.7");
  });

  it("formats for display without changing the value", () => {
    expect(formatMoney("5000000.00", "USD")).toBe("$5,000,000.00");
    expect(formatMoney("-10000.00", "USD")).toBe("−$10,000.00");
    expect(formatSignedMoney("10000.00", "USD")).toBe("+$10,000.00");
    expect(formatMoney("100000.00", "CAD")).toContain("100,000.00");
    expect(formatUnits("3349.5")).toBe("3,349.5");
  });
});
