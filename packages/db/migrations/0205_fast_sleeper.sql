CREATE TYPE "public"."workflow_track" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."workflow_visibility" AS ENUM('workspace', 'organization', 'selected_workgroups');--> statement-breakpoint
CREATE TABLE "workflow_publication_scope" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"viewer_workgroup_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workgroup" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "track" "workflow_track" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "visibility" "workflow_visibility" DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "source_workflow_id" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "workgroup_id" text;--> statement-breakpoint
ALTER TABLE "workflow_publication_scope" ADD CONSTRAINT "workflow_publication_scope_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_scope" ADD CONSTRAINT "workflow_publication_scope_viewer_workgroup_id_workgroup_id_fk" FOREIGN KEY ("viewer_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_scope" ADD CONSTRAINT "workflow_publication_scope_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup" ADD CONSTRAINT "workgroup_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_publication_scope_workflow_idx" ON "workflow_publication_scope" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_scope_viewer_workgroup_idx" ON "workflow_publication_scope" USING btree ("viewer_workgroup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_publication_scope_workflow_viewer_unique" ON "workflow_publication_scope" USING btree ("workflow_id","viewer_workgroup_id");--> statement-breakpoint
CREATE INDEX "workgroup_organization_id_idx" ON "workgroup" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workgroup_org_slug_unique" ON "workgroup" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workgroup_org_name_unique" ON "workgroup" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_workspace_track_idx" ON "workflow" USING btree ("workspace_id","track");--> statement-breakpoint
CREATE INDEX "workflow_source_workflow_idx" ON "workflow" USING btree ("source_workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_visibility_idx" ON "workflow" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "workspace_workgroup_id_idx" ON "workspace" USING btree ("workgroup_id");