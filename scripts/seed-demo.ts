/**
 * Loads the synthetic Riverbend Flats demo offering. Nothing in the app calls this;
 * demo data exists only after an operator runs the command.
 *
 *   npm run seed:demo -- --reviewer riley@your-company.example --approver morgan@your-company.example
 *   npm run seed:demo -- --dev-users        (local development identity only)
 *
 * The three example files are imported through the same service the import screen uses,
 * and the exceptions are left open so the guided example can be worked through.
 * No one is given a login: --reviewer and --approver must already be invited.
 */
import { describeDatabase, fail, loadEnvFiles, parseArgs } from "./lib/cli";

const DEMO_NAME = "Riverbend Flats Apartments";
const SEED_ACTOR_EMAIL = "demo-seed@closedesk.invalid";
const DEV_USERS = [
  { email: "avery.admin@closedesk.example", displayName: "Avery Admin (synthetic)", isAdmin: true, role: null },
  { email: "riley.reviewer@closedesk.example", displayName: "Riley Reviewer (synthetic)", isAdmin: false, role: "reviewer" },
  { email: "morgan.approver@closedesk.example", displayName: "Morgan Approver (synthetic)", isAdmin: false, role: "approver" },
] as const;

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2), ["--reviewer", "--approver"], ["--dev-users", "--confirm"]);
  const target = describeDatabase();
  console.log(`Database: ${target.database} on ${target.host}`);

  if ((process.env.NODE_ENV === "production" || !target.isLocal) && !args.flags.has("--confirm")) {
    fail("This is not a local database. Re-run with --confirm to load the synthetic demo offering into it.");
  }

  const { getAuthConfig } = await import("@/server/auth/config");
  const { closePool, query, queryOne } = await import("@/server/db");
  const { SAMPLE_FILES } = await import("@/server/sample-files.generated");
  const { commitImport, previewImport } = await import("@/server/services/imports");
  const { createOffering, setMember } = await import("@/server/services/offerings");
  const { findUserByEmail, findUserById, inviteUser } = await import("@/server/services/users");

  try {
    if (args.flags.has("--dev-users") && getAuthConfig().mode !== "dev") {
      fail("--dev-users only works with the local development identity (CLOSE_DESK_DEV_AUTH=1 outside production).");
    }

    const existing = await queryOne<{ id: string }>("SELECT id FROM offerings WHERE is_demo AND name = $1 LIMIT 1", [DEMO_NAME]);
    if (existing) fail(`The demo offering already exists (${existing.id}). Nothing was changed.`);

    const members: { email: string; role: "reviewer" | "approver" }[] = [];
    for (const [option, role] of [["--reviewer", "reviewer"], ["--approver", "approver"]] as const) {
      const email = args.values.get(option)?.trim().toLowerCase();
      if (!email) continue;
      const user = await findUserByEmail(email);
      if (!user || user.status === "disabled") fail(`${email} is not an invited user. Invite them first: npm run user:invite -- --email ${email}`);
      members.push({ email, role });
    }
    if (members.length === 2 && members[0]?.email === members[1]?.email) {
      fail("The reviewer and the approver must be different people.");
    }

    if (args.flags.has("--dev-users")) {
      for (const user of DEV_USERS) {
        await inviteUser(null, { email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
        if (user.role) members.push({ email: user.email, role: user.role });
      }
    }

    // A record to attribute the seed to. It is disabled, has no login and cannot sign in.
    const seedRow = await queryOne<{ id: string }>(
      `INSERT INTO app_users (email, display_name, is_admin, status)
       VALUES ($1, 'Demo seed (synthetic)', false, 'disabled')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [SEED_ACTOR_EMAIL],
    );
    const seedUser = seedRow ? await findUserById(seedRow.id) : null;
    if (!seedUser) fail("The seed record could not be created.");
    // Administrator rights exist only inside this process, for creating the offering and its members.
    const operator = { ...seedUser, isAdmin: true };

    const offering = await createOffering(operator, {
      name: DEMO_NAME,
      propertyName: "Riverbend Flats, 184 units (fictional)",
      currency: "USD",
      targetRaise: "5000000.00",
      addCreatorAsReviewer: true,
      isDemo: true,
    });

    for (const kind of ["subscriptions", "funding", "allocations"] as const) {
      const filename = `${kind}.csv`;
      const content = SAMPLE_FILES[filename];
      if (!content) fail(`Missing example file ${filename}. Run npm run fixtures:generate.`);
      const file = { filename, bytes: new TextEncoder().encode(content) };
      const preview = await previewImport(seedUser, offering.id, kind, file);
      if (preview.mappingErrors.length > 0 || !preview.validation) fail(`The example ${kind} file could not be mapped.`);
      const { counts } = await commitImport(seedUser, offering.id, {
        kind,
        file,
        mapping: preview.mapping,
        expectedSha256: preview.sha256,
        skipInvalidRows: true,
      });
      console.log(`Imported ${filename}: ${counts.rowCount} rows, ${counts.newCount} new, ${counts.invalidCount} invalid left out.`);
    }

    for (const member of members) {
      await setMember(operator, offering.id, member);
      console.log(`Added ${member.email} as ${member.role}.`);
    }
    // The seed record keeps no role on the offering once the files are in.
    await query("DELETE FROM offering_members WHERE offering_id = $1 AND user_id = $2", [offering.id, seedUser.id]);

    console.log(`\nDemo offering created: ${DEMO_NAME} (${offering.id}).`);
    console.log("All data is synthetic. Exceptions are left open for review.");
    if (members.length === 0) {
      console.log("No reviewer or approver was added. A workspace administrator can add them on the offering's Access tab.");
    }
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The seed failed.");
  process.exit(1);
});
