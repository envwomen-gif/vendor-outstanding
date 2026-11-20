/** IFSC: 4 letters, the digit 0, then 6 letters or digits. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers have 9 to 18 digits. */
const ACCOUNT_PATTERN = /^\d{9,18}$/;

export interface Beneficiary {
  readonly ifsc: string;
  readonly accountNumber: string;
}

export type BeneficiaryProblem = "INVALID_IFSC" | "INVALID_ACCOUNT_NUMBER";

export function isValidIfsc(value: string): boolean {
  return IFSC_PATTERN.test(value);
}

export function isValidAccountNumber(value: string): boolean {
  return ACCOUNT_PATTERN.test(value);
}

/** Returns the problems of a beneficiary. An empty list means it is valid. */
export function findBeneficiaryProblems(b: Beneficiary): BeneficiaryProblem[] {
  const problems: BeneficiaryProblem[] = [];
  if (!isValidIfsc(b.ifsc)) problems.push("INVALID_IFSC");
  if (!isValidAccountNumber(b.accountNumber)) problems.push("INVALID_ACCOUNT_NUMBER");
  return problems;
}
