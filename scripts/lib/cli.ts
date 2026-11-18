import { existsSync } from "node:fs";
import path from "node:path";

/** Loads .env.local then .env from the project root, without overriding variables that are already set. */
export function loadEnvFiles(): void {
  const root = path.resolve(__dirname, "..", "..");
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArgs(argv: string[], valueOptions: string[], flagOptions: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const [name, inline] = arg.split("=", 2) as [string, string | undefined];
    if (flagOptions.includes(name)) {
      flags.add(name);
    } else if (valueOptions.includes(name)) {
      const value = inline ?? argv[(i += 1)];
      if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
      values.set(name, value);
    } else {
      fail(`Unknown option: ${arg}`);
    }
  }
  return { flags, values };
}

export function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Host and database name only. Never prints credentials. */
export function describeDatabase(): { host: string; database: string; isLocal: boolean } {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is not set.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL is not a valid connection URL.");
  }
  const host = url.hostname;
  return {
    host,
    database: url.pathname.replace(/^\//, ""),
    isLocal: host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]",
  };
}
