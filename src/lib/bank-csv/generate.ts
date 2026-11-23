import { type Beneficiary, isValidAccountNumber, isValidIfsc } from "./beneficiary";
import { BankCsvError } from "./errors";
import { formatPaiseAsSheetNumber } from "./money";
import { TEMPLATE } from "./template";

/** One paid bill. The caller gives the bills in FIFO order. */
export interface PaidBill {
  /** Bank account name, as in column B of Bene Master (the sheet's "ACCOUNT NAME AS PER BENE"). */
  readonly beneficiaryName: string;
  /** Paid date as YYYY-MM-DD. */
  readonly paidDate: string;
  /** Ref No of the bill. It can be empty. */
  readonly refNo: string;
  /** Amount paid for this bill, in paise. */
  readonly amountPaise: number;
  /**
   * Bank account that the person chose. When both are set, the line uses them and
   * the lookup is not used. Bills of one party with different accounts go on different lines.
   */
  readonly ifsc?: string;
  readonly accountNumber?: string;
}

/** Returns the bank details of a name, or undefined. The first Bene Master row wins. */
export type BeneficiaryLookup = (beneficiaryName: string) => Beneficiary | undefined;

export interface PaymentLine {
  readonly paidDate: string;
  readonly beneficiaryName: string;
  readonly ifsc: string;
  readonly accountNumber: string;
  readonly reference: string;
  readonly amountPaise: number;
  readonly billCount: number;
}

export interface BankCsv {
  readonly csv: string;
  readonly lines: readonly PaymentLine[];
  readonly totalPaise: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD -> dd/mm/yyyy. Rejects dates that do not exist. */
export function formatPaidDate(isoDate: string): string {
  const match = DATE_PATTERN.exec(isoDate);
  if (!match) throw new BankCsvError("INVALID_DATE", `Paid date must be YYYY-MM-DD: "${isoDate}"`);
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    probe.getUTCFullYear() !== Number(y) ||
    probe.getUTCMonth() !== Number(m) - 1 ||
    probe.getUTCDate() !== Number(d)
  ) {
    throw new BankCsvError("INVALID_DATE", `Paid date does not exist: "${isoDate}"`);
  }
  return `${d}/${m}/${y}`;
}

/**
 * Same rule as the Apps Script export: a field with a comma, a double quote
 * or a new line goes in double quotes, and a double quote is doubled.
 */
export function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toLine(fields: ReadonlyMap<number, string>): string {
  const cells: string[] = new Array<string>(TEMPLATE.columnCount).fill("");
  for (const [index, value] of fields) cells[index] = escapeCsvField(value);
  return cells.join(",") + TEMPLATE.lineEnding;
}

interface Group {
  readonly paidDate: string;
  readonly beneficiaryName: string;
  readonly bank: Beneficiary | undefined;
  readonly refNos: string[];
  amountPaise: number;
  billCount: number;
}

/** Group by (paid date, bank account name, chosen account). The order of first appearance stays. */
function groupBills(bills: readonly PaidBill[]): Group[] {
  const groups = new Map<string, Group>();
  for (const bill of bills) {
    if (!Number.isSafeInteger(bill.amountPaise)) {
      throw new BankCsvError(
        "INVALID_AMOUNT",
        `Amount must be a whole number of paise: ${String(bill.amountPaise)}`,
        bill.beneficiaryName,
      );
    }
    formatPaidDate(bill.paidDate); // validates
    const bank =
      bill.ifsc !== undefined && bill.accountNumber !== undefined
        ? { ifsc: bill.ifsc, accountNumber: bill.accountNumber }
        : undefined;
    const key = [bill.paidDate, bill.beneficiaryName, bank?.ifsc ?? "", bank?.accountNumber ?? ""].join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = {
        paidDate: bill.paidDate,
        beneficiaryName: bill.beneficiaryName,
        bank,
        refNos: [],
        amountPaise: 0,
        billCount: 0,
      };
      groups.set(key, group);
    }
    if (bill.refNo !== "") group.refNos.push(bill.refNo);
    group.amountPaise += bill.amountPaise;
    group.billCount += 1;
  }
  return [...groups.values()];
}

/**
 * Build the bank CSV. This function is pure. It never changes the template.
 * It throws a BankCsvError when a payment cannot go to the bank.
 */
export function buildBankCsv(
  bills: readonly PaidBill[],
  lookup: BeneficiaryLookup,
): BankCsv {
  if (bills.length === 0) {
    throw new BankCsvError("NO_BILLS", "No paid bills. A bank file needs at least one payment.");
  }

  const p = TEMPLATE.payment;
  const lines: PaymentLine[] = [];
  let out = "";

  // Header row: "H,P", padded to the full width like the sheet export.
  out += toLine(new Map(TEMPLATE.headerRow.map((value, index) => [index, value] as const)));

  for (const group of groupBills(bills)) {
    const name = group.beneficiaryName;
    const bene = group.bank ?? (name === "" ? undefined : lookup(name));
    if (!bene) {
      throw new BankCsvError(
        "MISSING_BENEFICIARY",
        `No bank details in Bene Master for "${name}".`,
        name,
      );
    }
    if (!isValidIfsc(bene.ifsc)) {
      throw new BankCsvError("INVALID_IFSC", `IFSC "${bene.ifsc}" of "${name}" is not valid.`, name);
    }
    if (!isValidAccountNumber(bene.accountNumber)) {
      throw new BankCsvError(
        "INVALID_ACCOUNT_NUMBER",
        `Account number of "${name}" is not valid. It must have 9 to 18 digits.`,
        name,
      );
    }
    if (group.amountPaise <= 0) {
      throw new BankCsvError(
        "NON_POSITIVE_TOTAL",
        `The total for "${name}" on ${group.paidDate} must be more than zero.`,
        name,
      );
    }

    const reference =
      group.refNos.length > 0
        ? TEMPLATE.referencePrefix + group.refNos.join(TEMPLATE.referenceSeparator)
        : "";

    out += toLine(
      new Map<number, string>([
        [p.recordType.index, p.recordType.value],
        [p.productCode.index, p.productCode.value],
        [p.paymentMode.index, p.paymentMode.value],
        [p.channel.index, p.channel.value],
        [p.branch.index, p.branch.value],
        [p.debitAccount.index, p.debitAccount.value],
        [p.paidDate.index, formatPaidDate(group.paidDate)],
        [p.beneficiaryName.index, name],
        [p.ifsc.index, bene.ifsc],
        [p.accountNumber.index, bene.accountNumber],
        [p.reference.index, reference],
        [p.currency.index, p.currency.value],
        [p.amount.index, formatPaiseAsSheetNumber(group.amountPaise)],
      ]),
    );

    lines.push({
      paidDate: group.paidDate,
      beneficiaryName: name,
      ifsc: bene.ifsc,
      accountNumber: bene.accountNumber,
      reference,
      amountPaise: group.amountPaise,
      billCount: group.billCount,
    });
  }

  const totalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const t = TEMPLATE.trailer;
  out += toLine(
    new Map<number, string>([
      [t.recordType.index, t.recordType.value],
      [t.count.index, String(lines.length)],
      [t.total.index, formatPaiseAsSheetNumber(totalPaise)],
    ]),
  );

  return { csv: out, lines, totalPaise };
}

/** File name: BANK_FORMAT_yyyy-mm-dd.csv, with the date in India time. */
export function bankCsvFileName(now: Date, timeZone = "Asia/Kolkata"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `BANK_FORMAT_${parts}.csv`;
}
