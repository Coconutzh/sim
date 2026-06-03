ALTER TABLE "project_task" ADD COLUMN IF NOT EXISTS "message_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_task" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project_task" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_task_id_project_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_messages_task_created_at_idx" ON "task_messages" USING btree ("task_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_messages_sender_id_idx" ON "task_messages" USING btree ("sender_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_reminder_due_idx" ON "project_task" USING btree ("reminder_sent_at","status","due_at");
