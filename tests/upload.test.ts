import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFifo, buildSortedData } from "@/lib/outstanding/parse";
import { UploadError, parseOutstandingUpload } from "@/lib/import/upload";

describe("upload parser", () => {
  it("reads an .xlsx export with real dates and numbers", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/js1-export.xlsx", import.meta.url)));
    const { rows, sha256 } = await parseOutstandingUpload("js1.xlsx", bytes);
    expect(sha256).toHaveLength(64);
    const { bills } = buildFifo(buildSortedData(rows));
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ account: "MANSI FABRICS", docNo: "PU001214/26-27", dueDate: "2026-11-08", balancePaise: 5585700 });
  });

  it("reads a .csv export, with a BOM and quoted commas", async () => {
    const csv = '﻿Account,Type,Doc. No#,Date,Ref. No.,Due Dt,,,Days,Total AMT,Adjusted Amt,Bal. Amt,Agent\n"A, B",PURC,D1,24-Sep-2026,r1,08-Nov-2026,,,5,100,0,"1,000.50",\n';
    const { rows } = await parseOutstandingUpload("export.csv", new TextEncoder().encode(csv));
    const { bills } = buildFifo(buildSortedData(rows));
    expect(bills[0]).toMatchObject({ account: "A, B", balancePaise: 100050 });
  });

  it("rejects an empty file, a wrong type, a big file and a broken workbook", async () => {
    await expect(parseOutstandingUpload("a.csv", new Uint8Array())).rejects.toBeInstanceOf(UploadError);
    await expect(parseOutstandingUpload("a.pdf", new Uint8Array([1]))).rejects.toBeInstanceOf(UploadError);
    await expect(parseOutstandingUpload("a.csv", new Uint8Array(6 * 1024 * 1024))).rejects.toBeInstanceOf(UploadError);
    await expect(parseOutstandingUpload("a.xlsx", new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(UploadError);
  });
});
