-- finalise-phase: predeploy
BEGIN;
-- Signed swaps retain their evidence independently of the parent inspection.
CREATE FUNCTION private.hgv_swap_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'HGV trailer swap history is append-only';
END;
$$;
REVOKE ALL ON FUNCTION private.hgv_swap_immutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER hgv_swaps_immutable BEFORE UPDATE OR DELETE ON public.hgv_trailer_swaps
  FOR EACH ROW EXECUTE FUNCTION private.hgv_swap_immutable();
COMMIT;
