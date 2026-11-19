import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clerkAppearance } from "@/components/clerk-appearance";
import { getAuthConfig } from "@/server/auth/config";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  if (getAuthConfig().mode === "dev") redirect("/dev/sign-in");
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-2">Use the account from your invitation. There is no self-service sign-up.</p>
      <SignIn appearance={clerkAppearance} fallbackRedirectUrl="/offerings" />
    </div>
  );
}
