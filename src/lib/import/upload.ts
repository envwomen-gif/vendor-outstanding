import { createHash } from "node:crypto";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import type { Cell } from "@/lib/outstanding/parse";
import { toOutstandingsLayout } from "./layout";
import { readXls, XlsError } from "./xls";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export interface ParsedUpload {
  readonly rows: Cell[][];
  readonly sha256: string;
}

/** Read the JS1 export (.xls, .xlsx or .csv) into rows. Same shape as the OUTSTANDINGS tab. */
export async function parseOutstandingUpload(fileName: string, bytes: Uint8Array): Promise<ParsedUpload> {
  if (bytes.byteLength === 0) throw new UploadError("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 5 MB.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "");
    const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
    if (result.errors.some((e) => e.type === "Quotes")) throw new UploadError("The CSV file has a broken quote.");
    return { rows: toOutstandingsLayout(result.data), sha256 };
  }

  if (lower.endsWith(".xlsx")) {
    try {
      const sheets = await readXlsxFile(Buffer.from(bytes));
      const first = sheets[0];
      if (!first) throw new UploadError("The workbook has no sheet.");
      return { rows: toOutstandingsLayout(first.data as Cell[][]), sha256 };
    } catch (error) {
      if (error instanceof UploadError) throw error;
      throw new UploadError("The .xlsx file cannot be read. Save it again as .xlsx or .csv.");
    }
  }

  if (lower.endsWith(".xls")) {
    try {
      return { rows: toOutstandingsLayout(readXls(bytes)), sha256 };
    } catch (error) {
      if (error instanceof XlsError) throw new UploadError(error.message);
      throw new UploadError("The .xls file cannot be read. Save it again as .xlsx or .csv.");
    }
  }

  throw new UploadError("Use a .xls, .xlsx or .csv file.");
}
