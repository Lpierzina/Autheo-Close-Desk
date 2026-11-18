import "server-only";
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

// Keep in sync with scripts/migrate.mjs.
function poolConfig(): PoolConfig {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
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

const globalForPool = globalThis as typeof globalThis & { __closeDeskPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__closeDeskPool) {
    const pool = new Pool(poolConfig());
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
  const result = await (db ?? getPool()).query<Row>(text, params);
  return result.rows;
}

export async function queryOne<Row extends QueryResultRow>(text: string, params: unknown[] = [], db?: Db): Promise<Row | null> {
  const rows = await query<Row>(text, params, db);
  return rows[0] ?? null;
}

export async function withTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises imports, decisions and approvals for one offering. */
export async function lockOffering(db: Db, offeringId: string): Promise<void> {
  await db.query("SELECT id FROM offerings WHERE id = $1 FOR UPDATE", [offeringId]);
}
