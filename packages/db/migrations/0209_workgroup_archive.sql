ALTER TABLE "workgroup" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workgroup_archived_at_idx" ON "workgroup" USING btree ("archived_at");
