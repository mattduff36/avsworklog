-- LOCAL ONLY: deliberately excluded from supabase/migrations and finalise discovery.
-- Apply only to the dedicated disposable squires_fixerrors_local database.
BEGIN;
DO $$
BEGIN
  IF pg_catalog.current_database() <> 'squires_fixerrors_local' THEN
    RAISE EXCEPTION 'Local Fixerrors schema requires the dedicated local database';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE TABLE private.fixerrors_local_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL CHECK (state->>'version' = '1')
);
INSERT INTO private.fixerrors_local_state (id, state)
VALUES (1, '{"version":1,"devices":[],"jobs":[]}'::jsonb);
CREATE TABLE private.fixerrors_local_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at_ms bigint NOT NULL,
  actor uuid NOT NULL,
  event text NOT NULL,
  job_id uuid,
  device_id uuid NOT NULL,
  candidate jsonb NOT NULL
);
CREATE FUNCTION private.fixerrors_local_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Fixerrors local audit is append-only';
END $$;
CREATE TRIGGER fixerrors_local_audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON private.fixerrors_local_audit
FOR EACH STATEMENT EXECUTE FUNCTION private.fixerrors_local_audit_append_only();
ALTER TABLE private.fixerrors_local_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.fixerrors_local_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC;
COMMIT;
