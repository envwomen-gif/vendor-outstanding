import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, batch, bill, payment } from "@/db/schema";
import { voidBatch } from "@/lib/batch/service";
import { createInstantBatch, INSTANT_MAX_PAISE, InstantPaymentError } from "@/lib/batch/instant";
import { refreshBene, loadBeneLookup } from "@/lib/bene/service";
import { importOutstandings } from "@/lib/import/service";
import { getBatch, listInstantParties } from "@/lib/queries";
import { BENE_ROWS, OUTSTANDING_ROWS } from "./helpers/data";
import { createTestDb } from "./helpers/db";

const NOW = new Date("2026-11-23T06:00:00Z");
const TODAY = "2026-11-23";
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await refreshBene(db, BENE_ROWS);
  await importOutstandings(db, { source: "upload", rows: OUTSTANDING_ROWS, fileName: "js1.xlsx" });
});

async function twinKeys(): Promise<string[]> {
  return (await loadBeneLookup(db)).optionsOf("TWIN ONE").map((o) => o.key);
}

describe("instant payments", () => {
  it("makes a bank CSV in the locked template, saves the batch and changes no bill", async () => {
    const before = await db.select().from(bill);
    const created = await createInstantBatch(
      db,
      [
        { softwareName: " MOHSHIN  AKHTAR ", amountPaise: 1_000_00, paidDate: TODAY, reference: "advance" },
        { softwareName: "CHHEDA MANAGEMENT CONSULTANTS LLP", amountPaise: 2_500_50, paidDate: TODAY, reference: "" },
      ],
      NOW,
    );
    expect(created.lineCount).toBe(2);
    expect(created.totalPaise).toBe(3_500_50);

    const [row] = await db.select().from(batch).where(eq(batch.id, created.batchId));
    expect(row?.kind).toBe("instant");
    expect(row?.billCount).toBe(0);
    const lines = (row?.csv ?? "").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(l.split(",")).toHaveLength(63);
    expect(lines[0]?.startsWith("H,P,")).toBe(true);
    const first = lines[1]?.split(",") ?? [];
    expect([first[0], first[1], first[2], first[9], first[10], first[15], first[19], first[20], first[37], first[38]]).toEqual([
      "P", "ACH", "BA", "23/11/2026", "MOHSHIN AKHTAR", "ICIC0001236", "123601001506", "BN advance", "INR", "1000",
    ]);
    expect(lines[2]?.split(",")[20]).toBe("");
    expect(lines[2]?.split(",")[38]).toBe("2500.5");
    expect(lines[3]?.split(",").slice(0, 3)).toEqual(["T", "2", "3500.5"]);

    const pays = await db.select().from(payment).where(eq(payment.batchId, created.batchId));
    expect(pays.map((p) => [p.billId, p.softwareName])).toEqual([[null, "MOHSHIN AKHTAR"], [null, "CHHEDA MANAGEMENT CONSULTANTS LLP"]]);
    expect(await db.select().from(bill)).toEqual(before);
    expect((await db.select().from(auditLog)).map((a) => a.action)).toContain("batch.instant");

    const shown = await getBatch(db, created.batchId);
    expect(shown?.payments.map((p) => p.account)).toEqual([null, null]);
  });

  it("uses the chosen bank account when the party has more than one", async () => {
    const [, second] = await twinKeys();
    const created = await createInstantBatch(db, [{ softwareName: "TWIN ONE", bankKey: second, amountPaise: 500_00, paidDate: TODAY, reference: "" }], NOW);
    const [row] = await db.select().from(batch).where(eq(batch.id, created.batchId));
    expect(row?.csv).toContain("50100099999999");
    expect(row?.csv).not.toContain("50100055074872");
  });

  it("rejects bad lines with one reason for each and saves nothing", async () => {
    const error = await createInstantBatch(
      db,
      [
        { softwareName: "TWIN ONE", amountPaise: 100, paidDate: TODAY, reference: "" },
        { softwareName: "AIMSITE EVENTS PRIVATE LIMITED", amountPaise: 100, paidDate: TODAY, reference: "" },
        { softwareName: "NOBODY", amountPaise: 100, paidDate: TODAY, reference: "" },
        { softwareName: "MOHSHIN AKHTAR", amountPaise: 0, paidDate: TODAY, reference: "" },
        { softwareName: "MOHSHIN AKHTAR", amountPaise: INSTANT_MAX_PAISE + 1, paidDate: TODAY, reference: "" },
        { softwareName: "MOHSHIN AKHTAR", amountPaise: 100, paidDate: "2026-02-30", reference: "" },
        { softwareName: "", amountPaise: 100, paidDate: TODAY, reference: "" },
      ],
      NOW,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstantPaymentError);
    const details = (error as InstantPaymentError).details;
    expect(details).toHaveLength(7);
    expect(details[0]).toContain("Choose one");
    expect(details[1]).toContain("not valid");
    expect(details[2]).toContain("not in Bene Master");
    expect(details[3]).toContain("more than zero");
    expect(details[4]).toContain("limit");
    expect(details[5]).toContain("paid date");
    expect(details[6]).toContain("choose a party");
    expect(await db.select().from(batch)).toHaveLength(0);
    expect(await db.select().from(payment)).toHaveLength(0);
  });

  it("rejects an empty list", async () => {
    await expect(createInstantBatch(db, [], NOW)).rejects.toThrow("at least one");
  });

  it("can be undone like other batches, and no bill opens or closes", async () => {
    const before = await db.select().from(bill);
    const created = await createInstantBatch(db, [{ softwareName: "MOHSHIN AKHTAR", amountPaise: 100_00, paidDate: TODAY, reference: "" }], NOW);
    await voidBatch(db, created.batchId);
    const [row] = await db.select().from(batch).where(eq(batch.id, created.batchId));
    expect(row?.status).toBe("voided");
    expect((await db.select().from(payment))[0]?.status).toBe("voided");
    expect(await db.select().from(bill)).toEqual(before);
  });

  it("lists the Bene Master parties with their accounts, cut to the last 4 digits", async () => {
    const parties = await listInstantParties(db);
    const twin = parties.find((p) => p.name === "TWIN ONE");
    expect(twin?.options.map((o) => o.last4)).toEqual(["4872", "9999"]);
    expect(twin?.defaultKey).toBeUndefined();
    expect(parties.find((p) => p.name === "MOHSHIN AKHTAR")?.defaultKey).toBeDefined();
    expect(JSON.stringify(parties)).not.toContain("123601001506");
  });
});
