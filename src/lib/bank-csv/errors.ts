export type CsvErrorCode =
  | "NO_BILLS"
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "MISSING_BENEFICIARY"
  | "INVALID_IFSC"
  | "INVALID_ACCOUNT_NUMBER"
  | "NON_POSITIVE_TOTAL";

/** Error with a code that the screen can map to a clear message. */
export class BankCsvError extends Error {
  readonly code: CsvErrorCode;
  readonly beneficiaryName: string | undefined;

  constructor(code: CsvErrorCode, message: string, beneficiaryName?: string) {
    super(message);
    this.name = "BankCsvError";
    this.code = code;
    this.beneficiaryName = beneficiaryName;
  }
}
