import type { Metadata } from "next";
import Link from "next/link";
import { AccessManager } from "@/components/access-manager";
import { Callout, Card, CardHeader } from "@/components/ui";
import { pageOffering } from "@/server/page";
import { listMembers } from "@/server/services/offerings";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Access" };

export default async function AccessPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const { user, access } = await pageOffering(offeringId);
  const members = await listMembers(user, access.offering.id);
  const memberEmails = new Set(members.map((m) => m.email));
  const candidates = access.can.manage
    ? (await listUsers())
        .filter((u) => u.status !== "disabled" && !memberEmails.has(u.email))
        .map((u) => ({ email: u.email, label: u.displayName ?? u.email }))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink">Access</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-2">
          Only the people listed here, and workspace administrators, can open this offering. Each person holds one role.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Reviewer</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Imports files, documents exceptions, links or excludes payments, and resolves conflicting records. Cannot approve.
          </p>
        </Card>
        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Approver</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Reviews the close summary and approves it, which freezes a version. Cannot import files or record reviewer decisions.
          </p>
        </Card>
      </div>
      {!access.can.manage ? (
        <Callout tone="info" title="Only workspace administrators can change access" />
      ) : null}
      <Card>
        <CardHeader
          title="People on this offering"
          description={
            access.can.manage ? (
              <>
                A person must be invited to the workspace first.{" "}
                <Link href="/team" className="font-medium text-accent-strong underline underline-offset-2">
                  Invite people on the Team page
                </Link>
                .
              </>
            ) : undefined
          }
        />
        <AccessManager offeringId={access.offering.id} members={members} candidates={candidates} canManage={access.can.manage} />
      </Card>
    </div>
  );
}
