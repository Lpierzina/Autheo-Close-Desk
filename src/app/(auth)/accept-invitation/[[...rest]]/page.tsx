import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clerkAppearance } from "@/components/clerk-appearance";
import { ButtonLink, Callout } from "@/components/ui";
import { getAuthConfig } from "@/server/auth/config";

export const metadata: Metadata = { title: "Accept invitation" };

/**
 * The only route that can create a login, and only from an invitation link.
 * Without an invitation ticket it renders an explanation instead of a sign-up form.
 */
export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<{ __clerk_ticket?: string }>;
}) {
  if (getAuthConfig().mode === "dev") redirect("/dev/sign-in");
  const [{ rest }, { __clerk_ticket: ticket }] = await Promise.all([params, searchParams]);
  const inProgress = Boolean(ticket) || (rest?.length ?? 0) > 0;

  if (!inProgress) {
    return (
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Invitation required</h1>
        <p className="mb-5 mt-1 text-sm text-ink-2">Close Desk accounts are created from an invitation email.</p>
        <Callout tone="info" title="Open the link in your invitation email">
          If you have not received one, ask your workspace administrator to invite you. If you already have an account,
          sign in instead.
        </Callout>
        <div className="mt-6">
          <ButtonLink href="/sign-in" variant="primary">
            Go to sign in
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">Accept your invitation</h1>
      <p className="mb-6 mt-1 text-sm text-ink-2">Create the login for the email address that was invited.</p>
      <SignUp appearance={clerkAppearance} fallbackRedirectUrl="/offerings" signInUrl="/sign-in" />
    </div>
  );
}
