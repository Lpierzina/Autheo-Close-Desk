import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/server/auth/access";
import { getAuthConfig } from "@/server/auth/config";
import { DEV_SESSION_COOKIE, encodeDevSession } from "@/server/auth/dev-session";
import { queryOne } from "@/server/db";

/**
 * Local development sign-in. Responds 404 unless the app runs outside production with
 * CLOSE_DESK_DEV_AUTH=1. It still only signs in users that already exist in the database.
 */
function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && getAuthConfig().mode === "dev";
}

export async function POST(request: NextRequest) {
  if (!enabled()) return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");
  const user = isUuid(userId)
    ? await queryOne<{ id: string }>("SELECT id FROM app_users WHERE id = $1 AND status <> 'disabled'", [userId])
    : null;
  if (!user) return NextResponse.redirect(new URL("/dev/sign-in?error=unknown-user", request.url), 303);
  const response = NextResponse.redirect(new URL("/offerings", request.url), 303);
  response.cookies.set(DEV_SESSION_COOKIE, encodeDevSession(user.id), { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}

export async function DELETE() {
  if (!enabled()) return new NextResponse("Not found", { status: 404 });
  const response = NextResponse.json({ signedOut: true });
  response.cookies.delete(DEV_SESSION_COOKIE);
  return response;
}
