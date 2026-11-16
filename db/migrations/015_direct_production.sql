ALTER TABLE products ALTER COLUMN type_id DROP NOT NULL;
ALTER TABLE products ADD COLUMN raw_product_id uuid REFERENCES products(id);

UPDATE products p
SET raw_product_id = r.raw_product_id
FROM active_recipes a
JOIN recipe_versions r ON r.id = a.recipe_id
WHERE p.id = a.product_id AND p.kind = 'finished' AND p.raw_product_id IS NULL;

DROP INDEX IF EXISTS products_name_idx;
CREATE UNIQUE INDEX products_kind_name_idx ON products(kind, lower(btrim(name)));

CREATE OR REPLACE FUNCTION protect_catalog_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'product kind is immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE production_orders ALTER COLUMN fermentation_id DROP NOT NULL;
ALTER TABLE production_orders ALTER COLUMN sequence_no DROP NOT NULL;
ALTER TABLE production_orders ADD COLUMN code bigint GENERATED ALWAYS AS IDENTITY UNIQUE;
ALTER TABLE production_orders ADD COLUMN target_product_id uuid REFERENCES products(id);
ALTER TABLE production_orders ADD COLUMN raw_product_id uuid REFERENCES products(id);
ALTER TABLE production_orders ADD COLUMN raw_lot_id uuid REFERENCES material_lots(id);
ALTER TABLE production_orders ADD COLUMN product_snapshot jsonb;
ALTER TABLE production_orders ADD COLUMN settings_snapshot jsonb;
CREATE INDEX IF NOT EXISTS production_orders_page_idx ON production_orders(created_at DESC, id DESC);

ALTER TABLE material_movements DROP CONSTRAINT material_movement_kind;
ALTER TABLE material_movements ADD CONSTRAINT material_movement_kind
  CHECK(kind IN ('receipt','opening','reversal','transfer','fermentation_start','withdrawal','production_start','processing','sale'));
ALTER TABLE material_movements DROP CONSTRAINT material_movement_process;
ALTER TABLE material_movements ADD CONSTRAINT material_movement_process
  CHECK((kind<>'fermentation_start' OR fermentation_id IS NOT NULL) AND (kind NOT IN ('withdrawal','production_start') OR production_order_id IS NOT NULL));

CREATE OR REPLACE FUNCTION assert_production_order_integrity(oid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  o production_orders%ROWTYPE;
  s stage_runs%ROWTYPE;
  stage_account uuid;
  source_id uuid;
  m uuid;
BEGIN
  SELECT * INTO o FROM production_orders WHERE id = oid;
  IF NOT FOUND OR o.fermentation_id IS NOT NULL THEN RETURN; END IF;
  SELECT a.id INTO source_id FROM material_accounts a WHERE a.raw_lot_id = o.raw_lot_id;
  SELECT * INTO s FROM stage_runs WHERE production_order_id = oid;
  SELECT a.id INTO stage_account
  FROM material_accounts a
  JOIN material_balances b ON b.account_id = a.id
  WHERE a.stage_run_id = s.id AND b.quantity_g = CASE WHEN s.status = 'completed' THEN 0 ELSE o.quantity_g END;
  IF o.target_product_id IS NULL OR o.raw_product_id IS NULL OR o.raw_lot_id IS NULL
    OR s.id IS NULL OR stage_account IS NULL OR s.kind <> 'oven'
    OR s.status NOT IN ('queued', 'running', 'completed')
    OR s.material_product_id <> o.raw_product_id THEN
    RAISE EXCEPTION 'direct production order incomplete';
  END IF;
  SELECT id INTO m FROM material_movements WHERE kind = 'production_start' AND production_order_id = oid;
  IF m IS NULL OR (SELECT count(*) FROM movement_lines WHERE movement_id = m) <> 2
    OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id = m AND account_id = source_id AND quantity_g = -o.quantity_g)
    OR NOT EXISTS(SELECT FROM movement_lines WHERE movement_id = m AND account_id = stage_account AND quantity_g = o.quantity_g)
    OR NOT EXISTS(SELECT FROM outbox_events WHERE topic = 'production.started' AND entity_id = oid) THEN
    RAISE EXCEPTION 'direct production order requires exact posting and event';
  END IF;
END;
$$;
