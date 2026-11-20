import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import faviconDark from "@/assets/brand/favicon-dark.png";
import faviconLight from "@/assets/brand/favicon-light.png";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { SessionProvider } from "@/session/store";
import { THEME_INIT_SCRIPT } from "@/theme/preference";
import policy from "../../security-headers.json";

export const metadata: Metadata = {
  title: { default: "Autheo Close Desk", template: "%s · Autheo Close Desk" },
  description:
    "Reconcile your apartment equity raise before closing. Compare subscription, funding and allocation files in your browser and download a reviewed ownership register for your administrator.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  // The Autheo logomark. The tab strip follows the system setting, not the theme chosen in the app.
  icons: {
    icon: [
      { url: faviconDark.src, type: "image/png", sizes: "96x96", media: "(prefers-color-scheme: dark)" },
      { url: faviconLight.src, type: "image/png", sizes: "96x96", media: "(prefers-color-scheme: light)" },
    ],
  },
};

/**
 * Shipped in the page itself, so it applies on any static host: scripts, styles, fonts and
 * requests are limited to this site, and nothing on the page can post a form anywhere.
 * `next dev` needs eval and a websocket for hot reload, so the policy is production-only.
 */
const contentSecurityPolicy = policy.contentSecurityPolicy.join("; ");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "production" ? <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} /> : null}
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
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
