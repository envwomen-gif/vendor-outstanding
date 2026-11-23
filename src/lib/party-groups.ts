export interface PartyGroup<T> {
  readonly account: string;
  readonly rows: T[];
  /** Due date of the first bill. The bills come in FIFO order, so this is the oldest. */
  readonly oldestDue: string;
  readonly balancePaise: number;
}

/**
 * Group bills by party. The party with the oldest due date is first (FIFO).
 * The bills of a party keep the order that they came in. A party with the same oldest due date
 * as another keeps the position of its first bill (the sort is stable).
 * The bills must come in FIFO order: due date, then FIFO position.
 */
export function groupByParty<T extends { account: string; dueDate: string; balancePaise: number }>(bills: readonly T[]): PartyGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const b of bills) {
    const rows = map.get(b.account);
    if (rows) rows.push(b);
    else map.set(b.account, [b]);
  }
  return [...map.entries()]
    .map(([account, rows]) => ({
      account,
      rows,
      oldestDue: rows.reduce((min, r) => (r.dueDate < min ? r.dueDate : min), rows[0]?.dueDate ?? ""),
      balancePaise: rows.reduce((sum, r) => sum + r.balancePaise, 0),
    }))
    .sort((a, b) => (a.oldestDue < b.oldestDue ? -1 : a.oldestDue > b.oldestDue ? 1 : 0));
}
