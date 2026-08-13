CREATE TABLE IF NOT EXISTS "platform_credit_wallet" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade,
  "available_credits" integer DEFAULT 0 NOT NULL,
  "reserved_credits" integer DEFAULT 0 NOT NULL,
  "total_consumed_credits" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "platform_credit_wallet_nonnegative" CHECK ("available_credits" >= 0 AND "reserved_credits" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_credit_wallet_user_unique" ON "platform_credit_wallet" ("user_id");

CREATE TABLE IF NOT EXISTS "platform_credit_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "wallet_id" text NOT NULL REFERENCES "platform_credit_wallet"("id") ON DELETE cascade,
  "operation_id" text NOT NULL,
  "event_type" text NOT NULL,
  "available_delta" integer NOT NULL,
  "reserved_delta" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "actor_user_id" text REFERENCES "public"."user"("id") ON DELETE set null,
  "workspace_id" text REFERENCES "workspace"("id") ON DELETE set null,
  "workflow_id" text REFERENCES "workflow"("id") ON DELETE set null,
  "capability" text,
  "model_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "platform_credit_ledger_wallet_created_at_idx" ON "platform_credit_ledger" ("wallet_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_credit_ledger_operation_event_unique" ON "platform_credit_ledger" ("operation_id", "event_type");
