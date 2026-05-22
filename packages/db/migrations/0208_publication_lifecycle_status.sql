DO $$ BEGIN
 CREATE TYPE "public"."workflow_publication_version_status" AS ENUM('draft', 'published', 'superseded', 'archived', 'retracted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "status" "workflow_publication_version_status" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "retracted_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "lifecycle_updated_by" text;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "lifecycle_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "review_state" text;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "risk_level" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_lifecycle_updated_by_user_id_fk" FOREIGN KEY ("lifecycle_updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_publication_version_status_idx" ON "workflow_publication_version" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_publication_version_archived_at_idx" ON "workflow_publication_version" USING btree ("archived_at");
