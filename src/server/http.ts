import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { MAX_IMPORT_BYTES } from "@/domain/csv";
import { AppError, ForbiddenError, ValidationError } from "./errors";

const NO_STORE = { "Cache-Control": "no-store, private" };

export function json(data: unknown, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(data, { status: init.status ?? 200, headers: NO_STORE });
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details ?? null } },
      { status: error.status, headers: NO_STORE },
    );
  }
  // Log the error class only. Messages and stacks can carry row content.
  console.error(`[api] unhandled ${error instanceof Error ? error.name : "error"}`);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong. Nothing was changed. Try again.", details: null } },
    { status: 500, headers: NO_STORE },
  );
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin (or
 * Sec-Fetch-Site) on these; a request from another site is refused before any work is done.
 */
function assertSameOrigin(request: NextRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new ForbiddenError("Cross-site requests are not allowed.");
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Cross-site requests are not allowed.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Cross-site requests are not allowed.");
}

type Handler<Params> = (request: NextRequest, params: Params) => Promise<Response>;

/** Wraps a route handler with the same-origin check and uniform error responses. */
export function route<Params = Record<string, never>>(handler: Handler<Params>) {
  return async (request: NextRequest, context: { params: Promise<Params> }): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler(request, await context.params);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ValidationError("The request body is not valid JSON.");
}

export interface Upload {
  file: { filename: string; bytes: Uint8Array };
  fields: Record<string, string>;
}

/** Reads a multipart upload into memory. Files are never written to the host filesystem. */
export async function readUpload(request: NextRequest): Promise<Upload> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMPORT_BYTES + 256 * 1024) {
    throw new AppError("The upload is larger than the import limit.", 413, "payload_too_large");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("The upload could not be read. Choose the CSV file again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Choose a CSV file to upload.");
  if (file.size > MAX_IMPORT_BYTES) {
    throw new AppError("The file is larger than the import limit.", 413, "payload_too_large");
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return { file: { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, fields };
}

export function csvDownload(filename: string, content: string, sha256: string): Response {
  return new Response(content, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "X-Content-SHA256": sha256,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
