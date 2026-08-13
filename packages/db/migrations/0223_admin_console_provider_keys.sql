CREATE TABLE IF NOT EXISTS "platform_provider_api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "provider_id" text NOT NULL,
  "label" text NOT NULL,
  "encrypted_api_key" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "platform_provider_api_key_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "platform_provider_key_provider_status_idx"
  ON "platform_provider_api_key" ("provider_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "platform_provider_key_default_active_unique"
  ON "platform_provider_api_key" ("provider_id")
  WHERE "is_default" = true AND "status" = 'active';

CREATE TABLE IF NOT EXISTS "admin_console_audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text,
  "target_type" text NOT NULL,
  "target_id" text,
  "action" text NOT NULL,
  "reason" text,
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "admin_console_audit_log_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "admin_console_audit_target_created_at_idx"
  ON "admin_console_audit_log" ("target_type", "target_id", "created_at");

CREATE INDEX IF NOT EXISTS "admin_console_audit_actor_created_at_idx"
  ON "admin_console_audit_log" ("actor_user_id", "created_at");
