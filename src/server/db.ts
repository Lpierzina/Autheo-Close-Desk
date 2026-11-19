import "server-only";
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { DATABASE_PROBLEMS, classifyDatabaseError, databaseErrorCode, databaseUnavailable } from "./db-errors";
import { DatabaseUnavailableError, type DatabaseProblem } from "./errors";

// Keep in sync with scripts/migrate.mjs.
function poolConfig(): PoolConfig {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw databaseUnavailable("not_configured");
  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "5", 10);
  const base: PoolConfig = {
    max: Number.isFinite(max) && max > 0 ? max : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "autheo-close-desk",
  };
  const mode = (process.env.DATABASE_SSL ?? "").toLowerCase();
  if (!mode) return { ...base, connectionString: raw };
  const url = new URL(raw);
  for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  return {
    ...base,
    connectionString: url.toString(),
    ssl: mode === "disable" ? false : { rejectUnauthorized: mode !== "no-verify" },
  };
}

// On globalThis so that pages and API routes, which are bundled separately, share one pool and one report.
const globalForPool = globalThis as typeof globalThis & {
  __closeDeskPool?: Pool;
  __closeDeskDbReport?: { problem: DatabaseProblem; at: number };
};

const REPORT_INTERVAL_MS = 60_000;

/**
 * Turns a setup or availability failure (no URL, no connection, no schema) into one error
 * that says what to fix, and reports it to the server log. Any other error is returned unchanged.
 */
function explain(error: unknown): unknown {
  const problem = classifyDatabaseError(error);
  if (!problem) return error;
  const now = Date.now();
  const last = globalForPool.__closeDeskDbReport;
  if (last?.problem !== problem || now - last.at >= REPORT_INTERVAL_MS) {
    globalForPool.__closeDeskDbReport = { problem, at: now };
    const { summary, fix } = DATABASE_PROBLEMS[problem];
    const code = databaseErrorCode(error);
    // The code only. Driver messages can carry the host, the user or statement parameters.
    console.error(`[db] Database unavailable (${code ? `${problem}, ${code}` : problem}): ${summary} ${fix}`);
  }
  return error instanceof DatabaseUnavailableError ? error : databaseUnavailable(problem);
}

export function getPool(): Pool {
  if (!globalForPool.__closeDeskPool) {
    let pool: Pool;
    try {
      pool = new Pool(poolConfig());
    } catch (error) {
      throw explain(error);
    }
    // Never log the error object: driver errors can carry statement parameters.
    pool.on("error", () => console.error("[db] idle client error"));
    globalForPool.__closeDeskPool = pool;
  }
  return globalForPool.__closeDeskPool;
}

export async function closePool(): Promise<void> {
  const pool = globalForPool.__closeDeskPool;
  globalForPool.__closeDeskPool = undefined;
  if (pool) await pool.end();
}

export type Db = Pick<PoolClient, "query">;

export async function query<Row extends QueryResultRow>(text: string, params: unknown[] = [], db?: Db): Promise<Row[]> {
  try {
    const result = await (db ?? getPool()).query<Row>(text, params);
    return result.rows;
  } catch (error) {
    throw explain(error);
  }
}

export async function queryOne<Row extends QueryResultRow>(text: string, params: unknown[] = [], db?: Db): Promise<Row | null> {
  const rows = await query<Row>(text, params, db);
  return rows[0] ?? null;
}

export async function withTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    throw explain(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw explain(error);
  } finally {
    client.release();
  }
}

/** Serialises imports, decisions and approvals for one offering. */
export async function lockOffering(db: Db, offeringId: string): Promise<void> {
  await db.query("SELECT id FROM offerings WHERE id = $1 FOR UPDATE", [offeringId]);
}
