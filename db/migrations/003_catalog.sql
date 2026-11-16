CREATE TABLE product_types (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_types_name_idx ON product_types(lower(btrim(name)));
CREATE INDEX product_types_page_idx ON product_types(created_at DESC,id DESC);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  type_id uuid NOT NULL REFERENCES product_types(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('raw','finished')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_name_idx ON products(type_id,lower(btrim(name)));
CREATE INDEX products_type_page_idx ON products(type_id,created_at DESC,id DESC);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  contact text NOT NULL DEFAULT '' CHECK (length(contact) <= 120),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_idx ON suppliers(lower(btrim(name)));
CREATE INDEX suppliers_page_idx ON suppliers(created_at DESC,id DESC);

-- A revision is a complete immutable draft, not authorization to run a factory batch.
CREATE TABLE recipe_versions (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  revision integer NOT NULL CHECK (revision > 0),
  raw_product_id uuid NOT NULL REFERENCES products(id),
  product_snapshot jsonb NOT NULL,
  raw_snapshot jsonb NOT NULL,
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,revision)
);
CREATE INDEX recipe_versions_raw_idx ON recipe_versions(raw_product_id);
CREATE INDEX recipe_versions_page_idx ON recipe_versions(product_id,created_at DESC,id DESC);
CREATE FUNCTION protect_catalog_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type_id <> OLD.type_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'product identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_identity BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION protect_catalog_identity();
CREATE FUNCTION prevent_recipe_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recipe revisions are immutable';
END;
$$;
CREATE TRIGGER recipes_no_update_delete BEFORE UPDATE OR DELETE ON recipe_versions
FOR EACH ROW EXECUTE FUNCTION prevent_recipe_mutation();
CREATE TRIGGER recipes_no_truncate BEFORE TRUNCATE ON recipe_versions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_recipe_mutation();
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON product_types,products,suppliers FROM %I', app_role);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON recipe_versions FROM %I', app_role);
    END IF;
  END LOOP;
END;
$$;
