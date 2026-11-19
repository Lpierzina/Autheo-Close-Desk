import "server-only";
import { AuthConfigError } from "../errors";
import { queryOne } from "../db";
import { getAuthConfig } from "./config";
import { DEV_SESSION_COOKIE, decodeDevSession } from "./dev-session";

export interface SessionProfile {
  /** Email addresses the identity provider has verified. Unverified addresses are never used. */
  verifiedEmails: string[];
  displayName: string | null;
}

export interface SessionIdentity {
  /** Stable subject from the identity provider. */
  subject: string;
  loadProfile(): Promise<SessionProfile>;
}

async function clerkIdentity(): Promise<SessionIdentity | null> {
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return null;
  return {
    subject: userId,
    async loadProfile() {
      const user = await currentUser();
      if (!user || user.id !== userId) return { verifiedEmails: [], displayName: null };
      const verifiedEmails = user.emailAddresses
        .filter((address) => address.verification?.status === "verified")
        .map((address) => address.emailAddress.toLowerCase());
      const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null;
      return { verifiedEmails, displayName };
    },
  };
}

async function devIdentity(): Promise<SessionIdentity | null> {
  if (process.env.NODE_ENV === "production") return null;
  const { cookies } = await import("next/headers");
  const userId = decodeDevSession((await cookies()).get(DEV_SESSION_COOKIE)?.value);
  if (!userId) return null;
  return {
    subject: `dev:${userId}`,
    async loadProfile() {
      const row = await queryOne<{ email: string; display_name: string | null }>(
        "SELECT email, display_name FROM app_users WHERE id = $1",
        [userId],
      );
      return row ? { verifiedEmails: [row.email], displayName: row.display_name } : { verifiedEmails: [], displayName: null };
    },
  };
}

/** Returns the signed-in identity, or null when there is no session. Throws when auth is not configured. */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const config = getAuthConfig();
  if (config.mode === "closed") throw new AuthConfigError();
  return config.mode === "clerk" ? clerkIdentity() : devIdentity();
}
