"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isEmptySession } from "@/session/engine";
import { useSession } from "@/session/store";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui";

/** On the narrowest phones only the workspace link stays in the header; the file guide is still in the footer. */
const NAV = [
  { href: "/reconcile", label: "Reconcile", compact: true },
  { href: "/guide", label: "File guide", compact: false },
] as const;

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function SiteHeader() {
  const pathname = usePathname();
  const { state } = useSession();
  const inProgress = !isEmptySession(state);

  return (
    <header className="border-b border-line bg-header">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-1.5 px-3 sm:gap-4 sm:px-6">
        <Link prefetch={false} href="/" aria-label="Autheo Close Desk home" className="shrink-0 rounded-md">
          <Brand />
        </Link>
        <nav aria-label="Primary" className="ml-auto">
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {NAV.map((item) => {
              const active = matches(pathname, item.href);
              return (
                <li key={item.href} className={item.compact ? undefined : "max-[359px]:hidden"}>
                  <Link
                    prefetch={false}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-[13px] font-medium transition-colors sm:gap-2 sm:px-3",
                      active ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
                    )}
                  >
                    {item.label}
                    {item.href === "/reconcile" && inProgress && !active ? (
                      <span className="flex items-center rounded-full text-[11px] font-medium text-accent-strong sm:border sm:border-accent-line sm:bg-accent-soft sm:px-1.5 sm:py-px">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent sm:hidden" />
                        <span className="sr-only sm:not-sr-only">In progress</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <ThemeToggle />
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
