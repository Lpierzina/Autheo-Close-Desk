import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutControl } from "@/components/sign-out";
import { ButtonLink, Callout } from "@/components/ui";
import { getAuthConfig } from "@/server/auth/config";
import { requireUser } from "@/server/auth/session";
import { DATABASE_PROBLEMS } from "@/server/db-errors";
import { DatabaseUnavailableError, NotInvitedError, UnauthenticatedError, type DatabaseProblem } from "@/server/errors";
import { signInPath } from "@/server/page";

export const metadata: Metadata = { title: "Database unavailable" };

/**
 * Where signed-in pages send the user when the database is not configured, cannot be
 * reached or has no schema. It checks again on every load and leaves as soon as the
 * database answers.
 */
export default async function UnavailablePage() {
  let problem: DatabaseProblem;
  try {
    await requireUser();
    redirect("/offerings");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(signInPath());
    if (error instanceof NotInvitedError) redirect("/no-access");
    if (!(error instanceof DatabaseUnavailableError)) throw error;
    problem = error.problem;
  }
  const { summary, fix } = DATABASE_PROBLEMS[problem];
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">Close Desk cannot use its database</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">
        You are signed in, but nothing can be loaded or saved until this is fixed. Nothing was changed.
      </p>
      <Callout tone="warn" role="alert" title={summary}>
        {fix}
      </Callout>
      <p className="mt-4 text-[13px] text-ink-3">
        This is a deployment setting. If you do not manage this deployment, send this message to the person who does.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/offerings" variant="primary" prefetch={false}>
          Try again
        </ButtonLink>
        <SignOutControl mode={getAuthConfig().mode === "dev" ? "dev" : "clerk"} variant="button" />
      </div>
    </div>
  );
}
