import { GoogleAuth } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export class SheetsError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SheetsError";
    this.status = status;
  }
}

let cachedAuth: GoogleAuth | undefined;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new SheetsError("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  let credentials: unknown;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new SheetsError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  cachedAuth = new GoogleAuth({ credentials: credentials as Record<string, unknown>, scopes: [SCOPE] });
  return cachedAuth;
}

/**
 * Read a range as displayed text. This code only reads. The scope has no
 * write right, so the app can never change the Google Sheets.
 */
export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const client = await getAuth().getClient();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;
  try {
    const response = await client.request<{ values?: string[][] }>({ url, method: "GET" });
    return response.data.values ?? [];
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 403 || status === 404) {
      throw new SheetsError(
        "The service account cannot open this sheet. Share the sheet with the service account email.",
        status,
      );
    }
    throw new SheetsError("Google Sheets did not answer. Try again in a minute.", status);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new SheetsError(`${name} is not set`);
  return value;
}
