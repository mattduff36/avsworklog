BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.inventory_check_history
  ADD COLUMN IF NOT EXISTS submission_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_check_history_item_submission_uidx
  ON public.inventory_check_history (item_id, submission_id)
  WHERE submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.sync_inventory_item_last_checked_from_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_checked_at DATE;
BEGIN
  SELECT MAX(history.checked_at)
  INTO v_max_checked_at
  FROM public.inventory_check_history AS history
  WHERE history.item_id = NEW.item_id;

  UPDATE public.inventory_items AS item
  SET
    last_checked_at = v_max_checked_at,
    updated_by = COALESCE(NEW.checked_by, item.updated_by),
    updated_at = NOW()
  WHERE item.id = NEW.item_id
    AND item.last_checked_at IS DISTINCT FROM v_max_checked_at;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_inventory_item_last_checked_matches_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_history_count INTEGER;
  v_max_checked_at DATE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.last_checked_at IS NOT DISTINCT FROM OLD.last_checked_at THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INTEGER, MAX(history.checked_at)
  INTO v_history_count, v_max_checked_at
  FROM public.inventory_check_history AS history
  WHERE history.item_id = NEW.id;

  IF v_history_count = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.last_checked_at IS DISTINCT FROM v_max_checked_at THEN
    RAISE EXCEPTION
      'INVENTORY_LAST_CHECKED_HISTORY_MISMATCH: last_checked_at must equal the latest check history date when history exists'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_inventory_check_history_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'INVENTORY_CHECK_HISTORY_APPEND_ONLY: inventory check history cannot be updated or deleted'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_check_history_sync_last_checked
  ON public.inventory_check_history;
CREATE TRIGGER trg_inventory_check_history_sync_last_checked
AFTER INSERT ON public.inventory_check_history
FOR EACH ROW
EXECUTE FUNCTION private.sync_inventory_item_last_checked_from_history();

DROP TRIGGER IF EXISTS trg_inventory_items_last_checked_history_guard
  ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_last_checked_history_guard
BEFORE UPDATE OF last_checked_at ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION private.assert_inventory_item_last_checked_matches_history();

DROP TRIGGER IF EXISTS trg_inventory_check_history_append_only_update
  ON public.inventory_check_history;
CREATE TRIGGER trg_inventory_check_history_append_only_update
BEFORE UPDATE ON public.inventory_check_history
FOR EACH ROW
EXECUTE FUNCTION private.assert_inventory_check_history_append_only();

DROP TRIGGER IF EXISTS trg_inventory_check_history_append_only_delete
  ON public.inventory_check_history;
CREATE TRIGGER trg_inventory_check_history_append_only_delete
BEFORE DELETE ON public.inventory_check_history
FOR EACH ROW
EXECUTE FUNCTION private.assert_inventory_check_history_append_only();

CREATE OR REPLACE FUNCTION public.inventory_record_check(
  p_item_id UUID,
  p_checked_at DATE,
  p_checked_by UUID,
  p_note TEXT DEFAULT NULL,
  p_checklist_version TEXT DEFAULT NULL,
  p_checklist_items JSONB DEFAULT NULL,
  p_overall_status TEXT DEFAULT NULL,
  p_confirm_future_date BOOLEAN DEFAULT FALSE,
  p_submission_id UUID DEFAULT NULL
)
RETURNS SETOF public.inventory_check_history
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_interval_days INTEGER;
  v_london_today DATE;
  v_existing public.inventory_check_history%ROWTYPE;
  v_inserted public.inventory_check_history%ROWTYPE;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Inventory item not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_checked_at IS NULL THEN
    RAISE EXCEPTION 'Check date must be in YYYY-MM-DD format' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_checked_by IS NULL THEN
    RAISE EXCEPTION 'Checked by is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_overall_status IS NOT NULL
     AND p_overall_status NOT IN ('pass', 'fail', 'partial') THEN
    RAISE EXCEPTION 'Invalid overall status' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_checklist_items IS NOT NULL
     AND jsonb_typeof(p_checklist_items) <> 'array' THEN
    RAISE EXCEPTION 'Checklist items must be an array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_london_today := (timezone('Europe/London', now()))::date;
  IF p_checked_at > v_london_today AND COALESCE(p_confirm_future_date, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUTURE_CHECK_CONFIRMATION_REQUIRED'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT item.*
  INTO v_item
  FROM public.inventory_items AS item
  WHERE item.id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_item.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Retired inventory items cannot be checked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_submission_id IS NOT NULL THEN
    SELECT history.*
    INTO v_existing
    FROM public.inventory_check_history AS history
    WHERE history.item_id = p_item_id
      AND history.submission_id = p_submission_id;

    IF FOUND THEN
      RETURN NEXT v_existing;
      RETURN;
    END IF;
  END IF;

  v_interval_days := COALESCE(v_item.check_interval_days, 30);
  IF v_interval_days < 1 OR v_interval_days > 3650 THEN
    RAISE EXCEPTION 'Check interval must be between 1 and 3650 days'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.inventory_check_history (
    item_id,
    checked_at,
    interval_days,
    note,
    checklist_version,
    checklist_items,
    overall_status,
    checked_by,
    submission_id
  )
  VALUES (
    p_item_id,
    p_checked_at,
    v_interval_days,
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    NULLIF(BTRIM(COALESCE(p_checklist_version, '')), ''),
    p_checklist_items,
    p_overall_status,
    p_checked_by,
    p_submission_id
  )
  RETURNING * INTO v_inserted;

  RETURN NEXT v_inserted;
  RETURN;
END;
$$;

DROP POLICY IF EXISTS inventory_check_history_insert ON public.inventory_check_history;

REVOKE ALL ON FUNCTION private.sync_inventory_item_last_checked_from_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_inventory_item_last_checked_matches_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_inventory_check_history_append_only() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.inventory_record_check(
  UUID,
  DATE,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  BOOLEAN,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_record_check(
  UUID,
  DATE,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  BOOLEAN,
  UUID
) TO service_role;

COMMIT;
