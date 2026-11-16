CREATE TABLE fermentations (
  id uuid PRIMARY KEY,
  code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  target_product_id uuid NOT NULL REFERENCES products(id),
  raw_product_id uuid NOT NULL REFERENCES products(id),
  raw_lot_id uuid NOT NULL REFERENCES material_lots(id),
  recipe_id uuid NOT NULL REFERENCES recipe_approvals(recipe_id),
  product_snapshot jsonb NOT NULL,
  recipe_snapshot jsonb NOT NULL,
  settings_snapshot jsonb NOT NULL,
  quantity_g numeric NOT NULL CHECK(quantity_g>0 AND quantity_g<=999999999999999.999 AND scale(quantity_g)<=3),
  status text NOT NULL DEFAULT 'fermenting' CHECK(status IN ('fermenting','ready','depleted')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  withdrawal_count integer NOT NULL DEFAULT 0 CHECK(withdrawal_count>=0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,raw_product_id),
  FOREIGN KEY(recipe_id,target_product_id) REFERENCES recipe_versions(id,product_id),
  FOREIGN KEY(raw_lot_id,raw_product_id) REFERENCES material_lots(id,product_id)
);
CREATE INDEX fermentations_page_idx ON fermentations(created_at DESC,id DESC);
CREATE INDEX fermentations_product_idx ON fermentations(target_product_id);
CREATE TABLE production_orders (
  id uuid PRIMARY KEY,
  fermentation_id uuid NOT NULL REFERENCES fermentations(id),
  sequence_no integer NOT NULL CHECK(sequence_no>0),
  quantity_g numeric NOT NULL CHECK(quantity_g>0 AND quantity_g<=999999999999999.999 AND scale(quantity_g)<=3),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fermentation_id,sequence_no)
);
CREATE TABLE stage_runs (
  id uuid PRIMARY KEY,
  fermentation_id uuid REFERENCES fermentations(id),
  production_order_id uuid REFERENCES production_orders(id),
  material_product_id uuid NOT NULL REFERENCES products(id),
  kind text NOT NULL CHECK(kind IN ('fermentation','oven')),
  attempt_no integer NOT NULL DEFAULT 1 CHECK(attempt_no=1),
  policy jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','completed')),
  started_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by text REFERENCES "user"(id),
  CHECK((fermentation_id IS NOT NULL)::int+(production_order_id IS NOT NULL)::int=1),
  CHECK((kind='fermentation' AND fermentation_id IS NOT NULL) OR (kind='oven' AND production_order_id IS NOT NULL)),
  CHECK((status='queued' AND started_at IS NULL AND due_at IS NULL AND completed_at IS NULL AND completed_by IS NULL)
    OR (status='running' AND started_at IS NOT NULL AND due_at>=started_at AND completed_at IS NULL AND completed_by IS NULL)
    OR (status='completed' AND started_at IS NOT NULL AND due_at>=started_at AND completed_at>=due_at AND completed_by IS NOT NULL)),
  UNIQUE(id,material_product_id)
);
CREATE UNIQUE INDEX fermentation_stage_unique ON stage_runs(fermentation_id) WHERE fermentation_id IS NOT NULL;
CREATE UNIQUE INDEX order_stage_unique ON stage_runs(production_order_id) WHERE production_order_id IS NOT NULL;
ALTER TABLE material_accounts ADD COLUMN fermentation_id uuid;
ALTER TABLE material_accounts ADD COLUMN stage_run_id uuid;
ALTER TABLE material_accounts ADD FOREIGN KEY(fermentation_id,product_id) REFERENCES fermentations(id,raw_product_id);
ALTER TABLE material_accounts ADD FOREIGN KEY(stage_run_id,product_id) REFERENCES stage_runs(id,material_product_id);
ALTER TABLE material_accounts DROP CONSTRAINT material_accounts_check;
ALTER TABLE material_accounts ADD CONSTRAINT material_account_owner CHECK((raw_lot_id IS NOT NULL)::int+(external_kind IS NOT NULL)::int+(fermentation_id IS NOT NULL)::int+(stage_run_id IS NOT NULL)::int=1);
CREATE UNIQUE INDEX material_fermentation_account ON material_accounts(fermentation_id) WHERE fermentation_id IS NOT NULL;
CREATE UNIQUE INDEX material_stage_account ON material_accounts(stage_run_id) WHERE stage_run_id IS NOT NULL;
ALTER TABLE material_movements ADD COLUMN fermentation_id uuid REFERENCES fermentations(id);
ALTER TABLE material_movements ADD COLUMN production_order_id uuid REFERENCES production_orders(id);
ALTER TABLE material_movements DROP CONSTRAINT material_movements_kind_check;
ALTER TABLE material_movements ADD CONSTRAINT material_movement_kind CHECK(kind IN ('receipt','opening','reversal','transfer','fermentation_start','withdrawal'));
ALTER TABLE material_movements ADD CONSTRAINT material_movement_process CHECK((kind<>'fermentation_start' OR fermentation_id IS NOT NULL) AND (kind<>'withdrawal' OR production_order_id IS NOT NULL));
CREATE UNIQUE INDEX fermentation_start_movement ON material_movements(fermentation_id) WHERE kind='fermentation_start';
CREATE UNIQUE INDEX withdrawal_movement ON material_movements(production_order_id) WHERE kind='withdrawal';
CREATE TRIGGER orders_immutable BEFORE UPDATE OR DELETE ON production_orders FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();
CREATE TRIGGER orders_no_truncate BEFORE TRUNCATE ON production_orders FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
CREATE FUNCTION protect_fermentation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['status','version','withdrawal_count']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','withdrawal_count']) THEN RAISE EXCEPTION 'fermentation source and snapshots are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fermentation_history BEFORE UPDATE ON fermentations FOR EACH ROW EXECUTE FUNCTION protect_fermentation_history();
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON production_orders FROM %I',app_role);
      EXECUTE format('REVOKE DELETE,TRUNCATE ON fermentations,stage_runs FROM %I',app_role);
    END IF;
  END LOOP;
END;
$$;
