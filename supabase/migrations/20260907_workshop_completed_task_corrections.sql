-- finalise-phase: predeploy
-- Audited completed-task / attachment corrections and authenticated bypass guards.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workshop_attachment_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES public.workshop_task_attachments(id) ON DELETE RESTRICT,
  task_id UUID NOT NULL REFERENCES public.actions(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  actor_name TEXT NULL,
  reason TEXT NOT NULL,
  changed_fields TEXT[] NOT NULL,
  previous_responses JSONB NOT NULL,
  new_responses JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'manager_ui',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workshop_attachment_corrections_reason_len CHECK (char_length(btrim(reason)) >= 10)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_corrections_attachment
  ON public.workshop_attachment_corrections (attachment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_corrections_task
  ON public.workshop_attachment_corrections (task_id, created_at DESC);

ALTER TABLE public.workshop_attachment_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workshop_attachment_corrections FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.workshop_attachment_corrections TO authenticated;

CREATE POLICY "Workshop users can read attachment corrections"
  ON public.workshop_attachment_corrections
  FOR SELECT
  TO authenticated
  USING (
    public.effective_has_module_permission('workshop-tasks')
    AND EXISTS (
      SELECT 1
      FROM public.actions a
      WHERE a.id = workshop_attachment_corrections.task_id
        AND a.action_type = 'workshop_vehicle_task'
    )
  );

CREATE POLICY "Managers can insert attachment corrections"
  ON public.workshop_attachment_corrections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.effective_is_manager_admin()
    AND public.effective_has_module_permission('workshop-tasks')
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.actions a
      WHERE a.id = workshop_attachment_corrections.task_id
        AND a.action_type = 'workshop_vehicle_task'
    )
  );

CREATE OR REPLACE FUNCTION public.jsonb_array_is_prefix(prefix jsonb, full_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    prefix IS NULL
    OR jsonb_typeof(COALESCE(prefix, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(prefix, '[]'::jsonb)) = 0
    OR (
      jsonb_typeof(COALESCE(full_value, '[]'::jsonb)) = 'array'
      AND jsonb_array_length(COALESCE(full_value, '[]'::jsonb)) >= jsonb_array_length(prefix)
      AND (
        SELECT jsonb_agg(value ORDER BY ord)
        FROM jsonb_array_elements(full_value) WITH ORDINALITY AS t(value, ord)
        WHERE ord <= jsonb_array_length(prefix)
      ) = prefix
    );
$$;

CREATE OR REPLACE FUNCTION public.is_unified_service_workshop_category(p_category_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.maintenance_categories mc
    WHERE mc.workshop_category_id = p_category_id
      AND mc.config_key IN ('service_van', 'service_hgv', 'service_plant')
      AND mc.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.jsonb_preserves_correction_events(old_history jsonb, new_history jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(old_history, '[]'::jsonb)) old_evt
    WHERE (
        old_evt->>'status' = 'corrected'
        OR old_evt->'meta'->>'event_kind' = 'completed_task_correction'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(new_history, '[]'::jsonb)) new_evt
        WHERE new_evt = old_evt
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_unauthorised_completed_workshop_task_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_service boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.action_type IS DISTINCT FROM 'workshop_vehicle_task' THEN
    RETURN NEW;
  END IF;

  IF NOT public.jsonb_preserves_correction_events(OLD.status_history, NEW.status_history) THEN
    RAISE EXCEPTION 'Completed-task correction history cannot be altered';
  END IF;

  IF OLD.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  v_is_service :=
    public.is_unified_service_workshop_category(OLD.workshop_category_id)
    OR public.is_unified_service_workshop_category((
      SELECT s.category_id
      FROM public.workshop_task_subcategories s
      WHERE s.id = OLD.workshop_subcategory_id
    ));

  IF v_is_service THEN
    RAISE EXCEPTION 'Completed Service tasks cannot be mutated directly';
  END IF;

  IF NEW.action_type IS DISTINCT FROM OLD.action_type
     OR NEW.van_id IS DISTINCT FROM OLD.van_id
     OR NEW.hgv_id IS DISTINCT FROM OLD.hgv_id
     OR NEW.plant_id IS DISTINCT FROM OLD.plant_id
     OR NEW.workshop_category_id IS DISTINCT FROM OLD.workshop_category_id
     OR NEW.workshop_subcategory_id IS DISTINCT FROM OLD.workshop_subcategory_id
     OR NEW.asset_meter_reading IS DISTINCT FROM OLD.asset_meter_reading
     OR NEW.asset_meter_unit IS DISTINCT FROM OLD.asset_meter_unit
     OR NEW.workshop_comments IS DISTINCT FROM OLD.workshop_comments
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Completed workshop task fields cannot be mutated directly';
  END IF;

  IF NEW.status NOT IN ('logged', 'pending')
     OR COALESCE(NEW.actioned, false) = true
     OR NEW.actioned_at IS NOT NULL
     OR NOT public.jsonb_array_is_prefix(
       COALESCE(OLD.status_history, '[]'::jsonb),
       COALESCE(NEW.status_history, '[]'::jsonb)
     )
  THEN
    RAISE EXCEPTION 'Completed workshop tasks can only be undone through the lifecycle undo path';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_unauthorised_completed_workshop_task_mutation
  ON public.actions;
CREATE TRIGGER prevent_unauthorised_completed_workshop_task_mutation
  BEFORE UPDATE ON public.actions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unauthorised_completed_workshop_task_mutation();

CREATE OR REPLACE FUNCTION public.prevent_completed_workshop_attachment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id uuid;
  v_task_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_task_id := COALESCE(NEW.task_id, OLD.task_id);
  SELECT status INTO v_task_status
  FROM public.actions
  WHERE id = v_task_id;

  IF v_task_status = 'completed' THEN
    RAISE EXCEPTION 'Attachments on completed workshop tasks cannot be changed directly';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_completed_workshop_attachment_mutation
  ON public.workshop_task_attachments;
CREATE TRIGGER prevent_completed_workshop_attachment_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.workshop_task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_completed_workshop_attachment_mutation();

DROP POLICY IF EXISTS "Workshop users can create field responses v2"
  ON public.workshop_attachment_field_responses;
CREATE POLICY "Workshop users can create field responses v2"
  ON public.workshop_attachment_field_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      INNER JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND COALESCE(wta.status, 'pending') IS DISTINCT FROM 'completed'
        AND COALESCE(a.status, 'pending') IS DISTINCT FROM 'completed'
        AND (
          public.effective_is_manager_admin()
          OR public.effective_has_module_permission('workshop-tasks')
        )
    )
  );

DROP POLICY IF EXISTS "Workshop users can update field responses v2"
  ON public.workshop_attachment_field_responses;
CREATE POLICY "Workshop users can update field responses v2"
  ON public.workshop_attachment_field_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      INNER JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND COALESCE(wta.status, 'pending') IS DISTINCT FROM 'completed'
        AND COALESCE(a.status, 'pending') IS DISTINCT FROM 'completed'
        AND (
          public.effective_is_manager_admin()
          OR public.effective_has_module_permission('workshop-tasks')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      INNER JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND COALESCE(wta.status, 'pending') IS DISTINCT FROM 'completed'
        AND COALESCE(a.status, 'pending') IS DISTINCT FROM 'completed'
        AND (
          public.effective_is_manager_admin()
          OR public.effective_has_module_permission('workshop-tasks')
        )
    )
  );

ALTER FUNCTION public.jsonb_array_is_prefix(jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.jsonb_preserves_correction_events(jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_unified_service_workshop_category(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_unauthorised_completed_workshop_task_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_completed_workshop_attachment_mutation() SET search_path = public, pg_temp;

COMMIT;
