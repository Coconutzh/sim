CREATE TYPE "public"."agent_skill_binding_scope" AS ENUM('agent_template', 'team_override');--> statement-breakpoint
CREATE TYPE "public"."workflow_publication_version_visibility" AS ENUM('organization', 'selected_workgroups');--> statement-breakpoint
CREATE TYPE "public"."workgroup_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "agent_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"default_system_prompt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skill_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_code" text NOT NULL,
	"workgroup_id" text,
	"skill_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"scope" "agent_skill_binding_scope" DEFAULT 'agent_template' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discipline" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agent_code" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_canvas_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"workgroup_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_publication_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_workgroup_id" text NOT NULL,
	"source_discipline_id" text,
	"agent_code" text NOT NULL,
	"source_workflow_id" text NOT NULL,
	"published_workflow_id" text,
	"parent_version_id" text,
	"version_number" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "workflow_publication_version_visibility" DEFAULT 'organization' NOT NULL,
	"snapshot_state" jsonb NOT NULL,
	"snapshot_metadata" jsonb DEFAULT '{}' NOT NULL,
	"published_by" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workgroup_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workgroup_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workgroup_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "active_workgroup_id" text;--> statement-breakpoint
ALTER TABLE "workgroup" ADD COLUMN "discipline_id" text;--> statement-breakpoint
ALTER TABLE "workgroup" ADD COLUMN "team_workspace_id" text;--> statement-breakpoint
ALTER TABLE "agent_skill_binding" ADD CONSTRAINT "agent_skill_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_binding" ADD CONSTRAINT "agent_skill_binding_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_binding" ADD CONSTRAINT "agent_skill_binding_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_canvas_workspace" ADD CONSTRAINT "personal_canvas_workspace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_canvas_workspace" ADD CONSTRAINT "personal_canvas_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_canvas_workspace" ADD CONSTRAINT "personal_canvas_workspace_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_canvas_workspace" ADD CONSTRAINT "personal_canvas_workspace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_source_workgroup_id_workgroup_id_fk" FOREIGN KEY ("source_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_source_discipline_id_discipline_id_fk" FOREIGN KEY ("source_discipline_id") REFERENCES "public"."discipline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_source_workflow_id_workflow_id_fk" FOREIGN KEY ("source_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_published_workflow_id_workflow_id_fk" FOREIGN KEY ("published_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_publication_version" ADD CONSTRAINT "workflow_publication_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_code_unique" ON "agent_profile" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_skill_binding_organization_id_idx" ON "agent_skill_binding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_skill_binding_agent_code_idx" ON "agent_skill_binding" USING btree ("agent_code");--> statement-breakpoint
CREATE INDEX "agent_skill_binding_workgroup_id_idx" ON "agent_skill_binding" USING btree ("workgroup_id");--> statement-breakpoint
CREATE INDEX "agent_skill_binding_skill_id_idx" ON "agent_skill_binding" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skill_binding_unique" ON "agent_skill_binding" USING btree ("organization_id","agent_code","workgroup_id","skill_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "discipline_code_unique" ON "discipline" USING btree ("code");--> statement-breakpoint
CREATE INDEX "discipline_agent_code_idx" ON "discipline" USING btree ("agent_code");--> statement-breakpoint
CREATE INDEX "discipline_sort_order_idx" ON "discipline" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "personal_canvas_workspace_user_id_idx" ON "personal_canvas_workspace" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_canvas_workspace_organization_id_idx" ON "personal_canvas_workspace" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "personal_canvas_workspace_workgroup_id_idx" ON "personal_canvas_workspace" USING btree ("workgroup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_canvas_workspace_user_workgroup_unique" ON "personal_canvas_workspace" USING btree ("user_id","workgroup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_canvas_workspace_workspace_unique" ON "personal_canvas_workspace" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_organization_id_idx" ON "workflow_publication_version" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_source_workgroup_id_idx" ON "workflow_publication_version" USING btree ("source_workgroup_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_source_discipline_id_idx" ON "workflow_publication_version" USING btree ("source_discipline_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_agent_code_idx" ON "workflow_publication_version" USING btree ("agent_code");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_source_workflow_id_idx" ON "workflow_publication_version" USING btree ("source_workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_published_workflow_id_idx" ON "workflow_publication_version" USING btree ("published_workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_publication_version_parent_version_id_idx" ON "workflow_publication_version" USING btree ("parent_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_publication_version_source_workflow_version_unique" ON "workflow_publication_version" USING btree ("source_workflow_id","version_number");--> statement-breakpoint
CREATE INDEX "workgroup_member_organization_id_idx" ON "workgroup_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workgroup_member_workgroup_id_idx" ON "workgroup_member" USING btree ("workgroup_id");--> statement-breakpoint
CREATE INDEX "workgroup_member_user_id_idx" ON "workgroup_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workgroup_member_workgroup_user_unique" ON "workgroup_member" USING btree ("workgroup_id","user_id");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_active_workgroup_id_workgroup_id_fk" FOREIGN KEY ("active_workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup" ADD CONSTRAINT "workgroup_discipline_id_discipline_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."discipline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup" ADD CONSTRAINT "workgroup_team_workspace_id_workspace_id_fk" FOREIGN KEY ("team_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workgroup_discipline_id_idx" ON "workgroup" USING btree ("discipline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workgroup_team_workspace_unique" ON "workgroup" USING btree ("team_workspace_id");--> statement-breakpoint
INSERT INTO "agent_profile" ("id", "code", "name", "description", "default_system_prompt")
VALUES
  ('agent_chief_director', 'chief_director', '总导演 Agent', '服务总导演与项目总控/PMO，关注整体创意、审核、进度、风险和全局一致性。', '你是总导演 Agent，负责整体创意方向、跨团队方案审核、项目进度、风险依赖和效果预演。'),
  ('agent_show_director', 'show_director', '秀演/编导 Agent', '关注演员动线、节目编排、舞台走位和装置移动节点规划。', '你是秀演/编导 Agent，负责演员动线、节目编排、舞台走位、装置移动节点和时间轴节奏。'),
  ('agent_stage_design', 'stage_design', '舞美师 Agent', '关注舞台概念、舞台模型、空间布局和舞美资产提交。', '你是舞美师 Agent，负责舞台概念、模型、空间布局和舞美资产。'),
  ('agent_visual', 'visual', '视觉 Agent', '关注分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。', '你是视觉 Agent，负责分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。'),
  ('agent_broadcast_camera', 'broadcast_camera', '导播/摄影 Agent', '关注摄像机机位、拍摄盲区检查和导播脚本编排。', '你是导播/摄影 Agent，负责摄像机机位、拍摄盲区、镜头调度和导播脚本。'),
  ('agent_lighting_sound', 'lighting_sound', '灯光/音响 Agent', '关注灯具 Cue 点、声场布局和演艺技术参数配置。', '你是灯光/音响 Agent，负责灯具 Cue 点、声场布局、音画同步和技术参数配置。'),
  ('agent_special_effects', 'special_effects', '特效 Agent', '关注激光、机械装置、特效触发时序和装置运动对齐。', '你是特效 Agent，负责激光、机械装置、特效触发时序和装置运动对齐。'),
  ('agent_music', 'music', '音乐 Agent', '关注音乐风格建议、曲风匹配、制作进度和版权合规管理。', '你是音乐 Agent，负责音乐风格、曲风匹配、制作进度和版权合规。'),
  ('agent_props_costume', 'props_costume', '道具/服装 Agent', '关注道具、服装、置景与整体创意风格匹配。', '你是道具/服装 Agent，负责道具、服装、置景和整体创意风格匹配。'),
  ('agent_production', 'production', '制片 Agent', '关注人员档期、通告单、节目排期表和流程性文件流转。', '你是制片 Agent，负责人员档期、通告单、节目排期表和流程文件流转。')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "discipline" ("id", "code", "name", "description", "agent_code", "sort_order")
VALUES
  ('discipline_chief_director', 'chief_director', '总导演', '提出整体创意方向，审核各岗位方案，关注项目全局进度和效果预演。', 'chief_director', 10),
  ('discipline_show_director', 'show_director', '秀演/编导', '负责演员动线、节目编排、舞台走位和装置移动节点规划。', 'show_director', 20),
  ('discipline_stage_design', 'stage_design', '舞美师', '负责舞台概念、舞台模型、空间布局和舞美资产提交。', 'stage_design', 30),
  ('discipline_visual', 'visual', '视觉团队', '负责分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。', 'visual', 40),
  ('discipline_broadcast_camera', 'broadcast_camera', '导播/摄影团队', '负责摄像机机位、拍摄盲区检查和导播脚本编排。', 'broadcast_camera', 50),
  ('discipline_lighting_sound', 'lighting_sound', '灯光/音响团队', '负责灯具 Cue 点、声场布局和演艺技术参数配置。', 'lighting_sound', 60),
  ('discipline_special_effects', 'special_effects', '特效师', '负责激光、机械装置、特效触发时序和装置运动对齐。', 'special_effects', 70),
  ('discipline_music', 'music', '音乐团队', '负责音乐风格建议、曲风匹配、制作进度和版权合规管理。', 'music', 80),
  ('discipline_props_costume', 'props_costume', '道具/服装团队', '负责道具、服装、置景与整体创意风格的匹配。', 'props_costume', 90),
  ('discipline_production', 'production', '制片团队', '负责人员档期、通告单、节目排期表和流程性文件流转。', 'production', 100),
  ('discipline_pmo', 'pmo', '项目总控/PMO', '负责任务调度、依赖管理、风险预警和项目健康度跟踪。', 'chief_director', 110)
ON CONFLICT ("code") DO NOTHING;
