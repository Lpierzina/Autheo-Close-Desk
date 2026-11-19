import { expect, test, type Page } from "@playwright/test";
import { HEADER, addSelected, confirmSnapshot, count, csv, documentException, download, goToStep, linkPayment, openRow, selectCsv, unix } from "./support";

const REGISTER_HEADER = "investor_ref,share_class,subscription_id,approved_amount,approved_units,currency";

const SUBSCRIPTIONS = csv(HEADER.subscriptions, [
  "S-100,INV-A,Class A,100000.00,USD,signed,",
  "S-200,INV-B,Class A,50000.00,USD,signed,",
  "S-300,INV-C,Class B,75000.00,USD,signed,REF-300",
  "S-400,INV-D,Class A,40000.00,USD,signed,",
]);

const FUNDING = csv(HEADER.funding, [
  // S-100: two wires for one subscription.
  "W-101,S-100,,60000.00,USD,cleared,2026-10-27,",
  "W-102,S-100,,40000.00,USD,cleared,2026-10-29,",
  // S-200: a wire, a second wire sent in error, and its reversal.
  "W-201,S-200,,50000.00,USD,cleared,2026-10-27,",
  "W-202,S-200,,50000.00,USD,cleared,2026-10-28,",
  "R-202,S-200,,50000.00,USD,cleared,2026-10-30,W-202",
  // S-300: matched through the payment reference the subscriptions file ties to it.
  "W-301,,REF-300,75000.00,USD,cleared,2026-10-27,",
  // S-400: the money has not cleared.
  "W-401,S-400,,40000.00,USD,pending,,",
  // The same amount and investor as S-400, but no reference: never matched on amount.
  "W-999,,INV-D 40000,40000.00,USD,cleared,2026-10-27,",
]);

const ALLOCATIONS = csv(HEADER.allocations, [
  "S-100,Class A,90000.00,90,USD",
  "S-200,Class A,50000.00,50,USD",
  "S-300,Class B,75000.00,60.5,USD",
  "S-400,Class A,40000.00,40,USD",
]);

async function addDeal(page: Page) {
  await page.goto("/reconcile/");
  await page.getByLabel("Deal name").fill("Scenario Deal");
  await selectCsv(page, "subscriptions", "subscriptions.csv", SUBSCRIPTIONS);
  await selectCsv(page, "funding", "funding.csv", FUNDING);
  await selectCsv(page, "allocations", "allocations.csv", ALLOCATIONS);
  await addSelected(page);
}

const row = (page: Page, label: string) => page.getByRole("row").filter({ has: page.getByRole("button", { name: `Open ${label}`, exact: true }) });

test.describe("matching rules, on the screens", () => {
  test("split wires add up, a reversal nets out, pending money is not counted, and nothing is matched on amount", async ({ page }) => {
    await addDeal(page);

    await expect(page.getByTestId("total-signed")).toContainText("$265,000.00");
    await expect(page.getByTestId("total-cleared")).toContainText("$225,000.00");
    await expect(page.getByTestId("total-cleared")).toContainText("$40,000.00 pending, not counted");
    await expect(page.getByTestId("total-cleared")).toContainText("$40,000.00 cleared but not matched to a subscription");
    await expect(page.getByTestId("total-approved")).toContainText("$255,000.00");

    await expect(row(page, "S-100, Class A")).toContainText("Needs review");
    await expect(row(page, "S-100, Class A")).toContainText("+$10,000.00");
    await expect(row(page, "S-200, Class A")).toContainText("Ready");
    await expect(row(page, "S-300, Class B")).toContainText("Ready");
    await expect(row(page, "S-400, Class A")).toContainText("Blocked");
    await expect(row(page, "payment W-999")).toContainText("Payment without a subscription");

    await page.getByRole("button", { name: "Open S-200, Class A", exact: true }).click();
    const review = page.getByTestId("row-review");
    await expect(review).toContainText("Yes. $50,000.00 cleared: 2 payments totalling $100,000.00, less 1 reversal of $50,000.00.");
    await expect(review).toContainText("Reversal of W-202");
    await expect(review).toContainText("Reversal applied");

    await openRow(page, "S-400::CLASS A");
    await expect(review).toContainText("No cleared funds. $40,000.00 is pending and not counted.");
    await expect(review).toContainText("Needs corrected source data. A note cannot clear this.");
    await expect(review.getByLabel("Review note")).toHaveCount(0);

    await goToStep(page, "review");
    await page.getByRole("button", { name: "Open S-300, Class B", exact: true }).click();
    await expect(review).toContainText("Matched on the payment reference in the subscriptions file");

    await openRow(page, "FUNDING::W-999");
    await expect(page.getByTestId("difference")).toContainText("Close Desk never matches a payment by name or by amount.");
  });

  test("selecting the same funding file again does not count a wire twice", async ({ page }) => {
    await addDeal(page);
    await expect(page.getByTestId("total-cleared")).toContainText("$225,000.00");

    await goToStep(page, "select");
    await selectCsv(page, "funding", "funding-again.csv", FUNDING);
    await expect(count(page, "funding", "Rows in file")).toHaveText("8");
    await expect(count(page, "funding", "New")).toHaveText("0");
    await expect(count(page, "funding", "Already in workspace")).toHaveText("8");
    await expect(count(page, "funding", "Change a record")).toHaveText("0");
    await addSelected(page);

    await expect(page.getByTestId("total-cleared")).toContainText("$225,000.00");
    await expect(page.getByRole("table", { name: "Matches by subscription and share class" }).locator("tbody tr")).toHaveCount(5);
  });

  test("a later file that changes a wire goes to review instead of overwriting it", async ({ page }) => {
    await addDeal(page);
    await goToStep(page, "select");
    await selectCsv(page, "funding", "funding-revised.csv", csv(HEADER.funding, ["W-101,S-100,,65000.00,USD,cleared,2026-10-27,"]));
    await expect(count(page, "funding", "Change a record")).toHaveText("1");
    await expect(page.getByTestId("preview-funding")).toContainText("Nothing is overwritten.");
    await addSelected(page);

    // Until the reviewer chooses, the original $60,000 stands and the row cannot be exported.
    await expect(page.getByTestId("total-cleared")).toContainText("$225,000.00");
    await expect(row(page, "S-100, Class A")).toContainText("$100,000.00");
    await expect(row(page, "S-100, Class A")).toContainText("Needs review");
    await goToStep(page, "export");
    await expect(page.getByTestId("export-blocked")).toContainText("3 exceptions still need a review decision.");

    await openRow(page, "S-100::CLASS A");
    const review = page.getByTestId("row-review");
    await expect(review).toContainText("In the workspace now");
    await expect(review).toContainText("60000.00");
    await expect(review).toContainText("65000.00");
    await review.getByLabel("Keep the record in the workspace").check();
    await review.locator("form").filter({ has: page.getByLabel("Keep the record in the workspace") }).getByLabel("Review note").fill("The bank statement shows 60,000.00 for this wire.");
    await review.locator("form").filter({ has: page.getByLabel("Keep the record in the workspace") }).getByRole("button", { name: "Record decision" }).click();
    await goToStep(page, "review");
    await expect(page.getByTestId("total-cleared")).toContainText("$225,000.00");
  });

  test("blockers stop the reviewed register but not the exceptions report, and a note cannot clear them", async ({ page }) => {
    await addDeal(page);
    await openRow(page, "S-100::CLASS A");
    await documentException(page, "EXCESS_FUNDING");

    await goToStep(page, "export");
    const blocked = page.getByTestId("export-blocked");
    await expect(blocked).toContainText("The reviewed register cannot be confirmed yet");
    await expect(blocked).toContainText("1 blocker needs corrected source data.");
    await expect(blocked).toContainText("1 exception still needs a review decision.");
    await expect(page.getByTestId("download-register")).toBeDisabled();
    await expect(page.getByTestId("confirm-snapshot")).toHaveCount(0);

    const report = await download(page, "download-exceptions");
    expect(report.filename).toBe("scenario-deal-exceptions-report-DRAFT.csv");
    const lines = unix(report.text).trim().split("\n");
    expect(lines[0]).toContain("exception_code");
    expect(lines.filter((line) => line.includes("S-400")).join("\n")).toContain("open");
    expect(lines.filter((line) => line.includes("S-100")).join("\n")).toContain("documented");

    // Exclude the unreferenced payment; the pending wire still blocks.
    await openRow(page, "FUNDING::W-999");
    const review = page.getByTestId("row-review");
    await review.getByLabel("Exclude from this deal's funding").check();
    await review.getByLabel("Review note").fill("Not for this deal: the sender confirmed it was meant for another raise.");
    await review.getByRole("button", { name: "Record decision" }).click();
    await goToStep(page, "export");
    await expect(blocked).toContainText("1 blocker needs corrected source data.");
    await expect(blocked).not.toContainText("review decision");

    // Corrected source data clears it: the bank's later file shows the wire cleared.
    await goToStep(page, "select");
    await selectCsv(page, "funding", "funding-cleared.csv", csv(HEADER.funding, ["W-401,S-400,,40000.00,USD,cleared,2026-11-02,"]));
    await addSelected(page);
    await openRow(page, "S-400::CLASS A");
    await review.getByLabel("Use the version from the later file").check();
    await review.getByLabel("Review note").fill("The escrow statement of 2 November shows this wire cleared.");
    await review.getByRole("button", { name: "Record decision" }).click();

    await confirmSnapshot(page);
    const register = await download(page, "download-register");
    expect(unix(register.text)).toBe(
      `${[REGISTER_HEADER, "INV-A,Class A,S-100,90000.00,90,USD", "INV-B,Class A,S-200,50000.00,50,USD", "INV-C,Class B,S-300,75000.00,60.5,USD", "INV-D,Class A,S-400,40000.00,40,USD"].join("\n")}\n`,
    );
  });

  test("a payment is linked only to a subscription the reviewer names, and the approved units never change", async ({ page }) => {
    await addDeal(page);
    await linkPayment(page, "W-999", "S-400");

    // The link funds S-400, but the pending wire is still listed and the allocation is untouched.
    const review = page.getByTestId("row-review");
    await expect(review).toContainText("Linked in review");
    await expect(review).toContainText("40 units for $40,000.00.");
    await goToStep(page, "review");
    await expect(page.getByTestId("total-cleared")).toContainText("$265,000.00");
    await expect(page.getByTestId("total-approved")).toContainText("$255,000.00");
    await expect(row(page, "S-400, Class A")).toContainText("Ready");
  });

  test("values that a spreadsheet would run as a formula are neutralised in the downloads", async ({ page }) => {
    await page.goto("/reconcile/");
    await selectCsv(page, "subscriptions", "s.csv", csv(HEADER.subscriptions, ['S-1,"=HYPERLINK(""x"",""y"")",Class A,1000.00,USD,signed,', "S-2,@SUM(A1),Class A,1000.00,USD,signed,"]));
    await selectCsv(page, "funding", "f.csv", csv(HEADER.funding, ["W-1,S-1,,1000.00,USD,cleared,2026-10-27,", "W-2,S-2,,1000.00,USD,cleared,2026-10-27,"]));
    await selectCsv(page, "allocations", "a.csv", csv(HEADER.allocations, ["S-1,Class A,1000.00,1,USD", "S-2,Class A,1000.00,1,USD"]));
    await addSelected(page);
    await confirmSnapshot(page);
    const register = await download(page, "download-register");
    const cells = unix(register.text)
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.replace(/^"/, ""));
    expect(cells).toHaveLength(2);
    for (const line of cells) expect(line).toMatch(/^'[=@]/);
  });
});

test.describe("files that cannot be used", () => {
  test("a file that is not CSV, an empty file and a file with the wrong columns are explained, and nothing is added", async ({ page }) => {
    await page.goto("/reconcile/");
    const slot = page.getByTestId("slot-subscriptions");

    await page.getByTestId("file-input-subscriptions").setInputFiles({ name: "subscriptions.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
    await expect(slot.getByRole("alert")).toContainText("Select a .csv file.");

    await page.getByTestId("file-input-subscriptions").setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.alloc(0) });
    await expect(slot.getByRole("alert")).toContainText("That file is empty.");
    await expect(page.getByTestId("preview-subscriptions")).toHaveCount(0);

    await selectCsv(page, "subscriptions", "wrong.csv", "name,amount\nAcme,100\n");
    await expect(page.getByTestId("preview-subscriptions")).toContainText('Choose the column that holds "Subscription ID".');
    await expect(page.getByTestId("preview-subscriptions")).toContainText("Before this file can be added: Finish the column mapping.");
    await expect(page.getByTestId("add-files")).toBeDisabled();

    await selectCsv(page, "subscriptions", "bad-rows.csv", csv(HEADER.subscriptions, ["S-1,INV-1,Class A,12.345,USD,signed,", "S-2,INV-2,Class A,100.00,USD,maybe,"]));
    await expect(count(page, "subscriptions", "Invalid")).toHaveText("2");
    await expect(page.getByTestId("preview-subscriptions")).toContainText("Before this file can be added: There are no valid rows in this file.");
    await expect(page.getByTestId("add-files")).toBeDisabled();
  });
});
