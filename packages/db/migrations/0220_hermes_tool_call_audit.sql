CREATE TABLE IF NOT EXISTS "hermes_tool_call_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "trace_id" text,
  "hermes_run_id" text,
  "sim_request_id" text,
  "user_id" text,
  "organization_id" text,
  "workspace_id" text,
  "workflow_id" text,
  "tool_name" text NOT NULL,
  "mode" text,
  "operation" text,
  "status" text NOT NULL,
  "input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "risk" text,
  "requires_confirmation" boolean,
  "changed_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generated_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "verification_summary" text,
  "duration_ms" integer,
  "error_code" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_trace_id_idx"
  ON "hermes_tool_call_audit" ("trace_id");

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_hermes_run_id_idx"
  ON "hermes_tool_call_audit" ("hermes_run_id");

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_org_created_idx"
  ON "hermes_tool_call_audit" ("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_workspace_workflow_created_idx"
  ON "hermes_tool_call_audit" ("workspace_id", "workflow_id", "created_at");

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_user_created_idx"
  ON "hermes_tool_call_audit" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "hermes_tool_call_audit_tool_status_idx"
  ON "hermes_tool_call_audit" ("tool_name", "status", "created_at");
