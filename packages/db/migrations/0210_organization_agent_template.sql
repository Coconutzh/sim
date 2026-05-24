CREATE TABLE IF NOT EXISTS "organization_agent_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_code" text NOT NULL,
	"project_instructions" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_agent_template" ADD CONSTRAINT "organization_agent_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_agent_template" ADD CONSTRAINT "organization_agent_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_agent_template_organization_id_idx" ON "organization_agent_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_agent_template_agent_code_idx" ON "organization_agent_template" USING btree ("agent_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_agent_template_org_agent_unique" ON "organization_agent_template" USING btree ("organization_id","agent_code");
