import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "import.run"
  | "bene.refresh"
  | "batch.create"
  | "batch.void"
  | "auth.login"
  | "auth.login_failed";

type Executor = Pick<Db, "insert">;

/** Write one audit row. Pass a transaction to make it part of the same commit. */
export async function writeAudit(
  db: Executor,
  action: AuditAction,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditLog).values({ action, entity, entityId, detail });
}
