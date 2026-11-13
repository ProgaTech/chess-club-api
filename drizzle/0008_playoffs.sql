CREATE TABLE "playoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"bracket" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
