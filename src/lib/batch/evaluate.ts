import { type PaidBill } from "@/lib/bank-csv";
import type { BeneLookup } from "@/lib/bene/master";
import { formatDisplayDate, formatInr } from "@/lib/format";

export type Severity = "block" | "warning" | "suggestion";

export type IssueCode =
  | "NO_SELECTION"
  | "BILL_NOT_OPEN"
  | "BENE_UNMAPPED"
  | "BENE_INVALID_IFSC"
  | "BENE_INVALID_ACCOUNT"
  | "BANK_ACCOUNT_NOT_CHOSEN"
  | "AMOUNT_NOT_POSITIVE"
  | "AMOUNT_NOT_PAISE"
  | "DATE_INVALID"
  | "AMOUNT_BELOW_BALANCE"
  | "AMOUNT_ABOVE_BALANCE"
  | "PAID_DATE_NOT_TODAY"
  | "OLDER_BILL_NOT_SELECTED"
  | "OTHER_DUE_BILLS_NOT_SELECTED"
  | "BILLS_GROUPED";

export interface Issue {
  readonly severity: Severity;
  readonly code: IssueCode;
  readonly message: string;
  readonly billId?: string;
}

/** The data of a bill that the rules need. */
export interface BillInfo {
  readonly id: string;
  readonly account: string;
  readonly docNo: string;
  readonly refNo: string;
  readonly dueDate: string;
  readonly fifoPosition: number;
  readonly balancePaise: number;
  readonly status: "open" | "paid" | "closed";
}

export interface Selection {
  readonly billId: string;
  readonly amountPaise: number;
  readonly paidDate: string;
  /** Key of the bank account that the person chose. Needed when the party has more than one account. */
  readonly bankKey?: string;
}

export interface PreviewLine {
  readonly paidDate: string;
  readonly accountName: string;
  readonly ifsc: string;
  /** Last 4 digits of the account number. The full number is never sent to the browser. */
  readonly accountLast4: string;
  readonly refNos: string[];
  readonly amountPaise: number;
  readonly billCount: number;
}

export interface Evaluation {
  readonly issues: Issue[];
  readonly lines: PreviewLine[];
  /** Bills for the CSV generator, in FIFO order. Empty when there is a blocking issue. */
  readonly paidBills: PaidBill[];
  readonly totalPaise: number;
  readonly canCreate: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  if (!ISO.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function describe(b: BillInfo): string {
  return `${b.account}, bill ${b.docNo}`;
}

/**
 * Check a selection of bills before a batch is made. Pure function.
 *  - "block": the batch cannot be made
 *  - "warning": the batch can be made, the person should look at it
 *  - "suggestion": a hint that can save a mistake
 * A warning never blocks.
 *
 * @param selected  the bills that the person ticked, with amount and paid date
 * @param bills     data of the ticked bills
 * @param openBills all open bills (for the FIFO suggestions)
 */
export function evaluateSelection(args: {
  selections: readonly Selection[];
  bills: ReadonlyMap<string, BillInfo>;
  openBills: readonly BillInfo[];
  lookup: BeneLookup;
  today: string;
}): Evaluation {
  const { selections, bills, openBills, lookup, today } = args;
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);

  if (selections.length === 0) {
    add({ severity: "block", code: "NO_SELECTION", message: "Select at least one bill." });
    return { issues, lines: [], paidBills: [], totalPaise: 0, canCreate: false };
  }

  type Row = { sel: Selection; bill: BillInfo; accountName: string; ifsc: string; accountNumber: string };
  const rows: Row[] = [];

  for (const sel of selections) {
    const b = bills.get(sel.billId);
    if (!b) {
      add({ severity: "block", code: "BILL_NOT_OPEN", message: "A selected bill does not exist.", billId: sel.billId });
      continue;
    }
    if (b.status !== "open") {
      add({
        severity: "block",
        code: "BILL_NOT_OPEN",
        message: `${describe(b)} is ${b.status === "paid" ? "already paid and locked" : "closed (not in the last import)"}.`,
        billId: b.id,
      });
      continue;
    }
    if (!Number.isSafeInteger(sel.amountPaise)) {
      add({ severity: "block", code: "AMOUNT_NOT_PAISE", message: `${describe(b)}: the amount is not valid.`, billId: b.id });
      continue;
    }
    if (sel.amountPaise <= 0) {
      add({ severity: "block", code: "AMOUNT_NOT_POSITIVE", message: `${describe(b)}: the amount must be more than zero.`, billId: b.id });
      continue;
    }
    if (!isRealDate(sel.paidDate)) {
      add({ severity: "block", code: "DATE_INVALID", message: `${describe(b)}: the paid date is not valid.`, billId: b.id });
      continue;
    }

    const resolution = lookup.resolve(b.account, sel.bankKey);
    if (resolution.status === "choose") {
      add({
        severity: "block",
        code: "BANK_ACCOUNT_NOT_CHOSEN",
        message: `${describe(b)}: "${b.account}" has ${resolution.options.length} bank accounts. Choose the account to pay.`,
        billId: b.id,
      });
      continue;
    }
    if (resolution.status === "unmapped") {
      add({
        severity: "block",
        code: "BENE_UNMAPPED",
        message: `${describe(b)}: "${b.account}" is not in Bene Master. Add the party to Bene Master and refresh.`,
        billId: b.id,
      });
      continue;
    }
    if (resolution.status === "invalid") {
      for (const problem of resolution.problems) {
        const code = problem === "INVALID_IFSC" ? "BENE_INVALID_IFSC" : "BENE_INVALID_ACCOUNT";
        const text =
          problem === "INVALID_IFSC"
            ? "has an IFSC code that is not valid"
            : "has an account number that is not valid (9 to 18 digits)";
        add({ severity: "block", code, message: `${describe(b)}: "${resolution.accountName}" ${text}. Correct Bene Master and refresh.`, billId: b.id });
      }
      continue;
    }

    rows.push({ sel, bill: b, accountName: resolution.accountName, ifsc: resolution.ifsc, accountNumber: resolution.accountNumber });

    if (sel.amountPaise < b.balancePaise) {
      add({
        severity: "warning",
        code: "AMOUNT_BELOW_BALANCE",
        message: `${describe(b)}: you pay ${formatInr(sel.amountPaise)}. The balance is ${formatInr(b.balancePaise)}. This is a part payment.`,
        billId: b.id,
      });
    } else if (sel.amountPaise > b.balancePaise) {
      add({
        severity: "warning",
        code: "AMOUNT_ABOVE_BALANCE",
        message: `${describe(b)}: you pay ${formatInr(sel.amountPaise)}. This is more than the balance of ${formatInr(b.balancePaise)}.`,
        billId: b.id,
      });
    }
    if (sel.paidDate !== today) {
      add({
        severity: "warning",
        code: "PAID_DATE_NOT_TODAY",
        message: `${describe(b)}: the paid date is ${formatDisplayDate(sel.paidDate)}. Today is ${formatDisplayDate(today)}.`,
        billId: b.id,
      });
    }
  }

  // FIFO order, as in the sheet: oldest due date first, then the order of the export.
  rows.sort((a, b) =>
    a.bill.dueDate === b.bill.dueDate ? a.bill.fifoPosition - b.bill.fifoPosition : a.bill.dueDate < b.bill.dueDate ? -1 : 1,
  );

  // Group by (paid date, bank account name, chosen account). Same rule as the CSV.
  const groups = new Map<string, PreviewLine & { refNos: string[]; amountPaise: number; billCount: number }>();
  for (const r of rows) {
    const key = [r.sel.paidDate, r.accountName, r.ifsc, r.accountNumber].join("\u0000");
    let g = groups.get(key);
    if (!g) {
      g = {
        paidDate: r.sel.paidDate,
        accountName: r.accountName,
        ifsc: r.ifsc,
        accountLast4: r.accountNumber.slice(-4),
        refNos: [],
        amountPaise: 0,
        billCount: 0,
      };
      groups.set(key, g);
    }
    if (r.bill.refNo !== "") g.refNos.push(r.bill.refNo);
    g.amountPaise += r.sel.amountPaise;
    g.billCount += 1;
  }
  const lines = [...groups.values()];
  for (const g of lines) {
    if (g.billCount > 1) {
      add({
        severity: "suggestion",
        code: "BILLS_GROUPED",
        message: `${g.billCount} bills of ${g.accountName} go in one bank line of ${formatInr(g.amountPaise)}. Check this total against your RTGS.`,
      });
    }
  }

  // FIFO suggestions: other open bills of the same party that the person did not select.
  const selectedIds = new Set(rows.map((r) => r.bill.id));
  const partiesInBatch = new Set(rows.map((r) => r.accountName));
  for (const other of openBills) {
    if (selectedIds.has(other.id)) continue;
    const otherAccountName = lookup.accountNameOf(other.account);
    if (otherAccountName === undefined || !partiesInBatch.has(otherAccountName)) continue;
    const newestSelectedDue = rows
      .filter((r) => r.accountName === otherAccountName)
      .reduce((max, r) => (r.bill.dueDate > max ? r.bill.dueDate : max), "");
    if (other.dueDate < newestSelectedDue) {
      add({
        severity: "suggestion",
        code: "OLDER_BILL_NOT_SELECTED",
        message: `${describe(other)} is older (due ${formatDisplayDate(other.dueDate)}, balance ${formatInr(other.balancePaise)}) and is not selected. FIFO says to pay the older bill first.`,
        billId: other.id,
      });
    } else if (other.dueDate <= today) {
      add({
        severity: "suggestion",
        code: "OTHER_DUE_BILLS_NOT_SELECTED",
        message: `${describe(other)} is also due (${formatDisplayDate(other.dueDate)}, balance ${formatInr(other.balancePaise)}). You can pay it in the same bank line.`,
        billId: other.id,
      });
    }
  }

  const blocked = issues.some((i) => i.severity === "block");
  const paidBills: PaidBill[] = blocked
    ? []
    : rows.map((r) => ({
        beneficiaryName: r.accountName,
        paidDate: r.sel.paidDate,
        refNo: r.bill.refNo,
        amountPaise: r.sel.amountPaise,
        ifsc: r.ifsc,
        accountNumber: r.accountNumber,
      }));
  const totalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);

  return { issues, lines, paidBills, totalPaise, canCreate: !blocked };
}
