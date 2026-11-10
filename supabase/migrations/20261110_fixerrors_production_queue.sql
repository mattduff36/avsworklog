-- Private queue and append-only audit for the Squires Windows Fixerrors companion.
-- The application login is provisioned separately without a password in source.
BEGIN;

-- Preserve existing roles while preventing PUBLIC access for the new queue login.
DO $$
DECLARE existing_role record;
BEGIN
  IF to_regrole('squires_fixerrors_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Queue role already exists; fresh-isolation precondition failed';
  END IF;
  FOR existing_role IN
    SELECT rolname FROM pg_roles WHERE has_schema_privilege(oid, 'public', 'USAGE')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', existing_role.rolname);
  END LOOP;
END;
$$;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA squires_fixerrors;
CREATE ROLE squires_fixerrors_queue NOLOGIN;
REVOKE ALL ON SCHEMA squires_fixerrors FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA squires_fixerrors TO squires_fixerrors_queue;

CREATE TABLE squires_fixerrors.fixerrors_production_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL CHECK (state->>'version' = '1')
);
INSERT INTO squires_fixerrors.fixerrors_production_state (id, state)
VALUES (1, '{"version":1,"devices":[],"jobs":[]}'::jsonb);

CREATE TABLE squires_fixerrors.fixerrors_production_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at_ms bigint NOT NULL,
  actor uuid NOT NULL,
  event text NOT NULL,
  job_id uuid,
  device_id uuid NOT NULL,
  candidate jsonb NOT NULL
);

CREATE FUNCTION squires_fixerrors.reject_fixerrors_production_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Fixerrors production audit is append-only';
END;
$$;
CREATE TRIGGER fixerrors_production_audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON squires_fixerrors.fixerrors_production_audit
FOR EACH STATEMENT EXECUTE FUNCTION squires_fixerrors.reject_fixerrors_production_audit_mutation();

ALTER TABLE squires_fixerrors.fixerrors_production_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE squires_fixerrors.fixerrors_production_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON squires_fixerrors.fixerrors_production_state, squires_fixerrors.fixerrors_production_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE squires_fixerrors.fixerrors_production_audit_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION squires_fixerrors.reject_fixerrors_production_audit_mutation() FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE (state) ON squires_fixerrors.fixerrors_production_state TO squires_fixerrors_queue;
GRANT INSERT ON squires_fixerrors.fixerrors_production_audit TO squires_fixerrors_queue;
GRANT USAGE ON SEQUENCE squires_fixerrors.fixerrors_production_audit_id_seq TO squires_fixerrors_queue;
CREATE POLICY fixerrors_production_read_state ON squires_fixerrors.fixerrors_production_state
  FOR SELECT TO squires_fixerrors_queue USING (id = 1);
CREATE POLICY fixerrors_production_write_state ON squires_fixerrors.fixerrors_production_state
  FOR UPDATE TO squires_fixerrors_queue USING (id = 1) WITH CHECK (id = 1);
CREATE POLICY fixerrors_production_append_audit ON squires_fixerrors.fixerrors_production_audit
  FOR INSERT TO squires_fixerrors_queue WITH CHECK (true);

COMMIT;
