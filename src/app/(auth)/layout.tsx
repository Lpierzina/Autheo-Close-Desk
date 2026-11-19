import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-navy-900 px-12 py-10 text-navy-200 lg:flex">
        <Brand />
        <div className="max-w-sm">
          <p className="text-[22px] font-semibold leading-snug tracking-tight text-white">
            One reviewed ownership register from three source files.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-navy-300">
            Subscriptions, cleared funding and approved allocations are matched on stable references, exceptions are
            reviewed, and the approved close is frozen for export.
          </p>
        </div>
        <p className="text-xs text-navy-300">Access is by invitation only.</p>
      </aside>
      <main id="main" className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Brand tone="light" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
