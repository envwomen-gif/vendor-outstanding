import { parseRupeesToPaise } from "@/lib/bank-csv";
import { formatToDddMmmYyyy, parseDddMmmYyyyToIso } from "./dates";

/** One row of the SORTED DATA sheet, after the Apps Script step. All values are text. */
export type SortedRow = readonly [
  account: string, // A
  docNo: string, // C
  date: string, // D (dd-MMM-yyyy)
  refNo: string, // E
  dueDate: string, // F (dd-MMM-yyyy)
  days: string, // I
  totalAmount: string, // J
  adjustedAmount: string, // K
  balanceAmount: string, // L
  agent: string, // M
];

/** One bill in FIFO order, as in the PAYMENTS DUE FIFO sheet (columns A to G). */
export interface FifoBill {
  readonly account: string;
  readonly docNo: string;
  readonly date: string; // YYYY-MM-DD
  readonly dueDate: string; // YYYY-MM-DD
  readonly refNo: string;
  readonly adjustedPaise: number;
  readonly balancePaise: number;
}

export type Cell = string | number | boolean | Date | null | undefined;

const SOURCE_COLUMNS = [0, 2, 3, 4, 5, 8, 9, 10, 11, 12] as const; // A,C,D,E,F,I,J,K,L,M
// The script formats the values of sheet columns C (index 2), D (index 3) and F (index 5).
const FORMAT_SOURCE_COLUMNS = new Set([2, 3, 5]);

function asText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  // Remove float noise such as 69094.00000000001 (xlsx files store numbers as floats).
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return String(value);
}

/**
 * Port of generateOutstandingReport. Input: the rows of the OUTSTANDINGS tab.
 * Output: the rows of SORTED DATA.
 *  - drops rows with an empty column A
 *  - drops rows where column A contains "Total for"
 *  - keeps columns A, C, D, E, F, I, J, K, L, M
 *  - writes columns C, D and F as dd-MMM-yyyy
 */
export function buildSortedData(rows: readonly (readonly Cell[])[], timeZone = "Asia/Kolkata"): SortedRow[] {
  const result: SortedRow[] = [];
  for (const row of rows) {
    const first = row[0];
    if (first === "" || first === null || first === undefined) continue;
    if (String(first).includes("Total for")) continue;

    const selected = SOURCE_COLUMNS.map((column) => {
      const value = row[column];
      return FORMAT_SOURCE_COLUMNS.has(column)
        ? formatToDddMmmYyyy(value, timeZone)
        : asText(value);
    });
    result.push(selected as unknown as SortedRow);
  }
  return result;
}

/**
 * Port of the QUERY in PAYMENTS DUE FIFO:
 *   SELECT Date, Due, Account, Doc, Adjusted, Balance, Ref WHERE Due IS NOT NULL ORDER BY Due ASC
 * The sort is stable, so bills with the same due date keep their export order.
 * Rows that cannot be read are returned in `rejected` with a reason.
 */
export function buildFifo(sorted: readonly SortedRow[]): { bills: FifoBill[]; rejected: { row: SortedRow; reason: string }[] } {
  const bills: FifoBill[] = [];
  const rejected: { row: SortedRow; reason: string }[] = [];

  for (const row of sorted) {
    const [account, docNo, date, refNo, dueDate, , , adjusted, balance] = row;
    if (dueDate === "") continue; // WHERE Due IS NOT NULL
    // The header row of the export has the text "Due Dt". The sheet QUERY drops it
    // because the column holds dates. Only this exact header is dropped quietly.
    if (account === "Account" && dueDate === "Due Dt") continue;
    const dueIso = parseDddMmmYyyyToIso(dueDate);
    const dateIso = parseDddMmmYyyyToIso(date);
    if (!dueIso || !dateIso) {
      rejected.push({ row, reason: `Date not valid (date "${date}", due "${dueDate}")` });
      continue;
    }
    try {
      bills.push({
        account,
        docNo,
        date: dateIso,
        dueDate: dueIso,
        refNo,
        adjustedPaise: adjusted === "" ? 0 : parseRupeesToPaise(adjusted),
        balancePaise: parseRupeesToPaise(balance),
      });
    } catch {
      rejected.push({ row, reason: `Amount not valid (adjusted "${adjusted}", balance "${balance}")` });
    }
  }

  // Array.prototype.sort is stable in Node 12 and later.
  bills.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { bills, rejected };
}
