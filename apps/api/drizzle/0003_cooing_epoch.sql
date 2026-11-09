CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"device_id" uuid,
	"display_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"when" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_one_target" CHECK (num_nonnulls("schedules"."device_id", "schedules"."display_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_due" ON "schedules" USING btree ("next_run_at") WHERE "schedules"."enabled";--> statement-breakpoint
CREATE INDEX "schedules_device" ON "schedules" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "schedules_display" ON "schedules" USING btree ("display_id");