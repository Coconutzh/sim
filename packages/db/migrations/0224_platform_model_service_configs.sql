CREATE TABLE IF NOT EXISTS "platform_model_service_config" (
  "id" text PRIMARY KEY NOT NULL,
  "consumer" text NOT NULL,
  "capability" text NOT NULL,
  "family" text NOT NULL,
  "provider_id" text NOT NULL,
  "service_kind" text NOT NULL,
  "base_url" text,
  "enabled_model_ids" jsonb NOT NULL,
  "default_model_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "config_version" integer DEFAULT 1 NOT NULL,
  "created_by" text REFERENCES "public"."user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "platform_model_service_consumer_capability_idx"
  ON "platform_model_service_config" ("consumer", "capability", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "platform_model_service_consumer_family_unique"
  ON "platform_model_service_config" ("consumer", "capability", "family");
