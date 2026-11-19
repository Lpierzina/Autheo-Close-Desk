import { DatabaseUnavailableError, type DatabaseProblem } from "./errors";

/**
 * What is wrong and what to change, for each database problem. Shown to signed-in users
 * and written to the server log, so the text names variables and commands and never a
 * host, user, password or database name.
 */
export const DATABASE_PROBLEMS: Record<DatabaseProblem, { summary: string; fix: string }> = {
  not_configured: {
    summary: "DATABASE_URL is not set in the runtime environment.",
    fix: "Add DATABASE_URL, the PostgreSQL connection URL, to the deployment's environment variables, make it available at runtime, then redeploy.",
  },
  invalid_url: {
    summary: "DATABASE_URL is not a valid PostgreSQL connection URL.",
    fix: "Use the form postgres://USER:PASSWORD@HOST:5432/DATABASE and percent-encode special characters in the password.",
  },
  unreachable: {
    summary: "The database server did not accept a connection.",
    fix: "Check the host and port in DATABASE_URL, that the database is running, and that it accepts connections from this deployment.",
  },
  tls: {
    summary: "The TLS handshake with the database failed.",
    fix: "Set DATABASE_SSL to match the database provider: require (TLS, certificate verified), no-verify (TLS, certificate not verified) or disable (no TLS).",
  },
  login_refused: {
    summary: "The database refused the login in DATABASE_URL.",
    fix: "Check the user, password and database name in DATABASE_URL. If the provider only accepts TLS connections, also set DATABASE_SSL=require.",
  },
  schema_missing: {
    summary: "The database is reachable, but the Close Desk tables are missing or out of date.",
    fix: "Run npm run db:migrate against this database. The app never migrates on its own.",
  },
};

const SQLSTATE: Record<string, DatabaseProblem> = {
  "42P01": "schema_missing", // undefined_table
  "42703": "schema_missing", // undefined_column
  "28P01": "login_refused", // invalid_password
  "28000": "login_refused", // invalid_authorization_specification, including pg_hba.conf rejections
  "3D000": "login_refused", // invalid_catalog_name: the database named in the URL does not exist
};

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);

const CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
]);

// The driver raises these without a code.
const DRIVER_MESSAGES: Record<string, DatabaseProblem> = {
  "The server does not support SSL connections": "tls",
  "There was an error establishing an SSL connection": "tls",
  "Connection terminated due to connection timeout": "unreachable",
  "timeout exceeded when trying to connect": "unreachable",
  "Connection terminated unexpectedly": "unreachable",
};

/**
 * The driver or system code behind a failure, such as 42P01 or ECONNREFUSED. Codes are
 * safe to log. Messages are not: they can carry the host, the user or statement text.
 */
export function databaseErrorCode(error: unknown): string | null {
  if (error instanceof DatabaseUnavailableError) return null;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : null;
}

/** Maps a failure to something an operator can fix, or null when it is not a setup or availability problem. */
export function classifyDatabaseError(error: unknown): DatabaseProblem | null {
  if (error instanceof DatabaseUnavailableError) return error.problem;
  const code = databaseErrorCode(error);
  if (code) {
    if (SQLSTATE[code]) return SQLSTATE[code];
    if (NETWORK_CODES.has(code)) return "unreachable";
    if (CERTIFICATE_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_")) return "tls";
    if (code === "ERR_INVALID_URL") return "invalid_url";
  }
  const message = error instanceof Error ? error.message : "";
  return DRIVER_MESSAGES[message] ?? null;
}

export function databaseUnavailable(problem: DatabaseProblem): DatabaseUnavailableError {
  const { summary, fix } = DATABASE_PROBLEMS[problem];
  return new DatabaseUnavailableError(problem, `${summary} ${fix}`);
}
