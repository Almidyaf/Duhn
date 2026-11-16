ALTER TABLE stage_runs ADD COLUMN asset_id uuid REFERENCES assets(id);
ALTER TABLE stage_runs ADD COLUMN asset_snapshot jsonb;
ALTER TABLE stage_runs ADD COLUMN started_by text REFERENCES "user"(id);
ALTER TABLE stage_runs ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE stage_runs ADD COLUMN oven_duration_minutes integer CHECK(oven_duration_minutes BETWEEN 1 AND 525600);
ALTER TABLE stage_runs ADD CONSTRAINT oven_start_equipment CHECK (
  (kind='fermentation' AND asset_id IS NULL AND asset_snapshot IS NULL AND oven_duration_minutes IS NULL)
  OR (kind='oven' AND (
    (status='queued' AND asset_id IS NULL AND asset_snapshot IS NULL AND started_by IS NULL AND oven_duration_minutes IS NULL)
    OR (status='running' AND asset_id IS NOT NULL AND asset_snapshot IS NOT NULL AND started_by IS NOT NULL AND oven_duration_minutes IS NOT NULL)
  ))
);
CREATE UNIQUE INDEX one_running_stage_per_oven ON stage_runs(asset_id) WHERE asset_id IS NOT NULL AND status='running';

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
    SELECT a.id INTO stage_account FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.stage_run_id=s.id AND b.quantity_g=o.quantity_g;
    IF s.id IS NULL OR stage_account IS NULL OR s.status NOT IN ('queued','running') OR s.material_product_id<>f.raw_product_id OR s.policy IS DISTINCT FROM (
      CASE WHEN s.oven_duration_minutes IS NULL THEN f.recipe_snapshot->'policy'->'oven'
      ELSE (f.recipe_snapshot->'policy'->'oven') || jsonb_build_object(
        'duration_minutes',s.oven_duration_minutes,
        'warning_minutes',least((f.recipe_snapshot->'policy'->'oven'->>'warning_minutes')::int,s.oven_duration_minutes-1)) END
    ) THEN RAISE EXCEPTION 'withdrawal stage incomplete'; END IF;
    IF s.status='running' AND (s.asset_id IS NULL OR s.started_by IS NULL
      OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='oven.started' AND entity_id=o.id))
      THEN RAISE EXCEPTION 'oven start requires equipment and event'; END IF;
    SELECT id INTO m FROM material_movements WHERE kind='withdrawal' AND production_order_id=o.id;
    IF m IS NULL OR (SELECT count(*) FROM movement_lines WHERE movement_id=m)<>2
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=batch_account AND quantity_g=-o.quantity_g)
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=stage_account AND quantity_g=o.quantity_g)
      OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='fermentation.withdrawn' AND entity_id=o.id)
      THEN RAISE EXCEPTION 'withdrawal requires exact posting and event'; END IF;
  END LOOP;
END;
$$;
