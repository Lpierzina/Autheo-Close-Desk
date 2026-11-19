#!/usr/bin/env node
// Explicit, forward-only migration runner. Run it with `npm run db:migrate`.
// It is never invoked by the application at startup.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");

for (const file of [".env.local", ".env"]) {
  try {
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(path.join(root, file));
  } catch {
    // The file is optional.
  }
}

// Keep in sync with src/server/db.ts.
function poolConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("DATABASE_URL is not set. Nothing was changed.");
    process.exit(1);
  }
  const mode = (process.env.DATABASE_SSL ?? "").toLowerCase();
  if (!mode) return { connectionString: raw };
  const url = new URL(raw);
  for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  const ssl = mode === "disable" ? false : { rejectUnauthorized: mode !== "no-verify" };
  return { connectionString: url.toString(), ssl };
}

const statusOnly = process.argv.includes("--status");
const client = new pg.Client(poolConfig());

async function main() {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('autheo_close_desk_migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Map(
    (await client.query("SELECT version, checksum FROM schema_migrations")).rows.map((r) => [r.version, r.checksum]),
  );

  let pending = 0;
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const known = applied.get(file);
    if (known) {
      if (known !== checksum) {
        throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead.`);
      }
      if (statusOnly) console.log(`applied  ${file}`);
      continue;
    }
    pending += 1;
    if (statusOnly) {
      console.log(`pending  ${file}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`applied  ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed and was rolled back: ${error.message}`);
    }
  }

  if (statusOnly) console.log(pending === 0 ? "Database is up to date." : `${pending} migration(s) pending.`);
  else console.log(pending === 0 ? "Database is already up to date." : `Applied ${pending} migration(s).`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
