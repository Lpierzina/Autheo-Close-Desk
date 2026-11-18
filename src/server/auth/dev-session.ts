import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Local development identity. It exists so the app can be run and demonstrated without a
 * Clerk instance. It is unreachable in production: getAuthConfig() never returns "dev"
 * there, and every entry point below also refuses when NODE_ENV is "production".
 */
export const DEV_SESSION_COOKIE = "close_desk_dev_session";

function secret(): string {
  return process.env.CLOSE_DESK_DEV_AUTH_SECRET ?? "close-desk-local-development-only";
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex");
}

export function encodeDevSession(userId: string): string {
  if (process.env.NODE_ENV === "production") throw new Error("Development sessions are disabled in production.");
  return `${userId}.${sign(userId)}`;
}

export function decodeDevSession(value: string | undefined): string | null {
  if (process.env.NODE_ENV === "production" || !value) return null;
  const [userId, signature] = value.split(".");
  if (!userId || !signature) return null;
  const expected = Buffer.from(sign(userId), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return userId;
}
