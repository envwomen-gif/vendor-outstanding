import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { bill, importRun } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { cleanName } from "@/lib/bene/clean";
import { type Cell, type FifoBill, buildFifo, buildSortedData } from "@/lib/outstanding/parse";

/** Rows in one statement. Each row has at most 8 values, so this stays far below the limit of Postgres. */
const CHUNK = 500;

export interface ImportInput {
  readonly source: "sheet" | "upload";
  readonly rows: readonly (readonly Cell[])[];
  readonly fileName?: string;
  readonly fileSha256?: string;
}

export interface ImportSummary {
  readonly importId: string;
  readonly rowsRead: number;
  readonly billsNew: number;
  /** Bills that were in the list and have other values in the file (or come back after they were removed). */
  readonly billsUpdated: number;
  readonly billsUnchanged: number;
  readonly billsClosed: number;
  readonly billsPaidWaiting: number;
  readonly rejected: { reason: string; account: string; docNo: string }[];
}

/**
 * Import the outstanding rows. The file is the full list of open bills, so the import replaces the open bills:
 *  - a bill is known by (account, doc no)
 *  - a new bill becomes "open"
 *  - a known "open" bill gets the new dates and amounts
 *  - a bill that is "paid" stays locked, even when JS1 still lists it
 *  - an "open" bill that is not in the file becomes "closed"
 *  - a "closed" bill that comes back becomes "open"
 * All changes run in one transaction. A broken file changes nothing.
 */
export async function importOutstandings(db: Db, input: ImportInput): Promise<ImportSummary> {
  const sorted = buildSortedData(input.rows);
  const { bills, rejected: parseRejected } = buildFifo(sorted);
  const rejected: ImportSummary["rejected"] = parseRejected.map((r) => ({
    reason: r.reason,
    account: r.row[0],
    docNo: r.row[1],
  }));

  // Clean the names so that hidden spaces never split one party into two.
  const seen = new Set<string>();
  const incoming: FifoBill[] = [];
  for (const b of bills) {
    const account = cleanName(b.account);
    const docNo = cleanName(b.docNo);
    const key = `${account}\u0000${docNo}`;
    if (seen.has(key)) {
      rejected.push({ reason: "Same account and document number two times in the file", account, docNo });
      continue;
    }
    seen.add(key);
    incoming.push({ ...b, account, docNo, refNo: cleanName(b.refNo) });
  }

  if (incoming.length === 0) {
    throw new ImportError(
      "No bills found in the file. Check that it is the JS1 outstanding export.",
      rejected,
    );
  }

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(importRun)
      .values({
        source: input.source,
        fileName: input.fileName ?? null,
        fileSha256: input.fileSha256 ?? null,
        rowsRead: input.rows.length,
        billsNew: 0,
        billsUpdated: 0,
        billsClosed: 0,
        rejected,
      })
      .returning({ id: importRun.id });
    if (!run) throw new Error("Import run was not saved");

    const existing = await tx.select().from(bill);
    const byKey = new Map(existing.map((b) => [`${b.account}\u0000${b.docNo}`, b]));

    // One statement for each group of rows. A row by row import is slow when the database is far away.
    const inserts: (typeof bill.$inferInsert)[] = [];
    const refresh: { id: string; billDate: string; dueDate: string; refNo: string; fifoPosition: number; adjustedPaise: number; balancePaise: number }[] = [];
    const lockedPositions: { id: string; fifoPosition: number }[] = [];
    let billsUpdated = 0;
    let billsUnchanged = 0;
    const billsPaidWaiting = { count: 0 };

    for (const [fifoPosition, b] of incoming.entries()) {
      const known = byKey.get(`${b.account}\u0000${b.docNo}`);
      if (!known) {
        inserts.push({
          account: b.account,
          docNo: b.docNo,
          status: "open",
          billDate: b.date,
          dueDate: b.dueDate,
          refNo: b.refNo,
          fifoPosition,
          adjustedPaise: b.adjustedPaise,
          balancePaise: b.balancePaise,
          lastImportId: run.id,
        });
      } else if (known.status === "paid") {
        // Locked. Keep the status and the amounts. Only note that JS1 still lists it.
        lockedPositions.push({ id: known.id, fifoPosition });
        billsPaidWaiting.count += 1;
      } else {
        const same =
          known.status === "open" &&
          known.billDate === b.date &&
          known.dueDate === b.dueDate &&
          known.refNo === b.refNo &&
          known.adjustedPaise === b.adjustedPaise &&
          known.balancePaise === b.balancePaise;
        refresh.push({
          id: known.id,
          billDate: b.date,
          dueDate: b.dueDate,
          refNo: b.refNo,
          fifoPosition,
          adjustedPaise: b.adjustedPaise,
          balancePaise: b.balancePaise,
        });
        if (same) billsUnchanged += 1;
        else billsUpdated += 1;
      }
    }
    const billsNew = inserts.length;

    for (let i = 0; i < inserts.length; i += CHUNK) await tx.insert(bill).values(inserts.slice(i, i + CHUNK));

    for (let i = 0; i < refresh.length; i += CHUNK) {
      const rows = refresh.slice(i, i + CHUNK);
      const values = sql.join(
        rows.map(
          (r) => sql`(${r.id}, ${r.billDate}, ${r.dueDate}, ${r.refNo}, ${r.fifoPosition}, ${r.adjustedPaise}, ${r.balancePaise})`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        UPDATE bill SET
          bill_date = v.bill_date::date, due_date = v.due_date::date, ref_no = v.ref_no,
          fifo_position = v.fifo_position::integer, adjusted_paise = v.adjusted_paise::bigint,
          balance_paise = v.balance_paise::bigint, status = 'open', last_import_id = ${run.id}::uuid, updated_at = now()
        FROM (VALUES ${values}) AS v(id, bill_date, due_date, ref_no, fifo_position, adjusted_paise, balance_paise)
        WHERE bill.id = v.id::uuid`);
    }

    for (let i = 0; i < lockedPositions.length; i += CHUNK) {
      const rows = lockedPositions.slice(i, i + CHUNK);
      const values = sql.join(rows.map((r) => sql`(${r.id}, ${r.fifoPosition})`), sql`, `);
      await tx.execute(sql`
        UPDATE bill SET fifo_position = v.fifo_position::integer, last_import_id = ${run.id}::uuid
        FROM (VALUES ${values}) AS v(id, fifo_position)
        WHERE bill.id = v.id::uuid`);
    }

    const missingOpenIds = existing
      .filter((b) => b.status === "open" && !seen.has(`${b.account}\u0000${b.docNo}`))
      .map((b) => b.id);
    if (missingOpenIds.length > 0) {
      await tx
        .update(bill)
        .set({ status: "closed", updatedAt: new Date() })
        .where(inArray(bill.id, missingOpenIds));
    }

    const summary: ImportSummary = {
      importId: run.id,
      rowsRead: input.rows.length,
      billsNew,
      billsUpdated,
      billsUnchanged,
      billsClosed: missingOpenIds.length,
      billsPaidWaiting: billsPaidWaiting.count,
      rejected,
    };
    await tx
      .update(importRun)
      .set({ billsNew, billsUpdated, billsClosed: missingOpenIds.length })
      .where(eq(importRun.id, run.id));
    await writeAudit(tx, "import.run", "import_run", run.id, {
      source: input.source,
      fileName: input.fileName ?? null,
      billsNew,
      billsUpdated,
      billsClosed: missingOpenIds.length,
      rejected: rejected.length,
    });
    return summary;
  });
}

export class ImportError extends Error {
  readonly rejected: ImportSummary["rejected"];
  constructor(message: string, rejected: ImportSummary["rejected"] = []) {
    super(message);
    this.name = "ImportError";
    this.rejected = rejected;
  }
}
