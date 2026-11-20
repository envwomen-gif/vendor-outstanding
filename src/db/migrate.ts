import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Apply the SQL migrations in ./drizzle. Safe to run many times: only new migrations run.
 *
 *   npm run db:migrate                       always runs
 *   ... migrate.ts --production-only         runs only when VERCEL_ENV is "production"
 *                                            (used by the Vercel build, see "vercel-build")
 *
 * A direct (not pooled) connection is better for schema changes, so
 * DATABASE_URL_UNPOOLED is used when it is set (the Neon integration sets it).
 */
const productionOnly = process.argv.includes("--production-only");
if (productionOnly && process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations (VERCEL_ENV is "${process.env.VERCEL_ENV ?? ""}", not "production").`);
  process.exit(0);
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. The migration cannot run.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
