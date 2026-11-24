-- finalise-phase: predeploy
BEGIN;

-- Snapshots preserve the original pairing after reassignment or asset renaming.
-- hgv_id remains the task's single effective fleet asset.
ALTER TABLE public.actions ADD COLUMN hgv_pair jsonb, ADD COLUMN hgv_repair_side text;
ALTER TABLE public.actions ADD CONSTRAINT actions_hgv_repair_side CHECK (
  (hgv_pair IS NULL AND hgv_repair_side IS NULL)
  OR (hgv_pair IS NOT NULL AND hgv_repair_side IS NOT NULL
    AND hgv_repair_side IN ('pair','tractor','trailer') AND action_type='inspection_defect'
    AND hgv_id IS NOT NULL AND hgv_pair->>'tractor_id' IS NOT NULL
    AND hgv_id = CASE WHEN hgv_repair_side='trailer' AND hgv_pair->>'trailer_id' IS NOT NULL
      THEN (hgv_pair->>'trailer_id')::uuid ELSE (hgv_pair->>'tractor_id')::uuid END)
);

CREATE FUNCTION private.is_artic_defect(p_description text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT lower(trim(p_description)) IN ('brake hoses','couplings secure','electrical connections','trailer no. plate')
$$;

CREATE FUNCTION private.hgv_workshop_pair(p_tractor uuid, p_trailer uuid, p_label text, p_hire_id text, p_company text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('tractor_id',h.id,'tractor_label',h.reg_number,
    'trailer_id',p_trailer,'trailer_label',p_label,'hired_id',p_hire_id,'hired_company',p_company))
  FROM public.hgvs h WHERE h.id=p_tractor
$$;

CREATE FUNCTION private.hgv_defect_applies(
  a public.actions, p_tractor uuid, p_trailer uuid, p_hire_id text, p_company text, p_item text, p_swap boolean
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN a.hgv_pair IS NULL OR a.hgv_repair_side='tractor' THEN
    a.hgv_id=p_tractor AND (NOT p_swap OR private.is_artic_defect(p_item))
  ELSE
    (p_swap OR private.is_artic_defect(p_item))
    AND (a.hgv_repair_side='trailer' OR a.hgv_pair->>'tractor_id'=p_tractor::text)
    AND CASE WHEN p_trailer IS NOT NULL THEN a.hgv_pair->>'trailer_id'=p_trailer::text
      ELSE a.hgv_pair->>'trailer_id' IS NULL AND a.hgv_pair->>'tractor_id'=p_tractor::text
        AND NULLIF(upper(trim(p_hire_id)), '')=upper(trim(a.hgv_pair->>'hired_id'))
        AND COALESCE(upper(trim(p_company)), '')=COALESCE(upper(trim(a.hgv_pair->>'hired_company')), '') END
  END
$$;

-- Populate a new task from the saved check. Compatibility callbacks and the
-- normal signed-save transaction take the same path. Swaps supply their own snapshot.
CREATE FUNCTION private.capture_hgv_workshop_pair() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND (NEW.hgv_pair IS NOT NULL OR NEW.hgv_repair_side IS NOT NULL)
    AND (TG_OP='INSERT' OR (NEW.hgv_pair,NEW.hgv_repair_side) IS DISTINCT FROM (OLD.hgv_pair,OLD.hgv_repair_side)) THEN
    RAISE EXCEPTION 'Use the workshop repair assignment service';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.hgv_pair IS NOT NULL AND NEW.hgv_pair IS DISTINCT FROM OLD.hgv_pair THEN
      RAISE EXCEPTION 'The original HGV pairing is immutable';
    END IF;
  ELSIF current_user NOT IN ('authenticated','anon') AND NEW.hgv_id IS NOT NULL AND NEW.action_type='inspection_defect' AND NEW.hgv_pair IS NULL AND NEW.inspection_item_id IS NOT NULL THEN
    SELECT private.hgv_workshop_pair(h.hgv_id,h.trailer_hgv_id,h.trailer_label,h.hired_trailer_id,h.hired_trailer_company)
    INTO NEW.hgv_pair FROM public.hgv_inspections h JOIN public.inspection_items i ON i.inspection_id=h.id
    WHERE h.id=NEW.inspection_id AND i.id=NEW.inspection_item_id AND h.trailer_kind IN ('fleet','hired')
      AND private.is_artic_defect(i.item_description);
    IF NEW.hgv_pair IS NOT NULL THEN NEW.hgv_repair_side:='pair'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER aa_capture_hgv_workshop_pair BEFORE INSERT OR UPDATE OF hgv_pair,hgv_repair_side ON public.actions
FOR EACH ROW EXECUTE FUNCTION private.capture_hgv_workshop_pair();

-- Only witnessed tasks from historical trailer sections acquire source metadata.
UPDATE public.actions a SET hgv_repair_side='pair',
  hgv_pair=private.hgv_workshop_pair(h.hgv_id,h.trailer_hgv_id,h.trailer_label,NULL,NULL)
FROM public.hgv_inspections h JOIN public.inspection_items i ON i.inspection_id=h.id
WHERE a.inspection_id=h.id AND a.hgv_id=h.hgv_id
  AND (a.inspection_item_id=i.id OR (a.inspection_item_id IS NULL AND
    trim(substring(a.description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)'))=i.item_description))
  AND a.action_type='inspection_defect' AND h.trailer_kind='fleet' AND private.is_artic_defect(i.item_description);

-- Retain the released functions' ownership checks, idempotency and version writes.
-- Replace exactly one asset match and lock the fleet trailer across different tractors.
DO $migration$
DECLARE
  fn regprocedure; definition text;
  original text := 'WHERE a.hgv_id=p_hgv_id AND a.action_type=';
  replacement text := 'WHERE a.hgv_id IN (p_hgv_id,v_row.trailer_hgv_id) AND private.hgv_defect_applies(a,p_hgv_id,v_row.trailer_hgv_id,v_row.hired_trailer_id,v_row.hired_trailer_company,v_item.item_description,false) AND a.action_type=';
  loop_start text := 'FOR v_item IN SELECT * FROM public.inspection_items WHERE inspection_id=v_row.id';
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.save_hgv_inspection_v2(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean)'::regprocedure,
    'public.sync_hgv_defects_compat(uuid,boolean,uuid,uuid)'::regprocedure
  ] LOOP
    definition:=pg_get_functiondef(fn);
    IF (length(definition)-length(replace(definition,original,'')))<>length(original)
      OR (length(definition)-length(replace(definition,loop_start,'')))<>length(loop_start) THEN
      RAISE EXCEPTION 'Unexpected HGV defect reconciliation definition for %',fn;
    END IF;
    definition:=replace(definition,original,replacement);
    EXECUTE replace(definition,loop_start,
      'IF v_row.trailer_hgv_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(''hgv-trailer:''||v_row.trailer_hgv_id::text,0)); END IF; '||loop_start);
  END LOOP;
END; $migration$;

CREATE FUNCTION private.sync_hgv_trailer_swap_defects() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  entry jsonb; item_name text; item_no integer; note text; task_id uuid; category_id uuid;
  pairing jsonb:=private.hgv_workshop_pair(NEW.hgv_id,NEW.trailer_hgv_id,NEW.trailer_label,NEW.hired_trailer_id,NEW.hired_trailer_company);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hgv-check:'||NEW.hgv_id::text,0));
  IF NEW.trailer_hgv_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hgv-trailer:'||NEW.trailer_hgv_id::text,0));
  END IF;
  SELECT id INTO category_id FROM public.workshop_task_categories WHERE name='Repair' AND applies_to='hgv' AND is_active LIMIT 1;
  FOR entry IN SELECT value FROM jsonb_array_elements(NEW.items) WHERE value->>'status'='attention' ORDER BY (value->>'item_number')::int LOOP
    item_no:=(entry->>'item_number')::int; item_name:=entry->>'item_description'; note:=entry->>'comments';
    SELECT a.id INTO task_id FROM public.actions a WHERE a.hgv_id IN (NEW.hgv_id,NEW.trailer_hgv_id)
      AND a.action_type='inspection_defect' AND a.status IN ('pending','logged','on_hold','in_progress')
      AND private.hgv_defect_applies(a,NEW.hgv_id,NEW.trailer_hgv_id,NEW.hired_trailer_id,NEW.hired_trailer_company,item_name,true)
      AND lower(trim(substring(a.description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)')))=lower(trim(item_name))
      ORDER BY a.created_at,a.id LIMIT 1 FOR UPDATE;
    IF task_id IS NULL THEN
      INSERT INTO public.actions(action_type,hgv_id,title,description,status,created_by,inspection_id,
        workshop_category_id,daily_check_source_id,daily_check_source_type,hgv_pair,hgv_repair_side)
      VALUES('inspection_defect',NEW.hgv_id,(pairing->>'tractor_label')||' - '||item_name,
        'Trailer change defect:'||E'\nItem '||item_no||' - '||item_name||E'\nComment: '||note,'pending',NEW.user_id,
        NEW.parent_check_id,category_id,NEW.parent_check_id,'hgv',pairing,'pair') RETURNING id INTO task_id;
    END IF;
    INSERT INTO public.workshop_task_comments(task_id,author_id,body)
    VALUES(task_id,NEW.user_id,'Trailer change '||NEW.id||' ('||NEW.trailer_label||')'||E'\nItem '||item_no||' - '||item_name||E'\n'||note);
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER sync_hgv_trailer_swap_defects AFTER INSERT ON public.hgv_trailer_swaps
FOR EACH ROW EXECUTE FUNCTION private.sync_hgv_trailer_swap_defects();

CREATE FUNCTION public.assign_hgv_trailer_repair(p_task_id uuid,p_actor_id uuid,p_side text,p_expected_side text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.actions%ROWTYPE; target_id uuid; target_label text;
BEGIN
  IF p_side IS NULL OR p_side NOT IN ('tractor','trailer') OR p_actor_id IS NULL THEN RAISE EXCEPTION 'Invalid repair assignment'; END IF;
  SELECT * INTO a FROM public.actions WHERE id=p_task_id AND hgv_pair IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('pending','logged','in_progress','on_hold') THEN RAISE EXCEPTION 'Task is unavailable'; END IF;
  IF a.hgv_repair_side=p_side THEN RETURN; END IF;
  IF a.hgv_repair_side IS DISTINCT FROM p_expected_side THEN RAISE EXCEPTION 'Assignment changed'; END IF;
  target_id:=COALESCE((a.hgv_pair->>(p_side||'_id'))::uuid,(a.hgv_pair->>'tractor_id')::uuid);
  target_label:=a.hgv_pair->>(p_side||'_label');
  UPDATE public.actions SET hgv_repair_side=p_side,hgv_id=target_id,
    title=target_label||' - '||trim(substring(description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)'))
  WHERE id=a.id;
  INSERT INTO public.workshop_task_comments(task_id,author_id,body)
    VALUES(a.id,p_actor_id,'Repair assigned to '||p_side||' '||target_label||'.');
END; $$;
REVOKE ALL ON FUNCTION public.assign_hgv_trailer_repair(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_hgv_trailer_repair(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.hgv_check_workshop_defects(
  p_tractor uuid,p_trailer uuid,p_hire_id text,p_company text,p_swap boolean,p_completed boolean,p_days integer
) RETURNS TABLE(id uuid,status text,description text,inspection_item_id uuid,actioned_at timestamptz,updated_at timestamptz,trailer_warning boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT a.id,a.status::text,a.description,a.inspection_item_id,a.actioned_at,a.updated_at,
    NOT COALESCE(scope.checklist_lock,false) AS trailer_warning
  FROM public.actions a
  CROSS JOIN LATERAL (SELECT trim(substring(a.description FROM 'Item[[:space:]]+[0-9]+[[:space:]]*-[[:space:]]*([^\n(]+)')) AS name) item
  CROSS JOIN LATERAL (SELECT private.hgv_defect_applies(a,p_tractor,p_trailer,p_hire_id,p_company,item.name,p_swap) AS checklist_lock) scope
  WHERE a.action_type='inspection_defect' AND a.hgv_id IN (p_tractor,p_trailer)
    AND CASE WHEN p_completed THEN a.status='completed' AND COALESCE(a.actioned_at,a.updated_at)>=now()-make_interval(days=>least(greatest(1,p_days),30))
      ELSE a.status IN ('pending','logged','on_hold','in_progress') END
    -- The tractor checklist and trailer walkaround both contain tyres, brakes and lights.
    -- An open trailer-only task must be visible without supplying an answer for the tractor.
    AND (scope.checklist_lock OR (NOT p_swap AND NOT p_completed AND a.hgv_pair IS NOT NULL AND
      private.hgv_defect_applies(a,p_tractor,p_trailer,p_hire_id,p_company,item.name,true)))
  ORDER BY a.created_at,a.id
$$;
REVOKE ALL ON FUNCTION public.hgv_check_workshop_defects(uuid,uuid,text,text,boolean,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hgv_check_workshop_defects(uuid,uuid,text,text,boolean,boolean,integer) TO service_role;

REVOKE ALL ON FUNCTION private.is_artic_defect(text),private.hgv_workshop_pair(uuid,uuid,text,text,text),
  private.hgv_defect_applies(public.actions,uuid,uuid,text,text,text,boolean),
  private.capture_hgv_workshop_pair(),private.sync_hgv_trailer_swap_defects() FROM PUBLIC,anon,authenticated;
COMMIT;
