"use client";

import { SignOutButton } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { buttonClass } from "./ui";

/** Signs out through Clerk, or clears the local development session. */
export function SignOutControl({ mode, variant }: { mode: "clerk" | "dev"; variant: "button" | "sidebar" }) {
  const router = useRouter();
  const className =
    variant === "button"
      ? buttonClass("secondary")
      : "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-navy-200 hover:bg-white/5 hover:text-white";
  const content = (
    <>
      <LogOut aria-hidden className="h-4 w-4" />
      Sign out
    </>
  );
  if (mode === "clerk") {
    return (
      <SignOutButton redirectUrl="/sign-in">
        <button type="button" className={className}>
          {content}
        </button>
      </SignOutButton>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await fetch("/api/dev/session", { method: "DELETE" });
        router.replace("/dev/sign-in");
        router.refresh();
      }}
    >
      {content}
    </button>
  );
}
