-- finalise-phase: predeploy
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.daily_check_effects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  source_id uuid,
  source_type text CHECK (source_type IN ('van', 'plant', 'hgv')),
  before_row jsonb,
  after_row jsonb NOT NULL,
  input_fields text[] NOT NULL DEFAULT '{}',
  baseline_override jsonb,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  voided_at timestamptz
);
CREATE INDEX daily_check_effects_source ON private.daily_check_effects (source_type, source_id);
CREATE INDEX daily_check_effects_target ON private.daily_check_effects (target_table, target_id, id);
ALTER TABLE private.daily_check_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.daily_check_effects FROM PUBLIC, anon, authenticated;

CREATE TABLE private.daily_check_storage_cleanup (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  photo_url text NOT NULL,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (source_type, source_id, photo_url)
);
ALTER TABLE private.daily_check_storage_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.daily_check_storage_cleanup FROM PUBLIC, anon, authenticated;

-- Retain evidence on surviving workshop tasks, not on the removed Daily Check.
CREATE TABLE public.workshop_task_check_photos (
  task_id uuid NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  item_number integer,
  day_of_week integer,
  photo_url text NOT NULL,
  caption text,
  created_at timestamptz,
  PRIMARY KEY (task_id, id)
);
ALTER TABLE public.workshop_task_check_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workshop_task_check_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workshop_task_check_photos TO service_role;
CREATE INDEX workshop_task_check_photos_url ON public.workshop_task_check_photos (photo_url);

ALTER TABLE public.vehicle_maintenance ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
ALTER TABLE public.hgvs ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
ALTER TABLE public.actions ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
ALTER TABLE public.reminders ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
ALTER TABLE public.reminder_actions ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
ALTER TABLE public.maintenance_history ADD COLUMN daily_check_id uuid, ADD COLUMN daily_check_type text;

-- A real parent lock closes the former polymorphic-child/delete race.
CREATE FUNCTION private.lock_daily_check(p_type text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('van', 'plant', 'hgv') THEN RAISE EXCEPTION 'Invalid Daily Check type'; END IF;
  EXECUTE format('SELECT id FROM public.%I WHERE id = $1 FOR KEY SHARE', p_type || '_inspections')
    INTO v_id USING p_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Daily Check no longer exists' USING ERRCODE = '23503'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_daily_check(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.daily_check_child_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_type text;
BEGIN
  SELECT kind INTO v_type FROM (
    SELECT 'van' AS kind FROM public.van_inspections WHERE id = NEW.inspection_id
    UNION ALL SELECT 'plant' FROM public.plant_inspections WHERE id = NEW.inspection_id
    UNION ALL SELECT 'hgv' FROM public.hgv_inspections WHERE id = NEW.inspection_id
  ) parents;
  IF v_type IS NULL THEN RAISE EXCEPTION 'Daily Check no longer exists' USING ERRCODE = '23503'; END IF;
  PERFORM private.lock_daily_check(v_type, NEW.inspection_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER daily_check_child_guard BEFORE INSERT OR UPDATE ON public.inspection_items
FOR EACH ROW EXECUTE FUNCTION private.daily_check_child_guard();
CREATE TRIGGER daily_check_child_guard BEFORE INSERT OR UPDATE ON public.inspection_photos
FOR EACH ROW EXECUTE FUNCTION private.daily_check_child_guard();
CREATE TRIGGER daily_check_child_guard BEFORE INSERT OR UPDATE ON public.inspection_daily_hours
FOR EACH ROW EXECUTE FUNCTION private.daily_check_child_guard();

CREATE FUNCTION private.daily_check_photo_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check-photo:' || NEW.photo_url, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check-workshop-photos', 0));
  IF EXISTS (SELECT 1 FROM private.daily_check_storage_cleanup
    WHERE strpos(private.daily_check_photo_text(NEW.photo_url), private.daily_check_photo_key(photo_url)) > 0) THEN
    RAISE EXCEPTION 'Photo belongs to a deleted Daily Check' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER daily_check_photo_guard BEFORE INSERT OR UPDATE OF photo_url ON public.inspection_photos
FOR EACH ROW EXECUTE FUNCTION private.daily_check_photo_guard();

-- Match signed/public/render URLs and relative keys, including percent-encoded aliases.
CREATE FUNCTION private.daily_check_photo_text(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_code integer;
BEGIN
  FOR v_code IN 1..127 LOOP
    IF v_code <> 37 THEN
      p_text := replace(replace(p_text, '%' || lpad(to_hex(v_code), 2, '0'), chr(v_code)),
        '%' || upper(lpad(to_hex(v_code), 2, '0')), chr(v_code));
    END IF;
  END LOOP;
  RETURN p_text;
END;
$$;
CREATE FUNCTION private.daily_check_photo_key(p_url text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT nullif(split_part(substring(private.daily_check_photo_text(p_url) FROM '/inspection-photos/(.*)'), '?', 1), '')
$$;

-- JSON/text workshop evidence shares a barrier with cleanup's reference check.
-- Existing evidence remains editable; new references to queued objects fail closed.
CREATE FUNCTION private.daily_check_workshop_photo_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_new text := to_jsonb(NEW)::text;
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)::text ELSE '' END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check-workshop-photos', 0));
  IF EXISTS (SELECT 1 FROM private.daily_check_storage_cleanup
    WHERE strpos(private.daily_check_photo_text(v_new), private.daily_check_photo_key(photo_url)) > 0
      AND strpos(private.daily_check_photo_text(v_old), private.daily_check_photo_key(photo_url)) = 0) THEN
    RAISE EXCEPTION 'Photo belongs to a deleted Daily Check' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.actions
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.workshop_task_comments
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.workshop_task_attachments
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.workshop_attachment_responses
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.workshop_attachment_field_responses
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();
CREATE TRIGGER daily_check_workshop_photo_guard BEFORE INSERT OR UPDATE ON public.workshop_task_check_photos
FOR EACH ROW EXECUTE FUNCTION private.daily_check_workshop_photo_guard();

CREATE FUNCTION private.journal_daily_check_effect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_source uuid := NEW.daily_check_source_id;
  v_type text := NEW.daily_check_source_type;
  v_before jsonb;
  v_after jsonb;
  v_field text;
  v_stamp text;
  v_check jsonb;
  v_asset uuid;
  v_target_asset uuid;
  v_target jsonb;
BEGIN
  IF TG_TABLE_NAME = 'actions' AND TG_OP = 'INSERT' AND v_source IS NULL THEN
    v_source := NEW.inspection_id;
    IF v_source IS NOT NULL THEN
      SELECT kind INTO v_type FROM (
        SELECT 'van' AS kind FROM public.van_inspections WHERE id = v_source
        UNION ALL SELECT 'plant' FROM public.plant_inspections WHERE id = v_source
        UNION ALL SELECT 'hgv' FROM public.hgv_inspections WHERE id = v_source
      ) parents;
    END IF;
  END IF;
  IF v_source IS NOT NULL THEN
    PERFORM private.lock_daily_check(v_type, v_source);
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', v_type || '_inspections')
      INTO v_check USING v_source;
    IF pg_trigger_depth() = 1 AND auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM (v_check->>'user_id')::uuid THEN
      RAISE EXCEPTION 'Daily Check source must belong to the actor' USING ERRCODE = '42501';
    END IF;
    v_asset := (v_check->>(v_type || '_id'))::uuid;
    v_target := to_jsonb(NEW);
    IF TG_TABLE_NAME = 'reminders' THEN
      SELECT to_jsonb(t) INTO v_target FROM public.reminder_actions t WHERE id = NEW.action_id;
    END IF;
    v_target_asset := CASE
      WHEN TG_TABLE_NAME = 'hgvs' THEN NEW.id
      ELSE (v_target->>(v_type || '_id'))::uuid END;
    IF v_asset IS DISTINCT FROM v_target_asset THEN
      RAISE EXCEPTION 'Daily Check source asset mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME IN ('reminders', 'reminder_actions') AND v_target->>'asset_type' IS DISTINCT FROM v_type THEN
      RAISE EXCEPTION 'Daily Check source type mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.daily_check_source_id := NULL;
  NEW.daily_check_source_type := NULL;
  v_after := to_jsonb(NEW) - ARRAY['updated_at', 'daily_check_source_id', 'daily_check_source_type'];
  IF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD) - ARRAY['updated_at', 'daily_check_source_id', 'daily_check_source_type'];
  END IF;
  IF TG_TABLE_NAME = 'vehicle_maintenance' THEN
    v_field := CASE WHEN NEW.plant_id IS NOT NULL THEN 'current_hours' ELSE 'current_mileage' END;
    v_stamp := CASE WHEN NEW.plant_id IS NOT NULL THEN 'last_hours_update' ELSE 'last_mileage_update' END;
    v_after := jsonb_build_object(v_field, v_after->v_field, v_stamp, v_after->v_stamp);
    IF v_before IS NOT NULL THEN
      v_before := jsonb_build_object(v_field, v_before->v_field, v_stamp, v_before->v_stamp);
    END IF;
  ELSIF TG_TABLE_NAME = 'hgvs' THEN
    v_after := jsonb_build_object('current_mileage', NEW.current_mileage);
    IF TG_OP = 'UPDATE' THEN v_before := jsonb_build_object('current_mileage', OLD.current_mileage); END IF;
    IF v_source IS NOT NULL AND v_before = v_after THEN RETURN NEW; END IF;
  END IF;
  IF TG_ARGV[0] = 'timestamp' AND EXISTS (
    SELECT 1 FROM private.daily_check_effects WHERE target_table = TG_TABLE_NAME AND target_id = NEW.id
      AND transaction_id = txid_current() AND before_row = v_before AND after_row = v_after
  ) THEN RETURN NEW; END IF;
  INSERT INTO private.daily_check_effects
    (target_table, target_id, source_id, source_type, before_row, after_row, input_fields)
  VALUES (TG_TABLE_NAME, NEW.id, v_source, v_type, v_before, v_after,
    CASE WHEN TG_TABLE_NAME IN ('vehicle_maintenance', 'hgvs') AND TG_ARGV[0] IS DISTINCT FROM 'timestamp'
      THEN ARRAY[COALESCE(v_field, 'current_mileage')] ELSE '{}'::text[] END);
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_check_meter_journal BEFORE INSERT OR UPDATE OF
current_mileage, current_hours ON public.vehicle_maintenance
FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect();
CREATE TRIGGER daily_check_stamp_journal BEFORE UPDATE OF last_mileage_update, last_hours_update ON public.vehicle_maintenance
FOR EACH ROW WHEN (NEW.current_mileage IS NOT DISTINCT FROM OLD.current_mileage
  AND NEW.current_hours IS NOT DISTINCT FROM OLD.current_hours)
EXECUTE FUNCTION private.journal_daily_check_effect('timestamp');
CREATE TRIGGER daily_check_meter_journal BEFORE INSERT OR UPDATE OF current_mileage ON public.hgvs
FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect();
CREATE TRIGGER daily_check_action_journal BEFORE INSERT OR UPDATE ON public.actions
FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect();
CREATE TRIGGER daily_check_reminder_journal BEFORE INSERT OR UPDATE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect();
CREATE TRIGGER daily_check_reminder_action_journal BEFORE INSERT OR UPDATE ON public.reminder_actions
FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect();

CREATE FUNCTION private.apply_daily_check_meter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_type text := TG_ARGV[0];
  v_asset uuid;
  v_before numeric;
  v_field text;
  v_stamp text;
  v_fk text;
  v_count integer;
BEGIN
  v_fk := v_type || '_id';
  v_asset := (to_jsonb(NEW)->>v_fk)::uuid;
  IF v_asset IS NULL OR NEW.current_mileage IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daily-check:' || v_type || ':' || v_asset::text, 0));
  v_field := CASE WHEN v_type = 'plant' THEN 'current_hours' ELSE 'current_mileage' END;
  v_stamp := CASE WHEN v_type = 'plant' THEN 'last_hours_update' ELSE 'last_mileage_update' END;
  EXECUTE format('SELECT %I FROM public.vehicle_maintenance WHERE %I = $1 FOR UPDATE', v_field, v_fk)
    INTO v_before USING v_asset;
  EXECUTE format('UPDATE public.vehicle_maintenance SET %I = $2, %I = clock_timestamp(),
      daily_check_source_id = $3, daily_check_source_type = $4, updated_at = now() WHERE %I = $1',
    v_field, v_stamp, v_fk) USING v_asset, NEW.current_mileage, NEW.id, v_type;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    EXECUTE format('INSERT INTO public.vehicle_maintenance (%I, %I, %I, daily_check_source_id, daily_check_source_type)
      VALUES ($1, $2, clock_timestamp(), $3, $4)', v_fk, v_field, v_stamp)
      USING v_asset, NEW.current_mileage, NEW.id, v_type;
  END IF;
  IF v_type = 'hgv' AND NEW.status = 'submitted' THEN
    UPDATE public.hgvs SET current_mileage = NEW.current_mileage,
      daily_check_source_id = NEW.id, daily_check_source_type = v_type WHERE id = v_asset;
  END IF;
  INSERT INTO public.maintenance_history
    (van_id, plant_id, hgv_id, field_name, old_value, new_value, value_type, comment, updated_by,
     daily_check_id, daily_check_type)
  VALUES (
    CASE WHEN v_type = 'van' THEN v_asset END, CASE WHEN v_type = 'plant' THEN v_asset END,
    CASE WHEN v_type = 'hgv' THEN v_asset END, v_field, v_before::text, NEW.current_mileage::text,
    CASE WHEN v_type = 'plant' THEN 'text' ELSE 'mileage' END,
    'Reading entered by Daily Check ' || NEW.id::text, NEW.user_id, NEW.id, v_type);
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.finalize_daily_check_effect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME IN ('actions', 'reminders', 'reminder_actions') THEN
    UPDATE private.daily_check_effects SET after_row =
      to_jsonb(NEW) - ARRAY['updated_at', 'daily_check_source_id', 'daily_check_source_type']
    WHERE id = (SELECT id FROM private.daily_check_effects
      WHERE target_table = TG_TABLE_NAME AND target_id = NEW.id AND transaction_id = txid_current()
      ORDER BY id DESC LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_daily_check_effect AFTER INSERT OR UPDATE ON public.actions
FOR EACH ROW EXECUTE FUNCTION private.finalize_daily_check_effect();
CREATE TRIGGER zz_daily_check_effect AFTER INSERT OR UPDATE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION private.finalize_daily_check_effect();
CREATE TRIGGER zz_daily_check_effect AFTER INSERT OR UPDATE ON public.reminder_actions
FOR EACH ROW EXECUTE FUNCTION private.finalize_daily_check_effect();
DROP TRIGGER trigger_update_maintenance_mileage ON public.van_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage AFTER INSERT OR UPDATE OF current_mileage ON public.van_inspections
FOR EACH ROW EXECUTE FUNCTION private.apply_daily_check_meter('van');
DROP TRIGGER trigger_update_maintenance_mileage_plant ON public.plant_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_plant AFTER INSERT OR UPDATE OF current_mileage ON public.plant_inspections
FOR EACH ROW EXECUTE FUNCTION private.apply_daily_check_meter('plant');
DROP TRIGGER trigger_update_maintenance_mileage_hgv ON public.hgv_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_hgv AFTER INSERT OR UPDATE OF current_mileage ON public.hgv_inspections
FOR EACH ROW EXECUTE FUNCTION private.apply_daily_check_meter('hgv');

-- Preserve the current RPC and its ACL, but explicitly attribute its repeated HGV write.
-- An unexpected deployed definition must fail closed rather than silently lose provenance.
DO $patch$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.save_hgv_inspection(uuid,boolean,uuid,uuid,date,uuid,uuid,text,integer,text,text,jsonb)'::regprocedure);
  v_old text := E'UPDATE public.hgvs\n    SET current_mileage = p_current_mileage\n    WHERE id = p_hgv_id;';
  v_new text := E'UPDATE public.hgvs\n    SET current_mileage = p_current_mileage,\n        daily_check_source_id = v_row.id, daily_check_source_type = ''hgv''\n    WHERE id = p_hgv_id;';
BEGIN
  v_definition := replace(v_definition, E'\r', '');
  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Unexpected HGV save definition: review causal attribution before applying';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$patch$;

REVOKE ALL ON FUNCTION private.daily_check_child_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.daily_check_photo_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.daily_check_photo_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.daily_check_photo_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.daily_check_workshop_photo_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.journal_daily_check_effect() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.apply_daily_check_meter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.finalize_daily_check_effect() FROM PUBLIC, anon, authenticated;
COMMIT;
