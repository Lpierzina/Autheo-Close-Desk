import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutControl } from "@/components/sign-out";
import { getAuthConfig } from "@/server/auth/config";
import { pageUser } from "@/server/page";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await pageUser();
  const mode = getAuthConfig().mode === "dev" ? "dev" : "clerk";
  return (
    <div className="min-h-screen lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-navy-900 px-4 py-3 lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:px-3 lg:py-5">
        <Link href="/offerings" className="rounded-md lg:mb-7 lg:px-2.5" aria-label="Autheo Close Desk, offerings">
          <Brand />
        </Link>
        <SidebarNav isAdmin={user.isAdmin} />
        <div className="ml-auto flex items-center gap-3 lg:ml-0 lg:mt-auto lg:block lg:border-t lg:border-white/10 lg:pt-4">
          <div className="hidden px-2.5 lg:block">
            <p className="truncate text-[13px] font-medium text-white">{user.displayName ?? user.email}</p>
            <p className="truncate text-xs text-navy-300">{user.email}</p>
            <p className="mt-1 text-xs text-navy-300">{user.isAdmin ? "Workspace administrator" : "Member"}</p>
          </div>
          <div className="lg:mt-3">
            <SignOutControl mode={mode} variant="sidebar" />
          </div>
          {mode === "dev" ? (
            <p className="hidden px-2.5 pt-3 text-[11px] leading-snug text-warn-line lg:block">
              Local development identity. Not available in production.
            </p>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1480px] px-5 py-7 outline-none sm:px-8 lg:py-9">
        {children}
      </main>
    </div>
  );
}
