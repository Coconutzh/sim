DO $$ BEGIN
  CREATE TYPE "skill_proposal_type" AS ENUM ('create', 'patch', 'deprecate');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "skill_proposal_risk" AS ENUM ('low', 'medium', 'high');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "skill_proposal_status" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'published');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "skill_revision_author_type" AS ENUM ('user', 'admin', 'hermes');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "skill_proposal" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "workspace_id" text,
  "workgroup_id" text,
  "agent_code" text,
  "source_user_id" text NOT NULL,
  "source_hermes_run_id" text,
  "target_skill_id" text,
  "published_skill_id" text,
  "type" "skill_proposal_type" NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "proposed_content" text,
  "proposed_diff" text,
  "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "risk" "skill_proposal_risk" DEFAULT 'low' NOT NULL,
  "status" "skill_proposal_status" DEFAULT 'pending_review' NOT NULL,
  "reviewer_id" text,
  "review_note" text,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_workspace_id_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_workgroup_id_workgroup_id_fk"
    FOREIGN KEY ("workgroup_id") REFERENCES "workgroup"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_source_user_id_user_id_fk"
    FOREIGN KEY ("source_user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_target_skill_id_skill_id_fk"
    FOREIGN KEY ("target_skill_id") REFERENCES "skill"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD COLUMN "published_skill_id" text;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_published_skill_id_skill_id_fk"
    FOREIGN KEY ("published_skill_id") REFERENCES "skill"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_proposal"
    ADD CONSTRAINT "skill_proposal_reviewer_id_user_id_fk"
    FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "skill_proposal_organization_status_idx"
  ON "skill_proposal" ("organization_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "skill_proposal_source_user_idx"
  ON "skill_proposal" ("source_user_id");

CREATE INDEX IF NOT EXISTS "skill_proposal_target_skill_idx"
  ON "skill_proposal" ("target_skill_id");

CREATE INDEX IF NOT EXISTS "skill_proposal_published_skill_idx"
  ON "skill_proposal" ("published_skill_id");

CREATE INDEX IF NOT EXISTS "skill_proposal_workgroup_idx"
  ON "skill_proposal" ("workgroup_id");

CREATE INDEX IF NOT EXISTS "skill_proposal_agent_code_idx"
  ON "skill_proposal" ("agent_code");

CREATE TABLE IF NOT EXISTS "skill_revision" (
  "id" text PRIMARY KEY NOT NULL,
  "skill_id" text NOT NULL,
  "version" integer NOT NULL,
  "content" text NOT NULL,
  "diff" text,
  "author_type" "skill_revision_author_type" NOT NULL,
  "author_id" text,
  "source_proposal_id" text,
  "rollback_target_revision_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "skill_revision"
    ADD CONSTRAINT "skill_revision_skill_id_skill_id_fk"
    FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_revision"
    ADD CONSTRAINT "skill_revision_author_id_user_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_revision"
    ADD CONSTRAINT "skill_revision_source_proposal_id_skill_proposal_id_fk"
    FOREIGN KEY ("source_proposal_id") REFERENCES "skill_proposal"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "skill_revision"
    ADD COLUMN "rollback_target_revision_id" text;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "skill_revision_skill_version_unique"
  ON "skill_revision" ("skill_id", "version");

CREATE INDEX IF NOT EXISTS "skill_revision_skill_id_idx"
  ON "skill_revision" ("skill_id");

CREATE INDEX IF NOT EXISTS "skill_revision_source_proposal_idx"
  ON "skill_revision" ("source_proposal_id");

CREATE INDEX IF NOT EXISTS "skill_revision_rollback_target_revision_idx"
  ON "skill_revision" ("rollback_target_revision_id");
