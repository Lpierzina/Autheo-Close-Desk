import { describe, expect, it } from "vitest";
import { CsvFormatError, decodeCsvBytes, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, sanitizeSpreadsheetText, toCsv } from "@/domain/csv";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("CSV input", () => {
  it("parses quoted cells, a byte-order mark and blank lines", () => {
    const parsed = parseCsv('\uFEFFid,note\n1,"a, b"\n\n2,"line\nbreak"\n');
    expect(parsed.headers).toEqual(["id", "note"]);
    expect(parsed.rows.map((r) => r.cells)).toEqual([
      { id: "1", note: "a, b" },
      { id: "2", note: "line\nbreak" },
    ]);
    expect(parsed.rows[0]?.rowNumber).toBe(2);
  });

  it("rejects files it cannot read safely", () => {
    expect(() => decodeCsvBytes(new Uint8Array())).toThrow(CsvFormatError);
    expect(() => decodeCsvBytes(new Uint8Array(MAX_IMPORT_BYTES + 1))).toThrow(CsvFormatError);
    expect(() => decodeCsvBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toThrow(CsvFormatError);
    expect(() => decodeCsvBytes(new Uint8Array([0x61, 0xff, 0xfe, 0x62]))).toThrow(CsvFormatError);
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/more than once|duplicate/i);
    expect(() => parseCsv("a,,c\n1,2,3\n")).toThrow(CsvFormatError);
    expect(() => parseCsv("only,a,header\n")).toThrow(CsvFormatError);
    expect(() => parseCsv(`id\n${"1\n".repeat(MAX_IMPORT_ROWS + 1)}`)).toThrow(CsvFormatError);
    expect(decodeCsvBytes(bytes("id\n1\n"))).toBe("id\n1\n");
  });
});

describe("CSV output", () => {
  it("neutralises spreadsheet formulas in text cells", () => {
    expect(sanitizeSpreadsheetText("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeSpreadsheetText("+1+1")).toBe("'+1+1");
    expect(sanitizeSpreadsheetText("-2+3")).toBe("'-2+3");
    expect(sanitizeSpreadsheetText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeSpreadsheetText("\t=1")).toBe("'\t=1");
    expect(sanitizeSpreadsheetText("  =cmd|' /C calc'!A0")).toBe("'  =cmd|' /C calc'!A0");
    expect(sanitizeSpreadsheetText("INV-0412")).toBe("INV-0412");
    expect(sanitizeSpreadsheetText("Class A")).toBe("Class A");
  });

  it("sanitises text columns but leaves numeric columns as numbers", () => {
    const csv = toCsv<{ ref: string; amount: string }>(
      [
        { header: "investor_ref", type: "text", value: (r) => r.ref },
        { header: "approved_amount", type: "number", value: (r) => r.amount },
      ],
      [
        { ref: '=1+1,"x"', amount: "90000.00" },
        { ref: "INV-1", amount: "-5.00" },
      ],
    );
    expect(csv).toBe('investor_ref,approved_amount\r\n"\'=1+1,""x""",90000.00\r\nINV-1,-5.00\r\n');
  });
});
