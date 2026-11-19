"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isEmptySession } from "@/session/engine";
import { useSession } from "@/session/store";
import { Brand } from "./brand";
import { cx } from "./ui";

const NAV = [
  { href: "/reconcile", label: "Reconcile" },
  { href: "/guide", label: "File guide" },
] as const;

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function SiteHeader() {
  const pathname = usePathname();
  const { state } = useSession();
  const inProgress = !isEmptySession(state);

  return (
    <header className="bg-navy-900 text-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link prefetch={false} href="/" aria-label="Autheo Close Desk home" className="rounded-md focus-visible:outline-white">
          <Brand tone="dark" />
        </Link>
        <nav aria-label="Primary" className="ml-auto">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = matches(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    prefetch={false}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-white",
                      active ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {item.label}
                    {item.href === "/reconcile" && inProgress && !active ? (
                      <span className="rounded-full bg-white/10 px-1.5 py-px text-[11px] font-medium text-white ring-1 ring-white/20">In progress</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2/60">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-5 text-xs text-ink-3 sm:px-6">
        <p className="max-w-3xl">
          Autheo Close Desk is an off-chain reconciliation tool. It produces a reviewed register export for your administrator, not the official legal
          register, and it never moves money, issues units or initiates a refund.
        </p>
        <ul className="flex items-center gap-4">
          <li>
            <Link prefetch={false} href="/guide" className="rounded underline-offset-2 hover:text-ink hover:underline">
              File guide
            </Link>
          </li>
          <li>
            <Link prefetch={false} href="/tokenization" className="rounded underline-offset-2 hover:text-ink hover:underline">
              Custom tokenization
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
