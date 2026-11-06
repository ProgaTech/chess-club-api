CREATE TABLE "analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"fingerprint" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" timestamp with time zone,
	"markdown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_owner_fingerprint" ON "analyses" USING btree ("owner","fingerprint");--> statement-breakpoint
CREATE INDEX "analyses_status_created" ON "analyses" USING btree ("status","created_at");