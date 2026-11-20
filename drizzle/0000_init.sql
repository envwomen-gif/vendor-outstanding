CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"csv" text NOT NULL,
	"csv_sha256" text NOT NULL,
	"line_count" integer NOT NULL,
	"bill_count" integer NOT NULL,
	"total_paise" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bene" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"software_name" text NOT NULL,
	"account_name" text NOT NULL,
	"ifsc" text NOT NULL,
	"account_number" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"doc_no" text NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"ref_no" text DEFAULT '' NOT NULL,
	"fifo_position" integer DEFAULT 0 NOT NULL,
	"adjusted_paise" bigint NOT NULL,
	"balance_paise" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"file_sha256" text,
	"rows_read" integer NOT NULL,
	"bills_new" integer NOT NULL,
	"bills_updated" integer NOT NULL,
	"bills_closed" integer NOT NULL,
	"rejected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_date" date NOT NULL,
	"beneficiary_name" text NOT NULL,
	"ifsc" text NOT NULL,
	"account_number" text NOT NULL,
	"ref_no" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_last_import_id_import_run_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bene_software_name_idx" ON "bene" USING btree ("software_name");--> statement-breakpoint
CREATE INDEX "bene_account_name_idx" ON "bene" USING btree ("account_name");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_account_doc_uq" ON "bill" USING btree ("account","doc_no");--> statement-breakpoint
CREATE INDEX "bill_status_due_idx" ON "bill" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "login_attempt_key_at_idx" ON "login_attempt" USING btree ("key","at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_active_bill_uq" ON "payment" USING btree ("bill_id") WHERE "payment"."status" = 'active';--> statement-breakpoint
CREATE INDEX "payment_batch_idx" ON "payment" USING btree ("batch_id");