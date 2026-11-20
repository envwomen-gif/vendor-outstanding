import { findBeneficiaryProblems } from "@/lib/bank-csv";
import { cleanAccountNumber, cleanEmail, cleanIfsc, cleanName } from "./clean";

export type BeneProblem =
  | "INVALID_IFSC"
  | "INVALID_ACCOUNT_NUMBER"
  | "CONFLICTING_DETAILS";

export interface BeneEntry {
  readonly position: number;
  readonly softwareName: string;
  readonly accountName: string;
  readonly ifsc: string;
  readonly accountNumber: string;
  readonly email: string;
  readonly problems: BeneProblem[];
}

/**
 * Parse the rows of ALL DETAILS (columns A to E, without the header row).
 * Same rule as the sheet QUERY: a row without an account name (column B) is dropped.
 * Fully empty duplicate rows are kept once.
 */
export function parseBeneRows(rows: readonly (readonly unknown[])[]): BeneEntry[] {
  const entries: BeneEntry[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const accountName = cleanName(row[1]);
    if (accountName === "") return;
    const entry: BeneEntry = {
      position: index,
      softwareName: cleanName(row[0]),
      accountName,
      ifsc: cleanIfsc(row[2]),
      accountNumber: cleanAccountNumber(row[3]),
      email: cleanEmail(row[4]),
      problems: [],
    };
    // The sheet shows identical rows (for example ALFA ENTERPRISES) two times. Keep one.
    const key = [entry.softwareName, entry.accountName, entry.ifsc, entry.accountNumber].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  });

  // Same bank account name with different bank details is dangerous: the sheet
  // uses the first row and says nothing. We mark all rows of that name.
  const detailsByName = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = detailsByName.get(e.accountName) ?? new Set<string>();
    set.add(`${e.ifsc}|${e.accountNumber}`);
    detailsByName.set(e.accountName, set);
  }

  return entries.map((e) => {
    const problems: BeneProblem[] = findBeneficiaryProblems({ ifsc: e.ifsc, accountNumber: e.accountNumber });
    if ((detailsByName.get(e.accountName)?.size ?? 0) > 1) problems.push("CONFLICTING_DETAILS");
    return { ...e, problems };
  });
}

export type Resolution =
  | { readonly status: "ok"; readonly accountName: string; readonly ifsc: string; readonly accountNumber: string }
  | { readonly status: "unmapped"; readonly softwareName: string }
  | {
      readonly status: "invalid";
      readonly accountName: string;
      readonly problems: BeneProblem[];
    };

/**
 * Same two lookups as the sheet:
 *  1. software name (column A) -> account name (column B), first row wins
 *  2. account name (column B) -> IFSC and account number, first row wins
 * The result is "invalid" when the details have a problem (the app blocks it).
 */
export class BeneLookup {
  private readonly byAccountName = new Map<string, BeneEntry>();
  private readonly accountNameBySoftware = new Map<string, string>();

  constructor(entries: readonly BeneEntry[]) {
    const ordered = [...entries].sort((a, b) => a.position - b.position);
    for (const e of ordered) {
      if (e.softwareName !== "" && !this.accountNameBySoftware.has(e.softwareName)) {
        this.accountNameBySoftware.set(e.softwareName, e.accountName);
      }
      if (!this.byAccountName.has(e.accountName)) this.byAccountName.set(e.accountName, e);
    }
  }

  /** Bank account name of a software name (the sheet's column J of PAYMENTS DUE FIFO). */
  accountNameOf(softwareName: string): string | undefined {
    return this.accountNameBySoftware.get(cleanName(softwareName));
  }

  resolve(softwareName: string): Resolution {
    const cleaned = cleanName(softwareName);
    const accountName = this.accountNameBySoftware.get(cleaned);
    if (accountName === undefined) return { status: "unmapped", softwareName: cleaned };
    const entry = this.byAccountName.get(accountName);
    if (!entry) return { status: "unmapped", softwareName: cleaned };
    if (entry.problems.length > 0) return { status: "invalid", accountName, problems: entry.problems };
    return { status: "ok", accountName, ifsc: entry.ifsc, accountNumber: entry.accountNumber };
  }

  /** Lookup by bank account name, for the CSV generator. */
  bankDetails(accountName: string): { ifsc: string; accountNumber: string } | undefined {
    const entry = this.byAccountName.get(accountName);
    return entry ? { ifsc: entry.ifsc, accountNumber: entry.accountNumber } : undefined;
  }
}
