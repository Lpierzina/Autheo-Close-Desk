import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { SessionIdentity } from "@/server/auth/identity";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://closedesk:closedesk@127.0.0.1:5432/closedesk_test";
if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'. Tests truncate every table.");
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

const session: { identity: SessionIdentity | null } = { identity: null };

// The identity provider boundary is the only thing replaced. Invitation checks, role
// checks, routes, services and PostgreSQL are all real.
vi.mock("@/server/auth/identity", () => ({
  getSessionIdentity: async () => session.identity,
}));

/** Simulates a provider session for a person whose email the provider has verified. */
export function signInAs(email: string | null, options: { verified?: boolean } = {}): void {
  session.identity = email
    ? {
        subject: `test|${email}`,
        loadProfile: async () => ({ verifiedEmails: options.verified === false ? [] : [email], displayName: null }),
      }
    : null;
}

const TABLES = [
  "audit_events",
  "snapshot_register_lines",
  "snapshots",
  "review_decisions",
  "source_records",
  "import_batches",
  "offering_members",
  "offerings",
  "app_users",
];

export function setupDatabase(): void {
  beforeAll(() => {
    execFileSync("node", [path.resolve(__dirname, "../../scripts/migrate.mjs")], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  });
  beforeEach(async () => {
    const { query } = await import("@/server/db");
    await query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    signInAs(null);
  });
  afterAll(async () => {
    const { closePool } = await import("@/server/db");
    await closePool();
  });
}

type RouteHandler = (request: NextRequest, context: { params: Promise<never> }) => Promise<Response>;

interface CallOptions {
  params?: Record<string, string>;
  search?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string | { filename: string; content: string | Uint8Array }>;
  headers?: Record<string, string>;
}

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

/** Invokes a route handler exactly as Next.js would, with a real Request. */
export async function call<T = Record<string, unknown>>(
  handler: unknown,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  options: CallOptions = {},
): Promise<ApiResult<T>> {
  const url = new URL("http://close-desk.test/api/test");
  for (const [k, v] of Object.entries(options.search ?? {})) url.searchParams.set(k, v);
  const init: { method: string; headers: Record<string, string>; body?: BodyInit } = {
    method,
    headers: { host: "close-desk.test", ...(method === "GET" ? {} : { origin: "http://close-desk.test" }), ...options.headers },
  };
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
    init.headers["content-type"] = "application/json";
  } else if (options.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.form)) {
      if (typeof value === "string") form.set(key, value);
      else form.set(key, new File([value.content as BlobPart], value.filename, { type: "text/csv" }));
    }
    init.body = form;
  }
  const response = await (handler as RouteHandler)(new NextRequest(url, init), {
    params: Promise.resolve((options.params ?? {}) as never),
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { status: response.status, body: body as T, text, headers: response.headers };
}
