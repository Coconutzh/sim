CREATE TYPE "public"."copilot_skill_card_action_kind" AS ENUM('prompt', 'create_task', 'submit_task');

ALTER TABLE "production_task_attachment"
  ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'url' NOT NULL,
  ADD COLUMN IF NOT EXISTS "workspace_file_id" text,
  ADD COLUMN IF NOT EXISTS "key" text,
  ADD COLUMN IF NOT EXISTS "content_type" text,
  ADD COLUMN IF NOT EXISTS "size" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_task_attachment_workspace_file_id_workspace_files_id_fk'
  ) THEN
    ALTER TABLE "production_task_attachment"
      ADD CONSTRAINT "production_task_attachment_workspace_file_id_workspace_files_id_fk"
      FOREIGN KEY ("workspace_file_id") REFERENCES "public"."workspace_files"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "production_task_attachment_workspace_file_idx"
  ON "production_task_attachment" USING btree ("workspace_file_id");

CREATE TABLE IF NOT EXISTS "copilot_skill_card" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "agent_code" text NOT NULL,
  "workgroup_id" text,
  "title" text NOT NULL,
  "description" text,
  "prompt" text NOT NULL,
  "action_kind" "copilot_skill_card_action_kind" DEFAULT 'prompt' NOT NULL,
  "task_title" text,
  "task_description" text,
  "due_at_offset_hours" integer,
  "enabled" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "copilot_skill_card_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "copilot_skill_card_workgroup_id_workgroup_id_fk"
    FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "copilot_skill_card_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "copilot_skill_card_updated_by_user_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "copilot_skill_card_org_agent_idx"
  ON "copilot_skill_card" USING btree ("organization_id", "agent_code", "enabled", "sort_order");

CREATE INDEX IF NOT EXISTS "copilot_skill_card_workgroup_idx"
  ON "copilot_skill_card" USING btree ("workgroup_id");

CREATE INDEX IF NOT EXISTS "copilot_skill_card_updated_at_idx"
  ON "copilot_skill_card" USING btree ("updated_at");
