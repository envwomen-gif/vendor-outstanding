import { createHash } from "node:crypto";
import { findBeneficiaryProblems } from "@/lib/bank-csv";
import { cleanAccountNumber, cleanEmail, cleanIfsc, cleanName } from "./clean";

export type BeneProblem = "INVALID_IFSC" | "INVALID_ACCOUNT_NUMBER";

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

  // One party can have many bank accounts. That is normal. The person chooses
  // the account for each payment, so a name with two accounts is not a problem.
  return entries.map((e) => ({ ...e, problems: findBeneficiaryProblems({ ifsc: e.ifsc, accountNumber: e.accountNumber }) }));
}

/** One bank account that a party can be paid to. */
export interface BankOption {
  /** Stable key of the account. It does not show the account number. */
  readonly key: string;
  readonly accountName: string;
  readonly ifsc: string;
  readonly accountNumber: string;
  readonly problems: BeneProblem[];
}

/** Key of a bank account: the first 16 characters of a SHA-256 hash of name, IFSC and number. */
export function bankOptionKey(accountName: string, ifsc: string, accountNumber: string): string {
  return createHash("sha256").update([accountName, ifsc, accountNumber].join("\u0000"), "utf8").digest("hex").slice(0, 16);
}

export type Resolution =
  | {
      readonly status: "ok";
      readonly softwareName: string;
      readonly accountName: string;
      readonly ifsc: string;
      readonly accountNumber: string;
      readonly key: string;
    }
  | { readonly status: "unmapped"; readonly softwareName: string }
  /** The party has more than one bank account and no account is chosen. */
  | { readonly status: "choose"; readonly softwareName: string; readonly options: readonly BankOption[] }
  | {
      readonly status: "invalid";
      readonly accountName: string;
      readonly problems: BeneProblem[];
    };

/**
 * Lookups of the sheet, with one change: a software name can have many bank accounts.
 *  1. software name (column A) -> all its rows, each row is one bank account
 *  2. the person chooses the account when there is more than one
 * Rows with the same account name, IFSC and account number are one account.
 */
export class BeneLookup {
  private readonly optionsBySoftware = new Map<string, BankOption[]>();
  private readonly byAccountName = new Map<string, BeneEntry>();

  constructor(entries: readonly BeneEntry[]) {
    const ordered = [...entries].sort((a, b) => a.position - b.position);
    for (const e of ordered) {
      if (!this.byAccountName.has(e.accountName)) this.byAccountName.set(e.accountName, e);
      if (e.softwareName === "") continue;
      const key = bankOptionKey(e.accountName, e.ifsc, e.accountNumber);
      const list = this.optionsBySoftware.get(e.softwareName) ?? [];
      if (!list.some((o) => o.key === key)) {
        list.push({ key, accountName: e.accountName, ifsc: e.ifsc, accountNumber: e.accountNumber, problems: e.problems });
      }
      this.optionsBySoftware.set(e.softwareName, list);
    }
  }

  /** All bank accounts of a software name, in the order of Bene Master. */
  optionsOf(softwareName: string): readonly BankOption[] {
    return this.optionsBySoftware.get(cleanName(softwareName)) ?? [];
  }

  /** Bank account name of a software name (the first account). Used to find the same party. */
  accountNameOf(softwareName: string): string | undefined {
    return this.optionsOf(softwareName)[0]?.accountName;
  }

  /**
   * @param key the account that the person chose. It can be left out when the party has one account.
   */
  resolve(softwareName: string, key?: string): Resolution {
    const cleaned = cleanName(softwareName);
    const options = this.optionsOf(cleaned);
    if (options.length === 0) return { status: "unmapped", softwareName: cleaned };

    const chosen = key !== undefined ? options.find((o) => o.key === key) : options.length === 1 ? options[0] : undefined;
    if (!chosen) return { status: "choose", softwareName: cleaned, options };
    if (chosen.problems.length > 0) return { status: "invalid", accountName: chosen.accountName, problems: chosen.problems };
    return {
      status: "ok",
      softwareName: cleaned,
      accountName: chosen.accountName,
      ifsc: chosen.ifsc,
      accountNumber: chosen.accountNumber,
      key: chosen.key,
    };
  }

  /** Lookup by bank account name, for the CSV generator. The first row of the name wins. */
  bankDetails(accountName: string): { ifsc: string; accountNumber: string } | undefined {
    const entry = this.byAccountName.get(accountName);
    return entry ? { ifsc: entry.ifsc, accountNumber: entry.accountNumber } : undefined;
  }
}
