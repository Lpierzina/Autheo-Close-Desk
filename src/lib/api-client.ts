export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Calls the app's own API and turns an error response into an ApiError with a readable message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("The server could not be reached. Check your connection and try again.", 0, "network", null);
  }
  const text = await response.text();
  let body: { error?: { code?: string; message?: string; details?: unknown } } & Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON error page.
  }
  if (!response.ok) {
    const fallback =
      response.status === 401
        ? "Your session has ended. Sign in again."
        : response.status === 413
          ? "The file is larger than the import limit."
          : "Something went wrong. Nothing was changed. Try again.";
    throw new ApiError(body.error?.message ?? fallback, response.status, body.error?.code ?? "error", body.error?.details ?? null);
  }
  return body as T;
}
