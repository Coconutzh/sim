ALTER TABLE "production_task"
  ADD COLUMN IF NOT EXISTS "submission_note" text;

CREATE TABLE IF NOT EXISTS "production_task_submission_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "source" text DEFAULT 'url' NOT NULL,
  "workspace_file_id" text,
  "key" text,
  "content_type" text,
  "size" integer,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_task_submission_attachment_task_id_production_task_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_task_submission_attachment_workspace_file_id_workspace_files_id_fk"
    FOREIGN KEY ("workspace_file_id") REFERENCES "public"."workspace_files"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_task_submission_attachment_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "production_task_submission_attachment_task_created_at_idx"
  ON "production_task_submission_attachment" USING btree ("task_id", "created_at");

CREATE INDEX IF NOT EXISTS "production_task_submission_attachment_workspace_file_idx"
  ON "production_task_submission_attachment" USING btree ("workspace_file_id");
