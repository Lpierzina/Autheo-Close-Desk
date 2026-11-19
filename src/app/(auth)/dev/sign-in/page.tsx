import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Callout, Pill } from "@/components/ui";
import { getAuthConfig } from "@/server/auth/config";
import { query } from "@/server/db";
import { DATABASE_PROBLEMS } from "@/server/db-errors";
import { DatabaseUnavailableError, type DatabaseProblem } from "@/server/errors";

export const metadata: Metadata = { title: "Development sign-in" };

interface DevUser {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
}

/**
 * Local development only. Not reachable in production: the route renders "not found"
 * unless the app runs outside production with CLOSE_DESK_DEV_AUTH=1.
 */
export default async function DevSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (process.env.NODE_ENV === "production" || getAuthConfig().mode !== "dev") notFound();
  const { error } = await searchParams;
  let users: DevUser[] = [];
  let problem: DatabaseProblem | null = null;
  try {
    users = await query<DevUser>("SELECT id, email, display_name, is_admin FROM app_users WHERE status <> 'disabled' ORDER BY is_admin DESC, email");
  } catch (error) {
    if (!(error instanceof DatabaseUnavailableError)) throw error;
    problem = error.problem;
  }
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">Development sign-in</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">Choose a local user. This screen does not exist in production builds.</p>
      <Callout tone="warn" title="Local development identity is on">
        CLOSE_DESK_DEV_AUTH=1 replaces Clerk on this machine. Production refuses to start serving with it set.
      </Callout>
      {error ? (
        <Callout tone="danger" role="alert" className="mt-3" title="That user could not be signed in" />
      ) : null}
      {problem ? (
        <Callout tone="danger" role="alert" className="mt-3" title={DATABASE_PROBLEMS[problem].summary}>
          {DATABASE_PROBLEMS[problem].fix}
        </Callout>
      ) : users.length === 0 ? (
        <p className="mt-6 text-sm text-ink-2">
          No users yet. Run <code className="rounded bg-paper-2 px-1 py-0.5 text-[13px]">npm run seed:demo -- --dev-users</code> to create the synthetic demo team.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
          {users.map((user) => (
            <li key={user.id}>
              <form action="/api/dev/session" method="post">
                <input type="hidden" name="userId" value={user.id} />
                <button type="submit" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper-2">
                  <span>
                    <span className="block text-sm font-medium text-ink">{user.display_name ?? user.email}</span>
                    <span className="block text-xs text-ink-3">{user.email}</span>
                  </span>
                  {user.is_admin ? <Pill>Administrator</Pill> : null}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
