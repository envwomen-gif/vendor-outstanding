import { describe, expect, it } from "vitest";
import { buildFifo, buildSortedData } from "@/lib/outstanding/parse";
import { formatToDddMmmYyyy, parseDddMmmYyyyToIso } from "@/lib/outstanding/dates";

// Rows copied from the OUTSTANDINGS tab (columns A..M).
const HEADER = ["Account", "Type", "Doc. No#", "Date", "Ref. No.", "Due Dt", "", "", "Days", "Total AMT", "Adjusted Amt", "Bal. Amt", "Agent"];
const AARI = ["AARI", "JRNL", "001275/26-27", "30-Sep-2026", "", "", "_ENV", "", "", "0", "69990", "-69990", ""];
const AARI_TOTAL = ["Total for AARI", "", "", "", "", "", "", "", "", "0", "69990", "-69990"];
const AJAY = ["AJAY SINGH ( COMMISSION )", "JRNL", "003280/25-26", "31-Mar-2026", "", "31-Mar-2026", "_ENV", "", "233", "1150000", "23000", "1127000", ""];
const AMJAD1 = ["AMJAD ALI", "PURC", "U000210/26-27", "24-Oct-2026", "65", "23-Nov-2026", "_ENV", "", "26", "69094", "691", "68403", ""];
const BHAIRAV = ["BHAIRAV- (JOGESHWARI)", "PURC", "PU000926/26-27", "28-Aug-2026", "1101/26-27", "26-Nov-2026", "_ENV", "", "83", "24072", "0", "24072", ""];
const BLANK = ["", "", "", "", "", ""];

describe("formatToDddMmmYyyy (Apps Script port)", () => {
  it("returns an empty text for an empty value", () => {
    expect(formatToDddMmmYyyy("")).toBe("");
    expect(formatToDddMmmYyyy(null)).toBe("");
    expect(formatToDddMmmYyyy(undefined)).toBe("");
  });
  it("formats a numeric date", () => {
    expect(formatToDddMmmYyyy("31-03-2026")).toBe("31-Mar-2026");
  });
  it("keeps a named date and fixes the case", () => {
    expect(formatToDddMmmYyyy("05-Dec-2026")).toBe("05-Dec-2026");
    expect(formatToDddMmmYyyy("05-dec-2026")).toBe("05-Dec-2026");
  });
  it("formats a Date object in the given time zone", () => {
    // 19:00 UTC on 19 Nov is 00:30 on 20 Nov in India.
    expect(formatToDddMmmYyyy(new Date("2026-11-19T19:00:00Z"), "Asia/Kolkata")).toBe("20-Nov-2026");
    expect(formatToDddMmmYyyy(new Date("2026-11-19T19:00:00Z"), "UTC")).toBe("19-Nov-2026");
  });
  it("returns the original value when it is not a date", () => {
    expect(formatToDddMmmYyyy("003280/25-26")).toBe("003280/25-26");
    expect(formatToDddMmmYyyy("31-02-2026")).toBe("31-02-2026");
    expect(formatToDddMmmYyyy("31-13-2026")).toBe("31-13-2026");
    expect(formatToDddMmmYyyy("31-Foo-2026")).toBe("31-Foo-2026");
  });
  it("converts dd-MMM-yyyy to an ISO date", () => {
    expect(parseDddMmmYyyyToIso("05-Dec-2026")).toBe("2026-12-05");
    expect(parseDddMmmYyyyToIso("29-Feb-2026")).toBeUndefined();
    expect(parseDddMmmYyyyToIso("nonsense")).toBeUndefined();
  });
});

describe("buildSortedData (generateOutstandingReport port)", () => {
  const sorted = buildSortedData([HEADER, AARI, AARI_TOTAL, AJAY, BLANK, AMJAD1]);

  it("keeps the header row, like the script (it only checks column A)", () => {
    expect(sorted[0]?.[0]).toBe("Account");
  });
  it("removes blank rows and Total for rows", () => {
    expect(sorted.map((r) => r[0])).toEqual(["Account", "AARI", "AJAY SINGH ( COMMISSION )", "AMJAD ALI"]);
  });
  it("selects columns A, C, D, E, F, I, J, K, L, M", () => {
    expect(sorted[3]).toEqual([
      "AMJAD ALI", "U000210/26-27", "24-Oct-2026", "65", "23-Nov-2026", "26", "69094", "691", "68403", "",
    ]);
  });
  it("reads numbers and Date objects from the sheet", () => {
    const row = ["X", "PURC", "D1", new Date("2026-10-24T00:00:00Z"), 65, "23-11-2026", "", "", 26, 1000, 10, 990, ""];
    const out = buildSortedData([row], "UTC");
    expect(out[0]).toEqual(["X", "D1", "24-Oct-2026", "65", "23-Nov-2026", "26", "1000", "10", "990", ""]);
  });
});

describe("buildFifo (PAYMENTS DUE FIFO QUERY port)", () => {
  it("drops rows without a due date and sorts by due date", () => {
    const sorted = buildSortedData([AMJAD1, AARI, BHAIRAV, AJAY]);
    const { bills, rejected } = buildFifo(sorted);
    expect(rejected).toEqual([]);
    expect(bills.map((b) => b.docNo)).toEqual(["003280/25-26", "U000210/26-27", "PU000926/26-27"]);
  });
  it("converts amounts to paise", () => {
    const { bills } = buildFifo(buildSortedData([AJAY]));
    expect(bills[0]).toEqual({
      account: "AJAY SINGH ( COMMISSION )",
      docNo: "003280/25-26",
      date: "2026-03-31",
      dueDate: "2026-03-31",
      refNo: "",
      adjustedPaise: 2300000,
      balancePaise: 112700000,
    });
  });
  it("keeps the export order for equal due dates", () => {
    const a = ["A", "PURC", "DOC-1", "01-Nov-2026", "r1", "10-Dec-2026", "", "", "0", "1", "0", "1", ""];
    const b = ["B", "PURC", "DOC-2", "02-Nov-2026", "r2", "10-Dec-2026", "", "", "0", "1", "0", "1", ""];
    const c = ["C", "PURC", "DOC-3", "03-Nov-2026", "r3", "09-Dec-2026", "", "", "0", "1", "0", "1", ""];
    const { bills } = buildFifo(buildSortedData([a, b, c]));
    expect(bills.map((x) => x.docNo)).toEqual(["DOC-3", "DOC-1", "DOC-2"]);
  });
  it("reports a row with a bad amount or date and does not drop it silently", () => {
    const bad = ["Z", "PURC", "DOC-9", "01-Nov-2026", "", "10-Dec-2026", "", "", "0", "1", "0", "abc", ""];
    const { bills, rejected } = buildFifo(buildSortedData([bad]));
    expect(bills).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain("Amount not valid");
  });
});

describe("export quirks", () => {
  it("drops the header row quietly but reports other bad dates", () => {
    const bad = ["Z", "PURC", "DOC-9", "01-Nov-2026", "", "tomorrow", "", "", "0", "1", "0", "5", ""];
    const { bills, rejected } = buildFifo(buildSortedData([HEADER, bad, AJAY]));
    expect(bills.map((b) => b.docNo)).toEqual(["003280/25-26"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain("Date not valid");
  });
  it("removes float noise from numbers in xlsx files", () => {
    const row = ["X", "PURC", "D1", "24-Oct-2026", "", "23-Nov-2026", "", "", 26, 1000, 10, 69094.00000000001, ""];
    const { bills } = buildFifo(buildSortedData([row]));
    expect(bills[0]?.balancePaise).toBe(6909400);
  });
});
