import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { DEV_SESSION_COOKIE, decodeDevSession } from "@/server/auth/dev-session";

/**
 * First line of defence. Every page, API route and download also authorises on the
 * server (see src/server/auth), so nothing depends on this file alone.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/accept-invitation(.*)", "/api/health"]);
const isDevPublicRoute = createRouteMatcher(["/dev/sign-in", "/api/dev/session", "/api/health"]);

function unauthenticatedApi(): NextResponse {
  return NextResponse.json(
    { error: { code: "unauthenticated", message: "Sign in to continue.", details: null } },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

const clerk = clerkMiddleware(
  async (auth, request) => {
    if (isPublicRoute(request)) return;
    const { userId, redirectToSignIn } = await auth();
    if (userId) return;
    if (request.nextUrl.pathname.startsWith("/api/")) return unauthenticatedApi();
    return redirectToSignIn({ returnBackUrl: request.url });
  },
  // Clerk reads CLERK_SECRET_KEY from the environment itself. Only non-secret options are passed here.
  () => ({
    publishableKey: getAuthConfig().publishableKey,
    signInUrl: "/sign-in",
    signUpUrl: "/accept-invitation",
  }),
);

let loggedClosedReason: string | undefined;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const config = getAuthConfig();

  if (config.mode === "closed") {
    // Fail closed: without a complete authentication configuration nothing is served.
    // The reason names environment variables only, so a deploy log shows what to fix.
    if (config.reason !== loggedClosedReason) {
      loggedClosedReason = config.reason;
      console.error(`[auth] Serving 503 on every route: ${config.reason}`);
    }
    if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
    return new NextResponse(`Autheo Close Desk is unavailable: authentication is not configured. ${config.reason}`, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (config.mode === "dev") {
    if (isDevPublicRoute(request)) return NextResponse.next();
    if (decodeDevSession(request.cookies.get(DEV_SESSION_COOKIE)?.value)) return NextResponse.next();
    if (request.nextUrl.pathname.startsWith("/api/")) return unauthenticatedApi();
    return NextResponse.redirect(new URL("/dev/sign-in", request.url));
  }

  return clerk(request, event);
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)",
    "/(api)(.*)",
  ],
};
