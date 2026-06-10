CREATE TABLE IF NOT EXISTS "production_task_submission" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "version_number" integer NOT NULL,
  "workflow_id" text,
  "node_id" text,
  "note" text,
  "status" "production_task_status" DEFAULT 'submitted' NOT NULL,
  "submitted_by" text,
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "review_note" text,
  "adopted_by" text,
  "adopted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_task_submission_task_id_production_task_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_task_submission_workflow_id_workflow_id_fk"
    FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_task_submission_submitted_by_user_id_fk"
    FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_task_submission_reviewed_by_user_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_task_submission_adopted_by_user_id_fk"
    FOREIGN KEY ("adopted_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "production_task_submission_task_version_unique"
  ON "production_task_submission" USING btree ("task_id", "version_number");

CREATE INDEX IF NOT EXISTS "production_task_submission_task_submitted_at_idx"
  ON "production_task_submission" USING btree ("task_id", "submitted_at");

CREATE INDEX IF NOT EXISTS "production_task_submission_status_idx"
  ON "production_task_submission" USING btree ("status");

CREATE INDEX IF NOT EXISTS "production_task_submission_workflow_idx"
  ON "production_task_submission" USING btree ("workflow_id");

ALTER TABLE "production_task_submission_attachment"
  ADD COLUMN IF NOT EXISTS "submission_id" text;

ALTER TABLE "production_task_submission_attachment"
  ADD CONSTRAINT "production_task_submission_attachment_submission_id_production_task_submission_id_fk"
  FOREIGN KEY ("submission_id") REFERENCES "public"."production_task_submission"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "production_task_submission_attachment_submission_created_at_idx"
  ON "production_task_submission_attachment" USING btree ("submission_id", "created_at");

INSERT INTO "production_task_submission" (
  "id",
  "task_id",
  "version_number",
  "workflow_id",
  "node_id",
  "note",
  "status",
  "submitted_by",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_note",
  "adopted_by",
  "adopted_at",
  "created_at",
  "updated_at"
)
SELECT
  'legacy_' || "id",
  "id",
  1,
  "result_workflow_id",
  "result_node_id",
  "submission_note",
  CASE
    WHEN "status" IN ('submitted', 'approved', 'changes_requested') THEN "status"
    ELSE 'submitted'
  END::"production_task_status",
  "submitted_by",
  COALESCE("submitted_at", "updated_at", "created_at", now()),
  "reviewed_by",
  "reviewed_at",
  "review_note",
  CASE WHEN "status" = 'approved' THEN "reviewed_by" ELSE NULL END,
  CASE WHEN "status" = 'approved' THEN "reviewed_at" ELSE NULL END,
  COALESCE("submitted_at", "updated_at", "created_at", now()),
  COALESCE("reviewed_at", "updated_at", "created_at", now())
FROM "production_task"
WHERE "submitted_at" IS NOT NULL
ON CONFLICT ("task_id", "version_number") DO NOTHING;

UPDATE "production_task_submission_attachment"
SET "submission_id" = 'legacy_' || "task_id"
WHERE "submission_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "production_task_submission"
    WHERE "production_task_submission"."id" = 'legacy_' || "production_task_submission_attachment"."task_id"
  );

CREATE TABLE IF NOT EXISTS "production_showcase_item" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "source_workspace_id" text,
  "source_workgroup_id" text NOT NULL,
  "task_id" text,
  "submission_id" text,
  "title" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'other' NOT NULL,
  "content" text,
  "status" text DEFAULT 'published' NOT NULL,
  "created_by" text,
  "withdrawn_by" text,
  "withdrawn_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_showcase_item_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_showcase_item_source_workspace_id_workspace_id_fk"
    FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspace"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_showcase_item_source_workgroup_id_workgroup_id_fk"
    FOREIGN KEY ("source_workgroup_id") REFERENCES "public"."workgroup"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_showcase_item_task_id_production_task_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_showcase_item_submission_id_production_task_submission_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "public"."production_task_submission"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_showcase_item_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_showcase_item_withdrawn_by_user_id_fk"
    FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "production_showcase_item_org_status_created_idx"
  ON "production_showcase_item" USING btree ("organization_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "production_showcase_item_source_workgroup_idx"
  ON "production_showcase_item" USING btree ("source_workgroup_id");

CREATE INDEX IF NOT EXISTS "production_showcase_item_task_idx"
  ON "production_showcase_item" USING btree ("task_id");

CREATE INDEX IF NOT EXISTS "production_showcase_item_submission_idx"
  ON "production_showcase_item" USING btree ("submission_id");

CREATE TABLE IF NOT EXISTS "production_showcase_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "item_id" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "source" text DEFAULT 'url' NOT NULL,
  "workspace_file_id" text,
  "key" text,
  "content_type" text,
  "size" integer,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_showcase_attachment_item_id_production_showcase_item_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."production_showcase_item"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_showcase_attachment_workspace_file_id_workspace_files_id_fk"
    FOREIGN KEY ("workspace_file_id") REFERENCES "public"."workspace_files"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "production_showcase_attachment_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "production_showcase_attachment_item_created_at_idx"
  ON "production_showcase_attachment" USING btree ("item_id", "created_at");

CREATE INDEX IF NOT EXISTS "production_showcase_attachment_workspace_file_idx"
  ON "production_showcase_attachment" USING btree ("workspace_file_id");
