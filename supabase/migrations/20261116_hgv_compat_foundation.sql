-- finalise-phase: predeploy
BEGIN;
ALTER TABLE public.hgv_inspections
  ADD COLUMN record_kind text NOT NULL DEFAULT 'full_check' CHECK (record_kind IN ('full_check','defect_report')),
  ADD COLUMN parent_check_id uuid,
  ADD COLUMN discovered_at timestamptz,
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT hgv_defect_report_no_meter CHECK (record_kind <> 'defect_report' OR current_mileage IS NULL);
-- Retain daily uniqueness until the compatibility app is verified in production.
CREATE INDEX hgv_inspections_parent ON public.hgv_inspections(parent_check_id);

-- No parent FK: evidence survives authorised deletion of the original check.
CREATE TABLE public.hgv_inspection_versions (
  inspection_id uuid NOT NULL, revision integer NOT NULL, request_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL, snapshot jsonb NOT NULL,
  PRIMARY KEY(inspection_id, revision)
);
CREATE TABLE public.hgv_defect_observations (
  inspection_id uuid NOT NULL, revision integer NOT NULL, item_number integer NOT NULL,
  task_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  comment text, workshop_comment_id uuid UNIQUE, PRIMARY KEY(inspection_id,revision,item_number)
);
ALTER TABLE public.hgv_inspection_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hgv_defect_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hgv_inspection_versions, public.hgv_defect_observations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.hgv_inspection_versions, public.hgv_defect_observations TO service_role;

CREATE FUNCTION private.hgv_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'HGV history is append-only'; END; $$;
CREATE TRIGGER hgv_versions_immutable BEFORE UPDATE OR DELETE ON public.hgv_inspection_versions
FOR EACH ROW EXECUTE FUNCTION private.hgv_history_immutable();
CREATE TRIGGER hgv_observations_immutable BEFORE UPDATE OR DELETE ON public.hgv_defect_observations
FOR EACH ROW EXECUTE FUNCTION private.hgv_history_immutable();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT ON public.hgv_inspection_versions
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
REVOKE ALL ON FUNCTION private.hgv_history_immutable() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.guard_hgv_submitted_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF TG_TABLE_NAME='hgv_inspections' THEN
      IF TG_OP='INSERT' THEN
        IF NEW.record_kind<>'full_check' OR NEW.parent_check_id IS NOT NULL OR NEW.revision<>0 OR NEW.status='submitted' THEN
          RAISE EXCEPTION 'Use the authorised HGV save service';
        END IF;
      ELSIF OLD.status='submitted' OR NEW.status='submitted' OR NEW.record_kind IS DISTINCT FROM OLD.record_kind
        OR NEW.parent_check_id IS DISTINCT FROM OLD.parent_check_id OR NEW.revision IS DISTINCT FROM OLD.revision THEN
        RAISE EXCEPTION 'Use the authorised HGV save service';
      END IF;
    ELSE
      IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM public.hgv_inspections WHERE id=OLD.inspection_id AND status='submitted') THEN
        RAISE EXCEPTION 'Submitted HGV answers require an audited correction';
      END IF;
      IF TG_OP IN ('INSERT','UPDATE') AND EXISTS(SELECT 1 FROM public.hgv_inspections WHERE id=NEW.inspection_id AND status='submitted') THEN
        RAISE EXCEPTION 'Submitted HGV answers require an audited correction';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_hgv_submitted_content BEFORE INSERT OR UPDATE ON public.hgv_inspections
FOR EACH ROW EXECUTE FUNCTION private.guard_hgv_submitted_content();
CREATE TRIGGER guard_hgv_submitted_content BEFORE INSERT OR UPDATE OR DELETE ON public.inspection_items
FOR EACH ROW EXECUTE FUNCTION private.guard_hgv_submitted_content();
REVOKE ALL ON FUNCTION private.guard_hgv_submitted_content() FROM PUBLIC,anon,authenticated;

-- Keep submitted photo references durable even for legacy checks and later photo additions.
-- Captions and appending new photos remain allowed; audited service deletion can detach evidence.
CREATE FUNCTION private.guard_hgv_submitted_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND EXISTS(SELECT 1 FROM public.hgv_inspections WHERE id=OLD.inspection_id AND status='submitted') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Submitted HGV photo evidence is retained'; END IF;
    IF NEW.inspection_id IS DISTINCT FROM OLD.inspection_id OR NEW.photo_url IS DISTINCT FROM OLD.photo_url
      OR NEW.item_number IS DISTINCT FROM OLD.item_number OR NEW.day_of_week IS DISTINCT FROM OLD.day_of_week THEN
      RAISE EXCEPTION 'Submitted HGV photo evidence is retained';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_hgv_submitted_photo BEFORE UPDATE OR DELETE ON public.inspection_photos
FOR EACH ROW EXECUTE FUNCTION private.guard_hgv_submitted_photo();
REVOKE ALL ON FUNCTION private.guard_hgv_submitted_photo() FROM PUBLIC,anon,authenticated;

-- Storage DELETE/UPDATE has permissive owner policies; signed evidence needs an additional
-- restrictive policy. The shared barrier serialises snapshot capture with destructive access.
CREATE FUNCTION private.hgv_photo_is_evidence(p_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check-workshop-photos',0));
  RETURN EXISTS(SELECT 1 FROM public.hgv_inspection_versions v,
    LATERAL jsonb_array_elements(COALESCE(v.snapshot->'photos','[]'::jsonb)) p
    WHERE private.daily_check_photo_key(p->>'photo_url')=p_name)
    OR EXISTS(SELECT 1 FROM public.inspection_photos p JOIN public.hgv_inspections h ON h.id=p.inspection_id
      WHERE h.status='submitted' AND private.daily_check_photo_key(p.photo_url)=p_name);
END; $$;
REVOKE ALL ON FUNCTION private.hgv_photo_is_evidence(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.hgv_photo_is_evidence(text) TO authenticated,anon;
CREATE POLICY hgv_evidence_no_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated,anon
USING(bucket_id <> 'inspection-photos' OR NOT private.hgv_photo_is_evidence(name));
CREATE POLICY hgv_evidence_no_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated,anon
USING(bucket_id <> 'inspection-photos' OR NOT private.hgv_photo_is_evidence(name))
WITH CHECK(bucket_id <> 'inspection-photos' OR NOT private.hgv_photo_is_evidence(name));
CREATE FUNCTION private.hgv_snapshot_photo_exists() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check-workshop-photos',0));
  FOR v_key IN SELECT private.daily_check_photo_key(p->>'photo_url')
    FROM jsonb_array_elements(COALESCE(NEW.snapshot->'photos','[]'::jsonb)) p LOOP
    IF v_key IS NOT NULL THEN
      PERFORM 1 FROM storage.objects WHERE bucket_id='inspection-photos' AND name=v_key FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'HGV_SAVE:PHOTO_MISSING'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER hgv_snapshot_photo_exists BEFORE INSERT ON public.hgv_inspection_versions
FOR EACH ROW EXECUTE FUNCTION private.hgv_snapshot_photo_exists();
REVOKE ALL ON FUNCTION private.hgv_snapshot_photo_exists() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.guard_hgv_workshop_observation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.hgv_defect_observations WHERE workshop_comment_id=OLD.id) THEN
    RAISE EXCEPTION 'HGV report observations are retained as submitted';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_hgv_workshop_observation BEFORE UPDATE OR DELETE ON public.workshop_task_comments
FOR EACH ROW EXECUTE FUNCTION private.guard_hgv_workshop_observation();
REVOKE ALL ON FUNCTION private.guard_hgv_workshop_observation() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_hgv_inspection_v2(
  p_actor_id uuid, p_actor_can_manage_others boolean, p_subject_user_id uuid,
  p_hgv_id uuid, p_inspection_date date, p_hint_inspection_id uuid,
  p_status text, p_current_mileage integer, p_inspector_comments text,
  p_signature_data text, p_items jsonb, p_request_id uuid,
  p_record_kind text, p_parent_check_id uuid, p_discovered_at timestamptz,
  p_correction_reason text, p_expected_revision integer, p_inform_workshop boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.hgv_inspections%ROWTYPE;
  v_parent public.hgv_inspections%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() AT TIME ZONE 'Europe/London')::date;
  v_correction boolean := p_correction_reason IS NOT NULL;
  v_item public.inspection_items%ROWTYPE;
  v_task uuid; v_comment uuid; v_category uuid; v_reg text; v_description text;
  v_existing_request uuid; v_result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_request_id IS NULL OR p_subject_user_id IS NULL OR p_hgv_id IS NULL
    OR p_inspection_date IS NULL OR p_status NOT IN ('draft','submitted')
    OR p_record_kind NOT IN ('full_check','defect_report')
    OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
  END IF;
  IF p_subject_user_id <> p_actor_id AND NOT COALESCE(p_actor_can_manage_others,false) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_SUBJECT';
  END IF;
  -- Common lock order: asset then record. Serialises task dedupe across different drivers/checks.
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:' || p_hgv_id::text,0));
  SELECT * INTO v_row FROM public.hgv_inspections WHERE id = COALESCE(p_hint_inspection_id,p_request_id) FOR UPDATE;
  IF FOUND THEN
    IF v_row.user_id <> p_actor_id AND NOT COALESCE(p_actor_can_manage_others,false) THEN
      RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER';
    END IF;
    IF v_row.hgv_id IS DISTINCT FROM p_hgv_id OR v_row.user_id <> p_subject_user_id
      OR v_row.inspection_date <> p_inspection_date OR v_row.record_kind <> p_record_kind
      OR v_row.parent_check_id IS DISTINCT FROM p_parent_check_id THEN
      RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED';
    END IF;
    SELECT inspection_id INTO v_existing_request FROM public.hgv_inspection_versions WHERE request_id=p_request_id;
    IF v_existing_request IS NOT NULL AND v_existing_request <> v_row.id THEN
      RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED';
    END IF;
    IF v_row.status='submitted' THEN
      IF v_correction AND v_existing_request IS NULL THEN
        IF v_row.user_id <> p_actor_id THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
        IF v_row.inspection_date <> v_today OR (v_row.submitted_at AT TIME ZONE 'Europe/London')::date <> v_today THEN
          RAISE EXCEPTION 'HGV_SAVE:CORRECTION_EXPIRED';
        END IF;
        IF p_expected_revision IS DISTINCT FROM v_row.revision THEN RAISE EXCEPTION 'HGV_SAVE:REVISION_CONFLICT'; END IF;
        IF p_current_mileage IS DISTINCT FROM v_row.current_mileage OR p_discovered_at IS DISTINCT FROM v_row.discovered_at OR p_status <> 'submitted'
          OR length(trim(p_correction_reason)) < 5 THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
        IF EXISTS (SELECT item_number,day_of_week FROM public.inspection_items WHERE inspection_id=v_row.id
          EXCEPT SELECT (x->>'item_number')::int,(x->>'day_of_week')::int FROM jsonb_array_elements(p_items) x)
          OR EXISTS (SELECT (x->>'item_number')::int,(x->>'day_of_week')::int FROM jsonb_array_elements(p_items) x
          EXCEPT SELECT item_number,day_of_week FROM public.inspection_items WHERE inspection_id=v_row.id) THEN
          RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
        END IF;
      ELSE
        IF p_status='draft' OR v_existing_request IS NULL THEN
          RAISE EXCEPTION 'HGV_SAVE:SUBMITTED_CONFLICT';
        END IF;
        -- A retry never rewrites submitted evidence or repeats workshop effects.
        RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision,
          'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.inspection_items i WHERE inspection_id=v_row.id),'[]'::jsonb));
      END IF;
    ELSIF v_correction THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
    END IF;
  ELSE
    IF p_hint_inspection_id IS NOT NULL OR v_correction THEN RAISE EXCEPTION 'HGV_SAVE:NOT_FOUND'; END IF;
    IF p_record_kind='defect_report' THEN
      SELECT * INTO v_parent FROM public.hgv_inspections WHERE id=p_parent_check_id FOR KEY SHARE;
      IF NOT FOUND OR v_parent.status<>'submitted' OR v_parent.record_kind<>'full_check'
        OR v_parent.user_id<>p_actor_id OR v_parent.hgv_id<>p_hgv_id OR p_subject_user_id<>p_actor_id THEN
        RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER';
      END IF;
      IF p_inspection_date <> v_today OR p_current_mileage IS NOT NULL THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
    ELSIF p_parent_check_id IS NOT NULL THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
    INSERT INTO public.hgv_inspections(id,hgv_id,user_id,inspection_date,inspection_end_date,current_mileage,status,
      record_kind,parent_check_id,discovered_at,inspector_comments)
    VALUES(p_request_id,p_hgv_id,p_subject_user_id,p_inspection_date,p_inspection_date,p_current_mileage,'draft',
      p_record_kind,p_parent_check_id,p_discovered_at,p_inspector_comments) RETURNING * INTO v_row;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE
      COALESCE(x->>'status','') NOT IN ('ok','attention','na') OR (x->>'item_number')::int NOT BETWEEN 1 AND 26
      OR (x->>'day_of_week')::int IS DISTINCT FROM extract(isodow FROM p_inspection_date)::int)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'item_number' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
  END IF;
  IF p_status='submitted' THEN
    IF COALESCE(p_signature_data,'')='' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
    IF p_record_kind='full_check' AND (p_current_mileage IS NULL OR p_current_mileage<0 OR jsonb_array_length(p_items)<>26) THEN
      RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
    END IF;
    IF p_record_kind='defect_report' AND (p_current_mileage IS NOT NULL OR p_discovered_at IS NULL OR p_discovered_at>v_now
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->>'status'<>'attention')) THEN
      RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->>'status'='attention' AND length(trim(COALESCE(x->>'comments','')))=0) THEN
      RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
    END IF;
  END IF;
  -- Capture legacy originals before their first correction, including their original signature and photos.
  IF v_correction AND NOT EXISTS(SELECT 1 FROM public.hgv_inspection_versions WHERE inspection_id=v_row.id) THEN
    INSERT INTO public.hgv_inspection_versions(inspection_id,revision,request_id,actor_id,reason,snapshot)
    SELECT v_row.id,0,gen_random_uuid(),v_row.user_id,'Original submission (preserved before correction)',
      jsonb_build_object('inspection',to_jsonb(v_row),
        'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY item_number) FROM public.inspection_items i WHERE inspection_id=v_row.id),'[]'::jsonb),
        'photos',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.inspection_photos p WHERE inspection_id=v_row.id),'[]'::jsonb),
        'hgv',(SELECT jsonb_build_object('reg_number',reg_number,'nickname',nickname) FROM public.hgvs WHERE id=p_hgv_id),
        'operator',(SELECT jsonb_build_object('full_name',full_name) FROM public.profiles WHERE id=v_row.user_id));
  END IF;
  UPDATE public.hgv_inspections SET inspector_comments=p_inspector_comments,updated_at=v_now,
    discovered_at=CASE WHEN record_kind='defect_report' THEN p_discovered_at ELSE NULL END
    WHERE id=v_row.id;
  -- Corrections never write KM; the existing causal meter triggers remain authoritative.
  IF NOT v_correction AND p_record_kind='full_check' THEN
    UPDATE public.hgv_inspections SET current_mileage=p_current_mileage WHERE id=v_row.id;
  END IF;
  WITH incoming AS (
    SELECT
      (elem->>'item_number')::int AS item_number,
      NULLIF(elem->>'item_description', '') AS item_description,
      (elem->>'day_of_week')::int AS day_of_week,
      elem->>'status' AS status,
      NULLIF(elem->>'comments', '') AS comments
    FROM jsonb_array_elements(p_items) AS elem
  )
  UPDATE public.inspection_items AS ii
  SET
    item_description = incoming.item_description,
    status = incoming.status,
    comments = incoming.comments
  FROM incoming
  WHERE ii.inspection_id = v_row.id
    AND ii.item_number = incoming.item_number
    AND ii.day_of_week = incoming.day_of_week;

  INSERT INTO public.inspection_items (
    inspection_id,
    item_number,
    item_description,
    day_of_week,
    status,
    comments
  )
  SELECT
    v_row.id,
    incoming.item_number,
    incoming.item_description,
    incoming.day_of_week,
    incoming.status,
    incoming.comments
  FROM (
    SELECT
      (elem->>'item_number')::int AS item_number,
      NULLIF(elem->>'item_description', '') AS item_description,
      (elem->>'day_of_week')::int AS day_of_week,
      elem->>'status' AS status,
      NULLIF(elem->>'comments', '') AS comments
    FROM jsonb_array_elements(p_items) AS elem
  ) AS incoming
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.inspection_items AS ii
    WHERE ii.inspection_id = v_row.id
      AND ii.item_number = incoming.item_number
      AND ii.day_of_week = incoming.day_of_week
  );

  DELETE FROM public.inspection_items AS ii
  WHERE ii.inspection_id = v_row.id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS elem
      WHERE (elem->>'item_number')::int = ii.item_number
        AND (elem->>'day_of_week')::int = ii.day_of_week
    );

  UPDATE public.actions AS a
  SET inspection_item_id = mapped.keeper_id
  FROM (
    SELECT
      extras.id AS extra_id,
      keepers.keeper_id
    FROM (
      SELECT
        id,
        item_number,
        day_of_week,
        ROW_NUMBER() OVER (
          PARTITION BY item_number, day_of_week
          ORDER BY id
        ) AS rn
      FROM public.inspection_items
      WHERE inspection_id = v_row.id
    ) AS extras
    INNER JOIN (
      SELECT
        id AS keeper_id,
        item_number,
        day_of_week
      FROM (
        SELECT
          id,
          item_number,
          day_of_week,
          ROW_NUMBER() OVER (
            PARTITION BY item_number, day_of_week
            ORDER BY id
          ) AS rn
        FROM public.inspection_items
        WHERE inspection_id = v_row.id
      ) AS keeper_ranked
      WHERE keeper_ranked.rn = 1
    ) AS keepers
      ON keepers.item_number = extras.item_number
     AND keepers.day_of_week = extras.day_of_week
    WHERE extras.rn > 1
  ) AS mapped
  WHERE a.inspection_item_id = mapped.extra_id;

  DELETE FROM public.inspection_items AS ii
  WHERE ii.id IN (
    SELECT ranked.id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY item_number, day_of_week
          ORDER BY id
        ) AS rn
      FROM public.inspection_items
      WHERE inspection_id = v_row.id
    ) AS ranked
    WHERE ranked.rn > 1
  );


  IF p_status='submitted' THEN
    UPDATE public.hgv_inspections SET status='submitted',submitted_at=COALESCE(submitted_at,v_now),
      signature_data=p_signature_data,signed_at=v_now,revision=revision+CASE WHEN v_correction THEN 1 ELSE 0 END,
      updated_at=v_now WHERE id=v_row.id RETURNING * INTO v_row;
    IF NOT v_correction AND p_record_kind='full_check' THEN
      UPDATE public.hgvs SET current_mileage=p_current_mileage,daily_check_source_id=v_row.id,daily_check_source_type='hgv'
      WHERE id=p_hgv_id;
    END IF;
    SELECT reg_number INTO v_reg FROM public.hgvs WHERE id=p_hgv_id;
    SELECT id INTO v_category FROM public.workshop_task_categories WHERE name='Repair' AND applies_to='hgv' AND is_active LIMIT 1;
    FOR v_item IN SELECT * FROM public.inspection_items WHERE inspection_id=v_row.id AND status='attention' ORDER BY item_number LOOP
      v_task := NULL;
      SELECT a.id INTO v_task FROM public.actions a WHERE a.hgv_id=p_hgv_id AND a.action_type='inspection_defect'
        AND a.status IN ('pending','logged','on_hold','in_progress')
        AND lower(regexp_replace(trim(COALESCE(substring(a.description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)'),'')),'[[:space:]]+',' ','g'))
          = lower(regexp_replace(trim(v_item.item_description),'[[:space:]]+',' ','g'))
        ORDER BY a.created_at,a.id LIMIT 1 FOR UPDATE;
      IF v_task IS NULL THEN
        v_description := 'HGV inspection defect found:' || E'\nItem ' || v_item.item_number || ' - ' || v_item.item_description
          || ' (' || (ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[v_item.day_of_week] || ')'
          || E'\nComment: ' || v_item.comments;
        INSERT INTO public.actions(action_type,hgv_id,title,description,status,created_by,inspection_id,inspection_item_id,
          workshop_category_id,daily_check_source_id,daily_check_source_type)
        VALUES('inspection_defect',p_hgv_id,v_reg || ' - ' || v_item.item_description,v_description,'pending',p_actor_id,
          v_row.id,v_item.id,v_category,v_row.id,'hgv') RETURNING id INTO v_task;
      END IF;
      INSERT INTO public.workshop_task_comments(task_id,author_id,body)
      VALUES(v_task,p_actor_id,CASE WHEN p_record_kind='defect_report' THEN 'Additional HGV defect report ' ELSE 'HGV daily check ' END
        || v_row.id || ' (revision ' || v_row.revision || ')' || E'\nItem ' || v_item.item_number || ' - ' || v_item.item_description
        || E'\n' || v_item.comments || CASE WHEN p_discovered_at IS NOT NULL THEN E'\nDiscovered: ' || p_discovered_at::text ELSE '' END)
      RETURNING id INTO v_comment;
      INSERT INTO public.hgv_defect_observations(inspection_id,revision,item_number,task_id,comment,workshop_comment_id)
      VALUES(v_row.id,v_row.revision,v_item.item_number,v_task,v_item.comments,v_comment);
    END LOOP;
    IF p_inform_workshop THEN
      IF length(trim(COALESCE(p_inspector_comments,'')))<5 THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
      INSERT INTO public.actions(action_type,hgv_id,title,description,status,created_by,inspection_id,workshop_category_id,
        daily_check_source_id,daily_check_source_type)
      VALUES('workshop_vehicle_task',p_hgv_id,'HGV ' || v_reg || ': Inspector Comments',p_inspector_comments,
        'pending',p_actor_id,v_row.id,v_category,v_row.id,'hgv') RETURNING id INTO v_task;
      INSERT INTO public.hgv_defect_observations(inspection_id,revision,item_number,task_id,comment)
      VALUES(v_row.id,v_row.revision,0,v_task,p_inspector_comments);
    END IF;
    INSERT INTO public.hgv_inspection_versions(inspection_id,revision,request_id,actor_id,reason,snapshot)
    SELECT v_row.id,v_row.revision,p_request_id,p_actor_id,COALESCE(p_correction_reason,'Original submission'),
      jsonb_build_object('inspection',to_jsonb(v_row),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY item_number)
        FROM public.inspection_items i WHERE inspection_id=v_row.id),'[]'::jsonb),
        'photos',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.inspection_photos p WHERE inspection_id=v_row.id),'[]'::jsonb),
        'hgv',(SELECT jsonb_build_object('reg_number',reg_number,'nickname',nickname) FROM public.hgvs WHERE id=p_hgv_id),
        'operator',(SELECT jsonb_build_object('full_name',full_name) FROM public.profiles WHERE id=v_row.user_id));
  END IF;
  RETURN jsonb_build_object('id',v_row.id,'status',p_status,'revision',v_row.revision,
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.inspection_items i WHERE inspection_id=v_row.id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.save_hgv_inspection_v2(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hgv_inspection_v2(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean) TO service_role;
-- Close historical unsafe direct grants, retaining the old server during the deployment transition.
REVOKE ALL ON FUNCTION public.save_hgv_inspection(uuid,boolean,uuid,uuid,date,uuid,uuid,text,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hgv_inspection(uuid,boolean,uuid,uuid,date,uuid,uuid,text,integer,text,text,jsonb) TO service_role;
-- Production's compatibility API retains one-check-per-day semantics even after
-- preview activation removes the index. Never select an arbitrary same-day row.
CREATE FUNCTION public.save_hgv_inspection_compat(
  p_actor_id uuid, p_actor_can_manage_others boolean, p_subject_user_id uuid,
  p_hgv_id uuid, p_inspection_date date, p_hint_inspection_id uuid,
  p_status text, p_current_mileage integer, p_inspector_comments text,
  p_signature_data text, p_items jsonb, p_request_id uuid,
  p_record_kind text, p_parent_check_id uuid, p_discovered_at timestamptz,
  p_correction_reason text, p_expected_revision integer, p_inform_workshop boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.hgv_inspections%ROWTYPE;
  v_ids uuid[];
  v_hint uuid := p_hint_inspection_id;
  v_request uuid := p_request_id;
  v_items jsonb;
  v_incoming jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_subject_user_id IS NULL OR p_hgv_id IS NULL OR p_request_id IS NULL
    OR p_inspection_date IS NULL OR p_record_kind IS DISTINCT FROM 'full_check'
    OR p_parent_check_id IS NOT NULL OR p_correction_reason IS NOT NULL OR p_discovered_at IS NOT NULL THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
  END IF;
  IF p_subject_user_id <> p_actor_id AND NOT COALESCE(p_actor_can_manage_others,false) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_SUBJECT';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:' || p_hgv_id::text,0));
  SELECT * INTO v_row FROM public.hgv_inspections WHERE id=COALESCE(v_hint,v_request) FOR UPDATE;
  IF NOT FOUND THEN
    IF v_hint IS NOT NULL THEN RAISE EXCEPTION 'HGV_SAVE:NOT_FOUND'; END IF;
    SELECT array_agg(id) INTO v_ids FROM public.hgv_inspections
      WHERE hgv_id=p_hgv_id AND user_id=p_subject_user_id AND inspection_date=p_inspection_date AND record_kind='full_check';
    IF cardinality(v_ids)>1 THEN RAISE EXCEPTION 'HGV_SAVE:COMPAT_REFRESH_REQUIRED'; END IF;
    IF cardinality(v_ids)=1 THEN
      SELECT * INTO v_row FROM public.hgv_inspections WHERE id=v_ids[1] FOR UPDATE;
    END IF;
  END IF;
  IF v_row.id IS NOT NULL THEN
    IF v_row.user_id <> p_actor_id AND NOT COALESCE(p_actor_can_manage_others,false) THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
    IF v_row.hgv_id IS DISTINCT FROM p_hgv_id OR v_row.user_id <> p_subject_user_id
      OR v_row.inspection_date <> p_inspection_date OR v_row.record_kind <> 'full_check' THEN
      RAISE EXCEPTION 'HGV_SAVE:IDENTITY_CHANGED';
    END IF;
    v_hint := v_row.id;
    v_request := v_row.id;
    IF v_row.status='submitted' THEN
      -- Only an exact, uncorrected retry can acknowledge a completed legacy save.
      -- A stale form must never silently claim that changed answers were saved.
      SELECT jsonb_agg(jsonb_build_object('item_number',item_number,'item_description',item_description,
        'day_of_week',day_of_week,'status',status,'comments',NULLIF(comments,'')) ORDER BY item_number)
        INTO v_items FROM public.inspection_items WHERE inspection_id=v_row.id;
      SELECT jsonb_agg(jsonb_build_object('item_number',(x->>'item_number')::int,'item_description',x->>'item_description',
        'day_of_week',(x->>'day_of_week')::int,'status',x->>'status','comments',NULLIF(x->>'comments','')) ORDER BY (x->>'item_number')::int)
        INTO v_incoming FROM jsonb_array_elements(p_items) x;
      IF p_status <> 'submitted' OR v_row.revision <> 0 OR p_current_mileage IS DISTINCT FROM v_row.current_mileage
        OR NULLIF(p_inspector_comments,'') IS DISTINCT FROM NULLIF(v_row.inspector_comments,'')
        OR p_signature_data IS DISTINCT FROM v_row.signature_data OR v_items IS DISTINCT FROM v_incoming THEN
        RAISE EXCEPTION 'HGV_SAVE:COMPAT_CHECK_EXISTS';
      END IF;
      RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'revision',v_row.revision,
        'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.inspection_items i WHERE inspection_id=v_row.id),'[]'::jsonb));
    END IF;
  END IF;
  RETURN public.save_hgv_inspection_v2(p_actor_id,p_actor_can_manage_others,p_subject_user_id,p_hgv_id,
    p_inspection_date,v_hint,p_status,p_current_mileage,p_inspector_comments,p_signature_data,p_items,v_request,
    'full_check',NULL,NULL,NULL,NULL,p_inform_workshop);
END; $$;
REVOKE ALL ON FUNCTION public.save_hgv_inspection_compat(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hgv_inspection_compat(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean) TO service_role;
-- Cached clients report optional inspector notes in a second request. Keep this
-- safe/idempotent, and refuse stale notes after a preview correction.
CREATE FUNCTION public.inform_hgv_workshop_compat(p_actor_id uuid,p_can_manage boolean,p_inspection_id uuid,p_hgv_id uuid,p_comments text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.hgv_inspections%ROWTYPE; v_task uuid; v_category uuid; v_reg text;
BEGIN
  IF p_actor_id IS NULL OR p_hgv_id IS NULL THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:'||p_hgv_id::text,0));
  SELECT * INTO v_row FROM public.hgv_inspections WHERE id=p_inspection_id FOR UPDATE;
  IF NOT FOUND OR v_row.hgv_id IS DISTINCT FROM p_hgv_id OR (v_row.user_id<>p_actor_id AND NOT COALESCE(p_can_manage,false)) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER';
  END IF;
  IF v_row.status<>'submitted' OR v_row.record_kind<>'full_check' OR v_row.revision<>0
    OR length(trim(COALESCE(p_comments,'')))<5 OR trim(p_comments) IS DISTINCT FROM trim(v_row.inspector_comments) THEN
    RAISE EXCEPTION 'HGV_SAVE:COMPAT_REFRESH_REQUIRED';
  END IF;
  SELECT id INTO v_task FROM public.actions WHERE inspection_id=v_row.id AND action_type='workshop_vehicle_task' ORDER BY created_at,id LIMIT 1;
  IF v_task IS NOT NULL THEN RETURN v_task; END IF;
  SELECT reg_number INTO v_reg FROM public.hgvs WHERE id=p_hgv_id;
  SELECT id INTO v_category FROM public.workshop_task_categories WHERE name IN ('Repair','Other') AND applies_to='hgv' AND is_active ORDER BY name LIMIT 1;
  INSERT INTO public.actions(action_type,hgv_id,title,description,status,created_by,inspection_id,workshop_category_id,daily_check_source_id,daily_check_source_type)
    VALUES('workshop_vehicle_task',p_hgv_id,'HGV '||v_reg||': Inspector Comments',trim(p_comments),'pending',p_actor_id,v_row.id,v_category,v_row.id,'hgv') RETURNING id INTO v_task;
  INSERT INTO public.hgv_defect_observations(inspection_id,revision,item_number,task_id,comment)
    VALUES(v_row.id,0,0,v_task,trim(p_comments));
  RETURN v_task;
END; $$;
REVOKE ALL ON FUNCTION public.inform_hgv_workshop_compat(uuid,boolean,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inform_hgv_workshop_compat(uuid,boolean,uuid,uuid,text) TO service_role;
-- Cached callbacks may target pre-foundation checks. Never reconcile outside
-- the asset lock: their first correction can create the version concurrently.
CREATE FUNCTION public.sync_hgv_defects_compat(p_actor_id uuid,p_can_manage boolean,p_inspection_id uuid,p_hgv_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.hgv_inspections%ROWTYPE; v_item public.inspection_items%ROWTYPE;
  v_task uuid; v_category uuid; v_reg text; v_created integer:=0; v_skipped integer:=0;
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:'||p_hgv_id::text,0));
  SELECT * INTO v_row FROM public.hgv_inspections WHERE id=p_inspection_id FOR UPDATE;
  IF NOT FOUND OR v_row.hgv_id IS DISTINCT FROM p_hgv_id
    OR (v_row.user_id<>p_actor_id AND NOT COALESCE(p_can_manage,false)) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER';
  END IF;
  IF v_row.status<>'submitted' THEN RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hgv_inspection_versions WHERE inspection_id=v_row.id) THEN
    SELECT reg_number INTO v_reg FROM public.hgvs WHERE id=p_hgv_id;
    SELECT id INTO v_category FROM public.workshop_task_categories WHERE name='Repair' AND applies_to='hgv' AND is_active LIMIT 1;
    FOR v_item IN SELECT * FROM public.inspection_items WHERE inspection_id=v_row.id AND status='attention' ORDER BY item_number LOOP
      -- Replays never reopen completed work or rewrite another check's task.
      IF EXISTS(SELECT 1 FROM public.hgv_defect_observations WHERE inspection_id=v_row.id AND revision=v_row.revision AND item_number=v_item.item_number) THEN
        v_skipped:=v_skipped+1; CONTINUE;
      END IF;
      SELECT a.id INTO v_task FROM public.actions a WHERE a.hgv_id=p_hgv_id AND a.action_type='inspection_defect'
        AND (a.status IN ('pending','logged','on_hold','in_progress') OR a.inspection_id=v_row.id)
        AND lower(regexp_replace(trim(COALESCE(substring(a.description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)'),'')),'[[:space:]]+',' ','g'))
          = lower(regexp_replace(trim(v_item.item_description),'[[:space:]]+',' ','g'))
        ORDER BY a.created_at,a.id LIMIT 1 FOR UPDATE;
      IF v_task IS NULL THEN
        INSERT INTO public.actions(action_type,hgv_id,title,description,status,created_by,inspection_id,inspection_item_id,
          workshop_category_id,daily_check_source_id,daily_check_source_type)
        VALUES('inspection_defect',p_hgv_id,v_reg||' - '||v_item.item_description,
          'HGV inspection defect found:'||E'\nItem '||v_item.item_number||' - '||v_item.item_description||E'\nComment: '||COALESCE(v_item.comments,''),
          'pending',p_actor_id,v_row.id,v_item.id,v_category,v_row.id,'hgv') RETURNING id INTO v_task;
        v_created:=v_created+1;
      ELSE v_skipped:=v_skipped+1;
      END IF;
      INSERT INTO public.hgv_defect_observations(inspection_id,revision,item_number,task_id,comment)
        VALUES(v_row.id,v_row.revision,v_item.item_number,v_task,v_item.comments);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('success',true,'created',v_created,'updated',0,'skipped',v_skipped,'dedupedClosed',0,'duplicates','[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.sync_hgv_defects_compat(uuid,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_hgv_defects_compat(uuid,boolean,uuid,uuid) TO service_role;
COMMIT;
