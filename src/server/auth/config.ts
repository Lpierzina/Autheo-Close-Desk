export type AuthMode = "clerk" | "dev" | "closed";

export interface AuthConfig {
  mode: AuthMode;
  /** Why access is closed. Safe to show to an operator; never contains a secret. */
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
  if (!publishableKey || !secretKey) {
    return {
      mode: "closed",
      reason: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must both be set.",
    };
  }
  if (!/^pk_(test|live)_/.test(publishableKey) || !/^sk_(test|live)_/.test(secretKey)) {
    return { mode: "closed", reason: "The Clerk keys are not in the expected pk_/sk_ format." };
  }
  return { mode: "clerk", publishableKey, secretKey };
}

export function appBaseUrl(env: Env = process.env): string | null {
  const value = env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return value ? value : null;
}
