import { parse } from "csv-parse/sync";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_COLUMNS = 60;
export const MAX_CELL_LENGTH = 500;

export interface ParsedCsv {
  headers: string[];
  rows: ParsedRow[];
}

export interface ParsedRow {
  /** Line number in the selected file (the header is line 1). */
  rowNumber: number;
  cells: Record<string, string>;
  /** Number of cells on the line. A mismatch with the header usually means an unquoted comma. */
  columnCount: number;
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new CsvFormatError("The file is empty.");
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new CsvFormatError(
      `The file is larger than the ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB limit.`,
    );
  }
  if (bytes.includes(0)) {
    throw new CsvFormatError("The file is not a text CSV. Export the sheet as CSV (UTF-8) and try again.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CsvFormatError("The file is not valid UTF-8 text. Export the sheet as CSV (UTF-8) and try again.");
  }
}

export function parseCsv(text: string): ParsedCsv {
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      info: true,
      max_record_size: 200_000,
    }) as unknown as { record: string[]; info: { lines: number } }[];
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable content";
    throw new CsvFormatError(`The file could not be read as CSV: ${detail}`);
  }

  const first = records[0];
  if (!first) throw new CsvFormatError("The file has no header row.");

  const headers = first.record.map((h) => h.trim());
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw new CsvFormatError(`The file has more than ${MAX_IMPORT_COLUMNS} columns.`);
  }
  if (headers.some((h) => h === "")) {
    throw new CsvFormatError("The header row contains an empty column name.");
  }
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) throw new CsvFormatError(`The header "${header}" appears more than once.`);
    seen.add(key);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) throw new CsvFormatError("The file has a header row but no data rows.");
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    throw new CsvFormatError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} data rows.`);
  }

  const rows: ParsedRow[] = dataRecords.map(({ record, info }) => {
    const cells: Record<string, string> = {};
    headers.forEach((header, index) => {
      cells[header] = (record[index] ?? "").slice(0, MAX_CELL_LENGTH * 4);
    });
    return { rowNumber: info.lines, cells, columnCount: record.length };
  });

  return { headers, rows };
}

const FORMULA_TRIGGER = /^[\s]*[=+\-@\t\r]/;

/**
 * Neutralises spreadsheet formula injection: a text cell that a spreadsheet would
 * evaluate is prefixed with an apostrophe so it is shown as literal text.
 */
export function sanitizeSpreadsheetText(value: string): string {
  if (value === "") return value;
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvColumn<Row> {
  header: string;
  /** "text" cells are sanitised against formula injection; "number" cells are app-generated decimals. */
  type: "text" | "number";
  value: (row: Row) => string | null | undefined;
}

export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [columns.map((c) => quote(c.header)).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const raw = column.value(row) ?? "";
          return quote(column.type === "text" ? sanitizeSpreadsheetText(raw) : raw);
        })
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
