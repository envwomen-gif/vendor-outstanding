import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, batch, bene, bill, importRun, payment } from "@/db/schema";
import { loadBeneLookup } from "@/lib/bene/service";
import { todayInIndia } from "@/lib/format";

export interface OpenBillRow {
  id: string;
  account: string;
  docNo: string;
  billDate: string;
  dueDate: string;
  refNo: string;
  adjustedPaise: number;
  balancePaise: number;
  overdueDays: number;
  bank: { status: "ok" | "unmapped" | "invalid"; accountName?: string; problems?: string[] };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** One row for each open bill, in FIFO order (oldest due date first). */
export async function listOpenBills(db: Db, now = new Date()): Promise<OpenBillRow[]> {
  const [rows, lookup] = await Promise.all([
    db.select().from(bill).where(eq(bill.status, "open")).orderBy(bill.dueDate, bill.fifoPosition),
    loadBeneLookup(db),
  ]);
  const today = todayInIndia(now);
  return rows.map((b) => {
    const r = lookup.resolve(b.account);
    return {
      id: b.id,
      account: b.account,
      docNo: b.docNo,
      billDate: b.billDate,
      dueDate: b.dueDate,
      refNo: b.refNo,
      adjustedPaise: b.adjustedPaise,
      balancePaise: b.balancePaise,
      overdueDays: daysBetween(b.dueDate, today),
      bank:
        r.status === "ok"
          ? { status: "ok", accountName: r.accountName }
          : r.status === "invalid"
            ? { status: "invalid", accountName: r.accountName, problems: r.problems }
            : { status: "unmapped" },
    };
  });
}

export async function lastImport(db: Db) {
  const [row] = await db.select().from(importRun).orderBy(desc(importRun.createdAt)).limit(1);
  return row;
}

export async function listBatches(db: Db) {
  return db.select().from(batch).orderBy(desc(batch.createdAt)).limit(200);
}

export async function getBatch(db: Db, id: string) {
  const [row] = await db.select().from(batch).where(eq(batch.id, id));
  if (!row) return undefined;
  const payments = await db
    .select({ p: payment, account: bill.account, docNo: bill.docNo })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .where(eq(payment.batchId, id));
  return { batch: row, payments };
}

export async function listAudit(db: Db, limit = 300) {
  return db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit);
}

export async function listBeneWithProblems(db: Db) {
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(bene);
  const problems = await db.select().from(bene).where(sql`jsonb_array_length(${bene.problems}) > 0`).orderBy(bene.position);
  const [fresh] = await db.select({ at: sql<Date | null>`max(${bene.refreshedAt})` }).from(bene);
  return { total, problems, refreshedAt: fresh?.at ?? null };
}
