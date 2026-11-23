import type { Db } from "@/db";
import { bene } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { findBeneficiaryProblems } from "@/lib/bank-csv";
import { BeneLookup, type BeneEntry, parseBeneRows } from "./master";

export interface BeneRefreshSummary {
  readonly rows: number;
  readonly withProblems: number;
}

/**
 * Replace the cached copy of Bene Master. `rows` are the rows of ALL DETAILS
 * without the header row. One transaction: the old copy stays when this fails.
 */
export async function refreshBene(db: Db, rows: readonly (readonly unknown[])[]): Promise<BeneRefreshSummary> {
  const entries = parseBeneRows(rows);
  if (entries.length === 0) throw new Error("Bene Master has no rows. The old copy stays.");
  const withProblems = entries.filter((e) => e.problems.length > 0).length;

  await db.transaction(async (tx) => {
    await tx.delete(bene);
    for (let i = 0; i < entries.length; i += 500) {
      await tx.insert(bene).values(entries.slice(i, i + 500).map((e) => ({ ...e })));
    }
    await writeAudit(tx, "bene.refresh", "bene", "", { rows: entries.length, withProblems });
  });
  return { rows: entries.length, withProblems };
}

export async function loadBeneEntries(db: Db): Promise<BeneEntry[]> {
  const rows = await db.select().from(bene);
  return rows.map((r) => ({
    position: r.position,
    softwareName: r.softwareName,
    accountName: r.accountName,
    ifsc: r.ifsc,
    accountNumber: r.accountNumber,
    email: r.email,
    // Checked again here, so an old saved copy never shows a rule that no longer exists.
    problems: findBeneficiaryProblems({ ifsc: r.ifsc, accountNumber: r.accountNumber }),
  }));
}

export async function loadBeneLookup(db: Db): Promise<BeneLookup> {
  return new BeneLookup(await loadBeneEntries(db));
}
