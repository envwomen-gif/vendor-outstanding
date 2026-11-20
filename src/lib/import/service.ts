import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { bill, importRun } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { cleanName } from "@/lib/bene/clean";
import { type Cell, type FifoBill, buildFifo, buildSortedData } from "@/lib/outstanding/parse";

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
  readonly billsUpdated: number;
  readonly billsClosed: number;
  readonly billsPaidWaiting: number;
  readonly rejected: { reason: string; account: string; docNo: string }[];
}

/**
 * Import the outstanding rows. Rules:
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

    let billsNew = 0;
    let billsUpdated = 0;
    let billsPaidWaiting = 0;

    for (const [fifoPosition, b] of incoming.entries()) {
      const key = `${b.account}\u0000${b.docNo}`;
      const known = byKey.get(key);
      const values = {
        billDate: b.date,
        dueDate: b.dueDate,
        refNo: b.refNo,
        fifoPosition,
        adjustedPaise: b.adjustedPaise,
        balancePaise: b.balancePaise,
        lastImportId: run.id,
        updatedAt: new Date(),
      };
      if (!known) {
        await tx.insert(bill).values({ account: b.account, docNo: b.docNo, status: "open", ...values });
        billsNew += 1;
      } else if (known.status === "paid") {
        // Locked. Keep the status and the amounts. Only note that JS1 still lists it.
        await tx.update(bill).set({ lastImportId: run.id, fifoPosition }).where(eq(bill.id, known.id));
        billsPaidWaiting += 1;
      } else {
        await tx
          .update(bill)
          .set({ ...values, status: "open" })
          .where(eq(bill.id, known.id));
        billsUpdated += 1;
      }
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
      billsClosed: missingOpenIds.length,
      billsPaidWaiting,
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
