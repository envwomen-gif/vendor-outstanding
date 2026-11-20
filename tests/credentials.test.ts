import { describe, expect, it } from "vitest";
import { CredentialsError, describeCredentialShape, parseServiceAccountKey } from "@/lib/sheets/credentials";

const PEM = "-----BEGIN PRIVATE KEY-----\nABC\nDEF\n-----END PRIVATE KEY-----\n";
const base = { type: "service_account", client_email: "env-sheets@env-women.iam.gserviceaccount.com", private_key: PEM };
const good = JSON.stringify(base); // private_key has \n escapes

describe("parseServiceAccountKey", () => {
  it("reads the key file text as it is", () => {
    const key = parseServiceAccountKey(good);
    expect(key.client_email).toBe(base.client_email);
    expect(key.private_key).toBe(PEM);
  });

  it("reads pretty-printed text with spaces and new lines", () => {
    expect(parseServiceAccountKey(JSON.stringify(base, null, 2) + "\n").private_key).toBe(PEM);
  });

  it("reads text with real new lines inside the private key (bad paste)", () => {
    const broken = `{"type":"service_account","client_email":"${base.client_email}","private_key":"${PEM}"}`;
    expect(() => JSON.parse(broken)).toThrow();
    expect(parseServiceAccountKey(broken).private_key).toBe(PEM);
  });

  it("reads text with wrapping quotes", () => {
    expect(parseServiceAccountKey(`'${good}'`).client_email).toBe(base.client_email);
    expect(parseServiceAccountKey(`"${good.replace(/"/g, '\\"')}"`).client_email).toBe(base.client_email);
  });

  it("reads base64 text", () => {
    expect(parseServiceAccountKey(Buffer.from(good).toString("base64")).private_key).toBe(PEM);
  });

  it("fixes a private key with literal backslash-n characters", () => {
    const literal = JSON.stringify({ ...base, private_key: PEM.replace(/\n/g, "\\n") });
    expect(parseServiceAccountKey(literal).private_key).toBe(PEM);
  });

  it("gives clear errors that do not contain the secret", () => {
    for (const bad of [undefined, "", "   ", "not json at all SECRET123", "[]", '{"client_email":"a"}']) {
      try {
        parseServiceAccountKey(bad);
        throw new Error("should fail");
      } catch (e) {
        expect(e).toBeInstanceOf(CredentialsError);
        expect((e as Error).message).not.toContain("SECRET123");
      }
    }
  });
});

describe("pasted text from rich text tools", () => {
  it("reads text with curly quotes, a byte order mark and no-break spaces", () => {
    const rich = "\ufeff" + JSON.stringify(base, null, 2).replace(/"/g, (m, i: number) => (i % 2 ? "\u201d" : "\u201c")).replace(/ /g, "\u00a0");
    expect(parseServiceAccountKey(rich).client_email).toBe(base.client_email);
  });

  it("describes the shape without leaking the value", () => {
    const shape = describeCredentialShape('{"private_key":"TOPSECRET');
    expect(shape).toContain("has \"private_key\" yes");
    expect(shape).toContain("ends with brace no");
    expect(shape).not.toContain("TOPSECRET");
  });

  it("puts the shape in the error for an unreadable value", () => {
    try {
      parseServiceAccountKey("{ broken TOPSECRET");
      throw new Error("should fail");
    } catch (e) {
      expect((e as Error).message).toContain("Shape of the stored value");
      expect((e as Error).message).not.toContain("TOPSECRET");
    }
  });
});
