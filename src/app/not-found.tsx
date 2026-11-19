import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page is not available</h1>
        <p className="mt-2 text-sm text-ink-2">
          It may not exist, or you may not have access to it. Ask a workspace administrator to add you to the offering.
        </p>
        <div className="mt-6">
          <ButtonLink href="/offerings" variant="primary">
            Back to offerings
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
