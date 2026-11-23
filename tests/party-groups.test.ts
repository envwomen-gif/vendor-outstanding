import { describe, expect, it } from "vitest";
import { groupByParty } from "@/lib/party-groups";

const bill = (account: string, dueDate: string, balancePaise: number) => ({ account, dueDate, balancePaise });

describe("groupByParty", () => {
  it("puts the party with the oldest due date first, and keeps the FIFO order inside a party", () => {
    const groups = groupByParty([
      bill("B", "2026-04-30", 100),
      bill("A", "2026-05-10", 200),
      bill("B", "2026-06-01", 300),
      bill("C", "2026-04-15", 50),
    ]);
    expect(groups.map((g) => g.account)).toEqual(["C", "B", "A"]);
    expect(groups[1]?.rows.map((r) => r.dueDate)).toEqual(["2026-04-30", "2026-06-01"]);
    expect(groups[1]?.balancePaise).toBe(400);
    expect(groups[1]?.oldestDue).toBe("2026-04-30");
  });

  it("keeps the input order for parties with the same oldest due date", () => {
    const groups = groupByParty([bill("Z", "2026-04-30", 1), bill("A", "2026-04-30", 1)]);
    expect(groups.map((g) => g.account)).toEqual(["Z", "A"]);
  });

  it("returns an empty list for no bills", () => {
    expect(groupByParty([])).toEqual([]);
  });
});
