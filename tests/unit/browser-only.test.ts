import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../../src/theme/preference";

const root = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const sources = files(path.join(root, "src")).filter((file) => /\.(ts|tsx|css)$/.test(file) && !file.endsWith(".generated.ts"));
const read = (file: string) => readFileSync(file, "utf8");
const relative = (file: string) => path.relative(root, file);

/**
 * The one file allowed to use browser storage. It keeps the Light or Dark theme choice
 * and nothing else; the tests at the end of this file hold it to that.
 */
const THEME_PREFERENCE = "src/theme/preference.ts";

/**
 * Anything that could carry deal data out of the tab, or keep it after the tab closes.
 * The end-to-end tests watch the network and the browser's storage; this catches the same
 * mistake at the moment it is written.
 */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "sendBeacon", pattern: /\bsendBeacon\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "EventSource", pattern: /\bEventSource\b/ },
  { name: "localStorage", pattern: /\blocalStorage\b/ },
  { name: "sessionStorage", pattern: /\bsessionStorage\b/ },
  { name: "indexedDB", pattern: /\bindexedDB\b/i },
  { name: "document.cookie", pattern: /document\.cookie/ },
  { name: "service worker", pattern: /serviceWorker/ },
  { name: "Cache API", pattern: /\bcaches\.(open|match)\b/ },
  { name: "server action", pattern: /["']use server["']/ },
  { name: "form posting", pattern: /<form[^>]*\b(action|method)=/ },
  { name: "remote URL", pattern: /["'`(]https?:\/\// },
];

describe("the app has no way to send or keep deal data", () => {
  it("uses no network, storage or server API anywhere in src/", () => {
    const found: string[] = [];
    for (const file of sources) {
      const lines = read(file).split("\n");
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { name, pattern } of FORBIDDEN) {
          if (name === "localStorage" && relative(file) === THEME_PREFERENCE) continue;
          if (pattern.test(line)) found.push(`${relative(file)}:${index + 1} uses ${name}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("has no API routes, middleware, database code or server-only modules", () => {
    for (const gone of ["src/app/api", "src/server", "src/proxy.ts", "src/middleware.ts", "db", "pages/api"]) {
      expect(existsSync(path.join(root, gone)), gone).toBe(false);
    }
    expect(sources.filter((file) => /route\.tsx?$/.test(file)).map(relative)).toEqual([]);
  });

  it("depends on no account, database, analytics or error-reporting package", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json"))) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = /clerk|^pg$|@types\/pg|server-only|sentry|posthog|segment|datadog|logrocket|fullstory|hotjar|analytics|speed-insights|gtag|mixpanel|amplitude|bugsnag|rollbar/i;
    expect(names.filter((name) => banned.test(name))).toEqual([]);
  });

  it("builds as a static export", () => {
    expect(read(path.join(root, "next.config.ts"))).toMatch(/output:\s*"export"/);
  });

  it("keeps one security policy: the host header file repeats security-headers.json exactly", () => {
    const policy = JSON.parse(read(path.join(root, "security-headers.json"))) as { contentSecurityPolicy: string[]; headerOnlyDirectives: string[]; headers: Record<string, string> };
    const host = JSON.parse(read(path.join(root, "vercel.json"))) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    expect(host.headers).toHaveLength(1);
    expect(host.headers[0]?.source).toBe("/(.*)");
    expect(Object.fromEntries((host.headers[0]?.headers ?? []).map((h) => [h.key, h.value]))).toEqual({
      ...policy.headers,
      "Content-Security-Policy": [...policy.contentSecurityPolicy, ...policy.headerOnlyDirectives].join("; "),
    });
    expect(policy.contentSecurityPolicy).toContain("connect-src 'self'");
    expect(policy.contentSecurityPolicy.join(" ")).not.toMatch(/https?:|\*/);
  });
});

describe("the theme preference is the only thing kept in the browser", () => {
  const source = read(path.join(root, THEME_PREFERENCE));

  it("cannot reach deal data: it imports nothing, and the session and domain code do not import it", () => {
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    const importers = sources.filter((file) => /theme\/preference/.test(read(file))).map(relative);
    expect(importers.sort()).toEqual(["src/app/layout.tsx", "src/components/theme-toggle.tsx"]);
  });

  it("writes one entry, under one key, holding only the word light or dark", () => {
    expect(source.match(/\.setItem\(/g)).toHaveLength(1);
    expect(source).toContain("window.localStorage.setItem(THEME_STORAGE_KEY, choice)");
    expect(source).toContain('export type ThemeChoice = "light" | "dark" | "system";');
    expect(source).toContain('if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);');
    // Every storage call names the theme key; none takes a computed key or enumerates the store.
    const calls = source.match(/localStorage\.\w+\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^localStorage\.(getItem|setItem|removeItem)\((THEME_STORAGE_KEY|"\$\{THEME_STORAGE_KEY\}")/);
    expect(source).not.toMatch(/localStorage\.(clear|key|length)\b|localStorage\[/);
  });

  it("starts from the system setting and never writes while the page loads", () => {
    expect(THEME_INIT_SCRIPT).toContain(`window.localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_INIT_SCRIPT).not.toMatch(/setItem|removeItem|cookie|fetch|XMLHttpRequest|sendBeacon|src=|import\(|https?:/);
    expect(THEME_STORAGE_KEY).toBe("close-desk-theme");
  });
});
