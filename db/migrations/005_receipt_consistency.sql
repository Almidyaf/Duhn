-- At commit a receipt must have its complete source trace and posted movement.
-- This protects against partial future service implementations, not just today's UI.
CREATE FUNCTION validate_receipt_integrity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE row_receipt public.receipts; original uuid; line_total integer;
BEGIN
  SELECT * INTO row_receipt FROM public.receipts WHERE id=NEW.id;
  SELECT count(*) INTO line_total FROM public.receipt_lines WHERE receipt_id=NEW.id;
  SELECT id INTO original FROM public.material_movements WHERE receipt_id=NEW.id
    AND kind=CASE WHEN row_receipt.kind='opening' THEN 'opening' ELSE 'receipt' END;
  IF line_total<1 OR line_total>25 OR original IS NULL THEN RAISE EXCEPTION 'receipt posting incomplete'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.receipt_lines l
    LEFT JOIN public.material_lots m ON m.receipt_line_id=l.id
    LEFT JOIN public.material_accounts a ON a.raw_lot_id=m.id
    LEFT JOIN public.movement_lines ml ON ml.account_id=a.id AND ml.movement_id=original
    WHERE l.receipt_id=NEW.id AND (m.id IS NULL OR m.product_id<>l.product_id OR a.id IS NULL OR ml.quantity_g IS DISTINCT FROM l.quantity_g)
  ) OR (SELECT count(*) FROM public.movement_lines WHERE movement_id=original)<>line_total*2
  OR EXISTS (
    SELECT 1 FROM public.movement_lines ml JOIN public.material_accounts a ON a.id=ml.account_id
    LEFT JOIN public.material_lots m ON m.id=a.raw_lot_id
    LEFT JOIN public.receipt_lines l ON l.id=m.receipt_line_id
    WHERE ml.movement_id=original AND (a.external_kind IS NULL AND l.receipt_id IS DISTINCT FROM NEW.id)
  ) THEN RAISE EXCEPTION 'receipt source and movement mismatch'; END IF;
  IF NOT EXISTS(SELECT FROM public.outbox_events WHERE entity_id=NEW.id AND topic='receipt.posted') THEN
    RAISE EXCEPTION 'receipt event missing';
  END IF;
  IF row_receipt.status='voided' AND (
    NOT EXISTS(SELECT FROM public.material_movements WHERE receipt_id=NEW.id AND kind='reversal' AND reverses_id=original)
    OR NOT EXISTS(SELECT FROM public.outbox_events WHERE entity_id=NEW.id AND topic='receipt.voided')
  ) THEN RAISE EXCEPTION 'receipt void requires reversal and event'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER receipt_complete AFTER INSERT OR UPDATE ON receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_receipt_integrity();
