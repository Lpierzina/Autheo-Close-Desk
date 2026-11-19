export type AuthMode = "clerk" | "dev" | "closed";

export interface AuthConfig {
  mode: AuthMode;
  /** Why access is closed. Names variables and expected prefixes only; never contains a value. */
  reason?: string;
  publishableKey?: string;
  secretKey?: string;
}

type Env = Record<string, string | undefined>;

/**
 * Resolves how requests are authenticated. Anything short of a complete Clerk
 * configuration closes the app: there is no anonymous or default-user mode.
 *
 * The local development identity is honoured only outside production and only when
 * CLOSE_DESK_DEV_AUTH=1 is set explicitly. Setting it in production closes the app.
 */
export function getAuthConfig(env: Env = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  const devRequested = env.CLOSE_DESK_DEV_AUTH === "1";
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();

  if (devRequested) {
    if (production) {
      return { mode: "closed", reason: "CLOSE_DESK_DEV_AUTH is set in production. Remove it and configure Clerk." };
    }
    return { mode: "dev" };
  }
  const missing = [
    publishableKey ? null : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    secretKey ? null : "CLERK_SECRET_KEY",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    return {
      mode: "closed",
      reason: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set in the runtime environment.`,
    };
  }
  // Report the variable name and the expected prefix only. The value is never echoed.
  const malformed = [
    /^pk_(test|live)_/.test(publishableKey ?? "") ? null : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_.",
    /^sk_(test|live)_/.test(secretKey ?? "") ? null : "CLERK_SECRET_KEY must start with sk_test_ or sk_live_.",
  ].filter((problem): problem is string => problem !== null);
  if (malformed.length > 0) return { mode: "closed", reason: malformed.join(" ") };
  return { mode: "clerk", publishableKey, secretKey };
}

export function appBaseUrl(env: Env = process.env): string | null {
  const value = env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return value ? value : null;
}
