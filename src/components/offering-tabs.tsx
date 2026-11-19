"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export interface OfferingTab {
  segment: string;
  label: string;
  badge?: { count: number; tone: "warn" | "danger"; label: string } | null;
}

export function OfferingTabs({ offeringId, tabs }: { offeringId: string; tabs: OfferingTab[] }) {
  const pathname = usePathname();
  const base = `/offerings/${offeringId}`;
  return (
    <nav aria-label="Offering" className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.segment ? pathname.startsWith(href) : pathname === base;
          return (
            <li key={tab.segment}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink",
                )}
              >
                {tab.label}
                {tab.badge && tab.badge.count > 0 ? (
                  <span
                    className={cx(
                      "num rounded-full border px-1.5 text-[11px] font-semibold leading-[18px]",
                      tab.badge.tone === "danger" ? "border-danger-line bg-danger-soft text-danger" : "border-warn-line bg-warn-soft text-warn",
                    )}
                  >
                    {tab.badge.count}
                    <span className="sr-only"> {tab.badge.label}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
