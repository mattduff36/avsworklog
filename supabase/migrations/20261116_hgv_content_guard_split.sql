-- finalise-phase: predeploy
-- Forward correction: each trigger function references only its table's columns.
BEGIN;
CREATE OR REPLACE FUNCTION private.guard_hgv_submitted_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP='INSERT' THEN
      IF NEW.record_kind<>'full_check' OR NEW.parent_check_id IS NOT NULL OR NEW.revision<>0 OR NEW.status='submitted' THEN
        RAISE EXCEPTION 'Use the authorised HGV save service';
      END IF;
    ELSIF OLD.status='submitted' OR NEW.status='submitted' OR NEW.record_kind IS DISTINCT FROM OLD.record_kind
      OR NEW.parent_check_id IS DISTINCT FROM OLD.parent_check_id OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION 'Use the authorised HGV save service';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION private.guard_hgv_submitted_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM public.hgv_inspections WHERE id=OLD.inspection_id AND status='submitted') THEN
      RAISE EXCEPTION 'Submitted HGV answers require an audited correction';
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') AND EXISTS(SELECT 1 FROM public.hgv_inspections WHERE id=NEW.inspection_id AND status='submitted') THEN
      RAISE EXCEPTION 'Submitted HGV answers require an audited correction';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER guard_hgv_submitted_content ON public.inspection_items;
CREATE TRIGGER guard_hgv_submitted_content BEFORE INSERT OR UPDATE OR DELETE ON public.inspection_items
FOR EACH ROW EXECUTE FUNCTION private.guard_hgv_submitted_items();
REVOKE ALL ON FUNCTION private.guard_hgv_submitted_content() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.guard_hgv_submitted_items() FROM PUBLIC,anon,authenticated;
COMMIT;
