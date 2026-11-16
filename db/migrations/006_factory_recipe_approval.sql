CREATE TABLE factory_settings (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000001',
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
  name text NOT NULL DEFAULT '' CHECK(length(name)<=120),
  timezone text,
  week_starts_on integer CHECK(week_starts_on BETWEEN 0 AND 6),
  weight_precision integer NOT NULL DEFAULT 3 CHECK(weight_precision=3),
  configured boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by text REFERENCES "user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT configured OR (length(btrim(name))>=2 AND timezone IS NOT NULL AND week_starts_on IS NOT NULL AND updated_by IS NOT NULL))
);
INSERT INTO factory_settings(singleton) VALUES(true);
ALTER TABLE recipe_versions ADD CONSTRAINT recipe_product_identity UNIQUE(id,product_id);
CREATE TABLE recipe_approvals (
  recipe_id uuid PRIMARY KEY REFERENCES recipe_versions(id),
  approved_by text NOT NULL REFERENCES "user"(id),
  approval_note text NOT NULL CHECK(length(btrim(approval_note)) BETWEEN 3 AND 1000),
  settings_snapshot jsonb NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE active_recipes (
  product_id uuid PRIMARY KEY REFERENCES products(id),
  recipe_id uuid NOT NULL REFERENCES recipe_approvals(recipe_id),
  FOREIGN KEY (recipe_id,product_id) REFERENCES recipe_versions(id,product_id)
);
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE ON recipe_approvals FOR EACH ROW EXECUTE FUNCTION reject_material_mutation();
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON recipe_approvals FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('REVOKE INSERT,DELETE,TRUNCATE ON factory_settings FROM %I',app_role);
      EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON recipe_approvals FROM %I',app_role);
    END IF;
  END LOOP;
END;
$$;
