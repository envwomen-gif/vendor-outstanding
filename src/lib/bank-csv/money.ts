/** Amounts are whole numbers of paise. This avoids rounding errors. */

const RUPEES_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * Parse a rupee amount from the sheet or the JS1 export, for example
 * "₹1,127,000", "45652" or "4834.95". Returns paise.
 */
export function parseRupeesToPaise(input: string | number): number {
  const text = typeof input === "number" ? String(input) : input;
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (!RUPEES_PATTERN.test(cleaned)) {
    throw new RangeError(`Not a valid rupee amount: "${text}"`);
  }
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Amount is too large: "${text}"`);
  }
  return negative ? -paise : paise;
}

/**
 * Show paise as the sheet shows a number: no thousands separator, no
 * trailing zeros. 4565200 -> "45652", 483495 -> "4834.95", 483490 -> "4834.9".
 */
export function formatPaiseAsSheetNumber(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError("Paise must be a safe integer");
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : String(whole);
  return negative ? `-${text}` : text;
}
