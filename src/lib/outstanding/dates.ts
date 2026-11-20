const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const NUMERIC = /^(\d{2})-(\d{2})-(\d{4})$/;
const NAMED = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function build(day: number, monthIndex: number, year: number): string | undefined {
  if (monthIndex < 0 || monthIndex > 11) return undefined;
  if (day < 1 || day > daysInMonth(year, monthIndex)) return undefined;
  return `${pad2(day)}-${MONTHS[monthIndex]}-${year}`;
}

/**
 * Port of formatToDddMmmYyyy from the Apps Script.
 *  - empty value -> ""
 *  - Date object -> dd-MMM-yyyy in the given time zone
 *  - text "dd-mm-yyyy" or "dd-Mmm-yyyy" -> dd-MMM-yyyy
 *  - anything else, and dates that do not exist -> the original value
 */
export function formatToDddMmmYyyy(value: unknown, timeZone = "Asia/Kolkata"): string {
  if (value === null || value === undefined || value === "" || value === 0 || value === false) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return String(value);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "numeric",
      year: "numeric",
    }).formatToParts(value);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return build(get("day"), get("month") - 1, get("year")) ?? String(value);
  }

  const text = String(value).trim();

  const numeric = NUMERIC.exec(text);
  if (numeric) {
    return build(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3])) ?? (value as string);
  }

  const named = NAMED.exec(text);
  if (named) {
    const index = MONTHS.findIndex((m) => m.toLowerCase() === (named[2] ?? "").toLowerCase());
    return build(Number(named[1]), index, Number(named[3])) ?? (value as string);
  }

  return typeof value === "string" ? value : String(value);
}

/** dd-MMM-yyyy -> YYYY-MM-DD. Returns undefined when the text is not a valid date. */
export function parseDddMmmYyyyToIso(text: string): string | undefined {
  const named = NAMED.exec(text.trim());
  if (!named) return undefined;
  const index = MONTHS.findIndex((m) => m.toLowerCase() === (named[2] ?? "").toLowerCase());
  const formatted = build(Number(named[1]), index, Number(named[3]));
  if (!formatted) return undefined;
  return `${named[3]}-${pad2(index + 1)}-${named[1]}`;
}
