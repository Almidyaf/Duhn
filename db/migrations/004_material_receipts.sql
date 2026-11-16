CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  kind text NOT NULL CHECK (kind IN ('purchase','opening')),
  supplier_id uuid REFERENCES suppliers(id),
  supplier_name text,
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_txid bigint NOT NULL DEFAULT txid_current(),
  void_reason text CHECK (length(void_reason) BETWEEN 3 AND 1000),
  voided_at timestamptz,
  voided_by text REFERENCES "user"(id),
  CHECK ((kind='purchase' AND supplier_id IS NOT NULL AND supplier_name IS NOT NULL)
    OR (kind='opening' AND supplier_id IS NULL AND supplier_name IS NULL AND length(btrim(note)) >= 3)),
  CHECK ((status='posted' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL)
    OR (status='voided' AND void_reason IS NOT NULL AND voided_at IS NOT NULL AND voided_by IS NOT NULL))
);
CREATE UNIQUE INDEX receipts_reference_idx ON receipts(supplier_id,lower(btrim(reference))) WHERE kind='purchase' AND btrim(reference)<>'';
CREATE INDEX receipts_page_idx ON receipts(created_at DESC,id DESC);
CREATE TABLE receipt_lines (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES receipts(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  type_name text NOT NULL,
  quantity_g numeric NOT NULL CHECK (quantity_g>0 AND quantity_g<=999999999999999.999 AND scale(quantity_g)<=3),
  UNIQUE(receipt_id,product_id)
);
CREATE INDEX receipt_lines_product_idx ON receipt_lines(product_id);
CREATE TABLE material_lots (
  id uuid PRIMARY KEY,
  code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  receipt_line_id uuid NOT NULL UNIQUE REFERENCES receipt_lines(id),
  product_id uuid NOT NULL REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,product_id)
);
CREATE INDEX material_lots_page_idx ON material_lots(created_at DESC,id DESC);
CREATE INDEX material_lots_product_idx ON material_lots(product_id);
CREATE TABLE material_accounts (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  raw_lot_id uuid,
  external_kind text CHECK (external_kind='receipt'),
  unit text NOT NULL DEFAULT 'g' CHECK (unit='g'),
  FOREIGN KEY (raw_lot_id,product_id) REFERENCES material_lots(id,product_id),
  CHECK ((raw_lot_id IS NOT NULL)::int + (external_kind IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX material_account_lot_idx ON material_accounts(raw_lot_id) WHERE raw_lot_id IS NOT NULL;
CREATE UNIQUE INDEX material_account_external_idx ON material_accounts(product_id,external_kind) WHERE external_kind IS NOT NULL;
CREATE TABLE material_balances (
  account_id uuid PRIMARY KEY REFERENCES material_accounts(id),
  quantity_g numeric(18,3) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0 CHECK (version>=0)
);
CREATE TABLE material_movements (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('receipt','opening','reversal','transfer')),
  receipt_id uuid REFERENCES receipts(id),
  reverses_id uuid UNIQUE REFERENCES material_movements(id),
  reason text NOT NULL DEFAULT '' CHECK (length(reason)<=1000),
  actor_id text NOT NULL REFERENCES "user"(id),
  request_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_txid bigint NOT NULL DEFAULT txid_current(),
  CHECK ((kind='reversal')=(reverses_id IS NOT NULL)),
  CHECK (kind NOT IN ('receipt','opening','reversal') OR receipt_id IS NOT NULL),
  CHECK (kind<>'reversal' OR length(btrim(reason))>=3)
);
CREATE UNIQUE INDEX material_receipt_post_idx ON material_movements(receipt_id) WHERE kind IN ('receipt','opening');
CREATE INDEX material_movements_actor_key_idx ON material_movements(actor_id,request_key);
CREATE TABLE movement_lines (
  movement_id uuid NOT NULL REFERENCES material_movements(id),
  account_id uuid NOT NULL REFERENCES material_accounts(id),
  quantity_g numeric NOT NULL CHECK (quantity_g<>0 AND abs(quantity_g)<=999999999999999.999 AND scale(quantity_g)<=3),
  PRIMARY KEY(movement_id,account_id)
);
CREATE INDEX movement_lines_account_idx ON movement_lines(account_id,movement_id);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  entity_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic,entity_id)
);

CREATE FUNCTION reject_material_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'material history is immutable'; END;
$$;
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['receipt_lines','material_lots','material_accounts','material_movements','movement_lines','outbox_events'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_material_mutation()',tab);
    EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation()',tab);
  END LOOP;
END;
$$;

CREATE FUNCTION initialize_material_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.material_balances(account_id) VALUES(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER material_account_balance AFTER INSERT ON material_accounts FOR EACH ROW EXECUTE FUNCTION initialize_material_balance();

CREATE FUNCTION apply_material_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE external_account boolean; new_balance numeric;
BEGIN
  IF NOT EXISTS(SELECT FROM public.material_movements WHERE id=NEW.movement_id AND created_txid=txid_current()) THEN
    RAISE EXCEPTION 'cannot append to a committed movement';
  END IF;
  SELECT external_kind IS NOT NULL INTO external_account FROM public.material_accounts WHERE id=NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found'; END IF;
  UPDATE public.material_balances SET quantity_g=quantity_g+NEW.quantity_g,version=version+1
    WHERE account_id=NEW.account_id RETURNING quantity_g INTO new_balance;
  IF NOT external_account AND new_balance<0 THEN
    RAISE EXCEPTION 'insufficient material balance' USING ERRCODE='23514', CONSTRAINT='material_nonnegative';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER material_line_balance BEFORE INSERT ON movement_lines FOR EACH ROW EXECUTE FUNCTION apply_material_line();

CREATE FUNCTION validate_material_movement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (SELECT count(*) FROM public.movement_lines WHERE movement_id=NEW.id)<2
    OR EXISTS(SELECT a.product_id FROM public.movement_lines l JOIN public.material_accounts a ON a.id=l.account_id
      WHERE l.movement_id=NEW.id GROUP BY a.product_id HAVING sum(l.quantity_g)<>0) THEN
    RAISE EXCEPTION 'movement must balance per product' USING ERRCODE='23514', CONSTRAINT='material_balanced';
  END IF;
  IF NEW.reverses_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM (
      SELECT account_id,quantity_g FROM public.movement_lines WHERE movement_id=NEW.id
      UNION ALL SELECT account_id,quantity_g FROM public.movement_lines WHERE movement_id=NEW.reverses_id
    ) pair GROUP BY account_id HAVING sum(quantity_g)<>0
  ) THEN RAISE EXCEPTION 'reversal must exactly negate its source'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER balanced_movement AFTER INSERT ON material_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_material_movement();

CREATE FUNCTION protect_receipt_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'posted' OR NEW.status<>'voided' OR NEW.version<>OLD.version+1
    OR (to_jsonb(NEW)-ARRAY['status','version','void_reason','voided_at','voided_by'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','void_reason','voided_at','voided_by']) THEN
    RAISE EXCEPTION 'posted receipt only permits documented void';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER receipt_protected BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION protect_receipt_history();
CREATE TRIGGER receipt_no_delete BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();
CREATE TRIGGER receipt_no_truncate BEFORE TRUNCATE ON receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
REVOKE ALL ON FUNCTION initialize_material_balance(),apply_material_line() FROM PUBLIC;
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON material_balances FROM %I',app_role);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON receipt_lines,material_lots,material_accounts,material_movements,movement_lines,outbox_events FROM %I',app_role);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON receipts FROM %I',app_role);
      EXECUTE format('GRANT UPDATE(status,version,void_reason,voided_at,voided_by) ON receipts TO %I',app_role);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION lock_material_balances(ids uuid[]) RETURNS TABLE(account_id uuid,quantity_g numeric,version integer,product_id uuid,external_kind text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT b.account_id,b.quantity_g,b.version,a.product_id,a.external_kind
  FROM public.material_balances b JOIN public.material_accounts a ON a.id=b.account_id
  WHERE b.account_id=ANY(ids) ORDER BY b.account_id FOR UPDATE OF b;
$$;
REVOKE ALL ON FUNCTION lock_material_balances(uuid[]) FROM PUBLIC;
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION lock_material_balances(uuid[]) TO %I',app_role);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION protect_receipt_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM receipts WHERE id=NEW.receipt_id AND created_txid=txid_current() AND status='posted') THEN
    RAISE EXCEPTION 'cannot append to a committed receipt';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER receipt_line_insert BEFORE INSERT ON receipt_lines FOR EACH ROW EXECUTE FUNCTION protect_receipt_line_insert();
