ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "reviewer_user_id" text;
--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "reviewer_assigned_by" text;
--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD COLUMN IF NOT EXISTS "reviewer_assigned_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_reviewer_assigned_by_user_id_fk" FOREIGN KEY ("reviewer_assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_publication_version_reviewer_user_id_idx" ON "workflow_publication_version" USING btree ("reviewer_user_id");
