/**
 * Invites a user from the command line. This is how the first administrator is created:
 * there is no sign-up page and no default account.
 *
 *   npm run user:invite -- --email ops.lead@your-company.example --name "Ops Lead" --admin
 *
 * It creates the Close Desk user record (which is what grants access) and, when Clerk is
 * configured, asks Clerk to email the invitation link.
 */
import { describeDatabase, fail, loadEnvFiles, parseArgs } from "./lib/cli";

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2), ["--email", "--name"], ["--admin"]);
  const email = args.values.get("--email");
  if (!email) fail('Usage: npm run user:invite -- --email <address> [--name "Full Name"] [--admin]');

  const db = describeDatabase();
  console.log(`Database: ${db.database} on ${db.host}`);

  const { inviteUser } = await import("@/server/services/users");
  const { closePool } = await import("@/server/db");
  try {
    const result = await inviteUser(null, {
      email,
      displayName: args.values.get("--name"),
      isAdmin: args.flags.has("--admin"),
    });
    const role = result.user.isAdmin ? "workspace administrator" : "member";
    console.log(result.created ? `Created ${result.user.email} as ${role}.` : `${result.user.email} already exists as ${role} (status: ${result.user.status}).`);
    if (!result.created && args.flags.has("--admin") && !result.user.isAdmin) {
      console.log("The existing user was not changed. Administrator rights are not granted to existing users from this command.");
    }
    console.log(result.invitation.message);
    if (!result.invitation.sent && result.user.status === "invited") {
      console.log("Send the invitation from the Clerk dashboard (Users > Invitations) to the same email address.");
    }
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The invitation failed.");
  process.exit(1);
});
