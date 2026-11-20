/**
 * The day or night theme, and the one thing this app keeps in the browser.
 *
 * A reviewer who picks Light or Dark gets it again on the next visit, so that single
 * word is saved under THEME_STORAGE_KEY. Nothing else is: this module does not import
 * the session or the domain code, the only values it can write are "light" and "dark",
 * and choosing System removes the entry. tests/unit/browser-only.test.ts holds the rest
 * of src/ to no storage at all, and tests/e2e/theme.spec.ts checks what is left behind
 * after a deal has been reviewed.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];
export const THEME_STORAGE_KEY = "close-desk-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong theme.
 * It reads the saved choice, falls back to the system setting, and puts the result on
 * <html> for the stylesheet. It reads; it never writes.
 */
export const THEME_INIT_SCRIPT = `(function(){var c="system";try{var s=window.localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark")c=s}catch(e){}var t=c;if(c==="system"){t="light";try{if(window.matchMedia("${DARK_QUERY}").matches)t="dark"}catch(e){}}var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-theme-choice",c)})()`;

function savedChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function save(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage is blocked. The choice still applies until the tab closes.
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  const theme = choice === "system" ? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light") : choice;
  root.setAttribute("data-theme-choice", choice);
  if (root.getAttribute("data-theme") === theme) return;

  // Every colour changes in the same frame. Without this, the few elements that animate
  // their hover colour would lag behind the rest of the page.
  root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", theme);
  void window.getComputedStyle(root).backgroundColor;
  window.setTimeout(() => root.removeAttribute("data-theme-switching"), 0);
}

let current: ThemeChoice | null = null;
const listeners = new Set<() => void>();

function onSystemChange(): void {
  if (getThemeChoice() === "system") apply("system");
}

/** Another tab changed the theme. The event is only acted on for the theme entry. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  current = savedChoice();
  apply(current);
  for (const listener of listeners) listener();
}

export function getThemeChoice(): ThemeChoice {
  if (current === null) current = savedChoice();
  return current;
}

/** What the server-rendered page shows before the browser knows better. */
export function getServerThemeChoice(): ThemeChoice {
  return "system";
}

export function setThemeChoice(choice: ThemeChoice): void {
  save(choice);
  current = choice;
  apply(choice);
  for (const listener of listeners) listener();
}

export function subscribeToTheme(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.matchMedia(DARK_QUERY).addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.matchMedia(DARK_QUERY).removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    }
  };
}
