import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UploadError, parseOutstandingUpload } from "@/lib/import/upload";
import { toOutstandingsLayout } from "@/lib/import/layout";
import { readXls } from "@/lib/import/xls";
import { importOutstandings } from "@/lib/import/service";
import { bill } from "@/db/schema";
import { buildFifo, buildSortedData } from "@/lib/outstanding/parse";
import { createTestDb } from "./helpers/db";

/**
 * tests/fixtures/js1-raw-export.xls has the layout of a raw JS1 export (wide, with "Total for" rows,
 * a journal row without a due date, real date cells, text with new lines, an accent letter).
 * It has 400 bills in 300 parties, and enough text to fill the shared string table over many records.
 */
const bytes = () => new Uint8Array(readFileSync(new URL("./fixtures/js1-raw-export.xls", import.meta.url)));

describe("raw JS1 export in .xls format", () => {
  it("reads the cells: text, numbers and dates", () => {
    const rows = readXls(bytes());
    expect(rows[0]?.[0]).toBe("Account");
    expect(rows[0]?.[4]).toBe("Doc. No#");
    const first = rows[1] ?? [];
    expect(first[0]).toBe("PARTY 0001 TEXTILES & SONS");
    expect(first[4]).toBe("PU000001/26-27");
    expect(first[5]).toEqual(new Date(Date.UTC(2026, 8, 8))); // a real date cell, no text
    expect(first[13]).toBe(1037.25);
    expect(String(first[9])).toContain("line two with, comma and \"quotes\"");
  });

  it("gives the bills in the same way as the sheet does", async () => {
    const { rows } = await parseOutstandingUpload("PRATHAM.XLS", bytes());
    const { bills, rejected } = buildFifo(buildSortedData(rows));
    expect(rejected).toEqual([]);
    expect(bills).toHaveLength(400); // "Total for" rows and the journal row without a due date are gone
    const bill = bills.find((b) => b.docNo === "PU000001/26-27");
    expect(bill).toMatchObject({
      account: "PARTY 0001 TEXTILES & SONS",
      date: "2026-09-08",
      dueDate: "2026-09-24",
      refNo: "R1",
      adjustedPaise: 50000,
      balancePaise: 103725,
    });
    expect(bills.some((b) => b.account === "PARTY 0050 TEXTILES & SONS CAFÉ")).toBe(true);
    expect(bills.at(-1)?.account).toMatch(/^PARTY \d{4} /);
    // FIFO order: the oldest due date first.
    const dues = bills.map((b) => b.dueDate);
    expect([...dues].sort()).toEqual(dues);
  });

  it("imports into the database, and a second import of the same file adds nothing", async () => {
    const db = await createTestDb();
    const parsed = await parseOutstandingUpload("PRATHAM.XLS", bytes());
    const input = { source: "upload" as const, rows: parsed.rows, fileName: "PRATHAM.XLS", fileSha256: parsed.sha256 };
    const first = await importOutstandings(db, input);
    expect(first).toMatchObject({ billsNew: 400, rejected: [] });
    expect(await db.select().from(bill)).toHaveLength(400);
    const second = await importOutstandings(db, input);
    expect(second).toMatchObject({ billsNew: 0, billsClosed: 0 });
  });

  it("gives the same file the same fingerprint", async () => {
    const a = await parseOutstandingUpload("a.xls", bytes());
    const b = await parseOutstandingUpload("b.XLS", bytes());
    expect(a.sha256).toBe(b.sha256);
  });

  it("rejects a file that is not .xls, and a file that is cut", async () => {
    await expect(parseOutstandingUpload("a.xls", new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(UploadError);
    await expect(parseOutstandingUpload("a.xls", bytes().subarray(0, 40_000))).rejects.toBeInstanceOf(UploadError);
  });
});

describe("layout of the raw export", () => {
  const header = ["Account", "Junk", "Type", "Doc. No#", "Date", "Ref. No.", "Due Dt", "Days", "Total AMT", "Adjusted Amt", "Bal. Amt", "Agent"];

  it("finds the columns by name, also after other rows", () => {
    const rows = toOutstandingsLayout([
      ["Report of vendors"],
      header,
      ["A", "x", "PURC", "D1", "09/30/2026", "R1", "10/30/2026", 5, 150, 50, 100, "AG"],
    ]);
    expect(rows).toEqual([["A", "PURC", "D1", "09/30/2026", "R1", "10/30/2026", null, null, 5, 150, 50, 100, "AG"]]);
  });

  it("does not change rows that have no JS1 header (the OUTSTANDINGS tab)", () => {
    const rows = [["A", "PURC", "D1", "30-Sep-2026", "R1", "30-Oct-2026"]];
    expect(toOutstandingsLayout(rows)).toEqual(rows);
  });

  it("reads month/day/year text dates of a .csv export", async () => {
    const csv = `${header.join(",")}\nA,x,PURC,D1,09/30/2026,R1,10/30/2026,5,150,50,100,AG\n`;
    const { rows } = await parseOutstandingUpload("export.csv", new TextEncoder().encode(csv));
    const { bills, rejected } = buildFifo(buildSortedData(rows));
    expect(rejected).toEqual([]);
    expect(bills[0]).toMatchObject({ docNo: "D1", date: "2026-09-30", dueDate: "2026-10-30", balancePaise: 10000 });
  });
});
