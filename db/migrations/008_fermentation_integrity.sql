CREATE INDEX production_orders_page_idx ON production_orders(fermentation_id,created_at DESC,id DESC);

-- Deferred checks see the complete command, including ledger, stage and durable event.
-- This release supports fermentation and queued oven orders only. Oven execution will
-- extend these invariants alongside its explicit conversion/consumption rules.
CREATE FUNCTION assert_fermentation_integrity(batch_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f fermentations%ROWTYPE; batch_account uuid; source_id uuid; remaining numeric; withdrawn numeric; order_count int; last_sequence int; s stage_runs%ROWTYPE; m uuid; o record; stage_account uuid;
BEGIN
  SELECT * INTO f FROM fermentations WHERE id=batch_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT a.id,b.quantity_g INTO batch_account,remaining FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.fermentation_id=batch_id;
  SELECT a.id INTO source_id FROM material_accounts a WHERE a.raw_lot_id=f.raw_lot_id;
  SELECT * INTO s FROM stage_runs WHERE fermentation_id=batch_id;
  IF batch_account IS NULL OR s.id IS NULL OR s.material_product_id<>f.raw_product_id OR s.policy IS DISTINCT FROM f.recipe_snapshot->'policy'->'fermentation' THEN RAISE EXCEPTION 'fermentation posting incomplete'; END IF;
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
    IF s.id IS NULL OR stage_account IS NULL OR s.status<>'queued' OR s.material_product_id<>f.raw_product_id OR s.policy IS DISTINCT FROM f.recipe_snapshot->'policy'->'oven' THEN RAISE EXCEPTION 'withdrawal stage incomplete'; END IF;
    SELECT id INTO m FROM material_movements WHERE kind='withdrawal' AND production_order_id=o.id;
    IF m IS NULL OR (SELECT count(*) FROM movement_lines WHERE movement_id=m)<>2
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=batch_account AND quantity_g=-o.quantity_g)
      OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id=m AND movement_lines.account_id=stage_account AND quantity_g=o.quantity_g)
      OR NOT EXISTS(SELECT FROM outbox_events WHERE topic='fermentation.withdrawn' AND entity_id=o.id)
      THEN RAISE EXCEPTION 'withdrawal requires exact posting and event'; END IF;
  END LOOP;
END;
$$;
CREATE FUNCTION check_fermentation_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id uuid; related record;
BEGIN
  IF TG_TABLE_NAME='fermentations' THEN batch_id:=NEW.id;
  ELSIF TG_TABLE_NAME='production_orders' THEN batch_id:=NEW.fermentation_id;
  ELSIF TG_TABLE_NAME='stage_runs' THEN
    batch_id:=NEW.fermentation_id;
    IF batch_id IS NULL THEN SELECT fermentation_id INTO batch_id FROM production_orders WHERE id=NEW.production_order_id; END IF;
  ELSE
    -- A movement cannot silently change a production balance without updating its parent.
    FOR related IN SELECT DISTINCT coalesce(a.fermentation_id,s.fermentation_id,o.fermentation_id) AS id
      FROM movement_lines l JOIN material_accounts a ON a.id=l.account_id
      LEFT JOIN stage_runs s ON s.id=a.stage_run_id LEFT JOIN production_orders o ON o.id=s.production_order_id
      WHERE l.movement_id=NEW.id LOOP
      IF related.id IS NOT NULL THEN PERFORM assert_fermentation_integrity(related.id); END IF;
    END LOOP;
    batch_id:=NEW.fermentation_id;
    IF batch_id IS NULL AND NEW.production_order_id IS NOT NULL THEN SELECT fermentation_id INTO batch_id FROM production_orders WHERE id=NEW.production_order_id; END IF;
  END IF;
  IF batch_id IS NOT NULL THEN PERFORM assert_fermentation_integrity(batch_id); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER fermentation_integrity AFTER INSERT OR UPDATE ON fermentations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fermentation_integrity();
CREATE CONSTRAINT TRIGGER order_integrity AFTER INSERT ON production_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fermentation_integrity();
CREATE CONSTRAINT TRIGGER stage_integrity AFTER INSERT OR UPDATE ON stage_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fermentation_integrity();
CREATE CONSTRAINT TRIGGER production_movement_integrity AFTER INSERT ON material_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fermentation_integrity();
