import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutControl } from "@/components/sign-out";
import { Callout } from "@/components/ui";
import { getAuthConfig } from "@/server/auth/config";
import { requireUser } from "@/server/auth/session";
import { DatabaseUnavailableError, NotInvitedError, UnauthenticatedError } from "@/server/errors";
import { signInPath } from "@/server/page";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  try {
    await requireUser();
    redirect("/offerings");
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(signInPath());
    if (error instanceof DatabaseUnavailableError) redirect("/unavailable");
    if (!(error instanceof NotInvitedError)) throw error;
  }
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">You do not have access</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">You are signed in, but this account has not been invited to Close Desk.</p>
      <Callout tone="warn" title="Ask a workspace administrator to invite this email address">
        Access is granted per person. An invitation applies only to the verified email address it was sent to.
      </Callout>
      <div className="mt-6">
        <SignOutControl mode={getAuthConfig().mode === "dev" ? "dev" : "clerk"} variant="button" />
      </div>
    </div>
  );
}
