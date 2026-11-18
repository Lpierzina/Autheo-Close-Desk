import "@fontsource-variable/inter";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAuthConfig } from "@/server/auth/config";

export const metadata: Metadata = {
  title: { default: "Autheo Close Desk", template: "%s · Autheo Close Desk" },
  description: "Reconcile subscriptions, funding and approved allocations into a reviewed ownership register.",
  robots: { index: false, follow: false },
};

// Nothing is prerendered: every response depends on the signed-in user.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = getAuthConfig();
  const body = (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
  if (config.mode !== "clerk") return body;
  return (
    <ClerkProvider
      publishableKey={config.publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/accept-invitation"
      signInFallbackRedirectUrl="/offerings"
      signUpFallbackRedirectUrl="/offerings"
      afterSignOutUrl="/sign-in"
    >
      {body}
    </ClerkProvider>
  );
}
