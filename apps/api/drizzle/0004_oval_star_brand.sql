ALTER TABLE "displays" ADD COLUMN "info" jsonb;--> statement-breakpoint
ALTER TABLE "displays" ADD COLUMN "last_seen_at" timestamp with time zone;