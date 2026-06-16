ALTER TABLE "production_task" ADD COLUMN IF NOT EXISTS "delay_reason" text;
ALTER TABLE "production_task" ADD COLUMN IF NOT EXISTS "delay_reason_updated_by" text;
ALTER TABLE "production_task" ADD COLUMN IF NOT EXISTS "delay_reason_updated_at" timestamp;
ALTER TABLE "production_task" ADD COLUMN IF NOT EXISTS "delay_reminder_sent_at" timestamp;

DO $$ BEGIN
 ALTER TABLE "production_task" ADD CONSTRAINT "production_task_delay_reason_updated_by_user_id_fk" FOREIGN KEY ("delay_reason_updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "production_task_delay_reminder_due_idx" ON "production_task" USING btree ("delay_reminder_sent_at","due_at","status");
