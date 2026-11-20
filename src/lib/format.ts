const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Paise -> "₹1,27,000" or "₹4,834.95" (Indian digit grouping). */
export function formatInr(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = INR.format(Math.floor(abs / 100) + (abs % 100) / 100);
  const fixed = abs % 100 === 0 ? text : text.replace(/(\.\d)$/, "$10");
  return `${negative ? "-" : ""}₹${fixed}`;
}

/** YYYY-MM-DD -> dd-MMM-yyyy for screens. */
export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d}-${months[Number(m) - 1] ?? "???"}-${y}`;
}

/** Today in India as YYYY-MM-DD. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
