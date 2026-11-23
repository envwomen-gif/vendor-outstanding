CREATE TABLE "bank_choice" (
	"software_name" text PRIMARY KEY NOT NULL,
	"option_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
