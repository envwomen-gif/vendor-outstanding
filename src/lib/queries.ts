import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, bankChoice, batch, bene, bill, importRun, payment } from "@/db/schema";
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
  bank: BankView;
}

/** One bank account of a party, as the browser sees it. The account number is cut to 4 digits. */
export interface BankOptionView {
  key: string;
  accountName: string;
  ifsc: string;
  last4: string;
  problems: string[];
}

export interface BankView {
  /** "ok": one good account. "choose": more than one account. "invalid": one account with a problem. */
  status: "ok" | "choose" | "unmapped" | "invalid";
  options: BankOptionView[];
  /** The account to select at first: the only account, or the last choice of the person. */
  defaultKey?: string | undefined;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** One row for each open bill, in FIFO order (oldest due date first). */
export async function listOpenBills(db: Db, now = new Date()): Promise<OpenBillRow[]> {
  const [rows, lookup, choices] = await Promise.all([
    db.select().from(bill).where(eq(bill.status, "open")).orderBy(bill.dueDate, bill.fifoPosition),
    loadBeneLookup(db),
    db.select().from(bankChoice),
  ]);
  const lastChoice = new Map(choices.map((c) => [c.softwareName, c.optionKey]));
  const today = todayInIndia(now);
  return rows.map((b) => {
    const options: BankOptionView[] = lookup.optionsOf(b.account).map((o) => ({
      key: o.key,
      accountName: o.accountName,
      ifsc: o.ifsc,
      last4: o.accountNumber.slice(-4),
      problems: o.problems,
    }));
    const remembered = lastChoice.get(b.account);
    const bank: BankView =
      options.length === 0
        ? { status: "unmapped", options }
        : options.length === 1
          ? { status: (options[0]?.problems.length ?? 0) > 0 ? "invalid" : "ok", options, defaultKey: options[0]?.key }
          : {
              status: "choose",
              options,
              defaultKey: options.some((o) => o.key === remembered && o.problems.length === 0) ? remembered : undefined,
            };
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
      bank,
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
    .leftJoin(bill, eq(bill.id, payment.billId))
    .where(eq(payment.batchId, id));
  return { batch: row, payments };
}

/** One party of Bene Master with its bank accounts, for the Instant screen. The account number is cut to 4 digits. */
export interface InstantParty {
  name: string;
  options: BankOptionView[];
  /** The account that was used last time, when the party has more than one. */
  defaultKey: string | undefined;
}

export async function listInstantParties(db: Db): Promise<InstantParty[]> {
  const [lookup, choices] = await Promise.all([loadBeneLookup(db), db.select().from(bankChoice)]);
  const lastChoice = new Map(choices.map((c) => [c.softwareName, c.optionKey]));
  return lookup
    .softwareNames()
    .map((name) => {
      const options = lookup.optionsOf(name).map((o) => ({
        key: o.key,
        accountName: o.accountName,
        ifsc: o.ifsc,
        last4: o.accountNumber.slice(-4),
        problems: o.problems,
      }));
      const remembered = lastChoice.get(name);
      const usable = options.filter((o) => o.problems.length === 0);
      const defaultKey =
        options.length === 1 ? options[0]?.key : usable.some((o) => o.key === remembered) ? remembered : undefined;
      return { name, options, defaultKey };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
