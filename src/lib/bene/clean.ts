/**
 * Text cleaning for Bene Master and the outstanding export.
 * The same function is used for both sides of a name match, so a hidden
 * space or carriage return cannot break a lookup.
 */
export function cleanName(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u00a0\u200b-\u200d\ufeff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanIfsc(value: unknown): string {
  return cleanName(value).replace(/\s+/g, "").toUpperCase();
}

/** Remove spaces and hyphens from an account number. Digits stay as they are. */
export function cleanAccountNumber(value: unknown): string {
  return cleanName(value).replace(/[\s-]+/g, "");
}

export function cleanEmail(value: unknown): string {
  return cleanName(value).toLowerCase();
}
