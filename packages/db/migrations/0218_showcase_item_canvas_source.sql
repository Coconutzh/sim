ALTER TABLE "production_showcase_item"
  ADD COLUMN IF NOT EXISTS "source_workflow_id" text;

ALTER TABLE "production_showcase_item"
  ADD COLUMN IF NOT EXISTS "source_node_id" text;

ALTER TABLE "production_showcase_item"
  ADD COLUMN IF NOT EXISTS "source_node_variant" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_showcase_item_source_workflow_id_workflow_id_fk'
  ) THEN
    ALTER TABLE "production_showcase_item"
      ADD CONSTRAINT "production_showcase_item_source_workflow_id_workflow_id_fk"
      FOREIGN KEY ("source_workflow_id") REFERENCES "public"."workflow"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "production_showcase_item_source_workflow_idx"
  ON "production_showcase_item" USING btree ("source_workflow_id");

CREATE INDEX IF NOT EXISTS "production_showcase_item_source_node_idx"
  ON "production_showcase_item" USING btree ("source_node_id");
