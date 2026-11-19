import { NextResponse } from "next/server";
import { getAuthConfig } from "@/server/auth/config";

export const dynamic = "force-dynamic";

/** Liveness only. Reports no data and reveals nothing beyond whether authentication is configured. */
export function GET() {
  const mode = getAuthConfig().mode;
  return NextResponse.json(
    mode === "closed" ? { status: "closed", reason: "auth_not_configured" } : { status: "ok" },
    { status: mode === "closed" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
