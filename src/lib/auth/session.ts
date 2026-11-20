import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "vo_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Token: v1.<expiry in ms>.<HMAC>. No user data inside, because there is one user. */
export function createSessionToken(secret: string, now = Date.now()): string {
  const payload = `v1.${now + SESSION_MAX_AGE_SECONDS * 1000}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiry, signature] = parts as [string, string, string];
  if (version !== "v1") return false;
  const expected = Buffer.from(sign(secret, `${version}.${expiry}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  const expiresAt = Number(expiry);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and have at least 32 characters");
  }
  return secret;
}

/** Sign in is optional. It is on only when a password hash is set. */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD_HASH);
}
