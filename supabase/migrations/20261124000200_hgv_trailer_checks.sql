-- finalise-phase: predeploy
BEGIN;

ALTER TABLE public.hgv_inspections
  ADD COLUMN trailer_kind text,
  ADD COLUMN trailer_hgv_id uuid REFERENCES public.hgvs(id),
  ADD COLUMN hired_trailer_id text,
  ADD COLUMN hired_trailer_company text,
  ADD COLUMN trailer_label text,
  ADD CONSTRAINT hgv_inspection_trailer_identity CHECK (
    CASE
      WHEN trailer_kind IS NULL THEN num_nonnulls(trailer_hgv_id,hired_trailer_id,hired_trailer_company,trailer_label)=0
      WHEN trailer_kind='none' THEN num_nonnulls(trailer_hgv_id,hired_trailer_id,hired_trailer_company)=0 AND trailer_label IS NOT NULL
      WHEN trailer_kind='fleet' THEN trailer_hgv_id IS NOT NULL AND trailer_hgv_id<>hgv_id AND trailer_label IS NOT NULL
        AND num_nonnulls(hired_trailer_id,hired_trailer_company)=0
      WHEN trailer_kind='hired' THEN trailer_hgv_id IS NULL AND num_nonnulls(hired_trailer_id,hired_trailer_company,trailer_label)=3
      ELSE false END);
CREATE INDEX hgv_inspections_trailer_history ON public.hgv_inspections(trailer_hgv_id,inspection_date DESC)
  WHERE trailer_hgv_id IS NOT NULL AND status='submitted';

-- The owner confirmed the historical pairing. Retain only recorded, applicable trailer answers.
-- Match the four descriptions so both the legacy and current numbering are covered.
WITH tractor AS (
  SELECT id FROM public.hgvs WHERE regexp_replace(upper(reg_number),'[^A-Z0-9]','','g')='XT71AVS'
), trailer AS (
  SELECT id,concat_ws(' — ',reg_number,nullif(trim(nickname),'')) AS label
  FROM public.hgvs WHERE regexp_replace(upper(reg_number),'[^A-Z0-9]','','g')='C517773'
)
UPDATE public.hgv_inspections i SET trailer_kind='fleet',trailer_hgv_id=(SELECT id FROM trailer),
  trailer_label=(SELECT label FROM trailer)
WHERE i.hgv_id=(SELECT id FROM tractor) AND EXISTS (SELECT FROM trailer)
  AND i.record_kind='full_check' AND i.status='submitted'
  AND EXISTS (SELECT FROM public.inspection_items it WHERE it.inspection_id=i.id AND it.status IN ('ok','attention','defect')
    AND lower(trim(it.item_description)) IN ('brake hoses','couplings secure','electrical connections','trailer no. plate'));

CREATE TABLE public.hgv_trailer_swaps (
  id uuid PRIMARY KEY,
  -- Like check versions, retain signed evidence after an authorised parent deletion.
  parent_check_id uuid NOT NULL,
  hgv_id uuid NOT NULL REFERENCES public.hgvs(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  signature_data text NOT NULL,
  trailer_kind text NOT NULL,
  trailer_hgv_id uuid REFERENCES public.hgvs(id),
  hired_trailer_id text,
  hired_trailer_company text,
  trailer_label text NOT NULL,
  items jsonb NOT NULL,
  CHECK ((trailer_kind='fleet' AND trailer_hgv_id IS NOT NULL AND trailer_hgv_id<>hgv_id
    AND num_nonnulls(hired_trailer_id,hired_trailer_company)=0) OR
    (trailer_kind='hired' AND trailer_hgv_id IS NULL AND num_nonnulls(hired_trailer_id,hired_trailer_company)=2))
);
CREATE TRIGGER hgv_swaps_immutable BEFORE UPDATE OR DELETE ON public.hgv_trailer_swaps
  FOR EACH ROW EXECUTE FUNCTION private.hgv_history_immutable();
CREATE INDEX hgv_swap_parent_history ON public.hgv_trailer_swaps(parent_check_id,created_at DESC);
CREATE INDEX hgv_swap_trailer_history ON public.hgv_trailer_swaps(trailer_hgv_id,created_at DESC) WHERE trailer_hgv_id IS NOT NULL;
ALTER TABLE public.hgv_trailer_swaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hgv_trailer_swaps FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hgv_trailer_swaps TO authenticated,service_role;
CREATE POLICY hgv_swap_parent_visibility ON public.hgv_trailer_swaps FOR SELECT TO authenticated
  USING (EXISTS (SELECT FROM public.hgv_inspections i WHERE i.id=parent_check_id));

-- Convert a driver's validated selection to the durable snapshot used by both kinds of check.
CREATE FUNCTION private.hgv_trailer_identity(p_hgv uuid,p_selection jsonb)
RETURNS TABLE(kind text,fleet_id uuid,hire_id text,hire_company text,label text)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  kind := p_selection->>'kind';
  IF kind='fleet' THEN
    SELECT h.id,concat_ws(' — ',h.reg_number,nullif(trim(h.nickname),''))
      INTO fleet_id,label FROM public.hgvs h JOIN public.hgv_categories c ON c.id=h.category_id
      WHERE h.id=(p_selection->>'trailerHgvId')::uuid AND h.id<>p_hgv AND h.status='active'
        AND h.retired_at IS NULL AND lower(trim(c.name))='trailer' FOR SHARE OF h,c;
    IF NOT FOUND THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER'; END IF;
  ELSIF kind='hired' THEN
    hire_id := trim(p_selection->>'hiredTrailerId');
    hire_company := trim(p_selection->>'hiredTrailerCompany');
    IF coalesce(length(hire_id),0) NOT BETWEEN 1 AND 100 OR coalesce(length(hire_company),0) NOT BETWEEN 1 AND 150 THEN
      RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER';
    END IF;
    label := hire_id || ' — ' || hire_company || ' (hired)';
  ELSIF kind='none' THEN label := 'No trailer attached';
  ELSIF p_selection IS NOT NULL AND p_selection<>'null'::jsonb THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER';
  END IF;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION private.hgv_trailer_identity(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.hgv_saved_trailer_selection(kind text, fleet uuid, hired text, company text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE kind WHEN 'fleet' THEN jsonb_build_object('kind',kind,'trailerHgvId',fleet)
    WHEN 'hired' THEN jsonb_build_object('kind',kind,'hiredTrailerId',hired,'hiredTrailerCompany',company)
    WHEN 'none' THEN jsonb_build_object('kind',kind) ELSE 'null'::jsonb END;
$$;
REVOKE ALL ON FUNCTION private.hgv_saved_trailer_selection(text,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.stamp_hgv_trailer_selection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE
  selection jsonb;
  trailer record;
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF (TG_OP='INSERT' AND num_nonnulls(NEW.trailer_kind,NEW.trailer_hgv_id,NEW.hired_trailer_id,NEW.hired_trailer_company,NEW.trailer_label)>0)
      OR (TG_OP='UPDATE' AND (NEW.trailer_kind,NEW.trailer_hgv_id,NEW.hired_trailer_id,NEW.hired_trailer_company,NEW.trailer_label)
        IS DISTINCT FROM (OLD.trailer_kind,OLD.trailer_hgv_id,OLD.hired_trailer_id,OLD.hired_trailer_company,OLD.trailer_label)) THEN
      RAISE EXCEPTION 'Use the authorised HGV save service';
    END IF;
    RETURN NEW;
  END IF;
  selection := nullif(current_setting('avs.hgv_trailer_selection',true),'')::jsonb;
  IF selection IS NULL THEN RETURN NEW; END IF;

  -- Preserve the pairing at discovery. Never transfer a photo draft silently across a later change of trailer.
  IF NEW.record_kind='defect_report' THEN
    IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='draft' AND NEW.discovered_at IS DISTINCT FROM OLD.discovered_at) THEN
      SELECT s.trailer_kind,s.trailer_hgv_id,s.hired_trailer_id,s.hired_trailer_company,s.trailer_label INTO trailer
        FROM public.hgv_trailer_swaps s WHERE s.parent_check_id=NEW.parent_check_id
          AND s.created_at<=coalesce(NEW.discovered_at,clock_timestamp()) ORDER BY s.created_at DESC,s.id DESC LIMIT 1;
      IF NOT FOUND THEN
        SELECT i.trailer_kind,i.trailer_hgv_id,i.hired_trailer_id,i.hired_trailer_company,i.trailer_label INTO trailer
          FROM public.hgv_inspections i WHERE i.id=NEW.parent_check_id;
      END IF;
      IF TG_OP='UPDATE' AND (OLD.trailer_kind,OLD.trailer_hgv_id,OLD.hired_trailer_id,OLD.hired_trailer_company)
        IS DISTINCT FROM (trailer.trailer_kind,trailer.trailer_hgv_id,trailer.hired_trailer_id,trailer.hired_trailer_company) THEN
        RAISE EXCEPTION 'HGV_SAVE:REPORT_TRAILER_CHANGED';
      END IF;
      NEW.trailer_kind:=trailer.trailer_kind; NEW.trailer_hgv_id:=trailer.trailer_hgv_id;
      NEW.hired_trailer_id:=trailer.hired_trailer_id; NEW.hired_trailer_company:=trailer.hired_trailer_company;
      NEW.trailer_label:=trailer.trailer_label;
    END IF;
    RETURN NEW;
  END IF;

  IF selection='{"keep":true}'::jsonb OR selection=private.hgv_saved_trailer_selection(
    NEW.trailer_kind,NEW.trailer_hgv_id,NEW.hired_trailer_id,NEW.hired_trailer_company) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status='submitted' THEN RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED'; END IF;
    IF EXISTS(SELECT FROM public.inspection_photos p WHERE p.inspection_id=OLD.id AND p.item_number BETWEEN 23 AND 26) THEN
      RAISE EXCEPTION 'HGV_SAVE:TRAILER_PHOTOS';
    END IF;
  END IF;
  SELECT * INTO trailer FROM private.hgv_trailer_identity(NEW.hgv_id,selection);
  NEW.trailer_kind:=trailer.kind; NEW.trailer_hgv_id:=trailer.fleet_id; NEW.hired_trailer_id:=trailer.hire_id;
  NEW.hired_trailer_company:=trailer.hire_company; NEW.trailer_label:=trailer.label;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.stamp_hgv_trailer_selection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hgv_trailer_selection BEFORE INSERT OR UPDATE ON public.hgv_inspections
  FOR EACH ROW EXECUTE FUNCTION private.stamp_hgv_trailer_selection();


-- Both existing save protocols keep their locking, ownership, audit, and retry behaviour.
-- The trailer snapshot is available before the original transaction creates its workshop evidence and signed version.
CREATE FUNCTION private.save_hgv_with_trailer(p_actor_id uuid,p_actor_can_manage_others boolean,p_subject_user_id uuid,p_hgv_id uuid,
  p_inspection_date date,p_hint_inspection_id uuid,p_status text,p_current_mileage integer,p_inspector_comments text,
  p_signature_data text,p_items jsonb,p_request_id uuid,p_record_kind text,p_parent_check_id uuid,
  p_discovered_at timestamptz,p_correction_reason text,p_expected_revision integer,p_inform_workshop boolean,p_trailer_selection jsonb,p_compat boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE
  saved jsonb;
  inspection public.hgv_inspections%ROWTYPE;
  wheelplan text;
  selection jsonb := coalesce(p_trailer_selection,'null'::jsonb);
BEGIN
  IF p_record_kind='defect_report' AND selection NOT IN ('null'::jsonb,'{"keep":true}'::jsonb) THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER';
  END IF;
  PERFORM set_config('avs.hgv_trailer_selection',selection::text,true);
  IF p_compat THEN
    saved := public.save_hgv_inspection_compat(p_actor_id,p_actor_can_manage_others,p_subject_user_id,p_hgv_id,
  p_inspection_date,p_hint_inspection_id,p_status,p_current_mileage,p_inspector_comments,
  p_signature_data,p_items,p_request_id,p_record_kind,p_parent_check_id,
  p_discovered_at,p_correction_reason,p_expected_revision,p_inform_workshop);
  ELSE
    saved := public.save_hgv_inspection_v2(p_actor_id,p_actor_can_manage_others,p_subject_user_id,p_hgv_id,
  p_inspection_date,p_hint_inspection_id,p_status,p_current_mileage,p_inspector_comments,
  p_signature_data,p_items,p_request_id,p_record_kind,p_parent_check_id,
  p_discovered_at,p_correction_reason,p_expected_revision,p_inform_workshop);
  END IF;
  PERFORM set_config('avs.hgv_trailer_selection','',true);
  SELECT * INTO STRICT inspection FROM public.hgv_inspections WHERE id=(saved->>'id')::uuid;
  IF p_record_kind='full_check' THEN
    IF selection<>'{"keep":true}'::jsonb AND selection<>private.hgv_saved_trailer_selection(
        inspection.trailer_kind,inspection.trailer_hgv_id,inspection.hired_trailer_id,inspection.hired_trailer_company) THEN
      RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED';
    END IF;
    IF p_status='submitted' AND p_correction_reason IS NULL THEN
      SELECT upper(ves_wheelplan) INTO wheelplan FROM public.vehicle_maintenance WHERE hgv_id=p_hgv_id;
      IF inspection.trailer_kind IS NULL AND (coalesce(wheelplan,'') NOT LIKE '%RIGID%'
        OR EXISTS(SELECT FROM jsonb_array_elements(p_items) i WHERE (i->>'item_number')::integer BETWEEN 23 AND 26 AND i->>'status'<>'na')) THEN
        RAISE EXCEPTION 'HGV_SAVE:TRAILER_REQUIRED';
      END IF;
      IF inspection.trailer_kind IN ('fleet','hired') AND (wheelplan LIKE '%RIGID%' OR EXISTS(
          SELECT FROM public.hgvs h JOIN public.hgv_categories c ON c.id=h.category_id WHERE h.id=p_hgv_id AND lower(trim(c.name))='trailer')) THEN
        RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER';
      END IF;
    END IF;
    IF inspection.trailer_kind='none' AND EXISTS(SELECT FROM jsonb_array_elements(p_items) i
      WHERE (i->>'item_number')::integer BETWEEN 23 AND 26 AND i->>'status'<>'na') THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER'; END IF;
  END IF;
  RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION private.save_hgv_with_trailer(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean,jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_hgv_inspection_v2(p_actor_id uuid,p_actor_can_manage_others boolean,p_subject_user_id uuid,p_hgv_id uuid,
  p_inspection_date date,p_hint_inspection_id uuid,p_status text,p_current_mileage integer,p_inspector_comments text,
  p_signature_data text,p_items jsonb,p_request_id uuid,p_record_kind text,p_parent_check_id uuid,
  p_discovered_at timestamptz,p_correction_reason text,p_expected_revision integer,p_inform_workshop boolean,p_trailer_selection jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT private.save_hgv_with_trailer(p_actor_id,p_actor_can_manage_others,p_subject_user_id,p_hgv_id,
  p_inspection_date,p_hint_inspection_id,p_status,p_current_mileage,p_inspector_comments,
  p_signature_data,p_items,p_request_id,p_record_kind,p_parent_check_id,
  p_discovered_at,p_correction_reason,p_expected_revision,p_inform_workshop,p_trailer_selection,false);
$$;
REVOKE ALL ON FUNCTION public.save_hgv_inspection_v2(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hgv_inspection_v2(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean,jsonb) TO service_role;

CREATE FUNCTION public.save_hgv_inspection_compat(p_actor_id uuid,p_actor_can_manage_others boolean,p_subject_user_id uuid,p_hgv_id uuid,
  p_inspection_date date,p_hint_inspection_id uuid,p_status text,p_current_mileage integer,p_inspector_comments text,
  p_signature_data text,p_items jsonb,p_request_id uuid,p_record_kind text,p_parent_check_id uuid,
  p_discovered_at timestamptz,p_correction_reason text,p_expected_revision integer,p_inform_workshop boolean,p_trailer_selection jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT private.save_hgv_with_trailer(p_actor_id,p_actor_can_manage_others,p_subject_user_id,p_hgv_id,
  p_inspection_date,p_hint_inspection_id,p_status,p_current_mileage,p_inspector_comments,
  p_signature_data,p_items,p_request_id,p_record_kind,p_parent_check_id,
  p_discovered_at,p_correction_reason,p_expected_revision,p_inform_workshop,p_trailer_selection,true);
$$;
REVOKE ALL ON FUNCTION public.save_hgv_inspection_compat(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hgv_inspection_compat(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean,jsonb) TO service_role;

CREATE FUNCTION public.append_hgv_trailer_swap(p_actor_id uuid,p_parent_id uuid,p_request_id uuid,
  p_selection jsonb,p_signature text,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  parent public.hgv_inspections%ROWTYPE;
  previous public.hgv_trailer_swaps%ROWTYPE;
  pairing jsonb;
  trailer record;
  labels CONSTANT jsonb := '{"9":"Tyres","10":"Brakes","12":"Lights","13":"Reflectors","14":"Indicators","18":"Markers","19":"Sheets / Ropes / Chains","20":"Security of Load","21":"Side underbar/Rails","23":"Brake Hoses","24":"Couplings Secure","25":"Electrical Connections","26":"Trailer No. Plate"}';
BEGIN
  IF p_actor_id IS NULL OR p_parent_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
  SELECT * INTO parent FROM public.hgv_inspections WHERE id=p_parent_id;
  IF NOT FOUND OR parent.user_id<>p_actor_id THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:' || parent.hgv_id::text,0));
  SELECT * INTO parent FROM public.hgv_inspections WHERE id=p_parent_id FOR UPDATE;
  IF NOT FOUND OR parent.user_id<>p_actor_id THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
  IF parent.status<>'submitted' OR parent.record_kind<>'full_check' THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
  -- Exact retries can recover after midnight or asset retirement without signing a second record.
  SELECT * INTO previous FROM public.hgv_trailer_swaps WHERE id=p_request_id;
  IF FOUND THEN
    IF previous.user_id IS DISTINCT FROM p_actor_id OR previous.parent_check_id IS DISTINCT FROM p_parent_id
      OR previous.items IS DISTINCT FROM p_items OR previous.signature_data IS DISTINCT FROM p_signature
      OR private.hgv_saved_trailer_selection(previous.trailer_kind,previous.trailer_hgv_id,previous.hired_trailer_id,previous.hired_trailer_company)
        IS DISTINCT FROM p_selection THEN RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED'; END IF;
    RETURN previous.id;
  END IF;
  IF parent.inspection_date<>(clock_timestamp() AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'HGV_SAVE:SWAP_EXPIRED';
  END IF;
  IF EXISTS(SELECT FROM public.vehicle_maintenance WHERE hgv_id=parent.hgv_id AND upper(ves_wheelplan) LIKE '%RIGID%')
    OR EXISTS(SELECT FROM public.hgvs h JOIN public.hgv_categories c ON c.id=h.category_id WHERE h.id=parent.hgv_id AND lower(trim(c.name))='trailer')
    OR coalesce(p_selection->>'kind','') NOT IN ('fleet','hired') THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER'; END IF;
  IF p_signature IS NULL OR p_signature NOT LIKE 'data:image/png;base64,_%' OR length(p_signature)>1000000
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_items)<>13 OR (SELECT count(DISTINCT i->>'item_number') FROM jsonb_array_elements(p_items) i)<>13 OR
    EXISTS(SELECT FROM jsonb_array_elements(p_items) i WHERE NOT (labels ? coalesce(i->>'item_number',''))
      OR labels->>(i->>'item_number') IS DISTINCT FROM i->>'item_description'
      OR coalesce(i->>'status','') NOT IN ('ok','attention','na')
      OR (i->>'status'='attention' AND nullif(trim(i->>'comments'),'') IS NULL)) THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM'; END IF;
  SELECT private.hgv_saved_trailer_selection(s.trailer_kind,s.trailer_hgv_id,s.hired_trailer_id,s.hired_trailer_company) INTO pairing
    FROM public.hgv_trailer_swaps s WHERE s.parent_check_id=p_parent_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN pairing:=private.hgv_saved_trailer_selection(parent.trailer_kind,parent.trailer_hgv_id,parent.hired_trailer_id,parent.hired_trailer_company); END IF;
  IF pairing=p_selection THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_TRAILER'; END IF;
  SELECT * INTO trailer FROM private.hgv_trailer_identity(parent.hgv_id,p_selection);
  INSERT INTO public.hgv_trailer_swaps(id,parent_check_id,hgv_id,user_id,signature_data,items,trailer_kind,trailer_hgv_id,
      hired_trailer_id,hired_trailer_company,trailer_label)
    VALUES(p_request_id,p_parent_id,parent.hgv_id,p_actor_id,p_signature,p_items,trailer.kind,trailer.fleet_id,
      trailer.hire_id,trailer.hire_company,trailer.label);
  RETURN p_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.append_hgv_trailer_swap(uuid,uuid,uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_hgv_trailer_swap(uuid,uuid,uuid,jsonb,text,jsonb) TO service_role;

COMMIT;
