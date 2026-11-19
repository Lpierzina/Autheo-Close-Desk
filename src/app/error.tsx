"use client";

import { Button } from "@/components/ui";

/**
 * Shown when a screen fails to render. The error stays in this tab: it is not reported
 * to any service, because a report could carry deal data.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <div role="alert" className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-danger">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This screen could not be shown</h1>
        <p className="mt-2 text-sm text-ink-2">
          Your session is still in this tab. Try again; if it keeps happening, download the exceptions report if you can, then refresh the page.
          Refreshing clears the session.
        </p>
        <div className="mt-6">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
