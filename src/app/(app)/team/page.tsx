import type { Metadata } from "next";
import { TeamManager } from "@/components/team-manager";
import { Callout, PageHeader } from "@/components/ui";
import { pageUser } from "@/server/page";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await pageUser();
  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Close Desk is invitation-only. Only people listed here can sign in." />
      {user.isAdmin ? (
        <TeamManager users={await listUsers()} currentUserId={user.id} />
      ) : (
        <Callout tone="warn" title="Only workspace administrators can manage the team">
          Ask an administrator if someone needs access.
        </Callout>
      )}
    </div>
  );
}
