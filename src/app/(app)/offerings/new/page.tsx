import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewOfferingForm } from "@/components/new-offering-form";
import { Callout, Card, PageHeader } from "@/components/ui";
import { pageUser } from "@/server/page";

export const metadata: Metadata = { title: "New offering" };

export default async function NewOfferingPage() {
  const user = await pageUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/offerings" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Offerings
      </Link>
      <PageHeader title="New offering" description="Set up the close. You import the three source files in the next step." />
      {user.isAdmin ? (
        <Card className="p-6">
          <NewOfferingForm />
        </Card>
      ) : (
        <Callout tone="warn" title="Only workspace administrators can create offerings">
          Ask an administrator to create the offering and add you as a reviewer or approver.
        </Callout>
      )}
    </div>
  );
}
