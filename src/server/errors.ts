export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super(message, 401, "unauthenticated");
  }
}

/** Signed in with the identity provider, but not invited to this workspace. */
export class NotInvitedError extends AppError {
  constructor(message = "Your account has not been invited to Close Desk.") {
    super(message, 403, "not_invited");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") {
    super(message, 403, "forbidden");
  }
}

/** Also used when a user has no access to a resource, so its existence is not disclosed. */
export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, 404, "not_found");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "validation_failed", details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, "conflict", details);
  }
}

export class AuthConfigError extends AppError {
  constructor(message = "Authentication is not configured. Access is closed.") {
    super(message, 503, "auth_not_configured");
  }
}

/** What stands between the app and its database. Each one maps to a single fix an operator can make. */
export type DatabaseProblem = "not_configured" | "invalid_url" | "unreachable" | "tls" | "login_refused" | "schema_missing";

/**
 * The database is not configured, cannot be reached or has no schema, so nothing was read
 * or written. The message names variables and commands only; it never contains a value.
 */
export class DatabaseUnavailableError extends AppError {
  constructor(
    readonly problem: DatabaseProblem,
    message: string,
  ) {
    super(message, 503, "database_unavailable", { problem });
  }
}
