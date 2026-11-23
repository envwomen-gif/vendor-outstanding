import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { bankChoice, batch, bill, importRun, payment } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { bankCsvFileName, buildBankCsv } from "@/lib/bank-csv";
import { loadBeneLookup } from "@/lib/bene/service";
import { todayInIndia } from "@/lib/format";
import { type BillInfo, type Evaluation, type Selection, evaluateSelection } from "./evaluate";

type BillRow = typeof bill.$inferSelect;

function toInfo(r: BillRow): BillInfo {
  return {
    id: r.id,
    account: r.account,
    docNo: r.docNo,
    refNo: r.refNo,
    dueDate: r.dueDate,
    fifoPosition: r.fifoPosition,
    balancePaise: r.balancePaise,
    status: r.status,
  };
}

export class BatchBlockedError extends Error {
  readonly evaluation: Evaluation;
  constructor(evaluation: Evaluation) {
    super("The batch has blocking problems.");
    this.name = "BatchBlockedError";
    this.evaluation = evaluation;
  }
}

/** Check a selection. It changes nothing. */
export async function previewBatch(db: Db, selections: readonly Selection[], now = new Date()): Promise<Evaluation> {
  const ids = selections.map((s) => s.billId);
  const [selected, open, lookup] = await Promise.all([
    ids.length > 0 ? db.select().from(bill).where(inArray(bill.id, ids)) : Promise.resolve([] as BillRow[]),
    db.select().from(bill).where(eq(bill.status, "open")),
    loadBeneLookup(db),
  ]);
  return evaluateSelection({
    selections,
    bills: new Map(selected.map((b) => [b.id, toInfo(b)])),
    openBills: open.map(toInfo),
    lookup,
    today: todayInIndia(now),
  });
}

export interface CreatedBatch {
  readonly batchId: string;
  readonly fileName: string;
  readonly evaluation: Evaluation;
}

/**
 * Make a batch. In one transaction:
 *  1. lock the selected bills (FOR UPDATE), so two tabs cannot pay a bill twice
 *  2. check the selection again with the locked data
 *  3. build the CSV with the locked generator
 *  4. save the batch, the payments, the new bill status and the audit row
 * Any problem rolls everything back.
 */
export async function createBatch(db: Db, selections: readonly Selection[], now = new Date()): Promise<CreatedBatch> {
  const ids = selections.map((s) => s.billId);
  if (ids.length === 0) {
    throw new BatchBlockedError(
      evaluateSelection({ selections, bills: new Map(), openBills: [], lookup: await loadBeneLookup(db), today: todayInIndia(now) }),
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("A bill is selected two times.");
  }

  return db.transaction(async (tx) => {
    const selected = await tx.select().from(bill).where(inArray(bill.id, ids)).for("update");
    const open = await tx.select().from(bill).where(eq(bill.status, "open"));
    const lookup = await loadBeneLookup(tx as unknown as Db);

    const evaluation = evaluateSelection({
      selections,
      bills: new Map(selected.map((b) => [b.id, toInfo(b)])),
      openBills: open.map(toInfo),
      lookup,
      today: todayInIndia(now),
    });
    if (!evaluation.canCreate) throw new BatchBlockedError(evaluation);

    const result = buildBankCsv(evaluation.paidBills, (name) => lookup.bankDetails(name));
    const fileName = bankCsvFileName(now);
    const csvSha256 = createHash("sha256").update(result.csv, "utf8").digest("hex");

    const [created] = await tx
      .insert(batch)
      .values({
        fileName,
        csv: result.csv,
        csvSha256,
        lineCount: result.lines.length,
        billCount: selections.length,
        totalPaise: result.totalPaise,
      })
      .returning({ id: batch.id });
    if (!created) throw new Error("Batch was not saved");

    const byId = new Map(selected.map((b) => [b.id, b]));
    for (const sel of selections) {
      const b = byId.get(sel.billId);
      if (!b) continue;
      const resolution = lookup.resolve(b.account, sel.bankKey);
      if (resolution.status !== "ok") continue; // cannot happen: evaluation passed
      await tx.insert(payment).values({
        billId: b.id,
        batchId: created.id,
        amountPaise: sel.amountPaise,
        paidDate: sel.paidDate,
        beneficiaryName: resolution.accountName,
        ifsc: resolution.ifsc,
        accountNumber: resolution.accountNumber,
        refNo: b.refNo,
      });
      // Remember the account as the default for the next time. It is only a default.
      await tx
        .insert(bankChoice)
        .values({ softwareName: b.account, optionKey: resolution.key })
        .onConflictDoUpdate({ target: bankChoice.softwareName, set: { optionKey: resolution.key, updatedAt: new Date() } });
    }
    await tx.update(bill).set({ status: "paid", updatedAt: new Date() }).where(inArray(bill.id, ids));

    await writeAudit(tx, "batch.create", "batch", created.id, {
      fileName,
      csvSha256,
      lines: result.lines.length,
      bills: selections.length,
      totalPaise: result.totalPaise,
      warnings: evaluation.issues.filter((i) => i.severity === "warning").map((i) => i.code),
    });
    return { batchId: created.id, fileName, evaluation };
  });
}

/** Reason that is saved when the person gives none. */
export const DEFAULT_UNDO_REASON = "Undone by the user";

/**
 * Undo a batch (for example the bank rejected the file, or it was only a test).
 * The bills can be paid again. A bill that JS1 does not list any more becomes "closed".
 * The reason is optional. The batch stays in the history as "voided".
 */
export async function voidBatch(db: Db, batchId: string, reason = ""): Promise<void> {
  const trimmed = reason.trim() === "" ? DEFAULT_UNDO_REASON : reason.trim();

  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(batch).where(eq(batch.id, batchId)).for("update");
    if (!target) throw new Error("Batch not found.");
    if (target.status === "voided") throw new Error("This batch is already voided.");

    const payments = await tx.select().from(payment).where(eq(payment.batchId, batchId));
    const billIds = payments.map((p) => p.billId);

    const [latest] = await tx.select({ id: importRun.id }).from(importRun).orderBy(desc(importRun.createdAt)).limit(1);
    const bills = billIds.length > 0 ? await tx.select().from(bill).where(inArray(bill.id, billIds)) : [];

    await tx.update(batch).set({ status: "voided", voidReason: trimmed, voidedAt: new Date() }).where(eq(batch.id, batchId));
    await tx.update(payment).set({ status: "voided" }).where(eq(payment.batchId, batchId));
    for (const b of bills) {
      const stillListed = latest !== undefined && b.lastImportId === latest.id;
      await tx
        .update(bill)
        .set({ status: stillListed ? "open" : "closed", updatedAt: new Date() })
        .where(eq(bill.id, b.id));
    }
    await writeAudit(tx, "batch.void", "batch", batchId, { reason: trimmed, bills: billIds.length });
  });
}
