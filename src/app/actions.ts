"use server";

import { headers } from "next/headers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { writeAudit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, getSessionSecret } from "@/lib/auth/session";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/lib/auth/throttle";
import { BatchBlockedError, createBatch, previewBatch, voidBatch } from "@/lib/batch/service";
import type { Evaluation, Selection } from "@/lib/batch/evaluate";
import { refreshBene } from "@/lib/bene/service";
import { ImportError, type ImportSummary, importOutstandings } from "@/lib/import/service";
import { parseOutstandingUpload, UploadError } from "@/lib/import/upload";
import { beneSheet, outstandingSheet } from "@/lib/server/config";
import { readRange, SheetsError } from "@/lib/sheets/google";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; details?: string[] };

function fail(error: unknown): { ok: false; message: string; details?: string[] } {
  if (error instanceof ImportError) {
    return { ok: false, message: error.message, details: error.rejected.slice(0, 20).map((r) => `${r.account} ${r.docNo}: ${r.reason}`) };
  }
  if (error instanceof UploadError || error instanceof SheetsError) return { ok: false, message: error.message };
  console.error(error);
  return { ok: false, message: "Something went wrong. Nothing was changed. Try again." };
}

// ---------- sign in ----------

export async function loginAction(_prev: { message: string } | undefined, formData: FormData): Promise<{ message: string }> {
  const password = String(formData.get("password") ?? "");
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) redirect("/"); // sign in is off

  const db = getDb();
  const forwarded = (await headers()).get("x-forwarded-for") ?? "unknown";
  const key = forwarded.split(",")[0]?.trim() || "unknown";

  if (await isLoginBlocked(db, key)) return { message: "Too many wrong passwords. Wait 15 minutes." };
  if (!(await verifyPassword(password, hash))) {
    await recordLoginFailure(db, key);
    await writeAudit(db, "auth.login_failed", "session", "", { key });
    return { message: "The password is not correct." };
  }
  await clearLoginFailures(db, key);
  await writeAudit(db, "auth.login", "session", "", {});
  (await cookies()).set(SESSION_COOKIE, createSessionToken(getSessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Bene Master ----------

export async function refreshBeneAction(): Promise<ActionResult<{ rows: number; withProblems: number }>> {
  try {
    const { id, range } = beneSheet();
    const rows = await readRange(id, range);
    return { ok: true, data: await refreshBene(getDb(), rows) };
  } catch (error) {
    return fail(error);
  }
}

// ---------- import ----------

export async function importFromSheetAction(): Promise<ActionResult<ImportSummary>> {
  try {
    const { id, range } = outstandingSheet();
    const rows = await readRange(id, range);
    return { ok: true, data: await importOutstandings(getDb(), { source: "sheet", rows }) };
  } catch (error) {
    return fail(error);
  }
}

export async function importFromUploadAction(formData: FormData): Promise<ActionResult<ImportSummary>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file first." };
    const parsed = await parseOutstandingUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    return {
      ok: true,
      data: await importOutstandings(getDb(), { source: "upload", rows: parsed.rows, fileName: file.name, fileSha256: parsed.sha256 }),
    };
  } catch (error) {
    return fail(error);
  }
}

// ---------- batches ----------

function cleanSelections(input: readonly Selection[]): Selection[] {
  return input.map((s) => ({
    billId: String(s.billId),
    amountPaise: Number(s.amountPaise),
    paidDate: String(s.paidDate),
    ...(s.bankKey ? { bankKey: String(s.bankKey) } : {}),
  }));
}

export async function previewBatchAction(selections: Selection[]): Promise<ActionResult<Evaluation>> {
  try {
    return { ok: true, data: await previewBatch(getDb(), cleanSelections(selections)) };
  } catch (error) {
    return fail(error);
  }
}

export async function createBatchAction(selections: Selection[]): Promise<ActionResult<{ batchId: string }>> {
  try {
    const created = await createBatch(getDb(), cleanSelections(selections));
    return { ok: true, data: { batchId: created.batchId } };
  } catch (error) {
    if (error instanceof BatchBlockedError) {
      return {
        ok: false,
        message: "The batch has problems. Nothing was saved.",
        details: error.evaluation.issues.filter((i) => i.severity === "block").map((i) => i.message),
      };
    }
    // A second request for the same bill hits the database lock.
    if (error instanceof Error && /payment_active_bill_uq|duplicate key/.test(error.message)) {
      return { ok: false, message: "A bill in this batch is already paid. Reload the page." };
    }
    return fail(error);
  }
}

export async function voidBatchAction(batchId: string, reason: string): Promise<ActionResult<null>> {
  try {
    await voidBatch(getDb(), batchId, reason);
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof Error && /voided|not found/i.test(error.message)) return { ok: false, message: error.message };
    return fail(error);
  }
}
