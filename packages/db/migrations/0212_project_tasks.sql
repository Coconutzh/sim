DO $$ BEGIN
 CREATE TYPE "project_task_status" AS ENUM ('todo', 'submitted', 'in_review', 'completed', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assignee_workgroup_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp,
	"status" "project_task_status" DEFAULT 'todo' NOT NULL,
	"result_workspace_id" text,
	"result_workflow_id" text,
	"result_node_id" text,
	"submitted_by" text,
	"submitted_at" timestamp,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_note" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_assignee_workgroup_id_workgroup_id_fk" FOREIGN KEY ("assignee_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_result_workspace_id_workspace_id_fk" FOREIGN KEY ("result_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_result_workflow_id_workflow_id_fk" FOREIGN KEY ("result_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_org_status_due_idx" ON "project_task" USING btree ("organization_id","status","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_assignee_status_due_idx" ON "project_task" USING btree ("assignee_workgroup_id","status","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_creator_id_idx" ON "project_task" USING btree ("creator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_result_workflow_node_idx" ON "project_task" USING btree ("result_workflow_id","result_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_archived_at_idx" ON "project_task" USING btree ("archived_at");
