import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthConfig } from "@/server/auth/config";
import { decodeDevSession, encodeDevSession } from "@/server/auth/dev-session";

const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder", CLERK_SECRET_KEY: "sk_live_placeholder" };

describe("authentication configuration fails closed", () => {
  it("serves nothing when Clerk is not configured", () => {
    expect(getAuthConfig({ NODE_ENV: "production" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "development" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "production", CLERK_SECRET_KEY: "sk_live_x" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: " ", CLERK_SECRET_KEY: "" }).mode).toBe("closed");
  });

  it("rejects keys that are placeholders or swapped", () => {
    expect(getAuthConfig({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "your-key-here", CLERK_SECRET_KEY: "changeme" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_x", CLERK_SECRET_KEY: "pk_live_x" }).mode).toBe("closed");
  });

  it("says which variable to fix without echoing any value", () => {
    const reason = (env: Record<string, string>) => getAuthConfig({ NODE_ENV: "production", ...env }).reason;
    expect(reason({})).toBe("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are not set in the runtime environment.");
    expect(reason({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x" })).toBe("CLERK_SECRET_KEY is not set in the runtime environment.");
    expect(reason({ CLERK_SECRET_KEY: "sk_live_x" })).toBe("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set in the runtime environment.");
    expect(reason({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x", CLERK_SECRET_KEY: "hunter2-not-a-key" })).toBe(
      "CLERK_SECRET_KEY must start with sk_test_ or sk_live_.",
    );
    const swapped = reason({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_SECRETVALUE", CLERK_SECRET_KEY: "pk_live_PUBLICVALUE" });
    expect(swapped).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with");
    expect(swapped).toContain("CLERK_SECRET_KEY must start with");
    expect(swapped).not.toContain("SECRETVALUE");
    expect(swapped).not.toContain("PUBLICVALUE");
    expect(reason({ CLOSE_DESK_DEV_AUTH: "1", ...CLERK })).toContain("CLOSE_DESK_DEV_AUTH is set in production");
  });

  it("uses Clerk when both keys are present", () => {
    expect(getAuthConfig({ NODE_ENV: "production", ...CLERK })).toMatchObject({ mode: "clerk", publishableKey: "pk_live_placeholder" });
  });

  it("never honours the development identity in production, even alongside valid Clerk keys", () => {
    expect(getAuthConfig({ NODE_ENV: "production", CLOSE_DESK_DEV_AUTH: "1" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "production", CLOSE_DESK_DEV_AUTH: "1", ...CLERK }).mode).toBe("closed");
  });

  it("allows the development identity only when asked for explicitly outside production", () => {
    expect(getAuthConfig({ NODE_ENV: "development", CLOSE_DESK_DEV_AUTH: "1" }).mode).toBe("dev");
    expect(getAuthConfig({ NODE_ENV: "development", CLOSE_DESK_DEV_AUTH: "true" }).mode).toBe("closed");
    expect(getAuthConfig({ NODE_ENV: "development", CLOSE_DESK_DEV_AUTH: "0", ...CLERK }).mode).toBe("clerk");
  });
});

describe("development session cookie", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a signed value and rejects tampering", () => {
    vi.stubEnv("NODE_ENV", "development");
    const id = "3f0c2a9e-7d1b-4c55-9a51-2b7f0c1d9e10";
    const cookie = encodeDevSession(id);
    expect(decodeDevSession(cookie)).toBe(id);
    expect(decodeDevSession(cookie.replace(id, "00000000-0000-4000-8000-000000000000"))).toBeNull();
    expect(decodeDevSession(`${id}.forged`)).toBeNull();
    expect(decodeDevSession(undefined)).toBeNull();
  });

  it("is refused in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = encodeDevSession("3f0c2a9e-7d1b-4c55-9a51-2b7f0c1d9e10");
    vi.stubEnv("NODE_ENV", "production");
    expect(decodeDevSession(cookie)).toBeNull();
    expect(() => encodeDevSession("3f0c2a9e-7d1b-4c55-9a51-2b7f0c1d9e10")).toThrow();
  });
});
