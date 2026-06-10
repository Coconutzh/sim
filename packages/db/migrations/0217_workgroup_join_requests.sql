DO $$ BEGIN
  CREATE TYPE "workgroup_join_request_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "workgroup_join_request" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "workgroup_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "role" "workgroup_member_role" DEFAULT 'member' NOT NULL,
  "message" text,
  "status" "workgroup_join_request_status" DEFAULT 'pending' NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "workgroup_join_request"
    ADD CONSTRAINT "workgroup_join_request_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "workgroup_join_request"
    ADD CONSTRAINT "workgroup_join_request_workgroup_id_workgroup_id_fk"
    FOREIGN KEY ("workgroup_id") REFERENCES "workgroup"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "workgroup_join_request"
    ADD CONSTRAINT "workgroup_join_request_requester_user_id_user_id_fk"
    FOREIGN KEY ("requester_user_id") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "workgroup_join_request"
    ADD CONSTRAINT "workgroup_join_request_reviewed_by_user_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "workgroup_join_request_org_status_idx"
  ON "workgroup_join_request" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "workgroup_join_request_workgroup_status_idx"
  ON "workgroup_join_request" ("workgroup_id", "status");

CREATE INDEX IF NOT EXISTS "workgroup_join_request_requester_idx"
  ON "workgroup_join_request" ("requester_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workgroup_join_request_pending_unique"
  ON "workgroup_join_request" ("workgroup_id", "requester_user_id")
  WHERE "status" = 'pending';
