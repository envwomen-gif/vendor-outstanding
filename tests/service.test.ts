import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, batch, bill, payment } from "@/db/schema";
import { listOpenBills } from "@/lib/queries";
import { BatchBlockedError, createBatch, previewBatch, voidBatch } from "@/lib/batch/service";
import { refreshBene } from "@/lib/bene/service";
import { ImportError, importOutstandings } from "@/lib/import/service";
import { BENE_ROWS, OUTSTANDING_ROWS } from "./helpers/data";
import { createTestDb } from "./helpers/db";

const NOW = new Date("2026-11-19T06:00:00Z"); // 11:30 in India, 19 Nov 2026
const TODAY = "2026-11-19";

let db: Db;

async function idOf(docNo: string): Promise<string> {
  const [row] = await db.select().from(bill).where(eq(bill.docNo, docNo));
  if (!row) throw new Error(`bill ${docNo} not found`);
  return row.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await refreshBene(db, BENE_ROWS);
  await importOutstandings(db, { source: "upload", rows: OUTSTANDING_ROWS, fileName: "js1.xlsx" });
});

describe("import", () => {
  it("creates bills in FIFO order and ignores totals and the header", async () => {
    const rows = await db.select().from(bill);
    expect(rows).toHaveLength(8);
    const mohshin = rows.find((r) => r.docNo === "U000227/26-27");
    expect(mohshin?.balancePaise).toBe(4565200);
    expect(mohshin?.status).toBe("open");
  });

  it("is repeatable: a second import of the same file changes nothing important", async () => {
    const summary = await importOutstandings(db, { source: "upload", rows: OUTSTANDING_ROWS });
    expect(summary.billsNew).toBe(0);
    expect(summary.billsUpdated).toBe(0);
    expect(summary.billsUnchanged).toBe(8);
    expect(summary.billsClosed).toBe(0);
  });

  it("counts a bill as changed only when its values changed", async () => {
    const changed = OUTSTANDING_ROWS.map((r) => (r[2] === "PU001214/26-27" ? [...r.slice(0, 11), "99999", ...r.slice(12)] : r));
    const summary = await importOutstandings(db, { source: "upload", rows: changed });
    expect(summary).toMatchObject({ billsNew: 0, billsUpdated: 1, billsUnchanged: 7, billsClosed: 0 });
    const [row] = await db.select().from(bill).where(eq(bill.docNo, "PU001214/26-27"));
    expect(row?.balancePaise).toBe(9999900);
  });

  it("closes an open bill that is gone, and opens it again when it returns", async () => {
    const without = OUTSTANDING_ROWS.filter((r) => r[2] !== "PU001554/26-27" && r[2] !== "PU001412/26-27");
    const s1 = await importOutstandings(db, { source: "upload", rows: without });
    expect(s1.billsClosed).toBe(1);
    const [closed] = await db.select().from(bill).where(eq(bill.docNo, "PU001412/26-27"));
    expect(closed?.status).toBe("closed");
    await importOutstandings(db, { source: "upload", rows: OUTSTANDING_ROWS });
    const [back] = await db.select().from(bill).where(eq(bill.docNo, "PU001412/26-27"));
    expect(back?.status).toBe("open");
  });

  it("refuses a file without bills and changes nothing", async () => {
    await expect(importOutstandings(db, { source: "upload", rows: [["nothing"]] })).rejects.toBeInstanceOf(ImportError);
    expect(await db.select().from(bill)).toHaveLength(8);
  });

  it("reports a bad row but imports the others", async () => {
    const bad = [...OUTSTANDING_ROWS, ["BAD", "PURC", "D", "01-Nov-2026", "", "not-a-date", "", "", "", "", "", "5", ""]];
    const summary = await importOutstandings(db, { source: "upload", rows: bad });
    expect(summary.rejected).toHaveLength(1);
  });
});

describe("Bene Master", () => {
  it("cleans names, IFSC codes and removes identical duplicates", async () => {
    const { BeneLookup } = await import("@/lib/bene/master");
    const { loadBeneEntries } = await import("@/lib/bene/service");
    const lookup = new BeneLookup(await loadBeneEntries(db));
    expect(lookup.resolve("MANSI FABRICS")).toMatchObject({ status: "ok", accountName: "MANSI FABRICS", ifsc: "HDFC0000410" });
    expect(lookup.resolve("AKASH YOGESH MODI")).toMatchObject({ status: "ok", accountName: "AKASH MODI" });
    expect(lookup.resolve("ALFA ENTERPRISES").status).toBe("ok");
  });
  it("marks a bad IFSC and asks for a choice when a party has two accounts", async () => {
    const { BeneLookup } = await import("@/lib/bene/master");
    const { loadBeneEntries } = await import("@/lib/bene/service");
    const lookup = new BeneLookup(await loadBeneEntries(db));
    expect(lookup.resolve("AIMSITE EVENTS PRIVATE LIMITED")).toMatchObject({ status: "invalid", problems: ["INVALID_IFSC"] });
    const twin = lookup.resolve("TWIN ONE");
    expect(twin.status).toBe("choose");
    if (twin.status !== "choose") return;
    expect(twin.options).toHaveLength(2);
    expect(lookup.resolve("TWIN ONE", twin.options[1]?.key)).toMatchObject({ status: "ok", accountNumber: "50100099999999" });
    expect(lookup.resolve("TWIN ONE", "not-a-key").status).toBe("choose");
    expect(lookup.resolve("UNKNOWN PARTY").status).toBe("unmapped");
  });
  it("keeps the old copy when the new copy is empty", async () => {
    await expect(refreshBene(db, [["", "", "", "", ""]])).rejects.toThrow();
    const { loadBeneEntries } = await import("@/lib/bene/service");
    expect((await loadBeneEntries(db)).length).toBeGreaterThan(0);
  });
});

describe("batch", () => {
  it("makes one bank line for bills of one party paid together (RTGS)", async () => {
    const a = await idOf("PU001214/26-27");
    const b = await idOf("PU001215/26-27");
    const result = await createBatch(
      db,
      [
        { billId: a, amountPaise: 5585700, paidDate: TODAY },
        { billId: b, amountPaise: 4639400, paidDate: TODAY },
      ],
      NOW,
    );
    expect(result.fileName).toBe("BANK_FORMAT_2026-11-19.csv");
    const { batch } = await import("@/db/schema");
    const [saved] = await db.select().from(batch).where(eq(batch.id, result.batchId));
    expect(saved?.lineCount).toBe(1);
    expect(saved?.totalPaise).toBe(10225100);
    expect(saved?.csv).toContain("MANSI FABRICS");
    expect(saved?.csv).toContain('"BN 1317, 1320"');
    expect(saved?.csv.split("\n").at(-2)?.startsWith("T,1,102251,")).toBe(true);
  });

  it("matches the golden file for the two payments of the sheet", async () => {
    const { readFileSync } = await import("node:fs");
    const golden = readFileSync(new URL("./fixtures/bank-format-2026-11-19.csv", import.meta.url), "utf8");
    const result = await createBatch(
      db,
      [
        { billId: await idOf("U000227/26-27"), amountPaise: 4565200, paidDate: TODAY },
        { billId: await idOf("PU001552/26-27"), amountPaise: 2268000, paidDate: TODAY },
      ],
      NOW,
    );
    const { batch } = await import("@/db/schema");
    const [saved] = await db.select().from(batch).where(eq(batch.id, result.batchId));
    expect(saved?.csv).toBe(golden);
  });

  it("locks paid bills: they cannot go in a second batch", async () => {
    const id = await idOf("U000227/26-27");
    await createBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    const second = createBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    await expect(second).rejects.toBeInstanceOf(BatchBlockedError);
    const [row] = await db.select().from(bill).where(eq(bill.id, id));
    expect(row?.status).toBe("paid");
    expect(await db.select().from(payment)).toHaveLength(1);
  });

  it("keeps a paid bill locked after a new import that still lists it", async () => {
    const id = await idOf("U000227/26-27");
    await createBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    const summary = await importOutstandings(db, { source: "upload", rows: OUTSTANDING_ROWS });
    expect(summary.billsPaidWaiting).toBe(1);
    const [row] = await db.select().from(bill).where(eq(bill.id, id));
    expect(row?.status).toBe("paid");
  });

  it("blocks bills with no or bad bank details, and saves nothing", async () => {
    const bad = await idOf("PU000001/26-27");
    const unknown = await idOf("PU000002/26-27");
    const twin = await idOf("PU000003/26-27");
    const good = await idOf("U000227/26-27");
    const evaluation = await previewBatch(
      db,
      [bad, unknown, twin, good].map((billId) => ({ billId, amountPaise: 100000, paidDate: TODAY })),
      NOW,
    );
    expect(evaluation.canCreate).toBe(false);
    expect(evaluation.issues.filter((i) => i.severity === "block").map((i) => i.code).sort()).toEqual([
      "BANK_ACCOUNT_NOT_CHOSEN",
      "BENE_INVALID_IFSC",
      "BENE_UNMAPPED",
    ]);
    await expect(
      createBatch(db, [{ billId: bad, amountPaise: 100000, paidDate: TODAY }, { billId: good, amountPaise: 100000, paidDate: TODAY }], NOW),
    ).rejects.toBeInstanceOf(BatchBlockedError);
    expect(await db.select().from(payment)).toHaveLength(0);
    const [g] = await db.select().from(bill).where(eq(bill.id, good));
    expect(g?.status).toBe("open");
  });

  it("warns, but does not block, when the amount differs from the balance", async () => {
    const id = await idOf("U000227/26-27");
    const below = await previewBatch(db, [{ billId: id, amountPaise: 4000000, paidDate: TODAY }], NOW);
    expect(below.canCreate).toBe(true);
    expect(below.issues.map((i) => i.code)).toContain("AMOUNT_BELOW_BALANCE");
    const above = await previewBatch(db, [{ billId: id, amountPaise: 5000000, paidDate: TODAY }], NOW);
    expect(above.canCreate).toBe(true);
    expect(above.issues.map((i) => i.code)).toContain("AMOUNT_ABOVE_BALANCE");
    const exact = await previewBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    expect(exact.issues).toEqual([]);
  });

  it("suggests the older bill of the same party (FIFO) and the other due bills", async () => {
    const newer = await idOf("PU001412/26-27"); // due 01-Dec-2026
    const evaluation = await previewBatch(db, [{ billId: newer, amountPaise: 5313400, paidDate: TODAY }], NOW);
    const codes = evaluation.issues.filter((i) => i.severity === "suggestion").map((i) => i.code);
    // One suggestion for the party, which names the two older bills.
    expect(codes.filter((c) => c === "OLDER_BILL_NOT_SELECTED")).toHaveLength(1);
    const text = evaluation.issues.find((i) => i.code === "OLDER_BILL_NOT_SELECTED")?.message ?? "";
    expect(text).toContain("2 older bills");
    expect(text).toContain("PU001214/26-27");
    expect(evaluation.canCreate).toBe(true);
  });

  it("rejects a bad date, zero amount and an empty selection", async () => {
    const id = await idOf("U000227/26-27");
    const e1 = await previewBatch(db, [{ billId: id, amountPaise: 100, paidDate: "2026-02-30" }], NOW);
    expect(e1.issues[0]?.code).toBe("DATE_INVALID");
    const e2 = await previewBatch(db, [{ billId: id, amountPaise: 0, paidDate: TODAY }], NOW);
    expect(e2.issues[0]?.code).toBe("AMOUNT_NOT_POSITIVE");
    await expect(createBatch(db, [], NOW)).rejects.toBeInstanceOf(BatchBlockedError);
  });

  it("voids a batch: the bills can be paid again, and the audit log has the change", async () => {
    const id = await idOf("U000227/26-27");
    const { batchId } = await createBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    await voidBatch(db, batchId, "Bank rejected the file");
    const [row] = await db.select().from(bill).where(eq(bill.id, id));
    expect(row?.status).toBe("open");
    await expect(voidBatch(db, batchId, "again")).rejects.toThrow("already voided");
    const again = await createBatch(db, [{ billId: id, amountPaise: 4565200, paidDate: TODAY }], NOW);
    expect(again.batchId).not.toBe(batchId);
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["import.run", "bene.refresh", "batch.create", "batch.void"]));
  });

  it("allows only one winner when two requests pay the same bill at the same time", async () => {
    const id = await idOf("U000227/26-27");
    const sel = [{ billId: id, amountPaise: 4565200, paidDate: TODAY }];
    const results = await Promise.allSettled([createBatch(db, sel, NOW), createBatch(db, sel, NOW)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(payment)).toHaveLength(1);
  });
});

describe("a party with more than one bank account", () => {
  async function optionKeys(): Promise<string[]> {
    const { loadBeneLookup } = await import("@/lib/bene/service");
    return (await loadBeneLookup(db)).optionsOf("TWIN ONE").map((o) => o.key);
  }

  it("pays to the account that the person chose and writes it in the CSV", async () => {
    const id = await idOf("PU000003/26-27");
    const [, second] = await optionKeys();
    const created = await createBatch(db, [{ billId: id, amountPaise: 300000, paidDate: TODAY, bankKey: second as string }], NOW);
    const [paid] = await db.select().from(payment).where(eq(payment.billId, id));
    expect(paid?.accountNumber).toBe("50100099999999");
    const [row] = await db.select().from(batch).where(eq(batch.id, created.batchId));
    expect(row?.csv).toContain("50100099999999");
    expect(row?.csv).not.toContain("50100055074872");
  });

  it("blocks the batch when no account is chosen, and when the key is not known", async () => {
    const id = await idOf("PU000003/26-27");
    for (const bankKey of [undefined, "0000000000000000"]) {
      const evaluation = await previewBatch(
        db,
        [{ billId: id, amountPaise: 300000, paidDate: TODAY, ...(bankKey ? { bankKey } : {}) }],
        NOW,
      );
      expect(evaluation.canCreate).toBe(false);
      expect(evaluation.issues.map((i) => i.code)).toContain("BANK_ACCOUNT_NOT_CHOSEN");
    }
  });

  it("remembers the last choice as the default of the screen", async () => {
    const id = await idOf("PU000003/26-27");
    const [first] = await optionKeys();
    expect((await listOpenBills(db, NOW)).find((b) => b.id === id)?.bank.defaultKey).toBeUndefined();
    await createBatch(db, [{ billId: id, amountPaise: 300000, paidDate: TODAY, bankKey: first as string }], NOW);
    const [batchRow] = await db.select().from(batch);
    await voidBatch(db, batchRow?.id as string, "test");
    expect((await listOpenBills(db, NOW)).find((b) => b.id === id)?.bank).toMatchObject({ status: "choose", defaultKey: first });
  });
});

describe("bills paid on different dates", () => {
  it("makes one bank line for each date, even for the same party", async () => {
    const a = await idOf("PU001214/26-27");
    const b = await idOf("PU001215/26-27");
    const c = await idOf("PU001412/26-27");
    const created = await createBatch(
      db,
      [
        { billId: a, amountPaise: 5585700, paidDate: "2026-11-19" },
        { billId: b, amountPaise: 4639400, paidDate: "2026-11-19" },
        { billId: c, amountPaise: 5313400, paidDate: "2026-11-21" },
      ],
      NOW,
    );
    expect(created.evaluation.lines.map((l) => [l.paidDate, l.billCount])).toEqual([
      ["2026-11-19", 2],
      ["2026-11-21", 1],
    ]);
    const payments = await db.select().from(payment);
    expect(payments.map((p) => p.paidDate).sort()).toEqual(["2026-11-19", "2026-11-19", "2026-11-21"]);
    const [row] = await db.select().from(batch).where(eq(batch.id, created.batchId));
    expect(row?.lineCount).toBe(2);
    expect(row?.csv).toContain("19/11/2026");
    expect(row?.csv).toContain("21/11/2026");
  });
});
