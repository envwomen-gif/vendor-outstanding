import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** All money columns hold paise (whole numbers). */
const paise = (name: string) => bigint(name, { mode: "number" });

/** One row of Bene Master (ALL DETAILS), after cleaning. `position` keeps the sheet order. */
export const bene = pgTable(
  "bene",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    position: integer("position").notNull(),
    softwareName: text("software_name").notNull(),
    accountName: text("account_name").notNull(),
    ifsc: text("ifsc").notNull(),
    accountNumber: text("account_number").notNull(),
    email: text("email").notNull().default(""),
    /** Problem codes found when the row was cleaned. Empty list means no problem. */
    problems: jsonb("problems").$type<string[]>().notNull().default([]),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bene_software_name_idx").on(t.softwareName), index("bene_account_name_idx").on(t.accountName)],
);

export const importRun = pgTable("import_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source", { enum: ["sheet", "upload"] }).notNull(),
  fileName: text("file_name"),
  fileSha256: text("file_sha256"),
  rowsRead: integer("rows_read").notNull(),
  billsNew: integer("bills_new").notNull(),
  billsUpdated: integer("bills_updated").notNull(),
  billsClosed: integer("bills_closed").notNull(),
  rejected: jsonb("rejected").$type<{ reason: string; account: string; docNo: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bill = pgTable(
  "bill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    account: text("account").notNull(),
    docNo: text("doc_no").notNull(),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    refNo: text("ref_no").notNull().default(""),
    /** Place in the FIFO list of the last import (0 is the oldest due date). */
    fifoPosition: integer("fifo_position").notNull().default(0),
    adjustedPaise: paise("adjusted_paise").notNull(),
    balancePaise: paise("balance_paise").notNull(),
    /** open: can be paid. paid: locked in a batch. closed: gone from the last import. */
    status: text("status", { enum: ["open", "paid", "closed"] }).notNull().default("open"),
    lastImportId: uuid("last_import_id").references(() => importRun.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bill_account_doc_uq").on(t.account, t.docNo), index("bill_status_due_idx").on(t.status, t.dueDate)],
);

export const batch = pgTable("batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  /** The exact CSV text. A new download gives the same bytes. */
  csv: text("csv").notNull(),
  csvSha256: text("csv_sha256").notNull(),
  lineCount: integer("line_count").notNull(),
  billCount: integer("bill_count").notNull(),
  totalPaise: paise("total_paise").notNull(),
  status: text("status", { enum: ["active", "voided"] }).notNull().default("active"),
  voidReason: text("void_reason"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id").notNull().references(() => bill.id),
    batchId: uuid("batch_id").notNull().references(() => batch.id),
    amountPaise: paise("amount_paise").notNull(),
    paidDate: date("paid_date", { mode: "string" }).notNull(),
    /** Snapshot of the bank details at the time of payment. */
    beneficiaryName: text("beneficiary_name").notNull(),
    ifsc: text("ifsc").notNull(),
    accountNumber: text("account_number").notNull(),
    refNo: text("ref_no").notNull().default(""),
    status: text("status", { enum: ["active", "voided"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A bill can be in only one active payment. This is the hard lock.
    uniqueIndex("payment_active_bill_uq").on(t.billId).where(sql`${t.status} = 'active'`),
    index("payment_batch_idx").on(t.batchId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull().default(""),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    key: text("key").notNull(),
  },
  (t) => [index("login_attempt_key_at_idx").on(t.key, t.at)],
);

/** The bank account that the person chose last for a software name. It is only a default in the screen. */
export const bankChoice = pgTable("bank_choice", {
  softwareName: text("software_name").primaryKey(),
  optionKey: text("option_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
