import { requireEnv } from "@/lib/sheets/google";

export function outstandingSheet(): { id: string; range: string } {
  const tab = process.env.OUTSTANDING_TAB ?? "OUTSTANDINGS "; // the real tab name ends with a space
  return { id: requireEnv("OUTSTANDING_SHEET_ID"), range: `'${tab.replace(/'/g, "''")}'!A:M` };
}

export function beneSheet(): { id: string; range: string } {
  const tab = process.env.BENE_TAB ?? "ALL DETAILS";
  // Row 1 is the header row. The data starts in row 2.
  return { id: requireEnv("BENE_SHEET_ID"), range: `'${tab.replace(/'/g, "''")}'!A2:E` };
}
