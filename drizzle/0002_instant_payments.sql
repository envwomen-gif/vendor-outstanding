ALTER TABLE "payment" ALTER COLUMN "bill_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batch" ADD COLUMN "kind" text DEFAULT 'bills' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "software_name" text;