"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <div role="alert" className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-danger">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page could not be loaded</h1>
        <p className="mt-2 text-sm text-ink-2">Nothing was changed. Try again; if it keeps happening, contact your administrator.</p>
        <div className="mt-6">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
