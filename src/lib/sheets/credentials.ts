export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly [key: string]: unknown;
}

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

/** Escape raw control characters (new line, tab) that sit inside JSON strings. */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/**
 * Fix characters that rich text editors and chat tools put in a paste:
 * a byte order mark, no-break spaces, and curly quotes instead of straight quotes.
 */
function normalizePastedText(text: string): string {
  return text
    .replace(/^\ufeff/, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

/** Facts about the shape of the value. They never contain the value itself. */
export function describeCredentialShape(raw: string): string {
  const t = raw.trim();
  const first = t.codePointAt(0);
  const facts = [
    `length ${raw.length}`,
    `first character ${first === undefined ? "none" : `U+${first.toString(16).toUpperCase().padStart(4, "0")}`}`,
    `last character ${t.length === 0 ? "none" : `U+${(t.codePointAt(t.length - 1) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`}`,
    `lines ${raw.split("\n").length}`,
    `curly quotes ${/[\u201c\u201d]/.test(raw) ? "yes" : "no"}`,
    `has "client_email" ${raw.includes("client_email") ? "yes" : "no"}`,
    `has "private_key" ${raw.includes("private_key") ? "yes" : "no"}`,
    `has end marker ${raw.includes("END PRIVATE KEY") ? "yes" : "no"}`,
    `ends with brace ${t.endsWith("}") ? "yes" : "no"}`,
  ];
  return facts.join(", ");
}

function stripWrappingQuotes(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    // A JSON string that holds JSON (all quotes escaped) is a second possible shape.
    return inner.includes('\\"') ? inner.replace(/\\"/g, '"') : inner;
  }
  return t;
}

/**
 * Read the GOOGLE_SERVICE_ACCOUNT_JSON value. It accepts the file text as it is,
 * the file text with real new lines inside the private key (a common result of
 * copy and paste), text with wrapping quotes, and base64 of the file.
 * The error messages never contain the secret.
 */
export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey {
  if (!raw || raw.trim() === "") throw new CredentialsError("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");

  let text = stripWrappingQuotes(normalizePastedText(raw));
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) text = decoded;
    } catch {
      /* fall through to the error below */
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(escapeControlCharsInStrings(text));
    } catch {
      throw new CredentialsError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full text of the key file, from the first { to the last }. " +
          `Shape of the stored value: ${describeCredentialShape(raw)}.`,
      );
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CredentialsError("GOOGLE_SERVICE_ACCOUNT_JSON must be the service account key object.");
  }
  const key = parsed as Record<string, unknown>;
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string") {
    throw new CredentialsError(
      "GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key. Use the JSON key file of the service account.",
    );
  }
  // Some tools turn the \n escapes of the private key into the two characters \ and n.
  const privateKey = key.private_key.includes("\\n") ? key.private_key.replace(/\\n/g, "\n") : key.private_key;
  return { ...key, client_email: key.client_email, private_key: privateKey };
}
