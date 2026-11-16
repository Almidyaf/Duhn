ALTER TABLE order_processing ADD CONSTRAINT processing_running_time CHECK((state IN ('filter_running','packing_running'))=(started_at IS NOT NULL));
CREATE FUNCTION verify_processing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid; p order_processing%ROWTYPE; o production_orders%ROWTYPE; oven processing_results%ROWTYPE; filtered processing_results%ROWTYPE; packed processing_results%ROWTYPE; amount numeric; expected numeric;
BEGIN
 oid:=NEW.order_id;
 SELECT * INTO p FROM order_processing WHERE order_id=oid;
 SELECT * INTO o FROM production_orders WHERE id=oid;
 SELECT * INTO oven FROM processing_results WHERE order_id=oid AND kind='oven';
 SELECT * INTO filtered FROM processing_results WHERE order_id=oid AND kind='filter';
 SELECT * INTO packed FROM processing_results WHERE order_id=oid AND kind='packing';
 SELECT b.quantity_g INTO amount FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.production_order_id=oid;
 IF p.order_id IS NULL OR oven.id IS NULL OR oven.input_g<>o.quantity_g OR amount IS NULL
  OR (filtered.id IS NOT NULL AND filtered.input_g<>oven.output_g)
  OR (packed.id IS NOT NULL AND (filtered.id IS NULL OR packed.input_g<>filtered.output_g))
  OR (p.state IN ('packing_queued','packing_running') AND filtered.id IS NULL)
  OR (p.state IN ('finished','stored','sold') AND packed.id IS NULL)
  THEN RAISE EXCEPTION 'production result chain incomplete'; END IF;
 expected:=coalesce(packed.output_g,filtered.output_g,oven.output_g);
 IF (p.state='discarded' AND expected<>0) OR (p.state<>'discarded' AND expected<=0)
  OR amount<>(CASE WHEN p.state='sold' THEN 0 ELSE expected END) THEN RAISE EXCEPTION 'production result balance mismatch'; END IF;
 IF p.state IN ('stored','sold') AND NOT EXISTS(SELECT FROM production_dispatches WHERE order_id=oid AND destination=p.state AND quantity_g=expected) THEN RAISE EXCEPTION 'production dispatch missing'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER processing_consistency AFTER INSERT OR UPDATE ON order_processing DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_processing();
CREATE CONSTRAINT TRIGGER results_consistency AFTER INSERT ON processing_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_processing();
CREATE CONSTRAINT TRIGGER dispatch_consistency AFTER INSERT ON production_dispatches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_processing();
CREATE TRIGGER results_no_truncate BEFORE TRUNCATE ON processing_results FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
CREATE TRIGGER dispatch_no_truncate BEFORE TRUNCATE ON production_dispatches FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
