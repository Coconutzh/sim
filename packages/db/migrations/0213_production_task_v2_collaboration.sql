CREATE TABLE IF NOT EXISTS "production_task_dependency" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "depends_on_task_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_task_dependency_task_id_production_task_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_task_dependency_depends_on_task_id_production_task_id_fk"
    FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."production_task"("id") ON DELETE cascade ON UPDATE no action
);

CREATE TABLE IF NOT EXISTS "production_task_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "production_task_attachment_task_id_production_task_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "production_task_attachment_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "production_task_dependency_task_idx"
  ON "production_task_dependency" USING btree ("task_id");

CREATE INDEX IF NOT EXISTS "production_task_dependency_depends_on_idx"
  ON "production_task_dependency" USING btree ("depends_on_task_id");

CREATE UNIQUE INDEX IF NOT EXISTS "production_task_dependency_unique"
  ON "production_task_dependency" USING btree ("task_id", "depends_on_task_id");

CREATE INDEX IF NOT EXISTS "production_task_attachment_task_created_at_idx"
  ON "production_task_attachment" USING btree ("task_id", "created_at");
