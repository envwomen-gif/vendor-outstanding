import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { loginAttempt } from "@/db/schema";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;

export async function isLoginBlocked(db: Db, key: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.key, key), gt(loginAttempt.at, since)));
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordLoginFailure(db: Db, key: string): Promise<void> {
  await db.insert(loginAttempt).values({ key });
}

export async function clearLoginFailures(db: Db, key: string): Promise<void> {
  await db.delete(loginAttempt).where(eq(loginAttempt.key, key));
}
