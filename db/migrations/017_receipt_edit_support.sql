-- Allow metadata updates on receipts (supplier_name, reference, note) and unit_price on receipt_lines
-- while keeping all quantities, movements, and ledger identities strictly immutable.

CREATE OR REPLACE FUNCTION protect_receipt_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Permitted case 1: Documented void
  IF OLD.status = 'posted' AND NEW.status = 'voided' AND NEW.version = OLD.version + 1
    AND (to_jsonb(NEW) - ARRAY['status','version','void_reason','voided_at','voided_by'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','void_reason','voided_at','voided_by']) THEN
    RETURN NEW;
  END IF;

  -- Permitted case 2: Metadata edit (supplier_name, reference, note) while remaining posted
  IF OLD.status = 'posted' AND NEW.status = 'posted' AND NEW.version = OLD.version + 1
    AND (to_jsonb(NEW) - ARRAY['supplier_name','reference','note','version'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['supplier_name','reference','note','version']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'posted receipt only permits documented void or metadata edit';
END;
$$;

CREATE OR REPLACE FUNCTION protect_receipt_line_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'unit_price') IS DISTINCT FROM (to_jsonb(OLD) - 'unit_price') THEN
    RAISE EXCEPTION 'receipt line quantities, products and lots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS immutable_rows ON receipt_lines;
DROP TRIGGER IF EXISTS receipt_line_protect ON receipt_lines;
CREATE TRIGGER receipt_line_protect BEFORE UPDATE ON receipt_lines
FOR EACH ROW EXECUTE FUNCTION protect_receipt_line_history();

DROP TRIGGER IF EXISTS receipt_line_no_delete ON receipt_lines;
CREATE TRIGGER receipt_line_no_delete BEFORE DELETE ON receipt_lines
FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();

DROP TRIGGER IF EXISTS receipt_line_no_truncate ON receipt_lines;
CREATE TRIGGER receipt_line_no_truncate BEFORE TRUNCATE ON receipt_lines
FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();

DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('GRANT UPDATE(supplier_name,reference,note,version) ON receipts TO %I', app_role);
      EXECUTE format('GRANT UPDATE(unit_price) ON receipt_lines TO %I', app_role);
    END IF;
  END LOOP;
END;
$$;
