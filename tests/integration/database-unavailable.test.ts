import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_PROBLEMS } from "@/server/db-errors";
import type { DatabaseProblem } from "@/server/errors";
import { call, setupDatabase, signInAs } from "../support/app";

/**
 * A signed-in request against a database that is not configured, not reachable or not
 * migrated. Only the identity provider is replaced; the route, the pool and PostgreSQL are real.
 */
const WORKING_URL = process.env.DATABASE_URL as string;
const SECRET = "s3cret-Passw0rd-never-shown";
const MISSING_DATABASE = "close_desk_test_never_created";

function logLine(problem: DatabaseProblem, code?: string): string {
  const { summary, fix } = DATABASE_PROBLEMS[problem];
  return `[db] Database unavailable (${code ? `${problem}, ${code}` : problem}): ${summary} ${fix}`;
}

function variant(change: (url: URL) => void): string {
  const url = new URL(WORKING_URL);
  change(url);
  return url.toString();
}

interface ErrorBody {
  error: { code: string; message: string; details: { problem: string } | null };
}

async function listOfferings() {
  const { closePool } = await import("@/server/db");
  await closePool();
  const route = await import("@/app/api/offerings/route");
  signInAs("avery.admin@closedesk.example");
  return call<ErrorBody>(route.GET, "GET");
}

describe("a database that cannot be used says what to fix", () => {
  setupDatabase();
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.DATABASE_URL = WORKING_URL;
    const { closePool } = await import("@/server/db");
    await closePool();
  });

  it("names DATABASE_URL when it is not set", async () => {
    delete process.env.DATABASE_URL;
    const result = await listOfferings();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({ code: "database_unavailable", details: { problem: "not_configured" } });
    expect(result.body.error.message).toContain("DATABASE_URL is not set in the runtime environment.");
    expect(logged).toEqual([logLine("not_configured")]);
  });

  it("asks for the migration when the tables do not exist", async () => {
    // Same server and login, but a search path with no tables in it: what a database looks like before db:migrate.
    process.env.DATABASE_URL = variant((url) => url.searchParams.set("options", "-c search_path=close_desk_not_migrated"));
    const result = await listOfferings();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({ code: "database_unavailable", details: { problem: "schema_missing" } });
    expect(result.body.error.message).toContain("npm run db:migrate");
    expect(logged).toEqual([logLine("schema_missing", "42P01")]);
  });

  it("reports an unreachable server without echoing the connection URL", async () => {
    process.env.DATABASE_URL = variant((url) => {
      url.port = "1";
      url.password = SECRET;
    });
    const result = await listOfferings();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({ code: "database_unavailable", details: { problem: "unreachable" } });
    expect(logged).toEqual([logLine("unreachable", "ECONNREFUSED")]);
    expect(result.text).not.toContain(SECRET);
  });

  it("reports a refused login without repeating what the server said", async () => {
    process.env.DATABASE_URL = variant((url) => {
      url.pathname = `/${MISSING_DATABASE}`;
    });
    const result = await listOfferings();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({ code: "database_unavailable", details: { problem: "login_refused" } });
    // The server's own message names the database. Only its code is kept.
    expect(logged).toEqual([logLine("login_refused", "3D000")]);
    expect(result.text).not.toContain(MISSING_DATABASE);
  });

  it("serves normally again once the database answers", async () => {
    const result = await listOfferings();
    // The schema exists and this person was never invited, so the answer is the usual refusal, not a 503.
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe("not_invited");
  });
});
