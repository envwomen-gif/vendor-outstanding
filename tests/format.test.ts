import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format";

describe("dates on the screen always have a month name", () => {
  it("shows a date as dd-MMM-yyyy", () => {
    expect(formatDisplayDate("2026-11-23")).toBe("23-Nov-2026");
    expect(formatDisplayDate("2026-09-05")).toBe("05-Sep-2026");
  });

  it("shows a moment as dd-MMM-yyyy, time, in India time", () => {
    expect(formatDisplayDateTime(new Date("2026-11-23T06:50:00Z"))).toBe("23-Nov-2026, 12:20 pm");
    expect(formatDisplayDateTime("2026-09-05T18:30:00Z")).toBe("06-Sep-2026, 12:00 am"); // midnight in India
    expect(formatDisplayDateTime(new Date("2027-01-02T09:05:00Z"))).toBe("02-Jan-2027, 2:35 pm");
  });
});
