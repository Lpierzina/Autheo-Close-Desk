import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { SessionProvider } from "@/session/store";
import policy from "../../security-headers.json";

export const metadata: Metadata = {
  title: { default: "Autheo Close Desk", template: "%s · Autheo Close Desk" },
  description:
    "Reconcile your apartment equity raise before closing. Compare subscription, funding and allocation files in your browser and download a reviewed ownership register for your administrator.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Shipped in the page itself, so it applies on any static host: scripts, styles, fonts and
 * requests are limited to this site, and nothing on the page can post a form anywhere.
 * `next dev` needs eval and a websocket for hot reload, so the policy is production-only.
 */
const contentSecurityPolicy = policy.contentSecurityPolicy.join("; ");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>{process.env.NODE_ENV === "production" ? <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} /> : null}</head>
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow"
        >
          Skip to content
        </a>
        <SessionProvider>
          <SiteHeader />
          <div id="main" className="flex-1">
            {children}
          </div>
          <SiteFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
