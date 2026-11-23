import type { Cell } from "@/lib/outstanding/parse";

/**
 * The raw JS1 export has about 70 columns. The OUTSTANDINGS tab of the sheet has the 13 columns that
 * the app needs, in a fixed order. This function finds the columns of a raw export by the names in its
 * header row and gives back the rows in the layout of the OUTSTANDINGS tab. The header row is dropped.
 *
 * When the rows have no JS1 header (for example the rows of the OUTSTANDINGS tab itself),
 * they are returned as they are.
 */

/** Names of the needed columns, in the order of the OUTSTANDINGS tab. `null` is a column that the app does not use. */
const LAYOUT: readonly (string | null)[] = [
  "account",
  "type",
  "docno",
  "date",
  "refno",
  "duedt",
  null,
  null,
  "days",
  "totalamt",
  "adjustedamt",
  "balamt",
  "agent",
];

/** Columns that must be in the header for the rows to count as a raw JS1 export. */
const REQUIRED = ["account", "docno", "date", "duedt", "adjustedamt", "balamt"] as const;

/** "Doc. No#" -> "docno", "Bal. Amt" -> "balamt". */
function key(value: Cell): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Look at the first rows only. A header is far from the top in no JS1 export. */
const HEADER_SEARCH_ROWS = 30;

export function toOutstandingsLayout(rows: readonly (readonly Cell[])[]): Cell[][] {
  for (let h = 0; h < Math.min(rows.length, HEADER_SEARCH_ROWS); h += 1) {
    const header = rows[h] ?? [];
    const position = new Map<string, number>();
    header.forEach((cell, index) => {
      const name = key(cell);
      if (name !== "" && !position.has(name)) position.set(name, index); // the first column of a name wins
    });
    if (!REQUIRED.every((name) => position.has(name))) continue;

    const columns = LAYOUT.map((name) => (name === null ? undefined : position.get(name)));
    return rows.slice(h + 1).map((row) => columns.map((index) => (index === undefined ? null : (row[index] ?? null))));
  }
  return rows.map((row) => [...row]);
}
