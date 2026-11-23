import { createHash } from "node:crypto";
import type { Db } from "@/db";
import { batch, payment } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { BankCsvError, bankCsvFileName, buildBankCsv, type PaidBill } from "@/lib/bank-csv";
import { cleanName } from "@/lib/bene/clean";
import type { BeneLookup } from "@/lib/bene/master";
import { loadBeneLookup } from "@/lib/bene/service";
import { formatInr } from "@/lib/format";

/** Most lines in one instant batch. More lines belong on the Payments screen. */
export const INSTANT_MAX_LINES = 50;
/** Highest amount of one line: ₹10 crore. A bigger number is almost always a typing error. */
export const INSTANT_MAX_PAISE = 10_00_00_000_00;
/** Longest reference text. The bank column has limited space. */
export const INSTANT_MAX_REFERENCE = 60;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One payment that the person types on the Instant screen. */
export interface InstantLine {
  /** Party name, as in column A of Bene Master. */
  readonly softwareName: string;
  /** The chosen bank account. It can be left out when the party has one account. */
  readonly bankKey?: string | undefined;
  readonly amountPaise: number;
  /** YYYY-MM-DD */
  readonly paidDate: string;
  /** Optional text for the bank reference column. The CSV puts "BN " before it, as for bills. */
  readonly reference: string;
}

export class InstantPaymentError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "InstantPaymentError";
    this.details = details;
  }
}

export interface CreatedInstantBatch {
  readonly batchId: string;
  readonly fileName: string;
  readonly lineCount: number;
  readonly totalPaise: number;
}

function isRealDate(iso: string): boolean {
  const m = ISO_DATE.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/**
 * Check the lines and find the bank account of each line. It changes nothing.
 * It throws InstantPaymentError with one detail for each bad line.
 */
export function resolveInstantLines(lines: readonly InstantLine[], lookup: BeneLookup): PaidBill[] {
  if (lines.length === 0) throw new InstantPaymentError("Add at least one payment.");
  if (lines.length > INSTANT_MAX_LINES) {
    throw new InstantPaymentError(`Too many payments. One instant file can have ${INSTANT_MAX_LINES} payments at most.`);
  }
  const problems: string[] = [];
  const paid: PaidBill[] = [];
  lines.forEach((line, index) => {
    const n = `Line ${index + 1}`;
    const party = cleanName(line.softwareName);
    const reference = cleanName(line.reference);
    if (party === "") {
      problems.push(`${n}: choose a party.`);
      return;
    }
    if (!Number.isSafeInteger(line.amountPaise) || line.amountPaise <= 0) {
      problems.push(`${n} (${party}): the amount must be more than zero.`);
      return;
    }
    if (line.amountPaise > INSTANT_MAX_PAISE) {
      problems.push(`${n} (${party}): ${formatInr(line.amountPaise)} is more than the limit of ${formatInr(INSTANT_MAX_PAISE)}. Check the amount.`);
      return;
    }
    if (!isRealDate(line.paidDate)) {
      problems.push(`${n} (${party}): the paid date is not valid.`);
      return;
    }
    if (reference.length > INSTANT_MAX_REFERENCE) {
      problems.push(`${n} (${party}): the reference is too long. Use ${INSTANT_MAX_REFERENCE} characters at most.`);
      return;
    }
    const r = lookup.resolve(party, line.bankKey);
    switch (r.status) {
      case "unmapped":
        problems.push(`${n}: "${party}" is not in Bene Master. Refresh Bene Master or check the name.`);
        return;
      case "choose":
        problems.push(`${n} (${party}): the party has ${r.options.length} bank accounts. Choose one.`);
        return;
      case "invalid":
        problems.push(`${n} (${party}): the bank details of "${r.accountName}" are not valid (${r.problems.join(", ")}). Fix them in Bene Master.`);
        return;
      case "ok":
        paid.push({
          beneficiaryName: r.accountName,
          paidDate: line.paidDate,
          refNo: reference,
          amountPaise: line.amountPaise,
          ifsc: r.ifsc,
          accountNumber: r.accountNumber,
        });
    }
  });
  if (problems.length > 0) {
    throw new InstantPaymentError(`${problems.length} ${problems.length === 1 ? "payment has a problem" : "payments have problems"}. Nothing was saved.`, problems);
  }
  return paid;
}

/**
 * Make an instant batch: a bank CSV for payments with no bill.
 * The batch is saved like other batches, so it shows in the history and can be undone.
 * One transaction: a problem saves nothing.
 */
export async function createInstantBatch(db: Db, lines: readonly InstantLine[], now = new Date()): Promise<CreatedInstantBatch> {
  const lookup = await loadBeneLookup(db);
  const paid = resolveInstantLines(lines, lookup);

  let result;
  try {
    result = buildBankCsv(paid, (name) => lookup.bankDetails(name));
  } catch (error) {
    if (error instanceof BankCsvError) throw new InstantPaymentError(error.message);
    throw error;
  }
  const fileName = bankCsvFileName(now);
  const csvSha256 = createHash("sha256").update(result.csv, "utf8").digest("hex");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(batch)
      .values({
        kind: "instant",
        fileName,
        csv: result.csv,
        csvSha256,
        lineCount: result.lines.length,
        billCount: 0,
        totalPaise: result.totalPaise,
      })
      .returning({ id: batch.id });
    if (!created) throw new Error("Batch was not saved");

    await tx.insert(payment).values(
      lines.map((line, i) => {
        const p = paid[i] as PaidBill;
        return {
          billId: null,
          softwareName: cleanName(line.softwareName),
          batchId: created.id,
          amountPaise: p.amountPaise,
          paidDate: p.paidDate,
          beneficiaryName: p.beneficiaryName,
          ifsc: p.ifsc ?? "",
          accountNumber: p.accountNumber ?? "",
          refNo: p.refNo,
        };
      }),
    );

    await writeAudit(tx, "batch.instant", "batch", created.id, {
      fileName,
      csvSha256,
      lines: result.lines.length,
      payments: lines.length,
      totalPaise: result.totalPaise,
      parties: [...new Set(lines.map((l) => cleanName(l.softwareName)))],
    });
    return { batchId: created.id, fileName, lineCount: result.lines.length, totalPaise: result.totalPaise };
  });
}
