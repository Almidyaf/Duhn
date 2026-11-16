CREATE TABLE app_members (
  user_id text PRIMARY KEY REFERENCES "user"(id),
  role text NOT NULL CHECK (role IN ('owner','manager','operator')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  category text NOT NULL CHECK (category IN ('oven','fermentation_vessel','scale','equipment','other')),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 120),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_created_idx ON assets(created_at DESC,id DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  action text NOT NULL,
  entity_id uuid NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  request_key uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_events(entity_id,recorded_at);

CREATE TABLE idempotency_requests (
  actor_id text NOT NULL REFERENCES "user"(id),
  request_key uuid NOT NULL,
  operation text NOT NULL,
  payload_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,request_key)
);

CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();

-- The migration connection owns the tables; ordinary app roles may not grant membership.
DO $$
DECLARE app_role text;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['duhn_app','duhn_test_app'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=app_role) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app_members FROM %I', app_role);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM %I', app_role);
      EXECUTE format('REVOKE ALL ON schema_migrations FROM %I', app_role);
    END IF;
  END LOOP;
END;
$$;
