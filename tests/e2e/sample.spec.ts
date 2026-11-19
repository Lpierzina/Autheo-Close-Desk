import { expect, test } from "@playwright/test";
import {
  NOTE,
  addSelected,
  closeSampleDeal,
  confirmSnapshot,
  count,
  documentException,
  download,
  fixture,
  goToStep,
  openRow,
  selectCsv,
  unix,
} from "./support";

const KNOWN_GOOD = unix(fixture("expected/ownership-register.csv"));
const SUB_1012 = "SUB-1012::CLASS A";

test.describe("the synthetic Riverbend Flats deal, from the home page to the exports", () => {
  test("explains the $10,000 variance, requires review, and exports only the sponsor-approved allocation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try with sample data" }).first().click();
    await expect(page).toHaveURL(/\/reconcile\/$/);

    // Select files: three labelled slots, each with a preview, row counts and validation errors before anything is added.
    await expect(page.getByRole("heading", { name: "Select CSV files" })).toBeVisible();
    await expect(page.getByTestId("slot-subscriptions")).toContainText("Did they sign?");
    await expect(page.getByTestId("slot-funding")).toContainText("Did their money clear?");
    await expect(page.getByTestId("slot-allocations")).toContainText("How many LLC units did the sponsor approve?");
    await expect(page.getByTestId("preview-subscriptions")).toContainText("50 rows");
    await expect(page.getByTestId("preview-funding")).toContainText("63 rows");
    await expect(page.getByTestId("preview-allocations")).toContainText("48 rows");
    await expect(page.getByTestId("preview-funding")).toContainText("Row 52: Settled at is required for cleared transactions");
    await expect(page.getByTestId("preview-funding")).toContainText("1 row in this file repeats an earlier row exactly and is counted once.");
    await expect(page.getByTestId("add-files")).toBeDisabled();
    await goToStep(page, "review");
    await expect(page.getByText("Nothing to review yet")).toBeVisible();
    await goToStep(page, "select");

    await page.getByTestId("preview-funding").getByRole("checkbox").check();
    await addSelected(page);

    // Review matches: three separate totals, a searchable table, Needs review one click away.
    await expect(page.getByTestId("total-signed")).toContainText("$5,090,000.00");
    await expect(page.getByTestId("total-cleared")).toContainText("$4,750,000.00");
    await expect(page.getByTestId("total-approved")).toContainText("$5,000,000.00");
    const rows = page.getByRole("table", { name: "Matches by subscription and share class" }).locator("tbody tr");
    await expect(rows).toHaveCount(52);
    await page.getByRole("button", { name: /^Needs review/ }).click();
    await expect(rows).toHaveCount(6);
    await page.getByRole("searchbox").fill("sub-1012");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("+$10,000.00");
    await page.getByRole("button", { name: "Open SUB-1012, Class A" }).click();

    // Resolve exceptions: source records side by side and the difference in plain English.
    const review = page.getByTestId("row-review");
    await expect(review).toContainText("Yes. INV-0412 signed for $100,000.00.");
    await expect(review).toContainText("Yes. $100,000.00 cleared across 2 payments (WIRE-20517 $60,000.00, WIRE-20518 $40,000.00).");
    await expect(review).toContainText("90 units for $90,000.00.");
    await expect(review).toContainText("Matched on subscription ID");
    await expect(page.getByTestId("difference")).toContainText("Cleared funds are $10,000.00 above the approved allocation.");
    await expect(page.getByTestId("difference")).toContainText("never moves money, issues units or starts a refund");
    await expect(review.getByText("Needs review").first()).toBeVisible();

    // A decision needs a real note.
    const excess = page.getByTestId("exception-EXCESS_FUNDING");
    await excess.getByRole("button", { name: "Record review decision" }).click();
    await expect(excess.getByRole("alert")).toContainText("at least 10 characters");
    await documentException(page, "EXCESS_FUNDING", "The $10,000 excess is being returned by the escrow agent.");
    await expect(page.getByTestId("difference")).toContainText("The reviewed register export carries the approved $90,000.00 and 90 units.");

    // Export is blocked while blockers remain; the exceptions report is not.
    await goToStep(page, "export");
    await expect(page.getByTestId("export-blocked")).toContainText("8 blockers need corrected source data.");
    await expect(page.getByTestId("export-blocked")).toContainText("7 exceptions still need a review decision.");
    await expect(page.getByTestId("download-register")).toBeDisabled();

    // The whole draft register can be read on screen before anything is confirmed.
    const draftLine = page.getByRole("row").filter({ hasText: "SUB-1012" });
    await expect(draftLine).toHaveCount(0);
    await page.getByTestId("register-lines-toggle").click();
    await expect(draftLine).toContainText("INV-0412");
    await expect(draftLine).toContainText("$90,000.00");
    await expect(draftLine).not.toContainText("$100,000.00");
    const draft = await download(page, "download-exceptions");
    expect(draft.filename).toBe("riverbend-flats-apartments-exceptions-report-DRAFT.csv");
    expect(draft.text).toContain("SUB-1036");
    expect(draft.text).toContain("The $10,000 excess is being returned by the escrow agent.");

    // Withdraw that decision so the shared path below records it again from a clean state.
    await openRow(page, SUB_1012);
    await page.getByRole("button", { name: "Withdraw this decision" }).click();
    const withdraw = page.locator("form").filter({ has: page.getByRole("button", { name: "Withdraw decision" }) });
    await withdraw.getByLabel("Review note").fill("Recording this again with the escrow reference.");
    await withdraw.getByRole("button", { name: "Withdraw decision" }).click();
    await expect(excess.getByText("Needs review")).toBeVisible();
    await goToStep(page, "select");
    // Select the funding file a second time as well: rows already in the workspace must not be counted twice.
    await selectCsv(page, "funding", "funding.csv", fixture("funding.csv"));
    await expect(count(page, "funding", "New")).toHaveText("0");
    await expect(count(page, "funding", "Already in workspace")).toHaveText("62");

    await closeSampleDeal(page, async () => {
      await page.getByTestId("sample-guide").getByRole("button", { name: "Select sample correction files" }).click();
      await expect(page.getByTestId("preview-subscriptions")).toContainText("subscriptions-corrections.csv");
      await expect(page.getByTestId("preview-funding")).toContainText('Choose the column that holds "Amount".');
      await expect(page.getByTestId("add-files")).toBeDisabled();
    });

    // The confirmed register is the known-good register, and SUB-1012 carries the approved figures, not the funded ones.
    await expect(page.getByTestId("confirmed")).toContainText("47 lines · $5,000,000.00");
    const register = await download(page, "download-register");
    expect(register.filename).toBe("riverbend-flats-apartments-reviewed-ownership-register.csv");
    expect(unix(register.text)).toBe(KNOWN_GOOD);
    const line = unix(register.text)
      .split("\n")
      .filter((text) => text.includes("SUB-1012"));
    expect(line).toEqual(["INV-0412,Class A,SUB-1012,90000.00,90,USD"]);

    const exceptions = await download(page, "download-exceptions");
    expect(exceptions.filename).toBe("riverbend-flats-apartments-exceptions-report.csv");
    const excessLine = unix(exceptions.text)
      .split("\n")
      .find((text) => text.includes("SUB-1012") && text.includes("EXCESS_FUNDING"));
    expect(excessLine).toContain("documented");
    expect(excessLine).toContain("10000.00");
    expect(excessLine).toContain(NOTE);
    await expect(page.getByTestId("sample-guide")).toContainText("5 of 5 steps done");
  });

  test("any change after confirmation cancels it, and the register cannot be downloaded until it is confirmed again", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try with sample data" }).first().click();
    await closeSampleDeal(page, async () => {
      await page.getByTestId("sample-guide").getByRole("button", { name: "Select sample correction files" }).click();
    });
    const first = await download(page, "download-register");
    expect(unix(first.text)).toBe(KNOWN_GOOD);

    const cancelled = page.getByText("The earlier confirmation no longer applies");
    const expectCancelled = async (reason: string) => {
      await goToStep(page, "export");
      await expect(cancelled).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "The earlier confirmation no longer applies" })).toContainText(reason);
      await expect(page.getByTestId("confirmed")).toHaveCount(0);
      await expect(page.getByTestId("download-register")).toBeDisabled();
    };

    // 1. A decision is edited.
    await openRow(page, SUB_1012);
    await page.getByRole("button", { name: "Withdraw this decision" }).click();
    const withdraw = page.locator("form").filter({ has: page.getByRole("button", { name: "Withdraw decision" }) });
    await withdraw.getByLabel("Review note").fill("The escrow agent has not confirmed the return yet.");
    await withdraw.getByRole("button", { name: "Withdraw decision" }).click();
    await expectCancelled("A review decision was recorded");
    await expect(page.getByTestId("export-blocked")).toContainText("1 exception still needs a review decision.");
    await openRow(page, SUB_1012);
    await documentException(page, "EXCESS_FUNDING");
    await confirmSnapshot(page);

    // 2. A file is selected, even one that changes nothing.
    await goToStep(page, "select");
    await selectCsv(page, "allocations", "allocations.csv", fixture("allocations.csv"));
    await expect(count(page, "allocations", "Already in workspace")).toHaveText("48");
    await expectCancelled("A file was selected");
    await expect(page.getByTestId("export-blocked")).toContainText("A selected file has not been added to the workspace yet.");

    // 3. A column mapping is changed on the selected file, and the file is added. Still not confirmed.
    await goToStep(page, "select");
    await page.getByRole("button", { name: /^Column mapping/ }).click();
    await page.locator("#map-allocations-currency").selectOption("");
    await expect(page.getByTestId("preview-allocations")).toContainText('Choose the column that holds "Currency".');
    await expect(page.getByTestId("add-files")).toBeDisabled();
    await page.locator("#map-allocations-currency").selectOption("currency");
    await addSelected(page);
    await expectCancelled("A file was selected");

    // Confirming again produces the same register: re-adding identical rows changed nothing.
    await confirmSnapshot(page);
    const second = await download(page, "download-register");
    expect(unix(second.text)).toBe(KNOWN_GOOD);

    // 4. The deal settings change.
    await page.getByLabel("Deal name").fill("Riverbend Flats Apartments II");
    await expectCancelled("The deal settings were changed");
  });
});
