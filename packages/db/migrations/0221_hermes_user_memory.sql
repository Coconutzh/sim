CREATE TABLE IF NOT EXISTS "hermes_user_memory" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "workspace_id" text,
  "category" text NOT NULL,
  "content" text NOT NULL,
  "source" text DEFAULT 'hermes' NOT NULL,
  "source_hermes_run_id" text,
  "source_trace_id" text,
  "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "hermes_user_memory"
    ADD CONSTRAINT "hermes_user_memory_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "hermes_user_memory"
    ADD CONSTRAINT "hermes_user_memory_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "hermes_user_memory"
    ADD CONSTRAINT "hermes_user_memory_workspace_id_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "hermes_user_memory_user_org_updated_idx"
  ON "hermes_user_memory" ("user_id", "organization_id", "updated_at");

CREATE INDEX IF NOT EXISTS "hermes_user_memory_workspace_updated_idx"
  ON "hermes_user_memory" ("workspace_id", "updated_at");

CREATE INDEX IF NOT EXISTS "hermes_user_memory_category_idx"
  ON "hermes_user_memory" ("category");

CREATE INDEX IF NOT EXISTS "hermes_user_memory_deleted_at_idx"
  ON "hermes_user_memory" ("deleted_at");
