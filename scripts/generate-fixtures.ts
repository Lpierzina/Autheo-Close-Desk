/**
 * Generates the synthetic demo fixtures for the fictional Riverbend Flats offering.
 *
 * Everything here is invented. Investor references are opaque codes; there are no names,
 * tax IDs, bank details or real transactions.
 *
 * The known-good register (fixtures/demo/expected/ownership-register.csv) is written
 * straight from the `approved` column of the table below. It does not pass through the
 * reconciliation engine, so the acceptance test compares two independent derivations.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";

const root = path.resolve(__dirname, "..");
const out = path.join(root, "fixtures", "demo");

type ShareClass = "Class A" | "Class B";
const UNIT_PRICE: Record<ShareClass, string> = { "Class A": "1000", "Class B": "1250" };

interface Wire {
  ref: string;
  amount: string;
  date: string;
  status?: string;
  currency?: string;
  /** Leave the subscription ID empty on the funding row and rely on this reference. */
  byReference?: string;
  original?: string;
  repeatRow?: boolean;
}

interface Sub {
  id: string;
  investor: string;
  shareClass: ShareClass;
  requested: string;
  signature?: string;
  paymentReference?: string;
  /** Approved amount in the allocations file. null = no allocation row. */
  allocation: string | null;
  /** Amount in the known-good register after the close. null = not in the register. */
  approved: string | null;
  wires: Wire[];
}

// Generated references start above the hand-written 203xx references used in the exception cases.
let wireSeq = 20500;
const nextRef = (prefix = "WIRE") => `${prefix}-${++wireSeq}`;
const day = (d: number) => (d <= 31 ? `2026-10-${String(d).padStart(2, "0")}` : `2026-11-${String(d - 31).padStart(2, "0")}`);

/** A subscription that is signed, fully funded by one or more cleared wires, and approved in full. */
function clean(id: number, investor: number, shareClass: ShareClass, amount: string, wires?: [string, number][], extra: Partial<Sub> = {}): Sub {
  const parts = wires ?? [[amount, 20 + (id % 17)]];
  return {
    id: `SUB-${id}`,
    investor: `INV-0${investor}`,
    shareClass,
    requested: amount,
    allocation: amount,
    approved: amount,
    wires: parts.map(([value, d]) => ({ ref: nextRef(), amount: value, date: id % 5 === 0 ? `${day(d)}T15:20:00Z` : day(d) })),
    ...extra,
  };
}

const subs: Sub[] = [
  clean(1001, 401, "Class A", "250000.00", [["150000.00", 21], ["100000.00", 23]]),
  clean(1002, 402, "Class A", "100000.00"),
  { ...clean(1003, 403, "Class A", "50000.00"), wires: [{ ref: nextRef("ACH"), amount: "50000.00", date: day(22), repeatRow: true }] },
  clean(1004, 404, "Class B", "125000.00"),
  clean(1005, 405, "Class A", "75000.00"),
  clean(1006, 406, "Class A", "200000.00"),
  // Matched through the explicit payment reference: the funding row carries no subscription ID.
  {
    ...clean(1007, 407, "Class A", "100000.00"),
    paymentReference: "RVB-1007",
    wires: [{ ref: nextRef(), amount: "100000.00", date: day(24), byReference: "RVB-1007" }],
  },
  clean(1008, 408, "Class B", "50000.00"),
  clean(1009, 409, "Class A", "150000.00"),
  clean(1010, 410, "Class A", "25000.00"),
  clean(1011, 411, "Class B", "300000.00", [["100000.00", 26], ["100000.00", 28], ["100000.00", 30]]),
  // Guided case: signs for 100,000, sends two cleared wires totalling 100,000, approved for 90,000.
  {
    id: "SUB-1012",
    investor: "INV-0412",
    shareClass: "Class A",
    requested: "100000.00",
    allocation: "90000.00",
    approved: "90000.00",
    wires: [
      { ref: nextRef(), amount: "60000.00", date: day(27) },
      { ref: nextRef(), amount: "40000.00", date: day(29) },
    ],
  },
  clean(1013, 413, "Class A", "100000.00"),
  clean(1014, 414, "Class B", "62500.00"),
  clean(1015, 415, "Class A", "250000.00", [["100000.00", 27], ["100000.00", 29], ["50000.00", 33]]),
  clean(1016, 416, "Class A", "175000.00"),
  clean(1017, 417, "Class A", "50000.00"),
  clean(1018, 418, "Class B", "33000.00"),
  // Allocation approved on a subscription that is not signed yet.
  { ...clean(1019, 419, "Class A", "50000.00"), signature: "pending" },
  clean(1020, 420, "Class A", "100000.00"),
  // Scaled back and funded for exactly the approved amount: no exception.
  { ...clean(1021, 421, "Class A", "150000.00"), requested: "200000.00" },
  clean(1022, 422, "Class B", "250000.00", [["125000.00", 28], ["125000.00", 34]]),
  // Partially funded: the second wire is still pending.
  {
    id: "SUB-1023",
    investor: "INV-0423",
    shareClass: "Class B",
    requested: "150000.00",
    allocation: "150000.00",
    approved: "150000.00",
    wires: [
      { ref: nextRef(), amount: "100000.00", date: day(30) },
      { ref: "WIRE-PENDING-1023", amount: "50000.00", date: "", status: "pending" },
    ],
  },
  clean(1024, 424, "Class A", "80000.00"),
  clean(1025, 425, "Class A", "40000.00"),
  clean(1026, 426, "Class A", "125000.00"),
  // First wire was returned by the bank and re-sent: nets to the full amount, no exception.
  {
    id: "SUB-1027",
    investor: "INV-0427",
    shareClass: "Class A",
    requested: "75000.00",
    allocation: "75000.00",
    approved: "75000.00",
    wires: [
      { ref: "WIRE-20327A", amount: "75000.00", date: day(26) },
      { ref: "RTN-20327A", amount: "-75000.00", date: day(27), original: "WIRE-20327A" },
      { ref: "WIRE-20327B", amount: "75000.00", date: day(31) },
    ],
  },
  clean(1028, 428, "Class B", "100000.00"),
  clean(1029, 429, "Class A", "60000.00"),
  clean(1030, 430, "Class A", "150000.00"),
  // Third wire sent in error and returned, but the reversal names an original that does not exist.
  {
    id: "SUB-1031",
    investor: "INV-0431",
    shareClass: "Class B",
    requested: "80000.00",
    allocation: "80000.00",
    approved: "80000.00",
    wires: [
      { ref: "WIRE-20317", amount: "40000.00", date: day(28) },
      { ref: "WIRE-20318", amount: "40000.00", date: day(30) },
      { ref: "WIRE-20319", amount: "40000.00", date: day(32) },
      { ref: "RTN-20319", amount: "-40000.00", date: day(34), original: "WIRE-20391" },
    ],
  },
  clean(1032, 432, "Class A", "45000.00"),
  clean(1033, 433, "Class B", "200000.00"),
  // The same payment exported twice under two references.
  {
    id: "SUB-1034",
    investor: "INV-0434",
    shareClass: "Class A",
    requested: "60000.00",
    allocation: "60000.00",
    approved: "60000.00",
    wires: [
      { ref: "WIRE-20334", amount: "60000.00", date: day(33) },
      { ref: "PORTAL-88120", amount: "60000.00", date: day(33) },
    ],
  },
  clean(1035, 435, "Class A", "100000.00"),
  // The cleared wire has no settlement date in the first export, so the row is invalid.
  {
    id: "SUB-1036",
    investor: "INV-0436",
    shareClass: "Class A",
    requested: "40000.00",
    allocation: "40000.00",
    approved: "40000.00",
    wires: [{ ref: "WIRE-20336", amount: "40000.00", date: "" }],
  },
  clean(1037, 437, "Class A", "70000.00"),
  // Wire arrived with a free-text memo instead of the subscription ID.
  {
    id: "SUB-1038",
    investor: "INV-0438",
    shareClass: "Class A",
    requested: "120000.00",
    allocation: "120000.00",
    approved: "120000.00",
    wires: [{ ref: "WIRE-20338", amount: "120000.00", date: day(35), byReference: "RIVERBEND DEPOSIT 0438" }],
  },
  clean(1039, 439, "Class A", "35000.00"),
  clean(1040, 440, "Class B", "150000.00"),
  // One investor, two subscriptions, one shared payment reference: the reference alone is ambiguous.
  {
    id: "SUB-1041",
    investor: "INV-0441",
    shareClass: "Class A",
    requested: "100000.00",
    paymentReference: "RVB-0441",
    allocation: "100000.00",
    approved: "100000.00",
    wires: [{ ref: "WIRE-20341", amount: "100000.00", date: day(34), byReference: "RVB-0441" }],
  },
  {
    id: "SUB-1042",
    investor: "INV-0441",
    shareClass: "Class B",
    requested: "50000.00",
    paymentReference: "RVB-0441",
    allocation: "50000.00",
    approved: "50000.00",
    wires: [{ ref: "WIRE-20342", amount: "50000.00", date: day(34) }],
  },
  clean(1043, 443, "Class A", "90000.00"),
  // Signed and funded, but the sponsor did not approve an allocation.
  { ...clean(1044, 444, "Class A", "50000.00"), allocation: null, approved: null },
  // Second subscription by the investor behind SUB-1005, same class.
  clean(1045, 405, "Class A", "55000.00"),
  // Bank export shows the wire in the wrong currency.
  {
    id: "SUB-1046",
    investor: "INV-0446",
    shareClass: "Class B",
    requested: "100000.00",
    allocation: "100000.00",
    approved: "100000.00",
    wires: [{ ref: "WIRE-20346", amount: "100000.00", date: day(36), currency: "CAD" }],
  },
  clean(1047, 447, "Class A", "110000.00"),
  // Never signed, never funded, no allocation.
  { id: "SUB-1048", investor: "INV-0448", shareClass: "Class A", requested: "25000.00", signature: "pending", allocation: null, approved: null, wires: [] },
  clean(1049, 449, "Class A", "79500.00"),
  // Declined by the sponsor: a zero allocation and no funding.
  { id: "SUB-1050", investor: "INV-0450", shareClass: "Class A", requested: "30000.00", allocation: "0.00", approved: null, wires: [] },
];

const units = (amount: string, shareClass: ShareClass) => new Decimal(amount).div(UNIT_PRICE[shareClass]).toFixed();

function csv(header: string[], rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

const subscriptionsCsv = csv(
  ["subscription_id", "investor_ref", "share_class", "requested_amount", "currency", "signature_status", "payment_reference"],
  subs.map((s) => [s.id, s.investor, s.shareClass, s.requested, "USD", s.signature ?? "signed", s.paymentReference ?? ""]),
);

const fundingHeader = [
  "transaction_ref",
  "subscription_id",
  "payment_reference",
  "amount",
  "currency",
  "settlement_status",
  "settled_at",
  "original_transaction_ref",
];
const fundingRows: string[][] = [];
for (const s of subs) {
  for (const w of s.wires) {
    const row = [
      w.ref,
      w.byReference ? "" : s.id,
      w.byReference ?? "",
      w.amount,
      w.currency ?? "USD",
      w.status ?? "cleared",
      w.date,
      w.original ?? "",
    ];
    fundingRows.push(row);
    if (w.repeatRow) fundingRows.push(row);
  }
}
const fundingCsv = csv(fundingHeader, fundingRows);

const refs = subs.flatMap((s) => s.wires.map((w) => w.ref));
const repeated = refs.filter((ref, index) => refs.indexOf(ref) !== index);
if (repeated.length > 0) throw new Error(`Transaction references are not unique: ${repeated.join(", ")}`);

const allocationsCsv = csv(
  ["subscription_id", "share_class", "approved_amount", "approved_units", "currency"],
  subs
    .filter((s) => s.allocation !== null)
    .map((s) => [s.id, s.shareClass, s.allocation ?? "", units(s.allocation ?? "0", s.shareClass), "USD"]),
);

// Corrected source data that clears the hard blockers in the demo.
const subscriptionsCorrectionsCsv = csv(
  ["subscription_id", "investor_ref", "share_class", "requested_amount", "currency", "signature_status", "payment_reference"],
  [["SUB-1019", "INV-0419", "Class A", "50000.00", "USD", "signed", ""]],
);

// Deliberately uses a bank portal's own column names, to exercise column mapping.
const fundingCorrectionsCsv = csv(
  ["Bank Ref", "Subscription No", "Wire Memo", "Credit Amount", "CCY", "Payment Status", "Value Date", "Reverses"],
  [
    ["WIRE-PENDING-1023", "SUB-1023", "", "50,000.00", "USD", "Settled", "11/06/2026", ""],
    ["RTN-20319", "SUB-1031", "", "-40,000.00", "USD", "Settled", day(34), "WIRE-20319"],
    ["WIRE-20336", "SUB-1036", "", "40,000.00", "USD", "Settled", "11/04/2026", ""],
    ["WIRE-20346", "SUB-1046", "", "100,000.00", "USD", "Settled", day(36), ""],
  ],
);

const registerLines = subs
  .filter((s) => s.approved !== null)
  .map((s) => ({
    investor: s.investor,
    shareClass: s.shareClass,
    id: s.id,
    amount: new Decimal(s.approved ?? "0").toFixed(2),
    units: units(s.approved ?? "0", s.shareClass),
  }))
  .sort((a, b) => a.investor.localeCompare(b.investor) || a.shareClass.localeCompare(b.shareClass) || a.id.localeCompare(b.id));

const registerCsv = csv(
  ["investor_ref", "share_class", "subscription_id", "approved_amount", "approved_units", "currency"],
  registerLines.map((l) => [l.investor, l.shareClass, l.id, l.amount, l.units, "USD"]),
);

const total = registerLines.reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
if (!total.equals("5000000")) throw new Error(`Register total is ${total.toFixed(2)}, expected 5000000.00`);

const classTotals = (shareClass: ShareClass) => {
  const lines = registerLines.filter((l) => l.shareClass === shareClass);
  return {
    lines: lines.length,
    approvedAmount: lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)).toFixed(2),
    approvedUnits: lines.reduce((s, l) => s.plus(l.units), new Decimal(0)).toFixed(),
  };
};

const expectedSummary = {
  offering: "Riverbend Flats Apartments",
  currency: "USD",
  registerLines: registerLines.length,
  approvedAmount: total.toFixed(2),
  byShareClass: { "Class A": classTotals("Class A"), "Class B": classTotals("Class B") },
};

const files: Record<string, string> = {
  "subscriptions.csv": subscriptionsCsv,
  "funding.csv": fundingCsv,
  "allocations.csv": allocationsCsv,
  "corrections/subscriptions-corrections.csv": subscriptionsCorrectionsCsv,
  "corrections/funding-corrections.csv": fundingCorrectionsCsv,
  "expected/ownership-register.csv": registerCsv,
  "expected/summary.json": JSON.stringify(expectedSummary, null, 2) + "\n",
};

for (const [name, content] of Object.entries(files)) {
  const target = path.join(out, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// The app bundles the example files from this module, so the sample session and the sample downloads need no request.
const served = ["subscriptions.csv", "funding.csv", "allocations.csv", "corrections/subscriptions-corrections.csv", "corrections/funding-corrections.csv"];
const moduleSource =
  `// Generated by scripts/generate-fixtures.ts. Do not edit by hand.\n// Synthetic data for the fictional Riverbend Flats offering.\n\n` +
  `export const SAMPLE_FILES: Record<string, string> = ${JSON.stringify(
    Object.fromEntries(served.map((name) => [name.split("/").pop() ?? name, files[name]])),
    null,
    2,
  )};\n`;
writeFileSync(path.join(root, "src", "session", "sample-files.generated.ts"), moduleSource);

console.log(`Wrote ${Object.keys(files).length} fixture files to fixtures/demo`);
console.log(`Subscriptions: ${subs.length} · funding rows: ${fundingRows.length} · register lines: ${registerLines.length} · total ${total.toFixed(2)}`);
