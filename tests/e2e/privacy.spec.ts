import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  EMPTY_STORAGE,
  HEADER,
  NetworkLog,
  addSelected,
  browserStorage,
  closeSampleDeal,
  confirmSnapshot,
  csv,
  documentException,
  download,
  fixture,
  goToStep,
  openRow,
  selectCorrectionFiles,
  selectCsv,
  selectSampleFiles,
  unix,
} from "./support";

/**
 * These tests are the evidence behind the sentence shown beside the file picker:
 * "Your files are processed in this browser. They aren't sent to Autheo or stored on our servers."
 * If one of them fails, that sentence must not ship.
 */

/** A deal whose every value is recognisable, so any of it appearing in a request is unmistakable. */
function markedDeal() {
  const marker = `ZQ${randomBytes(6).toString("hex").toUpperCase()}`;
  const subscriptionId = `SUB-${marker}`;
  const investor = `INV-${marker}`;
  return {
    marker,
    subscriptionId,
    investor,
    rowKey: `${subscriptionId}::CLASS A`,
    dealName: `Deal ${marker}`,
    note: `Reviewed ${marker}: the excess is being returned outside this tool.`,
    files: {
      subscriptions: { name: `subs-${marker}.csv`, text: csv(HEADER.subscriptions, [`${subscriptionId},${investor},Class A,731942.17,USD,signed,`]) },
      // A bank portal's headers, so the column mapping is exercised too.
      funding: {
        name: `bank-${marker}.csv`,
        text: csv("Bank Ref,Subscription No,Wire Memo,Credit Amount,CCY,Payment Status,Value Date,Reverses", [
          `WIRE-${marker}-A,${subscriptionId},memo ${marker},431942.17,USD,cleared,2026-10-27,`,
          `WIRE-${marker}-B,${subscriptionId},memo ${marker},300000.00,USD,cleared,2026-10-29,`,
        ]),
      },
      allocations: { name: `alloc-${marker}.csv`, text: csv(HEADER.allocations, [`${subscriptionId},Class A,631942.17,631.94217,USD`]) },
    },
    /** Anything from the deal that must never appear in a request. */
    secrets: [marker, marker.toLowerCase(), "731942", "431942", "631942", "631.94217", "100000.00"],
    registerLine: `${investor},Class A,${subscriptionId},631942.17,631.94217,USD`,
  };
}

async function reconcileMarkedDeal(page: Page, deal: ReturnType<typeof markedDeal>) {
  await page.getByLabel("Deal name").fill(deal.dealName);
  await selectCsv(page, "subscriptions", deal.files.subscriptions.name, deal.files.subscriptions.text);
  await selectCsv(page, "funding", deal.files.funding.name, deal.files.funding.text);
  await page.locator("#map-funding-amount").selectOption("Credit Amount");
  await selectCsv(page, "allocations", deal.files.allocations.name, deal.files.allocations.text);
  await addSelected(page);

  await page.getByRole("searchbox").fill(deal.marker);
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(page.getByRole("button", { name: `Open ${deal.subscriptionId}, Class A` })).toBeVisible();

  await openRow(page, deal.rowKey);
  await expect(page.getByTestId("difference")).toContainText("Cleared funds are $100,000.00 above the approved allocation.");
  await documentException(page, "EXCESS_FUNDING", deal.note);

  await confirmSnapshot(page);
  const register = await download(page, "download-register");
  const exceptions = await download(page, "download-exceptions");
  return { register, exceptions };
}

test.describe("deal data stays in the browser", () => {
  test("nothing is requested between selecting files and downloading the exports, and no request ever carries deal data", async ({ page, context, baseURL }) => {
    const deal = markedDeal();
    const log = new NetworkLog(context);

    await page.goto("/reconcile/");
    await page.waitForLoadState("networkidle");
    const loaded = log.mark();

    const { register, exceptions } = await reconcileMarkedDeal(page, deal);

    // The data really went through the app: it is in the files written on this device.
    expect(unix(register.text)).toBe(`investor_ref,share_class,subscription_id,approved_amount,approved_units,currency\n${deal.registerLine}\n`);
    expect(register.filename).toBe(`deal-${deal.marker.toLowerCase()}-reviewed-ownership-register.csv`);
    expect(exceptions.text).toContain(deal.note);
    expect(exceptions.text).toContain(deal.subscriptionId);

    // Selection, mapping, review, decision, approval and export made no request at all.
    const during = await log.since(loaded);
    expect(during.network, "requests made while working on the deal").toEqual([]);
    expect(log.sockets, "sockets opened").toEqual([]);
    expect(log.failed, "requests attempted and failed").toEqual([]);

    // The downloads were built in memory. If the browser reports their URLs at all, they are random identifiers on this origin.
    for (const url of during.local) expect(url).toMatch(new RegExp(`^blob:${baseURL}/[0-9a-f-]{36}$`));

    // Every request of the whole visit, including loading the app: same origin, read-only, and free of deal data.
    const all = await log.since(0);
    expect(all.network.length).toBeGreaterThan(0);
    for (const request of all.network) {
      expect(new URL(request.url).origin, request.url).toBe(baseURL);
      expect(request.method, request.url).toBe("GET");
      expect(request.body, request.url).toBeNull();
      const sent = JSON.stringify(request);
      for (const secret of deal.secrets) expect(sent, `${request.url} must not carry ${secret}`).not.toContain(secret);
      for (const file of Object.values(deal.files)) expect(sent).not.toContain(file.name);
    }

    // Nothing is written to browser storage, and the address bar holds no deal data.
    expect(await browserStorage(page)).toEqual(EMPTY_STORAGE);
    expect(await context.cookies()).toEqual([]);
    expect(page.url()).toBe(`${baseURL}/reconcile/`);
  });

  test("the app loads nothing from another origin and no third-party script", async ({ page, context, baseURL }) => {
    const log = new NetworkLog(context);
    for (const route of ["/", "/reconcile/", "/guide/", "/tokenization/"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const sources = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("script[src], link[href], img[src], iframe[src], source[src]")].map(
          (element) => (element as HTMLScriptElement).src || (element as HTMLLinkElement).href,
        ),
      );
      for (const source of sources) expect(new URL(source).origin, `${route} loads ${source}`).toBe(baseURL);
      const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
      for (const name of fetched) expect(new URL(name).origin, `${route} fetched ${name}`).toBe(baseURL);
    }
    const all = await log.since(0);
    for (const request of all.network) expect(new URL(request.url).origin, request.url).toBe(baseURL);
    expect(all.network.filter((request) => request.resourceType === "font").length).toBeGreaterThan(0);
    expect(log.sockets).toEqual([]);
  });

  test("control: the recorder does see a request when one is made, and the page cannot reach another origin", async ({ page, context, baseURL }) => {
    const log = new NetworkLog(context);
    await page.goto("/reconcile/");
    await page.waitForLoadState("networkidle");
    const loaded = log.mark();

    // A deliberate same-origin request, of the kind the app never makes, is recorded with its address and body.
    await page.evaluate(() => fetch("/reconcile/?probe=CONTROL-GET").then((response) => response.status));
    await page.evaluate(() => fetch("/reconcile/", { method: "POST", body: "CONTROL-BODY" }).then((response) => response.status));
    const seen = (await log.since(loaded)).network;
    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([`GET ${baseURL}/reconcile/?probe=CONTROL-GET`, `POST ${baseURL}/reconcile/`]);
    expect(seen[1]?.body).toBe("CONTROL-BODY");

    // A request to any other origin is stopped by the content security policy before it leaves.
    const blocked = await page.evaluate(
      () =>
        new Promise<{ directive: string; rejected: boolean }>((resolve) => {
          let directive = "";
          document.addEventListener("securitypolicyviolation", (event) => {
            directive = event.effectiveDirective;
          });
          fetch("http://203.0.113.1/collect?d=CONTROL")
            .then(() => resolve({ directive, rejected: false }))
            .catch(() => setTimeout(() => resolve({ directive, rejected: true }), 50));
        }),
    );
    expect(blocked).toEqual({ directive: "connect-src", rejected: true });
    expect((await log.since(loaded)).network).toHaveLength(2);
  });

  test("the policy inside the page blocks other origins even when the host sends no security headers", async ({ page, context }) => {
    // Serve the same files with the response headers stripped, as a plain static host would.
    await context.route("**/*", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      for (const name of ["content-security-policy", "x-frame-options", "referrer-policy", "permissions-policy"]) delete headers[name];
      await route.fulfill({ response, headers });
    });
    const response = await page.goto("/reconcile/");
    expect(response?.headers()["content-security-policy"]).toBeUndefined();
    await expect(page.getByRole("heading", { name: "Select CSV files" })).toBeVisible();

    const blocked = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener("securitypolicyviolation", (event) => resolve(event.effectiveDirective));
          void fetch("http://203.0.113.1/collect").catch(() => undefined);
          setTimeout(() => resolve("not blocked"), 3000);
        }),
    );
    expect(blocked).toBe("connect-src");
    expect(await page.evaluate(() => document.referrer)).toBe("");
  });

  test("the server refuses anything that could carry data", async ({ request }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await request.fetch("/reconcile/", { method, data: "subscription_id,investor_ref\nSUB-1,INV-1\n" });
      expect(response.status(), method).toBe(405);
    }
    for (const gone of ["/api/health", "/api/offerings", "/offerings", "/sign-in"]) {
      expect((await request.get(gone)).status(), gone).toBe(404);
    }
    const page = await request.get("/reconcile/");
    const policy = page.headers()["content-security-policy"] ?? "";
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(page.headers()["referrer-policy"]).toBe("no-referrer");
    // The same policy travels inside the page, for hosts that serve the files without these headers.
    expect(await page.text()).toContain('http-equiv="Content-Security-Policy"');
  });
});

test.describe("the workflow needs no network once the app has loaded", () => {
  test("offline: the sample deal reconciles, is confirmed and exports the known-good register", async ({ page, context }) => {
    const log = new NetworkLog(context);
    await page.goto("/reconcile/");
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    const offline = log.mark();

    await page.getByLabel("Deal name").fill("Riverbend Flats Apartments");
    await selectSampleFiles(page);
    await closeSampleDeal(page, selectCorrectionFiles);

    const register = await download(page, "download-register");
    const exceptions = await download(page, "download-exceptions");
    expect(unix(register.text)).toBe(unix(fixture("expected/ownership-register.csv")));
    expect(register.text).toContain("INV-0412,Class A,SUB-1012,90000.00,90,USD");
    expect(exceptions.text).toContain("EXCESS_FUNDING");

    const during = await log.since(offline);
    expect(during.network, "requests attempted while offline").toEqual([]);
    expect(log.failed).toEqual([]);
  });
});

test.describe("the session lives only in the open tab", () => {
  test("a refresh starts a new session and leaves nothing in browser storage", async ({ page, context }) => {
    const deal = markedDeal();
    await page.goto("/reconcile/");
    await reconcileMarkedDeal(page, deal);
    expect(await browserStorage(page)).toEqual(EMPTY_STORAGE);

    // The browser asks before discarding unsaved work; accept, as a user who chooses to leave would.
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });
    await page.reload();
    expect(dialogs).toEqual(["beforeunload"]);

    await expect(page.getByRole("heading", { name: "Select CSV files" })).toBeVisible();
    await expect(page.getByLabel("Deal name")).toHaveValue("");
    await expect(page.getByTestId("clear-session")).toBeDisabled();
    for (const kind of ["subscriptions", "funding", "allocations"]) {
      await expect(page.getByTestId(`preview-${kind}`)).toHaveCount(0);
      await expect(page.getByTestId(`slot-${kind}`)).not.toContainText("In workspace");
    }
    await goToStep(page, "review");
    await expect(page.getByText("Nothing to review yet")).toBeVisible();
    await goToStep(page, "export");
    await expect(page.getByTestId("export-blocked")).toBeVisible();
    await expect(page.getByTestId("download-exceptions")).toBeDisabled();
    expect(await page.content()).not.toContain(deal.marker);

    expect(await browserStorage(page)).toEqual(EMPTY_STORAGE);
    expect(await context.cookies()).toEqual([]);
  });

  test("a second tab does not see the first tab's session", async ({ page, context }) => {
    const deal = markedDeal();
    await page.goto("/reconcile/");
    await reconcileMarkedDeal(page, deal);

    const other = await context.newPage();
    await other.goto("/reconcile/");
    await expect(other.getByLabel("Deal name")).toHaveValue("");
    await goToStep(other, "review");
    await expect(other.getByText("Nothing to review yet")).toBeVisible();
    expect(await other.content()).not.toContain(deal.marker);
  });

  test("Clear session resets files, mappings, decisions and the confirmation, and says what it does not delete", async ({ page }) => {
    const deal = markedDeal();
    await page.goto("/reconcile/");
    await reconcileMarkedDeal(page, deal);
    await goToStep(page, "select");
    await selectCsv(page, "funding", deal.files.funding.name, deal.files.funding.text);

    await page.getByTestId("clear-session").click();
    const dialog = page.getByRole("dialog", { name: "Clear this session?" });
    await expect(dialog).toContainText("It does not delete the source files or anything already downloaded.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Deal name")).toHaveValue(deal.dealName);

    await page.getByTestId("clear-session").click();
    await dialog.getByRole("button", { name: "Clear session" }).click();

    await expect(page.getByTestId("notice")).toContainText("Session cleared.");
    await expect(page.getByLabel("Deal name")).toHaveValue("");
    await expect(page.getByTestId("preview-funding")).toHaveCount(0);
    await expect(page.getByTestId("slot-funding")).not.toContainText("In workspace");
    await goToStep(page, "resolve");
    await expect(page.getByText("No exceptions yet")).toBeVisible();
    await goToStep(page, "export");
    await expect(page.getByTestId("confirmed")).toHaveCount(0);
    await expect(page.getByTestId("download-register")).toBeDisabled();
    expect(await page.content()).not.toContain(deal.marker);

    // Selecting the same funding file again starts from the suggested mapping, not the one chosen before.
    await goToStep(page, "select");
    await selectCsv(page, "funding", deal.files.funding.name, deal.files.funding.text);
    await expect(page.locator("#map-funding-amount")).toHaveValue("");
  });
});
