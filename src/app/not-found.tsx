import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page does not exist</h1>
        <p className="mt-2 text-sm text-ink-2">Close Desk has a home page, the reconciliation workspace and a file guide.</p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink href="/">Home</ButtonLink>
          <ButtonLink href="/reconcile" variant="primary">
            Open the workspace
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
