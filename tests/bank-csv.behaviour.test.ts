import { describe, expect, it } from "vitest";
import {
  BankCsvError,
  type PaidBill,
  bankCsvFileName,
  buildBankCsv,
  escapeCsvField,
  findBeneficiaryProblems,
  formatPaiseAsSheetNumber,
  formatPaidDate,
  parseRupeesToPaise,
} from "@/lib/bank-csv";

const good = { ifsc: "HDFC0000410", accountNumber: "50100055074872" };
const lookup = (name: string) => (name === "UNKNOWN" ? undefined : good);

function bill(over: Partial<PaidBill> = {}): PaidBill {
  return {
    beneficiaryName: "MANSI FABRICS",
    paidDate: "2026-11-19",
    refNo: "1317",
    amountPaise: 5585700,
    ...over,
  };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BankCsvError ? e.code : "OTHER";
  }
  return undefined;
}

describe("grouping (many bills in one RTGS)", () => {
  it("merges bills of the same party and date into one line", () => {
    const result = buildBankCsv(
      [bill(), bill({ refNo: "1320", amountPaise: 4639400 }), bill({ refNo: "1321", amountPaise: 5209600 })],
      lookup,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.amountPaise).toBe(5585700 + 4639400 + 5209600);
    expect(result.lines[0]?.reference).toBe("BN 1317, 1320, 1321");
    expect(result.lines[0]?.billCount).toBe(3);
  });

  it("makes separate lines for different dates or parties, in first-seen order", () => {
    const result = buildBankCsv(
      [
        bill({ beneficiaryName: "B PARTY" }),
        bill({ beneficiaryName: "A PARTY" }),
        bill({ beneficiaryName: "B PARTY", paidDate: "2026-11-20" }),
        bill({ beneficiaryName: "B PARTY", refNo: "2" }),
      ],
      lookup,
    );
    expect(result.lines.map((l) => `${l.paidDate} ${l.beneficiaryName}`)).toEqual([
      "2026-11-19 B PARTY",
      "2026-11-19 A PARTY",
      "2026-11-20 B PARTY",
    ]);
    expect(result.lines[0]?.reference).toBe("BN 1317, 2");
  });

  it("leaves the reference empty when no bill has a Ref No", () => {
    const result = buildBankCsv([bill({ refNo: "" })], lookup);
    expect(result.lines[0]?.reference).toBe("");
  });
});

describe("blocking errors", () => {
  it("rejects an empty list", () => {
    expect(code(() => buildBankCsv([], lookup))).toBe("NO_BILLS");
  });
  it("rejects a party that is not in Bene Master", () => {
    expect(code(() => buildBankCsv([bill({ beneficiaryName: "UNKNOWN" })], lookup))).toBe("MISSING_BENEFICIARY");
  });
  it("rejects a blank party name", () => {
    expect(code(() => buildBankCsv([bill({ beneficiaryName: "" })], lookup))).toBe("MISSING_BENEFICIARY");
  });
  it("rejects a bad IFSC", () => {
    const bad = () => ({ ifsc: "ICICI0001959", accountNumber: "195905005365" });
    expect(code(() => buildBankCsv([bill()], bad))).toBe("INVALID_IFSC");
  });
  it("rejects a bad account number", () => {
    const bad = () => ({ ifsc: "HDFC0000410", accountNumber: "1234" });
    expect(code(() => buildBankCsv([bill()], bad))).toBe("INVALID_ACCOUNT_NUMBER");
  });
  it("rejects a total that is zero or less", () => {
    expect(code(() => buildBankCsv([bill({ amountPaise: 0 })], lookup))).toBe("NON_POSITIVE_TOTAL");
    expect(code(() => buildBankCsv([bill({ amountPaise: -5 })], lookup))).toBe("NON_POSITIVE_TOTAL");
  });
  it("rejects an amount that is not a whole number of paise", () => {
    expect(code(() => buildBankCsv([bill({ amountPaise: 10.5 })], lookup))).toBe("INVALID_AMOUNT");
  });
  it("rejects a date that does not exist", () => {
    expect(code(() => buildBankCsv([bill({ paidDate: "2026-02-30" })], lookup))).toBe("INVALID_DATE");
    expect(code(() => buildBankCsv([bill({ paidDate: "19-11-2026" })], lookup))).toBe("INVALID_DATE");
  });
});

describe("helpers", () => {
  it("formats the paid date as dd/mm/yyyy", () => {
    expect(formatPaidDate("2026-01-05")).toBe("05/01/2026");
  });
  it("quotes fields like the Apps Script export", () => {
    expect(escapeCsvField("A, B")).toBe('"A, B"');
    expect(escapeCsvField('SAY "HI"')).toBe('"SAY ""HI"""');
    expect(escapeCsvField("PLAIN")).toBe("PLAIN");
  });
  it("quotes a reference that has a comma", () => {
    const r = buildBankCsv([bill(), bill({ refNo: "1320" })], lookup);
    expect(r.csv).toContain('"BN 1317, 1320"');
  });
  it("shows paise like the sheet shows a number", () => {
    expect(formatPaiseAsSheetNumber(4565200)).toBe("45652");
    expect(formatPaiseAsSheetNumber(483495)).toBe("4834.95");
    expect(formatPaiseAsSheetNumber(483490)).toBe("4834.9");
    expect(formatPaiseAsSheetNumber(5)).toBe("0.05");
  });
  it("parses rupee text", () => {
    expect(parseRupeesToPaise("₹1,127,000")).toBe(112700000);
    expect(parseRupeesToPaise("4834.95")).toBe(483495);
    expect(parseRupeesToPaise("-69990")).toBe(-6999000);
    expect(parseRupeesToPaise(45652)).toBe(4565200);
    expect(() => parseRupeesToPaise("12.345")).toThrow(RangeError);
    expect(() => parseRupeesToPaise("abc")).toThrow(RangeError);
  });
  it("finds beneficiary problems", () => {
    expect(findBeneficiaryProblems({ ifsc: "ICICI0001959", accountNumber: "195905005365" })).toEqual(["INVALID_IFSC"]);
    expect(findBeneficiaryProblems(good)).toEqual([]);
  });
  it("names the file with the India date", () => {
    // 2026-11-19 20:00 UTC is already 20 Nov in India (UTC+5:30).
    expect(bankCsvFileName(new Date("2026-11-19T20:00:00Z"))).toBe("BANK_FORMAT_2026-11-20.csv");
    expect(bankCsvFileName(new Date("2026-11-19T10:00:00Z"))).toBe("BANK_FORMAT_2026-11-19.csv");
  });
});

describe("bills of one party with different bank accounts", () => {
  const lookup = () => undefined;
  const base = { beneficiaryName: "TWIN", paidDate: "2026-11-19", refNo: "R", amountPaise: 100000 };

  it("go on two lines, and the chosen account is used without the lookup", () => {
    const result = buildBankCsv(
      [
        { ...base, ifsc: "HDFC0000410", accountNumber: "50100055074872" },
        { ...base, ifsc: "HDFC0000410", accountNumber: "50100099999999" },
      ],
      lookup,
    );
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((l) => l.accountNumber)).toEqual(["50100055074872", "50100099999999"]);
  });

  it("stay on one line when the account is the same", () => {
    const account = { ifsc: "HDFC0000410", accountNumber: "50100055074872" };
    const result = buildBankCsv([{ ...base, ...account }, { ...base, ...account, refNo: "S" }], lookup);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.reference).toBe("BN R, S");
  });
});
