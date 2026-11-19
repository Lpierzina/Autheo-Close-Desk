import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { NetworkLog, addSelected, fixture, goToStep, selectSampleFiles, unix } from "./support";

const PRIVACY = "Your files are processed in this browser. They aren't sent to Autheo or stored on our servers.";
const SESSION = "Closing or refreshing this tab clears your work. Download your results before you leave.";

test.describe("home page", () => {
  test("says what the product is, for whom, and asks the three questions in order", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reconcile your apartment equity raise before closing.");
    await expect(page.getByRole("main")).toContainText(
      "For multifamily sponsors and investor operations teams. Compare your subscription, funding, and allocation files, review what doesn't match, and download an ownership register for your administrator.",
    );

    const questions = page.getByRole("region", { name: "Three questions, three files" }).getByRole("listitem");
    await expect(questions).toHaveCount(3);
    await expect(questions.nth(0)).toContainText("Did they sign?");
    await expect(questions.nth(0)).toContainText("Subscription records");
    await expect(questions.nth(1)).toContainText("Did their money clear?");
    await expect(questions.nth(1)).toContainText("Bank or escrow records");
    await expect(questions.nth(2)).toContainText("How many LLC units did the sponsor approve?");
    await expect(questions.nth(2)).toContainText("Approved allocations");

    // The headline, both calls to action and the three questions fit on a laptop screen without scrolling.
    await expect(page.getByRole("link", { name: "Start a reconciliation" }).first()).toBeInViewport();
    await expect(page.getByRole("button", { name: "Try with sample data" }).first()).toBeInViewport();
    await expect(questions.nth(2)).toBeInViewport();

    // The worked example is computed from the bundled sample files.
    const example = page.getByRole("figure");
    await expect(example).toContainText("$100,000.00");
    await expect(example).toContainText("2 wires: $60,000.00 + $40,000.00");
    await expect(example).toContainText("$90,000.00");
    await expect(example).toContainText("+$10,000.00");
    await expect(example).toContainText("It never moves money, issues units, or initiates a refund.");
  });

  test("Start a reconciliation opens an empty workspace with the privacy and session notes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Start a reconciliation" }).first().click();
    await expect(page).toHaveURL(/\/reconcile\/$/);
    await expect(page.getByRole("heading", { name: "Select CSV files" })).toBeVisible();
    await expect(page.getByTestId("privacy-note")).toHaveText(PRIVACY);
    await expect(page.getByTestId("session-note")).toHaveText(SESSION);
    await expect(page.getByRole("button", { name: "Select CSV file", exact: true })).toHaveCount(3);
    await expect(page.getByTestId("sample-guide")).toHaveCount(0);
  });

  test("tokenization is secondary: a small coming-soon section and an information-only page", async ({ page }) => {
    await page.goto("/");
    const teaser = page.getByRole("region", { name: /Custom tokenization/ });
    await expect(teaser).toContainText("Coming soon");
    await teaser.getByRole("link", { name: "Learn more" }).click();
    await expect(page).toHaveURL(/\/tokenization\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Custom tokenization");
    await expect(page.getByRole("main")).toContainText("Coming soon");
    await expect(page.getByRole("main")).toContainText("a reviewed ownership register could inform that step in the future");
    await expect(page.getByRole("main")).toContainText("Close Desk itself is an off-chain reconciliation tool.");
    // Nothing on the page can take a wallet, investor information or a file.
    await expect(page.getByRole("main").locator("input, textarea, select, form, [contenteditable]")).toHaveCount(0);
  });
});

test.describe("wording and navigation", () => {
  test('no screen says "upload"', async ({ page }) => {
    const seen: string[] = [];
    const scan = async (where: string) => {
      const text = await page.locator("body").innerText();
      if (/upload/i.test(text)) seen.push(where);
      const labels = await page.evaluate(() => [...document.querySelectorAll("[aria-label], [title], [placeholder]")].map((el) => `${el.getAttribute("aria-label")} ${el.getAttribute("title")} ${el.getAttribute("placeholder")}`).join(" "));
      if (/upload/i.test(labels)) seen.push(`${where} (labels)`);
    };
    for (const route of ["/", "/guide/", "/tokenization/", "/reconcile/", "/missing-page/"]) {
      await page.goto(route);
      await scan(route);
    }
    await page.goto("/reconcile/");
    await selectSampleFiles(page);
    await scan("select files, with previews");
    await page.getByTestId("preview-funding").getByRole("checkbox").check();
    await addSelected(page);
    await scan("review matches");
    await goToStep(page, "resolve");
    await scan("resolve exceptions");
    await goToStep(page, "export");
    await scan("export");
    expect(seen).toEqual([]);
  });

  test("the file guide lists the accepted columns and saves sample files without a request", async ({ page, context }) => {
    const log = new NetworkLog(context);
    await page.goto("/guide/");
    await page.waitForLoadState("networkidle");
    const loaded = log.mark();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("File guide");
    await expect(page.getByRole("main")).toContainText("The sample files are synthetic");

    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Sample CSV" }).nth(1).click()]);
    expect(file.suggestedFilename()).toBe("funding.csv");
    const saved = await file.path();
    expect(unix(readFileSync(saved, "utf8"))).toBe(unix(fixture("funding.csv")));
    expect((await log.since(loaded)).network).toEqual([]);
  });

  test("the session survives moving between pages, and the header shows it is in progress", async ({ page }) => {
    await page.goto("/reconcile/");
    await selectSampleFiles(page);
    await page.getByTestId("preview-funding").getByRole("checkbox").check();
    await addSelected(page);

    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "File guide" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("File guide");
    await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("In progress");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Reconcile/ }).click();
    await expect(page.getByTestId("total-approved")).toContainText("$5,000,000.00");

    await page.getByRole("link", { name: "Autheo Close Desk home" }).click();
    await expect(page.getByRole("link", { name: "Continue your reconciliation" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Try with sample data" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Replace this session with sample data?" });
    await expect(dialog).toContainText("stay on your device");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: "Continue your reconciliation" }).first().click();
    await expect(page.getByTestId("total-approved")).toContainText("$5,000,000.00");
  });

  test("an unknown address shows the not-found page", async ({ page }) => {
    const response = await page.goto("/offerings/");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist");
  });
});

test.describe("keyboard", () => {
  test("the workspace can be driven without a mouse and focus is always visible", async ({ page }) => {
    await page.goto("/reconcile/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

    await selectSampleFiles(page);
    await page.getByTestId("preview-funding").getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page.getByTestId("add-files").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Review matches" })).toBeVisible();

    // Stepper buttons are reachable and announce the current step.
    await page.getByTestId("step-review").focus();
    await expect(page.getByTestId("step-review")).toHaveAttribute("aria-current", "step");
    const outline = await page.getByTestId("step-review").evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);

    // Arrow keys move between table rows; Enter opens the row.
    await page.getByRole("button", { name: "Open SUB-1001, Class A" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "Open SUB-1002, Class A" })).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await expect(page.getByRole("button", { name: "Open SUB-1001, Class A" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("step-resolve")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("row-review").getByRole("heading", { level: 2 })).toBeFocused();

    // The exception list is a keyboard list too.
    await page.locator('[data-queue-key="SUB-1012::CLASS A"]').focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("row-review").getByRole("heading", { level: 2 })).toContainText("SUB-1031");

    // A dialog traps focus and Escape cancels it.
    await page.getByTestId("clear-session").focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Clear this session?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("clear-session")).toBeFocused();
  });
});
