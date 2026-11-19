import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadText, liveDownloadCount, revokeDownloads } from "@/lib/download";

describe("downloads are built in memory and their references can be dropped", () => {
  const clicked: { href: string; download: string }[] = [];
  let created: string[] = [];
  let revoked: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    revoked = [];
    clicked.length = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/${created.length + 1}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
    const anchor = () => {
      const element = { href: "", download: "", rel: "", style: {} as Record<string, string>, click: () => clicked.push({ href: element.href, download: element.download }), remove: () => undefined };
      return element;
    };
    vi.stubGlobal("document", { createElement: anchor, body: { appendChild: () => undefined } });
    vi.stubGlobal("window", { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) });
  });

  afterEach(() => {
    revokeDownloads();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the browser a blob URL under the given file name", () => {
    downloadText("register.csv", "a,b\r\n1,2\r\n");
    expect(clicked).toEqual([{ href: "blob:test/1", download: "register.csv" }]);
    expect(liveDownloadCount()).toBe(1);
  });

  it("Clear session releases every reference still held", () => {
    downloadText("register.csv", "a");
    downloadText("exceptions.csv", "b");
    revokeDownloads();
    expect(revoked).toEqual(["blob:test/1", "blob:test/2"]);
    expect(liveDownloadCount()).toBe(0);
  });

  it("releases a reference by itself after a minute, and only once", () => {
    downloadText("register.csv", "a");
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual(["blob:test/1"]);
    revokeDownloads();
    expect(revoked).toEqual(["blob:test/1"]);
  });
});
