import { expect, test, type Page } from "@playwright/test";
import { EMPTY_STORAGE, NetworkLog, addSelected, browserStorage, download, finishSampleDeal, fixture, goToStep, openRow, selectCorrectionFiles, selectSampleFiles, unix } from "./support";

type Choice = "Light" | "Dark" | "System";

const THEME_KEY = "close-desk-theme";
const NOTE_IN_PROGRESS = "Half-written note: the excess is being returned by the escrow agent.";

async function chooseTheme(page: Page, choice: Choice): Promise<void> {
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitemradio", { name: choice }).click();
  await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName(`Theme: ${choice}`);
}

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");

/** The Autheo mark that is actually on screen, and whether its file loaded. */
async function visibleMark(page: Page): Promise<{ file: string; loaded: boolean; filter: string; count: number }> {
  return page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLImageElement>('header img[alt="Autheo"]')].filter((image) => image.getClientRects().length > 0);
    const image = shown[0];
    return {
      count: shown.length,
      file: image ? new URL(image.currentSrc).pathname.split("/").pop()!.replace(/\.[^.]+(\.\w+)$/, "$1") : "",
      loaded: Boolean(image && image.complete && image.naturalWidth > 0),
      filter: image ? getComputedStyle(image).filter : "",
    };
  });
}

/** The hero has one layer per theme; this is the file in the layer that is showing. */
const heroImage = (page: Page) =>
  page.getByTestId("hero-art").evaluate((element) =>
    ["::before", "::after"]
      .map((layer) => getComputedStyle(element, layer))
      .filter((style) => style.visibility === "visible")
      .map((style) => /([\w-]+)\.[\w-]+\.webp/.exec(style.backgroundImage)?.[1] ?? style.backgroundImage)
      .join(" + "),
  );
const pageColour = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("theme preference", () => {
  test("follows the system setting until a choice is made, and stores nothing until then", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect(await theme(page)).toBe("dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName("Theme: System");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await browserStorage(page)).toEqual(EMPTY_STORAGE);
  });

  test("remembers an explicit choice, and that one word is all it keeps", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await chooseTheme(page, "Dark");
    expect(await theme(page)).toBe("dark");
    expect(await browserStorage(page)).toEqual({ ...EMPTY_STORAGE, localStorage: [[THEME_KEY, "dark"]] });

    // The saved choice wins over the system setting, on every page, from the first paint.
    for (const route of ["/", "/reconcile/", "/guide/", "/tokenization/"]) {
      await page.goto(route);
      expect(await theme(page), route).toBe("dark");
      await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName("Theme: Dark");
    }

    await chooseTheme(page, "Light");
    expect(await browserStorage(page)).toEqual({ ...EMPTY_STORAGE, localStorage: [[THEME_KEY, "light"]] });

    // System forgets the choice instead of storing a third value.
    await chooseTheme(page, "System");
    expect(await browserStorage(page)).toEqual(EMPTY_STORAGE);
    expect(await context.cookies()).toEqual([]);
  });

  test("a value it did not write is ignored", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.setItem(key, '"><script>document.title="x"</script>'), THEME_KEY);
    await page.reload();
    expect(await theme(page)).toBe("light");
    await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName("Theme: System");
    await expect(page).toHaveTitle(/Autheo Close Desk/);
  });

  test("the menu works from the keyboard and says which option is selected", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/reconcile/");
    const toggle = page.getByTestId("theme-toggle");
    await toggle.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Theme" });
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Light", "Dark", "System"]);
    await expect(menu.getByRole("menuitemradio", { name: "System" })).toBeFocused();
    await expect(menu.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName("Theme: Dark");
    expect(await theme(page)).toBe("dark");

    await page.keyboard.press("Enter");
    await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await theme(page)).toBe("dark");
  });
});

test.describe("branding follows the theme", () => {
  test("the hero image, the Autheo mark and the page colours change together, with no request", async ({ page, context }) => {
    const log = new NetworkLog(context);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(await heroImage(page)).toBe("close-desk-hero-day");
    expect(await visibleMark(page)).toEqual({ count: 1, file: "autheo-wordmark-ultramarine.svg", loaded: true, filter: "none" });
    const day = await pageColour(page);

    // Both themes' images came with the page, so the switch works with the network gone.
    await context.setOffline(true);
    const loaded = log.mark();
    await chooseTheme(page, "Dark");
    expect(await heroImage(page)).toBe("close-desk-hero-night");
    expect(await visibleMark(page)).toEqual({ count: 1, file: "autheo-wordmark-white.png", loaded: true, filter: "none" });
    expect(await pageColour(page)).not.toBe(day);

    await chooseTheme(page, "Light");
    expect(await heroImage(page)).toBe("close-desk-hero-day");
    expect(await visibleMark(page)).toMatchObject({ file: "autheo-wordmark-ultramarine.svg", loaded: true });
    expect(await pageColour(page)).toBe(day);

    expect((await log.since(loaded)).network).toEqual([]);
    expect(log.failed).toEqual([]);
    const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname.split("/").pop()!.replace(/\.[^.]+(\.\w+)$/, "$1")));
    expect(fetched).toEqual(expect.arrayContaining(["close-desk-hero-day.webp", "close-desk-hero-night.webp"]));
  });

  test("the product label is text beside the mark, and the favicon is the official logomark", async ({ page, request }) => {
    await page.goto("/");
    const home = page.getByRole("link", { name: "Autheo Close Desk home" });
    await expect(home).toContainText("Close Desk");
    await expect(home.locator("svg, text")).toHaveCount(0);

    const icons = await page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')].map((link) => ({ href: new URL(link.href).pathname, media: link.media, type: link.type })));
    expect(icons.map((icon) => icon.media).sort()).toEqual(["(prefers-color-scheme: dark)", "(prefers-color-scheme: light)"]);
    for (const icon of icons) {
      expect(icon.href).toMatch(/^\/_next\/static\/media\/favicon-(light|dark)\.[\w-]+\.png$/);
      const response = await request.get(icon.href);
      expect(response.status(), icon.href).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
    expect((await request.get("/icon.svg")).status()).toBe(404);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`desktop, ${scheme}: the copy sits on the quiet side and the drawing starts after it`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
        const art = await box(page.getByTestId("hero-art"));
        // Each illustration is 3:1, anchored bottom right, with its left 41% empty.
        const drawingStartsAt = art.x + art.width - art.height * 3 * 0.59;
        for (const copy of [page.getByRole("heading", { level: 1 }), page.getByRole("link", { name: "Start a reconciliation" }).first(), page.getByRole("button", { name: "Try with sample data" }).first(), page.getByTestId("privacy-note").first()]) {
          const { x, width: copyWidth } = await box(copy);
          expect(x + copyWidth, `${width}px`).toBeLessThanOrEqual(drawingStartsAt);
          await expect(copy).toBeInViewport({ ratio: 1 });
        }
        // The worked example is a component below the hero, not part of the picture.
        const example = await box(page.getByRole("figure"));
        expect(example.y, `${width}px`).toBeGreaterThanOrEqual(art.y + art.height);
      }
    });

    test(`mobile, ${scheme}: the headline and both buttons are above the illustration, at full size`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/");
        const heading = page.getByRole("heading", { level: 1 });
        const art = (await page.getByTestId("hero-art").boundingBox())!;
        for (const copy of [heading, page.getByRole("link", { name: "Start a reconciliation" }).first(), page.getByRole("button", { name: "Try with sample data" }).first(), page.getByTestId("privacy-note").first()]) {
          const { y, height } = (await copy.boundingBox())!;
          expect(y + height, `${width}px`).toBeLessThanOrEqual(art.y);
        }
        expect(await heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(30);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px overflow`).toBe(0);
        // A compact header uses the logomark; the wordmark returns when there is room.
        expect((await visibleMark(page)).file).toBe(width < 640 ? `autheo-logomark-${scheme === "dark" ? "white" : "ultramarine"}.png` : scheme === "dark" ? "autheo-wordmark-white.png" : "autheo-wordmark-ultramarine.svg");
        await expect(page.getByTestId("theme-toggle")).toBeInViewport({ ratio: 1 });
      }
    });
  }
});

test.describe("the workspace under either theme", () => {
  test("switching themes during a review keeps the session, makes no request, and the register still exports", async ({ page, context }) => {
    const log = new NetworkLog(context);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/reconcile/");
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    const offline = log.mark();

    await page.getByLabel("Deal name").fill("Riverbend Flats Apartments");
    await selectSampleFiles(page);
    await page.getByTestId("preview-funding").getByRole("checkbox").check();
    await addSelected(page);
    await openRow(page, "SUB-1012::CLASS A");
    const note = page.getByTestId("exception-EXCESS_FUNDING").getByLabel("Review note");
    await note.fill(NOTE_IN_PROGRESS);

    // Mid-review, with an unsaved note on screen: every option, twice round.
    for (const choice of ["Dark", "Light", "System", "Dark"] as const) {
      await chooseTheme(page, choice);
      await expect(note).toHaveValue(NOTE_IN_PROGRESS);
      await expect(page.getByTestId("step-resolve")).toHaveAttribute("aria-current", "step");
      await expect(page.locator('[data-queue-key="SUB-1012::CLASS A"]')).toHaveAttribute("aria-current", "true");
      await expect(page.getByLabel("Deal name")).toHaveValue("Riverbend Flats Apartments");
      await expect(page.getByTestId("difference")).toContainText("Cleared funds are $10,000.00 above the approved allocation.");
      expect((await visibleMark(page)).loaded, `${choice}: logo`).toBe(true);
    }
    expect(await theme(page)).toBe("dark");
    await goToStep(page, "review");
    await expect(page.getByTestId("total-approved")).toContainText("$5,000,000.00");

    // The rest of the sample deal, in the dark theme, through to the known-good register.
    await finishSampleDeal(page, selectCorrectionFiles);
    await chooseTheme(page, "Light");
    await expect(page.getByTestId("confirmed")).toBeVisible();
    const register = await download(page, "download-register");
    const exceptions = await download(page, "download-exceptions");
    expect(unix(register.text)).toBe(unix(fixture("expected/ownership-register.csv")));
    expect(exceptions.text).toContain("EXCESS_FUNDING");

    expect((await log.since(offline)).network, "requests attempted after the app loaded").toEqual([]);
    expect(log.failed).toEqual([]);

    // After a whole deal, the browser holds the theme and nothing from the deal.
    const storage = await browserStorage(page);
    expect(storage).toEqual({ ...EMPTY_STORAGE, localStorage: [[THEME_KEY, "light"]] });
    expect(JSON.stringify(storage)).not.toMatch(/SUB-|INV-|WIRE-|Riverbend|csv|\d{3}/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: no artwork behind investor rows, and every status is written out`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/reconcile/");
      await selectSampleFiles(page);
      await page.getByTestId("preview-funding").getByRole("checkbox").check();
      await addSelected(page);

      const filters = page.getByRole("group", { name: "Filter by status" });
      for (const status of ["Ready", "Needs review", "Blocked"]) {
        await filters.getByRole("button", { name: new RegExp(`^${status}`) }).click();
        const cells = page.getByRole("table").locator("tbody tr td:last-child");
        expect(await cells.count(), status).toBeGreaterThan(0);
        // Some rows add the reason underneath; the status itself always comes first, in words.
        for (const text of await cells.allInnerTexts()) expect(text.trim().split("\n")[0]).toBe(status);
      }

      for (const step of ["select", "review", "resolve", "export"] as const) {
        await goToStep(page, step);
        await expect(page.getByTestId("hero-art")).toHaveCount(0);
        const pictures = await page.evaluate(() => {
          const drawn = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => getComputedStyle(element).backgroundImage !== "none").map((element) => element.tagName);
          const images = [...document.querySelectorAll("main img, main picture, main video, main canvas")].length;
          return { drawn, images };
        });
        expect(pictures, step).toEqual({ drawn: [], images: 0 });
      }
    });
  }
});
