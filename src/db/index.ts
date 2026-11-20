import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/** Any Drizzle Postgres database (node-postgres in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

declare global {
  var __vendorOutstandingPool: Pool | undefined;
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Re-use the pool between hot reloads and between calls in one server instance.
  globalThis.__vendorOutstandingPool ??= new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
  });
  return drizzle(globalThis.__vendorOutstandingPool, { schema });
}

export { schema };
