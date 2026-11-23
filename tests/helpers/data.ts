import type { Cell } from "@/lib/outstanding/parse";

/** Bene Master rows (ALL DETAILS A..E, no header). Contains the quirks of the real sheet. */
export const BENE_ROWS: string[][] = [
  ["MOHSHIN AKHTAR", "MOHSHIN AKHTAR", "ICIC0001236", "123601001506", ""],
  ["CHHEDA MANAGEMENT CONSULTANTS LLP", "CHHEDA MANAGEMENT CONSULTANTS LLP", "IDFB0040151", "10142541761", ""],
  ["MANSI FABRICS", "MANSI FABRICS ", "hdfc0000410", "50100055074872", ""],
  ["AKASH YOGESH MODI\r", "AKASH MODI", "SBIN0001185", "10119665287", ""],
  ["AIMSITE EVENTS PRIVATE LIMITED", "AIMSITE EVENTS PRIVATE LIMITED", "ICICI0001959", "195905005365", ""], // bad IFSC
  ["ALFA ENTERPRISES", "ALFA ENTERPRISES", "BKID0004904", "490420110000218", ""],
  ["ALFA ENTERPRISES", "ALFA ENTERPRISES", "BKID0004904", "490420110000218", ""], // identical duplicate
  ["TWIN ONE", "TWIN", "HDFC0000410", "50100055074872", ""],
  ["TWIN ONE", "TWIN", "HDFC0000410", "50100099999999", ""], // same software name, other bank account
  ["", "", "", "", ""],
];

const H = ["Account", "Type", "Doc. No#", "Date", "Ref. No.", "Due Dt", "", "", "Days", "Total AMT", "Adjusted Amt", "Bal. Amt", "Agent"];
const row = (account: string, doc: string, date: string, ref: string, due: string, adj: string, bal: string): Cell[] => [
  account, "PURC", doc, date, ref, due, "_ENV", "", "10", "0", adj, bal, "",
];

export const OUTSTANDING_ROWS: Cell[][] = [
  H,
  row("MOHSHIN AKHTAR", "U000227/26-27", "19-Nov-2026", "72", "19-Nov-2026", "51103", "45652"),
  ["Total for MOHSHIN AKHTAR", "", "", "", "", "", "", "", "", "0", "51103", "45652"],
  row("MANSI FABRICS", "PU001214/26-27", "24-Sep-2026", "1317", "08-Nov-2026", "0", "55857"),
  row("MANSI FABRICS", "PU001215/26-27", "24-Sep-2026", "1320", "08-Nov-2026", "0", "46394"),
  row("MANSI FABRICS", "PU001412/26-27", "17-Oct-2026", "1554", "01-Dec-2026", "0", "53134"),
  row("CHHEDA MANAGEMENT CONSULTANTS LLP", "PU001552/26-27", "08-Nov-2026", "CMC/2627/01313", "08-Dec-2026", "2100", "22680"),
  row("AIMSITE EVENTS PRIVATE LIMITED", "PU000001/26-27", "01-Nov-2026", "A1", "10-Dec-2026", "0", "1000"),
  row("UNKNOWN PARTY", "PU000002/26-27", "01-Nov-2026", "U1", "10-Dec-2026", "0", "2000"),
  row("TWIN ONE", "PU000003/26-27", "01-Nov-2026", "T1", "10-Dec-2026", "0", "3000"),
];
