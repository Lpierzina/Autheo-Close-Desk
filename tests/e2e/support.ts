import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type BrowserContext, type Page, type Request } from "@playwright/test";

export const FIXTURES = path.resolve(__dirname, "../../fixtures/demo");
export const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");
export const unix = (text: string): string => text.replace(/\r\n/g, "\n");

export const NOTE = "Checked against the wire confirmations and the allocation memo.";

export const HEADER = {
  subscriptions: "subscription_id,investor_ref,share_class,requested_amount,currency,signature_status,payment_reference",
  funding: "transaction_ref,subscription_id,payment_reference,amount,currency,settlement_status,settled_at,original_transaction_ref",
  allocations: "subscription_id,share_class,approved_amount,approved_units,currency",
} as const;

export type Kind = keyof typeof HEADER;
export type Step = "select" | "review" | "resolve" | "export";

export const csv = (header: string, rows: string[]): string => `${[header, ...rows].join("\n")}\n`;

/** Chooses a file in one of the three slots, the way the file picker does, and waits for its preview. */
export async function selectCsv(page: Page, kind: Kind, filename: string, content: string): Promise<void> {
  await page.getByTestId(`file-input-${kind}`).setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") });
  await expect(page.getByTestId(`preview-${kind}`)).toContainText(filename);
}

/** One of the counts in a selected file's preview: "Rows in file", "Valid", "Invalid", "New", "Already in workspace", "Change a record". */
export function count(page: Page, kind: Kind, label: string) {
  return page.getByTestId(`preview-${kind}`).locator(`[data-count="${label}"] dd`);
}

export async function addSelected(page: Page): Promise<void> {
  await page.getByTestId("add-files").click();
  await expect(page.getByRole("heading", { name: "Review matches" })).toBeVisible();
}

export async function goToStep(page: Page, step: Step): Promise<void> {
  await page.getByTestId(`step-${step}`).click();
  await expect(page.getByTestId(`step-${step}`)).toHaveAttribute("aria-current", "step");
}

export async function openRow(page: Page, key: string): Promise<void> {
  await goToStep(page, "resolve");
  await page.locator(`[data-queue-key="${key}"]`).click();
  await expect(page.locator(`[data-queue-key="${key}"]`)).toHaveAttribute("aria-current", "true");
}

export async function documentException(page: Page, code: string, note = NOTE): Promise<void> {
  const card = page.getByTestId(`exception-${code}`);
  await card.getByLabel("Review note").fill(note);
  await card.getByRole("button", { name: "Record review decision" }).click();
  await expect(card.getByText("Reviewed", { exact: true })).toBeVisible();
}

export async function linkPayment(page: Page, transactionRef: string, subscriptionId: string, note = NOTE): Promise<void> {
  await openRow(page, `FUNDING::${transactionRef}`);
  const review = page.getByTestId("row-review");
  await review.getByLabel("Subscription ID to link to").fill(subscriptionId);
  await review.getByLabel("Review note").fill(note);
  await review.getByRole("button", { name: "Record decision" }).click();
  await expect(review.getByRole("heading", { level: 2 })).toContainText(subscriptionId);
}

/** Chooses the later file's version for every changed record on a row. */
export async function chooseLaterVersions(page: Page, key: string, note = NOTE): Promise<void> {
  await openRow(page, key);
  const choice = page.getByTestId("row-review").getByLabel("Use the version from the later file");
  for (let left = await choice.count(); left > 0; left = await choice.count()) {
    const form = page.getByTestId("row-review").locator("form").filter({ has: page.getByLabel("Use the version from the later file") }).first();
    await form.getByLabel("Use the version from the later file").check();
    await form.getByLabel("Review note").fill(note);
    await form.getByRole("button", { name: "Record decision" }).click();
    await expect(choice).toHaveCount(left - 1);
  }
}

export async function confirmSnapshot(page: Page): Promise<void> {
  await goToStep(page, "export");
  await page.getByRole("checkbox", { name: /I have reviewed the matches/ }).check();
  await page.getByTestId("confirm-snapshot").click();
  await expect(page.getByTestId("confirmed")).toBeVisible();
}

export async function download(page: Page, testId: "download-register" | "download-exceptions"): Promise<{ filename: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  const saved = await file.path();
  return { filename: file.suggestedFilename(), text: readFileSync(saved, "utf8") };
}

/**
 * Works the Riverbend Flats sample from "three files selected" to a confirmed snapshot,
 * through the screens only. `corrections` selects the two correction files.
 */
export async function closeSampleDeal(page: Page, corrections: (page: Page) => Promise<void>): Promise<void> {
  await page.getByTestId("preview-funding").getByRole("checkbox").check();
  await addSelected(page);
  await finishSampleDeal(page, corrections);
}

/** The same, from the point where the three sample files are already in the workspace. */
export async function finishSampleDeal(page: Page, corrections: (page: Page) => Promise<void>): Promise<void> {
  await openRow(page, "SUB-1012::CLASS A");
  await documentException(page, "EXCESS_FUNDING");
  await openRow(page, "SUB-1044::CLASS A");
  await documentException(page, "MISSING_ALLOCATION");
  await openRow(page, "SUB-1048::CLASS A");
  await documentException(page, "UNSIGNED_NO_ALLOCATION");

  await openRow(page, "SUB-1034::CLASS A");
  await page.getByRole("button", { name: "Exclude PORTAL-88120 from funding" }).click();
  const exclusion = page.locator("form").filter({ has: page.getByRole("button", { name: "Exclude payment" }) });
  await exclusion.getByLabel("Review note").fill(NOTE);
  await exclusion.getByRole("button", { name: "Exclude payment" }).click();
  await expect(page.getByTestId("row-review").getByText("Excluded in review", { exact: true })).toBeVisible();

  await linkPayment(page, "WIRE-20338", "SUB-1038");
  await linkPayment(page, "WIRE-20341", "SUB-1041");

  await corrections(page);
  await page.locator("#map-funding-amount").selectOption("Credit Amount");
  await expect(page.getByTestId("preview-funding")).toContainText("Ready to add to the workspace");
  await addSelected(page);

  for (const key of ["SUB-1019::CLASS A", "SUB-1023::CLASS B", "SUB-1031::CLASS B", "SUB-1046::CLASS B"]) {
    await chooseLaterVersions(page, key);
  }
  await confirmSnapshot(page);
}

export async function selectSampleFiles(page: Page): Promise<void> {
  await selectCsv(page, "subscriptions", "subscriptions.csv", fixture("subscriptions.csv"));
  await selectCsv(page, "funding", "funding.csv", fixture("funding.csv"));
  await selectCsv(page, "allocations", "allocations.csv", fixture("allocations.csv"));
}

export async function selectCorrectionFiles(page: Page): Promise<void> {
  await goToStep(page, "select");
  await selectCsv(page, "subscriptions", "subscriptions-corrections.csv", fixture("corrections/subscriptions-corrections.csv"));
  await selectCsv(page, "funding", "funding-corrections.csv", fixture("corrections/funding-corrections.csv"));
}

interface Sent {
  method: string;
  url: string;
  resourceType: string;
  body: string | null;
  headers: Record<string, string>;
}

/** Records every request and socket the browser context opens, from the moment it is created. */
export class NetworkLog {
  private readonly requests: Request[] = [];
  readonly sockets: string[] = [];
  readonly failed: string[] = [];

  constructor(context: BrowserContext) {
    context.on("request", (request) => this.requests.push(request));
    context.on("requestfailed", (request) => this.failed.push(`${request.method()} ${request.url()}`));
    context.on("page", (page) => page.on("websocket", (socket) => this.sockets.push(socket.url())));
    for (const page of context.pages()) page.on("websocket", (socket) => this.sockets.push(socket.url()));
  }

  mark(): number {
    return this.requests.length;
  }

  /** Requests since `mark`. A blob: URL is a file the page built in memory, not something sent anywhere, so it is reported separately. */
  async since(mark = 0): Promise<{ network: Sent[]; local: string[] }> {
    const network: Sent[] = [];
    const local: string[] = [];
    for (const request of this.requests.slice(mark)) {
      const url = request.url();
      if (url.startsWith("blob:") || url.startsWith("data:")) {
        local.push(url);
        continue;
      }
      const headers = await request.allHeaders().catch(() => request.headers());
      network.push({ method: request.method(), url, resourceType: request.resourceType(), body: request.postData(), headers });
    }
    return { network, local };
  }
}

export interface StorageSnapshot {
  localStorage: [string, string][];
  sessionStorage: [string, string][];
  cookies: string;
  databases: (string | undefined)[];
  caches: string[];
  serviceWorkers: number;
}

export async function browserStorage(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => ({
    localStorage: Object.entries(window.localStorage) as [string, string][],
    sessionStorage: Object.entries(window.sessionStorage) as [string, string][],
    cookies: document.cookie,
    databases: (await window.indexedDB.databases()).map((database) => database.name),
    caches: await window.caches.keys(),
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
  }));
}

export const EMPTY_STORAGE: StorageSnapshot = { localStorage: [], sessionStorage: [], cookies: "", databases: [], caches: [], serviceWorkers: 0 };
