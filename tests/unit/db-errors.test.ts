import { describe, expect, it } from "vitest";
import { DATABASE_PROBLEMS, classifyDatabaseError, databaseErrorCode, databaseUnavailable } from "@/server/db-errors";
import { DatabaseUnavailableError } from "@/server/errors";

/** Builds an error the way the pg driver and Node raise them: a message plus a code. */
function failure(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

describe("database failures are mapped to something an operator can fix", () => {
  it("recognises a database that was never migrated", () => {
    expect(classifyDatabaseError(failure('relation "app_users" does not exist', "42P01"))).toBe("schema_missing");
    expect(classifyDatabaseError(failure('column "activated_at" does not exist', "42703"))).toBe("schema_missing");
  });

  it("recognises a server that cannot be reached", () => {
    expect(classifyDatabaseError(failure("connect ECONNREFUSED 10.0.0.5:5432", "ECONNREFUSED"))).toBe("unreachable");
    expect(classifyDatabaseError(failure("getaddrinfo ENOTFOUND db.internal", "ENOTFOUND"))).toBe("unreachable");
    expect(classifyDatabaseError(failure("Connection terminated due to connection timeout"))).toBe("unreachable");
    expect(classifyDatabaseError(failure("timeout exceeded when trying to connect"))).toBe("unreachable");
    // Node raises an AggregateError with an empty message when a name resolves to several addresses.
    const aggregate = Object.assign(new AggregateError([failure("a", "ECONNREFUSED"), failure("b", "ECONNREFUSED")], ""), { code: "ECONNREFUSED" });
    expect(classifyDatabaseError(aggregate)).toBe("unreachable");
  });

  it("recognises a refused login and a database that does not exist", () => {
    expect(classifyDatabaseError(failure('password authentication failed for user "closedesk"', "28P01"))).toBe("login_refused");
    expect(classifyDatabaseError(failure('no pg_hba.conf entry for host "10.0.0.9", no encryption', "28000"))).toBe("login_refused");
    expect(classifyDatabaseError(failure('database "closedesk" does not exist', "3D000"))).toBe("login_refused");
  });

  it("recognises a TLS mismatch in either direction", () => {
    expect(classifyDatabaseError(failure("self-signed certificate", "DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe("tls");
    expect(classifyDatabaseError(failure("self-signed certificate in certificate chain", "SELF_SIGNED_CERT_IN_CHAIN"))).toBe("tls");
    expect(classifyDatabaseError(failure("Hostname/IP does not match certificate's altnames", "ERR_TLS_CERT_ALTNAME_INVALID"))).toBe("tls");
    expect(classifyDatabaseError(failure("The server does not support SSL connections"))).toBe("tls");
  });

  it("recognises a connection URL that cannot be parsed", () => {
    expect(classifyDatabaseError(Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" }))).toBe("invalid_url");
  });

  it("leaves every other failure alone", () => {
    expect(classifyDatabaseError(failure('duplicate key value violates unique constraint "app_users_email_key"', "23505"))).toBeNull();
    expect(classifyDatabaseError(failure("source records cannot be changed", "P0001"))).toBeNull();
    expect(classifyDatabaseError(new Error("something else"))).toBeNull();
    expect(classifyDatabaseError("not an error")).toBeNull();
    expect(classifyDatabaseError(null)).toBeNull();
  });

  it("keeps the problem of an error that was already explained", () => {
    expect(classifyDatabaseError(databaseUnavailable("not_configured"))).toBe("not_configured");
  });
});

describe("what is reported about a database failure", () => {
  it("is a 503 that names the fix", () => {
    const error = databaseUnavailable("schema_missing");
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ status: 503, code: "database_unavailable", problem: "schema_missing", details: { problem: "schema_missing" } });
    expect(error.message).toContain("npm run db:migrate");
    expect(databaseUnavailable("not_configured").message).toContain("DATABASE_URL is not set in the runtime environment.");
  });

  it("has a summary and a fix for every problem", () => {
    for (const { summary, fix } of Object.values(DATABASE_PROBLEMS)) {
      expect(summary.length).toBeGreaterThan(20);
      expect(fix.length).toBeGreaterThan(20);
    }
  });

  it("takes only a code from the driver error, never its message", () => {
    expect(databaseErrorCode(failure('password authentication failed for user "closedesk"', "28P01"))).toBe("28P01");
    expect(databaseErrorCode(failure("connect ECONNREFUSED 10.0.0.5:5432", "ECONNREFUSED"))).toBe("ECONNREFUSED");
    expect(databaseErrorCode(failure("no code"))).toBeNull();
    expect(databaseErrorCode(Object.assign(new Error("odd"), { code: "postgres://user:secret@host/db" }))).toBeNull();
    expect(databaseErrorCode(Object.assign(new Error("odd"), { code: 42 }))).toBeNull();
    expect(databaseErrorCode(databaseUnavailable("unreachable"))).toBeNull();
  });
});
