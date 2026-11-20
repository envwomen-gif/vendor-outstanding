import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Beneficiary, type PaidBill, buildBankCsv } from "@/lib/bank-csv";

/**
 * Golden test. The fixture is the BANK FORMAT sheet of 19-Nov-2026, rebuilt from
 * the cell values that the Sheets API returned. The test compares byte for byte.
 *
 * NOTE: replace the fixture with a file exported by the real CSV menu when it
 * is available. See the README, section "Golden files".
 */
const golden = readFileSync(
  new URL("./fixtures/bank-format-2026-11-19.csv", import.meta.url),
  "utf8",
);

const bene = new Map<string, Beneficiary>([
  ["MOHSHIN AKHTAR", { ifsc: "ICIC0001236", accountNumber: "123601001506" }],
  ["CHHEDA MANAGEMENT CONSULTANTS LLP", { ifsc: "IDFB0040151", accountNumber: "10142541761" }],
]);
const lookup = (name: string) => bene.get(name);

const bills: PaidBill[] = [
  { beneficiaryName: "MOHSHIN AKHTAR", paidDate: "2026-11-19", refNo: "72", amountPaise: 4565200 },
  {
    beneficiaryName: "CHHEDA MANAGEMENT CONSULTANTS LLP",
    paidDate: "2026-11-19",
    refNo: "CMC/2627/01313",
    amountPaise: 2268000,
  },
];

describe("bank CSV golden file", () => {
  it("is byte for byte equal to the BANK FORMAT sheet output", () => {
    const { csv } = buildBankCsv(bills, lookup);
    expect(Buffer.from(csv, "utf8").equals(Buffer.from(golden, "utf8"))).toBe(true);
  });

  it("uses \\n line endings, no BOM and no \\r", () => {
    const { csv } = buildBankCsv(bills, lookup);
    expect(csv.includes("\r")).toBe(false);
    expect(csv.charCodeAt(0)).toBe("H".charCodeAt(0));
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("gives the trailer count and total", () => {
    const { csv, totalPaise, lines } = buildBankCsv(bills, lookup);
    expect(totalPaise).toBe(6833200);
    expect(lines).toHaveLength(2);
    expect(csv.split("\n").at(-2)?.startsWith("T,2,68332,")).toBe(true);
  });

  it("writes 63 fields on each line", () => {
    const { csv } = buildBankCsv(bills, lookup);
    for (const line of csv.split("\n").filter(Boolean)) {
      expect(line.split(",")).toHaveLength(63);
    }
  });
});
