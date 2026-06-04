CREATE TYPE "public"."production_task_status" AS ENUM('todo', 'in_progress', 'submitted', 'approved', 'changes_requested', 'archived');

CREATE TABLE "production_task" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "source_workspace_id" text,
  "source_workflow_id" text,
  "source_workgroup_id" text NOT NULL,
  "assignee_workgroup_id" text NOT NULL,
  "created_by" text,
  "title" text NOT NULL,
  "description" text,
  "due_at" timestamp,
  "status" "production_task_status" DEFAULT 'todo' NOT NULL,
  "result_workflow_id" text,
  "result_node_id" text,
  "review_note" text,
  "submitted_by" text,
  "submitted_at" timestamp,
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "reminder_sent_at" timestamp,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "production_task_message" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "sender_user_id" text,
  "sender_agent_code" text,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "production_task_read_receipt" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "user_id" text NOT NULL,
  "last_read_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "production_task" ADD CONSTRAINT "production_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_source_workspace_id_workspace_id_fk" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_source_workflow_id_workflow_id_fk" FOREIGN KEY ("source_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_source_workgroup_id_workgroup_id_fk" FOREIGN KEY ("source_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_assignee_workgroup_id_workgroup_id_fk" FOREIGN KEY ("assignee_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_result_workflow_id_workflow_id_fk" FOREIGN KEY ("result_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task" ADD CONSTRAINT "production_task_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task_message" ADD CONSTRAINT "production_task_message_task_id_production_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "production_task_message" ADD CONSTRAINT "production_task_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "production_task_read_receipt" ADD CONSTRAINT "production_task_read_receipt_task_id_production_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."production_task"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "production_task_read_receipt" ADD CONSTRAINT "production_task_read_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "production_task_org_status_due_idx" ON "production_task" USING btree ("organization_id","status","due_at");
CREATE INDEX "production_task_assignee_status_due_idx" ON "production_task" USING btree ("assignee_workgroup_id","status","due_at");
CREATE INDEX "production_task_source_workgroup_idx" ON "production_task" USING btree ("source_workgroup_id");
CREATE INDEX "production_task_result_workflow_idx" ON "production_task" USING btree ("result_workflow_id");
CREATE INDEX "production_task_reminder_due_idx" ON "production_task" USING btree ("reminder_sent_at","due_at","status");
CREATE INDEX "production_task_message_task_created_at_idx" ON "production_task_message" USING btree ("task_id","created_at");
CREATE INDEX "production_task_message_sender_user_idx" ON "production_task_message" USING btree ("sender_user_id");
CREATE UNIQUE INDEX "production_task_read_receipt_task_user_unique" ON "production_task_read_receipt" USING btree ("task_id","user_id");
CREATE INDEX "production_task_read_receipt_user_updated_idx" ON "production_task_read_receipt" USING btree ("user_id","updated_at");
