import { NextRequest, type NextFetchEvent } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A well-formed development publishable key for a Clerk instance that does not exist. A
// signed-out request is decided without any call to Clerk.
const PUBLISHABLE_KEY = `pk_test_${Buffer.from("close-desk-tests.clerk.accounts.dev$").toString("base64")}`;

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;

describe("the request proxy behind a reverse proxy", () => {
  let proxy: (request: NextRequest, event: NextFetchEvent) => Response | Promise<Response | null | undefined> | null | undefined;

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_close_desk_tests_only");
    vi.stubEnv("CLOSE_DESK_DEV_AUTH", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED", "1");
    proxy = (await import("@/proxy")).default as typeof proxy;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  /** What the server sees on a host that forwards requests to an internal port, as Shadw does. */
  function forwarded(path: string): NextRequest {
    return new NextRequest(`https://localhost:38683${path}`, {
      headers: { host: "close-desk.example.test", "x-forwarded-host": "close-desk.example.test", "x-forwarded-proto": "https" },
    });
  }

  it("sends a signed-out visitor to sign-in with a return address on the public host", async () => {
    const response = await proxy(forwarded("/offerings/abc/reconciliation?filter=review"), event);
    expect(response?.status).toBe(307);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://close-desk.example.test/sign-in");
    expect(location.searchParams.get("redirect_url")).toBe("https://close-desk.example.test/offerings/abc/reconciliation?filter=review");
  });

  it("answers a signed-out API request with 401 instead of a redirect", async () => {
    const response = await proxy(forwarded("/api/offerings"), event);
    expect(response?.status).toBe(401);
  });
});
