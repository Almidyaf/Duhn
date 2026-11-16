ALTER TABLE stage_runs DROP CONSTRAINT oven_start_equipment;
ALTER TABLE stage_runs ADD CONSTRAINT oven_start_equipment CHECK (
 (kind='fermentation' AND asset_id IS NULL AND asset_snapshot IS NULL AND oven_duration_minutes IS NULL)
 OR(kind='oven' AND ((status='queued' AND asset_id IS NULL AND started_by IS NULL AND oven_duration_minutes IS NULL)
 OR(status IN ('running','completed') AND asset_id IS NOT NULL AND asset_snapshot IS NOT NULL AND started_by IS NOT NULL AND oven_duration_minutes IS NOT NULL))));
ALTER TABLE material_accounts DROP CONSTRAINT material_accounts_external_kind_check;
ALTER TABLE material_accounts ADD CONSTRAINT material_accounts_external_kind_check CHECK(external_kind IN ('receipt','processing','sale'));
ALTER TABLE material_accounts ADD COLUMN production_order_id uuid UNIQUE REFERENCES production_orders(id);
ALTER TABLE material_accounts DROP CONSTRAINT material_account_owner;
ALTER TABLE material_accounts ADD CONSTRAINT material_account_owner CHECK((raw_lot_id IS NOT NULL)::int+(external_kind IS NOT NULL)::int+(fermentation_id IS NOT NULL)::int+(stage_run_id IS NOT NULL)::int+(production_order_id IS NOT NULL)::int=1);
ALTER TABLE material_movements DROP CONSTRAINT material_movement_kind;
ALTER TABLE material_movements ADD CONSTRAINT material_movement_kind CHECK(kind IN ('receipt','opening','reversal','transfer','fermentation_start','withdrawal','processing','sale'));
CREATE TABLE order_processing (
 order_id uuid PRIMARY KEY REFERENCES production_orders(id),
 state text NOT NULL CHECK(state IN ('filter_queued','filter_running','packing_queued','packing_running','finished','stored','sold','discarded')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE processing_results (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES production_orders(id),
 kind text NOT NULL CHECK(kind IN ('oven','filter','packing')),
 input_g numeric(18,3) NOT NULL CHECK(input_g>0),
 output_g numeric(18,3) NOT NULL CHECK(output_g>=0 AND output_g<=input_g),
 started_at timestamptz NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now() CHECK(completed_at>=started_at),
 actor_id text NOT NULL REFERENCES "user"(id),
 note text NOT NULL,
 movement_id uuid REFERENCES material_movements(id),
 UNIQUE(order_id,kind), CHECK(output_g>0 OR length(btrim(note))>=3)
);
CREATE TABLE production_dispatches (
 order_id uuid PRIMARY KEY REFERENCES production_orders(id),
 destination text NOT NULL CHECK(destination IN ('stored','sold')),
 quantity_g numeric(18,3) NOT NULL CHECK(quantity_g>0),
 actor_id text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER results_immutable BEFORE UPDATE OR DELETE ON processing_results FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();
CREATE TRIGGER dispatches_immutable BEFORE UPDATE OR DELETE ON production_dispatches FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();
CREATE OR REPLACE FUNCTION assert_fermentation_integrity(batch_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f fermentations%ROWTYPE; batch_account uuid; source_id uuid; remaining numeric; withdrawn numeric; order_count int; last_sequence int; s stage_runs%ROWTYPE; m uuid; o record; stage_account uuid;
BEGIN
  SELECT * INTO f FROM fermentations WHERE id=batch_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT a.id,b.quantity_g INTO batch_account,remaining FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.fermentation_id=batch_id;
  SELECT a.id INTO source_id FROM material_accounts a WHERE a.raw_lot_id=f.raw_lot_id;
  SELECT * INTO s FROM stage_runs WHERE fermentation_id=batch_id;
  IF batch_account IS NULL OR s.id IS NULL OR s.material_product_id<>f.raw_product_id OR s.policy IS DISTINCT FROM (
    CASE WHEN f.fermentation_duration_minutes IS NULL THEN f.recipe_snapshot->'policy'->'fermentation'
    ELSE (f.recipe_snapshot->'policy'->'fermentation') || jsonb_build_object(
      'duration_minutes', f.fermentation_duration_minutes,
      'warning_minutes', least((f.recipe_snapshot->'policy'->'fermentation'->>'warning_minutes')::int, f.fermentation_duration_minutes - 1)) END
  ) THEN RAISE EXCEPTION 'fermentation posting incomplete'; END IF;
  SELECT id INTO m FROM material_movements WHERE kind='fermentation_start' AND fermentation_id=batch_id;
  IF m IS NULL OR (SELECT count(*) FROM movement_lines WHERE movement_id=m)<>2
    OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=source_id AND quantity_g=-f.quantity_g)
    OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=batch_account AND quantity_g=f.quantity_g)
    OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='fermentation.started' AND entity_id=batch_id)
    THEN RAISE EXCEPTION 'fermentation requires exact source posting and event'; END IF;
  SELECT coalesce(sum(quantity_g),0),count(*),coalesce(max(sequence_no),0) INTO withdrawn,order_count,last_sequence FROM production_orders WHERE fermentation_id=batch_id;
  IF f.quantity_g<>remaining+withdrawn OR order_count<>f.withdrawal_count OR last_sequence<>order_count
    OR (f.status='fermenting' AND (s.status<>'running' OR order_count<>0))
    OR (f.status IN ('ready','depleted') AND s.status<>'completed')
    OR (f.status='ready' AND remaining<=0) OR (f.status='depleted' AND remaining<>0)
    THEN RAISE EXCEPTION 'fermentation balance or state mismatch'; END IF;
  FOR o IN SELECT * FROM production_orders WHERE fermentation_id=batch_id LOOP
    SELECT * INTO s FROM stage_runs WHERE production_order_id=o.id;
    SELECT a.id INTO stage_account FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.stage_run_id=s.id AND b.quantity_g=CASE WHEN s.status='completed' THEN 0 ELSE o.quantity_g END;
    IF s.id IS NULL OR stage_account IS NULL OR s.status NOT IN ('queued','running','completed') OR s.material_product_id<>f.raw_product_id OR s.policy IS DISTINCT FROM (
      CASE WHEN s.oven_duration_minutes IS NULL THEN f.recipe_snapshot->'policy'->'oven'
      ELSE (f.recipe_snapshot->'policy'->'oven') || jsonb_build_object(
        'duration_minutes',s.oven_duration_minutes,
        'warning_minutes',least((f.recipe_snapshot->'policy'->'oven'->>'warning_minutes')::int,s.oven_duration_minutes-1)) END
    ) THEN RAISE EXCEPTION 'withdrawal stage incomplete'; END IF;
    IF s.status='running' AND (s.asset_id IS NULL OR s.started_by IS NULL
      OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='oven.started' AND entity_id=o.id))
      THEN RAISE EXCEPTION 'oven start requires equipment and event'; END IF;
    IF s.status='completed' AND (NOT EXISTS(SELECT FROM processing_results WHERE order_id=o.id AND kind='oven') OR NOT EXISTS(SELECT FROM order_processing WHERE order_id=o.id)) THEN RAISE EXCEPTION 'completed oven requires output'; END IF;
    SELECT id INTO m FROM material_movements WHERE kind='withdrawal' AND production_order_id=o.id;
    IF m IS NULL OR (SELECT count(*) FROM movement_lines WHERE movement_id=m)<>2
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=batch_account AND quantity_g=-o.quantity_g)
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=stage_account AND quantity_g=o.quantity_g)
      OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='fermentation.withdrawn' AND entity_id=o.id)
      THEN RAISE EXCEPTION 'withdrawal requires exact posting and event'; END IF;
  END LOOP;
END;
$$;
