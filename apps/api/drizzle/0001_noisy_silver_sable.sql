CREATE TABLE "display_templates" (
	"display_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "display_templates_display_id_template_id_pk" PRIMARY KEY("display_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "displays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"hardware_id" text NOT NULL,
	"name" text NOT NULL,
	"active_template_id" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "displays_hardware_id_unique" UNIQUE("hardware_id")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "display_id" uuid;--> statement-breakpoint
ALTER TABLE "display_templates" ADD CONSTRAINT "display_templates_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE cascade ON UPDATE no action;