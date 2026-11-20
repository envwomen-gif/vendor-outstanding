const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const FULL_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const NUMERIC = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const NAMED = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/;

interface DateParts {
  day: number;
  monthIndex: number;
  year: number;
}

/** Month index for "Nov", "november" or "Sept". Returns -1 when the text is not a month. */
function monthIndexFromName(name: string): number {
  const lower = name.toLowerCase();
  return FULL_MONTHS.findIndex((full) => lower.length >= 3 && full.startsWith(lower));
}

/**
 * Reads the date texts that the sheet shows: "08-Nov-2026", "8-Nov-2026", "8-November-2026" and
 * "08-11-2026". A numeric date whose second part is above 12 and whose first part is 12 or less
 * can only be month-day ("10-29-2026"), so it is read that way. Every other numeric date is day-month.
 */
function parseDateParts(text: string): DateParts | undefined {
  const numeric = NUMERIC.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (second > 12 && first <= 12) return { day: second, monthIndex: first - 1, year };
    return { day: first, monthIndex: second - 1, year };
  }
  const named = NAMED.exec(text);
  if (named) {
    return { day: Number(named[1]), monthIndex: monthIndexFromName(named[2] ?? ""), year: Number(named[3]) };
  }
  return undefined;
}

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

  const parts = parseDateParts(text);
  if (parts) return build(parts.day, parts.monthIndex, parts.year) ?? (value as string);

  return typeof value === "string" ? value : String(value);
}

/** Date text from the sheet -> YYYY-MM-DD. Returns undefined when the text is not a valid date. */
export function parseDddMmmYyyyToIso(text: string): string | undefined {
  const parts = parseDateParts(text.trim());
  if (!parts || !build(parts.day, parts.monthIndex, parts.year)) return undefined;
  return `${parts.year}-${pad2(parts.monthIndex + 1)}-${pad2(parts.day)}`;
}
