CREATE TABLE oven_pauses (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES production_orders(id),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ended_at timestamptz,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 actor_id text NOT NULL REFERENCES "user"(id),
 resumed_by text REFERENCES "user"(id),
 CHECK((ended_at IS NULL AND resumed_by IS NULL) OR (ended_at>=started_at AND resumed_by IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_oven_pause ON oven_pauses(order_id) WHERE ended_at IS NULL;
CREATE FUNCTION protect_oven_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.ended_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.order_id<>OLD.order_id OR NEW.started_at<>OLD.started_at OR NEW.reason<>OLD.reason OR NEW.actor_id<>OLD.actor_id THEN RAISE EXCEPTION 'pause history is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pause_history BEFORE UPDATE ON oven_pauses FOR EACH ROW EXECUTE FUNCTION protect_oven_pause();
CREATE TRIGGER pause_no_delete BEFORE DELETE OR TRUNCATE ON oven_pauses FOR EACH STATEMENT EXECUTE FUNCTION reject_material_mutation();
