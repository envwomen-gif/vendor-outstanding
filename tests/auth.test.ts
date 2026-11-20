import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/lib/auth/throttle";
import { createTestDb } from "./helpers/db";

const SECRET = "x".repeat(32);

describe("password", () => {
  it("accepts the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("makes a different hash each time (random salt)", async () => {
    expect(await hashPassword("same password 123")).not.toBe(await hashPassword("same password 123"));
  });
});

describe("session token", () => {
  it("accepts a fresh token", () => {
    expect(verifySessionToken(SECRET, createSessionToken(SECRET, 1000), 2000)).toBe(true);
  });
  it("rejects an expired token, a changed token, another secret and an empty token", () => {
    const token = createSessionToken(SECRET, 1000);
    expect(verifySessionToken(SECRET, token, 1000 + 13 * 3600 * 1000)).toBe(false);
    expect(verifySessionToken(SECRET, token.replace("v1.", "v1.9"), 2000)).toBe(false);
    expect(verifySessionToken("y".repeat(32), token, 2000)).toBe(false);
    expect(verifySessionToken(SECRET, undefined)).toBe(false);
    expect(verifySessionToken(SECRET, "a.b")).toBe(false);
  });
});

describe("login throttle", () => {
  it("blocks after 8 failures and unblocks after a success", async () => {
    const db = await createTestDb();
    for (let i = 0; i < 7; i++) await recordLoginFailure(db, "1.2.3.4");
    expect(await isLoginBlocked(db, "1.2.3.4")).toBe(false);
    await recordLoginFailure(db, "1.2.3.4");
    expect(await isLoginBlocked(db, "1.2.3.4")).toBe(true);
    expect(await isLoginBlocked(db, "5.6.7.8")).toBe(false);
    await clearLoginFailures(db, "1.2.3.4");
    expect(await isLoginBlocked(db, "1.2.3.4")).toBe(false);
  });
});
