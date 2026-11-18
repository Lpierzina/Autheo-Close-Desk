"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Building2, Users } from "lucide-react";
import { cx } from "./ui";

const ITEMS = [
  { href: "/offerings", label: "Offerings", icon: Building2, adminOnly: false },
  { href: "/guide", label: "File guide", icon: BookOpen, adminOnly: false },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
] as const;

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary">
      <ul className="flex gap-1 lg:flex-col">
        {ITEMS.filter((item) => !item.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon aria-hidden className={cx("h-4 w-4", active ? "text-white" : "text-navy-300")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
