-- finalise-phase: predeploy
BEGIN;
-- Only the direct database owner can establish a reset scope. Neither a JWT,
-- caller-controlled GUC nor a same-named temporary relation is authoritative.
CREATE TABLE private.test_fleet_reset_scope (
  transaction_id bigint NOT NULL,
  inspection_id uuid NOT NULL,
  hgv_id uuid NOT NULL REFERENCES public.hgvs(id),
  PRIMARY KEY(transaction_id, inspection_id)
);
ALTER TABLE private.test_fleet_reset_scope ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.test_fleet_reset_scope FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.hgv_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, private, public AS $$
DECLARE v_hgv uuid;
BEGIN
  -- This is SECURITY INVOKER deliberately: service_role must never inherit the
  -- function owner's identity. UPDATE remains forbidden even during a reset.
  IF TG_OP <> 'DELETE' OR current_user IN ('anon','authenticated','service_role')
    OR NOT pg_has_role(current_user, 'pg_database_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'HGV history is append-only';
  END IF;
  SELECT s.hgv_id INTO v_hgv FROM private.test_fleet_reset_scope s
    JOIN public.hgvs h ON h.id=s.hgv_id AND h.reg_number='TE57 HGV'
    WHERE s.transaction_id=txid_current() AND s.inspection_id=OLD.inspection_id;
  IF v_hgv IS NULL THEN RAISE EXCEPTION 'HGV history is append-only'; END IF;
  -- A scope is not enough: every surviving ownership witness must agree.
  -- Versions retain the ownership proof after a parent check was deleted.
  IF EXISTS(SELECT 1 FROM public.hgv_inspections i WHERE i.id=OLD.inspection_id AND i.hgv_id<>v_hgv)
    OR EXISTS(SELECT 1 FROM public.hgv_inspection_versions v WHERE v.inspection_id=OLD.inspection_id
      AND (v.snapshot #>> '{inspection,hgv_id}') IS DISTINCT FROM v_hgv::text)
    OR NOT (EXISTS(SELECT 1 FROM public.hgv_inspection_versions v WHERE v.inspection_id=OLD.inspection_id
      AND v.snapshot #>> '{inspection,hgv_id}'=v_hgv::text)
      OR EXISTS(SELECT 1 FROM public.hgv_inspections i WHERE i.id=OLD.inspection_id AND i.hgv_id=v_hgv)) THEN
    RAISE EXCEPTION 'HGV history is append-only';
  END IF;
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION private.hgv_history_immutable() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
