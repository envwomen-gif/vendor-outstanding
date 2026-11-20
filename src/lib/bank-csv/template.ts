/**
 * LOCKED BANK CSV TEMPLATE.
 *
 * This file is the only place that defines the bank file layout. It copies the
 * "BANK FORMAT" sheet of the Vendor Outstanding spreadsheet. Do not change a
 * value here unless the bank gives a new format. Any change fails the
 * fingerprint test in tests/bank-csv.template.test.ts.
 *
 * Column letters are the sheet column letters. Indexes are zero-based.
 */
export const TEMPLATE = Object.freeze({
  /** The export writes a rectangle: each line has this number of fields (A..BK). */
  columnCount: 63,
  /** First line of the file. */
  headerRow: Object.freeze(["H", "P"] as const),
  payment: Object.freeze({
    recordType: { index: 0, letter: "A", value: "P" },
    productCode: { index: 1, letter: "B", value: "ACH" },
    paymentMode: { index: 2, letter: "C", value: "BA" },
    channel: { index: 6, letter: "G", value: "IN" },
    branch: { index: 7, letter: "H", value: "BOM" },
    debitAccount: { index: 8, letter: "I", value: "22805140774" },
    paidDate: { index: 9, letter: "J" },
    beneficiaryName: { index: 10, letter: "K" },
    ifsc: { index: 15, letter: "P" },
    accountNumber: { index: 19, letter: "T" },
    reference: { index: 20, letter: "U" },
    currency: { index: 37, letter: "AL", value: "INR" },
    amount: { index: 38, letter: "AM" },
  }),
  trailer: Object.freeze({
    recordType: { index: 0, letter: "A", value: "T" },
    count: { index: 1, letter: "B" },
    total: { index: 2, letter: "C" },
  }),
  /** Text that the sheet puts before the Ref Nos in the reference column. */
  referencePrefix: "BN ",
  /** Text that joins the Ref Nos of the bills that one payment line covers. */
  referenceSeparator: ", ",
  lineEnding: "\n",
} as const);

export type Template = typeof TEMPLATE;
